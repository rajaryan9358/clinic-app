<?php

namespace App\Support\Portal;

use App\Models\Appointment;

/**
 * Serialises an Appointment into the `AppointmentItem` shape the patient
 * portal SPA renders. Task 5 (booking/cancel/reschedule) extends `item()`
 * with `can_cancel`, `can_reschedule` and `change_blocked_reason`; this
 * task only needs the read-only shape for the dashboard's
 * `next_appointment`.
 */
final class AppointmentPresenter
{
    public static function item(Appointment $appointment): array
    {
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
        ];
    }
}
