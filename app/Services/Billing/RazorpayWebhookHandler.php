<?php

namespace App\Services\Billing;

use App\Models\ClinicSubscription;
use App\Models\SubscriptionTransaction;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;

class RazorpayWebhookHandler
{
    public function __construct(private readonly SubscriptionService $service) {}

    public function handle(string $event, array $payload): void
    {
        $subEntity = $payload['subscription']['entity'] ?? null;
        $payment = $payload['payment']['entity'] ?? null;
        $subscriptionId = $subEntity['id'] ?? ($payment['subscription_id'] ?? ($payment['notes']['subscription_id'] ?? null));

        $sub = $subscriptionId ? ClinicSubscription::query()->where('razorpay_subscription_id', $subscriptionId)->first() : null;
        if (! $sub && $subscriptionId) {
            $sub = ClinicSubscription::query()->where('pending_razorpay_subscription_id', $subscriptionId)->first();
            if ($sub) {
                if (! in_array($event, ['subscription.authenticated', 'subscription.activated', 'subscription.charged'], true)) {
                    Log::info('Ignoring Razorpay event for a not-yet-confirmed subscription', ['event' => $event, 'subscription_id' => $subscriptionId]);

                    return;
                }
                $this->service->promotePending($sub, $subscriptionId);
                $sub->refresh();
            }
        }
        if (! $sub) {
            Log::info('Razorpay webhook for unknown subscription', ['event' => $event, 'subscription_id' => $subscriptionId]);

            return;
        }

        $start = isset($subEntity['current_start']) ? Carbon::createFromTimestamp($subEntity['current_start']) : null;
        $end = isset($subEntity['current_end']) ? Carbon::createFromTimestamp($subEntity['current_end']) : null;

        match ($event) {
            'subscription.authenticated' => null, // promotion only; charged/activated set the status
            'subscription.activated', 'subscription.pending', 'subscription.halted' => $this->lifecycle($event, $sub, $start, $end),
            'subscription.charged' => $this->charged($sub, $subscriptionId, $payment ?? [], $payload['invoice']['entity'] ?? null, $start, $end),
            'subscription.cancelled' => $sub->update(['status' => 'cancelled', 'cancelled_at' => now()]),
            'subscription.completed' => $sub->update(['status' => 'expired']),
            'payment.failed' => $this->failed($sub, $payment ?? []),
            default => null,
        };
    }

    private function lifecycle(string $event, ClinicSubscription $sub, ?Carbon $start, ?Carbon $end): void
    {
        $cancelled = $sub->status === 'cancelled' && $sub->cancelled_at !== null;
        $ignore = $event === 'subscription.activated' ? $cancelled : ($cancelled || $sub->status === 'expired');
        if ($ignore) {
            Log::info('Ignoring Razorpay event for terminated subscription', ['event' => $event, 'subscription_id' => $sub->razorpay_subscription_id]);

            return;
        }

        match ($event) {
            'subscription.activated' => $this->service->activate($sub, $start, $end),
            'subscription.pending', 'subscription.halted' => $this->service->markPastDue($sub, 'past_due'),
        };
    }

    private function charged(ClinicSubscription $sub, string $subscriptionId, array $payment, ?array $invoice, ?Carbon $start, ?Carbon $end): void
    {
        if (! empty($payment['id'])) {
            SubscriptionTransaction::query()->updateOrCreate(
                ['razorpay_payment_id' => $payment['id']],
                [
                    'clinic_id' => $sub->clinic_id, 'clinic_subscription_id' => $sub->id, 'plan_id' => $sub->plan_id,
                    'billing_cycle' => $sub->billing_cycle, 'amount' => (int) ($payment['amount'] ?? 0), 'status' => 'captured',
                    'source' => 'razorpay', 'method' => $payment['method'] ?? null, 'razorpay_subscription_id' => $sub->razorpay_subscription_id,
                    'razorpay_invoice_id' => $payment['invoice_id'] ?? ($invoice['id'] ?? null), 'invoice_url' => $invoice['short_url'] ?? null,
                    'paid_at' => now(), 'period_start' => $start, 'period_end' => $end,
                ],
            );
        }

        if ($sub->status === 'cancelled' && $sub->cancelled_at !== null && $subscriptionId === $sub->razorpay_subscription_id) {
            if ($end) {
                $sub->update(['current_period_end' => $end]); // paid access is honoured, cancellation stands
            }

            return;
        }

        $this->service->activate($sub, $start, $end);
    }

    private function failed(ClinicSubscription $sub, array $payment): void
    {
        if (empty($payment['id'])) {
            return;
        }
        SubscriptionTransaction::query()->updateOrCreate(
            ['razorpay_payment_id' => $payment['id']],
            [
                'clinic_id' => $sub->clinic_id, 'clinic_subscription_id' => $sub->id, 'plan_id' => $sub->plan_id,
                'billing_cycle' => $sub->billing_cycle, 'amount' => (int) ($payment['amount'] ?? 0), 'status' => 'failed',
                'source' => 'razorpay', 'method' => $payment['method'] ?? null, 'razorpay_subscription_id' => $sub->razorpay_subscription_id,
                'failure_reason' => $payment['error_description'] ?? null,
            ],
        );
    }
}
