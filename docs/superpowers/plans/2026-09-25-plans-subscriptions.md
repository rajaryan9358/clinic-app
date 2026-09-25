# Plans and Subscription Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Super admin sells plans to clinics; clinic admins pay via Razorpay Subscriptions; webhooks keep clinic subscription state current; unpaid clinics are locked after a grace period; plans cap doctors, staff and monthly appointments; super admin sees all subscription transactions.

**Architecture:** New `plans`, `clinic_subscriptions`, `subscription_transactions`, `razorpay_webhook_events` tables. All state changes go through `App\Services\Billing\SubscriptionService`; all Razorpay calls go through the `RazorpayGateway` interface (real SDK implementation + fake for tests). A `clinic.subscription` middleware returns HTTP 402 when a clinic may not use the app. Platform settings (Razorpay keys, grace days, trial days) live in encrypted `system_settings` read via a small `PlatformSettings` helper.

**Tech Stack:** Laravel 13 (PHP 8.4 at `/opt/homebrew/bin/php`), Sanctum, spatie/laravel-permission, `razorpay/razorpay` PHP SDK, MySQL (MAMP, port 8889) for dev, SQLite in-memory for tests, React 19 + Vite + Tailwind 4 admin SPA in `resources/js/admin/src`.

**Spec:** `docs/superpowers/specs/2026-09-25-plans-subscriptions-design.md`

## Global Constraints

- `php` is not on PATH: always `/opt/homebrew/bin/php`. `npm`: `PATH=$HOME/.nvm/versions/node/v22.14.0/bin:$PATH npm ...`. The ">500 kB chunk" build warning is pre-existing.
- Money is stored in **paise** as unsigned integers; currency `INR`; prices are tax-inclusive. UI takes and shows rupees (`amount / 100`, two decimals, `₹`).
- Subscription statuses: `trialing`, `pending_payment`, `active`, `past_due`, `expired`, `cancelled`. Billing cycles: `monthly`, `yearly`. Transaction status: `captured`, `failed`, `refunded`. Transaction source: `razorpay`, `offline`. Start modes: `trial`, `pending_payment`, `paid_offline`.
- Settings keys: `razorpay_key_id`, `razorpay_key_secret`, `razorpay_webhook_secret`, `razorpay_mode` (`test`|`live`), `subscription_grace_days` (default 3), `trial_days` (default 14). `trial_enabled` is removed.
- Razorpay subscription `total_count`: 120 for monthly, 10 for yearly.
- Lock response: HTTP **402** `{"success": false, "code": "SUBSCRIPTION_REQUIRED", "message": "..."}`. Always allowed while locked: `GET /api/clinic/me/context`, `GET /api/clinic/subscription`, `POST /api/clinic/subscription/checkout`, `POST /api/clinic/subscription/verify`.
- Limit message format: `"Your {Plan} plan allows {N} {doctors|staff users|appointments per month}. Upgrade your plan to add more."` returned as a 422 validation error on field `plan`.
- A clinic with no `clinic_subscriptions` row has no limits and is never locked.
- `clinics.status = suspended` locks the clinic regardless of subscription.
- Controllers return JSON through the existing `ApiResponse` trait: `$this->success($message, $data, $status = 200)` / `$this->error($message, $errors, $status)`.
- Tests: `/opt/homebrew/bin/php artisan test` (SQLite in-memory). Feature tests seed `RolesAndPermissionsSeeder` and use `Sanctum::actingAs`. Bind `FakeRazorpayGateway` with `$this->app->instance(RazorpayGateway::class, $fake)`.
- Never stage the untracked root `Clinic_Management_System_MVP_PRD.pdf` or `.playwright-mcp/` or `.superpowers/`. Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work on branch `subscriptions`.

## Review Focus

1. **Webhook arrives before `/verify` (or `/verify` never called because the tab closed).** Clinic must still become active from the webhook alone. Test: Task 7 `test_activated_webhook_alone_activates_clinic`.
2. **Webhook for a clinic whose Razorpay subscription id we don't know** (e.g. test events from the Razorpay dashboard). Must return 200 and change nothing. Test: Task 7 `test_unknown_subscription_is_ignored_with_200`.
3. **Super admin changes a plan price while clinics are subscribed.** Existing subscribers keep their Razorpay plan; the next checkout creates a new Razorpay plan. Test: Task 3 `test_price_change_clears_razorpay_plan_ids` + Task 6 `test_checkout_creates_razorpay_plan_when_missing`.
4. **Doctor/receptionist of a locked clinic.** They get 402 on normal endpoints and cannot reach checkout (403 for non-admins), and the UI shows the "contact your clinic admin" screen instead of looping. Test: Task 6 `test_checkout_forbidden_for_non_admin` + Task 5 lock tests; UI in Task 11.
5. **Limit counting edge: soft-deleted doctors and cancelled appointments** must not count. Test: Task 9 `test_soft_deleted_doctor_and_cancelled_appointments_do_not_count`.

---

## File Structure

**Create (backend)**
- `database/migrations/2026_09_26_000100_create_billing_tables.php` — plans, clinic_subscriptions, subscription_transactions, razorpay_webhook_events
- `app/Models/Plan.php`, `app/Models/ClinicSubscription.php`, `app/Models/SubscriptionTransaction.php`, `app/Models/RazorpayWebhookEvent.php`
- `app/Support/PlatformSettings.php` — get/set encrypted system settings (JSON values)
- `app/Services/Billing/RazorpayGateway.php` (interface), `RazorpayApiGateway.php`, `FakeRazorpayGateway.php`
- `app/Services/Billing/SubscriptionService.php` — all subscription state transitions
- `app/Services/Billing/PlanLimits.php`
- `app/Services/Billing/RazorpayWebhookHandler.php`
- `app/Console/Commands/SyncSubscriptions.php` (`subscriptions:sync`)
- `app/Http/Middleware/EnsureClinicSubscription.php`
- `app/Http/Controllers/Api/SuperAdmin/PlanController.php`, `SuperAdmin/ClinicSubscriptionController.php`, `SuperAdmin/SubscriptionTransactionController.php`
- `app/Http/Controllers/Api/Clinic/SubscriptionController.php`
- `app/Http/Controllers/Api/RazorpayWebhookController.php`
- Tests: `tests/Feature/Billing/*.php`

**Delete:** `app/Console/Commands/ExpireTrialClinics.php`, `database/migrations/2026_09_25_000100_add_trial_ends_at_to_clinics_table.php`

**Create (frontend)** `resources/js/admin/src/pages/billing/PlansPage.jsx`, `SubscriptionTransactionsPage.jsx`, `ClinicSubscriptionPage.jsx`, `components/billing/SubscriptionCard.jsx`, `components/billing/SubscriptionLockScreen.jsx`, `utils/money.js`

---

### Task 1: Billing schema, models, settings helper; remove clinics.trial_ends_at

**Files:**
- Create: `database/migrations/2026_09_26_000100_create_billing_tables.php`, `app/Models/Plan.php`, `app/Models/ClinicSubscription.php`, `app/Models/SubscriptionTransaction.php`, `app/Models/RazorpayWebhookEvent.php`, `app/Support/PlatformSettings.php`
- Delete: `database/migrations/2026_09_25_000100_add_trial_ends_at_to_clinics_table.php`, `app/Console/Commands/ExpireTrialClinics.php`
- Modify: `app/Models/Clinic.php` (drop `trial_ends_at` from fillable/casts; add `subscription()`), `routes/console.php` (drop ExpireTrialClinics import + schedule line), `app/Http/Requests/UpdateClinicRequest.php` (drop `trial_ends_at` rule), `app/Services/ClinicCreationService.php` (drop the trial block and `trial_ends_at` key), `app/Http/Controllers/Api/Clinic/MeController.php` (drop `trial_ends_at` from select; `clinic_trial_ends_at` → from subscription), `app/Http/Controllers/Api/SuperAdmin/SystemSettingController.php` (use `PlatformSettings`; drop `trial_enabled`)
- Test: `tests/Feature/Billing/ClinicSubscriptionAccessTest.php`, `tests/Feature/Billing/PlatformSettingsTest.php`

**Interfaces:**
- Produces:
  - `App\Support\PlatformSettings::get(string $key, mixed $default = null): mixed`, `::set(string $key, mixed $value): void`
  - `Plan` (fillable: name, description, monthly_price, yearly_price, max_doctors, max_staff, max_appointments_per_month, is_active, razorpay_plan_id_monthly, razorpay_plan_id_yearly, sort_order; casts ints/bool); `Plan::priceFor(string $cycle): ?int`; `Plan::limitFor(string $resource): ?int` (`doctors`→max_doctors, `staff`→max_staff, `appointments`→max_appointments_per_month)
  - `ClinicSubscription` (fillable: clinic_id, plan_id, billing_cycle, status, trial_ends_at, current_period_start, current_period_end, grace_ends_at, razorpay_subscription_id, cancelled_at; datetime casts); relations `clinic()`, `plan()`, `transactions()`; `allowsAccess(): bool` (does NOT look at clinic status); constants `STATUSES`
  - `Clinic::subscription(): HasOne`
  - `SubscriptionTransaction` (fillable: all columns in spec; casts amount int, paid_at/period_start/period_end datetime); relations `clinic()`, `plan()`, `subscription()` (belongsTo ClinicSubscription via clinic_subscription_id)
  - `RazorpayWebhookEvent` (fillable: event_id, event, payload, processed_at; payload array cast)

- [ ] **Step 1: Write failing tests**

```php
<?php
// tests/Feature/Billing/ClinicSubscriptionAccessTest.php
namespace Tests\Feature\Billing;

use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class ClinicSubscriptionAccessTest extends TestCase
{
    use RefreshDatabase;

    private function sub(array $attrs): ClinicSubscription
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c'.Str::random(5), 'status' => 'active']);
        $plan = Plan::create(['name' => 'Starter', 'monthly_price' => 99900]);

        return ClinicSubscription::create(array_merge([
            'clinic_id' => $clinic->id, 'plan_id' => $plan->id, 'billing_cycle' => 'monthly',
        ], $attrs));
    }

    public function test_access_matrix(): void
    {
        $this->assertTrue($this->sub(['status' => 'trialing', 'trial_ends_at' => now()->addDay()])->allowsAccess());
        $this->assertFalse($this->sub(['status' => 'trialing', 'trial_ends_at' => now()->subMinute()])->allowsAccess());
        $this->assertTrue($this->sub(['status' => 'active'])->allowsAccess());
        $this->assertTrue($this->sub(['status' => 'pending_payment', 'grace_ends_at' => now()->addDay()])->allowsAccess());
        $this->assertFalse($this->sub(['status' => 'pending_payment', 'grace_ends_at' => now()->subMinute()])->allowsAccess());
        $this->assertFalse($this->sub(['status' => 'pending_payment', 'grace_ends_at' => null])->allowsAccess());
        $this->assertTrue($this->sub(['status' => 'past_due', 'grace_ends_at' => now()->addDay()])->allowsAccess());
        $this->assertFalse($this->sub(['status' => 'past_due', 'grace_ends_at' => now()->subMinute()])->allowsAccess());
        $this->assertTrue($this->sub(['status' => 'cancelled', 'current_period_end' => now()->addDay()])->allowsAccess());
        $this->assertFalse($this->sub(['status' => 'cancelled', 'current_period_end' => now()->subMinute()])->allowsAccess());
        $this->assertFalse($this->sub(['status' => 'expired'])->allowsAccess());
    }

    public function test_plan_helpers(): void
    {
        $plan = Plan::create(['name' => 'Pro', 'monthly_price' => 199900, 'yearly_price' => 1999000, 'max_doctors' => 5]);
        $this->assertSame(199900, $plan->priceFor('monthly'));
        $this->assertSame(1999000, $plan->priceFor('yearly'));
        $this->assertSame(5, $plan->limitFor('doctors'));
        $this->assertNull($plan->limitFor('staff'));
    }

    public function test_clinics_table_has_no_trial_ends_at(): void
    {
        $this->assertFalse(\Illuminate\Support\Facades\Schema::hasColumn('clinics', 'trial_ends_at'));
    }
}
```

```php
<?php
// tests/Feature/Billing/PlatformSettingsTest.php
namespace Tests\Feature\Billing;

use App\Models\SystemSetting;
use App\Support\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlatformSettingsTest extends TestCase
{
    use RefreshDatabase;

    public function test_round_trips_scalar_values_and_defaults(): void
    {
        $this->assertSame(3, PlatformSettings::get('subscription_grace_days', 3));
        PlatformSettings::set('subscription_grace_days', 5);
        PlatformSettings::set('razorpay_key_id', 'rzp_test_abc');
        $this->assertSame(5, PlatformSettings::get('subscription_grace_days', 3));
        $this->assertSame('rzp_test_abc', PlatformSettings::get('razorpay_key_id'));
        // stored encrypted
        $this->assertStringNotContainsString('rzp_test_abc', (string) \DB::table('system_settings')->where('key', 'razorpay_key_id')->value('value'));
    }
}
```

- [ ] **Step 2: Run tests — expect FAIL** (`Class "App\Models\Plan" not found`)

Run: `/opt/homebrew/bin/php artisan test --filter='ClinicSubscriptionAccessTest|PlatformSettingsTest'`

- [ ] **Step 3: Migration**

```php
<?php
// database/migrations/2026_09_26_000100_create_billing_tables.php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->text('description')->nullable();
            $table->unsignedInteger('monthly_price');
            $table->unsignedInteger('yearly_price')->nullable();
            $table->unsignedInteger('max_doctors')->nullable();
            $table->unsignedInteger('max_staff')->nullable();
            $table->unsignedInteger('max_appointments_per_month')->nullable();
            $table->boolean('is_active')->default(true);
            $table->string('razorpay_plan_id_monthly')->nullable();
            $table->string('razorpay_plan_id_yearly')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('clinic_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->unique()->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('plan_id')->constrained('plans');
            $table->enum('billing_cycle', ['monthly', 'yearly'])->default('monthly');
            $table->enum('status', ['trialing', 'pending_payment', 'active', 'past_due', 'expired', 'cancelled']);
            $table->timestamp('trial_ends_at')->nullable();
            $table->timestamp('current_period_start')->nullable();
            $table->timestamp('current_period_end')->nullable();
            $table->timestamp('grace_ends_at')->nullable();
            $table->string('razorpay_subscription_id')->nullable()->unique();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();
            $table->index('status');
        });

        Schema::create('subscription_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained('clinics')->cascadeOnDelete();
            $table->foreignId('clinic_subscription_id')->nullable()->constrained('clinic_subscriptions')->nullOnDelete();
            $table->foreignId('plan_id')->nullable()->constrained('plans')->nullOnDelete();
            $table->enum('billing_cycle', ['monthly', 'yearly'])->nullable();
            $table->unsignedInteger('amount');
            $table->string('currency', 3)->default('INR');
            $table->enum('status', ['captured', 'failed', 'refunded']);
            $table->enum('source', ['razorpay', 'offline']);
            $table->string('method')->nullable();
            $table->string('razorpay_payment_id')->nullable()->unique();
            $table->string('razorpay_subscription_id')->nullable();
            $table->string('razorpay_invoice_id')->nullable();
            $table->string('invoice_url')->nullable();
            $table->string('failure_reason')->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('paid_at')->nullable();
            $table->timestamp('period_start')->nullable();
            $table->timestamp('period_end')->nullable();
            $table->timestamps();
            $table->index(['clinic_id', 'created_at']);
            $table->index(['status', 'created_at']);
        });

        Schema::create('razorpay_webhook_events', function (Blueprint $table) {
            $table->id();
            $table->string('event_id')->unique();
            $table->string('event');
            $table->json('payload');
            $table->timestamp('processed_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('razorpay_webhook_events');
        Schema::dropIfExists('subscription_transactions');
        Schema::dropIfExists('clinic_subscriptions');
        Schema::dropIfExists('plans');
    }
};
```

