# Invoices & Online Payment (E4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff raise an itemised invoice for a visit, take cash/UPI/card at the counter or send a WhatsApp pay-link, and the patient pays online from the portal with Razorpay; invoice and appointment payment state stay correct through payment, refund and cancellation.

**Architecture:** An `InvoiceService` owns the invoice lifecycle (draft, issue with a locked per-clinic number, cancel) and recomputes derived state — invoice status, `appointments.payment_status` and the appointment's money columns — inside the same transaction as every payment, refund, issue and cancel. A `PatientPaymentService` wraps Razorpay **Orders** for one-off patient payments; the browser callback and the `payment.captured` webhook both settle the same payment row idempotently on its unique `razorpay_payment_id`. Thin controllers and UI sit on top, following the Clinic/SuperAdmin controller-pair and portal-presenter conventions already in the codebase.

**Tech Stack:** Laravel 13, PHP 8.4, Sanctum, Spatie permissions, DomPDF, Razorpay (Orders API), React 19 + Vite + Tailwind 4, PHPUnit (SQLite in-memory).

**Spec:** `docs/superpowers/specs/2026-10-16-invoices-payments-design.md`

## Global Constraints

- Tests `php artisan test`; frontend build `node node_modules/vite/bin/vite.js build`. Both must be green before every commit.
- Money columns stay `decimal(12,2)` rupees. Convert to paise only at the Razorpay boundary: `(int) round($amount * 100)`. Never send a float to the gateway.
- **Edit in place** (these tables have no production rows): `database/migrations/2026_03_29_000600_create_settings_billing_and_logs_tables.php` for the `payments`/`invoices`/`clinic_settings` column additions. **New migration** `database/migrations/2026_10_16_000100_create_invoice_items_and_counters_table.php`. Never migrate a real database except in Task 10 after a backup.
- Invoice statuses: `draft`, `issued`, `paid`, `cancelled` — do not add to the enum. "Partly paid" is derived (`issued` and `amount_paid < total_amount`). `appointments.payment_status` uses the existing `unpaid|partial|paid|waived`; `waived` is staff-set and never overwritten by recomputation.
- Invoice number format `{prefix}/{period}/{number padded to 5}`, e.g. `INV/2026-27/00042`. Period is the April–March financial year. Allocated at issue only, under `lockForUpdate`, never reused.
- Settings defaults when no `clinic_settings` row exists: invoicing on, online payment **off**, prefix `INV`, tax percent 0. Online payment also requires `RazorpayGateway::isConfigured()`.
- Messages (exact): 422 `Only a draft invoice can be edited.` · 422 `This invoice has already been issued.` · 422 `Refund the payments before cancelling this invoice.` · 422 `That is more than the amount outstanding.` · 422 `The discount cannot be more than the subtotal.` · 422 `Online payment is not available at this clinic.` · 409 `This payment has already been recorded.`
- Staff permissions: read `billing.view`; create/issue/record payment `billing.create`; cancel/refund `billing.edit`. All four already exist in `PermissionCatalogue`; receptionists already hold them.
- Cross-clinic access returns **404**, never 403. `BelongsToClinicScope` is only a `forClinic()` helper — scope every query explicitly.
- WhatsApp type `invoice_ready`; body params in order `[patient full_name, clinic name, invoice_number, total formatted ₹1,234.00, due wording]`; URL button param = login-link token. Login link via `PortalLinkService::issueForRedirect` with `redirect_path = '/invoices/{invoiceId}?profile={patientId}'` for the account holder (`managed_by_patient_id ?? patient`).
- The PDF is headed "Invoice", or "Receipt" when fully paid. It must never say "Tax Invoice".
- Commits: stage named files only; never stage `Clinic_Management_System_MVP_PRD.pdf`, `.playwright-mcp/`, `.superpowers/`, `public/build`. Trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Review Focus

