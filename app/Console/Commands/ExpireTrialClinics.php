<?php

namespace App\Console\Commands;

use App\Models\Clinic;
use Illuminate\Console\Command;

class ExpireTrialClinics extends Command
{
    protected $signature = 'clinics:expire-trials';

    protected $description = 'Mark trial clinics as inactive when their trial period has ended';

    public function handle(): int
    {
        $expired = Clinic::query()
            ->where('status', 'trial')
            ->whereNotNull('trial_ends_at')
            ->where('trial_ends_at', '<=', now())
            ->get();

        $count = 0;
        foreach ($expired as $clinic) {
            $clinic->update(['status' => 'inactive']);
            $count++;
        }

        $this->info("Expired {$count} trial clinic(s).");

        return self::SUCCESS;
    }
}
