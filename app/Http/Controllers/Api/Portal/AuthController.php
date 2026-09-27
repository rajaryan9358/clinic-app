<?php

namespace App\Http\Controllers\Api\Portal;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Patient;
use App\Support\Portal\PortalAccount;
use Illuminate\Http\Request;

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
}
