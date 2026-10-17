<?php

namespace App\Services\Waitlist;

use App\Enums\AppointmentStatus;
use App\Models\Appointment;
use App\Models\ClinicSetting;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\PatientLoginLink;
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

    /**
     * Books the held slot for the entry's patient as a pending portal
     * appointment (staff-added entries too — the patient accepts in the
     * portal). AppointmentService::create() runs the patient-source slot
     * check (the entry's own hold doesn't block) and, via slotTaken(),
     * marks this entry booked and consumes its login link.
     *
     * @param  array{visit_type?: string, consultation_mode?: string, reason?: ?string}  $data
     */
    public function book(WaitlistEntry $entry, array $data): Appointment
    {
        return DB::transaction(function () use ($entry, $data) {
            $this->lockDoctor((int) $entry->doctor_id);

            $entry->refresh();
            if ($entry->status !== 'offered'
                || $entry->hold_expires_at === null
                || $entry->hold_expires_at->lessThanOrEqualTo(now())) {
                throw ValidationException::withMessages(['waitlist' => 'This offer has expired.']);
            }

            $appointment = $this->appointments->create([
                'clinic_id' => (int) $entry->clinic_id,
                'doctor_id' => (int) $entry->doctor_id,
                'patient_id' => (int) $entry->patient_id,
                'appointment_date' => $entry->appointment_date->toDateString(),
                'start_time' => (string) $entry->start_time,
                'end_time' => $entry->end_time !== null ? (string) $entry->end_time : null,
                'visit_type' => $data['visit_type'] ?? 'new',
                'consultation_mode' => $data['consultation_mode'] ?? 'in_person',
                'notes' => $data['reason'] ?? null,
                'status' => 'pending',
                'booking_channel' => 'portal',
            ], 'patient');

            $entry->refresh();

            return $appointment;
        });
    }

    /** Offered → declined, and the slot passes to the next in line. */
    public function decline(WaitlistEntry $entry): void
    {
        DB::transaction(function () use ($entry) {
            $this->lockDoctor((int) $entry->doctor_id);

            $entry->refresh();
            if ($entry->status !== 'offered') {
                throw ValidationException::withMessages(['waitlist' => 'This offer has expired.']);
            }

            $entry->update(['status' => 'declined']);

            $this->slotFreed((int) $entry->clinic_id, (int) $entry->doctor_id, $entry->appointment_date->toDateString(), (string) $entry->start_time);
        });
    }

    /**
     * The `waitlist:process` sweep. Idempotent:
     *  1. active entries whose slot has started → expired (expired_past);
     *  2. per future slot with active entries, under its doctor lock:
     *     offers whose hold lapsed, or whose slot someone else now occupies
     *     (e.g. staff booked over the hold) → expired (expired_holds); then
     *     slotFreed() offers the next in line if the slot is free and
     *     unheld (offered).
     *
     * @return array{expired_holds: int, expired_past: int, offered: int}
     */
    public function process(): array
    {
        $result = ['expired_holds' => 0, 'expired_past' => 0, 'offered' => 0];

        $nowLocal = Carbon::now(config('app.clinic_timezone', 'Asia/Kolkata'));
        $today = $nowLocal->toDateString();
        $time = $nowLocal->format('H:i:s');

        $result['expired_past'] = WaitlistEntry::query()
            ->active()
            ->where(function ($q) use ($today, $time) {
                $q->whereDate('appointment_date', '<', $today)
                    ->orWhere(fn ($q) => $q->whereDate('appointment_date', $today)->whereTime('start_time', '<=', $time));
            })
            ->update(['status' => 'expired', 'updated_at' => now()]);

        $slots = WaitlistEntry::query()
            ->active()
            ->get(['clinic_id', 'doctor_id', 'appointment_date', 'start_time'])
            ->unique(fn (WaitlistEntry $e) => implode('|', [$e->clinic_id, $e->doctor_id, $e->appointment_date->toDateString(), $e->start_time]));

        foreach ($slots as $slot) {
            $clinicId = (int) $slot->clinic_id;
            $doctorId = (int) $slot->doctor_id;
            $date = $slot->appointment_date->toDateString();
            $startTime = (string) $slot->start_time;

            try {
                DB::transaction(function () use ($clinicId, $doctorId, $date, $startTime, &$result) {
                    $this->lockDoctor($doctorId);

                    $offers = $this->entriesAt($clinicId, $doctorId, $date, $startTime)
                        ->where('status', 'offered')
                        ->get();
                    foreach ($offers as $offer) {
                        $lapsed = $offer->hold_expires_at === null || $offer->hold_expires_at->lessThanOrEqualTo(now());
                        $end = $offer->end_time !== null ? (string) $offer->end_time : null;
                        if ($lapsed || $this->isSlotOccupied($clinicId, $doctorId, $date, $startTime, $end)) {
                            $offer->update(['status' => 'expired']);
                            $result['expired_holds']++;
                        }
                    }

                    if ($this->slotFreed($clinicId, $doctorId, $date, $startTime) !== null) {
                        $result['offered']++;
                    }
                });
            } catch (\Throwable $e) {
                Log::warning('Waitlist process failed for a slot: '.$e->getMessage(), [
                    'clinic_id' => $clinicId, 'doctor_id' => $doctorId, 'date' => $date, 'start_time' => $startTime,
                    'exception' => $e,
                ]);
            }
        }

        return $result;
    }

    /**
     * The appointment's patient's own active entry for its slot (normally
     * the live offer, e.g. when the held patient books through the normal
     * Book page) → booked, linked to the appointment, its login link
     * consumed.
     */
    public function markBookedIfOffered(Appointment $appointment): void
    {
        $date = $this->appointmentDate($appointment);
        if ($date === null || $appointment->patient_id === null || $appointment->start_time === null) {
            return;
        }

        $entries = $this->entriesAt((int) $appointment->clinic_id, (int) $appointment->doctor_id, $date, $this->normaliseTime((string) $appointment->start_time))
            ->active()
            ->where('patient_id', $appointment->patient_id)
            ->get();

        foreach ($entries as $entry) {
            $entry->update(['status' => 'booked', 'booked_appointment_id' => $appointment->id]);

            if ($entry->login_link_id !== null) {
                PatientLoginLink::query()
                    ->whereKey($entry->login_link_id)
                    ->whereNull('consumed_at')
                    ->update(['consumed_at' => now()]);
            }
        }
    }

    /**
     * Called by AppointmentService inside its transaction whenever an
     * appointment lands on a slot (create, reschedule-into). The booking
     * patient's own entry is marked booked; any other patient's offer on
     * that slot (staff can book over a hold) is expired — the slot is
     * taken, so nobody else is offered it until it frees again.
     */
    public function slotTaken(Appointment $appointment): void
    {
        $date = $this->appointmentDate($appointment);
        if ($date === null || $appointment->start_time === null || $appointment->doctor_id === null) {
            return;
        }

        $this->lockDoctor((int) $appointment->doctor_id);

        $this->markBookedIfOffered($appointment);

        $this->entriesAt((int) $appointment->clinic_id, (int) $appointment->doctor_id, $date, $this->normaliseTime((string) $appointment->start_time))
            ->where('status', 'offered')
            ->when($appointment->patient_id !== null, fn ($q) => $q->where('patient_id', '!=', $appointment->patient_id))
            ->update(['status' => 'expired', 'updated_at' => now()]);
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
     * Each entry's 1-based place in line among the `waiting` entries for
     * its slot (oldest first, the order slotFreed() offers in); null for
     * any entry that isn't waiting. One query per distinct slot.
     *
     * @param  iterable<WaitlistEntry>  $entries
     * @return array<int, ?int> keyed by entry id
     */
    public function positions(iterable $entries): array
    {
        $positions = [];
        $slots = [];
        foreach ($entries as $entry) {
            $positions[$entry->id] = null;
            if ($entry->status === 'waiting') {
                $key = implode('|', [$entry->clinic_id, $entry->doctor_id, $entry->appointment_date->toDateString(), $entry->start_time]);
                $slots[$key] = $entry;
            }
        }

        foreach ($slots as $entry) {
            $ids = $this->entriesAt((int) $entry->clinic_id, (int) $entry->doctor_id, $entry->appointment_date->toDateString(), (string) $entry->start_time)
                ->where('status', 'waiting')
                ->orderBy('id')
                ->pluck('id')
                ->all();

            foreach ($ids as $index => $id) {
                if (array_key_exists($id, $positions)) {
                    $positions[$id] = $index + 1;
                }
            }
        }

        return $positions;
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

        // Same-clinic only: a holder in another clinic is bad data and must never receive a login link.
        return Patient::query()->where('clinic_id', $patient->clinic_id)->find($patient->managed_by_patient_id);
    }

    private function appointmentDate(Appointment $appointment): ?string
    {
        $date = $appointment->appointment_date;
        if ($date === null || $date === '') {
            return null;
        }

        return $date instanceof \DateTimeInterface ? $date->format('Y-m-d') : substr((string) $date, 0, 10);
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
