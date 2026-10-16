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
     * Exchanges a staff-issued or redirecting magic-link token for a
     * portal session, mirroring OtpController::verify's `{token, account}`
     * response plus an optional `redirect_path` the SPA should navigate to.
     */
    public function exchange(Request $request)
    {
        $data = $request->validate(['token' => 'required|string']);

        try {
            $result = $this->links->consume($data['token']);
        } catch (ValidationException $e) {
            $message = (string) collect($e->errors())->collapse()->first();

            return $this->error($message, $e->errors(), 422);
        }

        $payload = PortalAccount::issueToken($result['patient']);
        $payload['redirect_path'] = $this->safeRedirectPath($result['redirect_path']);

        return $this->success('Logged in.', $payload);
    }

    /**
     * Only a same-origin, non-protocol-relative path is trusted back to
     * the SPA for a post-login redirect; anything else (an absolute URL,
     * `//host`, `javascript:`) is dropped rather than echoed.
     */
    private function safeRedirectPath(?string $path): ?string
    {
        if ($path === null) {
            return null;
        }

        return preg_match('#^/(?!/)[A-Za-z0-9/_\-?=&.]*$#D', $path) === 1 ? $path : null;
    }
}
