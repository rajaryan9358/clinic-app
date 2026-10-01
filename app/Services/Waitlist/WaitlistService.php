<?php

namespace App\Services\Waitlist;

use App\Enums\AppointmentStatus;
use App\Models\Appointment;
use App\Models\ClinicSetting;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\WaitlistEntry;
use App\Services\AppointmentService;
use App\Services\Portal\PortalBookingPolicy;
use App\Services\Portal\PortalLinkService;
use App\Services\WhatsApp\PatientNotifier;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

/**
 * Owns the waitlist entry lifecycle for an exact doctor slot (doctor +
 * date + start time): joining, leaving, and offering a freed slot to the
 * first patient in line with a time-limited hold and a WhatsApp
 * "Book it" login link.
 *
 * Every mutation runs inside DB::transaction under the same doctor-row
 * lock AppointmentService::assertSlotFree() takes, so a join, an offer
 * and a booking for the same doctor never interleave — two frees of the
 * same slot (or a free racing the expiry command) produce one offer.
 *
 * Nothing here depends on an authenticated user: slotFreed() runs after
 * commit from any cancel/reschedule path and from the console.
 *
 * Times: entries store `start_time` as H:i:s; slot instants are read in
 * `config('app.clinic_timezone')`; timestamps are stored in the app
 * timezone.
 */
final class WaitlistService
{
    public const MAX_ACTIVE_PER_PATIENT = 3;

    public function __construct(
        private readonly AppointmentService $appointments,
        private readonly PortalBookingPolicy $bookingPolicy,
        private readonly PortalLinkService $links,
    ) {}

    /**
     * No settings row ⇒ enabled with a 30-minute hold.
     *
     * @return array{enabled: bool, hold_minutes: int}
     */
    public function settings(int $clinicId): array
    {
        $row = ClinicSetting::where('clinic_id', $clinicId)->first();

        return [
            'enabled' => $row !== null ? (bool) ($row->waitlist_enabled ?? true) : true,
            'hold_minutes' => $row !== null ? (int) ($row->waitlist_hold_minutes ?? 30) : 30,
        ];
    }

    /**
     * @param  'portal'|'staff'  $source  portal applies the booking
     *                                    window/notice; staff only needs a grid slot in the future.
     */
    public function join(Patient $patient, int $doctorId, string $date, string $start, string $source, ?int $createdByUserId = null): WaitlistEntry
    {
        $clinicId = (int) $patient->clinic_id;

        if (! $this->settings($clinicId)['enabled']) {
            throw ValidationException::withMessages(['waitlist' => 'Waitlist is not available at this clinic.']);
        }

        if ($source === 'portal') {
            // Throws the portal's own window/"not an offered time" 422s.
            $this->bookingPolicy->slotFor($clinicId, $doctorId, $date, $start);
        }

        $slot = $this->gridSlot($clinicId, $doctorId, $date, $start);
        $startTime = $slot['start_time'].':00';

        return DB::transaction(function () use ($patient, $clinicId, $doctorId, $date, $slot, $startTime, $source, $createdByUserId) {
            $this->lockDoctor($doctorId);

            $hasAppointment = $this->appointmentsAt($clinicId, $doctorId, $date, $startTime)
                ->where('patient_id', $patient->id)
                ->exists();
            if ($hasAppointment) {
                throw ValidationException::withMessages(['start_time' => 'This patient already has this slot.']);
            }

            $alreadyJoined = $this->entriesAt($clinicId, $doctorId, $date, $startTime)
                ->active()
                ->where('patient_id', $patient->id)
                ->exists();
            if ($alreadyJoined) {
                throw new ConflictHttpException('Already on the waitlist for this time.');
            }

            // Re-read occupancy under the lock (the grid read above was not).
            $held = $this->heldFor($clinicId, $doctorId, $date, $startTime);
            $heldForOther = $held !== null && (int) $held->patient_id !== (int) $patient->id;
            $occupied = $this->isSlotOccupied($clinicId, $doctorId, $date, $startTime, $slot['end_time'].':00');
            if (! $occupied && ! $heldForOther) {
                throw ValidationException::withMessages(['start_time' => 'This slot is free — book it directly.']);
            }

            // The cap is per patient but the lock above is per doctor: also
            // lock the patient row (always doctor first, then patient) so
            // concurrent joins on different doctors can't both pass the count.
            Patient::query()->whereKey($patient->id)->lockForUpdate()->first();

            $activeCount = WaitlistEntry::query()->active()->where('patient_id', $patient->id)->count();
            if ($activeCount >= self::MAX_ACTIVE_PER_PATIENT) {
                throw ValidationException::withMessages(['waitlist' => 'You can be on up to 3 waitlists at a time.']);
            }

            return WaitlistEntry::create([
                'clinic_id' => $clinicId,
                'patient_id' => $patient->id,
                'doctor_id' => $doctorId,
                'appointment_date' => $date,
                'start_time' => $startTime,
                'end_time' => $slot['end_time'].':00',
                'status' => 'waiting',
                'source' => $source,
                'created_by_user_id' => $createdByUserId,
            ])->refresh();
        });
    }

