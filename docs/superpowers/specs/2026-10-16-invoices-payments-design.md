# Invoices & Online Payment (E4) — Design

Date: 2026-10-16
Status: Drafted without a requirements conversation — every "Decision" below is the author's call, not the user's, and is open to being overruled
Roadmap: E4 of the new-clinic adoption (E1 WhatsApp ✅ → E2 patient portal ✅ → E3 waitlist ✅ → **E4 invoices + online payment**)
Source: dormant billing schema from the Phase-1 migration (`invoices`, `payments`, `appointments.payment_status`), the Razorpay subscription plumbing in `app/Services/Billing`, and the `billing.*` permissions already in `PermissionCatalogue`

## Goal

A clinic can bill a patient for a visit and get paid. Front desk raises an invoice (prefilled from the appointment's service and the doctor's fee), takes cash/UPI/card at the counter, or sends the patient a WhatsApp link to pay online. The patient sees their invoices in the portal, pays with Razorpay, and gets a receipt. Staff see what is paid, part-paid and outstanding.

## Relationship to the PRD

The MVP PRD has no patient-billing section and lists "Accounting, payroll and advanced billing" as out of scope. This design reads that exclusion as *accounting-grade* billing — ledgers, payroll, GST filing, insurance claims — not as basic patient invoicing, and scopes E4 accordingly. The same judgement was already applied once in this project: "SaaS subscription/billing management" is also listed Later in the PRD, and was built in full. **If that reading is wrong, stop here** — nearly every item below is then out of scope.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Money representation | Keep the existing `decimal(12,2)` rupee columns. Convert to integer paise only at the Razorpay boundary (`round($amount, 2) * 100`). | The clinical side (`Service.fee`, `Doctor.consultation_fee`) is already decimal rupees; subscriptions are paise. Matching the neighbouring tables beats matching the gateway. |
| Who raises an invoice | Staff, explicitly, from the appointment or standalone. No auto-invoice on consultation completion. | Auto-invoicing needs a per-clinic policy and a correction flow. Out for E4; the hook is easy to add later. |
| Line items | New `invoice_items` table. | `subtotal` implies items, and an itemised print-out is what a patient expects. JSON would make per-service reporting impossible. |
| "Partly paid" | Derived, not stored: an `issued` invoice whose payments sum to less than the total. `invoices.status` keeps its four values. | The shipped enum has no `partial`; `appointments.payment_status` does. Deriving reconciles them without a schema change. |
| Online payments | Razorpay **Orders** (one-off), not Subscriptions. New methods on `RazorpayGateway`, with the existing Fake/Api split. | Subscriptions are the wrong primitive for a single invoice. |
| Refunds | Staff mark a payment refunded (status, timestamp, reason); the refund itself is issued in the Razorpay dashboard. | A refund API needs an approval flow and reconciliation. Recording is enough for E4. |
| Tax | One optional clinic-level percentage, plus a per-invoice override of the computed amount. No GSTIN, HSN or tax-invoice compliance, and the PDF must not call itself a tax invoice. | Compliance is accounting-grade and jurisdiction-specific. |
| Invoice numbers | Per-clinic, per-financial-year counter in a new `invoice_counters` table, allocated under a row lock. Format `{prefix}/{FY}/{00001}`, e.g. `INV/2026-27/00042`. | `invoices.invoice_number` is globally unique, so the number must carry the clinic's prefix. Counting existing rows breaks when invoices are cancelled or deleted. |
| Editing | An invoice is editable only while `draft`. Issued invoices change only by cancelling and raising a new one. | Standard, and it keeps numbering honest. |

**Non-goals:** accounting exports, ledgers, day-books, payroll, GST/tax filing, insurance claims, pharmacy/lab billing, package or instalment plans, credit notes, partial refunds against specific line items, patient wallets or advances, multi-currency, automated gateway refunds.

