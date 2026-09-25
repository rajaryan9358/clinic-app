<?php

namespace App\Services\Billing;

use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use App\Models\SubscriptionTransaction;
use App\Support\PlatformSettings;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

class SubscriptionService
{
    public function __construct(private readonly RazorpayGateway $gateway)
    {
    }

    public function graceDays(): int
    {
        return max(0, (int) PlatformSettings::get('subscription_grace_days', 3));
    }

    public function start(Clinic $clinic, Plan $plan, string $cycle, string $mode, array $opts = [], ?int $actorId = null): ClinicSubscription
    {
        return DB::transaction(function () use ($clinic, $plan, $cycle, $mode, $opts, $actorId) {
            $sub = ClinicSubscription::create([
                'clinic_id' => $clinic->id,
                'plan_id' => $plan->id,
                'billing_cycle' => $cycle,
                'status' => 'pending_payment',
                'grace_ends_at' => now()->addDays($this->graceDays()),
            ]);

            if ($mode === 'trial') {
                $days = (int) ($opts['trial_days'] ?? PlatformSettings::get('trial_days', 14));
                $sub->update(['status' => 'trialing', 'trial_ends_at' => now()->addDays(max(1, $days)), 'grace_ends_at' => null]);
            } elseif ($mode === 'paid_offline') {
                $months = (int) ($opts['period_months'] ?? ($cycle === 'yearly' ? 12 : 1));
                $this->recordOfflinePayment($sub, (int) $opts['amount'], max(1, $months), $opts['notes'] ?? null, $actorId);
            }

            return $sub->refresh();
        });
    }

    public function recordOfflinePayment(ClinicSubscription $sub, int $amount, int $periodMonths, ?string $notes, ?int $actorId): SubscriptionTransaction
    {
        if ($sub->razorpay_subscription_id && in_array($sub->status, ['active', 'past_due', 'trialing', 'pending_payment'], true)) {
            throw ValidationException::withMessages(['subscription' => 'This clinic pays through Razorpay. Cancel it before recording an offline payment.']);
        }

        $pendingId = $sub->pending_razorpay_subscription_id;
        $tx = DB::transaction(function () use ($sub, $amount, $periodMonths, $notes, $actorId) {
            if ($sub->razorpay_subscription_id || $sub->pending_razorpay_subscription_id) {
                $sub->update(['razorpay_subscription_id' => null, 'pending_razorpay_subscription_id' => null]);
            }
            $start = $sub->current_period_end && $sub->current_period_end->isFuture() ? $sub->current_period_end->copy() : now();
            $end = $start->copy()->addMonths($periodMonths);

            $tx = SubscriptionTransaction::create([
                'clinic_id' => $sub->clinic_id, 'clinic_subscription_id' => $sub->id, 'plan_id' => $sub->plan_id,
                'billing_cycle' => $sub->billing_cycle, 'amount' => $amount, 'status' => 'captured', 'source' => 'offline',
                'notes' => $notes, 'recorded_by' => $actorId, 'paid_at' => now(), 'period_start' => $start, 'period_end' => $end,
            ]);
            $this->activate($sub, $start, $end);

            return $tx;
        });

        if ($pendingId) {
            $this->cancelQuietly($pendingId);
        }

        return $tx;
    }

    public function cancelQuietly(string $subscriptionId): void
    {
        try {
            $this->gateway->cancelSubscription($subscriptionId, false);
        } catch (\Throwable $e) {
            Log::warning('Could not cancel Razorpay subscription', ['subscription_id' => $subscriptionId, 'error' => $e->getMessage()]);
        }
    }

    public function activate(ClinicSubscription $sub, ?\DateTimeInterface $periodStart = null, ?\DateTimeInterface $periodEnd = null): ClinicSubscription
    {
        $sub->update(array_filter([
            'status' => 'active',
            'grace_ends_at' => null,
            'current_period_start' => $periodStart ? Carbon::instance($periodStart) : null,
            'current_period_end' => $periodEnd ? Carbon::instance($periodEnd) : null,
        ], fn ($v, $k) => $v !== null || $k === 'grace_ends_at', ARRAY_FILTER_USE_BOTH));

        return $sub->refresh();
    }

    public function markPastDue(ClinicSubscription $sub, string $status = 'past_due'): ClinicSubscription
    {
        $sub->update([
            'status' => $status,
            'grace_ends_at' => $sub->grace_ends_at ?? now()->addDays($this->graceDays()),
        ]);

        return $sub->refresh();
    }

    public function extendTrial(ClinicSubscription $sub, int $days): ClinicSubscription
    {
        if ($sub->razorpay_subscription_id) {
            throw ValidationException::withMessages(['subscription' => "This clinic pays through Razorpay; its trial can't be extended."]);
        }
        $base = $sub->trial_ends_at && $sub->trial_ends_at->isFuture() ? $sub->trial_ends_at->copy() : now();
        $sub->update(['status' => 'trialing', 'trial_ends_at' => $base->addDays($days), 'grace_ends_at' => null]);

        return $sub->refresh();
    }

