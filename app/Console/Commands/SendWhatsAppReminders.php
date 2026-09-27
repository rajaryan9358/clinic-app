<?php

namespace App\Console\Commands;

use App\Models\Appointment;
use App\Models\ClinicSetting;
use App\Models\ReminderLog;
use App\Services\WhatsApp\PatientNotifier;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

/**
 * Sends one WhatsApp reminder per upcoming appointment, `reminder_hours_before`
 * (clinic_settings, default 24; 0 = off) hours ahead of its start.
 *
 * appointment_date/start_time are clinic wall-clock values with no timezone
 * column (app.timezone is UTC), so each candidate's start is built as a
 * Carbon instant in config('app.clinic_timezone') before being compared
 * against now() — comparing the raw strings against a UTC "now" would drift
 * by the offset between UTC and clinic local time.
 *
 * Idempotent: a reminder_logs row (channel `whatsapp`, reminder_type
 * `appointment_reminder`) is created before the notifier is asked to send,
 * so a later run — including one that finds the row still `skipped` (no
 * phone / template disabled) — never reminds the same appointment twice.
 */
class SendWhatsAppReminders extends Command
{
    protected $signature = 'whatsapp:send-reminders';

    protected $description = 'Send WhatsApp reminders for upcoming appointments that are due';

    /** Cap from ClinicSetting::validationRules() (reminder_hours_before max:168) plus a day of slack. */
    private const MAX_HOURS_AHEAD = 168;

    public function handle(PatientNotifier $notifier): int
    {
        $tz = config('app.clinic_timezone', 'Asia/Kolkata');
        $now = Carbon::now();

        $prefilterStart = $now->clone()->timezone($tz)->startOfDay()->toDateString();
        $prefilterEnd = $now->clone()->timezone($tz)->startOfDay()
            ->addDays((int) ceil(self::MAX_HOURS_AHEAD / 24) + 1)
            ->toDateString();

        $alreadyReminded = ReminderLog::query()
            ->where('reminder_type', 'appointment_reminder')
            ->pluck('appointment_id')
            ->all();

        $hoursByClinic = ClinicSetting::query()->pluck('reminder_hours_before', 'clinic_id');

        $candidates = Appointment::query()
            ->whereIn('status', ['pending', 'confirmed'])
            ->whereBetween('appointment_date', [$prefilterStart, $prefilterEnd])
            ->when($alreadyReminded !== [], fn ($query) => $query->whereNotIn('id', $alreadyReminded))
            ->with(['clinic:id,name', 'doctor:id,full_name', 'patient:id,full_name,phone'])
            ->get();

        $sent = 0;

        foreach ($candidates as $appointment) {
            $hoursBefore = (int) ($hoursByClinic[$appointment->clinic_id] ?? 24);

            if ($hoursBefore <= 0) {
                continue;
            }

            $start = Carbon::parse(
                $appointment->appointment_date->toDateString().' '.$appointment->start_time,
                $tz,
            );

            $windowEnd = $now->clone()->addHours($hoursBefore);

            if ($start->lt($now) || $start->gt($windowEnd)) {
                continue;
            }

            $log = ReminderLog::create([
                'clinic_id' => $appointment->clinic_id,
                'appointment_id' => $appointment->id,
                'patient_id' => $appointment->patient_id,
                'channel' => 'whatsapp',
                'reminder_type' => 'appointment_reminder',
                'scheduled_for' => $start->clone()->subHours($hoursBefore)->utc(),
                'delivery_status' => 'pending',
            ]);

            $message = $notifier->appointmentReminder($appointment, $log);

            if ($message->delivery_status === 'skipped') {
                $log->delivery_status = 'skipped';
                $log->failure_reason = $message->error_message;
                $log->save();
            }

            $sent++;
        }

        $this->info("Processed {$sent} appointment reminder(s).");

        return self::SUCCESS;
    }
}
