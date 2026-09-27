<?php

namespace App\Http\Middleware;

use App\Support\Portal\PortalProfiles;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Authenticates a patient-portal request via the `portal` Sanctum guard
 * and resolves which patient profile the request is acting for.
 *
 * The token owner (the account that signed in) is exposed as request
 * attribute `portal_account`; the profile it is currently acting for
 * (itself, a dependent, a linked family member, or another account
 * holder sharing its phone number — see PortalProfiles::allowedFor) is
 * exposed as `portal_patient`, selected via the `X-Patient-Id` header
 * (defaulting to the account itself when absent).
 */
class AuthenticatePortal
{
    public function handle(Request $request, Closure $next): Response
    {
        $account = Auth::guard('portal')->user();

        if (! $account
            || $account->trashed()
            || ! $account->tokenCan('portal')
            || $account->managed_by_patient_id !== null
            || ! PortalProfiles::portalEnabled($account->clinic_id)) {
            return response()->json([
                'success' => false,
                'message' => 'Session expired. Please sign in again.',
            ], 401);
        }

        $allowed = PortalProfiles::allowedFor($account);

        $header = $request->header('X-Patient-Id');
        $patientId = null;
        if ($header === null) {
            $patientId = $account->id;
        } elseif (ctype_digit((string) $header)) {
            $patientId = (int) $header;
        }

        if ($patientId === null || ! $allowed->has($patientId)) {
            return response()->json([
                'success' => false,
                'message' => "You can't view this profile.",
            ], 403);
        }

        $request->attributes->set('portal_account', $account);
        $request->attributes->set('portal_patient', $allowed->get($patientId)['patient']);

        return $next($request);
    }
}
