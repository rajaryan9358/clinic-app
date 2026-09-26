# WhatsApp Sending & Notifications (E1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Patients get WhatsApp template messages from one platform number for booking confirmation, reminder, reschedule/cancel and prescription (plus an OTP sender for E2), sent by queued jobs, logged per clinic, with delivery status from Meta's webhook.

**Architecture:** A `WhatsAppGateway` interface (Meta Cloud API implementation ported from new-clinic `apps/api/src/whatsapp/whatsapp.service.ts`, plus a fake) configured from encrypted platform settings; a `PatientNotifier` that writes a `whatsapp_messages` row and dispatches a queued `SendWhatsAppTemplate` job; triggers in `AppointmentService` and an `AppointmentPrescription` model event; a `whatsapp:send-reminders` command every 15 minutes; a signature-verified webhook updating statuses.

**Tech Stack:** Laravel 13 (PHP 8.4 at `/opt/homebrew/bin/php`), `Illuminate\Support\Facades\Http`, database queue, barryvdh/laravel-dompdf (already used for prescription PDFs), React 19 admin SPA.

**Spec:** `docs/superpowers/specs/2026-09-27-whatsapp-notifications-design.md`

## Global Constraints

- `php` → `/opt/homebrew/bin/php`; `npm` → `PATH=$HOME/.nvm/versions/node/v22.14.0/bin:$PATH npm ...` (">500 kB chunk" warning pre-existing).
- Notification types: `booking_confirmed`, `appointment_reminder`, `appointment_updated`, `prescription_ready`, `login_otp`. Template mapping setting key `whatsapp_templates` (JSON) with `{name, language, enabled}` per type; default name = the type, language `en`, enabled true.
- Settings keys (encrypted via `App\Support\PlatformSettings`): `whatsapp_phone_number_id`, `whatsapp_waba_id`, `whatsapp_access_token` (write-only), `whatsapp_app_secret` (write-only), `whatsapp_webhook_verify_token` (write-only), `whatsapp_graph_version` (default `v21.0`). Configured = phone number id + access token set.
- Body parameter order (exact): booking_confirmed & appointment_reminder: patient name, clinic name, doctor name, date `D, d M Y` (e.g. `Mon, 29 Sep 2026`), time `g:i A` (e.g. `10:30 AM`). appointment_updated: patient name, clinic name, status line (`has been rescheduled to` | `has been cancelled`), date, time. prescription_ready: document header (PDF link, filename `prescription-<appointment id>.pdf`) + body patient name, clinic name, doctor name. login_otp: body code + button (sub_type `url`, index 0) parameter code.
- `whatsapp_messages.direction` enum values are `incoming`/`outgoing` (use `outgoing`); `delivery_status` enum gains `skipped`.
- Webhook: POST requires a valid `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret); no secret configured → 401 (no insecure mode). Status moves forward only: queued < sent < delivered < read; failed allowed from queued/sent.
- Tests: `/opt/homebrew/bin/php artisan test` (SQLite in-memory; queue `sync` in tests), pristine. Bind the fake with `$this->app->instance(WhatsAppGateway::class, $fake)`.
- Never stage the root PDF, `.playwright-mcp/`, `.superpowers/`. Commit messages end with a blank line then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `whatsapp-notifications`.

## Review Focus

1. **A booking whose transaction rolls back** sends nothing (no row, no job). Test: Task 3 `test_rolled_back_booking_sends_nothing`.
2. **Phone formats** (`98765 43210`, `+91-98765-43210`, `09876543210`, `919876543210`) all normalise to `919876543210`; a too-short number is treated as no phone (row skipped). Test: Task 1 `PhoneNumberTest`.
3. **The reminder job running twice / overlapping** never double-sends; a cancelled or rescheduled-past appointment isn't reminded. Test: Task 4 `test_reminder_is_sent_once_and_skips_cancelled`.
4. **A webhook status arriving out of order** (read before delivered, delivered after failed) never moves a message backwards. Test: Task 5 `test_status_moves_forward_only`.
5. **WhatsApp not configured (local dev)** — booking, reschedule, prescription and reminders all still succeed; rows are `skipped / WhatsApp not configured`. Test: Task 3 `test_not_configured_marks_rows_skipped_and_booking_succeeds`.

---

## File Structure

**Create:** `app/Services/WhatsApp/{WhatsAppGateway.php, MetaWhatsAppGateway.php, FakeWhatsAppGateway.php, PhoneNumber.php, TemplateSettings.php, PatientNotifier.php}`, `app/Jobs/SendWhatsAppTemplate.php`, `app/Console/Commands/SendWhatsAppReminders.php`, `app/Http/Controllers/Api/WhatsAppWebhookController.php`, `app/Http/Controllers/Api/PublicPrescriptionPdfController.php`, `app/Services/PrescriptionPdfRenderer.php`, `tests/Feature/WhatsApp/*`.
**Delete:** `app/Models/WhatsappAccount.php`, `app/Models/WhatsappTemplate.php`, clinic + super-admin `WhatsappAccountController.php` and `WhatsappTemplateController.php`.
**Modify:** `database/migrations/2026_03_29_000500_create_whatsapp_tables.php`, `database/migrations/2026_03_29_000600_create_settings_billing_and_logs_tables.php` (clinic_settings.reminder_hours_before), `app/Models/WhatsappMessage.php`, `app/Models/ClinicSetting.php`, `app/Http/Controllers/Api/SuperAdmin/SystemSettingController.php`, `app/Providers/AppServiceProvider.php`, `app/Services/AppointmentService.php`, `app/Models/AppointmentPrescription.php`, `app/Http/Controllers/Api/{Clinic,SuperAdmin}/AppointmentController.php`, `routes/api.php`, `routes/console.php`, frontend files in Tasks 6.

---

### Task 1: Gateway, settings, phone normaliser, schema cleanup

**Files:** create `WhatsAppGateway.php`, `MetaWhatsAppGateway.php`, `FakeWhatsAppGateway.php`, `PhoneNumber.php`, `TemplateSettings.php`; modify migrations, `WhatsappMessage.php`, `ClinicSetting.php`, `SystemSettingController.php`, `AppServiceProvider.php`, `routes/api.php`; delete the account/template models and 4 controllers. Tests: `tests/Feature/WhatsApp/{PhoneNumberTest, WhatsAppSettingsTest, MetaGatewayTest}.php`.

**Interfaces — Produces:**
```php
interface WhatsAppGateway {
    public function isConfigured(): bool;
    /** @return string provider message id (wamid) */
    public function sendTemplate(string $to, string $templateName, string $language, array $components): string;
    /** @return array{ok: bool, message: ?string} */
    public function testConnection(): array;
    public function verifySignature(string $rawBody, ?string $signatureHeader): bool;
}
final class PhoneNumber { public static function normalise(?string $raw): ?string; } // digits with country code, or null when unusable (< 10 digits)
final class TemplateSettings {
    public const TYPES = ['booking_confirmed','appointment_reminder','appointment_updated','prescription_ready','login_otp'];
    /** @return array{name: string, language: string, enabled: bool} */
    public static function for(string $type): array;
    public static function all(): array;              // type => entry, defaults filled
    public static function save(array $entries): void; // validates types
}
```
`FakeWhatsAppGateway` public props: `bool $configured = true`, `?\Throwable $throw = null`, `array $sent = []` (each `['to','template','language','components']`), `bool $signatureValid = true`; `sendTemplate` returns `'wamid.fake.'.count($this->sent)`.

- [ ] **Step 1: Failing tests**

```php
// tests/Feature/WhatsApp/PhoneNumberTest.php
namespace Tests\Feature\WhatsApp;
use App\Services\WhatsApp\PhoneNumber;
use Tests\TestCase;
class PhoneNumberTest extends TestCase
{
    public function test_normalises_indian_formats(): void
    {
        foreach (['98765 43210', '+91-98765-43210', '09876543210', '919876543210', '+91 9876543210'] as $raw) {
            $this->assertSame('919876543210', PhoneNumber::normalise($raw), $raw);
        }
        $this->assertSame('14155552671', PhoneNumber::normalise('+1 415 555 2671'));
        $this->assertNull(PhoneNumber::normalise('12345'));
        $this->assertNull(PhoneNumber::normalise(null));
        $this->assertNull(PhoneNumber::normalise(''));
    }
}
```
Rule: strip non-digits; if the original started with `+` keep digits as-is; else drop a single leading `0`; a 10-digit result gets `91` prepended; result < 10 digits → null.

`WhatsAppSettingsTest` (super admin, RolesAndPermissionsSeeder): POST `/api/super-admin/settings/system` with the six whatsapp keys + `whatsapp_templates` (e.g. booking_confirmed name `appt_confirm_v2`, language `en_US`, enabled false) → 200; GET returns `whatsapp_phone_number_id`, `whatsapp_waba_id`, `whatsapp_graph_version`, `whatsapp_access_token_set: true`, `whatsapp_app_secret_set: true`, `whatsapp_webhook_verify_token_set: true`, `whatsapp_webhook_url` ending `/api/webhooks/whatsapp`, `whatsapp_templates.booking_confirmed.name == 'appt_confirm_v2'`, all five types present; response contains none of the secret values; blank secret on a later POST keeps the stored one; unknown template type → 422. `POST /api/super-admin/settings/whatsapp/test` with the fake bound → `{ok:true}`; fake unconfigured → `{ok:false, message:'WhatsApp is not configured.'}`. `GET /api/clinic/whatsapp/accounts` and `GET /api/super-admin/whatsapp/templates` → 404.

`MetaGatewayTest`: with settings set, `Http::fake(['graph.facebook.com/*' => Http::response(['messages' => [['id' => 'wamid.X']]], 200)])`; `sendTemplate('919876543210','booking_confirmed','en',[['type'=>'body','parameters'=>[['type'=>'text','text'=>'A']]]])` returns `'wamid.X'`; `Http::assertSent` checks URL `https://graph.facebook.com/v21.0/<phone id>/messages`, bearer token, JSON `messaging_product=whatsapp`, `type=template`, `template.name`, `template.language.code`, `template.components`. A 400 response → throws `RuntimeException` containing the status. `verifySignature(body, 'sha256='.hash_hmac('sha256', body, secret))` true; wrong → false; no secret configured → false.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Schema** — in `2026_03_29_000500_create_whatsapp_tables.php`: delete the `whatsapp_accounts` and `whatsapp_templates` create blocks (and their dropIfExists), remove any FK to them (`whatsapp_account_id` columns on conversations etc. → delete the line), in `whatsapp_messages` replace `template_id` with `$table->string('template_name')->nullable();` and add `$table->string('notification_type')->nullable();`, and add `'skipped'` to the `delivery_status` enum. In clinic_settings add `$table->unsignedInteger('reminder_hours_before')->default(24);`. `ClinicSetting` fillable/casts + `validationRules()` gets `'reminder_hours_before' => ['sometimes','integer','min:0','max:168']`. `WhatsappMessage` fillable: swap `template_id` → `template_name`, add `notification_type`. Grep and fix every reference to the removed models/columns (`grep -rn "WhatsappAccount\|WhatsappTemplate\|whatsapp_account_id\|template_id" app database routes`), including `WhatsappConversation` relations and the `whatsappConversations` controllers.

