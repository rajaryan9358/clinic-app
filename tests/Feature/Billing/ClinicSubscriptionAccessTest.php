<?php

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