`git rm database/migrations/2026_09_25_000100_add_trial_ends_at_to_clinics_table.php app/Console/Commands/ExpireTrialClinics.php`

- [ ] **Step 4: Models and settings helper**

```php
<?php
// app/Support/PlatformSettings.php
namespace App\Support;

use App\Models\SystemSetting;

class PlatformSettings
{
    public static function get(string $key, mixed $default = null): mixed
    {
        $raw = SystemSetting::query()->where('key', $key)->first()?->value;
        if ($raw === null) {
            return $default;
        }
        $decoded = json_decode($raw, true);

        return json_last_error() === JSON_ERROR_NONE ? $decoded : $raw;
    }

    public static function set(string $key, mixed $value): void
    {
        SystemSetting::query()->updateOrCreate(['key' => $key], ['value' => json_encode($value)]);
    }
}
```

(`SystemSetting::$casts['value'] = 'encrypted'` already exists; reading via the model decrypts. The old controller used `->value('value')`, which bypasses the cast — do NOT copy that.)

```php
<?php
// app/Models/Plan.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Plan extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'name', 'description', 'monthly_price', 'yearly_price', 'max_doctors', 'max_staff',
        'max_appointments_per_month', 'is_active', 'razorpay_plan_id_monthly', 'razorpay_plan_id_yearly', 'sort_order',
    ];

    protected $casts = [
        'monthly_price' => 'integer', 'yearly_price' => 'integer', 'max_doctors' => 'integer',
        'max_staff' => 'integer', 'max_appointments_per_month' => 'integer', 'is_active' => 'boolean', 'sort_order' => 'integer',
    ];

    public function subscriptions(): HasMany
    {
        return $this->hasMany(ClinicSubscription::class);
    }

    public function priceFor(string $cycle): ?int
    {
        return $cycle === 'yearly' ? $this->yearly_price : $this->monthly_price;
    }

    public function limitFor(string $resource): ?int
    {
        return match ($resource) {
            'doctors' => $this->max_doctors,
            'staff' => $this->max_staff,
            'appointments' => $this->max_appointments_per_month,
            default => null,
        };
    }
}
```

```php
<?php
// app/Models/ClinicSubscription.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ClinicSubscription extends Model
{
    public const STATUSES = ['trialing', 'pending_payment', 'active', 'past_due', 'expired', 'cancelled'];

    protected $fillable = [
        'clinic_id', 'plan_id', 'billing_cycle', 'status', 'trial_ends_at', 'current_period_start',
        'current_period_end', 'grace_ends_at', 'razorpay_subscription_id', 'cancelled_at',
    ];

    protected $casts = [
        'trial_ends_at' => 'datetime', 'current_period_start' => 'datetime', 'current_period_end' => 'datetime',
        'grace_ends_at' => 'datetime', 'cancelled_at' => 'datetime',
    ];

    public function clinic(): BelongsTo { return $this->belongsTo(Clinic::class); }
    public function plan(): BelongsTo { return $this->belongsTo(Plan::class)->withTrashed(); }
    public function transactions(): HasMany { return $this->hasMany(SubscriptionTransaction::class); }

    public function allowsAccess(): bool
    {
        $now = now();

        return match ($this->status) {
            'trialing' => $this->trial_ends_at !== null && $this->trial_ends_at->gt($now),
            'active' => true,
            'pending_payment', 'past_due' => $this->grace_ends_at !== null && $this->grace_ends_at->gt($now),
            'cancelled' => $this->current_period_end !== null && $this->current_period_end->gt($now),
            default => false,
        };
    }
}
```

```php
<?php
// app/Models/SubscriptionTransaction.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SubscriptionTransaction extends Model
{
    protected $fillable = [
        'clinic_id', 'clinic_subscription_id', 'plan_id', 'billing_cycle', 'amount', 'currency', 'status', 'source',
        'method', 'razorpay_payment_id', 'razorpay_subscription_id', 'razorpay_invoice_id', 'invoice_url',
        'failure_reason', 'notes', 'recorded_by', 'paid_at', 'period_start', 'period_end',
    ];

    protected $casts = [
        'amount' => 'integer', 'paid_at' => 'datetime', 'period_start' => 'datetime', 'period_end' => 'datetime',
    ];

    public function clinic(): BelongsTo { return $this->belongsTo(Clinic::class); }
    public function plan(): BelongsTo { return $this->belongsTo(Plan::class)->withTrashed(); }
    public function subscription(): BelongsTo { return $this->belongsTo(ClinicSubscription::class, 'clinic_subscription_id'); }
}
```

```php
<?php
// app/Models/RazorpayWebhookEvent.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RazorpayWebhookEvent extends Model
{
    protected $fillable = ['event_id', 'event', 'payload', 'processed_at'];

    protected $casts = ['payload' => 'array', 'processed_at' => 'datetime'];
}
```

`Clinic.php`: remove `'trial_ends_at'` from `$fillable` and the `$casts` entry; add
```php
public function subscription(): \Illuminate\Database\Eloquent\Relations\HasOne
{
    return $this->hasOne(ClinicSubscription::class);
}
```

- [ ] **Step 5: Remove trial_ends_at consumers so the suite stays green**
- `routes/console.php`: delete `use App\Console\Commands\ExpireTrialClinics;` and `Schedule::command(ExpireTrialClinics::class)->daily();` (Task 5 schedules the new command).
- `UpdateClinicRequest.php`: delete the `'trial_ends_at' => ['nullable', 'date'],` rule.
- `ClinicCreationService.php`: delete the `$trialEndsAt` block (the `SystemSetting` trial_enabled/trial_days lookups) and the `'trial_ends_at' => $trialEndsAt,` key; drop the `SystemSetting` import if unused. Also set `'status' => $clinicData['status'] ?? 'active'` in `Clinic::create` (new clinics are `active`; the subscription carries trial state).
- `MeController.php`: select becomes `['id', 'name', 'status', 'logo_url']`; replace `'clinic_trial_ends_at' => $clinic?->trial_ends_at?->toISOString(),` with `'clinic_trial_ends_at' => $clinic?->subscription?->trial_ends_at?->toISOString(),` (Task 5 adds the full `subscription` block).
- `SystemSettingController.php`: replace the private `get`/`set` with `PlatformSettings::get`/`::set`; delete every `trial_enabled` line (show, validate, store, response).

- [ ] **Step 6: Run the new tests and the full suite — expect PASS**

Run: `/opt/homebrew/bin/php artisan test`
Expected: all pass. If `ClinicCreationTest` asserted trial behaviour, update only the assertion that referenced `trial_ends_at`.

- [ ] **Step 7: Commit**

```bash
git add -A app/Models app/Support app/Console routes/console.php app/Http/Requests/UpdateClinicRequest.php app/Services/ClinicCreationService.php app/Http/Controllers/Api/Clinic/MeController.php app/Http/Controllers/Api/SuperAdmin/SystemSettingController.php database/migrations tests/Feature/Billing
git commit -m "feat(billing): plans, clinic subscriptions and transactions schema; move trial to subscription"
```

---

### Task 2: Razorpay gateway and Payments settings

**Files:**
- Modify: `composer.json`/`composer.lock` (`composer require razorpay/razorpay`), `app/Providers/AppServiceProvider.php`, `app/Http/Controllers/Api/SuperAdmin/SystemSettingController.php`
- Create: `app/Services/Billing/RazorpayGateway.php`, `RazorpayApiGateway.php`, `FakeRazorpayGateway.php`
- Test: `tests/Feature/Billing/RazorpayGatewayTest.php`, `tests/Feature/Billing/PaymentSettingsTest.php`

**Interfaces:**
- Consumes: `PlatformSettings` (Task 1)
- Produces: `RazorpayGateway` interface:
  ```php
  public function isConfigured(): bool;
  public function keyId(): ?string;
  public function createPlan(string $period, int $amount, string $name): string;          // returns plan id
  public function createSubscription(string $razorpayPlanId, int $totalCount, ?int $startAt, array $notes): array; // ['id'=>..., 'status'=>...]
  public function cancelSubscription(string $subscriptionId, bool $atCycleEnd): void;
  public function verifyPaymentSignature(string $paymentId, string $subscriptionId, string $signature): bool;
  public function verifyWebhookSignature(string $body, string $signature): bool;
  ```
  `FakeRazorpayGateway` public props: `bool $configured = true`, `array $createdPlans = []`, `array $createdSubscriptions = []`, `array $cancelled = []`, `bool $signatureValid = true`; `createPlan` returns `'plan_fake_'.count`, `createSubscription` returns `['id' => 'sub_fake_'.count, 'status' => 'created']`.
  Settings API: `GET /api/super-admin/settings/system` adds `razorpay_key_id` (plain), `razorpay_key_secret_set` (bool), `razorpay_webhook_secret_set` (bool), `razorpay_mode`, `subscription_grace_days`, `trial_days`, `webhook_url`. `POST` accepts `razorpay_key_id`, `razorpay_key_secret` (blank = keep), `razorpay_webhook_secret` (blank = keep), `razorpay_mode` in `test,live`, `subscription_grace_days` int 0-30, `trial_days` int 1-365.

- [ ] **Step 1: Install SDK**

Run: `/opt/homebrew/bin/php $(which composer || echo /Applications/MAMP/bin/php/composer) require razorpay/razorpay`
If composer isn't found, run `/opt/homebrew/bin/php /Applications/MAMP/bin/php/composer require razorpay/razorpay`. Expected: package added to composer.json.

- [ ] **Step 2: Write failing tests**

```php
<?php
// tests/Feature/Billing/RazorpayGatewayTest.php
namespace Tests\Feature\Billing;

use App\Services\Billing\RazorpayApiGateway;
use App\Services\Billing\RazorpayGateway;
use App\Support\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RazorpayGatewayTest extends TestCase
{
    use RefreshDatabase;

    public function test_container_binds_api_gateway(): void
    {
        $this->assertInstanceOf(RazorpayApiGateway::class, app(RazorpayGateway::class));
    }

    public function test_not_configured_without_keys(): void
    {
        $this->assertFalse(app(RazorpayGateway::class)->isConfigured());
        PlatformSettings::set('razorpay_key_id', 'rzp_test_x');
        PlatformSettings::set('razorpay_key_secret', 'secret');
        $this->assertTrue(app(RazorpayGateway::class)->isConfigured());
        $this->assertSame('rzp_test_x', app(RazorpayGateway::class)->keyId());
    }

    public function test_webhook_signature_is_hmac_sha256_of_body(): void
    {
        PlatformSettings::set('razorpay_webhook_secret', 'whsec');
        $body = '{"event":"subscription.charged"}';
        $good = hash_hmac('sha256', $body, 'whsec');
        $gw = app(RazorpayGateway::class);
        $this->assertTrue($gw->verifyWebhookSignature($body, $good));
        $this->assertFalse($gw->verifyWebhookSignature($body, 'bad'));
    }

    public function test_payment_signature_is_hmac_of_payment_and_subscription(): void
    {
        PlatformSettings::set('razorpay_key_id', 'rzp_test_x');
        PlatformSettings::set('razorpay_key_secret', 'keysecret');
        $sig = hash_hmac('sha256', 'pay_1|sub_1', 'keysecret');
        $gw = app(RazorpayGateway::class);
        $this->assertTrue($gw->verifyPaymentSignature('pay_1', 'sub_1', $sig));
        $this->assertFalse($gw->verifyPaymentSignature('pay_1', 'sub_1', 'nope'));
    }
}
```

```php
<?php
// tests/Feature/Billing/PaymentSettingsTest.php
namespace Tests\Feature\Billing;

use App\Models\User;
use App\Support\PlatformSettings;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PaymentSettingsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $u = User::create(['uuid' => (string) Str::uuid(), 'full_name' => 'SA', 'email' => 'sa@x.test', 'password' => 'x', 'role' => 'super_admin', 'status' => 'active']);
        $u->assignRole('super_admin');
        Sanctum::actingAs($u);
    }

    public function test_saves_keys_and_never_returns_secrets(): void
    {
        $this->postJson('/api/super-admin/settings/system', [
            'razorpay_key_id' => 'rzp_test_abc', 'razorpay_key_secret' => 'sek', 'razorpay_webhook_secret' => 'wh',
            'razorpay_mode' => 'test', 'subscription_grace_days' => 5, 'trial_days' => 10,
        ])->assertOk();

        $res = $this->getJson('/api/super-admin/settings/system')->assertOk();
        $res->assertJsonPath('data.razorpay_key_id', 'rzp_test_abc')
            ->assertJsonPath('data.razorpay_key_secret_set', true)
            ->assertJsonPath('data.razorpay_webhook_secret_set', true)
            ->assertJsonPath('data.subscription_grace_days', 5)
            ->assertJsonPath('data.trial_days', 10);
        $this->assertStringNotContainsString('sek', $res->getContent());
        $this->assertStringEndsWith('/api/webhooks/razorpay', $res->json('data.webhook_url'));
    }

    public function test_blank_secret_keeps_existing(): void
    {
        PlatformSettings::set('razorpay_key_secret', 'keep-me');
        $this->postJson('/api/super-admin/settings/system', ['razorpay_key_secret' => ''])->assertOk();
        $this->assertSame('keep-me', PlatformSettings::get('razorpay_key_secret'));
    }

    public function test_rejects_bad_mode_and_grace(): void
    {
        $this->postJson('/api/super-admin/settings/system', ['razorpay_mode' => 'prod'])->assertStatus(422);
        $this->postJson('/api/super-admin/settings/system', ['subscription_grace_days' => 90])->assertStatus(422);
    }
}
```

- [ ] **Step 3: Run — expect FAIL** (interface missing)

- [ ] **Step 4: Implement**

```php
<?php
// app/Services/Billing/RazorpayGateway.php
namespace App\Services\Billing;

interface RazorpayGateway
{
    public function isConfigured(): bool;
    public function keyId(): ?string;
    public function createPlan(string $period, int $amount, string $name): string;
    public function createSubscription(string $razorpayPlanId, int $totalCount, ?int $startAt, array $notes): array;
    public function cancelSubscription(string $subscriptionId, bool $atCycleEnd): void;
    public function verifyPaymentSignature(string $paymentId, string $subscriptionId, string $signature): bool;
    public function verifyWebhookSignature(string $body, string $signature): bool;
}
```