**Anti-goals** — ways this ships and is still a failure: a patient is charged twice for one invoice; a webhook replay marks an unpaid invoice paid; an invoice number is reused or skipped unexplained; one clinic sees another clinic's invoices; a payment is recorded but the invoice and appointment still read unpaid; the PDF presents itself as a GST tax invoice.

## 1. Data

**Reused as-is** (Phase-1 migration `2026_03_29_000600_create_settings_billing_and_logs_tables.php`, both tables currently unwritten in production):

- `invoices`: `clinic_id, patient_id, appointment_id?, invoice_number unique, invoice_date, subtotal, discount_amount, tax_amount, total_amount, status(draft|issued|paid|cancelled), notes`
- `payments`: `clinic_id, invoice_id?, appointment_id?, patient_id, amount, payment_method(cash|upi|card|bank_transfer|other), reference_number?, paid_at, status(success|pending|failed|refunded), collected_by_user_id?, notes`

**Edited in place** (safe: no production rows, same precedent as the E3 `clinic_settings` edits):

- `payments.payment_method` — add `online`.
- `payments` — add `razorpay_order_id` string null (indexed), `razorpay_payment_id` string null (unique, null-allowed), `refunded_at` timestamp null, `refund_reason` string null.
- `invoices` — add `issued_at`, `cancelled_at`, `cancelled_reason`, `created_by_user_id` FK users nullOnDelete.

**New migration:**

- `invoice_items`: `id, invoice_id FK cascade, service_id FK nullOnDelete, description string, quantity unsigned int default 1, unit_amount decimal(12,2), amount decimal(12,2), sort_order`. Index `(invoice_id)`.
- `invoice_counters`: `id, clinic_id FK cascade, period string (financial year, e.g. "2026-27"), next_number unsigned int default 1, unique (clinic_id, period)`.

**Clinic settings** (`clinic_settings`, edited in place, with model fillable/casts/validation): `invoicing_enabled` bool default true; `online_payment_enabled` bool default false; `invoice_prefix` string(10) default `INV`; `invoice_tax_percent` decimal(5,2) default 0 (0–100); `invoice_footer_note` string(500) null. No settings row ⇒ invoicing on, online payment off, prefix `INV`, tax 0.

Online payment additionally requires the platform Razorpay keys to be configured (`RazorpayGateway::isConfigured()`); the setting alone does not enable it.

## 2. Invoice lifecycle (`App\Services\Billing\InvoiceService`)

- `draft(array $data, int $userId): Invoice` — clinic-scoped; optional `appointment_id` (same clinic, and the invoice's patient must match the appointment's). Items prefill from the appointment's service fee and the doctor's `consultation_fee`/`followup_fee` by `visit_type`, but the caller may send any items. Recomputes totals (below). Status `draft`, no number yet.
- `update(Invoice $i, array $data): Invoice` — `draft` only, else 422 `Only a draft invoice can be edited.`
- `issue(Invoice $i): Invoice` — allocates the number under the counter lock, sets `status=issued`, `issued_at`, and syncs the appointment. 422 `This invoice has already been issued.` if not draft.
- `cancel(Invoice $i, ?string $reason): Invoice` — `draft` or `issued` with **no successful payments**, else 422 `Refund the payments before cancelling this invoice.` Keeps the number.
- `recordPayment(Invoice $i, array $data, ?int $userId): Payment` — counter payments. Rejects an amount above the outstanding balance (422 `That is more than the amount outstanding.`) and any payment against a `draft` or `cancelled` invoice.
- `markRefunded(Payment $p, string $reason): Payment` — `success` → `refunded`; invoice and appointment statuses recomputed.

**Totals:** `subtotal` = Σ item amounts (`quantity × unit_amount`); `tax_amount` = caller's override, else `round(subtotal − discount_amount) × invoice_tax_percent / 100, 2)`; `total_amount` = `subtotal − discount_amount + tax_amount`. Discount may not exceed subtotal (422 `The discount cannot be more than the subtotal.`).

