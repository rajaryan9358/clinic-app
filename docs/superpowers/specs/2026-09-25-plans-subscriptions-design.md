# Plans and Subscription Billing — Design

Date: 2026-09-25
Status: Approved in chat
Sub-project: B of the super admin roadmap (A: panel cleanup — done; B: plans + subscriptions; D: permission-based roles; C: patient payments + Route payouts)

## Goal

The platform sells plans to clinics. The super admin manages a plan catalogue and assigns a plan at onboarding (trial, payment pending, or paid offline). Clinic admins pay through Razorpay Subscriptions (autopay). Webhooks keep each clinic's subscription state current. Unpaid clinics get a grace period, then are locked to the Subscription page. Plans cap doctors, staff users, and monthly appointments. The super admin sees every subscription transaction.

## Decisions (from chat)

| Question | Decision |
|---|---|
| Pricing | Each plan has a monthly price and an optional yearly price; the clinic admin picks the cycle at checkout. |
| Unpaid behaviour | Grace period (System Settings, default 3 days) with a banner, then locked to the Subscription page. Super admin can extend or reactivate. |
| No-trial onboarding | Super admin chooses: Trial (N days), Payment pending, or Active (paid offline). |
| Plan limits | Max doctors, max staff users, max appointments per calendar month. `null` = unlimited. |
| Payment mechanism | Razorpay Subscriptions (recurring autopay), not one-off orders per cycle. |
| Payer | Clinic admin pays in-app via Razorpay Checkout. |

## 1. Data model

All money in paise (unsigned integer). Currency `INR`. Prices are tax-inclusive.

**`plans`**
`id, name, description (text, null), monthly_price (uint), yearly_price (uint, null), max_doctors (uint, null), max_staff (uint, null), max_appointments_per_month (uint, null), is_active (bool, default true), razorpay_plan_id_monthly (string, null), razorpay_plan_id_yearly (string, null), sort_order (uint, default 0), timestamps, soft deletes`.
Razorpay plans are immutable: when `monthly_price` or `yearly_price` changes, the matching `razorpay_plan_id_*` is cleared, and a new Razorpay plan is created at the next checkout. Existing subscriptions keep their old Razorpay plan and price.

**`clinic_subscriptions`** (one row per clinic; `clinic_id` unique)
`id, clinic_id, plan_id, billing_cycle enum(monthly, yearly), status enum(trialing, pending_payment, active, past_due, expired, cancelled), trial_ends_at (null), current_period_start (null), current_period_end (null), grace_ends_at (null), razorpay_subscription_id (null, unique), cancelled_at (null), timestamps`.

**`subscription_transactions`**
`id, clinic_id, clinic_subscription_id (null), plan_id (null), billing_cycle (null), amount (uint), currency (default INR), status enum(captured, failed, refunded), source enum(razorpay, offline), method (null), razorpay_payment_id (null, unique), razorpay_subscription_id (null), razorpay_invoice_id (null), invoice_url (null), failure_reason (null), notes (null), recorded_by (user id, null), paid_at (null), period_start (null), period_end (null), timestamps`. Indexed on (clinic_id, created_at) and (status, created_at).

**`razorpay_webhook_events`**
`id, event_id (unique), event (string), payload (json), processed_at (null), timestamps`.

**Changes to existing tables**
- `clinics.trial_ends_at` is removed (the create-clinic migration and the additive `2026_09_25_000100_add_trial_ends_at_to_clinics_table.php` are edited or deleted — schema is rebuilt with migrate:fresh, as before). Trial end lives on `clinic_subscriptions`.
- `clinics.status` stays. It means the super admin's override only: `suspended` locks the clinic regardless of subscription. Onboarding sets it to `active`; `trial` is no longer used for new clinics.
- System settings keys (encrypted, via `SystemSetting`): `razorpay_key_id`, `razorpay_key_secret`, `razorpay_webhook_secret`, `razorpay_mode` (`test`|`live`), `subscription_grace_days` (default 3), and the existing `trial_days` (default trial length in onboarding). `trial_enabled` is removed (onboarding chooses per clinic).

## 2. Razorpay integration

**SDK:** `razorpay/razorpay` (official PHP SDK) via composer.

**Gateway boundary:** `App\Services\Billing\RazorpayGateway` (interface) with `RazorpayApiGateway` (real, SDK-backed) and `FakeRazorpayGateway` (tests). Bound in `AppServiceProvider`; credentials read from system settings at call time. Methods:
- `createPlan(string $period, int $amount, string $name): string` → Razorpay plan id (`period` = `monthly`|`yearly`, interval 1)
- `createSubscription(string $razorpayPlanId, int $totalCount, ?int $startAt, array $notes): array` → `['id' => ..., 'status' => ...]`
- `cancelSubscription(string $subscriptionId, bool $atCycleEnd): void`
- `verifyPaymentSignature(string $paymentId, string $subscriptionId, string $signature): bool`
- `verifyWebhookSignature(string $body, string $signature): bool`
- `keyId(): ?string`