```php
<?php
// app/Services/Billing/RazorpayApiGateway.php
namespace App\Services\Billing;

use App\Support\PlatformSettings;
use Razorpay\Api\Api;
use RuntimeException;

class RazorpayApiGateway implements RazorpayGateway
{
    public function isConfigured(): bool
    {
        return filled(PlatformSettings::get('razorpay_key_id')) && filled(PlatformSettings::get('razorpay_key_secret'));
    }

    public function keyId(): ?string
    {
        return PlatformSettings::get('razorpay_key_id') ?: null;
    }

    private function api(): Api
    {
        if (! $this->isConfigured()) {
            throw new RuntimeException('Razorpay is not configured.');
        }

        return new Api((string) PlatformSettings::get('razorpay_key_id'), (string) PlatformSettings::get('razorpay_key_secret'));
    }

    public function createPlan(string $period, int $amount, string $name): string
    {
        $plan = $this->api()->plan->create([
            'period' => $period,
            'interval' => 1,
            'item' => ['name' => $name, 'amount' => $amount, 'currency' => 'INR'],
        ]);

        return (string) $plan['id'];
    }

    public function createSubscription(string $razorpayPlanId, int $totalCount, ?int $startAt, array $notes): array
    {
        $payload = ['plan_id' => $razorpayPlanId, 'total_count' => $totalCount, 'customer_notify' => 1, 'notes' => $notes];
        if ($startAt) {
            $payload['start_at'] = $startAt;
        }
        $sub = $this->api()->subscription->create($payload);

        return ['id' => (string) $sub['id'], 'status' => (string) $sub['status']];
    }

    public function cancelSubscription(string $subscriptionId, bool $atCycleEnd): void
    {
        $this->api()->subscription->fetch($subscriptionId)->cancel(['cancel_at_cycle_end' => $atCycleEnd ? 1 : 0]);
    }

    public function verifyPaymentSignature(string $paymentId, string $subscriptionId, string $signature): bool
    {
        $secret = (string) PlatformSettings::get('razorpay_key_secret', '');
        if ($secret === '') {
            return false;
        }

        return hash_equals(hash_hmac('sha256', $paymentId.'|'.$subscriptionId, $secret), $signature);
    }

    public function verifyWebhookSignature(string $body, string $signature): bool
    {
        $secret = (string) PlatformSettings::get('razorpay_webhook_secret', '');
        if ($secret === '' || $signature === '') {
            return false;
        }

        return hash_equals(hash_hmac('sha256', $body, $secret), $signature);
    }
}
```

```php
<?php
// app/Services/Billing/FakeRazorpayGateway.php
namespace App\Services\Billing;

class FakeRazorpayGateway implements RazorpayGateway
{
    public bool $configured = true;
    public bool $signatureValid = true;
    public array $createdPlans = [];
    public array $createdSubscriptions = [];
    public array $cancelled = [];

    public function isConfigured(): bool { return $this->configured; }
    public function keyId(): ?string { return $this->configured ? 'rzp_test_fake' : null; }

    public function createPlan(string $period, int $amount, string $name): string
    {
        $this->createdPlans[] = compact('period', 'amount', 'name');

        return 'plan_fake_'.count($this->createdPlans);
    }

    public function createSubscription(string $razorpayPlanId, int $totalCount, ?int $startAt, array $notes): array
    {
        $this->createdSubscriptions[] = compact('razorpayPlanId', 'totalCount', 'startAt', 'notes');

        return ['id' => 'sub_fake_'.count($this->createdSubscriptions), 'status' => 'created'];
    }

    public function cancelSubscription(string $subscriptionId, bool $atCycleEnd): void
    {
        $this->cancelled[] = compact('subscriptionId', 'atCycleEnd');
    }

    public function verifyPaymentSignature(string $paymentId, string $subscriptionId, string $signature): bool { return $this->signatureValid; }
    public function verifyWebhookSignature(string $body, string $signature): bool { return $this->signatureValid; }
}
```

`AppServiceProvider::register()`: `$this->app->bind(\App\Services\Billing\RazorpayGateway::class, \App\Services\Billing\RazorpayApiGateway::class);`

`SystemSettingController` (show + store response use one `payload()` method):
```php
private function payload(): array
{
    return [
        'openai_api_key' => '',
        'openai_model' => (string) PlatformSettings::get('openai_model', 'gpt-4o-mini'),
        'trial_days' => (int) PlatformSettings::get('trial_days', 14),
        'subscription_grace_days' => (int) PlatformSettings::get('subscription_grace_days', 3),
        'razorpay_key_id' => (string) PlatformSettings::get('razorpay_key_id', ''),
        'razorpay_key_secret_set' => filled(PlatformSettings::get('razorpay_key_secret')),
        'razorpay_webhook_secret_set' => filled(PlatformSettings::get('razorpay_webhook_secret')),
        'razorpay_mode' => (string) PlatformSettings::get('razorpay_mode', 'test'),
        'webhook_url' => rtrim((string) config('app.url'), '/').'/api/webhooks/razorpay',
    ];
}
```
Validation adds: `'razorpay_key_id' => ['nullable','string','max:100'], 'razorpay_key_secret' => ['nullable','string','max:200'], 'razorpay_webhook_secret' => ['nullable','string','max:200'], 'razorpay_mode' => ['nullable','in:test,live'], 'subscription_grace_days' => ['nullable','integer','min:0','max:30']`. Store: `razorpay_key_id`, `razorpay_mode`, `subscription_grace_days`, `trial_days` saved when present (not null); the two secrets saved only when present and non-empty (same pattern as `openai_api_key`).

- [ ] **Step 5: Run tests — expect PASS**; full suite green.

- [ ] **Step 6: Commit**

```bash
git add composer.json composer.lock app/Services/Billing app/Providers/AppServiceProvider.php app/Http/Controllers/Api/SuperAdmin/SystemSettingController.php tests/Feature/Billing
git commit -m "feat(billing): Razorpay gateway boundary and payment settings"
```

---

### Task 3: Plans API (super admin)

**Files:**
- Create: `app/Http/Controllers/Api/SuperAdmin/PlanController.php`
- Modify: `routes/api.php` (super-admin group)
- Test: `tests/Feature/Billing/PlanApiTest.php`

**Interfaces:**
- Produces: `GET /api/super-admin/plans` (all, ordered by sort_order,id; each with `subscribers_count`), `GET /api/super-admin/plans?active=1` (active only), `POST /api/super-admin/plans`, `PUT /api/super-admin/plans/{id}`, `DELETE /api/super-admin/plans/{id}` (soft delete; 422 if any clinic_subscriptions reference it). Body fields: `name` required string max 100, `description` nullable, `monthly_price` required int min 100 (paise), `yearly_price` nullable int min 100, `max_doctors`/`max_staff`/`max_appointments_per_month` nullable int min 1, `is_active` boolean, `sort_order` nullable int min 0.

- [ ] **Step 1: Failing test**

```php
<?php
// tests/Feature/Billing/PlanApiTest.php
namespace Tests\Feature\Billing;

use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PlanApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $u = User::create(['uuid' => (string) Str::uuid(), 'full_name' => 'SA', 'email' => 'sa@x.test', 'password' => 'x', 'role' => 'super_admin', 'status' => 'active']);
        $u->assignRole('super_admin');
        Sanctum::actingAs($u);
    }

    public function test_create_list_update(): void
    {
        $id = $this->postJson('/api/super-admin/plans', [
            'name' => 'Starter', 'monthly_price' => 99900, 'yearly_price' => 999000, 'max_doctors' => 2, 'max_staff' => 3, 'is_active' => true,
        ])->assertCreated()->json('data.id');

        $this->getJson('/api/super-admin/plans')->assertOk()->assertJsonPath('data.0.name', 'Starter')->assertJsonPath('data.0.subscribers_count', 0);
        $this->putJson("/api/super-admin/plans/{$id}", ['name' => 'Starter+', 'monthly_price' => 99900])->assertOk()->assertJsonPath('data.name', 'Starter+');
    }

    public function test_price_change_clears_razorpay_plan_ids(): void
    {
        $plan = Plan::create(['name' => 'Pro', 'monthly_price' => 199900, 'yearly_price' => 1999000,
            'razorpay_plan_id_monthly' => 'plan_m', 'razorpay_plan_id_yearly' => 'plan_y']);

        $this->putJson("/api/super-admin/plans/{$plan->id}", ['name' => 'Pro', 'monthly_price' => 249900, 'yearly_price' => 1999000])->assertOk();

        $plan->refresh();
        $this->assertNull($plan->razorpay_plan_id_monthly);
        $this->assertSame('plan_y', $plan->razorpay_plan_id_yearly);
    }

    public function test_validation_and_delete_rules(): void
    {
        $this->postJson('/api/super-admin/plans', ['name' => 'Bad', 'monthly_price' => 0])->assertStatus(422);

        $plan = Plan::create(['name' => 'Used', 'monthly_price' => 99900]);
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
        ClinicSubscription::create(['clinic_id' => $clinic->id, 'plan_id' => $plan->id, 'billing_cycle' => 'monthly', 'status' => 'active']);
        $this->deleteJson("/api/super-admin/plans/{$plan->id}")->assertStatus(422);

        $unused = Plan::create(['name' => 'Unused', 'monthly_price' => 99900]);
        $this->deleteJson("/api/super-admin/plans/{$unused->id}")->assertOk();
        $this->assertSoftDeleted('plans', ['id' => $unused->id]);
    }

    public function test_clinic_admin_forbidden(): void
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C2', 'slug' => 'c2', 'status' => 'active']);
        $ca = User::create(['clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'CA', 'email' => 'ca@x.test', 'password' => 'x', 'role' => 'clinic_admin', 'status' => 'active']);
        $ca->assignRole('clinic_admin');
        Sanctum::actingAs($ca);
        $this->getJson('/api/super-admin/plans')->assertForbidden();
    }
}
```

- [ ] **Step 2: Run — FAIL (404)**

- [ ] **Step 3: Implement**

```php
<?php
// app/Http/Controllers/Api/SuperAdmin/PlanController.php
namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Models\Plan;
use Illuminate\Http\Request;

class PlanController
{
    use ApiResponse;

    private function rules(bool $partial): array
    {
        $req = $partial ? 'sometimes' : 'required';

        return [
            'name' => [$req, 'string', 'max:100'],
            'description' => ['nullable', 'string', 'max:2000'],
            'monthly_price' => [$req, 'integer', 'min:100'],
            'yearly_price' => ['nullable', 'integer', 'min:100'],
            'max_doctors' => ['nullable', 'integer', 'min:1'],
            'max_staff' => ['nullable', 'integer', 'min:1'],
            'max_appointments_per_month' => ['nullable', 'integer', 'min:1'],
            'is_active' => ['sometimes', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ];
    }

    public function index(Request $request)
    {
        $plans = Plan::query()
            ->withCount('subscriptions as subscribers_count')
            ->when($request->boolean('active'), fn ($q) => $q->where('is_active', true))
            ->orderBy('sort_order')->orderBy('id')
            ->get();

        return $this->success('Plans fetched', $plans);
    }

    public function store(Request $request)
    {
        $plan = Plan::create($request->validate($this->rules(false)));

        return $this->success('Plan created', $plan, 201);
    }

    public function update(Request $request, int $id)
    {
        $plan = Plan::findOrFail($id);
        $data = $request->validate($this->rules(true));

        if (array_key_exists('monthly_price', $data) && (int) $data['monthly_price'] !== (int) $plan->monthly_price) {
            $data['razorpay_plan_id_monthly'] = null;
        }
        if (array_key_exists('yearly_price', $data) && $data['yearly_price'] !== $plan->yearly_price) {
            $data['razorpay_plan_id_yearly'] = null;
        }
        $plan->update($data);

        return $this->success('Plan updated', $plan->refresh());
    }

    public function destroy(int $id)
    {
        $plan = Plan::findOrFail($id);
        if ($plan->subscriptions()->exists()) {
            return $this->error('This plan has clinics on it. Deactivate it instead.', ['plan' => ['in use']], 422);
        }
        $plan->delete();

        return $this->success('Plan deleted', null);
    }
}
```

Routes (inside the `role:super_admin` group, near other settings routes):
```php
Route::get('plans', [SuperAdminPlanController::class, 'index']);
Route::post('plans', [SuperAdminPlanController::class, 'store']);
Route::put('plans/{id}', [SuperAdminPlanController::class, 'update']);
Route::delete('plans/{id}', [SuperAdminPlanController::class, 'destroy']);
```
with `use App\Http\Controllers\Api\SuperAdmin\PlanController as SuperAdminPlanController;`. (If `ApiResponse::error` has a different signature, read `app/Http/Controllers/Concerns/ApiResponse.php` and match it.)

- [ ] **Step 4: Run — PASS**; full suite.
- [ ] **Step 5: Commit** `git add app/Http/Controllers/Api/SuperAdmin/PlanController.php routes/api.php tests/Feature/Billing/PlanApiTest.php && git commit -m "feat(billing): plans API for super admin"`

---

### Task 4: SubscriptionService and onboarding with a plan

**Files:**
- Create: `app/Services/Billing/SubscriptionService.php`
- Modify: `app/Services/ClinicCreationService.php`, `app/Http/Requests/StoreClinicRequest.php`, `app/Http/Controllers/Api/SuperAdmin/ClinicController.php` (pass actor id — already passed), `database/seeders/DemoClinicSeeder.php` (seed plans + subscription)
- Test: `tests/Feature/Billing/OnboardingSubscriptionTest.php`

**Interfaces:**
- Consumes: models (Task 1), `PlatformSettings`.
- Produces `SubscriptionService` (all methods return the updated `ClinicSubscription`):
  ```php
  public function start(Clinic $clinic, Plan $plan, string $cycle, string $mode, array $opts = [], ?int $actorId = null): ClinicSubscription
  // mode trial: opts['trial_days'] (default PlatformSettings trial_days=14) → trialing, trial_ends_at
  // mode pending_payment → pending_payment, grace_ends_at = now + graceDays()
  // mode paid_offline: opts['amount'] (paise, required >0), opts['period_months'] (default 1 monthly/12 yearly), opts['notes'] → active + offline transaction
  public function recordOfflinePayment(ClinicSubscription $sub, int $amount, int $periodMonths, ?string $notes, ?int $actorId): SubscriptionTransaction
  // period starts at max(now, current_period_end); sets active, current_period_start/end, clears grace
  public function activate(ClinicSubscription $sub, ?\DateTimeInterface $periodStart = null, ?\DateTimeInterface $periodEnd = null): ClinicSubscription
  public function markPastDue(ClinicSubscription $sub, string $status = 'past_due'): ClinicSubscription   // sets grace_ends_at if null
  public function graceDays(): int   // PlatformSettings subscription_grace_days default 3
  public function extendTrial(ClinicSubscription $sub, int $days): ClinicSubscription   // trial_ends_at = max(now, trial_ends_at)+days; status trialing
  public function extendGrace(ClinicSubscription $sub, int $days): ClinicSubscription   // grace_ends_at = max(now, grace_ends_at)+days; expired → past_due
  public function changePlan(ClinicSubscription $sub, Plan $plan, string $cycle): ClinicSubscription // 422 if razorpay_subscription_id set
  ```
  Onboarding request body: `subscription: {plan_id, billing_cycle, start_mode, trial_days, offline_amount, offline_period_months, offline_notes}` — `offline_amount` in **paise**.