- [ ] **Step 4: Gateway + helpers**

```php
// app/Services/WhatsApp/MetaWhatsAppGateway.php
namespace App\Services\WhatsApp;

use App\Support\PlatformSettings;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class MetaWhatsAppGateway implements WhatsAppGateway
{
    private function setting(string $key, mixed $default = null): mixed { return PlatformSettings::get($key, $default); }
    private function base(): string { return 'https://graph.facebook.com/'.$this->setting('whatsapp_graph_version', 'v21.0'); }

    public function isConfigured(): bool
    {
        return filled($this->setting('whatsapp_phone_number_id')) && filled($this->setting('whatsapp_access_token'));
    }

    public function sendTemplate(string $to, string $templateName, string $language, array $components): string
    {
        if (! $this->isConfigured()) {
            throw new RuntimeException('WhatsApp is not configured.');
        }
        $res = Http::withToken((string) $this->setting('whatsapp_access_token'))
            ->acceptJson()->timeout(15)
            ->post($this->base().'/'.$this->setting('whatsapp_phone_number_id').'/messages', [
                'messaging_product' => 'whatsapp',
                'to' => $to,
                'type' => 'template',
                'template' => ['name' => $templateName, 'language' => ['code' => $language], 'components' => $components],
            ]);
        if (! $res->successful()) {
            throw new RuntimeException("WhatsApp API rejected the message ({$res->status()}): ".mb_substr($res->body(), 0, 300));
        }
        $id = $res->json('messages.0.id');
        if (! $id) {
            throw new RuntimeException('WhatsApp API returned no message id.');
        }

        return (string) $id;
    }

    public function testConnection(): array
    {
        if (! $this->isConfigured()) {
            return ['ok' => false, 'message' => 'WhatsApp is not configured.'];
        }
        $res = Http::withToken((string) $this->setting('whatsapp_access_token'))->acceptJson()->timeout(10)
            ->get($this->base().'/'.$this->setting('whatsapp_phone_number_id'), ['fields' => 'id']);

        return $res->successful() ? ['ok' => true, 'message' => null]
            : ['ok' => false, 'message' => "Meta returned {$res->status()}: ".mb_substr($res->body(), 0, 200)];
    }

    public function verifySignature(string $rawBody, ?string $signatureHeader): bool
    {
        $secret = (string) $this->setting('whatsapp_app_secret', '');
        if ($secret === '' || ! $signatureHeader || ! str_starts_with($signatureHeader, 'sha256=')) {
            return false;
        }

        return hash_equals(hash_hmac('sha256', $rawBody, $secret), substr($signatureHeader, 7));
    }
}
```
`FakeWhatsAppGateway` implements the same (`sendTemplate` throws `$this->throw` when set, throws `RuntimeException('WhatsApp is not configured.')` when `!$configured`, else records and returns the wamid). Bind `WhatsAppGateway::class => MetaWhatsAppGateway::class` in `AppServiceProvider::register`.

