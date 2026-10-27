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
use App\Services\Waitlist\WaitlistService;
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

    /**
     * Once the enclosing transaction commits, offers the slot an
     * appointment just left (cancel/reschedule-away) to the waitlist. Like
     * notifyAfterCommit(), a failure here is logged and never breaks the
     * request that freed the slot.
     */
    private function slotFreedAfterCommit(int $clinicId, int $doctorId, string $date, string $start): void
    {
        DB::afterCommit(function () use ($clinicId, $doctorId, $date, $start) {
            try {
                app(WaitlistService::class)->slotFreed($clinicId, $doctorId, $date, $start);
            } catch (\Throwable $e) {
                Log::warning('Waitlist slotFreed failed: '.$e->getMessage(), ['exception' => $e]);
            }
        });
    }

    /**
     * 'H:i' / 'H:i:s' → 'H:i:s'. whereTime() compiles to TIME(col) <op> ?,
     * which MySQL and SQLite compare as strings, so an 'H:i' binding makes
     * '10:30:00' > '10:30' true and back-to-back slots look like conflicts.
     */
    private function toHis(string $value): string
    {
        try {
            return Carbon::parse($value)->format('H:i:s');
        } catch (\Throwable) {
            return $value;
        }
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
            // Slot times are clinic-local; compare as an app-timezone instant.
            return Carbon::parse("{$ymd} {$time}", config('app.clinic_timezone', 'Asia/Kolkata'))
                ->setTimezone(config('app.timezone'));
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
            ->whereDate('exception_date', '>=', $from->toDateString())
            ->whereDate('exception_date', '<=', $to->toDateString())
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

    /**
     * Runs WaitlistService::slotTaken() in a savepoint so a waitlist failure
     * is logged rather than aborting the booking itself (a bare catch would
     * leave the outer transaction unusable on some drivers). process()
     * tidies any hold left behind on the now-occupied slot.
     */
    private function slotTakenSafely(Appointment $appointment): void
    {
        try {
            DB::transaction(fn () => app(WaitlistService::class)->slotTaken($appointment));
        } catch (\Throwable $e) {
            Log::warning('Waitlist slotTaken failed', [
                'appointment_id' => $appointment->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Throws when the doctor already has a non-cancelled/rescheduled
     * appointment overlapping [start, end) (or exactly at $start when no
     * $end is given) on $date. Extracted from reschedule()'s conflict
     * query so create() (for source 'patient') can reuse the exact same
     * check.
     *
     * Must be called inside the caller's transaction (create()/reschedule()
     * both wrap their call in DB::transaction). A plain exists() check has
     * a race: two concurrent requests for the same slot can both read "no
     * conflict" before either has inserted/moved its row. There's no unique
     * index to fall back on either, since a cancelled/rescheduled row must
     * be free to reuse the same slot. So we serialise per doctor instead:
     * lock the doctor row first (SELECT ... FOR UPDATE) so a second
     * concurrent booking/reschedule for the same doctor blocks until the
     * first transaction commits or rolls back, and then sees the
     * now-committed conflicting row.
     *
     * $forPatientId (patient-source create/reschedule only) also treats a
     * live waitlist hold for a *different* patient at $start as taken; the
     * held patient's own hold doesn't block them. Staff paths pass null and
     * can book over a hold.
     */
    public function assertSlotFree(int $clinicId, int $doctorId, string $date, string $start, ?string $end, ?int $excludeAppointmentId = null, ?int $forPatientId = null): void
    {
        Doctor::query()->whereKey($doctorId)->lockForUpdate()->first();

        $start = $this->toHis($start);
        $end = $end ? $this->toHis($end) : null;

        if ($this->slotConflictQuery($clinicId, $doctorId, $date, $start, $end, $excludeAppointmentId)->exists()) {
            throw ValidationException::withMessages([
                'start_time' => 'Selected slot is already booked.',
            ]);
        }

        if ($forPatientId !== null) {
            $hold = app(WaitlistService::class)->heldFor($clinicId, $doctorId, $date, $start);
            if ($hold !== null && (int) $hold->patient_id !== $forPatientId) {
                throw ValidationException::withMessages([
                    'start_time' => 'That slot was just taken. Please pick another.',
                ]);
            }
        }
    }

    /**
     * The doctor's live (not cancelled/rescheduled) appointments overlapping
     * [start, end) on $date, or starting exactly at $start when there's no
     * $end. Shared by assertSlotFree() and undoStatus().
     */
    private function slotConflictQuery(int $clinicId, int $doctorId, string $date, string $start, ?string $end, ?int $excludeAppointmentId = null): \Illuminate\Database\Eloquent\Builder
    {
        $start = $this->toHis($start);
        $end = $end ? $this->toHis($end) : null;

        $conflictQuery = Appointment::query()
            ->forClinic($clinicId)
            ->where('doctor_id', $doctorId)
            ->whereDate('appointment_date', $date)
            ->whereNotIn('status', [AppointmentStatus::CANCELLED->value, AppointmentStatus::RESCHEDULED->value]);

        if ($excludeAppointmentId) {
            $conflictQuery->whereKeyNot($excludeAppointmentId);
        }

        if ($end) {
            $conflictQuery->whereTime('start_time', '<', $end)
                ->where(function ($q) use ($start) {
                    $q->whereNull('end_time')->orWhereTime('end_time', '>', $start);
                });
        } else {
            $conflictQuery->whereTime('start_time', '=', $start);
        }

        return $conflictQuery;
    }

    /**
     * $source distinguishes who booked (recorded on the status log): 'staff'
     * (default, unchanged behaviour) or 'patient' (portal bookings). Only
     * 'patient' bookings are checked against `assertSlotFree` here — staff
     * booking behaviour (no conflict check) is unchanged. A 'portal'
     * booking_channel skips the immediate bookingConfirmed notification
     * (portal bookings start 'pending' with no WhatsApp; staff confirming
     * them sends it via changeStatus below).
     */
    public function create(array $data, string $source = 'staff'): Appointment
    {
        app(PlanLimits::class)->assertCanAdd((int) $data['clinic_id'], 'appointments');

        return DB::transaction(function () use ($data, $source) {
            // Lock the doctor row before the insert for every source. The
            // insert's FK check takes a shared lock on the doctor (and
            // patient) row; locking for update only afterwards (slotTaken)
            // would be an S->X upgrade that deadlocks two concurrent staff
            // bookings on InnoDB, and would invert the doctor-then-patient
            // order WaitlistService::join() relies on.
            if (! empty($data['doctor_id'])) {
                Doctor::query()->whereKey((int) $data['doctor_id'])->lockForUpdate()->first();
            }

            if ($source === 'patient') {
                $this->assertSlotFree(
                    (int) $data['clinic_id'],
                    (int) $data['doctor_id'],
                    $this->toYmd($data['appointment_date']) ?? (string) $data['appointment_date'],
                    (string) $data['start_time'],
                    (isset($data['end_time']) && $data['end_time'] !== null) ? (string) $data['end_time'] : null,
                    null,
                    // Patient bookings always carry patient_id; 0 would make any hold block.
                    (int) ($data['patient_id'] ?? 0),
                );
            }

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
                'source' => $source,
                'created_at' => now(),
            ]);

            // The booking patient's own waitlist entry for this slot is now
            // booked; another patient's hold on it (staff can book over a
            // hold) is expired.
            $this->slotTakenSafely($appointment);

            if (($data['booking_channel'] ?? null) !== 'portal') {
                $this->notifyAfterCommit(fn () => app(PatientNotifier::class)->bookingConfirmed($appointment));
            }

            return $appointment;
        });
    }

    public function changeStatus(Appointment $appointment, AppointmentStatus $status, ?int $actorUserId = null, ?string $reason = null, bool $force = false, string $source = 'staff'): Appointment
    {
        return DB::transaction(function () use ($appointment, $status, $actorUserId, $reason, $force, $source) {
            $appointment = $this->lockAppointment($appointment);
            $oldStatus = $appointment->status;

            // Repeating the current status is a no-op (e.g. the UI confirming
            // an already-confirmed appointment after a reschedule).
            if ($oldStatus === $status->value) {
                return $appointment->refresh();
            }

            // $force only bypasses the timing windows below, never the
            // transition rules.
            $current = AppointmentStatus::tryFrom((string) $oldStatus);
            if ($current && ! $current->canTransitionTo($status)) {
                throw ValidationException::withMessages([
                    'status' => "Cannot change an appointment from {$current->label()} to {$status->label()}.",
                ]);
            }

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
                'source' => $source,
                'reason' => $reason,
                'created_at' => now(),
            ]);

            if ($status === AppointmentStatus::CANCELLED) {
                $this->notifyAfterCommit(fn () => app(PatientNotifier::class)->appointmentUpdated($appointment, 'cancelled'));
                $this->slotFreedAfterCommit(
                    (int) $appointment->clinic_id,
                    (int) $appointment->doctor_id,
                    $this->toYmd($appointment->appointment_date) ?? (string) $appointment->appointment_date,
                    (string) $appointment->start_time,
                );
            }

            // A portal booking is created 'pending' with no WhatsApp (see
            // create() above); the confirmation is sent only once it's
            // actually confirmed, whichever staff/super-admin path does
            // that. A staff-created (non-portal) appointment already got
            // its bookingConfirmed at creation, so this must not re-send.
            if ($oldStatus === AppointmentStatus::PENDING->value
                && $status === AppointmentStatus::CONFIRMED
                && $appointment->booking_channel === 'portal') {
                $this->notifyAfterCommit(fn () => app(PatientNotifier::class)->bookingConfirmed($appointment));
            }

            return $appointment->refresh();
        });
    }

    /** Marks an undo on its status log row (the log has no dedicated flag column). */
    public const UNDO_REASON_PREFIX = 'Undo:';

    /** Statuses undoStatus() can revert. */
    public const UNDOABLE_STATUSES = [
        AppointmentStatus::CANCELLED,
        AppointmentStatus::NO_SHOW,
        AppointmentStatus::COMPLETED,
    ];

    /**
     * Staff "undo" for a mistaken cancel / no-show / complete. Separate
     * from changeStatus() so the lifecycle transition map stays strict.
     *
     * Reverts to the status the appointment had just before its last change
     * (the old_status of the latest log row that moved it into its current
     * status), provided that status could legitimately have led to the
     * current one; otherwise falls back to confirmed (cancelled/no-show) or
     * in_consultation (completed). Only allowed up to and including the
     * appointment day (clinic-local). Undoing a cancel or no-show re-takes
     * the slot: it must not overlap another live appointment or a live
     * waitlist hold for another patient.
     */
    public function undoStatus(Appointment $appointment, ?int $actorUserId = null): Appointment
    {
        // The caller authorised the undo for the status it read; if that
        // changed before we got the lock, make the user look again.
        $expected = (string) $appointment->status;

        return DB::transaction(function () use ($appointment, $actorUserId, $expected) {
            $appointment = $this->lockAppointment($appointment);

            if ((string) $appointment->status !== $expected) {
                throw ValidationException::withMessages([
                    'status' => 'This appointment changed in the meantime. Refresh and try again.',
                ]);
            }

            $current = AppointmentStatus::tryFrom((string) $appointment->status);
            if (! in_array($current, self::UNDOABLE_STATUSES, true)) {
                $label = $current?->label() ?? (string) $appointment->status;
                throw ValidationException::withMessages([
                    'status' => "Only cancelled, no-show or completed appointments can be undone (this one is {$label}).",
                ]);
            }

            $date = $this->toYmd($appointment->appointment_date);
            $today = Carbon::now(config('app.clinic_timezone', 'Asia/Kolkata'))->toDateString();
            if ($date === null || $today > $date) {
                throw ValidationException::withMessages([
                    'status' => 'Can only undo on or before the appointment day.',
                ]);
            }

            $target = $this->undoTarget($appointment, $current);

            if ($current === AppointmentStatus::CANCELLED || $current === AppointmentStatus::NO_SHOW) {
                $this->assertSlotFreeForUndo($appointment, $date);
            }

            $appointment->status = $target->value;
            if ($current === AppointmentStatus::CANCELLED) {
                $appointment->cancelled_at = null;
                $appointment->cancellation_reason = null;
            }
            if ($current === AppointmentStatus::COMPLETED) {
                $appointment->completed_at = null;
            }
            $appointment->save();

            AppointmentStatusLog::create([
                'clinic_id' => $appointment->clinic_id,
                'appointment_id' => $appointment->id,
                'old_status' => $current->value,
                'new_status' => $target->value,
                'changed_by_user_id' => $actorUserId,
                'source' => 'staff',
                'reason' => self::UNDO_REASON_PREFIX." reverted {$current->label()} to {$target->label()}",
                'created_at' => now(),
            ]);

            if ($current === AppointmentStatus::CANCELLED) {
                // The slot is ours again: lapsed offers on it are expired,
                // and the patient's own waitlist entry (if any) is booked.
                $this->slotTakenSafely($appointment);

                // A portal booking still pending never got a confirmation
                // (see create()); don't send one for it now either.
                if (! ($target === AppointmentStatus::PENDING && $appointment->booking_channel === 'portal')) {
                    $this->notifyAfterCommit(fn () => app(PatientNotifier::class)->bookingConfirmed($appointment));
                }
            }

            return $appointment->refresh();
        });
    }

    private function undoTarget(Appointment $appointment, AppointmentStatus $current): AppointmentStatus
    {
        $previous = AppointmentStatusLog::query()
            ->where('clinic_id', $appointment->clinic_id)
            ->where('appointment_id', $appointment->id)
            ->where('new_status', $current->value)
            ->orderByDesc('id')
            ->value('old_status');

        $previous = AppointmentStatus::tryFrom((string) $previous);

        // Only a status that can actually lead to the current one counts;
        // for completed that is checked_in or in_consultation, never later.
        if ($previous !== null && $previous->canTransitionTo($current)) {
            return $previous;
        }

        return $current === AppointmentStatus::COMPLETED
            ? AppointmentStatus::IN_CONSULTATION
            : AppointmentStatus::CONFIRMED;
    }

    /** Must run inside undoStatus()'s transaction, after lockAppointment(). */
    private function assertSlotFreeForUndo(Appointment $appointment, string $date): void
    {
        $tz = config('app.clinic_timezone', 'Asia/Kolkata');
        $start = (string) $appointment->start_time;
        $end = $appointment->end_time ? (string) $appointment->end_time : null;

        $conflict = $this->slotConflictQuery((int) $appointment->clinic_id, (int) $appointment->doctor_id, $date, $start, $end, $appointment->id)
            ->with('patient:id,full_name')
            ->orderBy('start_time')
            ->first();

        if ($conflict !== null) {
            $who = $conflict->patient?->full_name ? "{$conflict->patient->full_name}'s" : 'another';
            $at = Carbon::parse($this->toHis((string) $conflict->start_time))->format('H:i');
            throw ValidationException::withMessages([
                'status' => "Cannot undo: the slot is now taken by {$who} appointment at {$at} (#{$conflict->id}).",
            ]);
        }

        $hold = app(WaitlistService::class)->heldFor((int) $appointment->clinic_id, (int) $appointment->doctor_id, $date, $start);
        if ($hold !== null && (int) $hold->patient_id !== (int) $appointment->patient_id) {
            $until = $hold->hold_expires_at->copy()->setTimezone($tz)->format('H:i');
            throw ValidationException::withMessages([
                'status' => "This slot is currently offered to a waitlist patient until {$until}.",
            ]);
        }
    }

    public function reschedule(Appointment $appointment, array $newData, ?int $actorUserId = null, ?string $reason = null, string $source = 'staff', ?string $newStatus = null): Appointment
    {
        return DB::transaction(function () use ($appointment, $newData, $actorUserId, $reason, $source, $newStatus) {
            // Carry over unsaved edits (updateDetails() fills non-slot fields first).
            $pending = $appointment->getDirty();
            $appointment = $this->lockAppointment($appointment, [(int) ($newData['doctor_id'] ?? 0)]);
            $appointment->forceFill($pending);

            $current = AppointmentStatus::tryFrom((string) ($appointment->status ?? ''));
            if (! in_array($current, [AppointmentStatus::PENDING, AppointmentStatus::CONFIRMED, AppointmentStatus::CHECKED_IN], true)) {
                $label = $current?->label() ?? (string) $appointment->status;
                throw ValidationException::withMessages([
                    'status' => "Cannot reschedule an appointment that is {$label}. Only pending, confirmed or checked-in appointments can be moved.",
                ]);
            }

            $oldDate = $this->toYmd($appointment->appointment_date) ?: (string) $appointment->appointment_date;
            $oldStart = (string) $appointment->start_time;
            $oldEnd = (string) ($appointment->end_time ?? '');

            $oldDoctorId = (int) $appointment->doctor_id;
            $targetDoctorId = (int) ($newData['doctor_id'] ?? $oldDoctorId);
            $targetDate = (string) ($newData['appointment_date'] ?? ($appointment->appointment_date?->toDateString() ?: $appointment->appointment_date));
            $targetStart = (string) ($newData['start_time'] ?? $appointment->start_time);
            $targetEnd = ($newData['end_time'] ?? null) !== null
                ? (string) $newData['end_time']
                : $this->endForStart($appointment, $targetStart, $targetDoctorId);

            $this->assertSlotFree(
                (int) $appointment->clinic_id,
                $targetDoctorId,
                $targetDate,
                $targetStart,
                $targetEnd,
                $appointment->id,
                $source === 'patient' ? (int) $appointment->patient_id : null,
            );

            $oldStatusForLog = $appointment->status;

            $appointment->doctor_id = $targetDoctorId;
            $appointment->appointment_date = $targetDate;
            $appointment->start_time = $targetStart;
            $appointment->end_time = $targetEnd;
            if ($newStatus !== null) {
                $appointment->status = $newStatus;
            }
            $appointment->save();

            // Same as create(): the new slot is taken now.
            $this->slotTakenSafely($appointment);

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

            if ($newStatus !== null) {
                AppointmentStatusLog::create([
                    'clinic_id' => $appointment->clinic_id,
                    'appointment_id' => $appointment->id,
                    'old_status' => $oldStatusForLog,
                    'new_status' => $newStatus,
                    'changed_by_user_id' => $actorUserId,
                    'source' => $source,
                    'reason' => $reason,
                    'created_at' => now(),
                ]);
            }

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

            // The old slot is free now (slotFreed itself no-ops if the move
            // stayed on the same start).
            if ($oldDate && $oldStart) {
                $this->slotFreedAfterCommit((int) $appointment->clinic_id, $oldDoctorId, $oldDate, $oldStart);
            }

            return $appointment->refresh();
        });
    }

    /**
     * Re-reads the appointment under a row lock so status checks run on the
     * committed state. Doctor rows are locked first (ascending id), keeping
     * the doctor-then-other-rows order used by create()/assertSlotFree().
     */
    private function lockAppointment(Appointment $appointment, array $extraDoctorIds = []): Appointment
    {
        $doctorIds = array_values(array_unique(array_filter([(int) $appointment->doctor_id, ...$extraDoctorIds])));
        if ($doctorIds !== []) {
            Doctor::query()->whereKey($doctorIds)->orderBy('id')->lockForUpdate()->get();
        }

        return $appointment->newQueryWithoutScopes()
            ->whereKey($appointment->getKey())
            ->lockForUpdate()
            ->firstOrFail();
    }

    /**
     * End time for a move to $start that keeps the appointment's current
     * length, or the doctor's slot length when it has no stored end.
     */
    private function endForStart(Appointment $appointment, string $start, int $doctorId): string
    {
        $duration = 0;
        if ($appointment->start_time && $appointment->end_time) {
            $duration = $this->timeToMinutes((string) $appointment->end_time) - $this->timeToMinutes((string) $appointment->start_time);
        }
        if ($duration <= 0) {
            $duration = (int) (Doctor::query()->whereKey($doctorId)->value('slot_duration_minutes') ?: 15);
        }

        return Carbon::parse($this->toHis($start))->addMinutes($duration)->format('H:i:s');
    }

    /**
     * Staff edit of an appointment's details. A change of doctor, date or
     * time goes through reschedule() (conflict check, logs, notification,
     * waitlist); everything else is a plain save. Status may only be
     * echoed back unchanged — changes go through changeStatus().
     */
    public function updateDetails(Appointment $appointment, array $data, ?int $actorUserId = null): Appointment
    {
        if (($data['status'] ?? null) !== null && $data['status'] !== $appointment->status) {
            throw ValidationException::withMessages([
                'status' => 'Use the appointment status actions to change the status.',
            ]);
        }
        unset($data['status']);

        return DB::transaction(function () use ($appointment, $data, $actorUserId) {
            $slotKeys = ['doctor_id', 'appointment_date', 'start_time', 'end_time'];

            $slotChanged = (array_key_exists('doctor_id', $data) && (int) $data['doctor_id'] !== (int) $appointment->doctor_id)
                || (array_key_exists('appointment_date', $data) && $this->toYmd($data['appointment_date']) !== $this->toYmd($appointment->appointment_date))
                || (array_key_exists('start_time', $data) && $this->toHis((string) $data['start_time']) !== $this->toHis((string) $appointment->start_time))
                || (array_key_exists('end_time', $data) && ($data['end_time'] !== null ? $this->toHis((string) $data['end_time']) : null)
                    !== ($appointment->end_time ? $this->toHis((string) $appointment->end_time) : null));

            $appointment->fill(array_diff_key($data, array_flip($slotKeys)));

            if (! $slotChanged) {
                $appointment->save();

                return $appointment->refresh();
            }

            return $this->reschedule($appointment, array_intersect_key($data, array_flip($slotKeys)), $actorUserId);
        });
    }
}
