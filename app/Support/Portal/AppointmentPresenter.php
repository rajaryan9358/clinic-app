<?php

namespace App\Support\Portal;

use App\Models\Appointment;
use App\Services\Portal\PortalBookingPolicy;

/**
 * Serialises an Appointment into the `AppointmentItem` shape the patient
 * portal SPA renders.
 *
 * `item()` (the dashboard's `next_appointment` and the appointments list)
 * adds `can_cancel`/`can_reschedule`/`change_blocked_reason`, derived from
 * `PortalBookingPolicy::canChange()` — resolved from the container since
 * this is a static serialiser, not a controller.
 * `detail()` extends `item()` for the single-appointment view with the
 * clinic's address/maps link, the cancellation reason, and whether a
 * final prescription exists — the *controller* resolves that via
 * `PrescriptionResolver::latestFinal()` (see AppointmentController::show)
 * and passes it in, so this presenter stays a pure serialiser.
 */
final class AppointmentPresenter
{
    public static function item(Appointment $appointment): array
    {
        $policy = app(PortalBookingPolicy::class);
        $cancelBlockedReason = $policy->canChange($appointment, 'cancel');
        $rescheduleBlockedReason = $policy->canChange($appointment, 'reschedule');

        return [
            'id' => $appointment->id,
            'date' => $appointment->appointment_date->toDateString(),
            'start_time' => $appointment->start_time,
            'end_time' => $appointment->end_time,
            'status' => $appointment->status,
            'visit_type' => $appointment->visit_type,
            'consultation_mode' => $appointment->consultation_mode,
            'booking_channel' => $appointment->booking_channel,
            'doctor' => [
                'id' => $appointment->doctor?->id,
                'name' => $appointment->doctor?->full_name,
                'specialization' => $appointment->doctor?->specialization,
            ],
            'can_cancel' => $cancelBlockedReason === null,
            'can_reschedule' => $rescheduleBlockedReason === null,
            'change_blocked_reason' => $cancelBlockedReason ?? $rescheduleBlockedReason,
        ];
    }

    public static function detail(Appointment $appointment, bool $hasFinalPrescription): array
    {
        $clinic = $appointment->clinic;

        $addressParts = array_filter([
            $clinic?->address_line_1,
            $clinic?->address_line_2,
            $clinic?->city,
            $clinic?->state,
            $clinic?->pincode,
        ], fn ($part) => filled($part));
        $address = $addressParts !== [] ? implode(', ', $addressParts) : null;

        $mapsUrl = null;
        if ($clinic?->latitude !== null && $clinic?->longitude !== null) {
            $mapsUrl = "https://www.google.com/maps?q={$clinic->latitude},{$clinic->longitude}";
        } elseif ($address !== null) {
            $mapsUrl = 'https://www.google.com/maps/search/?api=1&query='.rawurlencode($address);
        }

        return [
            ...self::item($appointment),
            'clinic' => [
                'name' => $clinic?->name,
                'phone' => $clinic?->phone,
                'address' => $address,
                'maps_url' => $mapsUrl,
            ],
            'cancellation_reason' => $appointment->cancellation_reason,
            'has_final_prescription' => $hasFinalPrescription,
        ];
    }
}
