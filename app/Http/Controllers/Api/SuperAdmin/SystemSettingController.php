<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
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

        return $this->success('System settings saved successfully', $this->payload());
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
        ];
    }
}
