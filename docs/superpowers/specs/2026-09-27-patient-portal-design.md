# Patient Portal Core (E2) — Design

Date: 2026-09-27
Status: Approved in chat
Roadmap: E2 of the new-clinic adoption (E1 WhatsApp ✅ → **E2 patient portal** → E3 waitlist → E4 invoices + online payment)
Source: new-clinic `apps/staff-web/src/app/portal/**`, `apps/api/src/patient-auth`, `apps/api/src/patient-portal`

## Goal

Patients sign in to a mobile-first portal at `/portal` with a WhatsApp code (or a staff-sent magic link), and for the clinic they belong to can: give consent, see their dashboard, list/view/book/reschedule/cancel appointments, view and download finalized prescriptions, and manage family profiles. Ported from new-clinic, adapted to this Laravel/React stack.

**Out of scope:** lab reports and report uploads, waitlist (E3), invoices/online payment (E4), AI chat, video calls, insurance, prescription QR verification, AI prescription summary, editing prescription content.

## Decisions (from chat)

| Question | Decision |
|---|---|
| Prescription visibility | New Draft/Final status. Doctors finalize; the portal shows finalized prescriptions only; "Send to patient" requires final. |
| Family | Both: managed dependents (`patients.managed_by_patient_id`) **and** staff-created `patient_family_links` (one-directional: `patient_id` may act for `related_patient_id`). |
| Portal booking status | `pending`; staff confirm. Confirming a portal booking sends the booking-confirmed WhatsApp. |
| Cancel/reschedule cutoff | Per clinic `portal_change_cutoff_hours`, default 2, 0 = any time before start. |
| Magic link | Staff "Send portal link": WhatsApp template `portal_link` + copyable link; single use; 7 days. |
| Availability | Per clinic `portal_enabled`, default on. |
| Session | Sanctum personal access tokens on `Patient` (approach A). |

## 1. Authentication & access

**Identity.** Patients remain per-clinic rows. The login identity is a phone number; an *account-holder* row is a patient with `managed_by_patient_id IS NULL`, not soft-deleted, in a clinic with `portal_enabled = true`. Phones are compared after `App\Services\WhatsApp\PhoneNumber::normalise` (stored phones are normalised on the fly for matching; no data migration).

**Request code** — `POST /api/portal/auth/request-code {phone}`:
- Always responds 200 `{"message": "If this number is registered, a code has been sent."}` (no enumeration).
- When at least one account-holder row matches: generate a 6-digit code (`random_int`), store in `login_otps` (`phone_or_email` = normalised phone, `purpose = 'login'`, `otp_code` = sha256 hash, `expires_at` = now + 10 min, `clinic_id` null) and call `PatientNotifier::loginOtp($phone, $code, $clinicIdOfFirstMatch)`.
- Throttles: per phone 1 per 60 s and 5 per hour (checked against `login_otps`; excess → 429 `Too many code requests. Try again later.`); per IP via Laravel rate limiter `portal-otp` 20/hour.
- `login_otps` gains `attempts` (unsigned tinyint default 0); `otp_code` widened to 64 chars.

**Verify** — `POST /api/portal/auth/verify {phone, code, patient_id?}`:
- Uses the latest unconsumed, unexpired `login` OTP for the phone. Wrong code → attempts+1, 422 `Incorrect code.`; at 5 attempts the code is dead (422 `Too many attempts. Request a new code.`). Missing/expired → 422 `Code expired. Request a new code.`
- Correct code: collect account-holder rows for the phone. If exactly one, or `patient_id` names one of them → mark OTP `verified_at`, issue token, return `{token, account}`. If several and no `patient_id` → return `{needs_selection: true, choices: [{patient_id, patient_name, clinic_id, clinic_name}]}` **without** consuming the code. A `patient_id` not in the list → 422.

**Magic link.** New table `patient_login_links` (`id, clinic_id, patient_id, token_hash (sha256, unique), expires_at, consumed_at, created_by_user_id, created_at`). Staff endpoint `POST /api/clinic/patients/{id}/portal-link` (perm `patients.portal_link`) creates a link (token = 40 random chars, 7 days), sends WhatsApp `portal_link` via `PatientNotifier::portalLink(Patient, string $url)`, and returns `{url, whatsapp_message}`; the patient must be an account holder (dependents → 422 `Send the link to the account holder.`). URL: `{APP_URL}/portal/login/{token}`. Exchange: `POST /api/portal/auth/link {token}` → `{token, account}`; used/expired/unknown → 422 `This link has expired.`; clinic portal disabled → 422 same message.