1. A patient tapping Pay in two tabs, and the webhook landing while `/confirm` is in flight, must leave exactly one `success` payment and one charge — `test_confirm_and_webhook_settle_the_same_payment_once` (Task 4).
2. A replayed `payment.captured` for a payment id already recorded must change nothing — `test_replayed_capture_is_a_no_op` (Task 4).
3. Two invoices issued concurrently in one clinic must not collide on a number, and a rolled-back issue must not silently burn one — `test_concurrent_issue_allocates_distinct_numbers` (Task 2).
4. Refunding a payment on a fully paid invoice must drop it back to `issued` and the appointment to `partial`/`unpaid`, without touching a `waived` appointment — `test_refund_recomputes_invoice_and_appointment_state` (Task 3).
5. Another clinic's invoice must 404 on every staff and portal route including the PDF, and a dependent's invoice must notify the account holder with the dependent's profile in the redirect — `test_other_clinic_invoice_is_404_everywhere` (Task 5), `test_dependent_invoice_notifies_the_account_holder` (Task 6).

---

### Task 1: Schema, models and clinic settings

**Files:**
- Modify: `database/migrations/2026_03_29_000600_create_settings_billing_and_logs_tables.php` — `payments.payment_method` enum gains `online`; `payments` gains `razorpay_order_id` string null + index, `razorpay_payment_id` string null unique, `refunded_at` timestamp null, `refund_reason` string null; `invoices` gains `issued_at` timestamp null, `cancelled_at` timestamp null, `cancelled_reason` string null, `created_by_user_id` FK users nullOnDelete; `clinic_settings` gains `invoicing_enabled` bool default true, `online_payment_enabled` bool default false, `invoice_prefix` string(10) default `INV`, `invoice_tax_percent` decimal(5,2) default 0, `invoice_footer_note` string(500) null
- Create: `database/migrations/2026_10_16_000100_create_invoice_items_and_counters_table.php`, `app/Models/InvoiceItem.php`, `app/Models/InvoiceCounter.php`
- Modify: `app/Models/Invoice.php` (fillable/casts for the new columns; relations `items`, `payments`, `patient`, `appointment`, `clinic`; `scopeActive` excluding cancelled), `app/Models/Payment.php` (new fillable/casts, relation `invoice`), `app/Models/ClinicSetting.php` (fillable, casts, `validationRules`)
- Test: `tests/Feature/Billing/InvoiceSchemaTest.php`

**Interfaces — Produces:**
```php
// invoice_items: id, invoice_id FK cascade, service_id FK nullOnDelete, description string,
//   quantity unsigned int default 1, unit_amount decimal(12,2), amount decimal(12,2), sort_order unsigned int
// invoice_counters: id, clinic_id FK cascade, period string(9), next_number unsigned int default 1,
//   unique (clinic_id, period)
Invoice::items(): HasMany; Invoice::payments(): HasMany;
ClinicSetting::validationRules() // + invoicing_enabled, online_payment_enabled boolean;
                                 //   invoice_prefix string max:10; invoice_tax_percent numeric 0–100;
                                 //   invoice_footer_note string max:500 nullable
```

- [ ] **Step 1: Write the failing tests** in `tests/Feature/Billing/InvoiceSchemaTest.php`: `test_invoice_items_and_counters_tables_exist_with_their_columns`; `test_payment_accepts_the_online_method_and_gateway_ids`; `test_razorpay_payment_id_is_unique` (second insert of the same id throws); `test_clinic_settings_defaults_when_no_row` (invoicing on, online payment off, prefix `INV`, tax 0); `test_invoice_tax_percent_rejects_101_and_accepts_100` (422 / ok through the settings endpoint).
- [ ] **Step 2: Run `php artisan test tests/Feature/Billing/InvoiceSchemaTest.php` — expect FAIL (no such table/column).**
- [ ] **Step 3: Implement the migration edits, the new migration and the model changes.**
- [ ] **Step 4: Run the file, then `php artisan test` — all green.**
- [ ] **Step 5: Commit** `feat(billing): invoice items, counters, payment gateway columns and settings`

---

### Task 2: InvoiceService — drafting, totals and issuing

**Files:**
- Create: `app/Services/Billing/InvoiceService.php`
- Test: `tests/Feature/Billing/InvoiceServiceTest.php`, `tests/Feature/Billing/BillingTestHelpers.php` (clinic + doctor + service + patient + appointment fixtures, mirroring `tests/Feature/Waitlist/WaitlistTestHelpers.php`)

