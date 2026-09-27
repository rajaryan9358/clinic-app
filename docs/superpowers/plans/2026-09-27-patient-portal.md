# Patient Portal Core (E2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Patients sign in to a mobile-first `/portal` SPA with a WhatsApp code or a staff-sent magic link and can consent, view a dashboard, book/reschedule/cancel appointments, view/download finalized prescriptions and manage family profiles.

**Architecture:** A second React SPA (Vite entry `resources/js/portal`) talks to `/api/portal/*`. Patients authenticate with Sanctum personal access tokens on the `Patient` model through a new `portal` guard; the acting profile is chosen per request with `X-Patient-Id` and checked by middleware against the account's allowed profiles. Booking reuses `AppointmentService`; prescriptions gain a Draft/Final status that gates what patients see.

**Tech Stack:** Laravel 13, PHP 8.4, Sanctum 4, React 19 + Vite + Tailwind 4, PHPUnit (SQLite in-memory), barryvdh/dompdf.

**Spec:** `docs/superpowers/specs/2026-09-27-patient-portal-design.md`

## Global Constraints

- PHP: `/opt/homebrew/bin/php`; tests `php artisan test` (SQLite in-memory, sync queue). Node: `/usr/local/bin/node`; build `/usr/local/bin/node node_modules/vite/bin/vite.js build`.
- Migrations are edited **in place** (schema is rebuilt with `migrate:fresh`); never run migrations against the MySQL dev DB except in Task 10 after a backup.
- Response envelope: `ApiResponse::success(string $message, mixed $data = null, int $status = 200)` / `error(string $message, mixed $errors = null, int $status = 422)`.
- Guard name `portal` (driver `sanctum`, provider `patients` → `App\Models\Patient`); add guard `sanctum` with provider `users` so staff `auth:sanctum` rejects patient tokens.
- Token: `$patient->createToken('portal', ['portal'], now()->addDays(30))`.
- Header `X-Patient-Id` selects the acting profile; request attributes `portal_account` (token owner) and `portal_patient` (acting profile).
- Account holder = patient with `managed_by_patient_id` null, not soft-deleted, clinic `clinic_settings.portal_enabled` true (no settings row ⇒ enabled).
- Phone matching: `PhoneNumber::normalise()` on both sides; candidate rows fetched with `where('phone', 'like', '%'.substr($normalised, -10))` then filtered in PHP by `PhoneNumber::normalise($row->phone) === $normalised`.
- OTP: 6 digits via `random_int(100000, 999999)`, stored as `hash('sha256', $code)` in `login_otps.otp_code`, `purpose = 'login'`, TTL 10 min, max 5 attempts; per phone ≤1 request / 60 s and ≤5 / hour (429 `Too many code requests. Try again later.`); IP limiter `portal-otp` 20/hour.
- Request-code reply always 200 `If this number is registered, a code has been sent.`
- Magic link: 40-char `Str::random(40)` token, stored sha256 in `patient_login_links.token_hash`, 7 days, single use; URL `rtrim(config('app.url'),'/').'/portal/login/'.$token`.
- Messages (exact): `Incorrect code.` · `Too many attempts. Request a new code.` · `Code expired. Request a new code.` · `This link has expired.` · `Send the link to the account holder.` · `Session expired. Please sign in again.` (401) · `You can't view this profile.` (403) · `That slot was just taken. Please pick another.` (409) · `Changes are closed for this visit. Please call the clinic.` (422) · `The clinic can't take online bookings right now. Please call the clinic.` (422) · `Finalize the prescription first.` (422) · consent gate 428 `{success:false, message:'Please accept the privacy notice to continue.', code:'consent_required'}`.
- Consent: `App\Support\PortalConsent::VERSION = '2026-09-v1'`.
- New booking channel value `portal`; status-log `source` `patient` for portal actions.
- Portal bookings are created `pending` with no WhatsApp; staff confirming a `portal` appointment (pending→confirmed) sends `PatientNotifier::bookingConfirmed`. Portal reschedule → status `pending`.
- Cutoffs/booking window reuse existing `clinic_settings`: `allow_cancel`, `cancel_cutoff_hours`, `allow_reschedule`, `reschedule_cutoff_hours`, `max_advance_booking_days`, `min_booking_notice_minutes` (column defaults when no row: true, 2, true, 2, 30, 30).
- Prescriptions: `appointment_prescriptions.status` enum `draft|final` default `draft`; portal shows latest **final** per appointment only.
- New permission `patients.portal_link` (clinic_admin via `all()`, receptionist default).
- Commits: stage specific files only; never stage `Clinic_Management_System_MVP_PRD.pdf`, `.playwright-mcp/`, `.superpowers/`, `public/build`. Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Phone typed differently at login (`+91 98765 43210`, `098765-43210`) than stored (`9876543210`) must still find the patient — pinned by `test_request_code_matches_differently_formatted_phone` (Task 2).
2. A garbage or foreign `X-Patient-Id` (`abc`, another clinic's patient id, a soft-deleted dependent) returns 403, never 500 or data — `test_foreign_or_invalid_profile_header_is_403` (Task 1).
3. Booking a time that is not an offered free slot (arbitrary time, past, inside min notice, beyond max advance days) returns 422 — `test_book_rejects_times_that_are_not_offered_slots` (Task 5).
4. Two bookings of the same slot: the second gets 409 — `test_second_booking_of_same_slot_is_409` (Task 5).
5. A patient token used on staff routes is rejected (401), and a staff token on portal routes is rejected (401) — `test_tokens_do_not_cross_guards` (Task 1).

---

### Task 1: Schema, patient guard, profile resolution, `/auth/me`, logout

**Files:**
- Modify migrations (in place): `database/migrations/2026_03_29_000300_create_patient_tables.php` (patients: `managed_by_patient_id` nullable FK→patients nullOnDelete + index, `consent_given_at` timestamp null, `consent_version` string(20) null), `2026_03_29_000600_create_settings_billing_and_logs_tables.php` (`clinic_settings.portal_enabled` boolean default true; `login_otps.otp_code` → string(64), add `attempts` unsignedTinyInteger default 0; create `patient_login_links`: id, clinic_id FK cascade, patient_id FK→patients cascade, token_hash string(64) unique, expires_at timestamp, consumed_at timestamp null, created_by_user_id FK→users nullOnDelete, created_at timestamp null), `2026_03_29_000400_create_appointments_and_followups_tables.php` (`appointments.booking_channel` enum add `portal`), `2026_03_30_000200_create_appointment_prescriptions_table.php` (`status` enum draft|final default draft, `finalized_at` timestamp null, `finalized_by_user_id` FK→users nullOnDelete).
- Modify: `app/Models/Patient.php` (implements `Illuminate\Contracts\Auth\Authenticatable`, uses `Illuminate\Auth\Authenticatable` + `Laravel\Sanctum\HasApiTokens`; fillable `managed_by_patient_id`; casts `consent_given_at` datetime; relations `managedBy()`, `dependents()`; **do not** make `consent_*` fillable), `app/Models/ClinicSetting.php` (fillable/casts/validationRules `portal_enabled` boolean), `app/Models/LoginOtp.php` (fillable `attempts`), `app/Models/AppointmentPrescription.php` (fillable status/finalized_at/finalized_by_user_id, casts).
- Create: `app/Models/PatientLoginLink.php` (`$timestamps = false`, casts), `config/auth.php` guards/providers, `app/Support/Portal/PortalProfiles.php`, `app/Http/Middleware/AuthenticatePortal.php` (alias `portal.auth` in `bootstrap/app.php`), `app/Http/Controllers/Api/Portal/AuthController.php` (me, logout), `app/Support/Portal/PortalAccount.php` (serialiser), routes group in `routes/api.php`.
- Test: `tests/Feature/Portal/PortalAuthTest.php`, helper trait `tests/Feature/Portal/PortalTestHelpers.php`.

**Interfaces — Produces:**
```php
namespace App\Support\Portal;
final class PortalProfiles {
    /** Account-holder rows for a normalised phone across portal-enabled clinics. @return \Illuminate\Support\Collection<Patient> */
    public static function accountHoldersForPhone(string $normalisedPhone): Collection;
    /** @return Collection<array{patient: Patient, relation: 'self'|'dependent'|'family'|'same_phone'}> keyed by patient id */
    public static function allowedFor(Patient $account): Collection;
    public static function portalEnabled(int $clinicId): bool;
}
final class PortalAccount { public static function payload(Patient $account): array; } // shape of GET /auth/me data
```
Middleware `portal.auth`: authenticates via `Auth::guard('portal')`, 401 `Session expired. Please sign in again.` when no patient / soft-deleted / clinic portal disabled / token lacks ability `portal`; resolves `X-Patient-Id` (absent → account) against `PortalProfiles::allowedFor($account)`; non-integer or not allowed → 403 `You can't view this profile.`; sets attributes `portal_account`, `portal_patient`.
Routes: `Route::prefix('portal')` → public `auth/*` (Tasks 2-3) and `Route::middleware('portal.auth')` group with `GET auth/me`, `POST auth/logout`.

- [ ] **Step 1: Failing tests.** `PortalTestHelpers` provides `makeClinic(array $settings = [])`, `makePatient(Clinic, array $attrs = [])` (defaults: full_name, phone `9876543210`), `portalToken(Patient): string` (`createToken('portal',['portal'], now()->addDays(30))->plainTextToken`), `portalGet/Post($uri, $token, $patientId = null, $data = [])` setting `Authorization` and `X-Patient-Id`. Tests:
  - `test_me_returns_account_profiles_and_clinic` — account with a dependent (managed_by), a family link (patient_family_links patient_id=account → related), a same-phone second holder in the same clinic, a same-phone holder in another clinic: `profiles` has 4 entries with relations self/dependent/family/same_phone; `clinics` lists both clinics' holder rows; `clinic.name` present.
  - `test_family_link_is_one_directional` — the related patient's token cannot act for the linker (403).
  - `test_foreign_or_invalid_profile_header_is_403` — `X-Patient-Id: abc`, another clinic's patient id, a stranger in same clinic, a soft-deleted dependent → 403 each.
  - `test_tokens_do_not_cross_guards` — patient token on `GET /api/clinic/patients` → 401; staff user token (`$user->createToken('api-token')`) on `GET /api/portal/auth/me` → 401.
  - `test_disabled_portal_or_deleted_patient_is_401` — set `portal_enabled=false` → 401; soft-delete account → 401; expired token (travel 31 days) → 401.
  - `test_logout_revokes_token` — logout 200, then me → 401.
- [ ] **Step 2: Run** `php artisan test --filter=PortalAuthTest` → FAIL.
- [ ] **Step 3: Implement.** `config/auth.php`:
```php
'guards' => [
    'web' => ['driver' => 'session', 'provider' => 'users'],
    'sanctum' => ['driver' => 'sanctum', 'provider' => 'users'],
    'portal' => ['driver' => 'sanctum', 'provider' => 'patients'],
],
'providers' => [
    'users' => ['driver' => 'eloquent', 'model' => env('AUTH_MODEL', App\Models\User::class)],
    'patients' => ['driver' => 'eloquent', 'model' => App\Models\Patient::class],
],
```
`PortalProfiles::allowedFor`:
```php
public static function allowedFor(Patient $account): Collection
{
    $out = collect([$account->id => ['patient' => $account, 'relation' => 'self']]);
    $clinicId = $account->clinic_id;
    Patient::where('clinic_id', $clinicId)->where('managed_by_patient_id', $account->id)->get()
        ->each(fn ($p) => $out->put($p->id, $out->get($p->id) ?? ['patient' => $p, 'relation' => 'dependent']));
    $linked = PatientFamilyLink::where('clinic_id', $clinicId)->where('patient_id', $account->id)->pluck('related_patient_id');
    Patient::where('clinic_id', $clinicId)->whereIn('id', $linked)->get()
        ->each(fn ($p) => $out->put($p->id, $out->get($p->id) ?? ['patient' => $p, 'relation' => 'family']));
    $phone = PhoneNumber::normalise($account->phone);
    if ($phone) {
        self::accountHoldersForPhone($phone)->where('clinic_id', $clinicId)
            ->each(fn ($p) => $out->put($p->id, $out->get($p->id) ?? ['patient' => $p, 'relation' => 'same_phone']));
    }
    return $out;
}
```
(`Patient` uses SoftDeletes so trashed rows are excluded automatically.) `accountHoldersForPhone`: `Patient::whereNull('managed_by_patient_id')->where('phone','like','%'.substr($n,-10))->get()->filter(fn($p)=>PhoneNumber::normalise($p->phone)===$n && self::portalEnabled($p->clinic_id))->values()`. `portalEnabled`: `ClinicSetting::where('clinic_id',$id)->value('portal_enabled') ?? true` cast bool. `PortalAccount::payload`: `{account:{id,full_name,phone}, profiles:[{id,full_name,dob,gender,relation,consent_current: bool}], clinics:[{patient_id, clinic_id, clinic_name, patient_name}], clinic:{id,name,logo_url,primary_color,phone,address}}` where `consent_current = $p->consent_version === PortalConsent::VERSION` (create `app/Support/PortalConsent.php` here with `VERSION` and `TEXT` — the new-clinic notice text: "This clinic collects and processes your personal and health data (contact details, medical history and prescriptions) to provide care, maintain your medical record, and communicate with you about appointments. Your data is shared only with the doctors and staff involved in your care, and isn't sold or used for marketing. You can ask the clinic what data is held about you at any time."). Clinic address: use the clinic's address fields if present on `clinics`/`clinic_branches` (check the model; null when none). Middleware per the Interfaces block. Patient token on staff routes: with the `sanctum` guard provider set, `auth:sanctum` returns 401 — verify with the test; if any staff route relies on `auth:sanctum` without the guard config, the test shows it.
- [ ] **Step 4:** tests PASS; full suite green.
- [ ] **Step 5: Commit** `feat(portal): patient guard, profile resolution and portal session endpoints`

---

### Task 2: WhatsApp code login and clinic switching

**Files:** Create `app/Services/Portal/PortalOtpService.php`, `app/Http/Controllers/Api/Portal/OtpController.php`; modify `app/Http/Controllers/Api/Portal/AuthController.php` (switchClinic), `app/Providers/AppServiceProvider.php` (RateLimiter `portal-otp` 20/hour by IP), `routes/api.php`. Test `tests/Feature/Portal/PortalOtpTest.php`.

**Interfaces:** Consumes `PortalProfiles::accountHoldersForPhone`, `PatientNotifier::loginOtp(string $phone, string $code, ?int $clinicId): WhatsappMessage`, `PortalAccount::payload`. Produces:
- `POST /api/portal/auth/request-code {phone}` (middleware `throttle:portal-otp`).
- `POST /api/portal/auth/verify {phone, code, patient_id?}` → 200 `{token, account: PortalAccount::payload}` or 200 `{needs_selection: true, choices: [{patient_id, patient_name, clinic_id, clinic_name}]}`.
- `POST /api/portal/auth/switch-clinic {patient_id}` (portal.auth) → `{token, account}`; old token deleted.
```php
final class PortalOtpService {
    public function request(string $rawPhone): void;             // throws ThrottleRequestsException-like 429 via abort(429, msg)
    /** @return array{status: 'ok', patient: Patient}|array{status: 'choose', choices: array} */
    public function verify(string $rawPhone, string $code, ?int $patientId): array; // ValidationException(code => msg) on failures
}
```

- [ ] **Step 1: Failing tests** (fake gateway bound; time frozen):
  - `test_request_code_sends_whatsapp_and_stores_hash` — one `login_otp` send with a 6-digit code; `login_otps` row `purpose=login`, `otp_code = sha256(code)`, `expires_at = now+10m`. Response message exact.
  - `test_request_code_for_unknown_phone_gives_same_reply_and_sends_nothing`; dependents only (managed_by set) → nothing sent; clinic with portal disabled → nothing sent.
  - `test_request_code_matches_differently_formatted_phone` — stored `9876543210`, requests with `+91 98765 43210` and `098765-43210` both send.
  - `test_request_code_throttles_per_phone` — second request within 60 s → 429 exact message; after 61 s OK; 6th within an hour → 429.
  - `test_verify_logs_in_single_holder` → token works on `/auth/me`; OTP `verified_at` set; reuse of same code → 422 `Code expired. Request a new code.`
  - `test_verify_wrong_code_counts_attempts` — 4 wrong → `Incorrect code.`; 5th wrong → `Too many attempts. Request a new code.`; then correct → same "Too many attempts" message.
  - `test_verify_expired_code` (travel 11 min) → 422 expired message.
  - `test_verify_multiple_holders_requires_selection_without_consuming` — two clinics: first call returns `needs_selection` with 2 choices, `verified_at` still null; second call with `patient_id` → token; `patient_id` not among choices → 422.
  - `test_switch_clinic_issues_new_token_for_same_phone_holder` — old token → 401 after switch; target in portal-disabled clinic or different phone → 422.
- [ ] **Step 2: FAIL. Step 3: implement.** Throttle checks in `request()` before sending: `LoginOtp::where('phone_or_email',$n)->where('purpose','login')->where('created_at','>=',now()->subSeconds(60))->exists()` → abort 429; count in last hour ≥5 → abort 429. The row is created only when holders exist (unknown phones create nothing and return the same message — throttle doesn't reveal existence because unknown phones never hit it). Verify picks `latest('id')` unverified row for the phone with `purpose=login`; expired or none → expired message; `attempts >= 5` → too many; hash mismatch → increment, message `Incorrect code.` unless the increment reached 5 → too-many message. On success with a resolved patient: set `verified_at`, return token (`createToken('portal',['portal'],now()->addDays(30))`).
- [ ] **Step 4: PASS; suite green. Step 5: Commit** `feat(portal): WhatsApp code login and clinic switching`

---

### Task 3: Magic links and `portal_link` WhatsApp template

**Files:** Modify `app/Services/WhatsApp/TemplateSettings.php` (TYPES += `portal_link`), `app/Services/WhatsApp/PatientNotifier.php` (`portalLink`), `app/Support/PermissionCatalogue.php` (`patients.portal_link` in the patients module actions; receptionist default), `database/seeders/RolesAndPermissionsSeeder.php` if it enumerates permissions; create `app/Http/Controllers/Api/Clinic/PatientPortalLinkController.php`, `app/Http/Controllers/Api/Portal/LinkController.php`; routes: clinic `POST patients/{id}/portal-link` (`perm:patients.portal_link`), super-admin equivalent, portal `POST auth/link`. Tests `tests/Feature/Portal/PortalLinkTest.php`; extend `tests/Feature/WhatsApp/NotifierTest.php`.

**Interfaces:** Produces `PatientNotifier::portalLink(Patient $patient, string $token): WhatsappMessage` — `notification_type`/type `portal_link`, body params `[patient full_name, clinic name]`, `buttonCode: $token`, preview `"Sign in to {clinic}'s patient portal: {url}"`. Staff endpoint → 201 `{url, expires_at, whatsapp: {id, delivery_status}}`. Portal `POST /api/portal/auth/link {token}` → `{token, account}`.

- [ ] **Step 1: Failing tests:** staff with permission creates link: row with sha256 hash, 7-day expiry, WhatsApp `portal_link` sent with body `[name, clinic]` and URL button param = token; response url ends with `/portal/login/{token}`. Dependent → 422 `Send the link to the account holder.` Other clinic's patient → 404. Without permission (doctor) → 403. Exchange: valid → token; second use → 422 `This link has expired.`; after 7 days → same; portal disabled → same; soft-deleted patient → same. `TemplateSettings::all()` includes `portal_link`; notifier test for components.
- [ ] **Step 2: FAIL. Step 3: implement** (the link is created even if the WhatsApp row is skipped; the response carries the message status). **Step 4: PASS; suite green. Step 5: Commit** `feat(portal): staff-sent magic login links`

---

### Task 4: Consent gate, dashboard shell data, family

**Files:** Create `app/Http/Middleware/RequirePortalConsent.php` (alias `portal.consent`), `app/Http/Controllers/Api/Portal/ConsentController.php`, `FamilyController.php`, `DashboardController.php`; create `app/Http/Controllers/Api/Clinic/PatientFamilyController.php` (staff `PUT patients/{id}/managed-by {managed_by_patient_id|null}`, perm `patients.edit`, + super-admin route); routes. Test `tests/Feature/Portal/PortalConsentFamilyTest.php`.

**Interfaces:** Produces portal routes (inside `portal.auth`): `GET consent` → `{version, text, given_at, current}`, `POST consent`; group `portal.auth` + `portal.consent` for every feature route from here on (Tasks 4-6): `GET dashboard` → `{next_appointment: ?AppointmentItem, upcoming_count, finalized_prescriptions_count}` (AppointmentItem shape defined in Task 5 — implement it here via `App\Support\Portal\AppointmentPresenter::item(Appointment): array` returning `{id, date, start_time, end_time, status, visit_type, consultation_mode, booking_channel, doctor: {id, name, specialization}}`; Task 5 adds `can_cancel`, `can_reschedule`, `change_blocked_reason`), `GET family` → profiles (same shape as `/auth/me` profiles), `POST family {full_name, dob?, gender?: male|female|other}` → 201 profile.

- [ ] **Step 1: Failing tests:** without consent `GET dashboard` → 428 with `code: consent_required`; `GET consent` works; `POST consent` stamps `consent_given_at`, `consent_version = PortalConsent::VERSION`, `communication_consent = true` on the **acting** profile only; after that dashboard 200. Version bump (set patient's `consent_version='old'`) → 428 again. Dashboard counts: upcoming = pending/confirmed/checked_in/in_consultation with start ≥ now; `next_appointment` soonest; finalized prescriptions count counts latest-final-per-appointment for P (create final + draft rows directly). `POST family` while acting as a dependent still sets `managed_by_patient_id = account.id`, `phone = account.phone`, `clinic_id = account.clinic_id`, `uuid`, splits `first_name`; new profile appears in `GET family`; validation 422 on missing name. Staff managed-by: set to an account holder in same clinic → 200; to self, to a dependent, to another clinic's patient, or making a patient with its own dependents managed → 422 `Choose an account holder in this clinic.`; null clears.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS; suite green. Step 5: Commit** `feat(portal): consent gate, dashboard and family profiles`

---

### Task 5: Portal appointments and booking

**Files:** Modify `app/Services/AppointmentService.php`; create `app/Services/Portal/PortalBookingPolicy.php`, `app/Http/Controllers/Api/Portal/AppointmentController.php`, `DoctorController.php`; extend `app/Support/Portal/AppointmentPresenter.php`; routes. Test `tests/Feature/Portal/PortalAppointmentsTest.php`, extend `tests/Feature/WhatsApp/TriggerTest.php`.

**Interfaces — AppointmentService changes (backwards compatible):**
```php
public function create(array $data, string $source = 'staff'): Appointment;         // status log source; skips bookingConfirmed when booking_channel === 'portal'
public function changeStatus(Appointment $a, AppointmentStatus $s, ?int $actorUserId = null, ?string $reason = null, bool $force = false, string $source = 'staff'): Appointment;
    // after save: if old status 'pending', new CONFIRMED, booking_channel 'portal' → notifyAfterCommit(bookingConfirmed)
public function reschedule(Appointment $a, array $newData, ?int $actorUserId = null, ?string $reason = null, string $source = 'staff', ?string $newStatus = null): Appointment;
    // conflict → ValidationException as today; when $newStatus given, sets it (and writes an AppointmentStatusLog with $source) inside the same transaction
public function assertSlotFree(int $clinicId, int $doctorId, string $date, string $start, ?string $end, ?int $excludeAppointmentId = null): void; // extracted from reschedule's conflict query; throws ValidationException(['start_time' => 'Selected slot is already booked.'])
```
`create` calls `assertSlotFree` only when `$source === 'patient'` (staff behaviour unchanged). Portal controllers translate that ValidationException key `start_time` → 409 `That slot was just taken. Please pick another.`; `PlanLimitExceeded` (whatever `PlanLimits::assertCanAdd` throws — check the class) → 422 plan message.
```php
final class PortalBookingPolicy {
    public function settings(int $clinicId): array; // allow_cancel, cancel_cutoff_hours, allow_reschedule, reschedule_cutoff_hours, max_advance_booking_days, min_booking_notice_minutes with column defaults
    public function canChange(Appointment $a, 'cancel'|'reschedule' $kind): ?string; // null = allowed, else the blocked message
    /** @return array<int, array{start_time: string, end_time: string}> free, offered slots for the date after notice/advance rules */
    public function freeSlots(int $clinicId, int $doctorId, string $date, ?int $excludeAppointmentId = null): array; // 422 ValidationException for date < today or > today+max_advance
    public function slotFor(int $clinicId, int $doctorId, string $date, string $start, ?int $excludeAppointmentId = null): array; // the matching free slot or ValidationException(['start_time' => 'Please choose one of the available times.'])
}
```
Appointment start instants use `config('app.clinic_timezone')` (as in `SendWhatsAppReminders`).
Portal routes (`portal.auth` + `portal.consent`): `GET appointments?filter=all|upcoming|past`, `GET appointments/{id}`, `POST appointments`, `POST appointments/{id}/cancel {reason?}`, `POST appointments/{id}/reschedule {appointment_date, start_time}`, `GET doctors`, `GET doctors/{id}/slots?date=`.

- [ ] **Step 1: Failing tests** (clinic tz Asia/Kolkata, time frozen via `Carbon::parse(..., 'Asia/Kolkata')`; doctor schedule Mon–Sun 09:00–12:00, 30-min slots):
  - list filters and ordering; detail of another patient's appointment → 404; items carry `can_cancel`, `can_reschedule`, `change_blocked_reason`.
  - `test_book_creates_pending_portal_appointment_without_whatsapp` — 201; status pending, booking_channel portal, end_time from slot, notes = reason, status log source patient; zero WhatsApp rows.
  - `test_book_rejects_times_that_are_not_offered_slots` — 09:10, a past slot today, a slot inside 30-min notice, a date beyond 30 days, a date in the past, another clinic's doctor (404) → 422 each (404 for the doctor).
  - `test_second_booking_of_same_slot_is_409`.
  - `test_plan_limit_returns_422_message` — clinic on a plan with appointments limit reached (reuse existing plan-limit test setup) → 422 exact message.
  - `test_staff_confirming_portal_booking_sends_confirmation` — lifecycle confirm via clinic API → one `booking_confirmed` row; confirming a staff-created pending appointment → no new row (it got one at creation).
  - `test_cancel_respects_cutoff_and_settings` — 3 h before with cutoff 2 → 200 cancelled, reason saved, `appointment_updated` WhatsApp row, status log source patient; 1 h before → 422 exact message; `allow_cancel=false` → 422; completed appointment → 422.
  - `test_reschedule_moves_to_pending_and_checks_slot` — confirmed → new free slot → 200 status pending, date/time changed, reschedule log, `appointment_updated` WhatsApp; taken slot → 409; not-offered time → 422; inside `reschedule_cutoff_hours` → 422.
  - `test_doctors_and_slots` — only active doctors of P's clinic; `consultation_modes` derived from schedules; slots exclude booked ones and those inside notice.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS; full suite green (existing appointment tests unchanged). Step 5: Commit** `feat(portal): appointments, booking, cancel and reschedule for patients`

---

### Task 6: Prescription Draft/Final and portal prescriptions

**Files:** Create `app/Support/Prescriptions/PrescriptionResolver.php`; modify `app/Services/PrescriptionPdfRenderer.php` (add `renderPrescription(AppointmentPrescription $rx): PdfDocument`; `render(Appointment)` uses resolver latest-final-else-latest), Clinic + SuperAdmin `AppointmentController` (`finalizePrescription`, `sendPrescription` requires final, `prescription` response includes `status`/`finalized_at`/`latest_final_id`), `app/Http/Controllers/Api/PublicPrescriptionPdfController.php` (render the signed prescription itself), `app/Services/WhatsApp/PatientNotifier.php` (`prescriptionReady` unchanged signature); create `app/Http/Controllers/Api/Portal/PrescriptionController.php`; routes: clinic/super-admin `POST appointments/{id}/prescription/finalize` (`perm:appointments.prescribe`), portal `GET prescriptions`, `GET prescriptions/{id}`, `GET prescriptions/{id}/pdf`. Tests `tests/Feature/Portal/PortalPrescriptionsTest.php`, `tests/Feature/PrescriptionFinalizeTest.php`; update `tests/Feature/WhatsApp/TriggerTest.php` and `NotifierTest.php` fixtures to create `status => 'final'` where they send.

**Interfaces:**
```php
final class PrescriptionResolver {
    public static function latest(int $appointmentId): ?AppointmentPrescription;
    public static function latestFinal(int $appointmentId): ?AppointmentPrescription;
}
```
Finalize endpoint: latest row is draft → set `status=final`, `finalized_at=now()`, `finalized_by_user_id` → 200 row; no rows → 404; latest already final → 422 `This prescription is already final.`
`sendPrescription`: latest row missing → 404 (as now); latest is draft → 422 `Finalize the prescription first.`; sends `latestFinal`.
Portal list item `{id, appointment_id, date, doctor_name, medicines: string[]}` (medicine names from `data['medicines'][*]['name']` or equivalent — inspect `resources/views/reports/prescription.blade.php` for the data keys); detail `{id, appointment_id, date, doctor: {name, specialization}, clinic: {name}, data, finalized_at}`; pdf streams `renderPrescription` as `prescription-{appointment_id}.pdf`. Drafts and other patients' → 404.

- [ ] **Step 1: Failing tests:** finalize flow and errors; send requires final (draft latest → 422 even if an older final exists); staff `prescription.pdf` still works for drafts; public signed PDF renders that exact prescription; portal list shows only latest final per appointment (older final superseded by newer final; newer draft ignored), detail/pdf 404 for drafts and other patients, pdf content-type `application/pdf`.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS; suite green. Step 5: Commit** `feat(prescriptions): draft/final status and patient portal prescriptions`

---

### Task 7: Staff admin UI

**Files (resources/js/admin/src):** `pages/workflows/PrescriptionPage.jsx` (Draft/Final badge, Finalize button with confirm, disable "Send to patient" until final with hint text, show API message on 422), `pages/workflows/PatientProfilePage.jsx` ("Send portal link" button (perm `patients.portal_link`, account holders only) → shows URL with Copy + WhatsApp status; Family card: "Managed by" picker (search patients in clinic, account holders only) calling `PUT patients/{id}/managed-by`, list of dependents, existing family links with note "Can use this patient's portal"; consent line), `pages/workflows/ClinicDetailPage.jsx` settings tab + `config/modules.js` clinicSettings (checkbox `portal_enabled` "Patient portal enabled"), `pages/workflows/AppointmentsFlowPage.jsx` and `config/modules.js` appointments (channel label "Portal", filter `booking_channel` incl. portal — ensure `booking_channel` is in the appointment controllers' `$filterable`, with a PHP test), `pages/workflows/SystemSettingsPage.jsx` (help line for `portal_link`: "Utility · body: 1 patient name, 2 clinic name · URL button: {{1}} = link token; button URL https://<your domain>/portal/login/{{1}}"). Patient API payload must include `managed_by_patient_id`, `consent_given_at`, `consent_version` (check `PatientController::show`/profile endpoint and add if missing, with test).

- [ ] **Step 1:** implement per the list, matching existing components (inline two-step confirm pattern, badges, toasts). **Step 2:** build passes; PHP suite green. **Step 3: Commit** `feat(portal-admin): finalize prescriptions, portal links, family and portal settings`

---

### Task 8: Portal SPA shell, login, consent, home

**Files:** `vite.config.js` (input `resources/js/portal/main.jsx`), `resources/views/portal.blade.php` (`@vite(['resources/css/app.css','resources/js/portal/main.jsx'])`, `<div id="portal-root">`, viewport meta, theme-color), `routes/web.php` (`Route::view('/portal/{any?}', 'portal')->where('any', '.*');`), create under `resources/js/portal/`: `main.jsx` (`BrowserRouter basename="/portal"`), `api.js` (axios `baseURL: '/api/portal'`, bearer from `localStorage.portal_token`, `X-Patient-Id` from `localStorage.portal_profile`; 401 → clear both + `location.assign('/portal/login')`; 428 → navigate `/consent`), `session.jsx` (context: `me`, `refresh()`, `setProfile(id)`, `logout()`), `App.jsx` routes, `components/Shell.jsx` (max-w-md, header: clinic logo/name, profile name, clinic switcher bottom sheet when `clinics.length > 1` → `POST auth/switch-clinic` → store token → reload; logout; bottom nav Home `/`, Visits `/visits`, Rx `/prescriptions`, Book `/book`, Family `/family`; accent from `clinic.primary_color`), pages `Login.jsx` (steps phone → code → choose; code input `inputMode="numeric"` `autoComplete="one-time-code"`; resend after 60 s), `MagicLink.jsx` (`/login/:token`), `Consent.jsx`, `Home.jsx` (next appointment card, quick actions, counts). Add a PHP test that `GET /portal` and `GET /portal/visits` return 200 HTML containing `portal-root`.

- [ ] **Step 1:** implement. **Step 2:** build passes; PHP suite green. **Step 3: Commit** `feat(portal-ui): portal shell, sign-in, consent and home`

---

### Task 9: Portal SPA feature pages

**Files (resources/js/portal/pages):** `Visits.jsx` (All/Upcoming/Past chips, cards with doctor/date/time/status pill, "Portal · awaiting confirmation" for pending portal bookings), `VisitDetail.jsx` (`/visits/:id`: details, Maps link `https://www.google.com/maps/search/?api=1&query=<address>` when address present, cancel with optional reason (inline confirm), Reschedule button, blocked reason text when not allowed, "View prescription" when `has_final_prescription`, "Book follow-up" → `/book?doctor_id=&visit_type=followup`), `Reschedule.jsx` (`/visits/:id/reschedule`: 14-day date strip bounded by `max_advance_booking_days` via slots 422, slot grid, submit; 409 → message and refresh slots), `Book.jsx` (doctor cards → date strip → slots → visit type/mode (modes from doctor) → reason → submit → `/visits/:id` with "Request sent — the clinic will confirm"; honours `?doctor_id=&visit_type=` presets; 409/422 messages shown), `Prescriptions.jsx`, `PrescriptionDetail.jsx` (medicines table from `data`, advice/notes, Download PDF via blob fetch with auth header, "Book follow-up"), `Family.jsx` (profiles with relation labels, "Viewing" marker, Switch → `setProfile` → home; Add member form name/dob/gender). All pages handle loading/empty/error states.

- [ ] **Step 1:** implement. **Step 2:** build passes; PHP suite green. **Step 3: Commit** `feat(portal-ui): visits, booking, prescriptions and family pages`

---

### Task 10: End-to-end verification

- [ ] `php artisan test` green; build passes.
- [ ] Back up MySQL `clinic_new` (MAMP mysqldump) to `.superpowers/backups/clinic_new-backup-<ts>.sql`, confirm non-empty, then `php artisan migrate:fresh --seed`.
- [ ] Serve on 8010; create doctor + schedule + patient (phone) as the demo clinic admin. WhatsApp is unconfigured and codes are stored hashed, so sign in with the magic link: staff "Send portal link" → copy URL → open → consent → home. Separately verify the request-code screen shows the generic message and creates a `login_otp` WhatsApp row `skipped`.
- [ ] Portal: book → pending in staff list with "Portal" label; staff confirm → booking_confirmed WhatsApp row; portal cancel/reschedule within/outside cutoff; add family member, switch profile (consent prompt for the new profile); finalize a prescription in staff UI → visible in portal, PDF downloads; draft invisible.
- [ ] Screenshots under `.superpowers/sdd/2026-09-27-patient-portal/e2e/`. Commit fix-ups only.
