<?php
// tests/Feature/Billing/RazorpayWebhookTest.php
namespace Tests\Feature\Billing;

use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Plan;
use App\Models\SubscriptionTransaction;
use App\Services\Billing\FakeRazorpayGateway;
use App\Services\Billing\RazorpayGateway;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class RazorpayWebhookTest extends TestCase
{
    use RefreshDatabase;

    private FakeRazorpayGateway $gw;
    private ClinicSubscription $sub;

    protected function setUp(): void
    {
        parent::setUp();
        $this->gw = new FakeRazorpayGateway();
        $this->app->instance(RazorpayGateway::class, $this->gw);
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
        $plan = Plan::create(['name' => 'Starter', 'monthly_price' => 99900]);
        $this->sub = ClinicSubscription::create(['clinic_id' => $clinic->id, 'plan_id' => $plan->id, 'billing_cycle' => 'monthly',
            'status' => 'pending_payment', 'grace_ends_at' => now()->addDay(), 'razorpay_subscription_id' => 'sub_1']);
    }

    private function send(string $event, array $payload, string $eventId = null)
    {
        return $this->call('POST', '/api/webhooks/razorpay', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_RAZORPAY_SIGNATURE' => 'sig',
            'HTTP_X_RAZORPAY_EVENT_ID' => $eventId ?? 'evt_'.Str::random(8),
        ], json_encode(['event' => $event, 'payload' => $payload]));
    }

    private function subEntity(array $extra = []): array
    {
        return ['subscription' => ['entity' => array_merge(['id' => 'sub_1', 'status' => 'active',
            'current_start' => now()->timestamp, 'current_end' => now()->addMonth()->timestamp], $extra)]];
    }

    public function test_bad_signature_is_400(): void
    {
        $this->gw->signatureValid = false;
        $this->send('subscription.activated', $this->subEntity())->assertStatus(400);
        $this->assertSame('pending_payment', $this->sub->refresh()->status);
    }

    public function test_activated_webhook_alone_activates_clinic(): void
    {
        $this->send('subscription.activated', $this->subEntity())->assertOk();
        $this->sub->refresh();
        $this->assertSame('active', $this->sub->status);
        $this->assertNull($this->sub->grace_ends_at);
        $this->assertNotNull($this->sub->current_period_end);
    }

    public function test_charged_records_one_transaction_per_payment_and_is_idempotent(): void
    {
        $payload = $this->subEntity() + ['payment' => ['entity' => ['id' => 'pay_1', 'amount' => 99900, 'method' => 'upi', 'invoice_id' => 'inv_1']]];
        $this->send('subscription.charged', $payload, 'evt_same')->assertOk();
        $this->send('subscription.charged', $payload, 'evt_same')->assertOk();        // duplicate delivery
        $this->send('subscription.charged', $payload, 'evt_other')->assertOk();       // same payment, new event id

        $this->assertSame(1, SubscriptionTransaction::count());
        $tx = SubscriptionTransaction::first();
        $this->assertSame(['captured', 'razorpay', 99900, 'upi', 'inv_1'], [$tx->status, $tx->source, $tx->amount, $tx->method, $tx->razorpay_invoice_id]);
        $this->assertSame('active', $this->sub->refresh()->status);
    }

    public function test_pending_and_halted_start_grace(): void
    {
        $this->sub->update(['status' => 'active', 'grace_ends_at' => null]);
        $this->send('subscription.pending', $this->subEntity(['status' => 'pending']))->assertOk();
        $this->sub->refresh();
        $this->assertSame('past_due', $this->sub->status);
        $this->assertNotNull($this->sub->grace_ends_at);

        $grace = $this->sub->grace_ends_at->timestamp;
        $this->send('subscription.halted', $this->subEntity(['status' => 'halted']))->assertOk();
        $this->assertSame($grace, $this->sub->refresh()->grace_ends_at->timestamp); // not pushed out
    }

    public function test_cancelled_and_completed(): void
    {
        $this->send('subscription.cancelled', $this->subEntity(['status' => 'cancelled']))->assertOk();
        $this->assertSame('cancelled', $this->sub->refresh()->status);
        $this->assertNotNull($this->sub->cancelled_at);

        $this->send('subscription.completed', $this->subEntity(['status' => 'completed']))->assertOk();
        $this->assertSame('expired', $this->sub->refresh()->status);
    }

    public function test_payment_failed_records_failed_transaction(): void
    {
        $this->send('payment.failed', ['payment' => ['entity' => ['id' => 'pay_f', 'amount' => 99900, 'method' => 'card',
            'error_description' => 'Card declined', 'notes' => ['subscription_id' => 'sub_1']]]])->assertOk();
        $tx = SubscriptionTransaction::where('razorpay_payment_id', 'pay_f')->firstOrFail();
        $this->assertSame(['failed', 'Card declined'], [$tx->status, $tx->failure_reason]);
    }

    public function test_unknown_subscription_is_ignored_with_200(): void
    {
        $this->send('subscription.activated', ['subscription' => ['entity' => ['id' => 'sub_unknown', 'status' => 'active']]])->assertOk();
        $this->assertSame('pending_payment', $this->sub->refresh()->status);
    }
}
