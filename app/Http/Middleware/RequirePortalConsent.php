<?php

namespace App\Http\Middleware;

use App\Support\PortalConsent;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gates every patient-portal feature route (dashboard, family, and the
 * booking/appointment/prescription routes added in later tasks) behind an
 * up-to-date privacy-notice acceptance on the *acting* profile
 * (`portal_patient`, set by `portal.auth`).
 *
 * Consent is per-profile, not per-account: a dependent or family member
 * needs their own accepted `PortalConsent::VERSION` before the account
 * holder can act as them, even if the account holder itself has consented.
 * Bumping PortalConsent::VERSION re-prompts everyone whose stamped
 * `consent_version` no longer matches.
 */
class RequirePortalConsent
{
    public function handle(Request $request, Closure $next): Response
    {
        $patient = $request->attributes->get('portal_patient');

        if (! $patient || $patient->consent_version !== PortalConsent::VERSION) {
            return response()->json([
                'success' => false,
                'message' => 'Please accept the privacy notice to continue.',
                'code' => 'consent_required',
            ], 428);
        }

        return $next($request);
    }
}
