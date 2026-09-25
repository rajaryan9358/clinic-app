<?php
// app/Http/Controllers/Api/Clinic/SubscriptionController.php
namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use App\Models\SubscriptionTransaction;
use App\Services\Billing\PlanLimits;
use App\Services\Billing\RazorpayGateway;
use App\Services\Billing\SubscriptionService;
use Illuminate\Http\Request;

class SubscriptionController
{
    use ApiResponse;

    public function __construct(
        private readonly SubscriptionService $service,
        private readonly PlanLimits $limits,
        private readonly RazorpayGateway $gateway,
    ) {}

    private function clinic(Request $request): Clinic
    {
        return Clinic::query()->with('subscription.plan')->findOrFail((int) ($request->attributes->get('clinic_id') ?? $request->user()->clinic_id));
    }

    private function subscriptionOrFail(Clinic $clinic): ClinicSubscription
    {
        abort_unless($clinic->subscription, 404, 'This clinic has no subscription.');

        return $clinic->subscription;
    }

    public function show(Request $request)
    {
        $clinic = $this->clinic($request);
        $sub = $clinic->subscription;
        $plan = $sub?->plan;

        return $this->success('Subscription fetched', [
            'subscription' => $sub,
            'plan' => $plan,
            'usage' => $this->limits->usage($clinic),
            'limits' => [
                'doctors' => $plan?->limitFor('doctors'),
                'staff' => $plan?->limitFor('staff'),
                'appointments' => $plan?->limitFor('appointments'),
            ],
            'plans' => Plan::query()->where('is_active', true)->orderBy('sort_order')->orderBy('id')
                ->get(['id', 'name', 'description', 'monthly_price', 'yearly_price', 'max_doctors', 'max_staff', 'max_appointments_per_month']),
            'transactions' => SubscriptionTransaction::query()->where('clinic_id', $clinic->id)->with('plan:id,name')
                ->latest()->limit(50)->get()->makeHidden(['notes', 'recorded_by']),
            'razorpay_key_id' => $this->gateway->keyId(),
            'payments_configured' => $this->gateway->isConfigured(),
        ]);
    }

    public function checkout(Request $request)
    {
        abort_unless($request->user()->role === 'clinic_admin', 403, 'Only the clinic admin can manage the subscription.');
        $data = $request->validate(['plan_id' => ['required', 'integer'], 'billing_cycle' => ['required', 'in:monthly,yearly']]);
        $clinic = $this->clinic($request);
        $plan = Plan::query()->find($data['plan_id']);
        if (! $plan) {
            return $this->error('Plan not found.', ['plan_id' => ['Plan not found.']], 422);
        }

        $result = $this->service->beginCheckout($this->subscriptionOrFail($clinic), $plan, $data['billing_cycle']);
        $admin = $request->user();

        return $this->success('Checkout started', $result + [
            'name' => $clinic->name, 'email' => $admin->email, 'phone' => $admin->phone,
        ]);
    }

    public function verify(Request $request)
    {
        abort_unless($request->user()->role === 'clinic_admin', 403);
        $data = $request->validate([
            'razorpay_payment_id' => ['required', 'string'],
            'razorpay_subscription_id' => ['required', 'string'],
            'razorpay_signature' => ['required', 'string'],
        ]);
        $sub = $this->service->confirmCheckout($this->subscriptionOrFail($this->clinic($request)),
            $data['razorpay_payment_id'], $data['razorpay_subscription_id'], $data['razorpay_signature']);

        return $this->success('Payment verified', $sub);
    }
}