`TemplateSettings::all()` merges defaults with `PlatformSettings::get('whatsapp_templates', [])`; `save()` rejects unknown types with `ValidationException` (`whatsapp_templates` key), coerces `enabled` to bool, requires non-empty `name` (max 100, `^[a-z0-9_]+$`) and `language` (max 10).

- [ ] **Step 5: Settings API** — `SystemSettingController` payload adds `whatsapp_phone_number_id`, `whatsapp_waba_id`, `whatsapp_graph_version`, `whatsapp_access_token_set`, `whatsapp_app_secret_set`, `whatsapp_webhook_verify_token_set`, `whatsapp_webhook_url` (`rtrim(config('app.url'),'/').'/api/webhooks/whatsapp'`), `whatsapp_templates` (`TemplateSettings::all()`); validation: ids/version `nullable|string|max:100`, secrets `nullable|string|max:500` (saved only when non-empty), `whatsapp_templates` `sometimes|array`. Add route `POST settings/whatsapp/test` (super admin) → `$gateway->testConnection()` wrapped in `success()`. Remove the whatsapp accounts/templates routes and delete their controllers.

- [ ] **Step 6: PASS; full suite green** (fix any existing test that referenced the removed models/routes — list them in the report).
- [ ] **Step 7: Commit** `feat(whatsapp): platform WhatsApp gateway, settings and template mapping`

