# WhatsApp Sending & Notifications (E1) — Design

Date: 2026-09-27
Status: Approved in chat
Roadmap: E1 of the new-clinic adoption (E1 WhatsApp → E2 patient portal → E3 waitlist → E4 invoices + online payment)

## Goal

Patients receive WhatsApp messages from one platform WhatsApp number for booking confirmation, reminder, reschedule/cancellation, prescription, and (for E2) login OTP. Messages use Meta-approved templates, are sent by queued jobs, are logged per clinic, and their delivery status is tracked through Meta's webhook. Ported from new-clinic's Meta Cloud API client (`apps/api/src/whatsapp/whatsapp.service.ts`), adapted to templates and our Laravel stack.

## Decisions (from chat)

| Question | Decision |
|---|---|
| Format | Approved templates only (utility + one authentication template). No free text. |
| Sender | Platform number only (super admin config). Per-clinic WhatsApp accounts are removed from the UI and API. Messages name the clinic. |
| Reminder timing | Per-clinic `reminder_hours_before` (default 24, 0 = off); due-check every 15 minutes. |
| Delivery status | Yes — Meta webhook, signature-verified. |
| Out of scope | Inbound chat / conversational booking bot, marketing broadcasts, per-clinic numbers, SMS. |

## 1. Configuration

**System settings** (encrypted via `PlatformSettings`): `whatsapp_phone_number_id`, `whatsapp_waba_id`, `whatsapp_access_token` (write-only), `whatsapp_app_secret` (write-only), `whatsapp_webhook_verify_token` (write-only), `whatsapp_graph_version` (default `v21.0`).
WhatsApp is **configured** when phone number id and access token are set.

**Template mapping** — system setting `whatsapp_templates` (JSON), one entry per type:
```json
{
  "booking_confirmed":   {"name": "booking_confirmed",   "language": "en", "enabled": true},
  "appointment_reminder":{"name": "appointment_reminder","language": "en", "enabled": true},
  "appointment_updated": {"name": "appointment_updated", "language": "en", "enabled": true},
  "prescription_ready":  {"name": "prescription_ready",  "language": "en", "enabled": true},
  "login_otp":           {"name": "login_otp",           "language": "en", "enabled": true}
}
```
Body parameters (positional, in this order — the super admin creates the templates in Meta with matching `{{1}}…{{n}}`):

