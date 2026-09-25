<?php

namespace App\Console\Commands;

use App\Models\ClinicSubscription;
use App\Services\Billing\SubscriptionService;
use Illuminate\Console\Command;

class SyncSubscriptions extends Command
{
    protected $signature = 'subscriptions:sync';

    protected $description = 'Move trials, offline periods and grace periods to their next subscription state';

    public function handle(SubscriptionService $service): int
    {
        $now = now();
        $count = 0;

        ClinicSubscription::query()->where('status', 'trialing')->whereNull('razorpay_subscription_id')
            ->whereNotNull('trial_ends_at')->where('trial_ends_at', '<=', $now)
            ->each(function (ClinicSubscription $s) use ($service, &$count) { $service->markPastDue($s, 'pending_payment'); $count++; });

        ClinicSubscription::query()->where('status', 'active')->whereNull('razorpay_subscription_id')
            ->whereNotNull('current_period_end')->where('current_period_end', '<=', $now)
            ->each(function (ClinicSubscription $s) use ($service, &$count) { $s->update(['grace_ends_at' => null]); $service->markPastDue($s, 'past_due'); $count++; });

        $count += ClinicSubscription::query()->whereIn('status', ['pending_payment', 'past_due'])
            ->whereNotNull('grace_ends_at')->where('grace_ends_at', '<=', $now)
            ->update(['status' => 'expired']);

        $this->info("Updated {$count} subscription(s).");

        return self::SUCCESS;
    }
}