---

### Task 2: Notifier, queued job, prescription PDF link

**Files:** create `PatientNotifier.php`, `app/Jobs/SendWhatsAppTemplate.php`, `app/Services/PrescriptionPdfRenderer.php`, `app/Http/Controllers/Api/PublicPrescriptionPdfController.php`; modify Clinic + SuperAdmin `AppointmentController::prescriptionPdf` (use the renderer), `routes/api.php`. Test: `tests/Feature/WhatsApp/NotifierTest.php`.

**Interfaces — Produces:**
```php
class PatientNotifier {
    public function bookingConfirmed(Appointment $a): WhatsappMessage;
    public function appointmentUpdated(Appointment $a, string $change): WhatsappMessage; // 'rescheduled'|'cancelled'
    public function appointmentReminder(Appointment $a, ?ReminderLog $log = null): WhatsappMessage;
    public function prescriptionReady(AppointmentPrescription $rx): WhatsappMessage;
    public function loginOtp(string $phone, string $code, ?int $clinicId = null): WhatsappMessage;
}
class SendWhatsAppTemplate implements ShouldQueue { public function __construct(public int $messageId) {} public int $tries = 3; public array $backoff = [30, 120, 600]; }
class PrescriptionPdfRenderer { public function render(Appointment $appointment): \Barryvdh\DomPDF\PDF; }
```
Components are stored on the row in `payload_json` (`['template' => name, 'language' => lang, 'components' => [...]]`) so the job just replays them.