**Interfaces — Produces:**
```php
final class InvoiceService {
    /** @param array{patient_id:int, appointment_id?:int, invoice_date?:string, discount_amount?:float,
     *               tax_amount?:float, notes?:string, items:array<int, array{description:string,
     *               service_id?:int, quantity:int, unit_amount:float}>} $data */
    public function draft(int $clinicId, array $data, ?int $userId = null): Invoice;
    public function update(Invoice $invoice, array $data): Invoice;   // draft only
    public function issue(Invoice $invoice): Invoice;                  // allocates the number
    public function cancel(Invoice $invoice, ?string $reason = null): Invoice;
    public function prefillFor(Appointment $appointment): array;       // [{description, service_id, quantity, unit_amount}]
    public static function financialYear(CarbonInterface $date): string; // '2026-27'
}
```
Totals: `subtotal` = Σ `quantity × unit_amount`; `tax_amount` = caller's value when given, else `round(($subtotal - $discount) * $percent / 100, 2)`; `total_amount` = `subtotal - discount + tax`. Numbering: inside `DB::transaction`, `InvoiceCounter::firstOrCreate(clinic, period)` then `lockForUpdate()`, take `next_number`, increment, format `{prefix}/{period}/{str_pad(n,5,'0',STR_PAD_LEFT)}`. `prefillFor` suggests one line for the appointment's service (`Service.fee`) and one for the doctor's `consultation_fee`/`followup_fee` chosen by `visit_type`, skipping either when it is null or zero.

- [ ] **Step 1: Write the failing tests:** `test_draft_computes_subtotal_tax_and_total` (2 items, 10% clinic tax, discount — assert exact decimals); `test_explicit_tax_amount_overrides_the_clinic_percent`; `test_discount_above_subtotal_is_422` (exact message); `test_issue_allocates_the_first_number_of_the_financial_year` (`INV/2026-27/00001`, `issued_at` set); `test_second_invoice_gets_the_next_number`; `test_numbers_are_per_clinic`; `test_issuing_twice_is_422` (exact message); `test_editing_an_issued_invoice_is_422` (exact message); `test_cancel_keeps_the_number`; `test_prefill_suggests_service_and_doctor_fee_lines`; **`test_concurrent_issue_allocates_distinct_numbers`** — two `issue()` calls in nested transactions (or sequential calls with the counter row pre-locked) yield different numbers and `next_number` advances by exactly 2.
- [ ] **Step 2: Run the file — expect FAIL (class not found).**
- [ ] **Step 3: Implement `InvoiceService`.**
- [ ] **Step 4: Run the file, then `php artisan test` — all green.**
- [ ] **Step 5: Commit** `feat(billing): invoice drafting, totals and numbering`

---

### Task 3: Counter payments, refunds and derived state

**Files:**
- Modify: `app/Services/Billing/InvoiceService.php` (`recordPayment`, `markRefunded`, `syncState`)
- Test: `tests/Feature/Billing/InvoicePaymentTest.php`

**Interfaces — Produces:**
```php
public function recordPayment(Invoice $invoice, array $data, ?int $userId = null): Payment;
// $data: amount float, payment_method 'cash'|'upi'|'card'|'bank_transfer'|'other',
//        reference_number?, paid_at?, notes?
public function markRefunded(Payment $payment, string $reason): Payment;
public function syncState(Invoice $invoice): void;  // invoice status + appointment columns, call inside the txn
public function amountPaid(Invoice $invoice): float; // Σ success payments
```
`syncState`: `paid` when `amountPaid >= total_amount`, else `issued` (never touches `draft`/`cancelled`). When the invoice has an appointment: `payment_status` = `paid` / `partial` / `unpaid`, left alone when it is `waived`; `appointment_fee`, `discount_amount`, `final_amount` mirror subtotal/discount/total.

- [ ] **Step 1: Write the failing tests:** `test_full_payment_marks_invoice_paid_and_appointment_paid`; `test_part_payment_leaves_invoice_issued_and_appointment_partial`; `test_overpayment_is_422` (exact message); `test_payment_against_a_draft_invoice_is_422`; `test_payment_against_a_cancelled_invoice_is_422`; **`test_refund_recomputes_invoice_and_appointment_state`** (fully paid → refund → `issued` + appointment `unpaid`; part-refund of two payments → `partial`); `test_waived_appointment_is_never_overwritten`; `test_cancel_with_a_successful_payment_is_422` (exact message); `test_issue_mirrors_money_onto_the_appointment`.
- [ ] **Step 2: Run the file — expect FAIL (method not found).**
- [ ] **Step 3: Implement the three methods; every mutation runs in one `DB::transaction` with the invoice row locked.**
- [ ] **Step 4: Run the file, then `php artisan test` — all green.**
- [ ] **Step 5: Commit** `feat(billing): counter payments, refunds and derived invoice state`

