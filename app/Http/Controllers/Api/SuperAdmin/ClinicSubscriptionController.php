<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use App\Services\Billing\RazorpayGateway;
use App\Services\Billing\SubscriptionService;
use App\Services\Billing\SubscriptionValidation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;

class ClinicSubscriptionController
{
    use ApiResponse;

    public function __construct(
        private readonly SubscriptionService $service,
        private readonly RazorpayGateway $gateway,
    ) {}

    private function subscriptionOrFail(int $clinicId): ClinicSubscription
    {
        return ClinicSubscription::where('clinic_id', $clinicId)->firstOrFail();
    }

    public function store(Request $request, int $id)
    {
        $clinic = Clinic::findOrFail($id);

        if (ClinicSubscription::where('clinic_id', $clinic->id)->exists()) {
            return $this->error('This clinic already has a subscription.', null, 422);
        }

        $data = $request->validate(SubscriptionValidation::rules());
        $plan = Plan::findOrFail($data['plan_id']);
        SubscriptionValidation::assertYearlyPriceAvailable($plan, $data['billing_cycle']);

        $sub = $this->service->start($clinic, $plan, $data['billing_cycle'], $data['start_mode'], [
            'trial_days' => $data['trial_days'] ?? null,
            'amount' => $data['offline_amount'] ?? null,
            'period_months' => $data['offline_period_months'] ?? null,
            'notes' => $data['offline_notes'] ?? null,
        ], $request->user()->id);

        return $this->success('Subscription created', $sub, 201);
    }

    public function update(Request $request, int $id)
    {
        $sub = $this->subscriptionOrFail($id);
        $data = $request->validate([
            'plan_id' => ['required', 'integer', Rule::exists('plans', 'id')->whereNull('deleted_at')],
            'billing_cycle' => ['required', 'in:monthly,yearly'],
        ]);
        $plan = Plan::findOrFail($data['plan_id']);

        $sub = $this->service->changePlan($sub, $plan, $data['billing_cycle']);

        return $this->success('Plan changed', $sub);
    }

    public function extendTrial(Request $request, int $id)
    {
        $sub = $this->subscriptionOrFail($id);
        $data = $request->validate(['days' => ['required', 'integer', 'min:1', 'max:365']]);

        $sub = $this->service->extendTrial($sub, $data['days']);

        return $this->success('Trial extended', $sub);
    }

    public function extendGrace(Request $request, int $id)
    {
        $sub = $this->subscriptionOrFail($id);
        $data = $request->validate(['days' => ['required', 'integer', 'min:1', 'max:60']]);

        $sub = $this->service->extendGrace($sub, $data['days']);

        return $this->success('Grace period extended', $sub);
    }

    public function offlinePayment(Request $request, int $id)
    {
        $sub = $this->subscriptionOrFail($id);
        $data = $request->validate([
            'amount' => ['required', 'integer', 'min:1'],
            'period_months' => ['required', 'integer', 'min:1', 'max:36'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);

        $this->service->recordOfflinePayment($sub, $data['amount'], $data['period_months'], $data['notes'] ?? null, $request->user()->id);

        return $this->success('Offline payment recorded', $sub->refresh());
    }

    public function cancel(Request $request, int $id)
    {
        $sub = $this->subscriptionOrFail($id);

        if ($sub->razorpay_subscription_id) {
            try {
                $this->gateway->cancelSubscription($sub->razorpay_subscription_id, true);
            } catch (\Throwable $e) {
                Log::warning('Could not cancel Razorpay subscription', [
                    'subscription_id' => $sub->razorpay_subscription_id,
                    'error' => $e->getMessage(),
                ]);

                return $this->error('Could not cancel the Razorpay subscription: '.$e->getMessage().'. Nothing was changed.', null, 422);
            }
        }

        $pending = $sub->pending_razorpay_subscription_id;
        $sub->update(['status' => 'cancelled', 'cancelled_at' => now(), 'pending_razorpay_subscription_id' => null]);

        // A checkout still waiting for payment must not later revive the cancelled clinic.
        if ($pending) {
            $this->service->cancelQuietly($pending);
        }

        return $this->success('Subscription cancelled', $sub->refresh());
    }
}
