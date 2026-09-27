<?php

namespace App\Support\Portal;

use App\Models\Clinic;
use App\Models\Patient;
use App\Services\WhatsApp\PhoneNumber;
use App\Support\PortalConsent;

/**
 * Serialises the payload for GET /api/portal/auth/me: the signed-in
 * account, the profiles it may act for in its own clinic, every
 * account-holder row sharing its phone number (so the SPA can offer a
 * clinic switch), and the current clinic's public details.
 */
final class PortalAccount
{
    public static function payload(Patient $account): array
    {
        $profiles = PortalProfiles::allowedFor($account);

        $phone = PhoneNumber::normalise($account->phone);
        $holders = $phone ? PortalProfiles::accountHoldersForPhone($phone) : collect();
        if (! $holders->contains(fn (Patient $p) => $p->id === $account->id)) {
            $holders = $holders->push($account);
        }

        $clinics = Clinic::whereIn('id', $holders->pluck('clinic_id')->unique())->get()->keyBy('id');

        $clinicRows = $holders->map(fn (Patient $p) => [
            'patient_id' => $p->id,
            'clinic_id' => $p->clinic_id,
            'clinic_name' => $clinics->get($p->clinic_id)?->name,
            'patient_name' => $p->full_name,
        ])->values()->all();

        $currentClinic = $clinics->get($account->clinic_id) ?? Clinic::find($account->clinic_id);

        return [
            'account' => [
                'id' => $account->id,
                'full_name' => $account->full_name,
                'phone' => $account->phone,
            ],
            'profiles' => $profiles->map(fn (array $row) => [
                'id' => $row['patient']->id,
                'full_name' => $row['patient']->full_name,
                'dob' => $row['patient']->dob?->toDateString(),
                'gender' => $row['patient']->gender,
                'relation' => $row['relation'],
                'consent_current' => $row['patient']->consent_version === PortalConsent::VERSION,
            ])->values()->all(),
            'clinics' => $clinicRows,
            'clinic' => $currentClinic ? [
                'id' => $currentClinic->id,
                'name' => $currentClinic->name,
                'logo_url' => $currentClinic->logo_url,
                'primary_color' => $currentClinic->primary_color,
                'phone' => $currentClinic->phone,
                'address' => self::address($currentClinic),
            ] : null,
        ];
    }

    private static function address(Clinic $clinic): ?string
    {
        $parts = array_filter([
            $clinic->address_line_1,
            $clinic->address_line_2,
            $clinic->city,
            $clinic->state,
            $clinic->pincode,
        ], fn ($part) => filled($part));

        return $parts === [] ? null : implode(', ', $parts);
    }
}
