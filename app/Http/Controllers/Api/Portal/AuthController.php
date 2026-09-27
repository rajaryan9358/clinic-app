<?php

namespace App\Http\Controllers\Api\Portal;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Patient;
use App\Services\WhatsApp\PhoneNumber;
use App\Support\Portal\PortalAccount;
use App\Support\Portal\PortalProfiles;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    use ApiResponse;

    public function me(Request $request)
    {
        /** @var Patient $account */
        $account = $request->attributes->get('portal_account');

        return $this->success('OK', PortalAccount::payload($account));
    }

    public function logout(Request $request)
    {
        /** @var Patient $account */
        $account = $request->attributes->get('portal_account');

        $account->currentAccessToken()?->delete();

        return $this->success('Logged out successfully.');
    }

    /**
     * Switches the signed-in account to another account holder sharing
     * the same normalised phone number (typically in a different
     * clinic), issuing a fresh 30-day token and revoking the old one.
     */
    public function switchClinic(Request $request)
    {
        $data = $request->validate(['patient_id' => 'required|integer']);

        /** @var Patient $account */
        $account = $request->attributes->get('portal_account');

        $phone = PhoneNumber::normalise($account->phone);
        $holders = $phone ? PortalProfiles::accountHoldersForPhone($phone) : collect();
        $target = $holders->first(fn (Patient $p) => $p->id === (int) $data['patient_id']);

        if ($target === null) {
            throw ValidationException::withMessages([
                'patient_id' => "That profile isn't available on this phone number.",
            ]);
        }

        $account->currentAccessToken()?->delete();

        return $this->success('Switched clinic.', PortalAccount::issueToken($target));
    }
}