- [ ] **Step 1: Failing test**

```php
<?php
// tests/Feature/Billing/OnboardingSubscriptionTest.php
namespace Tests\Feature\Billing;

use App\Models\ClinicSubscription;
use App\Models\Plan;
use App\Models\SubscriptionTransaction;
use App\Models\User;
use App\Support\PlatformSettings;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OnboardingSubscriptionTest extends TestCase
{
    use RefreshDatabase;

    private Plan $plan;
    private User $sa;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->sa = User::create(['uuid' => (string) Str::uuid(), 'full_name' => 'SA', 'email' => 'sa@x.test', 'password' => 'x', 'role' => 'super_admin', 'status' => 'active']);
        $this->sa->assignRole('super_admin');
        Sanctum::actingAs($this->sa);
        $this->plan = Plan::create(['name' => 'Starter', 'monthly_price' => 99900, 'yearly_price' => 999000]);
    }

    private function onboard(string $slug, array $subscription)
    {
        return $this->postJson('/api/super-admin/clinics', [
            'name' => 'Clinic '.$slug, 'slug' => $slug,
            'subscription' => array_merge(['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly'], $subscription),
        ]);
    }

    public function test_trial_mode(): void
    {
        $id = $this->onboard('t1', ['start_mode' => 'trial', 'trial_days' => 7])->assertCreated()->json('data.id');
        $sub = ClinicSubscription::where('clinic_id', $id)->firstOrFail();
        $this->assertSame('trialing', $sub->status);
        $this->assertEqualsWithDelta(now()->addDays(7)->timestamp, $sub->trial_ends_at->timestamp, 5);
    }

    public function test_trial_defaults_to_setting(): void
    {
        PlatformSettings::set('trial_days', 21);
        $id = $this->onboard('t2', ['start_mode' => 'trial'])->assertCreated()->json('data.id');
        $this->assertEqualsWithDelta(now()->addDays(21)->timestamp, ClinicSubscription::where('clinic_id', $id)->first()->trial_ends_at->timestamp, 5);
    }

    public function test_pending_payment_mode_sets_grace(): void
    {
        PlatformSettings::set('subscription_grace_days', 4);
        $id = $this->onboard('p1', ['start_mode' => 'pending_payment'])->assertCreated()->json('data.id');
        $sub = ClinicSubscription::where('clinic_id', $id)->first();
        $this->assertSame('pending_payment', $sub->status);
        $this->assertEqualsWithDelta(now()->addDays(4)->timestamp, $sub->grace_ends_at->timestamp, 5);
    }

    public function test_paid_offline_mode_creates_transaction(): void
    {
        $id = $this->onboard('o1', ['start_mode' => 'paid_offline', 'billing_cycle' => 'yearly', 'offline_amount' => 999000, 'offline_notes' => 'Bank transfer'])
            ->assertCreated()->json('data.id');
        $sub = ClinicSubscription::where('clinic_id', $id)->first();
        $this->assertSame('active', $sub->status);
        $this->assertEqualsWithDelta(now()->addMonths(12)->timestamp, $sub->current_period_end->timestamp, 5);
        $tx = SubscriptionTransaction::where('clinic_id', $id)->firstOrFail();
        $this->assertSame(['captured', 'offline', 999000, $this->sa->id], [$tx->status, $tx->source, $tx->amount, $tx->recorded_by]);
    }

    public function test_validation(): void
    {
        $this->onboard('v1', ['start_mode' => 'paid_offline'])->assertStatus(422);            // amount required
        $this->onboard('v2', ['start_mode' => 'bogus'])->assertStatus(422);
        $inactive = Plan::create(['name' => 'Old', 'monthly_price' => 99900, 'is_active' => false]);
        $this->onboard('v3', ['plan_id' => $inactive->id, 'start_mode' => 'trial'])->assertStatus(422);
        $noYear = Plan::create(['name' => 'M', 'monthly_price' => 99900]);
        $this->onboard('v4', ['plan_id' => $noYear->id, 'billing_cycle' => 'yearly', 'start_mode' => 'trial'])->assertStatus(422);
    }

    public function test_onboarding_without_subscription_still_works(): void
    {
        $this->postJson('/api/super-admin/clinics', ['name' => 'Bare', 'slug' => 'bare'])->assertCreated();
    }
}
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```php
<?php
// app/Services/Billing/SubscriptionService.php
namespace App\Services\Billing;

use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use App\Models\SubscriptionTransaction;
use App\Support\PlatformSettings;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SubscriptionService
{
    public function graceDays(): int
    {
        return max(0, (int) PlatformSettings::get('subscription_grace_days', 3));
    }

    public function start(Clinic $clinic, Plan $plan, string $cycle, string $mode, array $opts = [], ?int $actorId = null): ClinicSubscription
    {
        return DB::transaction(function () use ($clinic, $plan, $cycle, $mode, $opts, $actorId) {
            $sub = ClinicSubscription::create([
                'clinic_id' => $clinic->id,
                'plan_id' => $plan->id,
                'billing_cycle' => $cycle,
                'status' => 'pending_payment',
                'grace_ends_at' => now()->addDays($this->graceDays()),
            ]);

            if ($mode === 'trial') {
                $days = (int) ($opts['trial_days'] ?? PlatformSettings::get('trial_days', 14));
                $sub->update(['status' => 'trialing', 'trial_ends_at' => now()->addDays(max(1, $days)), 'grace_ends_at' => null]);
            } elseif ($mode === 'paid_offline') {
                $months = (int) ($opts['period_months'] ?? ($cycle === 'yearly' ? 12 : 1));
                $this->recordOfflinePayment($sub, (int) $opts['amount'], max(1, $months), $opts['notes'] ?? null, $actorId);
            }

            return $sub->refresh();
        });
    }

    public function recordOfflinePayment(ClinicSubscription $sub, int $amount, int $periodMonths, ?string $notes, ?int $actorId): SubscriptionTransaction
    {
        return DB::transaction(function () use ($sub, $amount, $periodMonths, $notes, $actorId) {
            $start = $sub->current_period_end && $sub->current_period_end->isFuture() ? $sub->current_period_end->copy() : now();
            $end = $start->copy()->addMonths($periodMonths);

            $tx = SubscriptionTransaction::create([
                'clinic_id' => $sub->clinic_id, 'clinic_subscription_id' => $sub->id, 'plan_id' => $sub->plan_id,
                'billing_cycle' => $sub->billing_cycle, 'amount' => $amount, 'status' => 'captured', 'source' => 'offline',
                'notes' => $notes, 'recorded_by' => $actorId, 'paid_at' => now(), 'period_start' => $start, 'period_end' => $end,
            ]);
            $this->activate($sub, $start, $end);

            return $tx;
        });
    }

    public function activate(ClinicSubscription $sub, ?\DateTimeInterface $periodStart = null, ?\DateTimeInterface $periodEnd = null): ClinicSubscription
    {
        $sub->update(array_filter([
            'status' => 'active',
            'grace_ends_at' => null,
            'current_period_start' => $periodStart ? Carbon::instance($periodStart) : null,
            'current_period_end' => $periodEnd ? Carbon::instance($periodEnd) : null,
        ], fn ($v, $k) => $v !== null || $k === 'grace_ends_at', ARRAY_FILTER_USE_BOTH));

        return $sub->refresh();
    }

    public function markPastDue(ClinicSubscription $sub, string $status = 'past_due'): ClinicSubscription
    {
        $sub->update([
            'status' => $status,
            'grace_ends_at' => $sub->grace_ends_at ?? now()->addDays($this->graceDays()),
        ]);

        return $sub->refresh();
    }

    public function extendTrial(ClinicSubscription $sub, int $days): ClinicSubscription
    {
        $base = $sub->trial_ends_at && $sub->trial_ends_at->isFuture() ? $sub->trial_ends_at->copy() : now();
        $sub->update(['status' => 'trialing', 'trial_ends_at' => $base->addDays($days), 'grace_ends_at' => null]);

        return $sub->refresh();
    }

    public function extendGrace(ClinicSubscription $sub, int $days): ClinicSubscription
    {
        $base = $sub->grace_ends_at && $sub->grace_ends_at->isFuture() ? $sub->grace_ends_at->copy() : now();
        $status = in_array($sub->status, ['expired', 'trialing'], true) ? 'past_due' : $sub->status;
        $sub->update(['status' => $status, 'grace_ends_at' => $base->addDays($days)]);

        return $sub->refresh();
    }

    public function changePlan(ClinicSubscription $sub, Plan $plan, string $cycle): ClinicSubscription
    {
        if ($sub->razorpay_subscription_id) {
            throw ValidationException::withMessages(['plan' => 'This clinic pays through Razorpay. Cancel the subscription before changing plan.']);
        }
        $sub->update(['plan_id' => $plan->id, 'billing_cycle' => $cycle]);

        return $sub->refresh();
    }
}
```

`StoreClinicRequest::rules()` add:
```php
'subscription' => ['nullable', 'array'],
'subscription.plan_id' => ['required_with:subscription', 'integer', Rule::exists('plans', 'id')->where('is_active', true)->whereNull('deleted_at')],
'subscription.billing_cycle' => ['required_with:subscription', 'in:monthly,yearly'],
'subscription.start_mode' => ['required_with:subscription', 'in:trial,pending_payment,paid_offline'],
'subscription.trial_days' => ['sometimes', 'integer', 'min:1', 'max:365'],
'subscription.offline_amount' => ['required_if:subscription.start_mode,paid_offline', 'integer', 'min:1'],
'subscription.offline_period_months' => ['sometimes', 'integer', 'min:1', 'max:36'],
'subscription.offline_notes' => ['nullable', 'string', 'max:500'],
```
(import `Illuminate\Validation\Rule`). Also add an `after` hook / `withValidator` — or, since `ClinicController::store` uses `validator($request->all(), rules())`, add the yearly check in `ClinicCreationService` by throwing `ValidationException::withMessages(['subscription.billing_cycle' => 'This plan has no yearly price.'])` when `billing_cycle = yearly` and `$plan->yearly_price === null`. Because `create()` runs inside `DB::transaction`, the exception rolls back the clinic.

`ClinicCreationService`: inject `SubscriptionService` in the constructor (`private readonly SubscriptionService $subscriptions`); change `except([...])` to also exclude `'subscription'`; after `ClinicSetting::firstOrCreate(...)` add:
```php
if (! empty($data['subscription'])) {
    $s = $data['subscription'];
    $plan = Plan::findOrFail($s['plan_id']);
    if ($s['billing_cycle'] === 'yearly' && $plan->yearly_price === null) {
        throw ValidationException::withMessages(['subscription.billing_cycle' => 'This plan has no yearly price.']);
    }
    $this->subscriptions->start($clinic, $plan, $s['billing_cycle'], $s['start_mode'], [
        'trial_days' => $s['trial_days'] ?? null,
        'amount' => $s['offline_amount'] ?? null,
        'period_months' => $s['offline_period_months'] ?? null,
        'notes' => $s['offline_notes'] ?? null,
    ], $actorUserId);
}
```
In `start()`, treat `trial_days` null as "use setting" (`$opts['trial_days'] ?? PlatformSettings::get(...)` already does).

`DemoClinicSeeder`: before creating the clinic, create plans (idempotent `firstOrCreate` by name):
- Starter — monthly 99900, yearly 999000, max_doctors 2, max_staff 3, max_appointments_per_month 300, sort_order 1
- Pro — monthly 249900, yearly 2499000, max_doctors 10, max_staff 15, max_appointments_per_month null, sort_order 2
and pass `'subscription' => ['plan_id' => $starter->id, 'billing_cycle' => 'monthly', 'start_mode' => 'trial', 'trial_days' => 14]` to the clinic creation data.

- [ ] **Step 4: Run — PASS**; full suite (fix `ClinicCreationTest` only if it constructs the service manually — resolve it from the container).
- [ ] **Step 5: Commit** `git add app/Services app/Http/Requests/StoreClinicRequest.php database/seeders tests/Feature/Billing && git commit -m "feat(billing): subscription service and plan selection at onboarding"`

---

### Task 5: Lifecycle job, lock middleware, context

**Files:**
- Create: `app/Console/Commands/SyncSubscriptions.php`, `app/Http/Middleware/EnsureClinicSubscription.php`
- Modify: `routes/console.php`, `bootstrap/app.php` (alias `clinic.subscription`), `routes/api.php` (clinic group middleware), `app/Http/Controllers/Api/Clinic/MeController.php`
- Test: `tests/Feature/Billing/SubscriptionLifecycleTest.php`, `tests/Feature/Billing/SubscriptionLockTest.php`

**Interfaces:**
- Consumes: `SubscriptionService::markPastDue`, `ClinicSubscription::allowsAccess`.
- Produces: artisan `subscriptions:sync`; middleware alias `clinic.subscription`; `me/context` adds
  `subscription: null | {status, plan_name, billing_cycle, trial_ends_at, grace_ends_at, current_period_end, allows_access}` (ISO strings) and `clinic_trial_ends_at` stays (from subscription).

- [ ] **Step 1: Failing tests**

```php
<?php
// tests/Feature/Billing/SubscriptionLifecycleTest.php
namespace Tests\Feature\Billing;

use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class SubscriptionLifecycleTest extends TestCase
{
    use RefreshDatabase;

    private function sub(array $attrs): ClinicSubscription
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c'.Str::random(5), 'status' => 'active']);
        $plan = Plan::firstOrCreate(['name' => 'Starter'], ['monthly_price' => 99900]);

        return ClinicSubscription::create(array_merge(['clinic_id' => $clinic->id, 'plan_id' => $plan->id, 'billing_cycle' => 'monthly'], $attrs));
    }

    public function test_sync_transitions(): void
    {
        $endedTrial = $this->sub(['status' => 'trialing', 'trial_ends_at' => now()->subHour()]);
        $liveTrial = $this->sub(['status' => 'trialing', 'trial_ends_at' => now()->addDay()]);
        $razorpayTrial = $this->sub(['status' => 'trialing', 'trial_ends_at' => now()->subHour(), 'razorpay_subscription_id' => 'sub_1']);
        $offlineLapsed = $this->sub(['status' => 'active', 'current_period_end' => now()->subHour()]);
        $graceOver = $this->sub(['status' => 'past_due', 'grace_ends_at' => now()->subHour()]);
        $pendingOver = $this->sub(['status' => 'pending_payment', 'grace_ends_at' => now()->subHour()]);
        $graceLive = $this->sub(['status' => 'past_due', 'grace_ends_at' => now()->addDay()]);

        $this->artisan('subscriptions:sync')->assertSuccessful();

        $this->assertSame('pending_payment', $endedTrial->refresh()->status);
        $this->assertNotNull($endedTrial->grace_ends_at);
        $this->assertSame('trialing', $liveTrial->refresh()->status);
        $this->assertSame('trialing', $razorpayTrial->refresh()->status); // Razorpay drives it via webhooks
        $this->assertSame('past_due', $offlineLapsed->refresh()->status);
        $this->assertSame('expired', $graceOver->refresh()->status);
        $this->assertSame('expired', $pendingOver->refresh()->status);
        $this->assertSame('past_due', $graceLive->refresh()->status);
    }
}
```

```php
<?php
// tests/Feature/Billing/SubscriptionLockTest.php
namespace Tests\Feature\Billing;

