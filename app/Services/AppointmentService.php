<?php

namespace App\Services;

use App\Enums\AppointmentStatus;
use App\Models\Appointment;
use App\Models\AppointmentRescheduleLog;
use App\Models\AppointmentStatusLog;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\DoctorScheduleException;
use App\Models\Patient;
use App\Models\ReminderLog;
use App\Services\Billing\PlanLimits;
use App\Services\WhatsApp\PatientNotifier;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class AppointmentService
{
    /**
     * Runs a notifier call once the enclosing transaction actually commits,
     * so rolled-back work never sends anything. A notifier failure must
     * never break the booking/reschedule/cancel request itself.
     */
    private function notifyAfterCommit(\Closure $callback): void
    {
        DB::afterCommit(function () use ($callback) {
            try {
                $callback();
            } catch (\Throwable $e) {
                Log::warning('WhatsApp notifier failed: '.$e->getMessage(), ['exception' => $e]);
            }
        });
    }

    private function toYmd(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            return Carbon::parse($value)->toDateString();
        } catch (\Throwable) {
            $str = (string) $value;
            return $str !== '' ? substr($str, 0, 10) : null;
        }
    }

    private function appointmentStartDateTime(Appointment $appointment): ?Carbon
    {
        $date = $appointment->appointment_date;
        $time = (string) ($appointment->start_time ?? '');

        if (! $date || ! $time) {
            return null;
        }

        try {
            $ymd = $this->toYmd($date);
            if (! $ymd) {
                return null;
            }
            return Carbon::parse("{$ymd} {$time}");
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * @return array<int, array{date:string, slots:array<int, array{start_time:string, end_time:string, available:bool}>}>
     */
    public function getDoctorAvailability(int $clinicId, int $doctorId, string $fromDate, string $toDate, ?int $excludeAppointmentId = null): array
    {
        $from = Carbon::parse($fromDate)->startOfDay();
        $to = Carbon::parse($toDate)->startOfDay();

        if ($to->lessThan($from)) {
            [$from, $to] = [$to, $from];
        }

        $maxDays = 31;
        $days = min($maxDays, $from->diffInDays($to) + 1);

        $doctor = Doctor::query()
            ->forClinic($clinicId)
            ->whereKey($doctorId)
            ->firstOrFail();

        $bufferMinutes = (int) ($doctor->buffer_time_minutes ?? 0);

        $schedules = DoctorSchedule::query()
            ->forClinic($clinicId)
            ->where('doctor_id', $doctorId)
            ->where('is_active', true)
            ->get()
            ->groupBy('day_of_week');

        $exceptions = DoctorScheduleException::query()
            ->forClinic($clinicId)
            ->where('doctor_id', $doctorId)
            ->whereBetween('exception_date', [$from->toDateString(), $to->toDateString()])
            ->get()
            ->groupBy(fn ($e) => Carbon::parse($e->exception_date)->toDateString());

        $result = [];

        for ($i = 0; $i < $days; $i++) {
            $date = $from->copy()->addDays($i);
            $ymd = $date->toDateString();
            $dayOfWeek = $date->dayOfWeek; // 0=Sun ... 6=Sat

            $dayExceptions = $exceptions->get($ymd, collect());

            $hasFullDayLeave = $dayExceptions->contains(fn ($e) => $e->type === 'leave');
            $hasFullDayBlocked = $dayExceptions->contains(fn ($e) => $e->type === 'blocked' && empty($e->start_time) && empty($e->end_time));
            if ($hasFullDayLeave || $hasFullDayBlocked) {
                $result[] = ['date' => $ymd, 'slots' => []];
                continue;
            }

            $windows = [];

            $specialHours = $dayExceptions->filter(fn ($e) => $e->type === 'special_hours' && $e->start_time && $e->end_time);
            if ($specialHours->count()) {
                foreach ($specialHours as $ex) {
                    $windows[] = [
                        'start_time' => (string) $ex->start_time,
                        'end_time' => (string) $ex->end_time,
                        'slot_duration_minutes' => (int) ($doctor->slot_duration_minutes ?? 15),
                    ];
                }
            } else {
                $daySchedules = $schedules->get($dayOfWeek, collect());
                foreach ($daySchedules as $sch) {
                    $windows[] = [
                        'start_time' => (string) $sch->start_time,
                        'end_time' => (string) $sch->end_time,
                        'slot_duration_minutes' => (int) (($sch->slot_duration_minutes ?? null) ?: ($doctor->slot_duration_minutes ?? 15)),
                    ];
                }
            }

            $blockedWindows = $dayExceptions
                ->filter(fn ($e) => $e->type === 'blocked' && $e->start_time && $e->end_time)
                ->map(fn ($e) => ['start_time' => (string) $e->start_time, 'end_time' => (string) $e->end_time])
                ->values();

            if ($blockedWindows->count()) {
                $nextWindows = [];
                foreach ($windows as $w) {
                    $segments = [$w];
                    foreach ($blockedWindows as $b) {
                        $segments = $this->subtractWindow($segments, $b);
                        if (!count($segments)) break;
                    }
                    foreach ($segments as $seg) $nextWindows[] = $seg;
                }
                $windows = $nextWindows;
            }

            if (!count($windows)) {
                $result[] = ['date' => $ymd, 'slots' => []];
                continue;
            }

            $appointmentsQuery = Appointment::query()
                ->forClinic($clinicId)
                ->where('doctor_id', $doctorId)
                ->whereDate('appointment_date', $ymd)
                ->whereNotIn('status', [AppointmentStatus::CANCELLED->value, AppointmentStatus::RESCHEDULED->value])
                ->select(['id', 'start_time', 'end_time']);

            if ($excludeAppointmentId) {
                $appointmentsQuery->whereKeyNot($excludeAppointmentId);
            }

            $appointments = $appointmentsQuery->get();

            $bookedIntervals = $appointments
                ->map(function ($a) use ($doctor) {
                    $start = $this->timeToMinutes((string) $a->start_time);
                    $end = $a->end_time
                        ? $this->timeToMinutes((string) $a->end_time)
                        : ($start + (int) ($doctor->slot_duration_minutes ?? 15));
                    return [$start, max($start, $end)];
                })
                ->values()
                ->all();

            $slots = [];
            foreach ($windows as $w) {
                $startMin = $this->timeToMinutes((string) $w['start_time']);
                $endMin = $this->timeToMinutes((string) $w['end_time']);
                $slotDuration = max(1, (int) ($w['slot_duration_minutes'] ?? 15));
                $step = $slotDuration + max(0, $bufferMinutes);

                for ($t = $startMin; $t + $slotDuration <= $endMin; $t += $step) {
                    $slotStart = $t;
                    $slotEnd = $t + $slotDuration;

                    $overlaps = false;
                    foreach ($bookedIntervals as [$bStart, $bEnd]) {
                        if ($slotStart < $bEnd && $bStart < $slotEnd) {
                            $overlaps = true;
                            break;
                        }
                    }

                    $slots[] = [
                        'start_time' => $this->minutesToTime($slotStart),
                        'end_time' => $this->minutesToTime($slotEnd),
                        'available' => !$overlaps,
                    ];
                }
            }

            $result[] = ['date' => $ymd, 'slots' => $slots];
        }

        return $result;
    }

    /**
     * @param array<int, array{start_time:string, end_time:string, slot_duration_minutes:int}> $windows
     * @param array{start_time:string, end_time:string} $blocked
     * @return array<int, array{start_time:string, end_time:string, slot_duration_minutes:int}>
     */
    private function subtractWindow(array $windows, array $blocked): array
    {
        $bStart = $this->timeToMinutes($blocked['start_time']);
        $bEnd = $this->timeToMinutes($blocked['end_time']);
        if ($bEnd <= $bStart) return $windows;

        $out = [];
        foreach ($windows as $w) {
            $wStart = $this->timeToMinutes((string) $w['start_time']);
            $wEnd = $this->timeToMinutes((string) $w['end_time']);
            if ($wEnd <= $wStart) continue;

            // no overlap
            if ($bEnd <= $wStart || $wEnd <= $bStart) {
                $out[] = $w;
                continue;
            }

            // left segment
            if ($wStart < $bStart) {
                $out[] = [
                    ...$w,
                    'start_time' => $this->minutesToTime($wStart),
                    'end_time' => $this->minutesToTime(min($wEnd, $bStart)),
                ];
            }

            // right segment
            if ($bEnd < $wEnd) {
                $out[] = [
                    ...$w,
                    'start_time' => $this->minutesToTime(max($wStart, $bEnd)),
                    'end_time' => $this->minutesToTime($wEnd),
                ];
            }
        }

        return array_values(array_filter($out, function ($w) {
            $s = $this->timeToMinutes((string) $w['start_time']);
            $e = $this->timeToMinutes((string) $w['end_time']);
            return $e > $s;
        }));
    }

    private function timeToMinutes(string $time): int
    {
        $parts = explode(':', $time);
        $h = (int) ($parts[0] ?? 0);
        $m = (int) ($parts[1] ?? 0);
        return ($h * 60) + $m;
    }

    private function minutesToTime(int $minutes): string
    {
        $minutes = max(0, $minutes);
        $h = (int) floor($minutes / 60);
        $m = (int) ($minutes % 60);
        return sprintf('%02d:%02d', $h, $m);
    }

    public function create(array $data): Appointment
    {
        app(PlanLimits::class)->assertCanAdd((int) $data['clinic_id'], 'appointments');

        return DB::transaction(function () use ($data) {
            $patientId = $data['patient_id'] ?? null;

            $status = $data['status'] ?? 'pending';

            if (! $patientId && ! empty($data['patient'])) {
                $patient = Patient::firstOrCreate(
                    [
                        'clinic_id' => $data['clinic_id'],
                        'phone' => $data['patient']['phone'],
                    ],
                    [
                        'uuid' => (string) Str::uuid(),
                        'first_name' => $data['patient']['first_name'],
                        'full_name' => $data['patient']['full_name'] ?? $data['patient']['first_name'],
                        'last_name' => $data['patient']['last_name'] ?? null,
                        'email' => $data['patient']['email'] ?? null,
                        'gender' => $data['patient']['gender'] ?? null,
                        'dob' => $data['patient']['dob'] ?? null,
                        'age' => $data['patient']['age'] ?? null,
                    ]
                );
                $patientId = $patient->id;
            }

            $appointment = Appointment::create([
                ...$data,
                'status' => $status,
                'patient_id' => $patientId,
                'uuid' => (string) Str::uuid(),
            ]);

            AppointmentStatusLog::create([
                'clinic_id' => $appointment->clinic_id,
                'appointment_id' => $appointment->id,
                'new_status' => $status,
                'changed_by_user_id' => $data['booked_by_user_id'] ?? null,
                'source' => 'staff',
                'created_at' => now(),
            ]);

            $this->notifyAfterCommit(fn () => app(PatientNotifier::class)->bookingConfirmed($appointment));

            return $appointment;
        });
    }

    public function changeStatus(Appointment $appointment, AppointmentStatus $status, ?int $actorUserId = null, ?string $reason = null, bool $force = false): Appointment
    {
        return DB::transaction(function () use ($appointment, $status, $actorUserId, $reason, $force) {
            $oldStatus = $appointment->status;

            if (! $force) {
                $startAt = $this->appointmentStartDateTime($appointment);
                if ($startAt) {
                    if ($status === AppointmentStatus::CHECKED_IN) {
                        $allowedFrom = $startAt->copy()->subMinutes(15);
                        if (now()->lessThan($allowedFrom)) {
                            throw ValidationException::withMessages([
                                'status' => 'Check-in is allowed from 15 minutes before the appointment.',
                            ]);
                        }
                    }

                    if ($status === AppointmentStatus::NO_SHOW) {
                        $allowedAfter = $startAt->copy()->addMinutes(15);
                        if (now()->lessThan($allowedAfter)) {
                            throw ValidationException::withMessages([
                                'status' => 'No-show is allowed only after 15 minutes past the appointment time.',
                            ]);
                        }
                    }
                }
            }

            $appointment->status = $status->value;

            if ($status === AppointmentStatus::CONFIRMED) {
                $appointment->confirmed_at = now();
            }
            if ($status === AppointmentStatus::CHECKED_IN) {
                $appointment->checked_in_at = now();
            }
            if ($status === AppointmentStatus::COMPLETED) {
                $appointment->completed_at = now();
            }
            if ($status === AppointmentStatus::CANCELLED) {
                $appointment->cancelled_at = now();
                $appointment->cancellation_reason = $reason;
            }

            $appointment->save();

            AppointmentStatusLog::create([
                'clinic_id' => $appointment->clinic_id,
                'appointment_id' => $appointment->id,
                'old_status' => $oldStatus,
                'new_status' => $status->value,
                'changed_by_user_id' => $actorUserId,
                'source' => 'staff',
                'reason' => $reason,
                'created_at' => now(),
            ]);

            if ($status === AppointmentStatus::CANCELLED) {
                $this->notifyAfterCommit(fn () => app(PatientNotifier::class)->appointmentUpdated($appointment, 'cancelled'));
            }

            return $appointment->refresh();
        });
    }

    public function reschedule(Appointment $appointment, array $newData, ?int $actorUserId = null, ?string $reason = null): Appointment
    {
        return DB::transaction(function () use ($appointment, $newData, $actorUserId, $reason) {
            $currentStatus = (string) ($appointment->status ?? '');
            if (in_array($currentStatus, [AppointmentStatus::CANCELLED->value, AppointmentStatus::COMPLETED->value], true)) {
                throw ValidationException::withMessages([
                    'status' => 'Cannot reschedule a cancelled/completed appointment.',
                ]);
            }

            $oldDate = $this->toYmd($appointment->appointment_date) ?: (string) $appointment->appointment_date;
            $oldStart = (string) $appointment->start_time;
            $oldEnd = (string) ($appointment->end_time ?? '');

            $targetDate = (string) ($newData['appointment_date'] ?? ($appointment->appointment_date?->toDateString() ?: $appointment->appointment_date));
            $targetStart = (string) ($newData['start_time'] ?? $appointment->start_time);
            $targetEnd = array_key_exists('end_time', $newData)
                ? ($newData['end_time'] !== null ? (string) $newData['end_time'] : null)
                : ($appointment->end_time ? (string) $appointment->end_time : null);

            $conflictQuery = Appointment::query()
                ->forClinic($appointment->clinic_id)
                ->where('doctor_id', $appointment->doctor_id)
                ->whereDate('appointment_date', $targetDate)
                ->whereNotIn('status', [AppointmentStatus::CANCELLED->value, AppointmentStatus::RESCHEDULED->value])
                ->whereKeyNot($appointment->id);

            if ($targetEnd) {
                $conflictQuery->whereTime('start_time', '<', $targetEnd)
                    ->where(function ($q) use ($targetStart) {
                        $q->whereNull('end_time')->orWhereTime('end_time', '>', $targetStart);
                    });
            } else {
                $conflictQuery->whereTime('start_time', '=', $targetStart);
            }

            if ($conflictQuery->exists()) {
                throw ValidationException::withMessages([
                    'start_time' => 'Selected slot is already booked.',
                ]);
            }

            $appointment->appointment_date = $targetDate;
            $appointment->start_time = $targetStart;
            $appointment->end_time = $targetEnd;
            $appointment->save();

            AppointmentRescheduleLog::create([
                'clinic_id' => $appointment->clinic_id,
                // Keep both ids as the same appointment; old/new date-times capture the change.
                'old_appointment_id' => $appointment->id,
                'new_appointment_id' => $appointment->id,
                'old_appointment_date' => $oldDate ?: null,
                'old_start_time' => $oldStart ?: null,
                'old_end_time' => $oldEnd ?: null,
                'new_appointment_date' => $this->toYmd($appointment->appointment_date) ?: (string) $appointment->appointment_date,
                'new_start_time' => (string) $appointment->start_time,
                'new_end_time' => $appointment->end_time ? (string) $appointment->end_time : null,
                'changed_by_user_id' => $actorUserId,
                'reason' => $reason,
                'created_at' => now(),
            ]);

            // The reminder command skips any appointment that already has an
            // 'appointment_reminder' log, so once the slot moves, drop the
            // stale log(s) for it — otherwise the new date/time is never
            // reminded.
            ReminderLog::query()
                ->where('clinic_id', $appointment->clinic_id)
                ->where('appointment_id', $appointment->id)
                ->where('reminder_type', 'appointment_reminder')
                ->delete();

            $this->notifyAfterCommit(fn () => app(PatientNotifier::class)->appointmentUpdated($appointment, 'rescheduled'));

            return $appointment->refresh();
        });
    }
}
