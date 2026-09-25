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
