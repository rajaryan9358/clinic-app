<?php

namespace App\Support\Portal;

use App\Models\ClinicSetting;
use App\Models\Patient;
use App\Models\PatientFamilyLink;
use App\Services\WhatsApp\PhoneNumber;
use Illuminate\Support\Collection;

/**
 * Resolves which patient profiles a signed-in portal account may act for.
 *
 * An "account holder" is a patient row with no `managed_by_patient_id`
 * (i.e. not someone else's dependent). Everything a portal session can
 * touch is derived from the account holder: their own record, patients
 * they manage (dependents), patients linked via `patient_family_links`
 * (one-directional: only the linker's account can act for the linked
 * patient, not the other way around), and other account holders who
 * share the same normalised phone number within the same clinic.
 */
final class PortalProfiles
{
    /**
     * Account-holder rows for a normalised phone across portal-enabled
     * clinics.
     *
     * @return Collection<int, Patient>
     */
    public static function accountHoldersForPhone(string $normalisedPhone): Collection
    {
        return Patient::query()
            ->whereNull('managed_by_patient_id')
            ->where('phone', 'like', '%'.substr($normalisedPhone, -10))
            ->get()
            ->filter(fn (Patient $p) => PhoneNumber::normalise($p->phone) === $normalisedPhone
                && self::portalEnabled($p->clinic_id))
            ->values();
    }

    /**
     * @return Collection<int, array{patient: Patient, relation: 'self'|'dependent'|'family'|'same_phone'}> keyed by patient id
     */
    public static function allowedFor(Patient $account): Collection
    {
        $out = collect([$account->id => ['patient' => $account, 'relation' => 'self']]);
        $clinicId = $account->clinic_id;

        Patient::where('clinic_id', $clinicId)->where('managed_by_patient_id', $account->id)->get()
            ->each(fn ($p) => $out->put($p->id, $out->get($p->id) ?? ['patient' => $p, 'relation' => 'dependent']));

        $linked = PatientFamilyLink::where('clinic_id', $clinicId)->where('patient_id', $account->id)->pluck('related_patient_id');
        Patient::where('clinic_id', $clinicId)->whereIn('id', $linked)->get()
            ->each(fn ($p) => $out->put($p->id, $out->get($p->id) ?? ['patient' => $p, 'relation' => 'family']));

        $phone = PhoneNumber::normalise($account->phone);
        if ($phone) {
            self::accountHoldersForPhone($phone)->where('clinic_id', $clinicId)
                ->each(fn ($p) => $out->put($p->id, $out->get($p->id) ?? ['patient' => $p, 'relation' => 'same_phone']));
        }

        return $out;
    }

    public static function portalEnabled(int $clinicId): bool
    {
        return (bool) (ClinicSetting::where('clinic_id', $clinicId)->value('portal_enabled') ?? true);
    }
}
