<?php

namespace Tests\Feature\Billing;

use App\Models\Appointment;
use App\Models\Invoice;
use App\Models\Payment;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\Grammars\SQLiteGrammar;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class InvoicePaymentTest extends TestCase
{
    use BillingTestHelpers, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-16 10:00:00'));
    }

    /**
     * Issued invoice of 801.00 (no tax) with an appointment.
     *
     * @return array{0:Invoice,1:Appointment}
     */
    private function issuedWithAppointment(array $draftOverrides = []): array
    {
        $clinic = $this->makeBillingClinic();
        $patient = $this->makeBillingPatient($clinic);
        $appointment = $this->makeBillingAppointment($patient, $this->makeBillingDoctor($clinic));
        $invoice = $this->invoiceService()->draft($clinic->id, $this->draftData($patient, ['appointment_id' => $appointment->id] + $draftOverrides));

        return [$this->invoiceService()->issue($invoice), $appointment];
    }

    private function pay(Invoice $invoice, float $amount, string $method = 'cash'): Payment
    {
        return $this->invoiceService()->recordPayment($invoice, ['amount' => $amount, 'payment_method' => $method]);
    }

    public function test_full_payment_marks_invoice_paid_and_appointment_paid(): void
    {
        [$invoice, $appointment] = $this->issuedWithAppointment();

        $payment = $this->pay($invoice, 801);

        $this->assertSame('success', $payment->status);
        $this->assertSame('801.00', $payment->amount);
        $this->assertSame($invoice->patient_id, $payment->patient_id);
        $this->assertSame($appointment->id, $payment->appointment_id);
        $this->assertSame('paid', $invoice->fresh()->status);
        $this->assertSame('paid', $appointment->fresh()->payment_status);
    }

    public function test_part_payment_leaves_invoice_issued_and_appointment_partial(): void
    {
        [$invoice, $appointment] = $this->issuedWithAppointment();

        $this->pay($invoice, 300);

        $this->assertSame('issued', $invoice->fresh()->status);
        $this->assertSame('partial', $appointment->fresh()->payment_status);
        $this->assertSame(300.0, $this->invoiceService()->amountPaid($invoice));
    }

    public function test_overpayment_is_422(): void
    {
        [$invoice] = $this->issuedWithAppointment();
        $this->pay($invoice, 800);

        $this->assertValidationMessage('That is more than the amount outstanding.', fn () => $this->pay($invoice, 1.01));
        $this->assertSame(1, Payment::count());
    }

    public function test_non_positive_amount_is_422(): void
    {
        [$invoice] = $this->issuedWithAppointment();

        $this->assertValidationMessage('The payment amount must be more than zero.', fn () => $this->pay($invoice, 0));
        $this->assertValidationMessage('The payment amount must be more than zero.', fn () => $this->pay($invoice, -5));
    }

    public function test_online_or_unknown_method_is_422_for_counter_payments(): void
    {
        [$invoice] = $this->issuedWithAppointment();

        $this->assertValidationMessage('That is not a valid payment method.', fn () => $this->pay($invoice, 10, 'online'));
    }

    public function test_payment_against_a_draft_invoice_is_422(): void
    {
        $clinic = $this->makeBillingClinic();
        $invoice = $this->invoiceService()->draft($clinic->id, $this->draftData($this->makeBillingPatient($clinic)));

        $this->assertValidationMessage('Issue the invoice before taking a payment.', fn () => $this->pay($invoice, 10));
    }

    public function test_payment_against_a_cancelled_invoice_is_422(): void
    {
        [$invoice] = $this->issuedWithAppointment();
        $this->invoiceService()->cancel($invoice);

        $this->assertValidationMessage('A cancelled invoice cannot take a payment.', fn () => $this->pay($invoice, 10));
    }

    public function test_refund_recomputes_invoice_and_appointment_state(): void
    {
        [$invoice, $appointment] = $this->issuedWithAppointment();
        $payment = $this->pay($invoice, 801);

        $refunded = $this->invoiceService()->markRefunded($payment, 'Patient left');

        $this->assertSame('refunded', $refunded->status);
        $this->assertSame('Patient left', $refunded->refund_reason);
        $this->assertNotNull($refunded->refunded_at);
        $this->assertSame('issued', $invoice->fresh()->status);
        $this->assertSame('unpaid', $appointment->fresh()->payment_status);

        // Two payments, refund one: still partly paid.
        $a = $this->pay($invoice, 400);
        $this->pay($invoice, 401);
        $this->assertSame('paid', $invoice->fresh()->status);
        $this->invoiceService()->markRefunded($a, 'Duplicate');
        $this->assertSame('issued', $invoice->fresh()->status);
        $this->assertSame('partial', $appointment->fresh()->payment_status);
    }

    public function test_refunding_a_non_successful_payment_is_422(): void
    {
        [$invoice] = $this->issuedWithAppointment();
        $payment = $this->pay($invoice, 100);
        $this->invoiceService()->markRefunded($payment, 'x');

        $this->assertValidationMessage('Only a successful payment can be refunded.', fn () => $this->invoiceService()->markRefunded($payment, 'again'));
    }

    public function test_waived_appointment_is_never_overwritten(): void
    {
        [$invoice, $appointment] = $this->issuedWithAppointment();
        $appointment->update(['payment_status' => 'waived']);

        $payment = $this->pay($invoice, 100);
        $this->assertSame('waived', $appointment->fresh()->payment_status);
        $this->pay($invoice, 701);
        $this->assertSame('waived', $appointment->fresh()->payment_status);
        $this->invoiceService()->markRefunded($payment, 'x');
        $this->assertSame('waived', $appointment->fresh()->payment_status);
    }

    public function test_cancel_with_a_successful_payment_is_422(): void
    {
        [$invoice] = $this->issuedWithAppointment();
        $payment = $this->pay($invoice, 100);

        $this->assertValidationMessage('Refund the payments before cancelling this invoice.', fn () => $this->invoiceService()->cancel($invoice));
        $this->assertSame('issued', $invoice->fresh()->status);

        $this->invoiceService()->markRefunded($payment, 'x');
        $this->assertSame('cancelled', $this->invoiceService()->cancel($invoice)->status);
    }

    public function test_cancelling_a_paid_invoice_is_422(): void
    {
        [$invoice] = $this->issuedWithAppointment();
        $this->pay($invoice, 801);

        $this->assertValidationMessage('Refund the payments before cancelling this invoice.', fn () => $this->invoiceService()->cancel($invoice));
    }

    public function test_issue_mirrors_money_onto_the_appointment(): void
    {
        [, $appointment] = $this->issuedWithAppointment(['discount_amount' => 100, 'tax_amount' => 20]);

        $appointment->refresh();
        $this->assertSame('801.00', $appointment->appointment_fee);
        $this->assertSame('100.00', $appointment->discount_amount);
        $this->assertSame('721.00', $appointment->final_amount);
        $this->assertSame('unpaid', $appointment->payment_status);
    }

    public function test_issuing_keeps_a_waived_appointment_waived(): void
    {
        $clinic = $this->makeBillingClinic();
        $patient = $this->makeBillingPatient($clinic);
        $appointment = $this->makeBillingAppointment($patient, $this->makeBillingDoctor($clinic));
        $appointment->update(['payment_status' => 'waived']);
        $invoice = $this->invoiceService()->draft($clinic->id, $this->draftData($patient, [
            'appointment_id' => $appointment->id, 'items' => [['description' => 'Free', 'quantity' => 1, 'unit_amount' => 0]],
        ]));

        $this->invoiceService()->issue($invoice);

        $this->assertSame('waived', $appointment->fresh()->payment_status);
    }

    public function test_payment_mutations_lock_the_invoice_row(): void
    {
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

        [$invoice] = $this->issuedWithAppointment();
        $locked->exchangeArray([]);
        $payment = $this->pay($invoice, 10);
        $this->assertContains('invoices', $locked->getArrayCopy());

        $locked->exchangeArray([]);
        $this->invoiceService()->markRefunded($payment, 'x');
        $this->assertContains('invoices', $locked->getArrayCopy());
    }

    public function test_float_unsafe_amounts_still_settle_the_invoice(): void
    {
        [$invoice, $appointment] = $this->issuedWithAppointment(['items' => [['description' => 'Odd', 'quantity' => 1, 'unit_amount' => 200.02]]]);

        $this->pay($invoice, 100);
        $this->pay($invoice, 100.02);

        $this->assertSame('paid', $invoice->fresh()->status);
        $this->assertSame('paid', $appointment->fresh()->payment_status);
    }

    public function test_cancelling_a_zero_total_paid_invoice_walks_the_appointment_back(): void
    {
        [$invoice, $appointment] = $this->issuedWithAppointment(['discount_amount' => 801, 'tax_amount' => 0]);
        $this->assertSame('paid', $appointment->fresh()->payment_status);

        $this->invoiceService()->cancel($invoice);

        $appointment->refresh();
        $this->assertSame('unpaid', $appointment->payment_status);
        $this->assertNull($appointment->appointment_fee);
        $this->assertSame("0.00", $appointment->discount_amount);
        $this->assertNull($appointment->final_amount);
    }

    public function test_cancelling_an_issued_invoice_clears_the_mirrored_money(): void
    {
        [$invoice, $appointment] = $this->issuedWithAppointment(['discount_amount' => 100]);
        $this->assertNotNull($appointment->fresh()->final_amount);

        $this->invoiceService()->cancel($invoice);

        $appointment->refresh();
        $this->assertSame('unpaid', $appointment->payment_status);
        $this->assertNull($appointment->appointment_fee);
        $this->assertSame("0.00", $appointment->discount_amount);
        $this->assertNull($appointment->final_amount);
    }

    public function test_cancelling_keeps_a_waived_appointment_waived(): void
    {
        [$invoice, $appointment] = $this->issuedWithAppointment();
        $appointment->update(['payment_status' => 'waived']);

        $this->invoiceService()->cancel($invoice);

        $this->assertSame('waived', $appointment->fresh()->payment_status);
        $this->assertNull($appointment->fresh()->final_amount);
    }

    public function test_a_second_open_invoice_on_an_appointment_is_422_but_a_cancelled_one_does_not_block(): void
    {
        [$invoice, $appointment] = $this->issuedWithAppointment();
        $data = $this->draftData($this->makeBillingPatient($invoice->clinic), ['appointment_id' => $appointment->id]);

        $this->assertValidationMessage('This appointment already has an invoice.', fn () => $this->invoiceService()->draft($invoice->clinic_id, $data));
        $this->assertSame(1, Invoice::count());

        $this->invoiceService()->cancel($invoice);
        $this->assertSame('draft', $this->invoiceService()->draft($invoice->clinic_id, $data)->status);
    }

    public function test_moving_a_draft_onto_an_invoiced_appointment_is_422(): void
    {
        [$invoice, $appointment] = $this->issuedWithAppointment();
        $other = $this->invoiceService()->draft($invoice->clinic_id, $this->draftData($this->makeBillingPatient($invoice->clinic)));

        $this->assertValidationMessage('This appointment already has an invoice.', fn () => $this->invoiceService()->update($other, ['appointment_id' => $appointment->id]));
    }

    public function test_sync_state_leaves_draft_and_cancelled_invoices_alone(): void
    {
        $clinic = $this->makeBillingClinic();
        $patient = $this->makeBillingPatient($clinic);
        $appointment = $this->makeBillingAppointment($patient, $this->makeBillingDoctor($clinic));
        $draft = $this->invoiceService()->draft($clinic->id, $this->draftData($patient, [
            'appointment_id' => $appointment->id, 'items' => [['description' => 'Free', 'quantity' => 1, 'unit_amount' => 0]],
        ]));

        $this->invoiceService()->syncState($draft);

        $this->assertSame('draft', $draft->fresh()->status);
        $this->assertNull($appointment->fresh()->final_amount);

        $draft->forceFill(['status' => 'cancelled'])->save();
        $this->invoiceService()->syncState($draft);
        $this->assertSame('cancelled', $draft->fresh()->status);
        $this->assertNull($appointment->fresh()->final_amount);
    }
}
