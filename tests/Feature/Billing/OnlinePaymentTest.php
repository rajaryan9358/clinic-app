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
use Illuminate\Support\Facades\Log;
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

    /** A second issued 801.00 invoice at the same clinic. */
    private function siblingOf(Invoice $invoice): Invoice
    {
        $clinic = Clinic::findOrFail($invoice->clinic_id);

        return $this->invoiceService()->issue(
            $this->invoiceService()->draft($clinic->id, $this->draftData($this->makeBillingPatient($clinic))),
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

    /** Asserts a Log::warning whose message contains $needle. */
    private function assertWarned(string $needle, ?\Closure $contextCheck = null): void
    {
        Log::shouldHaveReceived('warning')->withArgs(
            fn ($message, $context = []) => str_contains((string) $message, $needle)
                && ($contextCheck === null || $contextCheck($context)),
        )->atLeast()->once();
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

    public function test_start_order_supersedes_the_pending_order_when_the_outstanding_changed(): void
    {
        $invoice = $this->issued();
        $stale = $this->payments()->startOrder($invoice);

        $this->invoiceService()->recordPayment($invoice, ['amount' => 300, 'payment_method' => 'cash']);
        $fresh = $this->payments()->startOrder($invoice);

        $this->assertNotSame($stale['order_id'], $fresh['order_id']);
        $this->assertSame(501.00, $fresh['amount']);
        $this->assertSame(50100, $this->gw->createdOrders[1]['amountInPaise']);

        // Exactly one live order per invoice: the old one is superseded, but keeps
        // its order id so a late capture on it still resolves.
        $superseded = Payment::where('razorpay_order_id', $stale['order_id'])->sole();
        $this->assertSame('failed', $superseded->status);
        $this->assertStringContainsString('uperseded', (string) $superseded->notes);
        $this->assertSame($stale['order_id'], $superseded->razorpay_order_id);
        $this->assertSame(1, Payment::where('status', 'pending')->count());
        $this->assertSame(300.0, $this->invoiceService()->amountPaid($invoice));
    }

    public function test_a_capture_on_a_superseded_order_is_still_banked_and_logged(): void
    {
        $invoice = $this->issued();
        $stale = $this->payments()->startOrder($invoice);
        $this->invoiceService()->recordPayment($invoice, ['amount' => 300, 'payment_method' => 'cash']);
        $this->payments()->startOrder($invoice);

        Log::spy();
        $this->sendWebhook($this->captureEvent($invoice, $stale['order_id'], 'pay_old'))->assertOk();

        $banked = Payment::where('razorpay_order_id', $stale['order_id'])->sole();
        $this->assertSame(['success', 'pay_old', '801.00'], [$banked->status, $banked->razorpay_payment_id, $banked->amount]);
        $this->assertSame(1101.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('paid', $invoice->fresh()->status);
        $this->assertWarned('superseded', fn ($c) => ($c['payment_id'] ?? null) === 'pay_old');
    }

    public function test_start_order_does_not_hold_the_invoice_lock_across_the_gateway_call(): void
    {
        // A hanging gateway must not block every payment operation on the invoice,
        // and a rollback must not be able to orphan an order that was created.
        $gateway = new class extends FakeRazorpayGateway
        {
            public array $levels = [];

            public function createOrder(int $amountInPaise, string $receipt, array $notes): array
            {
                $this->levels[] = DB::transactionLevel();

                return parent::createOrder($amountInPaise, $receipt, $notes);
            }
        };
        $this->app->instance(RazorpayGateway::class, $gateway);

        $invoice = $this->issued();
        $baseline = DB::transactionLevel();   // RefreshDatabase wraps each test in one transaction
        $this->payments()->startOrder($invoice);

        $this->assertSame([$baseline], $gateway->levels);
        $this->assertSame('pending', Payment::sole()->status);
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

    public function test_confirm_rejects_an_order_that_is_not_open_on_this_invoice(): void
    {
        $invoice = $this->issued();
        $elsewhere = $this->payments()->startOrder($this->siblingOf($invoice));

        // A valid signature over somebody else's order settles nothing here.
        $this->assertValidationMessage('That payment order is not open on this invoice.',
            fn () => $this->payments()->confirm($invoice, $elsewhere['order_id'], 'pay_1', 'sig'));

        $this->assertSame('pending', Payment::where('razorpay_order_id', $elsewhere['order_id'])->sole()->status);
        $this->assertSame(0.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('issued', $invoice->fresh()->status);
    }

    public function test_confirm_banks_a_capture_beyond_the_outstanding_and_leaves_a_negative_balance(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);

        // Counter cash after the order was raised: the money still moved at Razorpay,
        // so it is banked and the excess shows up as a negative balance.
        $this->invoiceService()->recordPayment($invoice, ['amount' => 300, 'payment_method' => 'cash']);

        $payment = $this->payments()->confirm($invoice, $order['order_id'], 'pay_1', 'sig');

        $this->assertSame(['success', '801.00', 'pay_1'], [$payment->status, $payment->amount, $payment->razorpay_payment_id]);
        $this->assertSame(1101.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('paid', $invoice->fresh()->status);
        $this->assertSame(-300.0, round(801 - $this->invoiceService()->amountPaid($invoice), 2));
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

        // The webhook usually beats the browser back. Confirming what it already
        // banked hands the settled payment over - it is not a second charge, and
        // it is not an error the patient should ever see.
        $again = $this->payments()->confirm($invoice, $order['order_id'], 'pay_1', 'sig');

        $this->assertSame(['success', 'pay_1'], [$again->status, $again->razorpay_payment_id]);
        $this->assertSame(1, Payment::where('status', 'success')->count());
        $this->assertSame(1, Payment::count());
        $this->assertSame(801.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('paid', $invoice->fresh()->status);
    }

    public function test_confirming_a_payment_banked_against_another_invoice_is_409(): void
    {
        $invoice = $this->issued();
        $other = $this->siblingOf($invoice);   // same clinic, different invoice
        $mine = $this->payments()->startOrder($invoice);
        $theirs = $this->payments()->startOrder($other);

        $this->payments()->confirm($other, $theirs['order_id'], 'pay_1', 'sig');

        try {
            $this->payments()->confirm($invoice, $mine['order_id'], 'pay_1', 'sig');
            $this->fail('Expected a 409 conflict.');
        } catch (ConflictHttpException $e) {
            $this->assertSame('This payment has already been recorded.', $e->getMessage());
            $this->assertSame(409, $e->getStatusCode());
        }

        $this->assertSame(1, Payment::where('status', 'success')->count());
        $this->assertSame(0.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('issued', $invoice->fresh()->status);
    }

    public function test_replayed_capture_is_a_no_op(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);
        $event = $this->captureEvent($invoice, $order['order_id'], 'pay_1');
        $entity = $event['payload']['payment']['entity'];

        $this->sendWebhook($event, 'evt_same')->assertOk();
        $this->sendWebhook($event, 'evt_same')->assertOk();   // duplicate delivery
        $this->sendWebhook($event, 'evt_other')->assertOk();  // same payment, fresh event id

        $this->assertSame(1, Payment::count());
        $payment = Payment::sole();
        $this->assertSame(['success', 'pay_1', '801.00'], [$payment->status, $payment->razorpay_payment_id, $payment->amount]);
        $this->assertSame(801.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('paid', $invoice->fresh()->status);

        // The replay must be resolved by razorpay_payment_id and hand that row
        // back - not fall through to the status guard and report nothing settled.
        $replayed = $this->payments()->settleFromWebhook($entity);
        $this->assertNotNull($replayed);
        $this->assertSame($payment->id, $replayed->id);
        $this->assertSame('pay_1', $replayed->razorpay_payment_id);
    }

    public function test_a_second_capture_on_a_settled_order_cannot_overwrite_its_payment_id(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);
        $this->sendWebhook($this->captureEvent($invoice, $order['order_id'], 'pay_1'))->assertOk();

        // Same order, a different payment id: the money is already banked, and the
        // audit trail must keep pointing at the capture that paid for it.
        $this->sendWebhook($this->captureEvent($invoice, $order['order_id'], 'pay_2'))->assertOk();

        $payment = Payment::sole();
        $this->assertSame('pay_1', $payment->razorpay_payment_id);
        $this->assertSame('success', $payment->status);
        $this->assertSame(801.0, $this->invoiceService()->amountPaid($invoice));
    }

    public function test_an_authorized_or_failed_payment_event_banks_nothing(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);

        // Razorpay emits payment.authorized before payment.captured: authorised
        // money is not captured money, and must not mark the invoice paid.
        foreach (['payment.authorized', 'payment.failed'] as $event) {
            $payload = $this->captureEvent($invoice, $order['order_id'], 'pay_1');
            $payload['event'] = $event;
            $this->sendWebhook($payload)->assertOk();
        }

        $payment = Payment::sole();
        $this->assertSame('pending', $payment->status);
        $this->assertNull($payment->razorpay_payment_id);
        $this->assertSame(0.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('issued', $invoice->fresh()->status);
    }

    public function test_a_malformed_payment_entity_is_ignored_with_a_200(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);

        // A non-2xx would have Razorpay retry for ever, and the rolled-back
        // dedupe row would let every retry hit the same failure.
        foreach ([['id' => ['nested' => 'x']], ['order_id' => ['nested' => 'x']], ['id' => null, 'order_id' => null]] as $i => $broken) {
            $payload = $this->captureEvent($invoice, $order['order_id'], 'pay_1');
            $payload['payload']['payment']['entity'] = array_merge($payload['payload']['payment']['entity'], $broken);
            $this->sendWebhook($payload, 'evt_broken_'.$i)->assertOk();
        }

        $payment = Payment::sole();
        $this->assertSame('pending', $payment->status);
        $this->assertNull($payment->razorpay_payment_id);
        $this->assertSame(0.0, $this->invoiceService()->amountPaid($invoice));
    }

    public function test_a_capture_whose_notes_are_not_an_array_still_settles(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);

        $payload = $this->captureEvent($invoice, $order['order_id'], 'pay_1');
        $payload['payload']['payment']['entity']['notes'] = 'not-an-array';
        $this->sendWebhook($payload)->assertOk();

        // No clinic hint, so the order id alone resolves the row - and no crash.
        $this->assertSame('success', Payment::sole()->status);
        $this->assertSame(801.0, $this->invoiceService()->amountPaid($invoice));
    }

    public function test_a_capture_on_a_cancelled_invoice_is_banked_and_logged(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);
        $this->invoiceService()->cancel($invoice, 'duplicate');   // a pending row is not money, so this is allowed

        Log::spy();
        $this->sendWebhook($this->captureEvent($invoice, $order['order_id'], 'pay_1'))->assertOk();

        // The money is real, so it is banked - but the clinic is now holding
        // patient money against a void invoice, which has to be greppable.
        $payment = Payment::sole();
        $this->assertSame(['success', 'pay_1', '801.00'], [$payment->status, $payment->razorpay_payment_id, $payment->amount]);
        $this->assertSame(801.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('cancelled', $invoice->fresh()->status);
        $this->assertWarned('not open', fn ($c) => ($c['invoice_id'] ?? null) === $invoice->id
            && ($c['payment_id'] ?? null) === 'pay_1'
            && ($c['amount'] ?? null) === 801.0
            && ($c['invoice_status'] ?? null) === 'cancelled');
    }

    public function test_confirm_does_not_hand_back_a_refunded_payment(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);
        $payment = $this->payments()->confirm($invoice, $order['order_id'], 'pay_1', 'sig');
        $this->invoiceService()->markRefunded($payment, 'patient asked');

        // Handing a refunded row back as a success would have the portal render
        // an unpaid invoice as paid.
        try {
            $this->payments()->confirm($invoice, $order['order_id'], 'pay_1', 'sig');
            $this->fail('Expected a 409 conflict.');
        } catch (ConflictHttpException $e) {
            $this->assertSame('This payment has already been recorded.', $e->getMessage());
        }

        $this->assertSame('refunded', Payment::sole()->status);
        $this->assertSame(0.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('issued', $invoice->fresh()->status);
    }

    public function test_a_capture_without_an_amount_is_not_banked(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);

        $payload = $this->captureEvent($invoice, $order['order_id'], 'pay_1');
        unset($payload['payload']['payment']['entity']['amount']);
        $this->sendWebhook($payload)->assertOk();

        $payment = Payment::sole();
        $this->assertSame('pending', $payment->status);
        $this->assertNull($payment->razorpay_payment_id);
        $this->assertSame(0.0, $this->invoiceService()->amountPaid($invoice));
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

    public function test_a_capture_beyond_the_outstanding_is_still_banked(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);
        $this->invoiceService()->recordPayment($invoice, ['amount' => 300, 'payment_method' => 'cash']);

        $this->sendWebhook($this->captureEvent($invoice, $order['order_id'], 'pay_1'))->assertOk();

        $online = Payment::where('razorpay_order_id', $order['order_id'])->sole();
        $this->assertSame(['success', 'pay_1'], [$online->status, $online->razorpay_payment_id]);
        $this->assertSame(1101.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('paid', $invoice->fresh()->status);
        $this->assertSame(-300.0, round(801 - $this->invoiceService()->amountPaid($invoice), 2));
    }

    public function test_a_capture_for_an_amount_the_order_was_not_raised_for_is_not_banked(): void
    {
        $invoice = $this->issued();
        $order = $this->payments()->startOrder($invoice);

        // Anti-tamper: a 1-rupee capture must never settle an 801-rupee order.
        $this->sendWebhook($this->captureEvent($invoice, $order['order_id'], 'pay_1', 100))->assertOk();

        $online = Payment::where('razorpay_order_id', $order['order_id'])->sole();
        $this->assertSame('pending', $online->status);
        $this->assertNull($online->razorpay_payment_id);
        $this->assertSame(0.0, $this->invoiceService()->amountPaid($invoice));
        $this->assertSame('issued', $invoice->fresh()->status);
    }

    /** @return array{0:ClinicSubscription, 1:array} a pending subscription and a charged payload for it */
    private function subscriptionCharge(array $paymentExtra = []): array
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'sub-'.Str::random(6), 'status' => 'active']);
        $plan = Plan::create(['name' => 'Starter', 'monthly_price' => 99900]);
        $sub = ClinicSubscription::create(['clinic_id' => $clinic->id, 'plan_id' => $plan->id, 'billing_cycle' => 'monthly',
            'status' => 'pending_payment', 'grace_ends_at' => now()->addDay(), 'razorpay_subscription_id' => 'sub_1']);

        return [$sub, ['event' => 'subscription.charged', 'payload' => [
            'subscription' => ['entity' => ['id' => 'sub_1', 'status' => 'active',
                'current_start' => now()->timestamp, 'current_end' => now()->addMonth()->timestamp]],
            'payment' => ['entity' => array_merge(
                ['id' => 'pay_sub_1', 'amount' => 99900, 'method' => 'upi', 'order_id' => 'order_sub_1'],
                $paymentExtra,
            )],
        ]]];
    }

    public function test_subscription_webhooks_still_reach_the_subscription_handler(): void
    {
        [$sub, $payload] = $this->subscriptionCharge();

        $this->sendWebhook($payload)->assertOk();

        $this->assertSame('active', $sub->refresh()->status);
        $this->assertSame(1, SubscriptionTransaction::count());
        $this->assertSame(0, Payment::count());
    }

    public function test_a_subscription_charge_carrying_an_invoice_note_still_reaches_the_subscription_handler(): void
    {
        // An invoice_id note must never be enough to steal an event that carries
        // a subscription entity - that would silently drop the clinic's charge.
        [$sub, $payload] = $this->subscriptionCharge(['notes' => ['invoice_id' => '1', 'clinic_id' => '1']]);

        $this->sendWebhook($payload)->assertOk();

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