If Key ID/Secret are not set, checkout returns 422 "Online payments are not configured yet."

**Checkout (clinic admin)**
- `GET /api/clinic/subscription` → current subscription (plan, cycle, status, dates, grace), usage (doctors, staff, appointments this month vs limits), active plans list, own transactions (paginated), `razorpay_key_id`.
- `POST /api/clinic/subscription/checkout {plan_id, billing_cycle}` → ensures the Razorpay plan exists (creates and stores the id if missing), creates a Razorpay subscription (`total_count` 120 monthly / 10 yearly; `start_at` = trial end when status is `trialing` and trial end is in the future), stores `razorpay_subscription_id`, `plan_id`, `billing_cycle` on the clinic subscription, returns `{subscription_id, key_id, clinic name, admin email/phone}`. Only `clinic_admin` (403 otherwise). Rejects inactive plans and a `yearly` cycle on a plan without `yearly_price` (422).
- Frontend loads `https://checkout.razorpay.com/v1/checkout.js` and opens Checkout with `subscription_id`.
- `POST /api/clinic/subscription/verify {razorpay_payment_id, razorpay_subscription_id, razorpay_signature}` → verifies the signature, then sets status `active` (and clears grace). Does not create a transaction; the `subscription.charged` webhook does. Invalid signature → 422.

**Webhook**
`POST /api/webhooks/razorpay` (no auth, outside `auth:sanctum`, CSRF-exempt by being an API route). Verifies `X-Razorpay-Signature` against the raw body with the webhook secret (invalid → 400). Stores the event by `event_id` from the `x-razorpay-event-id` header, falling back to a hash of the body; a duplicate event id returns 200 without re-processing. Finds the clinic subscription by `razorpay_subscription_id`; unknown id → 200 and logged.

| Event | Effect |
|---|---|
| `subscription.activated` | status `active`; set period start/end from payload; clear grace |
| `subscription.charged` | upsert `captured` transaction by `razorpay_payment_id` (amount, method, invoice id, period); status `active`; advance period end; clear grace |
| `subscription.pending` | status `past_due`; `grace_ends_at = now + grace days` if not already set |
| `subscription.halted` | status `past_due`; keep existing `grace_ends_at` or set it |
| `subscription.cancelled` | status `cancelled`; `cancelled_at = now` (access continues until `current_period_end`) |
| `subscription.completed` | status `expired` |
| `payment.failed` (with a subscription id in notes/payload) | upsert `failed` transaction with `failure_reason` |

## 3. Lifecycle, locking, super admin actions

**Onboarding** (super admin wizard) gets a **Plan** step between Clinic and Admin: plan (active plans), billing cycle, and start mode:
- **Trial**: days (default `trial_days`) → status `trialing`, `trial_ends_at = now + days`.
- **Payment pending** → status `pending_payment`, `grace_ends_at = now + grace days`.
- **Active (paid offline)**: amount (₹), period months (default 1 for monthly / 12 for yearly), note → status `active`, `current_period_end = now + months`, plus an `offline` `captured` transaction with `recorded_by`.
`POST /api/super-admin/clinics` accepts `subscription: {plan_id, billing_cycle, start_mode (trial|pending_payment|paid_offline), trial_days, offline_amount, offline_period_months, offline_notes}`; `ClinicCreationService` creates the `clinic_subscriptions` row (and offline transaction) in the same transaction.

**Daily job** `subscriptions:sync` (replaces `clinics:expire-trials`, scheduled daily; also safe to run hourly):
- `trialing` and `trial_ends_at <= now` and no `razorpay_subscription_id` → `pending_payment`, `grace_ends_at = now + grace days`.
- `active` with `source` offline-only (no `razorpay_subscription_id`) and `current_period_end <= now` → `past_due`, `grace_ends_at = now + grace days`.
- `pending_payment`/`past_due` and `grace_ends_at <= now` → `expired`.

**Access rule** (`ClinicSubscription::allowsAccess()`): allowed when clinic status is not `suspended` AND one of: `trialing` with `trial_ends_at > now`; `active`; `cancelled` with `current_period_end > now`; `pending_payment`/`past_due` with `grace_ends_at > now`. A clinic with no subscription row is allowed (existing clinics before this change get one in the seeder; defensive default).

