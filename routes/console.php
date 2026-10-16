<?php

use App\Console\Commands\ProcessWaitlist;
use App\Console\Commands\SendWhatsAppReminders;
use App\Console\Commands\SyncSubscriptions;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command(SyncSubscriptions::class)->hourly();
Schedule::command(SendWhatsAppReminders::class)->everyFifteenMinutes()->withoutOverlapping();
Schedule::command(ProcessWaitlist::class)->everyMinute()->withoutOverlapping();