---

### Task 4: Razorpay orders, online payment and the webhook branch

**Files:**
- Modify: `app/Services/Billing/RazorpayGateway.php`, `app/Services/Billing/RazorpayApiGateway.php`, `app/Services/Billing/FakeRazorpayGateway.php`, `app/Http/Controllers/Api/RazorpayWebhookController.php`
- Create: `app/Services/Billing/PatientPaymentService.php`, `app/Services/Billing/PatientPaymentWebhookHandler.php`
- Test: `tests/Feature/Billing/OnlinePaymentTest.php`

**Interfaces — Produces:**
```php
// RazorpayGateway (+ both implementations)
public function createOrder(int $amountInPaise, string $receipt, array $notes): array; // ['id' => 'order_...']
public function verifyOrderSignature(string $orderId, string $paymentId, string $signature): bool;

final class PatientPaymentService {
    /** @return array{order_id:string, amount:float, currency:string, key_id:string, invoice_number:string} */
    public function startOrder(Invoice $invoice): array;   // 422 when online payment is off/unconfigured
    public function confirm(Invoice $invoice, string $orderId, string $paymentId, string $signature): Payment;
    public function settleFromWebhook(array $paymentEntity): ?Payment;
}
```
`startOrder` reuses an existing `pending` online payment for the same outstanding amount instead of creating a second order. `confirm` verifies the signature, checks the order's amount matches the payment row, then settles. Both settle paths run inside `DB::transaction` with the invoice locked, resolve by `razorpay_payment_id`, and return the existing row untouched when that id is already recorded. `notes` carries `invoice_id` and `clinic_id`. The webhook controller routes an event to `PatientPaymentWebhookHandler` when its payment entity's `order_id` matches a `payments.razorpay_order_id` or `notes.invoice_id` is present; everything else keeps going to the subscription handler unchanged.

- [ ] **Step 1: Write the failing tests:** `test_start_order_creates_a_pending_payment_for_the_outstanding_amount` (amount in paise on the fake); `test_start_order_reuses_the_pending_order`; `test_start_order_is_422_when_online_payment_is_disabled` (exact message); `test_start_order_is_422_when_the_gateway_is_unconfigured`; `test_confirm_with_a_bad_signature_leaves_the_payment_pending`; `test_confirm_rejects_an_amount_that_does_not_match`; `test_confirm_settles_and_marks_the_invoice_paid`; **`test_confirm_and_webhook_settle_the_same_payment_once`**; **`test_replayed_capture_is_a_no_op`**; `test_webhook_for_an_unknown_order_is_ignored`; `test_subscription_webhooks_still_reach_the_subscription_handler`.
- [ ] **Step 2: Run the file — expect FAIL (method not found).**
- [ ] **Step 3: Implement the gateway methods, both services and the controller branch.**
- [ ] **Step 4: Run the file, then `php artisan test` — all green.**
- [ ] **Step 5: Commit** `feat(billing): razorpay orders, online payment and webhook routing`

---

### Task 5: Staff API

**Files:**
- Create: `app/Http/Controllers/Api/Clinic/InvoiceController.php`, `app/Http/Controllers/Api/SuperAdmin/InvoiceController.php`, `app/Support/Billing/InvoicePresenter.php`
- Modify: `routes/api.php`, Clinic + SuperAdmin `AppointmentController::detail` (add `invoice: ?{id, number, status, total, balance}`)
- Test: `tests/Feature/Billing/StaffInvoiceTest.php`

