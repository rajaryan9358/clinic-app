<?php

namespace App\Services\Billing;

use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use App\Models\SubscriptionTransaction;
use App\Support\PlatformSettings;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SubscriptionService
{
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
        return DB::transaction(function () use ($sub, $amount, $periodMonths, $notes, $actorId) {
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
        $base = $sub->trial_ends_at && $sub->trial_ends_at->isFuture() ? $sub->trial_ends_at->copy() : now();
        $sub->update(['status' => 'trialing', 'trial_ends_at' => $base->addDays($days), 'grace_ends_at' => null]);

        return $sub->refresh();
    }

    public function extendGrace(ClinicSubscription $sub, int $days): ClinicSubscription
    {
        $base = $sub->grace_ends_at && $sub->grace_ends_at->isFuture() ? $sub->grace_ends_at->copy() : now();
        $status = in_array($sub->status, ['expired', 'trialing'], true) ? 'past_due' : $sub->status;
        $sub->update(['status' => $status, 'grace_ends_at' => $base->addDays($days)]);

        return $sub->refresh();
    }

    public function changePlan(ClinicSubscription $sub, Plan $plan, string $cycle): ClinicSubscription
    {
        if ($sub->razorpay_subscription_id) {
            throw ValidationException::withMessages(['plan' => 'This clinic pays through Razorpay. Cancel the subscription before changing plan.']);
        }
        $sub->update(['plan_id' => $plan->id, 'billing_cycle' => $cycle]);

        return $sub->refresh();
    }
}