| Type | Category | Parameters |
|---|---|---|
| booking_confirmed | utility | 1 patient name, 2 clinic name, 3 doctor name, 4 date (e.g. `Mon, 29 Sep 2026`), 5 time (e.g. `10:30 AM`) |
| appointment_reminder | utility | same as booking_confirmed |
| appointment_updated | utility | 1 patient name, 2 clinic name, 3 status line (`has been rescheduled to` / `has been cancelled`), 4 date, 5 time |
| prescription_ready | utility | header: document (PDF link, filename `prescription-<appointment id>.pdf`); body: 1 patient name, 2 clinic name, 3 doctor name |
| login_otp | authentication | body 1 code; URL button parameter = code (Meta's authentication template format) |

Super admin UI: **System Settings → WhatsApp** tab — the connection fields (secrets shown as "Saved — leave blank to keep"), webhook URL to copy (`{APP_URL}/api/webhooks/whatsapp`), a **Test connection** button (`GET {graph}/{phone_number_id}?fields=id`), and the template mapping table (type, template name, language, enabled). A help note lists each template's category and parameters.

**Clinic setting**: `clinic_settings.reminder_hours_before` unsigned int default 24 (0 disables). Shown in Clinic Settings (super admin clinic detail Settings tab and the clinic's own settings form).

**Removed**: per-clinic WhatsApp account — the Clinic Settings "WhatsApp account" section (ClinicDetailPage), clinic and super-admin `whatsapp/accounts` routes/controllers, and the `whatsappAccounts` frontend module. The `whatsapp_accounts` table and model are dropped (edit migration in place; schema rebuilt with migrate:fresh). `whatsapp_templates` table/model/routes/module are also dropped (templates now live in the platform setting). `whatsapp_messages`, `whatsapp_conversations` stay; `whatsapp_messages.template_id` is replaced by `template_name` (string) and gains `notification_type` (string, null).

## 2. Sending

`App\Services\WhatsApp\WhatsAppGateway` interface:
```php
public function isConfigured(): bool;
/** @return string provider message id */
public function sendTemplate(string $to, string $templateName, string $language, array $components): string;
public function testConnection(): array; // ['ok' => bool, 'message' => ?string]
public function verifySignature(string $rawBody, ?string $signatureHeader): bool;
```
`MetaWhatsAppGateway` (HTTP via Laravel `Http`, POST `{graph}/{phone_number_id}/messages` with `messaging_product=whatsapp, to, type=template, template{name, language{code}, components}`), `FakeWhatsAppGateway` for tests. Phone numbers normalised to digits with country code (Indian 10-digit numbers → `91` prefix; leading `+`/`0` stripped).

`App\Services\WhatsApp\PatientNotifier`:
- `bookingConfirmed(Appointment)`, `appointmentUpdated(Appointment, string $change /* rescheduled|cancelled */)`, `appointmentReminder(Appointment)`, `prescriptionReady(AppointmentPrescription)`, `loginOtp(string $phone, string $code, ?int $clinicId)`.
- Each creates a `whatsapp_messages` row (direction `outbound`, message_type `template`, notification_type, template_name, clinic/patient/appointment ids, `to_phone`, `content_text` = rendered preview, `delivery_status` `queued`) and dispatches `SendWhatsAppTemplate` (queued job) with the row id.
- Skips with a row in status `skipped` and `error_message`: template type disabled (`template disabled`), patient without phone (`no phone number`). When WhatsApp isn't configured the job marks the row `skipped` / `WhatsApp not configured` (so local dev works).

`SendWhatsAppTemplate` job: `tries = 3`, `backoff = [30, 120, 600]`; calls the gateway; on success sets `provider_message_id`, `delivery_status = sent`; on final failure `failed` + `error_message`. Queue connection stays `database`; tests use `sync`.

Prescription PDF link: `URL::temporarySignedRoute('whatsapp.prescription-pdf', now()->addDays(7), ['prescription' => id])` → `GET /api/public/prescriptions/{prescription}/pdf` (signed middleware, no auth) renders the same PDF as the clinic prescription PDF endpoint (extract the rendering into a reusable method/service).

## 3. Triggers

- `AppointmentService::create` → after commit, `bookingConfirmed`.
- `AppointmentService::reschedule` → after commit, `appointmentUpdated(…, 'rescheduled')`.
- `AppointmentService::changeStatus` to `cancelled` → after commit, `appointmentUpdated(…, 'cancelled')`.
- `AppointmentPrescription` `created` model event → `prescriptionReady`. Manual resend: `POST /api/clinic/appointments/{id}/prescription/send` (perm `appointments.prescribe`) and super-admin equivalent; 404 when the appointment has no prescription; 422 when the patient has no phone.
- Reminders: command `whatsapp:send-reminders`, scheduled every 15 minutes. Selects appointments with status in (pending, confirmed), `appointment_date + start_time` between now and now + `reminder_hours_before` hours, clinic `reminder_hours_before > 0`, patient has phone, and no `reminder_logs` row with `reminder_type = 'appointment_reminder'`. Creates the reminder_logs row (`channel whatsapp`, `scheduled_for`, `delivery_status queued`) and calls `appointmentReminder`. Idempotent: one reminder per appointment.
- `loginOtp` is exposed for E2; no caller in E1.
- Dispatching uses `DB::afterCommit` so rolled-back bookings send nothing.

## 4. Delivery status webhook

- `GET /api/webhooks/whatsapp` — Meta handshake: when `hub_mode=subscribe` and `hub_verify_token` equals the setting, return `hub_challenge` as plain text 200; else 403.
- `POST /api/webhooks/whatsapp` — verify `X-Hub-Signature-256` against the app secret (401 when the secret is set and the signature is wrong; when no secret is configured, reject with 401 too — no insecure mode). Process `entry[].changes[].value.statuses[]`: find `whatsapp_messages` by `provider_message_id`; move status forward only (`sent` < `delivered` < `read`; `failed` from any non-terminal state, recording `errors[0].title`); mirror into the linked `reminder_logs` row (matched by appointment + reminder type + provider id). Unknown ids and inbound `messages[]` are ignored with 200.

## 5. Where it shows

- Existing Reminders module (reminder_logs) and WhatsApp messages list show status; add `notification_type` and `delivery_status` columns to the WhatsApp messages list (clinic `whatsapp.view`).
- Appointment detail drawer: a small "WhatsApp" line listing messages for that appointment with status.
- Prescription page: "Send to patient" button (appointments.prescribe).

## 6. Testing

Feature tests with `FakeWhatsAppGateway` (records sends; can be set unconfigured or to throw):
- Settings save/mask (secrets never returned), test connection via fake.
- Each trigger creates the right row and sends the right template name/language/parameters (create, reschedule, cancel, prescription created, manual resend).
- Skips: no phone, disabled template, not configured (row `skipped`, no send).
- Job retry/failure marks `failed`.
- Reminder command: sends only due, non-cancelled, not-yet-reminded appointments; respects `reminder_hours_before` (incl. 0 = off); second run sends nothing.
- Webhook: handshake ok/forbidden; bad signature 401; status progression forward-only; failed recorded; reminder_logs mirrored; unknown id 200.
- Signed prescription PDF URL works; unsigned/expired → 403.
- Rolled-back booking sends nothing.
- Clinic `whatsapp/accounts` and `whatsapp/templates` routes return 404.
A real test-mode send is done manually once Meta test credentials are provided.