    /** Active → removed; a removed offer passes the slot to the next in line. */
    public function remove(WaitlistEntry $entry): void
    {
        DB::transaction(function () use ($entry) {
            $this->lockDoctor((int) $entry->doctor_id);

            $entry->refresh();
            if (! in_array($entry->status, WaitlistEntry::ACTIVE_STATUSES, true)) {
                return;
            }

            $wasOffered = $entry->status === 'offered';
            $entry->update(['status' => 'removed']);

            if ($wasOffered) {
                $this->slotFreed((int) $entry->clinic_id, (int) $entry->doctor_id, $entry->appointment_date->toDateString(), (string) $entry->start_time);
            }
        });
    }

    /**
     * Offers a now-free future slot to the oldest waiting entry: hold until
     * min(now + hold minutes, slot start), a login link for the entry's
     * account holder redirecting to the offer page, and (after commit) the
     * `waitlist_slot_open` WhatsApp. Returns the offered entry, or null
     * when the waitlist is off, the slot has started, is occupied, is
     * already held, or nobody is waiting.
     */
    public function slotFreed(int $clinicId, int $doctorId, string $date, string $start): ?WaitlistEntry
    {
        $startTime = $this->normaliseTime($start);
        $settings = $this->settings($clinicId);

        if (! $settings['enabled']) {
            return null;
        }

        $tz = config('app.clinic_timezone', 'Asia/Kolkata');
        $slotStart = Carbon::parse($date.' '.$startTime, $tz)->setTimezone(config('app.timezone'));
        if ($slotStart->lessThanOrEqualTo(now())) {
            return null;
        }

        return DB::transaction(function () use ($clinicId, $doctorId, $date, $startTime, $settings, $slotStart) {
            $this->lockDoctor($doctorId);

            if ($this->heldFor($clinicId, $doctorId, $date, $startTime) !== null) {
                return null;
            }

            // A lapsed hold the expiry command hasn't processed yet must
            // not linger as a second "offered" entry for the slot.
            $this->entriesAt($clinicId, $doctorId, $date, $startTime)
                ->where('status', 'offered')
                ->where('hold_expires_at', '<=', now())
                ->update(['status' => 'expired', 'updated_at' => now()]);

            // Oldest waiting entry whose patient and account holder still
            // exist; an entry left without a (non-deleted) holder can't be
            // messaged, so it is skipped rather than blocking the slot.
            $entry = null;
            $holder = null;
            $candidates = $this->entriesAt($clinicId, $doctorId, $date, $startTime)
                ->where('status', 'waiting')
                ->whereHas('patient')
                ->with('patient')
                ->orderBy('id')
                ->get();
            foreach ($candidates as $candidate) {
                $holder = $this->accountHolder($candidate->patient);
                if ($holder !== null) {
                    $entry = $candidate;
                    break;
                }
            }

            if ($entry === null) {
                return null;
            }

            $end = $entry->end_time !== null ? (string) $entry->end_time : null;
            if ($this->isSlotOccupied($clinicId, $doctorId, $date, $startTime, $end)) {
                return null;
            }

            $offeredAt = now();
            $holdExpiresAt = $offeredAt->copy()->addMinutes($settings['hold_minutes'])->min($slotStart);

            $patient = $entry->patient;

            $issued = $this->links->issueForRedirect(
                $holder,
                $holdExpiresAt,
                "/waitlist/{$entry->id}?profile={$patient->id}",
            );

            $entry->update([
                'status' => 'offered',
                'offered_at' => $offeredAt,
                'hold_expires_at' => $holdExpiresAt,
                'login_link_id' => $issued['link']->id,
            ]);

            $token = $issued['token'];
            DB::afterCommit(function () use ($entry, $token) {
                try {
                    app(PatientNotifier::class)->waitlistOffer($entry, $token);
                } catch (\Throwable $e) {
                    Log::warning('WhatsApp notifier failed: '.$e->getMessage(), ['exception' => $e]);
                }
            });

            return $entry;
        });
    }

