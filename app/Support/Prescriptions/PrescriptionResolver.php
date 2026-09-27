<?php

namespace App\Support\Prescriptions;

use App\Models\AppointmentPrescription;
use Illuminate\Database\Eloquent\Builder;

/**
 * Single place that knows how to pick "the" prescription row for an
 * appointment out of the (possibly several) `appointment_prescriptions`
 * rows a voice re-record can create.
 *
 * `latest()` is whatever was recorded most recently, draft or final — used
 * where staff need to see/edit the current draft. `latestFinal()` is the
 * most recent row with `status = final`, ignoring any later draft that
 * hasn't been finalized yet — this is what the patient portal and the
 * "send to patient" flow use, since a draft must never reach a patient.
 */
final class PrescriptionResolver
{
    public static function latest(int $appointmentId): ?AppointmentPrescription
    {
        return AppointmentPrescription::query()
            ->where('appointment_id', $appointmentId)
            ->orderByDesc('id')
            ->first();
    }

    public static function latestFinal(int $appointmentId): ?AppointmentPrescription
    {
        return self::finalQuery()
            ->where('appointment_id', $appointmentId)
            ->orderByDesc('id')
            ->first();
    }

    /**
     * Base query for "final" rows, shared by latestFinal() and by callers
     * (the portal dashboard's finalized-prescriptions count, the portal
     * prescriptions list) that need to scan finals across many
     * appointments rather than resolve a single one.
     */
    public static function finalQuery(): Builder
    {
        return AppointmentPrescription::query()->where('status', 'final');
    }
}