**Lock middleware** `EnsureClinicSubscription` (alias `clinic.subscription`) on the `/api/clinic` group, after `clinic.context`. When access is not allowed → HTTP 402 `{success:false, code:"SUBSCRIPTION_REQUIRED", message:...}`. Always allowed: `GET me/context`, `GET subscription`, `POST subscription/checkout`, `POST subscription/verify`. `me/context` gains `subscription: {status, plan_name, trial_ends_at, grace_ends_at, current_period_end, allows_access}`.

**Super admin actions** on a clinic (`/api/super-admin/clinics/{id}/subscription/...`):
- `PUT` — change plan/cycle (only while not linked to a Razorpay subscription, i.e. trial/pending/offline).
- `POST extend-trial {days}`; `POST extend-grace {days}`.
- `POST offline-payment {amount, period_months, notes}` → offline transaction; status `active`; period end extended from max(now, current end).
- `POST cancel` → cancels the Razorpay subscription at cycle end when linked; status `cancelled`.

## 4. Plan limits

`App\Services\Billing\PlanLimits::assertCanAdd(Clinic $clinic, string $resource)` with `resource` ∈ `doctors`, `staff`, `appointments`. Counts: doctors in clinic (not soft-deleted); staff = clinic users with role ≠ `doctor`; appointments created this calendar month, status ≠ `cancelled`. Over the limit → `ValidationException` (422) with message like "Your Starter plan allows 2 doctors. Upgrade your plan to add more." Called from `DoctorManagementService::create`, `UserManagementService::create` (clinic staff), and `AppointmentService::create`. No subscription row → no limits.

## 5. Screens

**Super admin**
- Sidebar: new **Billing** section — **Plans**, **Subscription Transactions**.
- **Plans** page: list (name, prices, limits, active, subscriber count) and a create/edit sheet. Prices entered in ₹, stored in paise.
- **Onboarding**: Plan step (plan cards, cycle toggle, start-mode radio with its fields).
- **Clinic Overview**: **Subscription** card — plan, cycle, status badge, trial/period/grace dates, Razorpay subscription id, and actions (change plan, extend trial, extend grace, record offline payment, cancel). Replaces the old trial banner source (`clinics.trial_ends_at`).
- **Subscription Transactions** page: table (date, clinic, plan, cycle, amount ₹, status, source, method, Razorpay payment id, invoice link); filters: clinic, status, source, date range; totals of captured amount for the filter.
- **System Settings → Payments** tab: Razorpay Key ID, Key Secret (write-only, shown masked), Webhook Secret (write-only), mode, grace days, and the webhook URL to copy (`{APP_URL}/api/webhooks/razorpay`). Trial tab keeps default trial days.

**Clinic admin**
- Sidebar: **Subscription** under Settings.
- **Subscription** page: current plan and status, key dates, usage bars vs limits, plan cards with monthly/yearly toggle, **Pay with Razorpay** button, own transaction history with invoice links.
- Top-bar banner (existing trial banner in `Layout.jsx`) driven by `me/context.subscription`: trial days left, payment pending, past due (grace days left).
- On any API 402 `SUBSCRIPTION_REQUIRED`: clinic admin → redirected to `/workflows/subscription`; other roles → a full-page "Your clinic's subscription is inactive. Contact your clinic admin." screen with Sign out.

## 6. Testing

Feature tests with `FakeRazorpayGateway`:
- Plans CRUD (super admin only); price change clears stored Razorpay plan id.
- Onboarding with each start mode creates the right subscription row (and offline transaction).
- Checkout: creates plan+subscription via gateway, stores ids, `start_at` = trial end during trial; non-admin 403; unconfigured keys 422; yearly on plan without yearly price 422.
- Verify: good signature → active; bad → 422.
- Webhook: bad signature 400; duplicate event processed once; each event in the table produces its effect; charged creates one transaction per payment id.
- Sync job: trial→pending_payment, offline period end→past_due, grace end→expired.
- Lock: expired clinic gets 402 on `/api/clinic/patients`, but 200 on `me/context` and `subscription`; suspended clinic locked; grace clinic allowed.
- Limits: doctor/staff/appointment creation blocked at the limit, allowed under it, unlimited when null.
- Super admin transactions list filters and totals.
Then one real test-mode checkout in the browser once Razorpay test keys are entered.

## Out of scope

Mid-cycle upgrades with proration, coupons/discounts, our own GST invoices (Razorpay invoice links are used), refunds from the panel, dunning emails/WhatsApp (Razorpay's own emails apply), patient payments and payouts (sub-project C), permission-based roles (sub-project D).