use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SubscriptionLockTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    private function clinicWith(?array $sub, string $clinicStatus = 'active'): User
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c'.Str::random(5), 'status' => $clinicStatus]);
        if ($sub) {
            $plan = Plan::firstOrCreate(['name' => 'Starter'], ['monthly_price' => 99900]);
            ClinicSubscription::create(array_merge(['clinic_id' => $clinic->id, 'plan_id' => $plan->id, 'billing_cycle' => 'monthly'], $sub));
        }
        $u = User::create(['clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'A', 'email' => Str::random(6).'@x.test', 'password' => 'x', 'role' => 'clinic_admin', 'status' => 'active']);
        $u->assignRole('clinic_admin');

        return $u;
    }

    public function test_expired_clinic_is_locked_except_allowed_routes(): void
    {
        Sanctum::actingAs($this->clinicWith(['status' => 'expired']));

        $this->getJson('/api/clinic/patients')->assertStatus(402)->assertJsonPath('code', 'SUBSCRIPTION_REQUIRED');
        $ctx = $this->getJson('/api/clinic/me/context')->assertOk();
        $ctx->assertJsonPath('data.subscription.status', 'expired')->assertJsonPath('data.subscription.allows_access', false);
    }

    public function test_grace_period_allows_access(): void
    {
        Sanctum::actingAs($this->clinicWith(['status' => 'past_due', 'grace_ends_at' => now()->addDay()]));
        $this->getJson('/api/clinic/patients')->assertOk();
    }

    public function test_suspended_clinic_is_locked_even_if_active(): void
    {
        Sanctum::actingAs($this->clinicWith(['status' => 'active'], 'suspended'));
        $this->getJson('/api/clinic/patients')->assertStatus(402);
    }

    public function test_clinic_without_subscription_is_not_locked(): void
    {
        Sanctum::actingAs($this->clinicWith(null));
        $this->getJson('/api/clinic/patients')->assertOk();
        $this->getJson('/api/clinic/me/context')->assertOk()->assertJsonPath('data.subscription', null);
    }
}
```

(`GET /api/clinic/subscription` allowance is covered in Task 6 once that route exists.)

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```php
<?php
// app/Console/Commands/SyncSubscriptions.php
namespace App\Console\Commands;

use App\Models\ClinicSubscription;
use App\Services\Billing\SubscriptionService;
use Illuminate\Console\Command;

class SyncSubscriptions extends Command
{
    protected $signature = 'subscriptions:sync';

    protected $description = 'Move trials, offline periods and grace periods to their next subscription state';

    public function handle(SubscriptionService $service): int
    {
        $now = now();
        $count = 0;

        ClinicSubscription::query()->where('status', 'trialing')->whereNull('razorpay_subscription_id')
            ->whereNotNull('trial_ends_at')->where('trial_ends_at', '<=', $now)
            ->each(function (ClinicSubscription $s) use ($service, &$count) { $service->markPastDue($s, 'pending_payment'); $count++; });

        ClinicSubscription::query()->where('status', 'active')->whereNull('razorpay_subscription_id')
            ->whereNotNull('current_period_end')->where('current_period_end', '<=', $now)
            ->each(function (ClinicSubscription $s) use ($service, &$count) { $s->update(['grace_ends_at' => null]); $service->markPastDue($s, 'past_due'); $count++; });

        $count += ClinicSubscription::query()->whereIn('status', ['pending_payment', 'past_due'])
            ->whereNotNull('grace_ends_at')->where('grace_ends_at', '<=', $now)
            ->update(['status' => 'expired']);

        $this->info("Updated {$count} subscription(s).");

        return self::SUCCESS;
    }
}
```

`routes/console.php`: `use App\Console\Commands\SyncSubscriptions;` and `Schedule::command(SyncSubscriptions::class)->hourly();`

```php
<?php
// app/Http/Middleware/EnsureClinicSubscription.php
namespace App\Http\Middleware;

use App\Models\Clinic;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureClinicSubscription
{
    private const ALWAYS_ALLOWED = [
        ['GET', 'api/clinic/me/context'],
        ['GET', 'api/clinic/subscription'],
        ['POST', 'api/clinic/subscription/checkout'],
        ['POST', 'api/clinic/subscription/verify'],
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (! $user || $user->role === 'super_admin') {
            return $next($request);
        }

        foreach (self::ALWAYS_ALLOWED as [$method, $path]) {
            if ($request->isMethod($method) && $request->is($path)) {
                return $next($request);
            }
        }

        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $user->clinic_id);
        $clinic = Clinic::query()->with('subscription')->find($clinicId);

        $locked = $clinic && ($clinic->status === 'suspended'
            || ($clinic->subscription && ! $clinic->subscription->allowsAccess()));

        if ($locked) {
            return response()->json([
                'success' => false,
                'code' => 'SUBSCRIPTION_REQUIRED',
                'message' => $clinic->status === 'suspended'
                    ? 'This clinic has been suspended. Contact support.'
                    : 'Your clinic subscription is inactive. Renew it to continue.',
            ], 402);
        }

        return $next($request);
    }
}
```

`bootstrap/app.php` alias: `'clinic.subscription' => \App\Http\Middleware\EnsureClinicSubscription::class,`
`routes/api.php` clinic group: `Route::middleware(['auth:sanctum', 'clinic.scope', 'clinic.context', 'clinic.subscription'])->prefix('clinic')->group(...)`

`MeController::context`: load `$clinic = Clinic::query()->with('subscription.plan:id,name')->select(['id','name','status','logo_url'])->find($clinicId);` then add
```php
'subscription' => $clinic?->subscription ? [
    'status' => $clinic->subscription->status,
    'plan_name' => $clinic->subscription->plan?->name,
    'billing_cycle' => $clinic->subscription->billing_cycle,
    'trial_ends_at' => $clinic->subscription->trial_ends_at?->toISOString(),
    'grace_ends_at' => $clinic->subscription->grace_ends_at?->toISOString(),
    'current_period_end' => $clinic->subscription->current_period_end?->toISOString(),
    'allows_access' => $clinic->status !== 'suspended' && $clinic->subscription->allowsAccess(),
] : null,
```

- [ ] **Step 4: Run — PASS**; full suite (existing clinic tests have no subscription row → unaffected).
- [ ] **Step 5: Commit** `git add app/Console app/Http/Middleware/EnsureClinicSubscription.php bootstrap/app.php routes app/Http/Controllers/Api/Clinic/MeController.php tests/Feature/Billing && git commit -m "feat(billing): subscription lifecycle job, 402 lock and context"`

---

### Task 6: Clinic admin subscription API (status, checkout, verify)

**Files:**
- Create: `app/Http/Controllers/Api/Clinic/SubscriptionController.php`, `app/Services/Billing/PlanLimits.php` (usage part only; `assertCanAdd` in Task 9)
- Modify: `routes/api.php`, `app/Services/Billing/SubscriptionService.php` (add `beginCheckout`, `confirmCheckout`)
- Test: `tests/Feature/Billing/ClinicCheckoutTest.php`

**Interfaces:**
- Consumes: `RazorpayGateway`, `SubscriptionService`, models.
- Produces:
  - `PlanLimits::usage(Clinic $clinic): array` → `['doctors' => int, 'staff' => int, 'appointments' => int]` (appointments: `created_at` in current calendar month, status ≠ cancelled; doctors: non-soft-deleted; staff: users in clinic with role ≠ doctor)
  - `SubscriptionService::beginCheckout(ClinicSubscription $sub, Plan $plan, string $cycle): array` → `['subscription_id' => string, 'key_id' => string]`
  - `SubscriptionService::confirmCheckout(ClinicSubscription $sub, string $paymentId, string $subscriptionId, string $signature): ClinicSubscription`
  - `GET /api/clinic/subscription` → `{subscription, plan, usage, limits, plans, transactions, razorpay_key_id, payments_configured}`
  - `POST /api/clinic/subscription/checkout {plan_id, billing_cycle}` → `{subscription_id, key_id, name, email, phone, amount}`
  - `POST /api/clinic/subscription/verify {razorpay_payment_id, razorpay_subscription_id, razorpay_signature}`

- [ ] **Step 1: Failing test**

```php
<?php
// tests/Feature/Billing/ClinicCheckoutTest.php
namespace Tests\Feature\Billing;

use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use App\Models\User;
use App\Services\Billing\FakeRazorpayGateway;
use App\Services\Billing\RazorpayGateway;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ClinicCheckoutTest extends TestCase
{
    use RefreshDatabase;

    private FakeRazorpayGateway $gw;
    private Clinic $clinic;
    private Plan $plan;
    private ClinicSubscription $sub;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->gw = new FakeRazorpayGateway();
        $this->app->instance(RazorpayGateway::class, $this->gw);
        $this->clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
        $this->plan = Plan::create(['name' => 'Starter', 'monthly_price' => 99900, 'yearly_price' => 999000, 'max_doctors' => 2]);
        $this->sub = ClinicSubscription::create(['clinic_id' => $this->clinic->id, 'plan_id' => $this->plan->id, 'billing_cycle' => 'monthly',
            'status' => 'trialing', 'trial_ends_at' => now()->addDays(5)]);
    }

    private function actingAsRole(string $role): User
    {
        $u = User::create(['clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => $role, 'email' => $role.'@x.test', 'password' => 'x', 'role' => $role, 'status' => 'active']);
        $u->assignRole($role);
        Sanctum::actingAs($u);

        return $u;
    }

    public function test_status_endpoint(): void
    {
        $this->actingAsRole('clinic_admin');
        $this->getJson('/api/clinic/subscription')->assertOk()
            ->assertJsonPath('data.subscription.status', 'trialing')
            ->assertJsonPath('data.plan.name', 'Starter')
            ->assertJsonPath('data.limits.doctors', 2)
            ->assertJsonPath('data.usage.staff', 1)
            ->assertJsonPath('data.payments_configured', true);
    }

    public function test_checkout_creates_razorpay_plan_when_missing_and_starts_after_trial(): void
    {
        $this->actingAsRole('clinic_admin');
        $res = $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly'])->assertOk();

        $res->assertJsonPath('data.subscription_id', 'sub_fake_1')->assertJsonPath('data.key_id', 'rzp_test_fake');
        $this->assertSame([['period' => 'monthly', 'amount' => 99900, 'name' => 'Starter (monthly)']], $this->gw->createdPlans);
        $this->assertSame('plan_fake_1', $this->plan->refresh()->razorpay_plan_id_monthly);
        $created = $this->gw->createdSubscriptions[0];
        $this->assertSame(120, $created['totalCount']);
        $this->assertEqualsWithDelta($this->sub->trial_ends_at->timestamp, $created['startAt'], 2);
        $this->assertSame('sub_fake_1', $this->sub->refresh()->razorpay_subscription_id);

        // second checkout reuses the stored Razorpay plan
        $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly'])->assertOk();
        $this->assertCount(1, $this->gw->createdPlans);
    }

    public function test_checkout_yearly_count_and_no_start_at_when_not_trialing(): void
    {
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null]);
        $this->actingAsRole('clinic_admin');
        $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'yearly'])->assertOk();
        $this->assertSame(10, $this->gw->createdSubscriptions[0]['totalCount']);
        $this->assertNull($this->gw->createdSubscriptions[0]['startAt']);
    }

    public function test_checkout_forbidden_for_non_admin(): void
    {
        $this->actingAsRole('receptionist');
        $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly'])->assertForbidden();
    }

    public function test_checkout_rejections(): void
    {
        $this->actingAsRole('clinic_admin');
        $monthlyOnly = Plan::create(['name' => 'M', 'monthly_price' => 50000]);
        $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $monthlyOnly->id, 'billing_cycle' => 'yearly'])->assertStatus(422);
        $inactive = Plan::create(['name' => 'Old', 'monthly_price' => 50000, 'is_active' => false]);
        $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $inactive->id, 'billing_cycle' => 'monthly'])->assertStatus(422);
        $this->gw->configured = false;
        $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly'])
            ->assertStatus(422)->assertJsonFragment(['message' => 'Online payments are not configured yet.']);
    }

    public function test_verify(): void
    {
        $this->actingAsRole('clinic_admin');
        $this->sub->update(['razorpay_subscription_id' => 'sub_fake_1', 'status' => 'expired']);

        $this->gw->signatureValid = false;
        $this->postJson('/api/clinic/subscription/verify', ['razorpay_payment_id' => 'pay_1', 'razorpay_subscription_id' => 'sub_fake_1', 'razorpay_signature' => 'x'])->assertStatus(422);

        $this->gw->signatureValid = true;
        $this->postJson('/api/clinic/subscription/verify', ['razorpay_payment_id' => 'pay_1', 'razorpay_subscription_id' => 'sub_fake_1', 'razorpay_signature' => 'x'])->assertOk();
        $this->assertSame('active', $this->sub->refresh()->status);
    }

    public function test_locked_clinic_can_still_reach_subscription_endpoints(): void
    {
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null]);
        $this->actingAsRole('clinic_admin');
        $this->getJson('/api/clinic/patients')->assertStatus(402);
        $this->getJson('/api/clinic/subscription')->assertOk();
        $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly'])->assertOk();
    }
}
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`PlanLimits.php` (usage now; Task 9 adds `assertCanAdd`):
```php
<?php
namespace App\Services\Billing;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\User;

class PlanLimits
{
    public function count(int $clinicId, string $resource): int
    {
        return match ($resource) {
            'doctors' => Doctor::query()->where('clinic_id', $clinicId)->count(),
            'staff' => User::query()->where('clinic_id', $clinicId)->where('role', '!=', 'doctor')->count(),
            'appointments' => Appointment::query()->where('clinic_id', $clinicId)
                ->whereBetween('created_at', [now()->startOfMonth(), now()->endOfMonth()])
                ->where('status', '!=', 'cancelled')->count(),
        };
    }

    public function usage(Clinic $clinic): array
    {
        return [
            'doctors' => $this->count($clinic->id, 'doctors'),
            'staff' => $this->count($clinic->id, 'staff'),
            'appointments' => $this->count($clinic->id, 'appointments'),
        ];
    }
}
```
(Doctor uses `SoftDeletes` → default query excludes trashed. If `Appointment`/`Doctor` have a global clinic scope via `BelongsToClinicScope`, check that `where('clinic_id', ...)` still applies correctly outside request context; use `withoutGlobalScopes()` only if the trait adds a request-bound scope.)