**Derived state**, recomputed after every payment, refund, issue and cancel, inside the same transaction:

- `amount_paid` = Σ `payments.amount` where `status = success`.
- `invoices.status`: `paid` when `amount_paid >= total_amount`; back to `issued` if a refund drops it below.
- `appointments.payment_status` (when the invoice has an appointment): `paid` when fully paid, `partial` when `0 < amount_paid < total`, else `unpaid`. `waived` is staff-set and never overwritten.
- `appointments.appointment_fee`/`discount_amount`/`final_amount` mirror the invoice's subtotal/discount/total on issue, so existing appointment screens show the money without joining.

**Numbering:** inside `DB::transaction`, `InvoiceCounter::where(clinic, period)->lockForUpdate()` (created on first use), take `next_number`, increment, format `{prefix}/{period}/{number padded to 5}`. Financial year runs April–March (`period` = `2026-27` for 2026-04-01 … 2027-03-31). Numbers are allocated at **issue**, never at draft, and are never reused.

## 3. Online payment (`App\Services\Billing\PatientPaymentService`)

Gateway additions (`RazorpayGateway` interface + `RazorpayApiGateway` + `FakeRazorpayGateway`):

```php
public function createOrder(int $amountInPaise, string $receipt, array $notes): array; // ['id' => 'order_...']
public function verifyOrderSignature(string $orderId, string $paymentId, string $signature): bool;
```

Flow:

1. Patient opens an issued, unpaid invoice in the portal and taps Pay. `POST /api/portal/invoices/{id}/pay` creates (or reuses) a Razorpay order for the **outstanding** amount, records a `pending` payment row with `payment_method = online` and the `razorpay_order_id`, and returns `{order_id, amount, currency: 'INR', key_id, invoice_number}`.
2. The portal opens Razorpay Checkout with that order.
3. On success the browser posts `{razorpay_order_id, razorpay_payment_id, razorpay_signature}` to `POST /api/portal/invoices/{id}/confirm`. The signature is verified server-side; only then does the pending payment become `success` with its `razorpay_payment_id`, and the totals recompute.
4. The `payment.captured` webhook does the same thing independently, so a patient who closes the tab still gets credited.

`/confirm` also checks that the order's amount matches the payment row it is completing, so a tampered client cannot settle a ₹2,000 invoice with a ₹1 order.

**Idempotency** is the thing to get right: steps 3 and 4 race by design. Both resolve the payment row by `razorpay_payment_id` (unique) inside a transaction with the invoice row locked, and both are no-ops if that payment id is already recorded. A webhook for an unknown order is logged and ignored. `razorpay_webhook_events` already gives replay protection at the delivery level and is reused unchanged.

**Webhook routing:** `RazorpayWebhookController` currently hands everything to the subscription handler. It gains a branch — events whose payload carries an order id that matches a `payments.razorpay_order_id` (or `notes.invoice_id`) go to the new handler; everything else keeps its current path. Subscription behaviour must not change.

## 4. Staff API

Clinic routes (`perm:billing.view` to read, `perm:billing.create` to write, `perm:billing.edit` to cancel/refund), with the usual SuperAdmin twin taking `clinic_id`:

| Route | Purpose |
|---|---|
| `GET invoices?patient_id=&appointment_id=&status=&from=&to=&q=` | Paginated list with `amount_paid` and `balance` |
| `POST invoices` | Create draft |
| `GET invoices/{id}` | Detail with items and payments |
| `PUT invoices/{id}` | Edit draft |
| `POST invoices/{id}/issue` | Issue and allocate the number |
| `POST invoices/{id}/cancel` | Cancel |
| `POST invoices/{id}/payments` | Record a counter payment |
| `POST payments/{id}/refund` | Mark refunded |
| `GET invoices/{id}/pdf` | Invoice/receipt PDF |
| `POST invoices/{id}/send` | WhatsApp the invoice to the patient |
| `GET appointments/{id}/invoice-prefill` | Suggested items for an appointment |