- [ ] **Step 1: Failing tests** (`NotifierTest`, fake gateway bound, queue sync): create clinic "Sunrise Clinic", doctor "Dr Asha Rao", patient "Ravi Kumar" phone `9876543210`, appointment 2026-09-29 10:30.
  - `bookingConfirmed` → row: clinic/patient/appointment ids, direction `outgoing`, message_type `template`, notification_type `booking_confirmed`, template_name `booking_confirmed`, to_phone `919876543210`, delivery_status `sent`, provider_message_id `wamid.fake.1`; fake `sent[0]` components body parameters exactly `['Ravi Kumar','Sunrise Clinic','Dr Asha Rao','Mon, 29 Sep 2026','10:30 AM']`; content_text contains `Sunrise Clinic`.
  - `appointmentUpdated(…,'cancelled')` status line `has been cancelled`; `'rescheduled'` → `has been rescheduled to`.
  - `prescriptionReady` → header component type `header` with `document.link` a URL containing `/api/public/prescriptions/` and `signature=`, `document.filename` `prescription-<appointment id>.pdf`; body params patient, clinic, doctor.
  - `loginOtp('+91 98765 43210','482913')` → body param `482913` and a `button` component `sub_type url, index "0"` with the code.
  - Disabled template (TemplateSettings enabled false) → row `skipped`, error `template disabled`, nothing sent.
  - Patient phone null / `123` → row `skipped`, error `no phone number`.
  - Fake unconfigured → row `skipped`, error `WhatsApp not configured`.
  - Fake throws `RuntimeException('boom')` → job fails; after running the job's `failed()` path the row is `failed` with error `boom` (call `$job->failed(new RuntimeException('boom'))` directly, and assert `handle()` rethrows so the queue retries).
  - Signed PDF: GET the `document.link` URL → 200 `application/pdf`; the same path without signature → 403; `$this->travel(8)->days()` then the signed URL → 403.
- [ ] **Step 2: FAIL → Step 3: implement.** `PatientNotifier` builds the row then `SendWhatsAppTemplate::dispatch($row->id)->afterCommit()`; skip rows are created with `skipped` and not dispatched (except "not configured", which the job decides so late configuration still works: the notifier dispatches; the job checks `isConfigured()` first and marks `skipped / WhatsApp not configured` without throwing). Dates: `Carbon::parse($a->appointment_date->toDateString().' '.$a->start_time)->format('D, d M Y')` / `format('g:i A')`. The job: load row; if status isn't `queued` return (idempotent); send; update `provider_message_id`, `delivery_status=sent`; mirror to a `reminder_logs` row whose `provider_message_id` is null and `id` = `payload_json.reminder_log_id` when present (`sent_at`, `delivery_status`, `provider_message_id`). `failed(Throwable $e)` marks row + linked reminder log `failed` with `mb_substr($e->getMessage(),0,500)`. Signed route: `Route::get('public/prescriptions/{prescription}/pdf', PublicPrescriptionPdfController::class)->name('whatsapp.prescription-pdf')->middleware('signed')` outside auth groups; controller loads the prescription's appointment and streams `PrescriptionPdfRenderer::render($appointment)->stream(...)`. Move the existing PDF building from `prescriptionPdf` into the renderer (both controllers call it; keep their responses identical).
- [ ] **Step 4: PASS; suite green → Step 5: Commit** `feat(whatsapp): patient notifier, queued sends and signed prescription link`

---

### Task 3: Triggers

**Files:** modify `app/Services/AppointmentService.php` (create, reschedule, changeStatus), `app/Models/AppointmentPrescription.php` (booted created hook), Clinic + SuperAdmin `AppointmentController` (new `sendPrescription`), `routes/api.php`. Test: `tests/Feature/WhatsApp/TriggerTest.php`.

**Interfaces:** Consumes `PatientNotifier`. Produces `POST /api/clinic/appointments/{id}/prescription/send` (`perm:appointments.prescribe`) and `POST /api/super-admin/appointments/{id}/prescription/send` → 200 `data: whatsapp message row`; 404 when no prescription; 422 `Patient has no phone number.` when the patient has no usable phone.

