<?php

namespace App\Http\Controllers\Api\Portal;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Patient;
use App\Support\PortalConsent;
use Illuminate\Http\Request;

/**
 * The patient-portal privacy-notice gate: `GET` reports whether the
 * *acting* profile (`portal_patient`) has accepted the current
 * `PortalConsent::VERSION`, `POST` records that acceptance. Consent is
 * stamped on the acting profile only — signing in as a dependent and
 * accepting consent does not also consent on behalf of the account
 * holder or any other profile.
 */
class ConsentController extends Controller
{
    use ApiResponse;

    public function show(Request $request)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');

        return $this->success('OK', $this->payload($patient));
    }

    public function store(Request $request)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');

        // consent_given_at/consent_version aren't mass-assignable (they
        // must only ever be set here, never via a generic profile-update
        // endpoint), so force them through directly.
        $patient->forceFill([
            'consent_given_at' => now(),
            'consent_version' => PortalConsent::VERSION,
            'communication_consent' => true,
        ])->save();

        return $this->success('Consent recorded.', $this->payload($patient));
    }

    private function payload(Patient $patient): array
    {
        return [
            'version' => PortalConsent::VERSION,
            'text' => PortalConsent::TEXT,
            'given_at' => $patient->consent_given_at?->toISOString(),
            'current' => $patient->consent_version === PortalConsent::VERSION,
        ];
    }
}
