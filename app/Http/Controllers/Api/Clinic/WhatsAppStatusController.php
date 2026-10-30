<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Services\WhatsApp\TemplateSettings;
use App\Services\WhatsApp\WhatsAppGateway;

/**
 * Read-only WhatsApp status for a clinic's settings page. The connection
 * itself (number, token, templates) is platform-wide and managed by the
 * super admin, so only whether it is set up and which messages are switched
 * on is exposed here — never credentials.
 */
class WhatsAppStatusController extends Controller
{
    use ApiResponse;

    public function show(WhatsAppGateway $gateway)
    {
        $templates = collect(TemplateSettings::all())
            ->map(fn (array $t, string $type) => ['type' => $type, 'enabled' => (bool) $t['enabled']])
            ->values();

        return $this->success('WhatsApp status fetched', [
            'connected' => $gateway->isConfigured(),
            'templates' => $templates,
        ]);
    }
}
