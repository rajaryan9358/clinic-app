<?php

namespace App\Services\Patients;

use App\Models\Patient;
use App\Models\PatientFamilyLink;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Validation\ValidationException;

/**
 * Staff-side management of `patient_family_links` — a one-directional
 * grant letting `related_patient_id` act as `patient_id` on the portal
 * (see App\Support\Portal\PortalProfiles::allowedFor(), which reads these
 * rows as "family" access for the *linker's* ($patient_id) account only —
 * the related patient can use $patient's portal profile, not the other
 * way around).
 *
 * Both the clinic and super-admin `PatientFamilyController` share this
 * service; the caller is responsible for resolving `$patient` within its
 * own scope (clinic-scoped lookup for staff, unscoped for super admin) —
 * every rule here is expressed against `$patient->clinic_id`.
 */
final class PatientFamilyLinkService
{
    private const INVALID_TARGET = 'Choose a patient in this clinic.';

    private const DUPLICATE = 'These patients are already linked.';

    public function create(Patient $patient, int $relatedPatientId, ?string $relation): PatientFamilyLink
    {
        if ($relatedPatientId === $patient->id) {
            throw ValidationException::withMessages(['related_patient_id' => self::INVALID_TARGET]);
        }

        $related = Patient::where('clinic_id', $patient->clinic_id)->find($relatedPatientId);

        if ($related === null) {
            throw ValidationException::withMessages(['related_patient_id' => self::INVALID_TARGET]);
        }

        $exists = PatientFamilyLink::where('clinic_id', $patient->clinic_id)
            ->where('patient_id', $patient->id)
            ->where('related_patient_id', $related->id)
            ->exists();

        if ($exists) {
            throw ValidationException::withMessages(['related_patient_id' => self::DUPLICATE]);
        }

        return PatientFamilyLink::create([
            'clinic_id' => $patient->clinic_id,
            'patient_id' => $patient->id,
            'related_patient_id' => $related->id,
            'relation' => $relation,
            'created_at' => now(),
        ]);
    }

    /**
     * @throws ModelNotFoundException if the link doesn't exist, or belongs
     *                                 to a different patient/clinic.
     */
    public function delete(Patient $patient, int $linkId): void
    {
        $link = PatientFamilyLink::where('clinic_id', $patient->clinic_id)
            ->where('patient_id', $patient->id)
            ->find($linkId);

        if ($link === null) {
            throw new ModelNotFoundException;
        }

        $link->delete();
    }
}
