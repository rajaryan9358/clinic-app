<?php

namespace App\Services\WhatsApp;

use RuntimeException;
use Throwable;

/**
 * Test double for WhatsAppGateway. Records every sendTemplate() call in
 * $sent and lets tests force a specific failure via $throw, or simulate an
 * unconfigured gateway via $configured.
 */
class FakeWhatsAppGateway implements WhatsAppGateway
{
    public bool $configured = true;

    public ?Throwable $throw = null;

    public array $sent = [];

    public bool $signatureValid = true;

    public function isConfigured(): bool
    {
        return $this->configured;
    }

    public function sendTemplate(string $to, string $templateName, string $language, array $components): string
    {
        if ($this->throw !== null) {
            throw $this->throw;
        }

        if (! $this->configured) {
            throw new RuntimeException('WhatsApp is not configured.');
        }

        $this->sent[] = [
            'to' => $to,
            'template' => $templateName,
            'language' => $language,
            'components' => $components,
        ];

        return 'wamid.fake.'.count($this->sent);
    }

    public function testConnection(): array
    {
        if (! $this->configured) {
            return ['ok' => false, 'message' => 'WhatsApp is not configured.'];
        }

        return ['ok' => true, 'message' => null];
    }

    public function verifySignature(string $rawBody, ?string $signatureHeader): bool
    {
        return $this->signatureValid;
    }
}