    public function extendGrace(ClinicSubscription $sub, int $days): ClinicSubscription
    {
        // Grace extends from the latest of now, the current grace end, any still-paid period end and a future trial end,
        // so extending grace never shortens access a clinic has already paid for.
        $base = collect([now(), $sub->grace_ends_at, $sub->current_period_end, $sub->trial_ends_at])
            ->filter()->map(fn ($d) => $d->copy())->sortDesc()->first();
        $status = in_array($sub->status, ['expired', 'trialing', 'cancelled'], true) ? 'past_due' : $sub->status;
        $attrs = ['status' => $status, 'grace_ends_at' => $base->addDays($days)];
        $terminatedLink = null;
        if (in_array($sub->status, ['expired', 'cancelled'], true)) {
            $attrs['cancelled_at'] = null;
            // The linked Razorpay subscription is finished (or being wound down); detach it so the clinic can
            // pay again or be paid offline, and so its later webhooks no longer match this clinic.
            $terminatedLink = $sub->razorpay_subscription_id;
            $attrs['razorpay_subscription_id'] = null;
        }
        $sub->update($attrs);

        if ($terminatedLink) {
            $this->cancelQuietly($terminatedLink);
        }

        return $sub->refresh();
    }

    public function changePlan(ClinicSubscription $sub, Plan $plan, string $cycle): ClinicSubscription
    {
        $terminated = in_array($sub->status, ['cancelled', 'expired'], true);
        if ($sub->razorpay_subscription_id && ! $terminated) {
            throw ValidationException::withMessages(['plan' => 'This clinic pays through Razorpay. Cancel the subscription before changing plan.']);
        }
        $attrs = ['plan_id' => $plan->id, 'billing_cycle' => $cycle];
        if ($terminated) {
            $attrs += ['razorpay_subscription_id' => null, 'pending_razorpay_subscription_id' => null];
        }
        $sub->update($attrs);

        return $sub->refresh();
    }

    public function beginCheckout(ClinicSubscription $sub, Plan $plan, string $cycle): array
    {
        if (! $this->gateway->isConfigured()) {
            throw ValidationException::withMessages(['payments' => 'Online payments are not configured yet.']);
        }
        if (! $plan->is_active) {
            throw ValidationException::withMessages(['plan_id' => 'This plan is not available.']);
        }
        $amount = $plan->priceFor($cycle);
        if ($amount === null) {
            throw ValidationException::withMessages(['billing_cycle' => 'This plan has no yearly price.']);
        }

        if ($sub->status === 'active' && $sub->razorpay_subscription_id) {
            throw ValidationException::withMessages(['subscription' => 'Your clinic already has an active subscription.']);
        }

        $column = $cycle === 'yearly' ? 'razorpay_plan_id_yearly' : 'razorpay_plan_id_monthly';
        if (! $plan->{$column}) {
            $plan->update([$column => $this->gateway->createPlan($cycle, $amount, "{$plan->name} ({$cycle})")]);
        }

        $later = collect([$sub->trial_ends_at, $sub->current_period_end])->filter()->max();
        $startAt = $later && $later->isFuture() ? $later->timestamp : null;

        $created = $this->gateway->createSubscription($plan->{$column}, $cycle === 'yearly' ? 10 : 120, $startAt, [
            'clinic_id' => (string) $sub->clinic_id, 'plan_id' => (string) $plan->id, 'billing_cycle' => $cycle,
        ]);

        $previousPending = $sub->pending_razorpay_subscription_id;
        $sub->update(['plan_id' => $plan->id, 'billing_cycle' => $cycle, 'pending_razorpay_subscription_id' => $created['id']]);
        if ($previousPending && $previousPending !== $created['id']) {
            $this->cancelQuietly($previousPending);
        }

        return ['subscription_id' => $created['id'], 'key_id' => (string) $this->gateway->keyId(), 'amount' => $amount];
    }

    public function confirmCheckout(ClinicSubscription $sub, string $paymentId, string $subscriptionId, string $signature): ClinicSubscription
    {
        $known = in_array($subscriptionId, array_filter([$sub->pending_razorpay_subscription_id, $sub->razorpay_subscription_id]), true);
        if (! $known || ! $this->gateway->verifyPaymentSignature($paymentId, $subscriptionId, $signature)) {
            throw ValidationException::withMessages(['razorpay_signature' => 'Payment could not be verified.']);
        }

        // Only a newly confirmed checkout may change access. Re-verifying an already linked subscription
        // (e.g. replaying an old, valid confirmation) grants nothing: webhooks drive its state.
        if (! $this->promotePending($sub, $subscriptionId)) {
            return $sub->refresh();
        }

        // While a trial end is still ahead, Razorpay only took a refundable authorisation (the subscription
        // starts at trial end). Autopay is now set up, but access is unchanged until the first real charge.
        if ($sub->trial_ends_at && $sub->trial_ends_at->isFuture()) {
            return $sub->refresh();
        }

        if ($sub->current_period_end && $sub->current_period_end->isFuture()) {
            return $this->activate($sub); // never shorten a longer (e.g. offline) period
        }

        $now = now();

        return $this->activate($sub, $now, $sub->billing_cycle === 'yearly' ? $now->copy()->addYear() : $now->copy()->addMonth());
    }

    /**
     * Promote $subscriptionId from pending to linked when it is this clinic's pending Razorpay subscription.
     * Returns true when a promotion happened.
     */
    public function promotePending(ClinicSubscription $sub, string $subscriptionId): bool
    {
        if ($sub->pending_razorpay_subscription_id !== $subscriptionId) {
            return false;
        }
        $this->promote($sub, $subscriptionId);

        return true;
    }

    private function promote(ClinicSubscription $sub, string $newId): void
    {
        $old = $sub->razorpay_subscription_id;
        $sub->update(['razorpay_subscription_id' => $newId, 'pending_razorpay_subscription_id' => null, 'cancelled_at' => null]);

        if ($old && $old !== $newId) {
            $this->cancelQuietly($old);
        }
    }
}
