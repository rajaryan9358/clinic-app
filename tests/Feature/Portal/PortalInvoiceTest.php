<?php

namespace Tests\Feature\Portal;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\Payment;
use App\Services\Billing\FakeRazorpayGateway;
use App\Services\Billing\InvoiceService;
use App\Services\Billing\RazorpayGateway;
use App\Services\InvoicePdfRenderer;
use App\Support\Billing\InvoicePresenter;
use App\Support\PortalConsent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class PortalInvoiceTest extends TestCase
{
    use PortalTestHelpers;
    use RefreshDatabase;

    private FakeRazorpayGateway $gw;

    private Clinic $clinic;

    protected function setUp(): void
    {
        parent::setUp();
        $this->gw = new FakeRazorpayGateway;
        $this->app->instance(RazorpayGateway::class, $this->gw);
        $this->clinic = $this->makeClinic(['online_payment_enabled' => true]);
    }

    private function consented(Patient $patient): Patient
    {
        $patient->forceFill(['consent_given_at' => now(), 'consent_version' => PortalConsent::VERSION])->save();

        return $patient;
    }

    private function service(): InvoiceService
    {
        return app(InvoiceService::class);
    }

    /** A draft invoice of 500.00 for the patient. */
    private function draft(Patient $patient): Invoice
    {
        return $this->service()->draft($patient->clinic_id, [
            'patient_id' => $patient->id,
            'invoice_date' => '2026-10-16',
            'items' => [['description' => 'Consultation', 'quantity' => 1, 'unit_amount' => 500]],
        ]);
    }

    private function issued(Patient $patient): Invoice
    {
        return $this->service()->issue($this->draft($patient));
    }

    public function test_list_shows_only_issued_and_paid_invoices_for_the_acting_profile(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $other = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);

        $first = $this->issued($patient);
        $second = $this->issued($patient);
        $this->service()->recordPayment($second, ['amount' => 500, 'payment_method' => 'cash']);
        $this->draft($patient);
        $cancelled = $this->service()->cancel($this->issued($patient), 'oops');
        $this->issued($other);

        $res = $this->portalGet('/api/portal/invoices', $token)->assertOk();

        $ids = collect($res->json('data'))->pluck('id')->all();
        $this->assertSame([$second->id, $first->id], $ids);
        $this->assertNotContains($cancelled->id, $ids);
        $this->assertSame('paid', $res->json('data.0.status'));
        $this->assertEquals(0, $res->json('data.0.balance'));
        $this->assertEquals(500, $res->json('data.1.balance'));
    }

    public function test_draft_and_cancelled_invoices_are_404(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);

        $draft = $this->draft($patient);
        $cancelled = $this->service()->cancel($this->issued($patient), 'oops');

        foreach ([$draft, $cancelled] as $invoice) {
            $this->portalGet("/api/portal/invoices/{$invoice->id}", $token)->assertNotFound();
            $this->portalGet("/api/portal/invoices/{$invoice->id}/pdf", $token)->assertNotFound();
            $this->portalPost("/api/portal/invoices/{$invoice->id}/pay", $token)->assertNotFound();
            $this->portalPost("/api/portal/invoices/{$invoice->id}/confirm", $token, null, $this->confirmBody('order_x', 'pay_x'))->assertNotFound();
        }
    }

    public function test_another_profiles_invoice_is_404(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $other = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $theirs = $this->issued($other);

        $this->portalGet("/api/portal/invoices/{$theirs->id}", $token)->assertNotFound();
        $this->portalGet("/api/portal/invoices/{$theirs->id}/pdf", $token)->assertNotFound();
        $this->portalPost("/api/portal/invoices/{$theirs->id}/pay", $token)->assertNotFound();
        $this->portalPost("/api/portal/invoices/{$theirs->id}/confirm", $token, null, $this->confirmBody('order_x', 'pay_x'))->assertNotFound();
    }

    public function test_another_clinics_invoice_is_404(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $elsewhere = $this->makeClinic(['online_payment_enabled' => true]);
        $theirs = $this->issued($this->makePatient($elsewhere));

        $this->portalGet("/api/portal/invoices/{$theirs->id}", $token)->assertNotFound();
    }

    public function test_without_consent_every_invoice_route_is_428(): void
    {
        $patient = $this->makePatient($this->clinic);
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);

        $this->portalGet('/api/portal/invoices', $token)->assertStatus(428);
        $this->portalGet("/api/portal/invoices/{$invoice->id}", $token)->assertStatus(428);
        $this->portalGet("/api/portal/invoices/{$invoice->id}/pdf", $token)->assertStatus(428);
        $this->portalPost("/api/portal/invoices/{$invoice->id}/pay", $token)->assertStatus(428);
        $this->portalPost("/api/portal/invoices/{$invoice->id}/confirm", $token, null, $this->confirmBody('o', 'p'))->assertStatus(428);
    }

    public function test_show_returns_detail_and_hides_superseded_and_pending_attempts(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);

        $this->service()->recordPayment($invoice, ['amount' => 200, 'payment_method' => 'cash']);
        foreach (['failed', 'pending'] as $status) {
            Payment::create([
                'clinic_id' => $invoice->clinic_id, 'invoice_id' => $invoice->id, 'patient_id' => $patient->id,
                'amount' => 300, 'payment_method' => 'online', 'status' => $status, 'paid_at' => now(),
            ]);
        }

        $res = $this->portalGet("/api/portal/invoices/{$invoice->id}", $token)->assertOk();

        $this->assertEquals(300, $res->json('data.balance'));
        $this->assertCount(1, $res->json('data.items'));
        $this->assertCount(1, $res->json('data.payments'));
        $this->assertSame('cash', $res->json('data.payments.0.payment_method'));
    }

    public function test_show_renders_a_negative_balance(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);
        $this->service()->recordPayment($invoice, ['amount' => 500, 'payment_method' => 'cash']);
        Payment::create([
            'clinic_id' => $invoice->clinic_id, 'invoice_id' => $invoice->id, 'patient_id' => $patient->id,
            'amount' => 50, 'payment_method' => 'online', 'status' => 'success', 'paid_at' => now(),
        ]);

        $this->portalGet("/api/portal/invoices/{$invoice->id}", $token)->assertOk()->assertJsonPath('data.balance', -50);
    }

    public function test_pdf_downloads_for_own_issued_invoice(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);

        $res = $this->portalGet("/api/portal/invoices/{$invoice->id}/pdf", $token)->assertOk();
        $this->assertStringContainsString('application/pdf', $res->headers->get('content-type'));
    }

    public function test_pay_returns_the_order_payload(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);

        $res = $this->portalPost("/api/portal/invoices/{$invoice->id}/pay", $token)->assertOk();

        $this->assertSame('order_fake_1', $res->json('data.order_id'));
        $this->assertEquals(500, $res->json('data.amount'));
        $this->assertSame('INR', $res->json('data.currency'));
        $this->assertSame('rzp_test_fake', $res->json('data.key_id'));
        $this->assertSame($invoice->invoice_number, $res->json('data.invoice_number'));
    }

    public function test_pay_is_404_when_online_payment_is_off(): void
    {
        $clinic = $this->makeClinic(['online_payment_enabled' => false]);
        $patient = $this->consented($this->makePatient($clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);

        $this->portalPost("/api/portal/invoices/{$invoice->id}/pay", $token)->assertNotFound();
        $this->portalPost("/api/portal/invoices/{$invoice->id}/confirm", $token, null, $this->confirmBody('o', 'p'))->assertNotFound();
        $this->assertCount(0, $this->gw->createdOrders);
    }

    public function test_pay_is_404_when_the_gateway_is_unconfigured(): void
    {
        $this->gw->configured = false;
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);

        $this->portalPost("/api/portal/invoices/{$invoice->id}/pay", $token)->assertNotFound();
    }

    public function test_confirm_settles_the_payment_and_returns_the_paid_invoice(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);

        $order = $this->portalPost("/api/portal/invoices/{$invoice->id}/pay", $token)->json('data');

        $res = $this->portalPost("/api/portal/invoices/{$invoice->id}/confirm", $token, null,
            $this->confirmBody($order['order_id'], 'pay_1'))->assertOk();

        $this->assertSame('paid', $res->json('data.status'));
        $this->assertEquals(0, $res->json('data.balance'));
        $this->assertSame('success', $res->json('data.payments.0.status'));
        $this->assertSame('paid', $invoice->fresh()->status);

        // The webhook (or a double-tap) replaying the same payment is still a plain 200.
        $this->portalPost("/api/portal/invoices/{$invoice->id}/confirm", $token, null,
            $this->confirmBody($order['order_id'], 'pay_1'))->assertOk()->assertJsonPath('data.status', 'paid');
        $this->assertSame(1, Payment::where('status', 'success')->count());
    }

    public function test_confirm_requires_the_razorpay_fields(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);

        $this->portalPost("/api/portal/invoices/{$invoice->id}/confirm", $token, null, [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature']);
    }

    public function test_confirm_with_a_bad_signature_is_422(): void
    {
        $this->gw->signatureValid = false;
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);
        $order = $this->portalPost("/api/portal/invoices/{$invoice->id}/pay", $token)->json('data');

        $this->portalPost("/api/portal/invoices/{$invoice->id}/confirm", $token, null,
            $this->confirmBody($order['order_id'], 'pay_1'))->assertStatus(422);
        $this->assertSame('issued', $invoice->fresh()->status);
    }

    public function test_acting_as_a_dependent_lists_the_dependents_invoices(): void
    {
        $holder = $this->consented($this->makePatient($this->clinic));
        $child = $this->consented($this->makePatient($this->clinic, [
            'first_name' => 'Kid', 'full_name' => 'Kid Patient', 'managed_by_patient_id' => $holder->id,
        ]));
        $token = $this->portalToken($holder);

        $mine = $this->issued($holder);
        $theirs = $this->issued($child);

        $asHolder = $this->portalGet('/api/portal/invoices', $token, $holder->id)->assertOk();
        $this->assertSame([$mine->id], collect($asHolder->json('data'))->pluck('id')->all());

        $asChild = $this->portalGet('/api/portal/invoices', $token, $child->id)->assertOk();
        $this->assertSame([$theirs->id], collect($asChild->json('data'))->pluck('id')->all());

        $this->portalGet("/api/portal/invoices/{$mine->id}", $token, $child->id)->assertNotFound();
        $this->portalGet("/api/portal/invoices/{$theirs->id}", $token, $child->id)->assertOk();
    }

    public function test_staff_authored_text_never_reaches_the_portal(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);
        $invoice->forceFill(['notes' => 'STAFFNOTE-invoice-dispute'])->save();
        $this->service()->recordPayment($invoice, ['amount' => 100, 'payment_method' => 'cash', 'reference_number' => 'REF-123', 'notes' => 'STAFFNOTE-payment-bounced']);
        $refunded = $this->service()->recordPayment($invoice, ['amount' => 50, 'payment_method' => 'cash']);
        $this->service()->markRefunded($refunded, 'STAFFNOTE-refund-reason');

        foreach (['/api/portal/invoices', "/api/portal/invoices/{$invoice->id}"] as $uri) {
            $body = $this->portalGet($uri, $token)->assertOk()->getContent();
            $this->assertStringNotContainsString('STAFFNOTE', $body);
        }

        $this->assertStringContainsString('REF-123', $this->portalGet("/api/portal/invoices/{$invoice->id}", $token)->getContent());
    }

    public function test_the_patient_pdf_omits_staff_notes_and_unsettled_orders(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);
        $invoice->forceFill(['notes' => 'STAFFNOTE-chase-this-debtor'])->save();
        $this->service()->recordPayment($invoice, ['amount' => 100, 'payment_method' => 'cash']);
        Payment::create([
            'clinic_id' => $invoice->clinic_id, 'invoice_id' => $invoice->id, 'patient_id' => $patient->id,
            'amount' => 400, 'payment_method' => 'online', 'status' => 'pending', 'paid_at' => now(),
        ]);

        // The portal route must use the patient-facing renderer mode.
        $spy = $this->spy(InvoicePdfRenderer::class);
        $this->portalGet("/api/portal/invoices/{$invoice->id}/pdf", $token);
        $spy->shouldHaveReceived('render')->withArgs(fn ($i, $patientFacing) => $patientFacing === true)->once();
        $this->app->forgetInstance(InvoicePdfRenderer::class);

        $renderer = app(InvoicePdfRenderer::class);
        $data = $renderer->data($invoice->fresh(), true);
        $html = view('reports.invoice', $data)->render();

        $this->assertStringNotContainsString('STAFFNOTE', $html);
        $this->assertStringNotContainsString('Pending', $html);
        $this->assertCount(1, $data['payments']);

        // Staff copy is unchanged: it still shows both.
        $staff = $renderer->data($invoice->fresh());
        $this->assertSame('STAFFNOTE-chase-this-debtor', $staff['notes']);
        $this->assertCount(2, $staff['payments']);
    }

    public function test_list_and_detail_carry_the_doctor_name(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $doctor = Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr Asha Rao', 'status' => 'active', 'slot_duration_minutes' => 30]);
        $appt = Appointment::create([
            'clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'patient_id' => $patient->id, 'doctor_id' => $doctor->id,
            'appointment_date' => '2026-10-15', 'start_time' => '10:00:00', 'end_time' => '10:30:00',
            'visit_type' => 'new', 'booking_channel' => 'walk_in', 'status' => 'completed',
        ]);
        $with = $this->service()->issue($this->service()->draft($patient->clinic_id, [
            'patient_id' => $patient->id, 'appointment_id' => $appt->id, 'invoice_date' => '2026-10-16',
            'items' => [['description' => 'Consultation', 'quantity' => 1, 'unit_amount' => 500]],
        ]));
        $without = $this->issued($patient);

        $rows = collect($this->portalGet('/api/portal/invoices', $token)->assertOk()->json('data'))->keyBy('id');
        $this->assertSame('Dr Asha Rao', $rows[$with->id]['doctor_name']);
        $this->assertNull($rows[$without->id]['doctor_name']);
        $this->portalGet("/api/portal/invoices/{$with->id}", $token)->assertJsonPath('data.doctor_name', 'Dr Asha Rao');
    }


    public function test_can_pay_online_is_true_when_enabled_and_configured(): void
    {
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);

        $this->portalGet("/api/portal/invoices/{$invoice->id}", $token)->assertJsonPath('data.can_pay_online', true);
        $this->portalGet('/api/portal/invoices', $token)->assertJsonPath('data.0.can_pay_online', true);
    }

    public function test_can_pay_online_is_false_when_the_setting_is_off(): void
    {
        $clinic = $this->makeClinic(['online_payment_enabled' => false]);
        $patient = $this->consented($this->makePatient($clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);

        $this->portalGet("/api/portal/invoices/{$invoice->id}", $token)->assertJsonPath('data.can_pay_online', false);
        $this->portalGet('/api/portal/invoices', $token)->assertJsonPath('data.0.can_pay_online', false);
    }

    public function test_can_pay_online_is_false_when_the_gateway_is_unconfigured(): void
    {
        $this->gw->configured = false;
        $patient = $this->consented($this->makePatient($this->clinic));
        $token = $this->portalToken($patient);
        $invoice = $this->issued($patient);

        $this->portalGet("/api/portal/invoices/{$invoice->id}", $token)->assertJsonPath('data.can_pay_online', false);
        $this->portalGet('/api/portal/invoices', $token)->assertJsonPath('data.0.can_pay_online', false);
    }

    public function test_can_pay_online_is_absent_from_the_staff_shapes(): void
    {
        $invoice = $this->issued($this->consented($this->makePatient($this->clinic)));

        $this->assertArrayNotHasKey('can_pay_online', InvoicePresenter::detail($invoice));
        $this->assertArrayNotHasKey('can_pay_online', InvoicePresenter::item($invoice));
    }

    /** @return array<string, string> */
    private function confirmBody(string $orderId, string $paymentId): array
    {
        return ['razorpay_order_id' => $orderId, 'razorpay_payment_id' => $paymentId, 'razorpay_signature' => 'sig'];
    }
}
