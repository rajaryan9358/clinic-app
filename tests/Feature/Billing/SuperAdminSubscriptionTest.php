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

        $failed = $this->getJson('/api/super-admin/subscription-transactions?clinic_id='.$this->clinic->id.'&status=failed')->assertOk();
        $this->assertCount(1, $failed->json('data.data'));
        $this->assertSame(1000, $failed->json('meta.total_captured'));
    }

    public function test_cancel_gateway_failure_returns_422_without_changing_status(): void
    {
        $this->postJson($this->base(), ['plan_id' => $this->starter->id, 'billing_cycle' => 'monthly', 'start_mode' => 'trial'])->assertCreated();
        ClinicSubscription::first()->update(['razorpay_subscription_id' => 'sub_1']);

        $failing = new class extends FakeRazorpayGateway
        {
            public function cancelSubscription(string $subscriptionId, bool $atCycleEnd): void
            {
                throw new \RuntimeException('boom');
            }
        };
        $this->app->instance(RazorpayGateway::class, $failing);

        $response = $this->postJson($this->base().'/cancel')->assertStatus(422);
        $this->assertStringContainsString('Nothing was changed.', $response->json('message'));
        $this->assertNotSame('cancelled', ClinicSubscription::first()->status);
    }

    public function test_actions_404_when_no_subscription(): void
    {
        $this->putJson($this->base(), ['plan_id' => $this->starter->id, 'billing_cycle' => 'monthly'])->assertStatus(404);
        $this->postJson($this->base().'/extend-trial', ['days' => 3])->assertStatus(404);
        $this->postJson($this->base().'/extend-grace', ['days' => 3])->assertStatus(404);
        $this->postJson($this->base().'/offline-payment', ['amount' => 1000, 'period_months' => 1])->assertStatus(404);
        $this->postJson($this->base().'/cancel')->assertStatus(404);
    }

    private function linked(array $attrs): ClinicSubscription
    {
        return ClinicSubscription::create(array_merge(['clinic_id' => $this->clinic->id, 'plan_id' => $this->starter->id, 'billing_cycle' => 'monthly',
            'razorpay_subscription_id' => 'sub_link'], $attrs));
    }

    public function test_extend_trial_refused_for_linked_clinic(): void
    {
        $this->linked(['status' => 'trialing', 'trial_ends_at' => now()->addDays(3)]);
        $this->postJson($this->base().'/extend-trial', ['days' => 5])->assertStatus(422)
            ->assertJsonFragment(['message' => "This clinic pays through Razorpay; its trial can't be extended."]);
    }

    public function test_extend_grace_on_cancelled_moves_to_past_due(): void
    {
        $this->linked(['status' => 'cancelled', 'cancelled_at' => now()]);
        $this->postJson($this->base().'/extend-grace', ['days' => 2])->assertOk();
        $sub = ClinicSubscription::first();
        $this->assertSame('past_due', $sub->status);
        $this->assertNull($sub->cancelled_at);
        $this->assertTrue($sub->grace_ends_at->isFuture());
    }

    public function test_change_plan_on_cancelled_linked_clears_link(): void
    {
        $this->linked(['status' => 'cancelled', 'cancelled_at' => now(), 'pending_razorpay_subscription_id' => 'sub_pend']);
        $this->putJson($this->base(), ['plan_id' => $this->pro->id, 'billing_cycle' => 'monthly'])->assertOk();
        $sub = ClinicSubscription::first();
        $this->assertSame($this->pro->id, $sub->plan_id);
        $this->assertNull($sub->razorpay_subscription_id);
        $this->assertNull($sub->pending_razorpay_subscription_id);
    }

    public function test_offline_payment_refused_while_linked_and_live(): void
    {
        $this->linked(['status' => 'active']);
        $this->postJson($this->base().'/offline-payment', ['amount' => 1000, 'period_months' => 1])->assertStatus(422)
            ->assertJsonFragment(['message' => 'This clinic pays through Razorpay. Cancel it before recording an offline payment.']);
        $this->assertSame(0, SubscriptionTransaction::count());
    }

    public function test_offline_payment_on_expired_linked_clears_link_and_pending(): void
    {
        $this->linked(['status' => 'expired', 'pending_razorpay_subscription_id' => 'sub_pend']);
        $this->postJson($this->base().'/offline-payment', ['amount' => 1000, 'period_months' => 1])->assertOk();
        $sub = ClinicSubscription::first();
        $this->assertSame('active', $sub->status);
        $this->assertNull($sub->razorpay_subscription_id);
        $this->assertNull($sub->pending_razorpay_subscription_id);
        $this->assertSame([['subscriptionId' => 'sub_pend', 'atCycleEnd' => false]], $this->gw->cancelled);
    }

    public function test_clinics_list_includes_subscription_status(): void
    {
        ClinicSubscription::create(['clinic_id' => $this->clinic->id, 'plan_id' => $this->starter->id, 'billing_cycle' => 'monthly', 'status' => 'past_due', 'grace_ends_at' => now()->addDay()]);
        $row = collect($this->getJson('/api/super-admin/clinics')->assertOk()->json('data'))->firstWhere('id', $this->clinic->id);
        $this->assertSame('past_due', $row['subscription']['status']);
    }

    public function test_extend_grace_on_terminated_linked_clinic_unlinks_and_cancels_old_subscription(): void
    {
        foreach (['cancelled', 'expired'] as $status) {
            ClinicSubscription::query()->delete();
            $this->gw->cancelled = [];
            $this->linked(['status' => $status, 'cancelled_at' => $status === 'cancelled' ? now() : null]);

            $this->postJson($this->base().'/extend-grace', ['days' => 2])->assertOk();

            $sub = ClinicSubscription::first();
            $this->assertSame('past_due', $sub->status, $status);
            $this->assertNull($sub->razorpay_subscription_id, $status);
            $this->assertSame([['subscriptionId' => 'sub_link', 'atCycleEnd' => false]], $this->gw->cancelled, $status);

            // The super admin is no longer stuck: an offline payment can now be recorded.
            $this->postJson($this->base().'/offline-payment', ['amount' => 1000, 'period_months' => 1])->assertOk();
            $this->assertSame('active', ClinicSubscription::first()->status, $status);
        }
    }

    public function test_extend_grace_on_live_subscription_keeps_link(): void
    {
        $this->linked(['status' => 'past_due', 'grace_ends_at' => now()->addDay()]);
        $this->postJson($this->base().'/extend-grace', ['days' => 2])->assertOk();
        $this->assertSame('sub_link', ClinicSubscription::first()->razorpay_subscription_id);
        $this->assertSame([], $this->gw->cancelled);
    }

    public function test_cancel_also_cancels_pending_checkout(): void
    {
        $this->linked(['status' => 'active', 'pending_razorpay_subscription_id' => 'sub_pend']);
        $this->postJson($this->base().'/cancel')->assertOk();

        $sub = ClinicSubscription::first();
        $this->assertSame('cancelled', $sub->status);
        $this->assertNull($sub->pending_razorpay_subscription_id);
        $this->assertContains(['subscriptionId' => 'sub_link', 'atCycleEnd' => true], $this->gw->cancelled);
        $this->assertContains(['subscriptionId' => 'sub_pend', 'atCycleEnd' => false], $this->gw->cancelled);
    }

    public function test_extend_grace_never_ends_a_paid_period_early(): void
    {
        $this->linked(['status' => 'cancelled', 'cancelled_at' => now(), 'current_period_end' => now()->addDays(20)]);
        $this->postJson($this->base().'/extend-grace', ['days' => 2])->assertOk();
        $this->assertEqualsWithDelta(now()->addDays(22)->timestamp, ClinicSubscription::first()->grace_ends_at->timestamp, 5);
    }

    public function test_extend_grace_on_trialing_clinic_never_ends_access_before_trial_end(): void
    {
        ClinicSubscription::create(['clinic_id' => $this->clinic->id, 'plan_id' => $this->starter->id, 'billing_cycle' => 'monthly',
            'status' => 'trialing', 'trial_ends_at' => now()->addDays(10)]);
        $this->postJson($this->base().'/extend-grace', ['days' => 2])->assertOk();
        $this->assertEqualsWithDelta(now()->addDays(12)->timestamp, ClinicSubscription::first()->grace_ends_at->timestamp, 5);
    }
}