**Tokens.** `Patient` uses `HasApiTokens`; tokens are named `portal`, ability `portal`, expire after 30 days (set `expires_at` on creation). Middleware `portal.auth` (new): requires a Sanctum token whose tokenable is a `Patient` (a staff `User` token → 401), the patient not soft-deleted, and its clinic `portal_enabled` → else 401 `Session expired. Please sign in again.` Staff middleware must reject patient tokens (verify `auth:sanctum` + existing role middleware already do; add a test).

**Profiles.** The token's patient is the *account*. The *acting profile* is chosen per request by header `X-Patient-Id` (default: the account). Allowed profiles (same clinic only):
1. the account itself;
2. patients with `managed_by_patient_id = account.id`;
3. `patient_family_links.related_patient_id` where `patient_id = account.id`;
4. other account-holder rows with the same normalised phone in the same clinic.
Anything else → 403 `You can't view this profile.` The resolved profile is bound as `request()->attributes->get('portal_patient')`; the account as `portal_account`.

**Auth endpoints** (under `portal.auth`): `GET /api/portal/auth/me` → `{account, profiles: [{id, name, dob, relation: self|dependent|family|same_phone}], clinics: [{patient_id, clinic_id, clinic_name, patient_name}], clinic: {id, name, logo_url, primary_color, address, phone}}`; `POST /api/portal/auth/switch-clinic {patient_id}` — target must be an account-holder row with the account's phone at a portal-enabled clinic → new token (old revoked); `POST /api/portal/auth/logout` → revoke current token.

## 2. Portal features (all under `/api/portal`, `portal.auth`, acting profile = P)

