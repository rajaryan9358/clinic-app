<?php

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
        $razorpayLapsed = $this->sub(['status' => 'active', 'current_period_end' => now()->subHour(), 'razorpay_subscription_id' => 'sub_2', 'grace_ends_at' => now()->subDays(40)]);
        $razorpayLive = $this->sub(['status' => 'active', 'current_period_end' => now()->addDay(), 'razorpay_subscription_id' => 'sub_3']);
        $graceOver = $this->sub(['status' => 'past_due', 'grace_ends_at' => now()->subHour()]);
        $pendingOver = $this->sub(['status' => 'pending_payment', 'grace_ends_at' => now()->subHour()]);
        $graceLive = $this->sub(['status' => 'past_due', 'grace_ends_at' => now()->addDay()]);

        $this->artisan('subscriptions:sync')->assertSuccessful();

        $this->assertSame('pending_payment', $endedTrial->refresh()->status);
        $this->assertNotNull($endedTrial->grace_ends_at);
        $this->assertSame('trialing', $liveTrial->refresh()->status);
        $this->assertSame('pending_payment', $razorpayTrial->refresh()->status); // a charged webhook activates it
        $this->assertNotNull($razorpayTrial->grace_ends_at);
        $this->assertSame('past_due', $offlineLapsed->refresh()->status);
        $this->assertSame('past_due', $razorpayLapsed->refresh()->status); // a late charged webhook re-activates it
        $this->assertTrue($razorpayLapsed->grace_ends_at->isFuture()); // fresh grace
        $this->assertSame('active', $razorpayLive->refresh()->status);
        $this->assertSame('expired', $graceOver->refresh()->status);
        $this->assertSame('expired', $pendingOver->refresh()->status);
        $this->assertSame('past_due', $graceLive->refresh()->status);
    }
}
