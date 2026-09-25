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