**Interfaces — Produces:** routes under the clinic group — `GET invoices?patient_id=&appointment_id=&status=&from=&to=&q=` (`perm:billing.view`, paginated, each item `{id, invoice_number, invoice_date, patient{id,full_name,phone}, status, total_amount, amount_paid, balance}`); `POST invoices`, `PUT invoices/{id}`, `POST invoices/{id}/issue`, `POST invoices/{id}/payments` (`perm:billing.create`); `POST invoices/{id}/cancel`, `POST payments/{id}/refund` (`perm:billing.edit`); `GET invoices/{id}` (detail with `items` and `payments`); `GET appointments/{id}/invoice-prefill`. SuperAdmin twins take/filter `clinic_id`. `InvoicePresenter::item(Invoice): array` and `::detail(Invoice): array` are shared by both controllers and Task 7 — no duplicated response-building.

- [ ] **Step 1: Write the failing tests:** one per route for the happy path; `test_list_filters_by_status_and_date_range`; `test_list_reports_amount_paid_and_balance`; `test_receptionist_can_create_but_a_doctor_without_billing_create_is_403`; `test_cancel_requires_billing_edit`; **`test_other_clinic_invoice_is_404_everywhere`** (detail, update, issue, payments, cancel — the PDF and send routes arrive in Task 6 and are covered there); `test_super_admin_lists_across_clinics_and_filters_by_clinic_id`; `test_appointment_detail_carries_the_invoice_summary`; `test_prefill_returns_service_and_doctor_fee_lines`.
- [ ] **Step 2: Run the file — expect FAIL (404 route).**
- [ ] **Step 3: Implement the controllers, presenter and routes.**
- [ ] **Step 4: Run the file, then `php artisan test` — all green.**
- [ ] **Step 5: Commit** `feat(billing): staff invoice endpoints`

---

### Task 6: Invoice PDF and the WhatsApp pay-link

**Files:**
- Create: `app/Services/InvoicePdfRenderer.php`, `resources/views/reports/invoice.blade.php`
- Modify: `app/Services/WhatsApp/TemplateSettings.php` (TYPES + DEFAULTS `invoice_ready`), `app/Services/WhatsApp/PatientNotifier.php` (`invoiceReady`), `app/Http/Controllers/Api/Clinic/InvoiceController.php` + SuperAdmin twin (`pdf`, `send`), `routes/api.php`
- Test: `tests/Feature/Billing/InvoiceDocumentTest.php`, extend `tests/Feature/WhatsApp/NotifierTest.php`

**Interfaces — Produces:**
```php
class InvoicePdfRenderer { public function render(Invoice $invoice): PdfDocument; }
PatientNotifier::invoiceReady(Invoice $invoice, string $token): WhatsappMessage;
// GET invoices/{id}/pdf  → application/pdf
// POST invoices/{id}/send → 200; issues the redirect login link and sends invoice_ready
```
Follow `PrescriptionPdfRenderer` and the prescription blade for structure and styling.