`SubscriptionService` additions (constructor gains `private readonly RazorpayGateway $gateway`):
```php
public function beginCheckout(ClinicSubscription $sub, Plan $plan, string $cycle): array
{
    if (! $this->gateway->isConfigured()) {
        throw ValidationException::withMessages(['payments' => 'Online payments are not configured yet.']);
    }
    if (! $plan->is_active) {
        throw ValidationException::withMessages(['plan_id' => 'This plan is not available.']);
    }
    $amount = $plan->priceFor($cycle);
    if ($amount === null) {
        throw ValidationException::withMessages(['billing_cycle' => 'This plan has no yearly price.']);
    }

    $column = $cycle === 'yearly' ? 'razorpay_plan_id_yearly' : 'razorpay_plan_id_monthly';
    if (! $plan->{$column}) {
        $plan->update([$column => $this->gateway->createPlan($cycle, $amount, "{$plan->name} ({$cycle})")]);
    }

    $startAt = $sub->status === 'trialing' && $sub->trial_ends_at && $sub->trial_ends_at->isFuture()
        ? $sub->trial_ends_at->timestamp : null;

    $created = $this->gateway->createSubscription($plan->{$column}, $cycle === 'yearly' ? 10 : 120, $startAt, [
        'clinic_id' => (string) $sub->clinic_id, 'plan_id' => (string) $plan->id, 'billing_cycle' => $cycle,
    ]);

    $sub->update(['plan_id' => $plan->id, 'billing_cycle' => $cycle, 'razorpay_subscription_id' => $created['id']]);

    return ['subscription_id' => $created['id'], 'key_id' => (string) $this->gateway->keyId(), 'amount' => $amount];
}

public function confirmCheckout(ClinicSubscription $sub, string $paymentId, string $subscriptionId, string $signature): ClinicSubscription
{
    if ($sub->razorpay_subscription_id !== $subscriptionId || ! $this->gateway->verifyPaymentSignature($paymentId, $subscriptionId, $signature)) {
        throw ValidationException::withMessages(['razorpay_signature' => 'Payment could not be verified.']);
    }

    return $sub->status === 'trialing' ? $sub->refresh() : $this->activate($sub);
}
```
(`confirmCheckout` keeps a trialing clinic `trialing` — its first charge happens at trial end, and the `subscription.activated`/`charged` webhooks move it to `active`.)

Note: the "not configured" validation error must surface as JSON `message` "Online payments are not configured yet." — Laravel's ValidationException JSON uses the first error as `message`, which satisfies the test's `assertJsonFragment`.

Controller:
```php
<?php
// app/Http/Controllers/Api/Clinic/SubscriptionController.php
namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use App\Models\SubscriptionTransaction;
use App\Services\Billing\PlanLimits;
use App\Services\Billing\RazorpayGateway;
use App\Services\Billing\SubscriptionService;
use Illuminate\Http\Request;

class SubscriptionController
{
    use ApiResponse;

    public function __construct(
        private readonly SubscriptionService $service,
        private readonly PlanLimits $limits,
        private readonly RazorpayGateway $gateway,
    ) {}

    private function clinic(Request $request): Clinic
    {
        return Clinic::query()->with('subscription.plan')->findOrFail((int) ($request->attributes->get('clinic_id') ?? $request->user()->clinic_id));
    }

    private function subscriptionOrFail(Clinic $clinic): ClinicSubscription
    {
        abort_unless($clinic->subscription, 404, 'This clinic has no subscription.');

        return $clinic->subscription;
    }

    public function show(Request $request)
    {
        $clinic = $this->clinic($request);
        $sub = $clinic->subscription;
        $plan = $sub?->plan;

        return $this->success('Subscription fetched', [
            'subscription' => $sub,
            'plan' => $plan,
            'usage' => $this->limits->usage($clinic),
            'limits' => [
                'doctors' => $plan?->limitFor('doctors'),
                'staff' => $plan?->limitFor('staff'),
                'appointments' => $plan?->limitFor('appointments'),
            ],
            'plans' => Plan::query()->where('is_active', true)->orderBy('sort_order')->orderBy('id')
                ->get(['id', 'name', 'description', 'monthly_price', 'yearly_price', 'max_doctors', 'max_staff', 'max_appointments_per_month']),
            'transactions' => SubscriptionTransaction::query()->where('clinic_id', $clinic->id)->with('plan:id,name')
                ->latest()->limit(50)->get(),
            'razorpay_key_id' => $this->gateway->keyId(),
            'payments_configured' => $this->gateway->isConfigured(),
        ]);
    }

    public function checkout(Request $request)
    {
        abort_unless($request->user()->role === 'clinic_admin', 403, 'Only the clinic admin can manage the subscription.');
        $data = $request->validate(['plan_id' => ['required', 'integer'], 'billing_cycle' => ['required', 'in:monthly,yearly']]);
        $clinic = $this->clinic($request);
        $plan = Plan::query()->find($data['plan_id']);
        if (! $plan) {
            return $this->error('Plan not found.', ['plan_id' => ['Plan not found.']], 422);
        }

        $result = $this->service->beginCheckout($this->subscriptionOrFail($clinic), $plan, $data['billing_cycle']);
        $admin = $request->user();

        return $this->success('Checkout started', $result + [
            'name' => $clinic->name, 'email' => $admin->email, 'phone' => $admin->phone,
        ]);
    }

    public function verify(Request $request)
    {
        abort_unless($request->user()->role === 'clinic_admin', 403);
        $data = $request->validate([
            'razorpay_payment_id' => ['required', 'string'],
            'razorpay_subscription_id' => ['required', 'string'],
            'razorpay_signature' => ['required', 'string'],
        ]);
        $sub = $this->service->confirmCheckout($this->subscriptionOrFail($this->clinic($request)),
            $data['razorpay_payment_id'], $data['razorpay_subscription_id'], $data['razorpay_signature']);

        return $this->success('Payment verified', $sub);
    }
}
```

Routes (clinic group): `Route::get('subscription', [ClinicSubscriptionController::class, 'show']); Route::post('subscription/checkout', [...,'checkout']); Route::post('subscription/verify', [...,'verify']);` with `use App\Http\Controllers\Api\Clinic\SubscriptionController as ClinicSubscriptionController;`

- [ ] **Step 4: Run — PASS**; full suite.
- [ ] **Step 5: Commit** `git add app routes tests/Feature/Billing && git commit -m "feat(billing): clinic admin subscription status, Razorpay checkout and verify"`

---

### Task 7: Razorpay webhook

**Files:**
- Create: `app/Http/Controllers/Api/RazorpayWebhookController.php`, `app/Services/Billing/RazorpayWebhookHandler.php`
- Modify: `routes/api.php` (public route, outside auth groups)
- Test: `tests/Feature/Billing/RazorpayWebhookTest.php`

**Interfaces:**
- Consumes: `RazorpayGateway::verifyWebhookSignature`, `SubscriptionService::activate`, `::markPastDue`.
- Produces: `POST /api/webhooks/razorpay` → 200 `{"ok":true}` / 400 invalid signature.

Payload shapes used (Razorpay): `event`, `payload.subscription.entity` (`id`, `status`, `current_start`, `current_end` unix), `payload.payment.entity` (`id`, `amount`, `method`, `invoice_id`, `error_description`, `subscription_id` may be absent; also `notes`), `payload.invoice.entity` (`id`, `short_url`) when present.

- [ ] **Step 1: Failing test**

```php
<?php
// tests/Feature/Billing/RazorpayWebhookTest.php
namespace Tests\Feature\Billing;

use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use App\Models\SubscriptionTransaction;
use App\Services\Billing\FakeRazorpayGateway;
use App\Services\Billing\RazorpayGateway;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class RazorpayWebhookTest extends TestCase
{
    use RefreshDatabase;

    private FakeRazorpayGateway $gw;
    private ClinicSubscription $sub;

    protected function setUp(): void
    {
        parent::setUp();
        $this->gw = new FakeRazorpayGateway();
        $this->app->instance(RazorpayGateway::class, $this->gw);
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
        $plan = Plan::create(['name' => 'Starter', 'monthly_price' => 99900]);
        $this->sub = ClinicSubscription::create(['clinic_id' => $clinic->id, 'plan_id' => $plan->id, 'billing_cycle' => 'monthly',
            'status' => 'pending_payment', 'grace_ends_at' => now()->addDay(), 'razorpay_subscription_id' => 'sub_1']);
    }

    private function send(string $event, array $payload, string $eventId = null)
    {
        return $this->call('POST', '/api/webhooks/razorpay', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_RAZORPAY_SIGNATURE' => 'sig',
            'HTTP_X_RAZORPAY_EVENT_ID' => $eventId ?? 'evt_'.Str::random(8),
        ], json_encode(['event' => $event, 'payload' => $payload]));
    }

    private function subEntity(array $extra = []): array
    {
        return ['subscription' => ['entity' => array_merge(['id' => 'sub_1', 'status' => 'active',
            'current_start' => now()->timestamp, 'current_end' => now()->addMonth()->timestamp], $extra)]];
    }

    public function test_bad_signature_is_400(): void
    {
        $this->gw->signatureValid = false;
        $this->send('subscription.activated', $this->subEntity())->assertStatus(400);
        $this->assertSame('pending_payment', $this->sub->refresh()->status);
    }

    public function test_activated_webhook_alone_activates_clinic(): void
    {
        $this->send('subscription.activated', $this->subEntity())->assertOk();
        $this->sub->refresh();
        $this->assertSame('active', $this->sub->status);
        $this->assertNull($this->sub->grace_ends_at);
        $this->assertNotNull($this->sub->current_period_end);
    }

    public function test_charged_records_one_transaction_per_payment_and_is_idempotent(): void
    {
        $payload = $this->subEntity() + ['payment' => ['entity' => ['id' => 'pay_1', 'amount' => 99900, 'method' => 'upi', 'invoice_id' => 'inv_1']]];
        $this->send('subscription.charged', $payload, 'evt_same')->assertOk();
        $this->send('subscription.charged', $payload, 'evt_same')->assertOk();        // duplicate delivery
        $this->send('subscription.charged', $payload, 'evt_other')->assertOk();       // same payment, new event id

        $this->assertSame(1, SubscriptionTransaction::count());
        $tx = SubscriptionTransaction::first();
        $this->assertSame(['captured', 'razorpay', 99900, 'upi', 'inv_1'], [$tx->status, $tx->source, $tx->amount, $tx->method, $tx->razorpay_invoice_id]);
        $this->assertSame('active', $this->sub->refresh()->status);
    }

    public function test_pending_and_halted_start_grace(): void
    {
        $this->sub->update(['status' => 'active', 'grace_ends_at' => null]);
        $this->send('subscription.pending', $this->subEntity(['status' => 'pending']))->assertOk();
        $this->sub->refresh();
        $this->assertSame('past_due', $this->sub->status);
        $this->assertNotNull($this->sub->grace_ends_at);

        $grace = $this->sub->grace_ends_at->timestamp;
        $this->send('subscription.halted', $this->subEntity(['status' => 'halted']))->assertOk();
        $this->assertSame($grace, $this->sub->refresh()->grace_ends_at->timestamp); // not pushed out
    }

    public function test_cancelled_and_completed(): void
    {
        $this->send('subscription.cancelled', $this->subEntity(['status' => 'cancelled']))->assertOk();
        $this->assertSame('cancelled', $this->sub->refresh()->status);
        $this->assertNotNull($this->sub->cancelled_at);

        $this->send('subscription.completed', $this->subEntity(['status' => 'completed']))->assertOk();
        $this->assertSame('expired', $this->sub->refresh()->status);
    }

    public function test_payment_failed_records_failed_transaction(): void
    {
        $this->send('payment.failed', ['payment' => ['entity' => ['id' => 'pay_f', 'amount' => 99900, 'method' => 'card',
            'error_description' => 'Card declined', 'notes' => ['subscription_id' => 'sub_1']]]])->assertOk();
        $tx = SubscriptionTransaction::where('razorpay_payment_id', 'pay_f')->firstOrFail();
        $this->assertSame(['failed', 'Card declined'], [$tx->status, $tx->failure_reason]);
    }

    public function test_unknown_subscription_is_ignored_with_200(): void
    {
        $this->send('subscription.activated', ['subscription' => ['entity' => ['id' => 'sub_unknown', 'status' => 'active']]])->assertOk();
        $this->assertSame('pending_payment', $this->sub->refresh()->status);
    }
}
```

- [ ] **Step 2: Run — FAIL (404)**

- [ ] **Step 3: Implement**

```php
<?php
// app/Http/Controllers/Api/RazorpayWebhookController.php
namespace App\Http\Controllers\Api;

use App\Models\RazorpayWebhookEvent;
use App\Services\Billing\RazorpayGateway;
use App\Services\Billing\RazorpayWebhookHandler;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RazorpayWebhookController
{
    public function __construct(private readonly RazorpayGateway $gateway, private readonly RazorpayWebhookHandler $handler) {}

    public function __invoke(Request $request)
    {
        $body = $request->getContent();
        if (! $this->gateway->verifyWebhookSignature($body, (string) $request->header('X-Razorpay-Signature', ''))) {
            return response()->json(['ok' => false, 'message' => 'Invalid signature'], 400);
        }

        $payload = json_decode($body, true) ?: [];
        $eventId = (string) ($request->header('X-Razorpay-Event-Id') ?: 'hash_'.hash('sha256', $body));

        DB::transaction(function () use ($eventId, $payload) {
            $record = RazorpayWebhookEvent::query()->lockForUpdate()->firstOrCreate(
                ['event_id' => $eventId],
                ['event' => (string) ($payload['event'] ?? ''), 'payload' => $payload],
            );
            if ($record->processed_at) {
                return;
            }
            $this->handler->handle((string) ($payload['event'] ?? ''), $payload['payload'] ?? []);
            $record->update(['processed_at' => now()]);
        });

        return response()->json(['ok' => true]);
    }
}
```

```php
<?php
// app/Services/Billing/RazorpayWebhookHandler.php
namespace App\Services\Billing;

use App\Models\ClinicSubscription;
use App\Models\SubscriptionTransaction;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;

class RazorpayWebhookHandler
{
    public function __construct(private readonly SubscriptionService $service) {}

    public function handle(string $event, array $payload): void
    {
        $subEntity = $payload['subscription']['entity'] ?? null;
        $payment = $payload['payment']['entity'] ?? null;
        $subscriptionId = $subEntity['id'] ?? ($payment['subscription_id'] ?? ($payment['notes']['subscription_id'] ?? null));

        $sub = $subscriptionId ? ClinicSubscription::query()->where('razorpay_subscription_id', $subscriptionId)->first() : null;
        if (! $sub) {
            Log::info('Razorpay webhook for unknown subscription', ['event' => $event, 'subscription_id' => $subscriptionId]);

            return;
        }

        $start = isset($subEntity['current_start']) ? Carbon::createFromTimestamp($subEntity['current_start']) : null;
        $end = isset($subEntity['current_end']) ? Carbon::createFromTimestamp($subEntity['current_end']) : null;

        match ($event) {
            'subscription.activated' => $this->service->activate($sub, $start, $end),
            'subscription.charged' => $this->charged($sub, $payment ?? [], $payload['invoice']['entity'] ?? null, $start, $end),
            'subscription.pending', 'subscription.halted' => $this->service->markPastDue($sub, 'past_due'),
            'subscription.cancelled' => $sub->update(['status' => 'cancelled', 'cancelled_at' => now()]),
            'subscription.completed' => $sub->update(['status' => 'expired']),
            'payment.failed' => $this->failed($sub, $payment ?? []),
            default => null,
        };
    }

    private function charged(ClinicSubscription $sub, array $payment, ?array $invoice, ?Carbon $start, ?Carbon $end): void
    {
        if (! empty($payment['id'])) {
            SubscriptionTransaction::query()->updateOrCreate(
                ['razorpay_payment_id' => $payment['id']],
                [
                    'clinic_id' => $sub->clinic_id, 'clinic_subscription_id' => $sub->id, 'plan_id' => $sub->plan_id,
                    'billing_cycle' => $sub->billing_cycle, 'amount' => (int) ($payment['amount'] ?? 0), 'status' => 'captured',
                    'source' => 'razorpay', 'method' => $payment['method'] ?? null, 'razorpay_subscription_id' => $sub->razorpay_subscription_id,
                    'razorpay_invoice_id' => $payment['invoice_id'] ?? ($invoice['id'] ?? null), 'invoice_url' => $invoice['short_url'] ?? null,
                    'paid_at' => now(), 'period_start' => $start, 'period_end' => $end,
                ],
            );
        }
        $this->service->activate($sub, $start, $end);
    }

    private function failed(ClinicSubscription $sub, array $payment): void
    {
        if (empty($payment['id'])) {
            return;
        }
        SubscriptionTransaction::query()->updateOrCreate(
            ['razorpay_payment_id' => $payment['id']],
            [
                'clinic_id' => $sub->clinic_id, 'clinic_subscription_id' => $sub->id, 'plan_id' => $sub->plan_id,
                'billing_cycle' => $sub->billing_cycle, 'amount' => (int) ($payment['amount'] ?? 0), 'status' => 'failed',
                'source' => 'razorpay', 'method' => $payment['method'] ?? null, 'razorpay_subscription_id' => $sub->razorpay_subscription_id,
                'failure_reason' => $payment['error_description'] ?? null,
            ],
        );
    }
}
```