    /** The slot's live hold (offered and not yet lapsed), if any. */
    public function heldFor(int $clinicId, int $doctorId, string $date, string $start): ?WaitlistEntry
    {
        return $this->entriesAt($clinicId, $doctorId, $date, $this->normaliseTime($start))
            ->where('status', 'offered')
            ->where('hold_expires_at', '>', now())
            ->orderBy('id')
            ->first();
    }

    /**
     * Live holds on the doctor's day keyed by 'H:i' start → patient_id,
     * for listing code (PortalBookingPolicy) that checks many slots at once.
     *
     * @return array<string, int>
     */
    public function holdsOn(int $clinicId, int $doctorId, string $date): array
    {
        return WaitlistEntry::query()
            ->forClinic($clinicId)
            ->where('doctor_id', $doctorId)
            ->whereDate('appointment_date', $date)
            ->where('status', 'offered')
            ->where('hold_expires_at', '>', now())
            ->get(['start_time', 'patient_id'])
            ->mapWithKeys(fn (WaitlistEntry $e) => [substr((string) $e->start_time, 0, 5) => (int) $e->patient_id])
            ->all();
    }

    /**
     * Any appointment that isn't cancelled/rescheduled at $start — or, when
     * $end is given, overlapping [start, end) like assertSlotFree().
     */
    public function isSlotOccupied(int $clinicId, int $doctorId, string $date, string $start, ?string $end = null): bool
    {
        $start = $this->normaliseTime($start);

        if ($end === null) {
            return $this->appointmentsAt($clinicId, $doctorId, $date, $start)->exists();
        }

        return Appointment::query()
            ->forClinic($clinicId)
            ->where('doctor_id', $doctorId)
            ->whereDate('appointment_date', $date)
            ->whereNotIn('status', [AppointmentStatus::CANCELLED->value, AppointmentStatus::RESCHEDULED->value])
            ->whereTime('start_time', '<', $this->normaliseTime($end))
            ->where(function ($q) use ($start) {
                $q->whereNull('end_time')->orWhereTime('end_time', '>', $start);
            })
            ->exists();
    }

    /**
     * The doctor's grid slot starting at $start on $date, which must not
     * have started yet. No booking window/notice — that's the portal's
     * slotFor() on top.
     *
     * @return array{start_time: string, end_time: string, available: bool}
     */
    private function gridSlot(int $clinicId, int $doctorId, string $date, string $start): array
    {
        $normalised = substr($this->normaliseTime($start), 0, 5);
        $tz = config('app.clinic_timezone', 'Asia/Kolkata');

        $days = $this->appointments->getDoctorAvailability($clinicId, $doctorId, $date, $date);

        foreach ($days[0]['slots'] ?? [] as $slot) {
            if ($slot['start_time'] === $normalised
                && Carbon::parse($date.' '.$slot['start_time'], $tz)->greaterThan(Carbon::now($tz))) {
                return $slot;
            }
        }

        throw ValidationException::withMessages(['start_time' => 'Please choose one of the available times.']);
    }

    /** The entry patient's account holder (themselves, or their non-deleted managing patient). */
    private function accountHolder(Patient $patient): ?Patient
    {
        if ($patient->managed_by_patient_id === null) {
            return $patient;
        }

        return Patient::query()->find($patient->managed_by_patient_id);
    }

    private function lockDoctor(int $doctorId): void
    {
        Doctor::query()->whereKey($doctorId)->lockForUpdate()->first();
    }

    private function entriesAt(int $clinicId, int $doctorId, string $date, string $startTime)
    {
        return WaitlistEntry::query()
            ->forClinic($clinicId)
            ->where('doctor_id', $doctorId)
            ->whereDate('appointment_date', $date)
            ->whereTime('start_time', '=', $startTime);
    }

    private function appointmentsAt(int $clinicId, int $doctorId, string $date, string $startTime)
    {
        return Appointment::query()
            ->forClinic($clinicId)
            ->where('doctor_id', $doctorId)
            ->whereDate('appointment_date', $date)
            ->whereTime('start_time', '=', $startTime)
            ->whereNotIn('status', [AppointmentStatus::CANCELLED->value, AppointmentStatus::RESCHEDULED->value]);
    }

    /** 'H:i' / 'H:i:s' / '9:00 AM' → 'H:i:s'. */
    private function normaliseTime(string $time): string
    {
        try {
            return Carbon::parse($time)->format('H:i:s');
        } catch (\Throwable) {
            return $time;
        }
    }
}
