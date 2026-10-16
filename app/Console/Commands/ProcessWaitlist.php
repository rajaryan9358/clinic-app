<?php

namespace App\Console\Commands;

use App\Services\Waitlist\WaitlistService;
use Illuminate\Console\Command;

/**
 * Scheduled every minute (routes/console.php): expires lapsed waitlist
 * holds and passes the slot to the next in line, expires holds on slots
 * someone else has since booked, and expires entries whose slot has
 * started. See WaitlistService::process(); safe to run repeatedly.
 */
class ProcessWaitlist extends Command
{
    protected $signature = 'waitlist:process';

    protected $description = 'Expire waitlist holds and past entries, and offer freed slots to the next in line';

    public function handle(WaitlistService $waitlist): int
    {
        $result = $waitlist->process();

        $this->info(sprintf(
            'Waitlist: %d hold(s) expired, %d past entr%s expired, %d offer(s) made.',
            $result['expired_holds'],
            $result['expired_past'],
            $result['expired_past'] === 1 ? 'y' : 'ies',
            $result['offered'],
        ));

        return self::SUCCESS;
    }
}