Route (top level, not inside any auth group): `Route::post('webhooks/razorpay', RazorpayWebhookController::class);` with `use App\Http\Controllers\Api\RazorpayWebhookController;`. API routes have no CSRF middleware; confirm `bootstrap/app.php` doesn't add `statefulApi()` — if it does, add `webhooks/razorpay` to CSRF exceptions via `$middleware->validateCsrfTokens(except: ['api/webhooks/razorpay'])`.

- [ ] **Step 4: Run — PASS**; full suite.
- [ ] **Step 5: Commit** `git add app routes tests/Feature/Billing && git commit -m "feat(billing): Razorpay webhook with idempotent event handling"`

---

### Task 8: Super admin subscription actions and transactions API

**Files:**
- Create: `app/Http/Controllers/Api/SuperAdmin/ClinicSubscriptionController.php`, `app/Http/Controllers/Api/SuperAdmin/SubscriptionTransactionController.php`
- Modify: `routes/api.php`, `app/Http/Controllers/Api/SuperAdmin/ClinicController.php` (`overview` adds `subscription` with plan)
- Test: `tests/Feature/Billing/SuperAdminSubscriptionTest.php`

**Interfaces:**
- Consumes: `SubscriptionService` (`changePlan`, `extendTrial`, `extendGrace`, `recordOfflinePayment`), `RazorpayGateway::cancelSubscription`.
- Produces (all under `/api/super-admin`):
  - `GET clinics/{id}/overview` → adds `data.subscription` (with `plan`) or null
  - `POST clinics/{id}/subscription {plan_id, billing_cycle, start_mode, trial_days?, offline_amount?, offline_period_months?, offline_notes?}` — create one when the clinic has none (422 if exists)
  - `PUT clinics/{id}/subscription {plan_id, billing_cycle}` → changePlan
  - `POST clinics/{id}/subscription/extend-trial {days 1-365}`
  - `POST clinics/{id}/subscription/extend-grace {days 1-60}`
  - `POST clinics/{id}/subscription/offline-payment {amount (paise, min 1), period_months 1-36, notes?}`
  - `POST clinics/{id}/subscription/cancel` → gateway cancel at cycle end when linked; status `cancelled`, `cancelled_at`
  - `GET subscription-transactions?clinic_id=&status=&source=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=` → paginated (25) rows with `clinic:id,name` and `plan:id,name`, plus `meta.total_captured` (sum of `amount` where status captured, same filters)

- [ ] **Step 1: Failing test**

```php
<?php
// tests/Feature/Billing/SuperAdminSubscriptionTest.php
namespace Tests\Feature\Billing;

use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use App\Models\SubscriptionTransaction;
use App\Models\User;
use App\Services\Billing\FakeRazorpayGateway;
use App\Services\Billing\RazorpayGateway;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SuperAdminSubscriptionTest extends TestCase
{
    use RefreshDatabase;

    private FakeRazorpayGateway $gw;
    private Clinic $clinic;
    private Plan $starter;
    private Plan $pro;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->gw = new FakeRazorpayGateway();
        $this->app->instance(RazorpayGateway::class, $this->gw);
        $sa = User::create(['uuid' => (string) Str::uuid(), 'full_name' => 'SA', 'email' => 'sa@x.test', 'password' => 'x', 'role' => 'super_admin', 'status' => 'active']);
        $sa->assignRole('super_admin');
        Sanctum::actingAs($sa);
        $this->clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
        $this->starter = Plan::create(['name' => 'Starter', 'monthly_price' => 99900]);
        $this->pro = Plan::create(['name' => 'Pro', 'monthly_price' => 249900, 'yearly_price' => 2499000]);
    }

    private function base(): string { return "/api/super-admin/clinics/{$this->clinic->id}/subscription"; }

    public function test_create_change_extend_offline_cancel(): void
    {
        $this->postJson($this->base(), ['plan_id' => $this->starter->id, 'billing_cycle' => 'monthly', 'start_mode' => 'trial', 'trial_days' => 3])->assertCreated();
        $this->postJson($this->base(), ['plan_id' => $this->starter->id, 'billing_cycle' => 'monthly', 'start_mode' => 'trial'])->assertStatus(422);

        $this->putJson($this->base(), ['plan_id' => $this->pro->id, 'billing_cycle' => 'yearly'])->assertOk()->assertJsonPath('data.plan_id', $this->pro->id);

        $before = ClinicSubscription::first()->trial_ends_at->timestamp;
        $this->postJson($this->base().'/extend-trial', ['days' => 5])->assertOk();
        $this->assertEqualsWithDelta($before + 5 * 86400, ClinicSubscription::first()->trial_ends_at->timestamp, 5);

        ClinicSubscription::first()->update(['status' => 'expired', 'grace_ends_at' => null]);
        $this->postJson($this->base().'/extend-grace', ['days' => 2])->assertOk();
        $this->assertSame('past_due', ClinicSubscription::first()->status);

        $this->postJson($this->base().'/offline-payment', ['amount' => 2499000, 'period_months' => 12, 'notes' => 'NEFT'])->assertOk();
        $this->assertSame('active', ClinicSubscription::first()->status);
        $this->assertSame(1, SubscriptionTransaction::where('source', 'offline')->count());

        ClinicSubscription::first()->update(['razorpay_subscription_id' => 'sub_9']);
        $this->putJson($this->base(), ['plan_id' => $this->starter->id, 'billing_cycle' => 'monthly'])->assertStatus(422);
        $this->postJson($this->base().'/cancel')->assertOk();
        $this->assertSame([['subscriptionId' => 'sub_9', 'atCycleEnd' => true]], $this->gw->cancelled);
        $this->assertSame('cancelled', ClinicSubscription::first()->status);
    }

    public function test_overview_includes_subscription(): void
    {
        ClinicSubscription::create(['clinic_id' => $this->clinic->id, 'plan_id' => $this->starter->id, 'billing_cycle' => 'monthly', 'status' => 'active']);
        $this->getJson("/api/super-admin/clinics/{$this->clinic->id}/overview")->assertOk()
            ->assertJsonPath('data.subscription.status', 'active')->assertJsonPath('data.subscription.plan.name', 'Starter');
    }

    public function test_transactions_list_filters_and_total(): void
    {
        $other = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'D', 'slug' => 'd', 'status' => 'active']);
        foreach ([[$this->clinic->id, 'captured', 1000], [$this->clinic->id, 'failed', 500], [$other->id, 'captured', 2000]] as [$cid, $status, $amt]) {
            SubscriptionTransaction::create(['clinic_id' => $cid, 'amount' => $amt, 'status' => $status, 'source' => 'razorpay', 'paid_at' => now()]);
        }

        $all = $this->getJson('/api/super-admin/subscription-transactions')->assertOk();
        $this->assertCount(3, $all->json('data.data'));
        $this->assertSame(3000, $all->json('meta.total_captured'));

        $one = $this->getJson('/api/super-admin/subscription-transactions?clinic_id='.$this->clinic->id.'&status=captured')->assertOk();
        $this->assertCount(1, $one->json('data.data'));
        $this->assertSame(1000, $one->json('meta.total_captured'));
        $one->assertJsonPath('data.data.0.clinic.name', 'C');
    }
}
```