- [ ] **Step 1: Write the failing tests:** `test_pdf_streams_for_an_issued_invoice_and_lists_items_and_payments`; `test_pdf_says_receipt_when_fully_paid_and_invoice_otherwise`; `test_pdf_never_says_tax_invoice`; `test_send_creates_the_login_link_with_the_invoice_redirect_path`; `test_invoice_ready_sends_the_five_body_params_in_order_with_the_token_button`; **`test_dependent_invoice_notifies_the_account_holder`** (holder's phone, `?profile={dependentId}` in the redirect); `test_another_clinics_invoice_is_404_on_pdf_and_send`.

The spec's optional `payment_received` template is **not** in this plan — add it later if wanted; nothing here depends on it.
- [ ] **Step 2: Run the file — expect FAIL.**
- [ ] **Step 3: Implement the renderer, blade, template type, notifier method and the two endpoints.**
- [ ] **Step 4: Run the file, then `php artisan test` — all green.**
- [ ] **Step 5: Commit** `feat(billing): invoice pdf and whatsapp pay-link`

---

### Task 7: Portal API

**Files:**
- Create: `app/Http/Controllers/Api/Portal/InvoiceController.php`
- Modify: `routes/api.php`
- Test: `tests/Feature/Portal/PortalInvoiceTest.php`

**Interfaces — Produces:** under `portal.auth` + `portal.consent`, scoped to the acting profile exactly as `Api/Portal/PrescriptionController` is — `GET invoices` (issued/paid only, newest first), `GET invoices/{id}`, `GET invoices/{id}/pdf`, `POST invoices/{id}/pay` → `startOrder` payload, `POST invoices/{id}/confirm` `{razorpay_order_id, razorpay_payment_id, razorpay_signature}` → updated invoice detail.

- [ ] **Step 1: Write the failing tests:** `test_list_shows_only_issued_and_paid_invoices_for_the_acting_profile`; `test_draft_and_cancelled_invoices_are_404`; `test_another_profiles_invoice_is_404`; `test_without_consent_every_invoice_route_is_428`; `test_pay_returns_the_order_payload`; `test_pay_is_404_when_online_payment_is_off`; `test_confirm_settles_the_payment_and_returns_the_paid_invoice`; `test_acting_as_a_dependent_lists_the_dependents_invoices`.
- [ ] **Step 2: Run the file — expect FAIL (404 route).**
- [ ] **Step 3: Implement the controller and routes, reusing `InvoicePresenter`.**
- [ ] **Step 4: Run the file, then `php artisan test` — all green.**
- [ ] **Step 5: Commit** `feat(billing): portal invoice and payment endpoints`

---

### Task 8: Staff UI

**Files (resources/js/admin/src):** new `pages/workflows/BillingPage.jsx` (route + nav entry "Billing" under Operations, gated `billing.view`; filters patient/status/date range; table with number, patient, date, total, paid, balance, status; outstanding total) and `pages/workflows/InvoiceDetailPage.jsx` (items editor with service picker and free-text lines, discount, tax, notes; Issue, Cancel, Record payment, Refund, Download PDF, Send on WhatsApp — actions hidden by permission and by status); modify `components/AppointmentDetailDrawer.jsx` (invoice line or "Raise invoice"), `pages/workflows/ClinicDetailPage.jsx` + `config/modules.js` clinicSettings (the five new fields; online payment shows why it is unavailable when the gateway is unconfigured), `SystemSettingsPage.jsx` (help line for `invoice_ready`: "Utility · body: 1 patient, 2 clinic, 3 invoice number, 4 amount, 5 due wording · URL button {{1}} = link token").

Reset page state on filter/route change, guard stale responses, surface API messages verbatim.

- [ ] **Step 1: Implement. Step 2: build passes; `php artisan test` green. Step 3: Commit** `feat(billing-ui): staff billing pages, drawer line and settings`

---

### Task 9: Portal UI

**Files (resources/js/portal):** new `pages/Invoices.jsx` (list: number, date, total, status chip, Pay when there is a balance) and `pages/InvoiceDetail.jsx` (items, totals, payment history, Pay now, Download PDF); modify `App.jsx` (routes `/invoices`, `/invoices/:id`), the bottom nav, and `pages/MagicLink.jsx`/`session.jsx` only if the `?profile=` redirect needs it (E3 already handles it). Razorpay Checkout is loaded from `https://checkout.razorpay.com/v1/checkout.js` on demand and opened with the order from `/pay`, posting back to `/confirm`; a dismissed or failed checkout leaves the invoice untouched and says so. Double-submit prevention and stale-response guards as in the existing pages.

- [ ] **Step 1: Implement. Step 2: build passes; `php artisan test` green. Step 3: Commit** `feat(billing-ui): portal invoices and online payment`

---

### Task 10: End-to-end verification

- [ ] `php artisan test` green; build passes.
- [ ] Back up the MySQL database before migrating (`.superpowers/backups/clinic_new-backup-<ts>.sql`, confirm non-empty), then `php artisan migrate:fresh --seed`.
- [ ] Browser (portal at phone size + admin): raise an invoice from a completed appointment with a service line and a doctor-fee line; issue it and check the number; record a part payment in cash and confirm the list shows the balance and the appointment reads `partial`; pay the remainder online with Razorpay test keys (or the fake gateway) from the portal and confirm the invoice reads paid, the appointment `paid`, and the receipt PDF says Receipt; send the WhatsApp pay-link and open it, confirming it lands on the invoice with the right profile; refund the online payment and confirm both statuses fall back; cancel a draft and confirm its number was never allocated.
- [ ] Screenshots under `.superpowers/sdd/2026-10-16-invoices-payments/e2e/`. Commit fix-ups only.
