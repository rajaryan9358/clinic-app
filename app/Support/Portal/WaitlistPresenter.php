<?php

namespace App\Support\Portal;

use App\Models\WaitlistEntry;
use App\Services\Waitlist\WaitlistService;

/**
 * Serialises WaitlistEntry rows for the patient portal.
 *
 * `items()` is the `GET waitlist` list shape (positions resolved in one
 * pass); `item()` the same shape for a single entry (join/leave/decline
 * responses); `detail()` adds what the offer page (`/waitlist/:id`)
 * needs — the doctor's consultation modes, the clinic, and the booked
 * appointment once the offer is taken. Times are clinic-local `H:i`
 * (matching the slots endpoint); `hold_expires_at` is an ISO-8601
 * instant for the countdown. `position` is the 1-based place among the
 * slot's waiting entries, null unless waiting.
 */
final class WaitlistPresenter
{
    /**
     * @param  iterable<WaitlistEntry>  $entries  with `doctor` loaded
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

    public static function detail(WaitlistEntry $entry): array
    {
        $item = self::item($entry);
        $item['doctor']['consultation_modes'] = $entry->doctor?->consultationModes() ?? [];

        return [
            ...$item,
            'offered_at' => $entry->offered_at?->toIso8601String(),
            'booked_appointment_id' => $entry->booked_appointment_id,
            'clinic' => [
                'name' => $entry->clinic?->name,
                'phone' => $entry->clinic?->phone,
            ],
        ];
    }

    private static function row(WaitlistEntry $entry, ?int $position): array
    {
        return [
            'id' => $entry->id,
            'status' => $entry->status,
            'doctor' => [
                'id' => $entry->doctor?->id,
                'name' => $entry->doctor?->full_name,
                'specialization' => $entry->doctor?->specialization,
            ],
            'date' => $entry->appointment_date->toDateString(),
            'start_time' => substr((string) $entry->start_time, 0, 5),
            'end_time' => $entry->end_time !== null ? substr((string) $entry->end_time, 0, 5) : null,
            'hold_expires_at' => $entry->hold_expires_at?->toIso8601String(),
            'position' => $position,
        ];
    }
}