- [ ] **Step 1: Failing tests** — through the HTTP API as a receptionist/clinic admin (see tests/Feature/AppointmentBookingTest.php for booking payloads): booking creates one `booking_confirmed` row; reschedule (`POST appointments/{id}/reschedule`) creates one `appointment_updated` row with status line `has been rescheduled to` and the NEW date/time; lifecycle to `cancelled` creates `appointment_updated` with `has been cancelled`; other lifecycle changes (checked_in, completed) create nothing; `AppointmentPrescription::create([...])` creates `prescription_ready`; manual send endpoint → 200 and a second `prescription_ready` row; manual send with no prescription → 404; patient without phone → 422. `test_rolled_back_booking_sends_nothing`: inside `DB::transaction` create via `AppointmentService::create` then throw → zero rows, zero sends. `test_not_configured_marks_rows_skipped_and_booking_succeeds`: fake unconfigured → booking 201, row `skipped`.
- [ ] **Step 2: FAIL → Step 3: implement.** Call the notifier at the end of each service method (after the DB work; `afterCommit` on the job keeps rollbacks silent — also wrap the notifier call itself in `DB::afterCommit(fn () => ...)` so no row is written for rolled-back work). `AppointmentPrescription::booted()`: `static::created(fn ($rx) => DB::afterCommit(fn () => app(PatientNotifier::class)->prescriptionReady($rx)))`. Notifier exceptions must never break the booking: wrap notifier calls in try/catch → `Log::warning`.
- [ ] **Step 4: PASS; suite green (existing appointment tests must still pass) → Step 5: Commit** `feat(whatsapp): send confirmations, updates and prescriptions on appointment events`

---

### Task 4: Reminder command

**Files:** create `app/Console/Commands/SendWhatsAppReminders.php`; modify `routes/console.php`. Test: `tests/Feature/WhatsApp/ReminderTest.php`.

**Interfaces:** Produces artisan `whatsapp:send-reminders`, scheduled `->everyFifteenMinutes()->withoutOverlapping()`.

- [ ] **Step 1: Failing tests** — freeze time (`$this->travelTo('2026-09-28 10:00')`); clinic reminder_hours_before 24; appointments: A 2026-09-29 09:00 confirmed (due), B 2026-09-29 12:00 (not yet due: 26h away), C 2026-09-28 18:00 cancelled (skip), D 2026-09-28 09:00 (past: skip), E due but patient without phone (reminder_logs row + message `skipped`). Run → exactly one send (A) + E skipped; reminder_logs rows for A (channel `whatsapp`, reminder_type `appointment_reminder`, delivery_status `sent`, provider id) and E. Run again → no new sends/rows (`test_reminder_is_sent_once_and_skips_cancelled`). Clinic with reminder_hours_before 0 → nothing. Travel to 2026-09-28 13:00 → B now due, sent once.
- [ ] **Step 2: FAIL → Step 3: implement.** Query appointments joined to clinic_settings; filter status in (pending, confirmed); compute start datetime in PHP per candidate within `[now, now + hours]` (prefilter `appointment_date` between today and today + ceil(hours/24)+1); skip when a reminder_logs row exists for (appointment_id, `appointment_reminder`); create the log (`scheduled_for` = start − hours, `delivery_status` `queued`) then `appointmentReminder($a, $log)` (the notifier stores `reminder_log_id` in payload_json). Clinics without a clinic_settings row use 24.
- [ ] **Step 4: PASS → Step 5: Commit** `feat(whatsapp): scheduled appointment reminders`

---

### Task 5: Delivery-status webhook

**Files:** create `app/Http/Controllers/Api/WhatsAppWebhookController.php`; modify `routes/api.php` (public `GET|POST webhooks/whatsapp`). Test: `tests/Feature/WhatsApp/WebhookTest.php`.

