<?php

namespace App\Services\WhatsApp;

/**
 * Normalises a raw phone number into digits-with-country-code, the format
 * the WhatsApp Cloud API expects for the "to" field.
 */
final class PhoneNumber
{
    /**
     * Strip everything but digits. If the original string started with
     * "+" the digits already include a country code and are kept as-is;
     * otherwise a single leading "0" (local trunk prefix) is dropped and,
     * if the remainder is exactly 10 digits, "91" (India) is prepended.
     * Anything that ends up shorter than 10 digits is unusable.
     */
    public static function normalise(?string $raw): ?string
    {
        if (! is_string($raw) || trim($raw) === '') {
            return null;
        }

        $hasPlus = str_starts_with(trim($raw), '+');
        $digits = preg_replace('/\D+/', '', $raw) ?? '';

        if (! $hasPlus && str_starts_with($digits, '0')) {
            $digits = substr($digits, 1);
        }

        if (strlen($digits) === 10) {
            $digits = '91'.$digits;
        }

        return strlen($digits) < 10 ? null : $digits;
    }
}
