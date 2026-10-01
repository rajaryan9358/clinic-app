<?php

namespace App\Services\WhatsApp;

use App\Support\PlatformSettings;
use Illuminate\Validation\ValidationException;

/**
 * Maps each notification type to the Meta-approved WhatsApp template that
 * should be used to send it. Stored as the single `whatsapp_templates`
 * platform setting, keyed by type.
 */
final class TemplateSettings
{
    public const TYPES = [
        'booking_confirmed',
        'appointment_reminder',
        'appointment_updated',
        'prescription_ready',
        'login_otp',
        'portal_link',
        'waitlist_slot_open',
    ];

    private const DEFAULTS = [
        'booking_confirmed' => ['name' => 'booking_confirmed', 'language' => 'en', 'enabled' => true],
        'appointment_reminder' => ['name' => 'appointment_reminder', 'language' => 'en', 'enabled' => true],
        'appointment_updated' => ['name' => 'appointment_updated', 'language' => 'en', 'enabled' => true],
        'prescription_ready' => ['name' => 'prescription_ready', 'language' => 'en', 'enabled' => true],
        'login_otp' => ['name' => 'login_otp', 'language' => 'en', 'enabled' => true],
        'portal_link' => ['name' => 'portal_link', 'language' => 'en', 'enabled' => true],
        'waitlist_slot_open' => ['name' => 'waitlist_slot_open', 'language' => 'en', 'enabled' => true],
    ];

    /** @return array{name: string, language: string, enabled: bool} */
    public static function for(string $type): array
    {
        $all = self::all();
        if (! array_key_exists($type, $all)) {
            throw new \InvalidArgumentException("Unknown WhatsApp template type: {$type}");
        }

        return $all[$type];
    }

    /** @return array<string, array{name: string, language: string, enabled: bool}> */
    public static function all(): array
    {
        $stored = PlatformSettings::get('whatsapp_templates', []);
        if (! is_array($stored)) {
            $stored = [];
        }

        $result = [];
        foreach (self::TYPES as $type) {
            $entry = is_array($stored[$type] ?? null) ? $stored[$type] : [];
            $result[$type] = [
                'name' => (string) ($entry['name'] ?? self::DEFAULTS[$type]['name']),
                'language' => (string) ($entry['language'] ?? self::DEFAULTS[$type]['language']),
                'enabled' => array_key_exists('enabled', $entry) ? (bool) $entry['enabled'] : self::DEFAULTS[$type]['enabled'],
            ];
        }

        return $result;
    }

    /**
     * @param  array<string, array{name?: mixed, language?: mixed, enabled?: mixed}>  $entries
     */
    public static function save(array $entries): void
    {
        $unknown = array_diff(array_keys($entries), self::TYPES);
        if ($unknown !== []) {
            throw ValidationException::withMessages([
                'whatsapp_templates' => 'Unknown WhatsApp template type: '.implode(', ', $unknown),
            ]);
        }

        $current = self::all();

        foreach ($entries as $type => $entry) {
            if (! is_array($entry)) {
                throw ValidationException::withMessages([
                    'whatsapp_templates' => "Invalid entry for template type {$type}.",
                ]);
            }

            $name = trim((string) ($entry['name'] ?? ''));
            if ($name === '' || mb_strlen($name) > 100 || ! preg_match('/^[a-z0-9_]+$/', $name)) {
                throw ValidationException::withMessages([
                    'whatsapp_templates' => "Invalid template name for {$type}.",
                ]);
            }

            $language = trim((string) ($entry['language'] ?? ''));
            if ($language === '' || mb_strlen($language) > 10) {
                throw ValidationException::withMessages([
                    'whatsapp_templates' => "Invalid template language for {$type}.",
                ]);
            }

            $current[$type] = [
                'name' => $name,
                'language' => $language,
                'enabled' => (bool) ($entry['enabled'] ?? false),
            ];
        }

        PlatformSettings::set('whatsapp_templates', $current);
    }
}
