<?php

namespace App\Console\Commands;

use App\Models\Appointment;
use App\Models\ClinicSetting;
use App\Models\ReminderLog;
use App\Services\WhatsApp\PatientNotifier;
use Illuminate\Console\Command;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Throwable;

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
 * A unique index on (appointment_id, reminder_type) backs this up against
 * races between overlapping/concurrent runs.
 *
 * Each candidate is processed in isolation: if anything throws while
 * handling one appointment (a malformed start_time, a notifier failure,
 * ...), the already-created log for it is marked `failed` (so it isn't
 * retried forever) and the run continues with the remaining candidates
 * instead of aborting the whole batch.
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
            ->orderBy('id')
            ->get();

        $sent = 0;

        foreach ($candidates as $appointment) {
            $log = null;

            try {
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

                try {
                    $log = ReminderLog::create([
                        'clinic_id' => $appointment->clinic_id,
                        'appointment_id' => $appointment->id,
                        'patient_id' => $appointment->patient_id,
                        'channel' => 'whatsapp',
                        'reminder_type' => 'appointment_reminder',
                        'scheduled_for' => $start->clone()->subHours($hoursBefore)->utc(),
                        'delivery_status' => 'pending',
                    ]);
                } catch (UniqueConstraintViolationException) {
                    // Another (possibly overlapping) run already logged this
                    // appointment between our prefetch and this insert. Skip
                    // it silently rather than double-messaging the patient.
                    continue;
                }

                $message = $notifier->appointmentReminder($appointment, $log);

                if ($message->delivery_status === 'skipped') {
                    $log->delivery_status = 'skipped';
                    $log->failure_reason = $message->error_message;
                    $log->save();
                }

                $sent++;
            } catch (Throwable $e) {
                Log::warning('Failed to send WhatsApp appointment reminder', [
                    'appointment_id' => $appointment->id,
                    'error' => $e->getMessage(),
                ]);

                if ($log !== null && $log->exists) {
                    $log->delivery_status = 'failed';
                    $log->failure_reason = mb_substr($e->getMessage(), 0, 500);
                    $log->save();
                }
            }
        }

        $this->info("Processed {$sent} appointment reminder(s).");

        return self::SUCCESS;
    }
}
