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
    /**
     * Issues a fresh 30-day portal token for $account and pairs it with
     * its `me` payload — the `{token, account}` shape returned by every
     * portal login path (OTP verify, magic-link exchange, clinic switch).
     *
     * @return array{token: string, account: array}
     */
    public static function issueToken(Patient $account): array
    {
        return [
            'token' => $account->createToken('portal', ['portal'], now()->addDays(30))->plainTextToken,
            'account' => self::payload($account),
        ];
    }

    public static function payload(Patient $account): array
    {
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
            'profiles' => self::profiles($account),
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

    /**
     * The profiles an account may act for, in the shape both
     * `/auth/me` and `GET /portal/family` return.
     *
     * @return array<int, array{id: int, full_name: string, dob: ?string, gender: ?string, relation: string, consent_current: bool}>
     */
    public static function profiles(Patient $account): array
    {
        return PortalProfiles::allowedFor($account)->map(fn (array $row) => [
            'id' => $row['patient']->id,
            'full_name' => $row['patient']->full_name,
            'dob' => $row['patient']->dob?->toDateString(),
            'gender' => $row['patient']->gender,
            'relation' => $row['relation'],
            'consent_current' => $row['patient']->consent_version === PortalConsent::VERSION,
        ])->values()->all();
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
