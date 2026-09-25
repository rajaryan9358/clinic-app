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

    public function test_checkout_blocked_when_already_active_and_linked(): void
    {
        $this->sub->update(['status' => 'active', 'razorpay_subscription_id' => 'sub_old']);
        $this->actingAsRole('clinic_admin');
        $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly'])
            ->assertStatus(422)->assertJsonFragment(['message' => 'Your clinic already has an active subscription.']);
        $this->assertSame([], $this->gw->createdSubscriptions);
    }

    public function test_checkout_cancels_previous_subscription_when_expired_and_linked(): void
    {
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null, 'razorpay_subscription_id' => 'sub_old']);
        $this->actingAsRole('clinic_admin');
        $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly'])->assertOk();

        $this->assertSame([['subscriptionId' => 'sub_old', 'atCycleEnd' => false]], $this->gw->cancelled);
        $this->assertSame('sub_fake_1', $this->sub->refresh()->razorpay_subscription_id);
    }

    public function test_checkout_cancels_previous_subscription_when_trialing_and_linked(): void
    {
        $this->sub->update(['razorpay_subscription_id' => 'sub_old']);
        $this->actingAsRole('clinic_admin');
        $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly'])->assertOk();

        $this->assertSame([['subscriptionId' => 'sub_old', 'atCycleEnd' => false]], $this->gw->cancelled);
        $this->assertSame('sub_fake_1', $this->sub->refresh()->razorpay_subscription_id);
    }

    public function test_checkout_proceeds_when_cancelling_previous_subscription_fails(): void
    {
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null, 'razorpay_subscription_id' => 'sub_old']);
        $gw = new class extends FakeRazorpayGateway
        {
            public function cancelSubscription(string $subscriptionId, bool $atCycleEnd): void
            {
                throw new \RuntimeException('razorpay down');
            }
        };
        $this->app->instance(RazorpayGateway::class, $gw);

        $this->actingAsRole('clinic_admin');
        $res = $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly'])->assertOk();

        $res->assertJsonPath('data.subscription_id', 'sub_fake_1');
        $this->assertSame('sub_fake_1', $this->sub->refresh()->razorpay_subscription_id);
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
