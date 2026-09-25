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
        $data = [
            'openai_api_key' => '',
            'openai_model' => (string) PlatformSettings::get('openai_model', 'gpt-4o-mini'),
        ];

        return $this->success('System settings fetched successfully', $data);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'openai_api_key' => ['nullable', 'string'],
            'openai_model' => ['nullable', 'string', 'max:100'],
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

        return $this->success('System settings saved successfully', [
            'openai_api_key' => '',
            'openai_model' => (string) PlatformSettings::get('openai_model', 'gpt-4o-mini'),
        ]);
    }
}