(Before writing the transactions response, read `ApiResponse::success` to see whether it accepts extra top-level keys; if not, return `response()->json(['success' => true, 'message' => ..., 'data' => $paginator, 'meta' => ['total_captured' => $sum]])` directly and keep the test's `data.data` / `meta.total_captured` paths.)

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement** controllers with the validation rules from **Interfaces**, each action resolving `ClinicSubscription::where('clinic_id', $id)->firstOrFail()` (404 when none, except `store`), and delegating to `SubscriptionService`. `store` validates like onboarding's `subscription.*` (plan active, yearly requires yearly_price) and calls `SubscriptionService::start($clinic, $plan, $cycle, $mode, [...], $request->user()->id)`, returning 201. `cancel`: if `razorpay_subscription_id`, call `$gateway->cancelSubscription($id, true)`; then `update(['status' => 'cancelled', 'cancelled_at' => now()])`. Transactions `index`:

```php
$query = SubscriptionTransaction::query()
    ->when($request->filled('clinic_id'), fn ($q) => $q->where('clinic_id', (int) $request->input('clinic_id')))
    ->when($request->filled('status'), fn ($q) => $q->where('status', $request->input('status')))
    ->when($request->filled('source'), fn ($q) => $q->where('source', $request->input('source')))
    ->when($request->filled('from'), fn ($q) => $q->whereDate('created_at', '>=', $request->input('from')))
    ->when($request->filled('to'), fn ($q) => $q->whereDate('created_at', '<=', $request->input('to')));

$total = (clone $query)->where('status', 'captured')->sum('amount');
$rows = $query->with(['clinic:id,name', 'plan:id,name'])->latest()->paginate(25);
```
Routes: add the six subscription routes and `Route::get('subscription-transactions', ...)` in the super-admin group. `ClinicController::overview` adds `'subscription' => ClinicSubscription::query()->with('plan')->where('clinic_id', $clinic->id)->first(),`.

- [ ] **Step 4: Run — PASS**; full suite.
- [ ] **Step 5: Commit** `git add app routes tests/Feature/Billing && git commit -m "feat(billing): super admin subscription actions and transactions list"`

---

### Task 9: Plan limits enforcement

**Files:**
- Modify: `app/Services/Billing/PlanLimits.php` (add `assertCanAdd`), `app/Services/DoctorManagementService.php::create`, `app/Services/UserManagementService.php::create`, `app/Services/AppointmentService.php::create`
- Test: `tests/Feature/Billing/PlanLimitsTest.php`

**Interfaces:**
- Produces: `PlanLimits::assertCanAdd(int $clinicId, string $resource): void` — no-op when the clinic has no subscription or the limit is null; otherwise throws `ValidationException::withMessages(['plan' => "Your {$plan->name} plan allows {$limit} {$label}. Upgrade your plan to add more."])` when `count >= limit`. Labels: `doctors` → "doctors", `staff` → "staff users", `appointments` → "appointments per month".

- [ ] **Step 1: Failing test**

```php
<?php
// tests/Feature/Billing/PlanLimitsTest.php
namespace Tests\Feature\Billing;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Doctor;
use App\Models\Plan;
use App\Services\Billing\PlanLimits;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class PlanLimitsTest extends TestCase
{
    use RefreshDatabase;

    private Clinic $clinic;

    protected function setUp(): void
    {
        parent::setUp();
        $this->clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
    }

    private function onPlan(array $limits): void
    {
        $plan = Plan::create(array_merge(['name' => 'Starter', 'monthly_price' => 99900], $limits));
        ClinicSubscription::create(['clinic_id' => $this->clinic->id, 'plan_id' => $plan->id, 'billing_cycle' => 'monthly', 'status' => 'active']);
    }

    public function test_doctor_limit_blocks_at_limit_with_message(): void
    {
        $this->onPlan(['max_doctors' => 1]);
        $limits = app(PlanLimits::class);
        $limits->assertCanAdd($this->clinic->id, 'doctors');          // 0 < 1 ok
        Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr A']);

        try {
            $limits->assertCanAdd($this->clinic->id, 'doctors');
            $this->fail('Expected limit');
        } catch (ValidationException $e) {
            $this->assertSame('Your Starter plan allows 1 doctors. Upgrade your plan to add more.', $e->errors()['plan'][0]);
        }
    }

    public function test_null_limit_and_no_subscription_are_unlimited(): void
    {
        app(PlanLimits::class)->assertCanAdd($this->clinic->id, 'doctors'); // no subscription
        $this->onPlan(['max_doctors' => null]);
        Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr A']);
        app(PlanLimits::class)->assertCanAdd($this->clinic->id, 'doctors');
        $this->assertTrue(true);
    }

    public function test_soft_deleted_doctor_and_cancelled_appointments_do_not_count(): void
    {
        $this->onPlan(['max_doctors' => 1, 'max_appointments_per_month' => 1]);
        Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Gone'])->delete();
        app(PlanLimits::class)->assertCanAdd($this->clinic->id, 'doctors');

        $this->assertSame(0, app(PlanLimits::class)->count($this->clinic->id, 'appointments'));
    }

    public function test_services_enforce_limits_through_api_calls(): void
    {
        $this->onPlan(['max_staff' => 1]);
        $service = app(\App\Services\UserManagementService::class);
        $service->create(['clinic_id' => $this->clinic->id, 'full_name' => 'A', 'email' => 'a@x.test', 'password' => 'Secret@123', 'role' => 'receptionist']);
        $this->expectException(ValidationException::class);
        $service->create(['clinic_id' => $this->clinic->id, 'full_name' => 'B', 'email' => 'b@x.test', 'password' => 'Secret@123', 'role' => 'receptionist']);
    }
}
```

Also add to this file a doctor-service test and an appointment-service test in the same style: `DoctorManagementService::create(['clinic_id' => ..., 'full_name' => 'Dr B'])` throws at `max_doctors` = 1 after one doctor exists; `AppointmentService` — create one appointment the way `tests/Feature/AppointmentBookingTest.php` does (read it for required fields), with `max_appointments_per_month` = 1, then assert the second create throws `ValidationException`. If `UserManagementService::create` requires more keys (read it), add them.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```php
public function assertCanAdd(int $clinicId, string $resource): void
{
    $sub = \App\Models\ClinicSubscription::query()->with('plan')->where('clinic_id', $clinicId)->first();
    $limit = $sub?->plan?->limitFor($resource);
    if ($limit === null) {
        return;
    }
    if ($this->count($clinicId, $resource) >= $limit) {
        $label = ['doctors' => 'doctors', 'staff' => 'staff users', 'appointments' => 'appointments per month'][$resource];
        throw \Illuminate\Validation\ValidationException::withMessages([
            'plan' => "Your {$sub->plan->name} plan allows {$limit} {$label}. Upgrade your plan to add more.",
        ]);
    }
}
```
Call sites (first line inside each `create`, before the transaction):
- `DoctorManagementService::create`: `app(PlanLimits::class)->assertCanAdd((int) $data['clinic_id'], 'doctors');` — and if `create_linked_user` is set, do NOT count the doctor's login as staff (staff excludes role doctor already).
- `UserManagementService::create`: `if (! empty($data['clinic_id']) && ($data['role'] ?? null) !== 'doctor') { app(PlanLimits::class)->assertCanAdd((int) $data['clinic_id'], 'staff'); }`
- `AppointmentService::create`: `app(PlanLimits::class)->assertCanAdd((int) $data['clinic_id'], 'appointments');`
(Prefer constructor injection if the service already uses a constructor; otherwise `app()` is fine.)

- [ ] **Step 4: Run — PASS**; full suite.
- [ ] **Step 5: Commit** `git add app/Services tests/Feature/Billing && git commit -m "feat(billing): enforce plan limits for doctors, staff and monthly appointments"`

---

### Task 10: Super admin UI — Plans, Transactions, Payments settings, onboarding Plan step, clinic Subscription card

**Files:**
- Create: `resources/js/admin/src/utils/money.js`, `pages/billing/PlansPage.jsx`, `pages/billing/SubscriptionTransactionsPage.jsx`, `components/billing/SubscriptionCard.jsx`
- Modify: `App.jsx` (routes `/billing/plans`, `/billing/subscription-transactions` wrapped in `OnlySuperAdmin`), `config/navigation.js` (super_admin section `{ section: 'Billing', items: [routeItem('/billing/plans', 'Plans'), routeItem('/billing/subscription-transactions', 'Subscription Transactions')] }` placed after Network), `pages/workflows/SystemSettingsPage.jsx` (Payments tab; remove `trial_enabled` toggle), `pages/workflows/OnboardClinicWizardPage.jsx` (Plan step), `pages/workflows/ClinicDetailPage.jsx` (Overview uses `SubscriptionCard`; remove the `clinic.trial_ends_at` banner, the edit-sheet `trial_ends_at` field and the `Trial ends` InfoRow), `pages/ModuleListPage.jsx` (remove `trial_ends_at` column/badge logic for clinics), `pages/workflows/ClinicProfilePage.jsx` (trial badge from `useScope().context.subscription.trial_ends_at` or remove)

**Interfaces (API contracts from Tasks 2-8):**
- Plans: `GET/POST /super-admin/plans`, `PUT/DELETE /super-admin/plans/{id}`; prices in paise.
- Settings: `GET/POST /super-admin/settings/system` with `razorpay_key_id`, `razorpay_key_secret`, `razorpay_webhook_secret`, `razorpay_key_secret_set`, `razorpay_webhook_secret_set`, `razorpay_mode`, `subscription_grace_days`, `trial_days`, `webhook_url`.
- Onboarding: `POST /super-admin/clinics` body `subscription: {plan_id, billing_cycle, start_mode, trial_days, offline_amount (paise), offline_period_months, offline_notes}`.
- Overview: `data.subscription` (with `plan`).
- Actions: `POST|PUT /super-admin/clinics/{id}/subscription`, `.../extend-trial`, `.../extend-grace`, `.../offline-payment`, `.../cancel`.
- Transactions: `GET /super-admin/subscription-transactions?clinic_id&status&source&from&to&page` → `data` (Laravel paginator) + `meta.total_captured`.

- [ ] **Step 1: money helper**

```js
// resources/js/admin/src/utils/money.js
export const toPaise = (rupees) => {
    if (rupees === '' || rupees == null) return null;
    const n = Number(rupees);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export const formatINR = (paise) => {
    if (paise == null) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(paise / 100);
};
```

- [ ] **Step 2: Plans page** — table (Name, Monthly, Yearly, Doctors, Staff, Appointments/month, Active, Clinics) with limits shown as the number or "Unlimited"; "New plan" button opens a sheet with fields: name, description, monthly price (₹), yearly price (₹, optional), max doctors / max staff / max appointments per month (blank = unlimited), active toggle, sort order. Save converts ₹→paise with `toPaise`. Row actions: Edit, Deactivate/Activate (PUT `is_active`), Delete (only when `subscribers_count === 0`; show API error message otherwise). Follow the visual style of `ClinicDetailPage.jsx` (Card, Sheet, Field, TextInput, Toggle helpers — copy the small helpers you need into the page; do not import from ClinicDetailPage).

- [ ] **Step 3: Subscription Transactions page** — filters row (clinic select loaded from `GET /super-admin/clinics?per_page=200`, status select captured/failed/refunded, source select razorpay/offline, from/to date inputs), a "Total collected" figure from `meta.total_captured` via `formatINR`, table columns Date (`paid_at || created_at`), Clinic, Plan, Cycle, Amount, Status (`StatusBadge`), Source, Method, Razorpay payment ID (monospace), Invoice (link to `invoice_url` in new tab when present), Notes; pagination Prev/Next from paginator `current_page`/`last_page`.

- [ ] **Step 4: Payments tab in System Settings** — `TABS` gets `{ key: 'payments', label: 'Payments', icon: 'settings' }`. Fields: Razorpay Key ID, Key Secret (password input; placeholder "Saved — leave blank to keep" when `razorpay_key_secret_set`), Webhook Secret (same), Mode select (Test/Live), Grace period (days). Read-only Webhook URL with a Copy button (`navigator.clipboard.writeText` in the click handler, catch errors). Note under it: "In the Razorpay dashboard, add this URL as a webhook and enable: subscription.activated, subscription.charged, subscription.pending, subscription.halted, subscription.cancelled, subscription.completed, payment.failed." Trial tab: remove the enable toggle; keep "Default trial length (days)".

- [ ] **Step 5: Onboarding Plan step** — `STEPS` becomes Clinic → Plan → Admin. Plan step loads `GET /super-admin/plans?active=1`; shows plan cards (name, monthly/yearly price via `formatINR`, limits); cycle toggle (Yearly disabled when plan has no `yearly_price`); start mode radio: **Start a free trial** (days input, default from `GET /super-admin/settings/system` `trial_days`), **Payment pending** (clinic admin pays on first login), **Paid offline** (amount ₹ required — prefill from the plan's price for the cycle —, months default 1/12, note). If there are no active plans, show "Create a plan first" with a link to `/billing/plans` and allow skipping (no `subscription` key sent). Final submit adds `subscription` built from this step, amount via `toPaise`.

- [ ] **Step 6: SubscriptionCard on clinic Overview** — `components/billing/SubscriptionCard.jsx` receives `{ clinicId, subscription, onChanged }`. Shows plan name, cycle, status badge, trial end / period end / grace end (whichever apply, `formatDate`), Razorpay subscription ID. With no subscription: "No plan assigned" + "Assign plan" (same fields as onboarding Plan step → `POST .../subscription`). Actions (each a small inline form or sheet; show API error messages): Change plan (disabled with tooltip when `razorpay_subscription_id` set), Extend trial (days), Extend grace (days), Record offline payment (₹ amount, months, note), Cancel (inline confirm step — no `window.confirm`). Call `onChanged` after success; the Overview refetches. Render it as the first card in `OverviewTab`. Replace the old top trial banner with one computed from `overview.subscription` — or remove it (the card shows the dates).

- [ ] **Step 7: Build and grep**

Run: `PATH=$HOME/.nvm/versions/node/v22.14.0/bin:$PATH npm run build && grep -rn "trial_enabled\|clinic\.trial_ends_at\|row?.trial_ends_at" resources/js/admin/src`
Expected: build OK; grep empty.

- [ ] **Step 8: Commit** `git add resources/js/admin/src && git commit -m "feat(billing-ui): plans, subscription transactions, payment settings, onboarding plan step, clinic subscription card"`

---

### Task 11: Clinic admin UI — Subscription page, Razorpay Checkout, banner, lock screen

**Files:**
- Create: `resources/js/admin/src/pages/billing/ClinicSubscriptionPage.jsx`, `components/billing/SubscriptionLockScreen.jsx`
- Modify: `api/client.js` (402 interceptor), `App.jsx` (route `/workflows/subscription` wrapped in `BlockSuperAdmin`; render lock screen), `config/navigation.js` (clinic_admin → Settings: `routeItem('/workflows/subscription', 'Subscription')`), `components/Layout.jsx` (banner from `context.subscription`), `context/ScopeContext.jsx` (expose `subscriptionLocked` state)

**Interfaces:**
- `GET /clinic/subscription`, `POST /clinic/subscription/checkout`, `POST /clinic/subscription/verify` (Task 6); `me/context.subscription` (Task 5); 402 body `code: "SUBSCRIPTION_REQUIRED"`.

- [ ] **Step 1: 402 handling** — in `client.js` add a response interceptor:
```js
client.interceptors.response.use(
    (res) => res,
    (error) => {
        if (error?.response?.status === 402 && error.response.data?.code === 'SUBSCRIPTION_REQUIRED') {
            window.dispatchEvent(new CustomEvent('subscription-required', { detail: error.response.data }));
        }
        return Promise.reject(error);
    },
);
```
`ScopeContext` listens for `subscription-required` and sets `subscriptionLocked = { message }`; it also sets it on context load when `context.subscription?.allows_access === false`, and clears it when a later context refresh shows `allows_access` true. In `App.jsx` (inside the authenticated layout): when `subscriptionLocked` and role is `clinic_admin` and the path is not `/workflows/subscription` → `<Navigate to="/workflows/subscription" replace />`; when locked and role is any other clinic role → render `<SubscriptionLockScreen message=... />` (full page: clinic name, "Your clinic's subscription is inactive. Contact your clinic admin to renew.", Sign out button) instead of the routes.

- [ ] **Step 2: Subscription page** — loads `GET /clinic/subscription`. Sections:
  - Status header: plan name, cycle, status badge, key date line ("Trial ends 9 Oct 2026", "Renews 9 Nov 2026", "Payment due — access ends 12 Oct 2026", "Expired").
  - Usage: three bars — Doctors `usage.doctors / limits.doctors`, Staff users, Appointments this month — "Unlimited" when limit null.
  - Choose plan: plan cards from `plans` with a Monthly/Yearly toggle (yearly disabled without `yearly_price`), current plan marked; **Pay with Razorpay** button (disabled + note "Online payments are not configured yet. Contact support." when `payments_configured` is false; hidden for non-admin roles).
  - Payment history: table of `transactions` (date, plan, amount via `formatINR`, status, method, invoice link).
  Pay flow:
```js
const loadCheckoutScript = () => new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve; s.onerror = () => reject(new Error('Could not load Razorpay Checkout.'));
    document.body.appendChild(s);
});

const pay = async () => {
    setError(''); setPaying(true);
    try {
        await loadCheckoutScript();
        const { data } = await client.post('/clinic/subscription/checkout', { plan_id: selectedPlanId, billing_cycle: cycle });
        const c = data.data;
        const rzp = new window.Razorpay({
            key: c.key_id,
            subscription_id: c.subscription_id,
            name: c.name,
            description: 'Clinic subscription',
            prefill: { email: c.email || '', contact: c.phone || '' },
            handler: async (resp) => {
                try {
                    await client.post('/clinic/subscription/verify', resp);
                    await Promise.all([load(), refreshScope()]);
                    setNotice('Payment received. Your subscription is active.');
                } catch (e) { setError(e?.response?.data?.message || 'Payment could not be verified. If money was deducted, it will be confirmed shortly.'); }
            },
            modal: { ondismiss: () => setPaying(false) },
        });
        rzp.on('payment.failed', (r) => setError(r?.error?.description || 'Payment failed.'));
        rzp.open();
    } catch (e) {
        setError(e?.response?.data?.message || e.message || 'Could not start payment.');
    } finally { setPaying(false); }
};
```
(`resp` contains `razorpay_payment_id`, `razorpay_subscription_id`, `razorpay_signature`.) `refreshScope` = the ScopeContext `refresh`.

- [ ] **Step 3: Banner** — in `Layout.jsx` replace the `clinic_trial_ends_at` logic with `context.subscription`: trialing → "Trial: N days left"; pending_payment/past_due with grace → "Payment due — N days left" (amber) with a "Pay now" link to `/workflows/subscription` for clinic_admin; cancelled → "Subscription cancelled — access until {date}". Nothing when active.

- [ ] **Step 4: Build** — `PATH=$HOME/.nvm/versions/node/v22.14.0/bin:$PATH npm run build` passes; `grep -rn "clinic_trial_ends_at" resources/js/admin/src` empty.

- [ ] **Step 5: Commit** `git add resources/js/admin/src && git commit -m "feat(billing-ui): clinic subscription page with Razorpay Checkout, banner and lock screen"`

---

### Task 12: End-to-end verification

**Files:** fix-ups only.

- [ ] **Step 1:** `/opt/homebrew/bin/php artisan test` — all pass. `grep -rn "trial_enabled\|ExpireTrialClinics\|expire-trials" app routes resources config database` — empty.
- [ ] **Step 2:** Back up the dev DB, then rebuild: start MAMP MySQL if down (`/Applications/MAMP/bin/startMysql.sh`), `mysqldump` `clinic_new` (creds from `.env`) to `.superpowers/backups/clinic_new-backup-<timestamp>.sql` (confirm non-empty), then `/opt/homebrew/bin/php artisan migrate:fresh --seed`. Expected: plans Starter/Pro exist; demo clinic trialing on Starter.
- [ ] **Step 3:** `/opt/homebrew/bin/php artisan subscriptions:sync` runs and prints a count.
- [ ] **Step 4:** Serve (`/opt/homebrew/bin/php artisan serve --port=8000` in background) and smoke with curl: super admin login → `GET /api/super-admin/plans` (2 plans) → onboard a clinic with `start_mode: pending_payment` → `GET .../clinics/{id}/overview` shows the subscription → set it expired via `POST .../extend-grace` negative is not allowed, so instead run tinker `ClinicSubscription::where('clinic_id', X)->update(['status'=>'expired'])` → clinic admin login → `GET /api/clinic/patients` = 402, `GET /api/clinic/subscription` = 200.
- [ ] **Step 5:** Browser pass (Playwright tools if available): super admin — Plans page create/edit; onboarding shows Plan step; clinic Overview shows Subscription card, record offline payment → Active; Subscription Transactions lists it; System Settings → Payments shows webhook URL. Clinic admin of the expired clinic → redirected to Subscription page; a receptionist of that clinic → lock screen.
- [ ] **Step 6:** If Razorpay **test** keys are configured in System Settings, click **Pay with Razorpay** and complete a test payment with Razorpay's test card/UPI; confirm verify → Active. Otherwise report "Razorpay checkout not exercised — no test keys".
- [ ] **Step 7:** Commit fix-ups only if something changed.
