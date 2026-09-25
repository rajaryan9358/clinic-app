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
        $this->sub->refresh();
        $this->assertSame('sub_fake_1', $this->sub->pending_razorpay_subscription_id);
        $this->assertNull($this->sub->razorpay_subscription_id);

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

    public function test_checkout_keeps_linked_subscription_until_promoted_when_expired_and_linked(): void
    {
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null, 'razorpay_subscription_id' => 'sub_old']);
        $this->actingAsRole('clinic_admin');
        $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly'])->assertOk();

        $this->assertSame([], $this->gw->cancelled); // the old one is cancelled only once the new one is confirmed
        $this->sub->refresh();
        $this->assertSame('sub_old', $this->sub->razorpay_subscription_id);
        $this->assertSame('sub_fake_1', $this->sub->pending_razorpay_subscription_id);
    }

    public function test_checkout_keeps_linked_subscription_until_promoted_when_trialing_and_linked(): void
    {
        $this->sub->update(['razorpay_subscription_id' => 'sub_old']);
        $this->actingAsRole('clinic_admin');
        $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly'])->assertOk();

        $this->assertSame([], $this->gw->cancelled);
        $this->sub->refresh();
        $this->assertSame('sub_old', $this->sub->razorpay_subscription_id);
        $this->assertSame('sub_fake_1', $this->sub->pending_razorpay_subscription_id);
    }

    public function test_checkout_proceeds_when_cancelling_previous_pending_subscription_fails(): void
    {
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null, 'pending_razorpay_subscription_id' => 'sub_old']);
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
        $this->assertSame('sub_fake_1', $this->sub->refresh()->pending_razorpay_subscription_id);
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
        // A checkout leaves the new Razorpay subscription pending until it is verified.
        $this->sub->update(['pending_razorpay_subscription_id' => 'sub_fake_1', 'status' => 'expired', 'trial_ends_at' => null]);

        $this->gw->signatureValid = false;
        $this->postJson('/api/clinic/subscription/verify', ['razorpay_payment_id' => 'pay_1', 'razorpay_subscription_id' => 'sub_fake_1', 'razorpay_signature' => 'x'])->assertStatus(422);

        $this->gw->signatureValid = true;
        $this->postJson('/api/clinic/subscription/verify', ['razorpay_payment_id' => 'pay_1', 'razorpay_subscription_id' => 'sub_fake_1', 'razorpay_signature' => 'x'])->assertOk();
        $this->sub->refresh();
        $this->assertSame('active', $this->sub->status);
        $this->assertSame('sub_fake_1', $this->sub->razorpay_subscription_id);
        $this->assertNull($this->sub->pending_razorpay_subscription_id);
    }

    public function test_locked_clinic_can_still_reach_subscription_endpoints(): void
    {
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null]);
        $this->actingAsRole('clinic_admin');
        $this->getJson('/api/clinic/patients')->assertStatus(402);
        $this->getJson('/api/clinic/subscription')->assertOk();
        $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly'])->assertOk();
    }

    private function webhook(string $event, string $subscriptionId, array $extra = [])
    {
        $payload = ['subscription' => ['entity' => ['id' => $subscriptionId, 'status' => 'active',
            'current_start' => now()->timestamp, 'current_end' => now()->addMonth()->timestamp]]] + $extra;

        return $this->call('POST', '/api/webhooks/razorpay', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_RAZORPAY_SIGNATURE' => 'sig',
            'HTTP_X_RAZORPAY_EVENT_ID' => 'evt_'.Str::random(8),
        ], json_encode(['event' => $event, 'payload' => $payload]));
    }

    private function checkout(): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/clinic/subscription/checkout', ['plan_id' => $this->plan->id, 'billing_cycle' => 'monthly']);
    }

    private function verify(string $subscriptionId): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/clinic/subscription/verify', ['razorpay_payment_id' => 'pay_1', 'razorpay_subscription_id' => $subscriptionId, 'razorpay_signature' => 'x']);
    }

    private function makeOfflineActive(int $days = 10): void
    {
        $this->sub->update(['status' => 'active', 'trial_ends_at' => null, 'current_period_start' => now()->subDays(20), 'current_period_end' => now()->addDays($days)]);
    }

    public function test_offline_active_clinic_can_check_out_and_lapses_to_past_due_after_period_end(): void
    {
        $this->makeOfflineActive(10);
        $this->actingAsRole('clinic_admin');

        $this->checkout()->assertOk();
        $this->sub->refresh();
        $this->assertSame('sub_fake_1', $this->sub->pending_razorpay_subscription_id);
        $this->assertNull($this->sub->razorpay_subscription_id);

        $this->travel(11)->days();
        $this->artisan('subscriptions:sync')->assertSuccessful();
        $this->sub->refresh();
        $this->assertSame('past_due', $this->sub->status);
        $this->assertNotNull($this->sub->grace_ends_at);
        $this->getJson('/api/clinic/patients')->assertOk();
    }

    public function test_abandoned_checkout_can_be_retried_and_the_first_pending_id_is_cancelled(): void
    {
        $this->makeOfflineActive(10);
        $this->actingAsRole('clinic_admin');

        $this->checkout()->assertOk();
        $this->checkout()->assertOk()->assertJsonPath('data.subscription_id', 'sub_fake_2');

        $this->assertSame([['subscriptionId' => 'sub_fake_1', 'atCycleEnd' => false]], $this->gw->cancelled);
        $this->sub->refresh();
        $this->assertSame('sub_fake_2', $this->sub->pending_razorpay_subscription_id);
        $this->assertNull($this->sub->razorpay_subscription_id);
    }

    public function test_start_at_uses_the_later_of_period_end_and_trial_end(): void
    {
        $this->makeOfflineActive(10);
        $this->actingAsRole('clinic_admin');
        $this->checkout()->assertOk();
        $this->assertEqualsWithDelta($this->sub->refresh()->current_period_end->timestamp, $this->gw->createdSubscriptions[0]['startAt'], 2);

        $this->sub->update(['status' => 'trialing', 'trial_ends_at' => now()->addDays(20), 'current_period_end' => now()->addDays(3)]);
        $this->checkout()->assertOk();
        $this->assertEqualsWithDelta($this->sub->refresh()->trial_ends_at->timestamp, $this->gw->createdSubscriptions[1]['startAt'], 2);

        $this->sub->update(['status' => 'expired', 'trial_ends_at' => now()->subDays(20), 'current_period_end' => now()->subDay()]);
        $this->checkout()->assertOk();
        $this->assertNull($this->gw->createdSubscriptions[2]['startAt']);
    }

    public function test_webhooks_for_pending_id_before_verify_activate_and_promote(): void
    {
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null]);
        $this->actingAsRole('clinic_admin');
        $this->checkout()->assertOk();

        $this->webhook('subscription.activated', 'sub_fake_1')->assertOk();
        $this->webhook('subscription.charged', 'sub_fake_1', ['payment' => ['entity' => ['id' => 'pay_w1', 'amount' => 99900, 'method' => 'upi']]])->assertOk();

        $this->sub->refresh();
        $this->assertSame('active', $this->sub->status);
        $this->assertSame('sub_fake_1', $this->sub->razorpay_subscription_id);
        $this->assertNull($this->sub->pending_razorpay_subscription_id);

        $this->checkout()->assertStatus(422)->assertJsonFragment(['message' => 'Your clinic already has an active subscription.']);
    }

    public function test_webhook_event_other_than_confirmation_on_pending_id_is_ignored(): void
    {
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null]);
        $this->actingAsRole('clinic_admin');
        $this->checkout()->assertOk();

        $this->webhook('subscription.cancelled', 'sub_fake_1')->assertOk();
        $this->sub->refresh();
        $this->assertSame('expired', $this->sub->status);
        $this->assertNull($this->sub->cancelled_at);
        $this->assertSame('sub_fake_1', $this->sub->pending_razorpay_subscription_id);
    }

    public function test_authenticated_webhook_promotes_without_changing_status(): void
    {
        $this->actingAsRole('clinic_admin');
        $this->checkout()->assertOk();

        $this->webhook('subscription.authenticated', 'sub_fake_1')->assertOk();
        $this->sub->refresh();
        $this->assertSame('trialing', $this->sub->status);
        $this->assertSame('sub_fake_1', $this->sub->razorpay_subscription_id);
        $this->assertNull($this->sub->pending_razorpay_subscription_id);
    }

    public function test_promote_cancels_old_linked_id_after_saving_new_one(): void
    {
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null, 'razorpay_subscription_id' => 'sub_old']);
        $this->actingAsRole('clinic_admin');
        $this->checkout()->assertOk();

        $this->verify('sub_fake_1')->assertOk();
        $this->assertSame([['subscriptionId' => 'sub_old', 'atCycleEnd' => false]], $this->gw->cancelled);
        $this->sub->refresh();
        $this->assertSame('sub_fake_1', $this->sub->razorpay_subscription_id);
        $this->assertNull($this->sub->pending_razorpay_subscription_id);
        $this->assertSame('active', $this->sub->status);

        $this->webhook('subscription.cancelled', 'sub_old')->assertOk();
        $this->sub->refresh();
        $this->assertSame('active', $this->sub->status);
        $this->assertNull($this->sub->cancelled_at);
    }

    public function test_promote_proceeds_when_cancelling_old_linked_id_fails(): void
    {
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null, 'razorpay_subscription_id' => 'sub_old']);
        $this->app->instance(RazorpayGateway::class, new class extends FakeRazorpayGateway
        {
            public function cancelSubscription(string $subscriptionId, bool $atCycleEnd): void
            {
                throw new \RuntimeException('razorpay down');
            }
        });
        $this->actingAsRole('clinic_admin');
        $this->checkout()->assertOk();
        $this->verify('sub_fake_1')->assertOk();

        $this->assertSame('sub_fake_1', $this->sub->refresh()->razorpay_subscription_id);
    }

    public function test_verify_with_unknown_subscription_id_is_rejected(): void
    {
        $this->actingAsRole('clinic_admin');
        $this->checkout()->assertOk();
        $this->verify('sub_other')->assertStatus(422)->assertJsonFragment(['message' => 'Payment could not be verified.']);
        $this->assertNull($this->sub->refresh()->razorpay_subscription_id);
    }

    public function test_trial_verify_stays_trialing_then_trial_end_waits_for_charge(): void
    {
        $this->actingAsRole('clinic_admin');
        $this->checkout()->assertOk();
        $this->verify('sub_fake_1')->assertOk()->assertJsonPath('data.status', 'trialing');
        $this->sub->refresh();
        $this->assertSame('trialing', $this->sub->status);
        $this->assertSame('sub_fake_1', $this->sub->razorpay_subscription_id);

        $this->travel(6)->days();
        $this->artisan('subscriptions:sync')->assertSuccessful();
        $this->sub->refresh();
        $this->assertSame('pending_payment', $this->sub->status);
        $this->assertNotNull($this->sub->grace_ends_at);

        $this->webhook('subscription.charged', 'sub_fake_1', ['payment' => ['entity' => ['id' => 'pay_t1', 'amount' => 99900]]])->assertOk();
        $this->assertSame('active', $this->sub->refresh()->status);
    }

    public function test_verify_sets_provisional_period_without_shortening_offline_period(): void
    {
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null, 'current_period_end' => null]);
        $this->actingAsRole('clinic_admin');
        $this->checkout()->assertOk();
        $this->verify('sub_fake_1')->assertOk();
        $this->sub->refresh();
        $this->assertSame('active', $this->sub->status);
        $this->assertEqualsWithDelta(now()->addMonth()->timestamp, $this->sub->current_period_end->timestamp, 5);

        $this->sub->update(['razorpay_subscription_id' => null, 'current_period_end' => now()->addMonths(6)]);
        $sixMonths = $this->sub->refresh()->current_period_end->timestamp;
        $this->checkout()->assertOk();
        $this->verify('sub_fake_2')->assertOk();
        $this->assertSame($sixMonths, $this->sub->refresh()->current_period_end->timestamp);
    }

    public function test_clinic_transactions_hide_internal_fields(): void
    {
        $admin = $this->actingAsRole('clinic_admin');
        \App\Models\SubscriptionTransaction::create(['clinic_id' => $this->clinic->id, 'amount' => 1000, 'status' => 'captured', 'source' => 'offline',
            'notes' => 'internal note', 'recorded_by' => $admin->id, 'paid_at' => now()]);

        $tx = $this->getJson('/api/clinic/subscription')->assertOk()->json('data.transactions.0');
        $this->assertSame(1000, $tx['amount']);
        $this->assertArrayNotHasKey('notes', $tx);
        $this->assertArrayNotHasKey('recorded_by', $tx);
    }

    public function test_replaying_verify_for_linked_subscription_grants_nothing(): void
    {
        // Expired clinic already linked to a Razorpay subscription whose paid period lapsed.
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null, 'razorpay_subscription_id' => 'sub_linked',
            'current_period_end' => now()->subDays(10)]);
        $this->actingAsRole('clinic_admin');

        // Re-sending an old but genuinely valid confirmation must not unlock the clinic.
        $this->postJson('/api/clinic/subscription/verify', ['razorpay_payment_id' => 'pay_old', 'razorpay_subscription_id' => 'sub_linked', 'razorpay_signature' => 'valid'])
            ->assertOk();

        $this->sub->refresh();
        $this->assertSame('expired', $this->sub->status);
        $this->assertTrue($this->sub->current_period_end->isPast());
        $this->getJson('/api/clinic/patients')->assertStatus(402);
    }

    public function test_verify_twice_for_new_checkout_grants_one_period_only(): void
    {
        $this->sub->update(['status' => 'expired', 'trial_ends_at' => null, 'pending_razorpay_subscription_id' => 'sub_new']);
        $this->actingAsRole('clinic_admin');
        $body = ['razorpay_payment_id' => 'pay_1', 'razorpay_subscription_id' => 'sub_new', 'razorpay_signature' => 'valid'];

        $this->postJson('/api/clinic/subscription/verify', $body)->assertOk();
        $end = $this->sub->refresh()->current_period_end->timestamp;
        $this->travel(20)->days();
        $this->postJson('/api/clinic/subscription/verify', $body)->assertOk();

        $this->assertSame($end, $this->sub->refresh()->current_period_end->timestamp);
    }

    public function test_authorisation_only_verify_with_future_trial_grants_no_month(): void
    {
        // Super admin moved a trialing clinic into grace (past_due) while its trial end is still ahead.
        $this->sub->update(['status' => 'past_due', 'trial_ends_at' => now()->addDays(10), 'grace_ends_at' => now()->addDays(2),
            'pending_razorpay_subscription_id' => 'sub_future']);
        $this->actingAsRole('clinic_admin');

        // Razorpay only takes a refundable authorisation for a future-start subscription.
        $this->postJson('/api/clinic/subscription/verify', ['razorpay_payment_id' => 'pay_auth', 'razorpay_subscription_id' => 'sub_future', 'razorpay_signature' => 'valid'])
            ->assertOk();

        $this->sub->refresh();
        $this->assertSame('past_due', $this->sub->status);
        $this->assertNull($this->sub->current_period_end);
        $this->assertSame('sub_future', $this->sub->razorpay_subscription_id); // autopay is set up; the first charge activates
    }
}
