<?php

namespace Tests\Feature\WhatsApp;

use App\Services\WhatsApp\MetaWhatsAppGateway;
use App\Support\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Tests\TestCase;

class MetaGatewayTest extends TestCase
{
    use RefreshDatabase;

    private function configure(): void
    {
        PlatformSettings::set('whatsapp_phone_number_id', '1234567890');
        PlatformSettings::set('whatsapp_access_token', 'test-access-token');
        PlatformSettings::set('whatsapp_graph_version', 'v21.0');
    }

    public function test_send_template_posts_to_graph_api_and_returns_message_id(): void
    {
        $this->configure();

        Http::fake([
            'graph.facebook.com/*' => Http::response(['messages' => [['id' => 'wamid.X']]], 200),
        ]);

        $components = [['type' => 'body', 'parameters' => [['type' => 'text', 'text' => 'A']]]];

        $gateway = new MetaWhatsAppGateway();
        $id = $gateway->sendTemplate('919876543210', 'booking_confirmed', 'en', $components);

        $this->assertSame('wamid.X', $id);

        Http::assertSent(function (HttpRequest $request) use ($components) {
            return $request->url() === 'https://graph.facebook.com/v21.0/1234567890/messages'
                && $request->hasHeader('Authorization', 'Bearer test-access-token')
                && $request['messaging_product'] === 'whatsapp'
                && $request['to'] === '919876543210'
                && $request['type'] === 'template'
                && $request['template']['name'] === 'booking_confirmed'
                && $request['template']['language']['code'] === 'en'
                && $request['template']['components'] === $components;
        });
    }

    public function test_send_template_throws_when_graph_api_rejects_the_message(): void
    {
        $this->configure();

        Http::fake([
            'graph.facebook.com/*' => Http::response(['error' => ['message' => 'Invalid parameter']], 400),
        ]);

        $gateway = new MetaWhatsAppGateway();

        try {
            $gateway->sendTemplate('919876543210', 'booking_confirmed', 'en', []);
            $this->fail('Expected RuntimeException was not thrown.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('400', $e->getMessage());
        }
    }

    public function test_is_configured_reflects_settings(): void
    {
        $gateway = new MetaWhatsAppGateway();
        $this->assertFalse($gateway->isConfigured());

        $this->configure();
        $this->assertTrue($gateway->isConfigured());
    }

    public function test_verify_signature_matches_valid_hmac(): void
    {
        PlatformSettings::set('whatsapp_app_secret', 'shh-secret');
        $body = '{"entry":[]}';
        $signature = 'sha256='.hash_hmac('sha256', $body, 'shh-secret');

        $gateway = new MetaWhatsAppGateway();
        $this->assertTrue($gateway->verifySignature($body, $signature));
    }

    public function test_verify_signature_rejects_wrong_hmac(): void
    {
        PlatformSettings::set('whatsapp_app_secret', 'shh-secret');
        $body = '{"entry":[]}';
        $wrongSignature = 'sha256='.hash_hmac('sha256', $body, 'wrong-secret');

        $gateway = new MetaWhatsAppGateway();
        $this->assertFalse($gateway->verifySignature($body, $wrongSignature));
    }

    public function test_verify_signature_rejects_when_no_secret_configured(): void
    {
        $body = '{"entry":[]}';
        $signature = 'sha256='.hash_hmac('sha256', $body, 'irrelevant');

        $gateway = new MetaWhatsAppGateway();
        $this->assertFalse($gateway->verifySignature($body, $signature));
    }
}
