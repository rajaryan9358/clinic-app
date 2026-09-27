<?php

namespace App\Http\Controllers\Api\Portal;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Services\Portal\PortalLinkService;
use App\Support\Portal\PortalAccount;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class LinkController extends Controller
{
    use ApiResponse;

    public function __construct(private PortalLinkService $links) {}

    /**
     * Exchanges a staff-issued magic-link token for a portal session,
     * mirroring OtpController::verify's `{token, account}` response.
     */
    public function exchange(Request $request)
    {
        $data = $request->validate(['token' => 'required|string']);

        try {
            $patient = $this->links->consume($data['token']);
        } catch (ValidationException $e) {
            $message = (string) collect($e->errors())->collapse()->first();

            return $this->error($message, $e->errors(), 422);
        }

        return $this->success('Logged in.', PortalAccount::issueToken($patient));
    }
}
