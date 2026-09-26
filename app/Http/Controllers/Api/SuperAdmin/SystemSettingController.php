<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Services\WhatsApp\TemplateSettings;
use App\Services\WhatsApp\WhatsAppGateway;
use App\Support\PlatformSettings;
use Illuminate\Http\Request;

class SystemSettingController extends Controller
{
    use ApiResponse;

    public function show(Request $request)
    {
        return $this->success('System settings fetched successfully', $this->payload());
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'openai_api_key' => ['nullable', 'string'],
            'openai_model' => ['nullable', 'string', 'max:100'],
            'razorpay_key_id' => ['nullable', 'string', 'max:100'],
            'razorpay_key_secret' => ['nullable', 'string', 'max:200'],
            'razorpay_webhook_secret' => ['nullable', 'string', 'max:200'],
            'razorpay_mode' => ['nullable', 'in:test,live'],
            'subscription_grace_days' => ['nullable', 'integer', 'min:0', 'max:30'],
            'trial_days' => ['nullable', 'integer', 'min:1', 'max:365'],
            'whatsapp_phone_number_id' => ['nullable', 'string', 'max:100'],
            'whatsapp_waba_id' => ['nullable', 'string', 'max:100'],
            'whatsapp_graph_version' => ['nullable', 'string', 'max:100'],
            'whatsapp_access_token' => ['nullable', 'string', 'max:500'],
            'whatsapp_app_secret' => ['nullable', 'string', 'max:500'],
            'whatsapp_webhook_verify_token' => ['nullable', 'string', 'max:500'],
            'whatsapp_templates' => ['sometimes', 'array'],
        ]);

        // Leave blank to keep existing (UI behavior)
        if (array_key_exists('openai_api_key', $validated)) {
            $key = (string) ($validated['openai_api_key'] ?? '');
            if ($key !== '') {
                PlatformSettings::set('openai_api_key', $key);
            }
        }

        if (array_key_exists('openai_model', $validated)) {
            $model = (string) ($validated['openai_model'] ?? '');
            if ($model !== '') {
                PlatformSettings::set('openai_model', $model);
            }
        }

        if (array_key_exists('razorpay_key_id', $validated) && $validated['razorpay_key_id'] !== null) {
            PlatformSettings::set('razorpay_key_id', $validated['razorpay_key_id']);
        }

        if (array_key_exists('razorpay_key_secret', $validated)) {
            $secret = (string) ($validated['razorpay_key_secret'] ?? '');
            if ($secret !== '') {
                PlatformSettings::set('razorpay_key_secret', $secret);
            }
        }

        if (array_key_exists('razorpay_webhook_secret', $validated)) {
            $secret = (string) ($validated['razorpay_webhook_secret'] ?? '');
            if ($secret !== '') {
                PlatformSettings::set('razorpay_webhook_secret', $secret);
            }
        }

        if (array_key_exists('razorpay_mode', $validated) && $validated['razorpay_mode'] !== null) {
            PlatformSettings::set('razorpay_mode', $validated['razorpay_mode']);
        }

        if (array_key_exists('subscription_grace_days', $validated) && $validated['subscription_grace_days'] !== null) {
            PlatformSettings::set('subscription_grace_days', $validated['subscription_grace_days']);
        }

        if (array_key_exists('trial_days', $validated) && $validated['trial_days'] !== null) {
            PlatformSettings::set('trial_days', $validated['trial_days']);
        }

        if (array_key_exists('whatsapp_phone_number_id', $validated) && $validated['whatsapp_phone_number_id'] !== null) {
            PlatformSettings::set('whatsapp_phone_number_id', $validated['whatsapp_phone_number_id']);
        }

        if (array_key_exists('whatsapp_waba_id', $validated) && $validated['whatsapp_waba_id'] !== null) {
            PlatformSettings::set('whatsapp_waba_id', $validated['whatsapp_waba_id']);
        }

        if (array_key_exists('whatsapp_graph_version', $validated) && $validated['whatsapp_graph_version'] !== null) {
            PlatformSettings::set('whatsapp_graph_version', $validated['whatsapp_graph_version']);
        }

        // Secrets: leave blank to keep the stored value (same UI convention as Razorpay above).
        if (array_key_exists('whatsapp_access_token', $validated)) {
            $token = (string) ($validated['whatsapp_access_token'] ?? '');
            if ($token !== '') {
                PlatformSettings::set('whatsapp_access_token', $token);
            }
        }

        if (array_key_exists('whatsapp_app_secret', $validated)) {
            $secret = (string) ($validated['whatsapp_app_secret'] ?? '');
            if ($secret !== '') {
                PlatformSettings::set('whatsapp_app_secret', $secret);
            }
        }

        if (array_key_exists('whatsapp_webhook_verify_token', $validated)) {
            $token = (string) ($validated['whatsapp_webhook_verify_token'] ?? '');
            if ($token !== '') {
                PlatformSettings::set('whatsapp_webhook_verify_token', $token);
            }
        }

        if (array_key_exists('whatsapp_templates', $validated)) {
            TemplateSettings::save($validated['whatsapp_templates']);
        }

        return $this->success('System settings saved successfully', $this->payload());
    }

    public function testWhatsApp(Request $request, WhatsAppGateway $gateway)
    {
        return $this->success('WhatsApp connection test completed', $gateway->testConnection());
    }

    private function payload(): array
    {
        return [
            'openai_api_key' => '',
            'openai_model' => (string) PlatformSettings::get('openai_model', 'gpt-4o-mini'),
            'trial_days' => (int) PlatformSettings::get('trial_days', 14),
            'subscription_grace_days' => (int) PlatformSettings::get('subscription_grace_days', 3),
            'razorpay_key_id' => (string) PlatformSettings::get('razorpay_key_id', ''),
            'razorpay_key_secret_set' => filled(PlatformSettings::get('razorpay_key_secret')),
            'razorpay_webhook_secret_set' => filled(PlatformSettings::get('razorpay_webhook_secret')),
            'razorpay_mode' => (string) PlatformSettings::get('razorpay_mode', 'test'),
            'webhook_url' => rtrim((string) config('app.url'), '/').'/api/webhooks/razorpay',
            'whatsapp_phone_number_id' => (string) PlatformSettings::get('whatsapp_phone_number_id', ''),
            'whatsapp_waba_id' => (string) PlatformSettings::get('whatsapp_waba_id', ''),
            'whatsapp_graph_version' => (string) PlatformSettings::get('whatsapp_graph_version', 'v21.0'),
            'whatsapp_access_token_set' => filled(PlatformSettings::get('whatsapp_access_token')),
            'whatsapp_app_secret_set' => filled(PlatformSettings::get('whatsapp_app_secret')),
            'whatsapp_webhook_verify_token_set' => filled(PlatformSettings::get('whatsapp_webhook_verify_token')),
            'whatsapp_webhook_url' => rtrim((string) config('app.url'), '/').'/api/webhooks/whatsapp',
            'whatsapp_templates' => TemplateSettings::all(),
        ];
    }
}