**Consent.** `patients.consent_given_at` (timestamp null), `patients.consent_version` (string null). `App\Support\PortalConsent::VERSION = '2026-09-v1'` and `TEXT` (new-clinic's notice without "lab reports"). `GET /consent` → `{version, text, given_at, current: bool}`; `POST /consent` → stamps now + VERSION on P, sets `communication_consent = true`. Every other portal feature endpoint returns 428 `{code: "consent_required"}` until P has `consent_version === VERSION` (auth endpoints and `/consent` exempt). Consent is per profile.

**Dashboard.** `GET /dashboard` → `{next_appointment | null, upcoming_count, finalized_prescriptions_count}`.

**Appointments.**
- `GET /appointments?filter=all|upcoming|past` — P's appointments (upcoming = status pending/confirmed/checked_in/in_consultation and start ≥ now; past = the rest), newest first for past, soonest first for upcoming. Item: `{id, date, start_time, end_time, status, visit_type, consultation_mode, booking_channel, doctor {id, name, specialization}, can_change: bool, change_blocked_reason: ?string}`.
- `GET /appointments/{id}` — P's only (else 404); adds clinic address/Maps URL, `cancellation_reason`, `has_final_prescription`.
- `POST /appointments/{id}/cancel {reason?}` and `POST /appointments/{id}/reschedule {appointment_date, start_time}` — allowed when status ∈ {pending, confirmed} and start − now ≥ `portal_change_cutoff_hours` (or cutoff 0 and start > now); else 422 `Changes are closed for this visit. Please call the clinic.` Cancel uses `AppointmentService::changeStatus(…, CANCELLED, actorUserId: null, reason, source: 'patient')`; reschedule uses `AppointmentService::reschedule(…)` then sets status `pending` (portal reschedules need staff confirmation), status log source `patient`. Slot taken → 409 `That slot was just taken. Please pick another.`
- `GET /doctors` — active doctors of P's clinic `{id, name, specialization, consultation_modes}`; `GET /doctors/{id}/slots?date=YYYY-MM-DD` — free slots for that date via `AppointmentService::getDoctorAvailability` (dates in the past or > 60 days ahead → 422).
- `POST /appointments {doctor_id, appointment_date, start_time, visit_type: new|followup, consultation_mode, reason?}` → `AppointmentService::create` with `patient_id = P`, `status = pending`, `booking_channel = 'portal'`, status-log source `patient`, notes = reason; **no** booking-confirmed WhatsApp at creation. Conflict → 409 as above; plan limit → 422 `The clinic can't take online bookings right now. Please call the clinic.`
- `AppointmentService` gains an optional `source` (default `staff`) for status/reschedule logs, and `create` skips `bookingConfirmed` when `booking_channel = 'portal'`. `changeStatus` to `confirmed` from `pending` on a `portal` appointment sends `bookingConfirmed`.
- Migration: `appointments.booking_channel` enum adds `portal` (edit in place).

**Prescriptions.** `GET /prescriptions` — P's appointments' latest **final** prescription each: `{id, appointment_id, date, doctor_name, medicines: [names]}`. `GET /prescriptions/{id}` — P's, final only (else 404): structured `data` plus doctor/clinic/date. `GET /prescriptions/{id}/pdf` — streams `PrescriptionPdfRenderer` output for that prescription (renderer gains a way to render a specific prescription rather than "latest").

**Family.** `GET /family` → the allowed-profile list (§1). `POST /family {full_name, dob?, gender?}` — creates a patient in the account's clinic with `managed_by_patient_id = account.id` (always the account, even when acting as someone else), `phone = account.phone`, consent null → returns the profile.

## 3. Staff side

- **Prescription status.** `appointment_prescriptions`: `status` enum draft|final default draft, `finalized_at`, `finalized_by_user_id` (edit migration in place). `POST {clinic,super-admin}/appointments/{id}/prescription/finalize` (perm `appointments.prescribe`) finalizes the latest draft (no draft → 422). Final rows are immutable (no endpoint edits them; recording again creates a new draft). "Latest final" is what the portal, `sendPrescription` and `prescriptionPdf` use when one exists; the staff prescription page shows the latest row with a Draft/Final badge and a Finalize button. `sendPrescription` → 422 `Finalize the prescription first.` when the latest prescription is a draft or there is no final one.
- **Patient page.** "Send portal link" (perm `patients.portal_link`, added to the catalogue and to clinic_admin/staff defaults) showing the URL with Copy and the WhatsApp status. Family card: "Managed by" patient picker (same clinic, account holders only, not self; clears with null) via the existing patient update with `managed_by_patient_id` validated; existing family links listed with "can use this patient's portal". Consent line "Consent given {date} (v{version})" or "Not given".
- **Clinic settings.** `clinic_settings.portal_enabled` bool default true, `portal_change_cutoff_hours` unsigned int default 2 (0–72), in both settings forms.
- **Appointments UI.** Channel label "Portal" and a Channel filter on the appointments list.
- **WhatsApp.** `TemplateSettings::TYPES` adds `portal_link` (default name `portal_link`, en, enabled); utility; body 1 patient name, 2 clinic name; URL button parameter = link token. Help line in the WhatsApp settings table.

## 4. Portal frontend

Second Vite entry `resources/js/portal/main.jsx`, blade `portal.blade.php`, `Route::view('/portal/{any?}', 'portal')`, `BrowserRouter basename="/portal"`, axios client with `portal_token` in localStorage and `X-Patient-Id` from the selected profile; 401 → clear token → `/login`; 428 → consent screen. Mobile-width shell (`max-w-md`), header with clinic logo/name + clinic switcher sheet + logout, bottom nav Home · Visits · Rx · Book · Family, clinic `primary_color` as accent.
Pages: Login (phone → code → choose record), Magic link `/login/:token`, Consent, Home, Visits (filter chips, cards), Visit detail (cancel with reason, reschedule, maps link, "Book follow-up"), Reschedule (date strip + slots), Book (doctor → date → slot → visit type/mode → reason; `?doctor_id=&visit_type=followup` preset), Prescriptions list/detail with Download PDF, Family (profiles, Switch, Add member).

## 5. Errors

Standard `{success, message, errors?}` envelope. 401 invalid/expired token or clinic portal disabled; 403 profile not allowed; 404 other patients' records; 409 slot conflict; 422 validation/cutoff/plan limit/finalize; 428 consent required; 429 code throttling.

## 6. Testing

Feature tests: request-code (non-enumerating reply, throttles, disabled clinic, dependents never matched); verify (expiry, 5 attempts, wrong code, multi-record selection without consuming, invalid patient_id); magic link (single use, expiry, dependent refused, disabled clinic); token isolation (patient token on staff routes → 401/403, staff token on portal → 401); profiles (each of the 4 rules allowed, a same-clinic stranger → 403, other clinic → 403); consent gate + version bump; dashboard; appointments list filters; detail 404 for others; book (pending, channel portal, no WhatsApp, conflict 409, plan limit 422); confirm by staff sends booking_confirmed for portal only; cancel/reschedule (cutoff 422, statuses, reschedule → pending, WhatsApp updated message); prescriptions final-only list/detail/PDF, drafts hidden; staff finalize + send requires final; family add dependent; switch-clinic; portal_link template send. E2E in the browser against the local server after backing up the dev DB.
