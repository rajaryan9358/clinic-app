<?php

namespace Tests\Feature\Billing;

use App\Models\Clinic;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\PatientLoginLink;
use App\Models\Payment;
use App\Models\Role;
use App\Models\User;
use App\Services\InvoicePdfRenderer;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\WhatsAppGateway;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class InvoiceDocumentTest extends TestCase
{
    use BillingTestHelpers, RefreshDatabase;

    private Clinic $clinic;

    private FakeWhatsAppGateway $fake;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-16 10:00:00'));
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->fake = new FakeWhatsAppGateway;
        $this->app->instance(WhatsAppGateway::class, $this->fake);
        $this->clinic = $this->makeBillingClinic(['invoice_footer_note' => 'Thank you for choosing us.']);
    }

    private function staffWith(array $permissions): User
    {
        $role = Role::create(['name' => 'r'.Str::random(6), 'guard_name' => 'web', 'label' => 'R', 'kind' => 'staff']);
        $role->syncPermissions($permissions);
        $u = User::create(['clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'S',
            'email' => Str::random(6).'@x.test', 'password' => 'x', 'role' => $role->name, 'status' => 'active']);
        $u->syncRoles([$role->name]);

        return $u;
    }

    private function receptionist(): User
    {
        $u = User::create(['clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Rec',
            'email' => Str::random(6).'@x.test', 'password' => 'x', 'role' => 'receptionist', 'status' => 'active']);
        $u->syncRoles(['receptionist']);

        return $u;
    }

    private function issued(?Clinic $clinic = null, ?Patient $patient = null): Invoice
    {
        $clinic ??= $this->clinic;
        $patient ??= $this->makeBillingPatient($clinic);

        return $this->invoiceService()->issue($this->invoiceService()->draft($clinic->id, $this->draftData($patient)));
    }

    private function html(Invoice $invoice): string
    {
        return view('reports.invoice', app(InvoicePdfRenderer::class)->data($invoice))->render();
    }

    /** @return string[] */
    private function bodyParams(array $sent): array
    {
        foreach ($sent['components'] as $c) {
            if ($c['type'] === 'body') {
                return array_map(fn ($p) => $p['text'], $c['parameters']);
            }
        }

        return [];
    }

    public function test_pdf_streams_for_an_issued_invoice_and_lists_items_and_payments(): void
    {
        $invoice = $this->issued();
        $this->invoiceService()->recordPayment($invoice, ['amount' => 300, 'payment_method' => 'cash']);

        Sanctum::actingAs($this->receptionist());
        $res = $this->get("/api/clinic/invoices/{$invoice->id}/pdf")->assertOk();
        $this->assertStringContainsString('application/pdf', $res->headers->get('content-type'));
        $this->assertStringStartsWith('%PDF', $res->getContent());

        $html = $this->html($invoice->fresh());
        foreach (['Consultation', 'Dressing', 'Pat', 'Bill Clinic', $invoice->fresh()->invoice_number, 'Thank you for choosing us.'] as $needle) {
            $this->assertStringContainsString($needle, $html);
        }
        $this->assertStringContainsString('300.00', $html);
        $this->assertStringContainsString('501.00', $html); // balance
        $this->assertStringContainsString('cash', strtolower($html));
    }

    public function test_pdf_omits_superseded_online_attempts_and_shows_a_negative_balance(): void
    {
        $invoice = $this->issued(); // total 801
        $this->invoiceService()->recordPayment($invoice, ['amount' => 801, 'payment_method' => 'cash']);
        Payment::create(['clinic_id' => $this->clinic->id, 'invoice_id' => $invoice->id, 'patient_id' => $invoice->patient_id,
            'amount' => 801, 'payment_method' => 'online', 'status' => 'failed', 'reference_number' => 'order_abandoned', 'paid_at' => now()]);
        Payment::create(['clinic_id' => $this->clinic->id, 'invoice_id' => $invoice->id, 'patient_id' => $invoice->patient_id,
            'amount' => 50, 'payment_method' => 'online', 'status' => 'success', 'reference_number' => 'pay_over', 'paid_at' => now()]);

        $html = $this->html($invoice->fresh());
        $this->assertStringNotContainsString('order_abandoned', $html);
        $this->assertStringNotContainsString('failed', strtolower($html));
        $this->assertStringContainsString('-₹50.00', $html);
    }

    public function test_pdf_says_receipt_when_fully_paid_and_invoice_otherwise(): void
    {
        $invoice = $this->issued();
        $this->assertMatchesRegularExpression('/<h1>\s*Invoice\s*<\/h1>/', $this->html($invoice->fresh()));

        $this->invoiceService()->recordPayment($invoice, ['amount' => 801, 'payment_method' => 'cash']);
        $this->assertSame('paid', $invoice->fresh()->status);
        $this->assertMatchesRegularExpression('/<h1>\s*Receipt\s*<\/h1>/', $this->html($invoice->fresh()));
    }

    public function test_pdf_never_says_tax_invoice(): void
    {
        $invoice = $this->issued();
        $this->assertStringNotContainsStringIgnoringCase('tax invoice', $this->html($invoice->fresh()));
        $this->invoiceService()->recordPayment($invoice, ['amount' => 801, 'payment_method' => 'cash']);
        $this->assertStringNotContainsStringIgnoringCase('tax invoice', $this->html($invoice->fresh()));
    }

    public function test_send_creates_the_login_link_with_the_invoice_redirect_path(): void
    {
        $invoice = $this->issued();

        Sanctum::actingAs($this->receptionist());
        $this->postJson("/api/clinic/invoices/{$invoice->id}/send")->assertOk();

        $link = PatientLoginLink::where('patient_id', $invoice->patient_id)->firstOrFail();
        $this->assertSame("/invoices/{$invoice->id}?profile={$invoice->patient_id}", $link->redirect_path);
        $this->assertTrue($link->expires_at->isFuture());
        $this->assertCount(1, $this->fake->sent);
        $this->assertSame('invoice_ready', $this->fake->sent[0]['template']);
    }

    public function test_invoice_ready_sends_the_five_body_params_in_order_with_the_token_button(): void
    {
        $invoice = $this->issued();
        $this->invoiceService()->recordPayment($invoice, ['amount' => 300, 'payment_method' => 'cash']);

        Sanctum::actingAs($this->receptionist());
        $this->postJson("/api/clinic/invoices/{$invoice->id}/send")->assertOk();

        $sent = $this->fake->sent[0];
        $this->assertSame(
            ['Pat', 'Bill Clinic', $invoice->fresh()->invoice_number, '₹801.00', 'Balance due: ₹501.00'],
            $this->bodyParams($sent),
        );
        $button = collect($sent['components'])->firstWhere('type', 'button');
        $this->assertSame('url', $button['sub_type']);
        $this->assertSame('0', $button['index']);
        $this->assertSame(40, strlen($button['parameters'][0]['text']));
        $this->assertSame(
            hash('sha256', $button['parameters'][0]['text']),
            PatientLoginLink::firstOrFail()->token_hash,
        );
    }

    public function test_due_wording_for_full_unpaid_and_fully_paid(): void
    {
        $invoice = $this->issued();
        Sanctum::actingAs($this->receptionist());
        $this->postJson("/api/clinic/invoices/{$invoice->id}/send")->assertOk();
        $this->assertSame('Amount due: ₹801.00', $this->bodyParams($this->fake->sent[0])[4]);

        $this->invoiceService()->recordPayment($invoice, ['amount' => 801, 'payment_method' => 'cash']);
        $this->postJson("/api/clinic/invoices/{$invoice->id}/send")->assertOk();
        $this->assertSame('Paid in full', $this->bodyParams($this->fake->sent[1])[4]);
    }

    public function test_dependent_invoice_notifies_the_account_holder(): void
    {
        $holder = $this->makeBillingPatient($this->clinic);
        $dependent = Patient::create([
            'clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'first_name' => 'Kid',
            'phone' => '8000000001', 'managed_by_patient_id' => $holder->id,
        ]);
        $invoice = $this->issued(null, $dependent);

        Sanctum::actingAs($this->receptionist());
        $this->postJson("/api/clinic/invoices/{$invoice->id}/send")->assertOk();

        $link = PatientLoginLink::firstOrFail();
        $this->assertSame($holder->id, $link->patient_id);
        $this->assertSame("/invoices/{$invoice->id}?profile={$dependent->id}", $link->redirect_path);
        $this->assertSame('Kid', $this->bodyParams($this->fake->sent[0])[0]);
        $this->assertStringEndsWith($holder->phone, $this->fake->sent[0]['to']);
    }

    public function test_dependent_managed_by_another_clinics_patient_gets_no_link_and_no_message(): void
    {
        $outsider = $this->makeBillingPatient($this->makeBillingClinic());
        $dependent = Patient::create([
            'clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'first_name' => 'Kid',
            'phone' => '8000000001', 'managed_by_patient_id' => $outsider->id,
        ]);
        $invoice = $this->issued(null, $dependent);

        Sanctum::actingAs($this->receptionist());
        $this->postJson("/api/clinic/invoices/{$invoice->id}/send")
            ->assertStatus(422)->assertJsonValidationErrors('patient');

        $this->assertSame(0, PatientLoginLink::where('patient_id', $outsider->id)->count());
        $this->assertSame(0, PatientLoginLink::count());
        $this->assertSame([], $this->fake->sent);
    }

    public function test_notifier_never_resolves_a_holder_from_another_clinic(): void
    {
        $outsider = $this->makeBillingPatient($this->makeBillingClinic());
        $dependent = Patient::create([
            'clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'first_name' => 'Kid',
            'phone' => '8000000001', 'managed_by_patient_id' => $outsider->id,
        ]);
        $invoice = $this->issued(null, $dependent);

        $row = app(\App\Services\WhatsApp\PatientNotifier::class)->invoiceReady($invoice, 'tok');

        $this->assertSame('skipped', $row->delivery_status);
        $this->assertSame([], $this->fake->sent);
    }

    public function test_invoice_ready_formats_a_four_figure_total_with_a_thousands_separator(): void
    {
        $patient = $this->makeBillingPatient($this->clinic);
        $invoice = $this->invoiceService()->issue($this->invoiceService()->draft($this->clinic->id, $this->draftData($patient, [
            'items' => [['description' => 'Procedure', 'quantity' => 1, 'unit_amount' => 1234]],
        ])));

        Sanctum::actingAs($this->receptionist());
        $this->postJson("/api/clinic/invoices/{$invoice->id}/send")->assertOk();

        $params = $this->bodyParams($this->fake->sent[0]);
        $this->assertSame('₹1,234.00', $params[3]);
        $this->assertSame('Amount due: ₹1,234.00', $params[4]);
    }

    public function test_draft_and_cancelled_invoices_cannot_be_sent(): void
    {
        $draft = $this->invoiceService()->draft($this->clinic->id, $this->draftData($this->makeBillingPatient($this->clinic)));
        $cancelled = $this->invoiceService()->cancel($this->issued());

        Sanctum::actingAs($this->receptionist());
        foreach ([$draft, $cancelled] as $invoice) {
            $this->postJson("/api/clinic/invoices/{$invoice->id}/send")
                ->assertStatus(422)
                ->assertJsonValidationErrors('invoice');
        }
        $this->assertSame([], $this->fake->sent);
        $this->assertSame(0, PatientLoginLink::count());
    }

    public function test_send_needs_billing_create_and_pdf_needs_billing_view(): void
    {
        $invoice = $this->issued();

        Sanctum::actingAs($this->staffWith(['billing.view']));
        $this->postJson("/api/clinic/invoices/{$invoice->id}/send")->assertForbidden();
        $this->get("/api/clinic/invoices/{$invoice->id}/pdf")->assertOk();

        Sanctum::actingAs($this->staffWith(['billing.create']));
        $this->get("/api/clinic/invoices/{$invoice->id}/pdf")->assertForbidden();
    }

    public function test_another_clinics_invoice_is_404_on_pdf_and_send(): void
    {
        $other = $this->makeBillingClinic();
        $foreign = $this->issued($other);

        Sanctum::actingAs($this->receptionist());
        $this->get("/api/clinic/invoices/{$foreign->id}/pdf")->assertNotFound();
        $this->postJson("/api/clinic/invoices/{$foreign->id}/send")->assertNotFound();
        $this->assertSame([], $this->fake->sent);
    }

    public function test_super_admin_can_fetch_pdf_and_send(): void
    {
        $invoice = $this->issued();
        $sa = User::create(['uuid' => (string) Str::uuid(), 'full_name' => 'SA', 'email' => 'sa@x.test',
            'password' => 'x', 'role' => 'super_admin', 'status' => 'active']);
        $sa->assignRole('super_admin');

        Sanctum::actingAs($sa);
        $this->get("/api/super-admin/invoices/{$invoice->id}/pdf")->assertOk();
        $this->postJson("/api/super-admin/invoices/{$invoice->id}/send")->assertOk();
        $this->assertCount(1, $this->fake->sent);
    }

    public function test_appointment_detail_reports_a_negative_balance_when_an_online_capture_overshot(): void
    {
        $patient = $this->makeBillingPatient($this->clinic);
        $appt = $this->makeBillingAppointment($patient, $this->makeBillingDoctor($this->clinic));
        $invoice = $this->invoiceService()->issue($this->invoiceService()->draft($this->clinic->id, $this->draftData($patient, ['appointment_id' => $appt->id])));
        $this->invoiceService()->recordPayment($invoice, ['amount' => 801, 'payment_method' => 'cash']);
        Payment::create(['clinic_id' => $this->clinic->id, 'invoice_id' => $invoice->id, 'patient_id' => $patient->id,
            'amount' => 50, 'payment_method' => 'online', 'status' => 'success', 'reference_number' => 'pay_over', 'paid_at' => now()]);

        Sanctum::actingAs($this->receptionist());
        $res = $this->getJson("/api/clinic/appointments/{$appt->id}/detail")->assertOk();
        $this->assertEquals(-50, $res->json('data.invoice.balance'));
    }

    public function test_appointment_detail_hides_the_invoice_without_billing_view(): void
    {
        $patient = $this->makeBillingPatient($this->clinic);
        $appt = $this->makeBillingAppointment($patient, $this->makeBillingDoctor($this->clinic));
        $invoice = $this->invoiceService()->issue($this->invoiceService()->draft($this->clinic->id, $this->draftData($patient, ['appointment_id' => $appt->id])));

        Sanctum::actingAs($this->staffWith(['appointments.view']));
        $this->assertNull($this->getJson("/api/clinic/appointments/{$appt->id}/detail")->assertOk()->json('data.invoice'));

        Sanctum::actingAs($this->staffWith(['appointments.view', 'billing.view']));
        $this->getJson("/api/clinic/appointments/{$appt->id}/detail")->assertOk()->assertJsonPath('data.invoice.id', $invoice->id);
    }
}