- [ ] **Step 1: Failing tests** — handshake: `GET /api/webhooks/whatsapp?hub_mode=subscribe&hub_verify_token=<setting>&hub_challenge=123` → 200 body `123` (text/plain); wrong token → 403. POST with fake `signatureValid=false` → 401; with no app secret and the real gateway → 401. Status payload (Meta shape: `entry[0].changes[0].value.statuses[0] = {id, status, timestamp, errors?}`): for a row `sent` with provider id `wamid.1`: `delivered` → delivered; then `read` → read; then `delivered` again → stays read (`test_status_moves_forward_only`); a `failed` on a `sent` row → failed with `error_message` = `errors[0].title`; `failed` after `read` → stays read; linked reminder_logs row mirrors each change; unknown id → 200, nothing changes; payload with only `messages[]` → 200.
- [ ] **Step 2: FAIL → Step 3: implement** (read raw body with `$request->getContent()`; rank map `['queued'=>0,'sent'=>1,'delivered'=>2,'read'=>3]`; failed allowed when current rank ≤ 1). Always return `response()->json(['ok' => true])` after processing.
- [ ] **Step 4: PASS → Step 5: Commit** `feat(whatsapp): delivery status webhook`

---

### Task 6: Admin UI

**Files:** `resources/js/admin/src/pages/workflows/SystemSettingsPage.jsx` (WhatsApp tab), `pages/workflows/ClinicDetailPage.jsx` (remove WhatsApp account section; add "Reminder hours before" to Settings tab), `config/modules.js` (remove `whatsappAccounts`, `whatsappTemplates`; add `reminder_hours_before` to clinicSettings form; add `notification_type` + `delivery_status` columns to `whatsappMessages`), `components/AppointmentDetailDrawer.jsx` (WhatsApp messages line), `pages/workflows/PrescriptionPage.jsx` ("Send to patient" button), plus any nav/access references to the removed modules.

Contracts: settings GET/POST fields from Task 1; `POST /super-admin/settings/whatsapp/test`; clinic `GET /clinic/whatsapp/messages?appointment_id=<id>` (existing CRUD list; ensure `appointment_id` is filterable — add it to the controller's `$filterable` if missing, with a test); `POST {base}/appointments/{id}/prescription/send`.

- [ ] **Step 1:** WhatsApp tab: Phone Number ID, WABA ID, Graph version, Access Token / App Secret / Verify Token (password inputs, "Saved — leave blank to keep" placeholder when *_set), webhook URL with Copy, "Test connection" button showing the result, and a template table (Type label, Template name, Language, Enabled toggle) with a help line per type listing its category and parameter order (from Global Constraints). Save sends only non-empty secrets.
- [ ] **Step 2:** Remove the clinic WhatsApp account UI and modules; add "Reminder hours before (0 = off)" number field (0-168) to both clinic settings forms.
- [ ] **Step 3:** Appointment drawer: fetch `GET {base}/whatsapp/messages?appointment_id=…` when `can('whatsapp.view')` (super admin: skip) and list type + status badge + time; hide when empty. Prescription page: "Send to patient" (needs `appointments.prescribe`), shows success or the API message.
- [ ] **Step 4:** Build passes; `grep -rn "whatsappAccounts\|whatsappTemplates\|whatsapp/accounts\|whatsapp/templates" resources/js/admin/src` empty; PHP suite green.
- [ ] **Step 5: Commit** `feat(whatsapp-ui): WhatsApp settings, reminder hours, message status and prescription send`

---

### Task 7: End-to-end verification

- [ ] `/opt/homebrew/bin/php artisan test` green, pristine; grep for removed models empty.
- [ ] MySQL (start MAMP if down), `mysqldump clinic_new` to `.superpowers/backups/clinic_new-backup-<ts>.sql` (non-empty) before `migrate:fresh --seed`.
- [ ] `php artisan schedule:list` shows `whatsapp:send-reminders` every 15 min.
- [ ] Serve on 8010, run `php artisan queue:work --stop-when-empty` after actions. Unconfigured flow: book an appointment as the demo clinic admin → a `booking_confirmed` row `skipped / WhatsApp not configured`; configure dummy settings + `Http` pointed nowhere is not possible in the browser — instead verify via tinker with the Fake bound that a send records `sent`. Browser: System Settings → WhatsApp tab saves and masks; Test connection shows "not configured"/error; clinic Settings shows Reminder hours; appointment drawer shows the WhatsApp line; prescription page shows Send to patient.
- [ ] If Meta test credentials are provided in `.env`-free form by the user, do one real send; otherwise report "real send not exercised — no Meta credentials".
- [ ] Commit fix-ups only.
