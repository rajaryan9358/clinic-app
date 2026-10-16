<?php

namespace Tests\Feature\Billing;

use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\Plan;
use App\Models\SubscriptionTransaction;
use App\Services\Billing\FakeRazorpayGateway;
use App\Services\Billing\PatientPaymentService;
use App\Services\Billing\RazorpayGateway;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\Grammars\SQLiteGrammar;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Tests\TestCase;

class OnlinePaymentTest extends TestCase
{
    use BillingTestHelpers, RefreshDatabase;

    private FakeRazorpayGateway $gw;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-16 10:00:00'));
        $this->gw = new FakeRazorpayGateway;
        $this->app->instance(RazorpayGateway::class, $this->gw);
    }

    private function payments(): PatientPaymentService
    {
        return app(PatientPaymentService::class);
    }

    /** An issued 801.00 invoice at a clinic with online payment switched on. */
    private function issued(array $settings = []): Invoice
    {
        $clinic = $this->makeBillingClinic(array_merge(['online_payment_enabled' => true], $settings));
        $patient = $this->makeBillingPatient($clinic);

        return $this->invoiceService()->issue(
            $this->invoiceService()->draft($clinic->id, $this->draftData($patient)),
        );
    }

    /** @return \Illuminate\Testing\TestResponse */
    private function sendWebhook(array $payload, ?string $eventId = null)
    {
        return $this->call('POST', '/api/webhooks/razorpay', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_RAZORPAY_SIGNATURE' => 'sig',
            'HTTP_X_RAZORPAY_EVENT_ID' => $eventId ?? 'evt_'.Str::random(10),
        ], json_encode($payload));
    }

    private function captureEvent(Invoice $invoice, string $orderId, string $paymentId, ?int $paise = null): array
    {
        return ['event' => 'payment.captured', 'payload' => ['payment' => ['entity' => [
            'id' => $paymentId,
            'order_id' => $orderId,
            'amount' => $paise ?? (int) round((float) $invoice->total_amount * 100),
            'currency' => 'INR',
            'status' => 'captured',
            'method' => 'upi',
            'notes' => ['invoice_id' => (string) $invoice->id, 'clinic_id' => (string) $invoice->clinic_id],
        ]]]];
    }

    public function test_start_order_creates_a_pending_payment_for_the_outstanding_amount(): void
    {
        $invoice = $this->issued();

        $order = $this->payments()->startOrder($invoice);

        $this->assertSame('order_fake_1', $order['order_id']);
        $this->assertSame(801.00, $order['amount']);
        $this->assertSame('INR', $order['currency']);
        $this->assertSame('rzp_test_fake', $order['key_id']);
        $this->assertSame('INV/2026-27/00001', $order['invoice_number']);

        // Paise only at the gateway boundary, and never a float.
        $this->assertCount(1, $this->gw->createdOrders);
        $this->assertSame(80100, $this->gw->createdOrders[0]['amountInPaise']);
        $this->assertIsInt($this->gw->createdOrders[0]['amountInPaise']);
        $this->assertSame($invoice->id, (int) $this->gw->createdOrders[0]['notes']['invoice_id']);
        $this->assertSame($invoice->clinic_id, (int) $this->gw->createdOrders[0]['notes']['clinic_id']);

        $payment = Payment::sole();
        $this->assertSame(['pending', 'online', '801.00', 'order_fake_1'],
            [$payment->status, $payment->payment_method, $payment->amount, $payment->razorpay_order_id]);
        $this->assertNull($payment->razorpay_payment_id);

        // A pending row is not money: the invoice is untouched.
        $this->assertSame(0.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('issued', $invoice->fresh()->status);
    }

    public function test_start_order_reuses_the_pending_order(): void
    {
        $invoice = $this->issued();

        $first = $this->payments()->startOrder($invoice);
        $second = $this->payments()->startOrder($invoice);

        $this->assertSame($first['order_id'], $second['order_id']);
        $this->assertCount(1, $this->gw->createdOrders);
        $this->assertSame(1, Payment::count());
    }

    public function test_start_order_does_not_reuse_a_pending_order_for_a_stale_amount(): void
    {
        $invoice = $this->issued();
        $stale = $this->payments()->startOrder($invoice);

        $this->invoiceService()->recordPayment($invoice, ['amount' => 300, 'payment_method' => 'cash']);
        $fresh = $this->payments()->startOrder($invoice);

        $this->assertNotSame($stale['order_id'], $fresh['order_id']);
        $this->assertSame(501.00, $fresh['amount']);
        $this->assertSame(50100, $this->gw->createdOrders[1]['amountInPaise']);
        // The stale row is left pending (it still resolves a late webhook) and counts for nothing.
        $this->assertSame(2, Payment::where('status', 'pending')->count());
        $this->assertSame(300.0, $this->invoiceService()->amountPaid($invoice));
    }

    public function test_start_order_is_422_when_online_payment_is_disabled(): void
    {
        $invoice = $this->issued(['online_payment_enabled' => false]);

        $this->assertValidationMessage('Online payment is not available at this clinic.',
            fn () => $this->payments()->startOrder($invoice));
        $this->assertSame(0, Payment::count());
        $this->assertSame([], $this->gw->createdOrders);
    }

    public function test_start_order_is_422_when_the_gateway_is_unconfigured(): void
    {
        $this->gw->configured = false;
        $invoice = $this->issued();

        $this->assertValidationMessage('Online payment is not available at this clinic.',
            fn () => $this->payments()->startOrder($invoice));
        $this->assertSame(0, Payment::count());
    }

    public function test_confirm_with_a_bad_signature_leaves_the_payment_pending(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);
        $this->gw->signatureValid = false;

        $this->assertValidationMessage('This payment could not be verified.',
            fn () => $this->payments()->confirm($invoice, $order['order_id'], 'pay_1', 'bad'));

        $payment = Payment::sole();
        $this->assertSame('pending', $payment->status);
        $this->assertNull($payment->razorpay_payment_id);
        $this->assertSame('issued', $invoice->fresh()->status);
    }

    public function test_confirm_rejects_an_amount_that_does_not_match(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);

        // Counter cash after the order was raised: the order is now worth more than is owed.
        $this->invoiceService()->recordPayment($invoice, ['amount' => 300, 'payment_method' => 'cash']);

        $this->assertValidationMessage('That is more than the amount outstanding.',
            fn () => $this->payments()->confirm($invoice, $order['order_id'], 'pay_1', 'sig'));

        $online = Payment::where('razorpay_order_id', $order['order_id'])->sole();
        $this->assertSame('pending', $online->status);
        $this->assertNull($online->razorpay_payment_id);
        $this->assertSame(300.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('issued', $invoice->fresh()->status);
    }

    public function test_confirm_settles_and_marks_the_invoice_paid(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);

        $payment = $this->payments()->confirm($invoice, $order['order_id'], 'pay_1', 'sig');

        $this->assertSame(['success', 'online', '801.00', 'pay_1'],
            [$payment->status, $payment->payment_method, $payment->amount, $payment->razorpay_payment_id]);
        $this->assertNotNull($payment->paid_at);
        $this->assertSame(1, Payment::count());
        $this->assertSame('paid', $invoice->fresh()->status);
        $this->assertSame(801.0, $this->invoiceService()->amountPaid($invoice));
    }

    public function test_confirm_and_webhook_settle_the_same_payment_once(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);

        $this->payments()->confirm($invoice, $order['order_id'], 'pay_1', 'sig');
        $this->sendWebhook($this->captureEvent($invoice, $order['order_id'], 'pay_1'))->assertOk();

        $this->assertSame(1, Payment::count());
        $this->assertSame(801.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('paid', $invoice->fresh()->status);

        // The browser confirming a payment the webhook already banked is a conflict, not a second charge.
        try {
            $this->payments()->confirm($invoice, $order['order_id'], 'pay_1', 'sig');
            $this->fail('Expected a 409 conflict.');
        } catch (ConflictHttpException $e) {
            $this->assertSame('This payment has already been recorded.', $e->getMessage());
        }

        $this->assertSame(1, Payment::count());
        $this->assertSame(801.0, $this->invoiceService()->amountPaid($invoice));
    }

    public function test_replayed_capture_is_a_no_op(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);
        $event = $this->captureEvent($invoice, $order['order_id'], 'pay_1');

        $this->sendWebhook($event, 'evt_same')->assertOk();
        $this->sendWebhook($event, 'evt_same')->assertOk();   // duplicate delivery
        $this->sendWebhook($event, 'evt_other')->assertOk();  // same payment, fresh event id

        $this->assertSame(1, Payment::count());
        $payment = Payment::sole();
        $this->assertSame(['success', 'pay_1', '801.00'], [$payment->status, $payment->razorpay_payment_id, $payment->amount]);
        $this->assertSame(801.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('paid', $invoice->fresh()->status);
    }

    public function test_webhook_for_an_unknown_order_is_ignored(): void
    {
        $invoice = $this->issued();
        $this->payments()->startOrder($invoice);

        $this->sendWebhook($this->captureEvent($invoice, 'order_not_ours', 'pay_x'))->assertOk();

        $payment = Payment::sole();
        $this->assertSame('pending', $payment->status);
        $this->assertNull($payment->razorpay_payment_id);
        $this->assertSame('issued', $invoice->fresh()->status);
    }

    public function test_a_capture_for_more_than_is_outstanding_is_not_banked(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);
        $this->invoiceService()->recordPayment($invoice, ['amount' => 300, 'payment_method' => 'cash']);

        $this->sendWebhook($this->captureEvent($invoice, $order['order_id'], 'pay_1'))->assertOk();

        $online = Payment::where('razorpay_order_id', $order['order_id'])->sole();
        $this->assertSame('pending', $online->status);
        $this->assertSame(300.0, $this->invoiceService()->amountPaid($invoice));
    }

    public function test_subscription_webhooks_still_reach_the_subscription_handler(): void
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'sub-c', 'status' => 'active']);
        $plan = Plan::create(['name' => 'Starter', 'monthly_price' => 99900]);
        $sub = ClinicSubscription::create(['clinic_id' => $clinic->id, 'plan_id' => $plan->id, 'billing_cycle' => 'monthly',
            'status' => 'pending_payment', 'grace_ends_at' => now()->addDay(), 'razorpay_subscription_id' => 'sub_1']);

        $this->sendWebhook(['event' => 'subscription.charged', 'payload' => [
            'subscription' => ['entity' => ['id' => 'sub_1', 'status' => 'active',
                'current_start' => now()->timestamp, 'current_end' => now()->addMonth()->timestamp]],
            'payment' => ['entity' => ['id' => 'pay_sub_1', 'amount' => 99900, 'method' => 'upi', 'order_id' => 'order_sub_1']],
        ]])->assertOk();

        $this->assertSame('active', $sub->refresh()->status);
        $this->assertSame(1, SubscriptionTransaction::count());
        $this->assertSame(0, Payment::count());
    }

    public function test_online_payment_mutations_lock_the_invoice_row(): void
    {
        // sqlite compiles FOR UPDATE to nothing, so record which tables are
        // selected with a lock instead of inspecting the SQL text.
        $locked = new \ArrayObject;
        $grammar = new class(DB::connection(), $locked) extends SQLiteGrammar
        {
            public function __construct($connection, private \ArrayObject $locked)
            {
                parent::__construct($connection);
            }

            protected function compileLock(Builder $query, $value)
            {
                if ($value) {
                    $this->locked[] = $query->from;
                }

                return parent::compileLock($query, $value);
            }
        };
        DB::connection()->setQueryGrammar($grammar);

        $invoice = $this->issued();

        $locked->exchangeArray([]);
        $order = $this->payments()->startOrder($invoice);
        $this->assertContains('invoices', $locked->getArrayCopy());

        $locked->exchangeArray([]);
        $this->payments()->confirm($invoice, $order['order_id'], 'pay_1', 'sig');
        $this->assertContains('invoices', $locked->getArrayCopy());

        $second = $this->issued();
        $order2 = $this->payments()->startOrder($second);
        $locked->exchangeArray([]);
        $this->payments()->settleFromWebhook([
            'id' => 'pay_2', 'order_id' => $order2['order_id'], 'amount' => 80100,
            'notes' => ['invoice_id' => (string) $second->id, 'clinic_id' => (string) $second->clinic_id],
        ]);
        $this->assertContains('invoices', $locked->getArrayCopy());
        $this->assertSame('paid', $second->fresh()->status);
    }
}
