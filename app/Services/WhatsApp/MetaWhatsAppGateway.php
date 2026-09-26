<?php

namespace App\Services\WhatsApp;

use App\Support\PlatformSettings;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class MetaWhatsAppGateway implements WhatsAppGateway
{
    private function setting(string $key, mixed $default = null): mixed
    {
        return PlatformSettings::get($key, $default);
    }

    private function base(): string
    {
        return 'https://graph.facebook.com/'.$this->setting('whatsapp_graph_version', 'v21.0');
    }

    public function isConfigured(): bool
    {
        return filled($this->setting('whatsapp_phone_number_id')) && filled($this->setting('whatsapp_access_token'));
    }

    public function sendTemplate(string $to, string $templateName, string $language, array $components): string
    {
        if (! $this->isConfigured()) {
            throw new RuntimeException('WhatsApp is not configured.');
        }

        $res = Http::withToken((string) $this->setting('whatsapp_access_token'))
            ->acceptJson()->timeout(15)
            ->post($this->base().'/'.$this->setting('whatsapp_phone_number_id').'/messages', [
                'messaging_product' => 'whatsapp',
                'to' => $to,
                'type' => 'template',
                'template' => ['name' => $templateName, 'language' => ['code' => $language], 'components' => $components],
            ]);

        if (! $res->successful()) {
            throw new RuntimeException("WhatsApp API rejected the message ({$res->status()}): ".mb_substr($res->body(), 0, 300));
        }

        $id = $res->json('messages.0.id');
        if (! $id) {
            throw new RuntimeException('WhatsApp API returned no message id.');
        }

        return (string) $id;
    }

    public function testConnection(): array
    {
        if (! $this->isConfigured()) {
            return ['ok' => false, 'message' => 'WhatsApp is not configured.'];
        }

        $res = Http::withToken((string) $this->setting('whatsapp_access_token'))->acceptJson()->timeout(10)
            ->get($this->base().'/'.$this->setting('whatsapp_phone_number_id'), ['fields' => 'id']);

        return $res->successful() ? ['ok' => true, 'message' => null]
            : ['ok' => false, 'message' => "Meta returned {$res->status()}: ".mb_substr($res->body(), 0, 200)];
    }

    public function verifySignature(string $rawBody, ?string $signatureHeader): bool
    {
        $secret = (string) $this->setting('whatsapp_app_secret', '');
        if ($secret === '' || ! $signatureHeader || ! str_starts_with($signatureHeader, 'sha256=')) {
            return false;
        }

        return hash_equals(hash_hmac('sha256', $rawBody, $secret), substr($signatureHeader, 7));
    }
}
