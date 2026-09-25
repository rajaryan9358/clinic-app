<?php

namespace Tests\Feature\Billing;

use App\Services\Billing\RazorpayApiGateway;
use App\Services\Billing\RazorpayGateway;
use App\Support\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RazorpayGatewayTest extends TestCase
{
    use RefreshDatabase;

    public function test_container_binds_api_gateway(): void
    {
        $this->assertInstanceOf(RazorpayApiGateway::class, app(RazorpayGateway::class));
    }

    public function test_not_configured_without_keys(): void
    {
        $this->assertFalse(app(RazorpayGateway::class)->isConfigured());
        PlatformSettings::set('razorpay_key_id', 'rzp_test_x');
        PlatformSettings::set('razorpay_key_secret', 'secret');
        $this->assertTrue(app(RazorpayGateway::class)->isConfigured());
        $this->assertSame('rzp_test_x', app(RazorpayGateway::class)->keyId());
    }

    public function test_webhook_signature_is_hmac_sha256_of_body(): void
    {
        PlatformSettings::set('razorpay_webhook_secret', 'whsec');
        $body = '{"event":"subscription.charged"}';
        $good = hash_hmac('sha256', $body, 'whsec');
        $gw = app(RazorpayGateway::class);
        $this->assertTrue($gw->verifyWebhookSignature($body, $good));
        $this->assertFalse($gw->verifyWebhookSignature($body, 'bad'));
    }

    public function test_payment_signature_is_hmac_of_payment_and_subscription(): void
    {
        PlatformSettings::set('razorpay_key_id', 'rzp_test_x');
        PlatformSettings::set('razorpay_key_secret', 'keysecret');
        $sig = hash_hmac('sha256', 'pay_1|sub_1', 'keysecret');
        $gw = app(RazorpayGateway::class);
        $this->assertTrue($gw->verifyPaymentSignature('pay_1', 'sub_1', $sig));
        $this->assertFalse($gw->verifyPaymentSignature('pay_1', 'sub_1', 'nope'));
    }
}
