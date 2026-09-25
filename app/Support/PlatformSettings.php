<?php

namespace App\Support;

use App\Models\SystemSetting;

class PlatformSettings
{
    public static function get(string $key, mixed $default = null): mixed
    {
        $raw = SystemSetting::query()->where('key', $key)->first()?->value;
        if ($raw === null) {
            return $default;
        }
        $decoded = json_decode($raw, true);

        return json_last_error() === JSON_ERROR_NONE ? $decoded : $raw;
    }

    public static function set(string $key, mixed $value): void
    {
        SystemSetting::query()->updateOrCreate(['key' => $key], ['value' => json_encode($value)]);
    }
}
