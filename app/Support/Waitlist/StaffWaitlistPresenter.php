<?php

namespace App\Support\Waitlist;

use App\Models\Appointment;
use App\Models\WaitlistEntry;
use App\Services\Waitlist\WaitlistService;

/**
 * Serialises waitlist data for the staff (clinic and super-admin) API.
 *
 * `items()`/`item()` are the waitlist list/add/remove row shape (positions
 * resolved in one pass via WaitlistService::positions()); times are
 * clinic-local `H:i`, timestamps ISO-8601. `forAppointment()` is the
 * `waitlist` block of the appointment detail payload: how many are waiting
 * for the appointment's slot and who it is currently held for.
 */
final class StaffWaitlistPresenter
{
    /**
     * @param  iterable<WaitlistEntry>  $entries  with `patient` and `doctor` loaded
     * @return array<int, array>
     */
    public static function items(iterable $entries): array
    {
        $positions = app(WaitlistService::class)->positions($entries);

        $out = [];
        foreach ($entries as $entry) {
            $out[] = self::row($entry, $positions[$entry->id] ?? null);
        }

        return $out;
    }

    public static function item(WaitlistEntry $entry): array
    {
        return self::items([$entry])[0];
    }

    /** @return array{waiting_count: int, held_for: ?array{patient_name: ?string, until: ?string}} */
    public static function forAppointment(Appointment $appointment): array
    {
        if ($appointment->appointment_date === null || $appointment->start_time === null) {
            return ['waiting_count' => 0, 'held_for' => null];
        }

        $clinicId = (int) $appointment->clinic_id;
        $doctorId = (int) $appointment->doctor_id;
        $date = $appointment->appointment_date->toDateString();
        $start = (string) $appointment->start_time;

        $waiting = WaitlistEntry::query()
            ->forClinic($clinicId)
            ->where('doctor_id', $doctorId)
            ->whereDate('appointment_date', $date)
            ->whereTime('start_time', '=', $start)
            ->where('status', 'waiting')
            ->count();

        $held = app(WaitlistService::class)->heldFor($clinicId, $doctorId, $date, $start);
        $held?->load(['patient' => fn ($q) => $q->withTrashed()]);

        return [
            'waiting_count' => $waiting,
            'held_for' => $held === null ? null : [
                'patient_name' => $held->patient?->full_name,
                'until' => $held->hold_expires_at?->toIso8601String(),
            ],
        ];
    }

    private static function row(WaitlistEntry $entry, ?int $position): array
    {
        return [
            'id' => $entry->id,
            'clinic_id' => $entry->clinic_id,
            'patient' => [
                'id' => $entry->patient?->id,
                'full_name' => $entry->patient?->full_name,
                'phone' => $entry->patient?->phone,
            ],
            'doctor' => [
                'id' => $entry->doctor?->id,
                'name' => $entry->doctor?->full_name,
            ],
            'date' => $entry->appointment_date->toDateString(),
            'start_time' => substr((string) $entry->start_time, 0, 5),
            'end_time' => $entry->end_time !== null ? substr((string) $entry->end_time, 0, 5) : null,
            'status' => $entry->status,
            'position' => $position,
            'hold_expires_at' => $entry->hold_expires_at?->toIso8601String(),
            'source' => $entry->source,
            'created_at' => $entry->created_at?->toIso8601String(),
        ];
    }
}
