<?php

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
