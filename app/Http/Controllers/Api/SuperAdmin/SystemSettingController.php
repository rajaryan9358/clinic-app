<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\SystemSetting;
use Illuminate\Http\Request;

class SystemSettingController extends Controller
{
    use ApiResponse;

    public function show(Request $request)
    {
        $data = [
            'openai_api_key' => '',
            'openai_model' => (string) $this->get('openai_model', 'gpt-4o-mini'),
            'trial_days' => (int) $this->get('trial_days', 14),
            'trial_enabled' => (bool) $this->get('trial_enabled', true),
        ];

        return $this->success('System settings fetched successfully', $data);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'openai_api_key' => ['nullable', 'string'],
            'openai_model' => ['nullable', 'string', 'max:100'],
            'trial_days' => ['nullable', 'integer', 'min:1', 'max:365'],
            'trial_enabled' => ['nullable', 'boolean'],
        ]);

        // Leave blank to keep existing (UI behavior)
        if (array_key_exists('openai_api_key', $validated)) {
            $key = (string) ($validated['openai_api_key'] ?? '');
            if ($key !== '') {
                $this->set('openai_api_key', $key);
            }
        }

        if (array_key_exists('openai_model', $validated)) {
            $model = (string) ($validated['openai_model'] ?? '');
            if ($model !== '') {
                $this->set('openai_model', $model);
            }
        }

        if (array_key_exists('trial_days', $validated)) {
            $this->set('trial_days', (int) $validated['trial_days']);
        }

        if (array_key_exists('trial_enabled', $validated)) {
            $this->set('trial_enabled', (bool) $validated['trial_enabled']);
        }

        return $this->success('System settings saved successfully', [
            'openai_api_key' => '',
            'openai_model' => (string) $this->get('openai_model', 'gpt-4o-mini'),
            'trial_days' => (int) $this->get('trial_days', 14),
            'trial_enabled' => (bool) $this->get('trial_enabled', true),
        ]);
    }

    private function get(string $key, mixed $default = null): mixed
    {
        $raw = SystemSetting::query()->where('key', $key)->value('value');
        if ($raw === null) return $default;

        $decoded = json_decode($raw, true);
        if (json_last_error() === JSON_ERROR_NONE) {
            return $decoded;
        }

        return $raw;
    }

    private function set(string $key, mixed $value): void
    {
        SystemSetting::query()->updateOrCreate(
            ['key' => $key],
            ['value' => json_encode($value)]
        );
    }
}
