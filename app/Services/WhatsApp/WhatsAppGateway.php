<?php

namespace App\Services\WhatsApp;

interface WhatsAppGateway
{
    public function isConfigured(): bool;

    /** @return string provider message id (wamid) */
    public function sendTemplate(string $to, string $templateName, string $language, array $components): string;

    /** @return array{ok: bool, message: ?string} */
    public function testConnection(): array;

    public function verifySignature(string $rawBody, ?string $signatureHeader): bool;
}