Cross-clinic access returns 404, never 403, matching the rest of the API. Note that `BelongsToClinicScope` on `Invoice`/`Payment` is only a `forClinic()` helper, not a global scope — every query must scope itself, as the existing controllers do.

## 5. Portal API

Under `portal.auth` + `portal.consent`, scoped to the **acting profile** exactly as prescriptions are:

- `GET invoices` → issued/paid invoices for the acting patient (never drafts or cancelled), newest first, each with `number, date, total, paid, balance, status, doctor_name`
- `GET invoices/{id}` → detail with items and payments
- `GET invoices/{id}/pdf` → the same PDF
- `POST invoices/{id}/pay` and `POST invoices/{id}/confirm` → as above; both 404 when online payment is off for the clinic or the gateway is unconfigured

## 6. Notifications and PDF

- WhatsApp type `invoice_ready`, registered in `TemplateSettings::TYPES`/`DEFAULTS` and sent by a new `PatientNotifier::invoiceReady(Invoice $invoice, string $token)`. Body params in order: patient full name, clinic name, invoice number, total amount formatted `₹1,234.00`, due wording. URL button param = a portal login-link token with `redirect_path = /invoices/{id}?profile={patientId}`, reusing `PortalLinkService::issueForRedirect` exactly as the waitlist offer does.
- Optional second type `payment_received` (receipt confirmation) — build it only if it falls out cheaply; it is not required for the flow to work.
- `InvoicePdfRenderer` beside `PrescriptionPdfRenderer`, blade at `resources/views/reports/invoice.blade.php`, clinic header, itemised table, totals, payments with method and date, balance, and the clinic's footer note. It is headed "Invoice" (or "Receipt" when fully paid) and never "Tax Invoice".

## 7. Staff UI (`resources/js/admin/src`)

- Nav entry **Billing** under Operations, gated on `billing.view`: filterable list (patient, status, date range), with outstanding totals.
- Invoice detail/editor: items (add from the clinic's services or free text), discount, tax, notes; Issue, Cancel, Record payment, Refund, Download PDF, Send on WhatsApp.
- Appointment drawer: a money line — invoice number and status, or "Raise invoice" when there is none.
- Clinic settings: the five new fields, with online payment showing why it is unavailable when the gateway is unconfigured.
- Follow the existing conventions: reset page state on filter/route change, guard stale responses, surface API messages verbatim.

## 8. Portal UI (`resources/js/portal`)

- **Invoices** nav entry and list (number, date, total, status chip, Pay button when there is a balance and online payment is on).
- Invoice detail: items, totals, payment history, Pay now, Download PDF.
- Razorpay Checkout loaded from the gateway's script, opened with the order from `/pay`, posting back to `/confirm`; on success show the receipt state. A closed or failed checkout leaves the invoice untouched and says so.
- Double-submit prevention and stale-response guards as in the existing pages.

## 9. Review focus

1. A patient paying twice in two tabs, and a webhook arriving while `/confirm` is in flight, both produce exactly one `success` payment.
2. A replayed `payment.captured` for an already-recorded payment id changes nothing.
3. Concurrent issues in one clinic never collide on a number, and a rolled-back transaction does not burn one silently.
4. Totals, `invoices.status` and `appointments.payment_status` agree after every sequence of pay/refund/cancel.
5. An invoice from another clinic 404s on every staff and portal route, including the PDF.
6. A dependent's invoice reaches the account holder's WhatsApp and the link opens with the dependent's profile selected.
7. Subscription webhooks still behave exactly as before the routing branch.

## 10. Left to the builder

Pagination sizes and list column order; the exact prefill rule when an appointment has both a service fee and a doctor fee (suggest both as separate lines, staff delete what they do not want); PDF layout and typography within the existing report style; whether `payment_received` ships; copy for the empty states; where the money line sits in the appointment drawer.
