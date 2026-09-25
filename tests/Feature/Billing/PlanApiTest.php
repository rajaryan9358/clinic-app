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
