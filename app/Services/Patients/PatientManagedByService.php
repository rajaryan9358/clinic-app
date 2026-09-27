<?php

namespace App\Services\Patients;

use App\Models\Patient;
use Illuminate\Validation\ValidationException;

/**
 * Staff-side management of `patients.managed_by_patient_id` — linking a
 * patient to the account holder who manages their portal profile (a
 * spouse, a parent, ...), or clearing that link.
 *
 * The portal's family hierarchy is intentionally flat: an account holder
 * (no `managed_by_patient_id`) can manage dependents, but a dependent
 * can't itself manage other dependents, and a patient that already
 * manages dependents can't be turned into someone else's dependent
 * (that would orphan/chain the hierarchy). Both invalid-target cases
 * collapse to the same message so nothing about a patient's clinic or
 * relationships leaks to the caller.
 */
final class PatientManagedByService
{
    private const ERROR = 'Choose an account holder in this clinic.';

    public function update(Patient $patient, ?int $managerId): void
    {
        if ($managerId === null) {
            $patient->managed_by_patient_id = null;
            $patient->save();

            return;
        }

        if ($managerId === $patient->id) {
            throw ValidationException::withMessages(['managed_by_patient_id' => self::ERROR]);
        }

        $manager = Patient::where('clinic_id', $patient->clinic_id)->find($managerId);

        if ($manager === null || $manager->managed_by_patient_id !== null) {
            throw ValidationException::withMessages(['managed_by_patient_id' => self::ERROR]);
        }

        $hasDependents = Patient::where('clinic_id', $patient->clinic_id)
            ->where('managed_by_patient_id', $patient->id)
            ->exists();

        if ($hasDependents) {
            throw ValidationException::withMessages(['managed_by_patient_id' => self::ERROR]);
        }

        $patient->managed_by_patient_id = $manager->id;
        $patient->save();
    }
}
