<?php

namespace Tests\Feature\Billing;

use App\Models\Clinic;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class StaffInvoiceTest extends TestCase
{
    use BillingTestHelpers, RefreshDatabase;

    private Clinic $clinic;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-16 10:00:00'));
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->clinic = $this->makeBillingClinic();
    }

    private function systemUser(string $role): User
    {
        $u = User::create(['clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => ucfirst($role),
            'email' => Str::random(6).'@x.test', 'password' => 'x', 'role' => $role, 'status' => 'active']);
        $u->syncRoles([$role]);

        return $u;
    }

    private function receptionist(): User
    {
        return $this->systemUser('receptionist');
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

    private function superAdmin(): User
    {
        $u = User::create(['uuid' => (string) Str::uuid(), 'full_name' => 'SA', 'email' => 'sa'.Str::random(4).'@x.test',
            'password' => 'x', 'role' => 'super_admin', 'status' => 'active']);
        $u->assignRole('super_admin');

        return $u;
    }

    private function draftFor(Clinic $clinic, array $overrides = []): Invoice
    {
        return $this->invoiceService()->draft($clinic->id, $this->draftData($this->makeBillingPatient($clinic), $overrides));
    }

    private function issuedFor(Clinic $clinic, array $overrides = []): Invoice
    {
        return $this->invoiceService()->issue($this->draftFor($clinic, $overrides));
    }

    public function test_create_draft_returns_the_detail(): void
    {
        Sanctum::actingAs($this->receptionist());
        $patient = $this->makeBillingPatient($this->clinic);

        $res = $this->postJson('/api/clinic/invoices', [
            'patient_id' => $patient->id, 'invoice_date' => '2026-10-16',
            'items' => [['description' => 'Consultation', 'quantity' => 1, 'unit_amount' => 500]],
        ])->assertCreated();

        $res->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.invoice_number', null)
            ->assertJsonPath('data.patient.id', $patient->id)
            ->assertJsonPath('data.items.0.description', 'Consultation')
            ->assertJsonPath('data.payments', []);
        $this->assertEquals(500, $res->json('data.total_amount'));
        $this->assertEquals(500, $res->json('data.balance'));
        $this->assertSame(1, Invoice::count());
        $this->assertNotNull(Invoice::first()->created_by_user_id);
    }

    public function test_create_rejects_a_patient_from_another_clinic_and_ignores_status(): void
    {
        Sanctum::actingAs($this->receptionist());
        $foreign = $this->makeBillingPatient($this->makeBillingClinic());

        $this->postJson('/api/clinic/invoices', [
            'patient_id' => $foreign->id, 'items' => [['description' => 'X', 'quantity' => 1, 'unit_amount' => 1]],
        ])->assertStatus(422)->assertJsonValidationErrors('patient_id');

        $mine = $this->makeBillingPatient($this->clinic);
        $this->postJson('/api/clinic/invoices', [
            'patient_id' => $mine->id, 'status' => 'paid', 'total_amount' => 1, 'invoice_number' => 'HACK',
            'items' => [['description' => 'X', 'quantity' => 1, 'unit_amount' => 100]],
        ])->assertCreated()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.invoice_number', null);
    }

    public function test_update_replaces_items_on_a_draft(): void
    {
        Sanctum::actingAs($this->receptionist());
        $invoice = $this->draftFor($this->clinic);

        $res = $this->putJson("/api/clinic/invoices/{$invoice->id}", [
            'items' => [['description' => 'Only', 'quantity' => 2, 'unit_amount' => 100]], 'discount_amount' => 50,
        ])->assertOk();

        $this->assertEquals(150, $res->json('data.total_amount'));
        $this->assertCount(1, $res->json('data.items'));
    }

    public function test_issue_assigns_a_number(): void
    {
        Sanctum::actingAs($this->receptionist());
        $invoice = $this->draftFor($this->clinic);

        $res = $this->postJson("/api/clinic/invoices/{$invoice->id}/issue")->assertOk()->assertJsonPath('data.status', 'issued');
        $this->assertStringEndsWith('/00001', $res->json('data.invoice_number'));

        $this->postJson("/api/clinic/invoices/{$invoice->id}/issue")->assertStatus(422);
    }

    public function test_record_payment_and_show_detail(): void
    {
        Sanctum::actingAs($this->receptionist());
        $invoice = $this->issuedFor($this->clinic);

        $this->postJson("/api/clinic/invoices/{$invoice->id}/payments", ['amount' => 300, 'payment_method' => 'cash'])
            ->assertCreated()->assertJsonPath('data.status', 'success')->assertJsonPath('data.payment_method', 'cash');

        $show = $this->getJson("/api/clinic/invoices/{$invoice->id}")->assertOk();
        $this->assertEquals(300, $show->json('data.amount_paid'));
        $this->assertEquals(501, $show->json('data.balance'));
        $this->assertCount(1, $show->json('data.payments'));

        $this->postJson("/api/clinic/invoices/{$invoice->id}/payments", ['amount' => 9999, 'payment_method' => 'cash'])
            ->assertStatus(422);
        $this->postJson("/api/clinic/invoices/{$invoice->id}/payments", ['payment_method' => 'cash'])
            ->assertStatus(422)->assertJsonValidationErrors('amount');
    }

    public function test_cancel_and_refund(): void
    {
        Sanctum::actingAs($this->receptionist());
        $invoice = $this->issuedFor($this->clinic);
        $payment = $this->invoiceService()->recordPayment($invoice, ['amount' => 100, 'payment_method' => 'upi']);

        $this->postJson("/api/clinic/invoices/{$invoice->id}/cancel", ['reason' => 'Mistake'])->assertStatus(422);

        $this->postJson("/api/clinic/payments/{$payment->id}/refund", ['reason' => 'Patient asked'])
            ->assertOk()->assertJsonPath('data.status', 'refunded')->assertJsonPath('data.refund_reason', 'Patient asked');
        $this->postJson("/api/clinic/payments/{$payment->id}/refund", [])->assertStatus(422)->assertJsonValidationErrors('reason');

        $this->postJson("/api/clinic/invoices/{$invoice->id}/cancel", ['reason' => 'Mistake'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.cancelled_reason', 'Mistake');
    }

    public function test_list_filters_by_status_and_date_range(): void
    {
        Sanctum::actingAs($this->receptionist());
        $this->issuedFor($this->clinic, ['invoice_date' => '2026-10-01']);
        $this->draftFor($this->clinic, ['invoice_date' => '2026-10-10']);
        $this->draftFor($this->clinic, ['invoice_date' => '2026-10-20']);

        $this->assertCount(3, $this->getJson('/api/clinic/invoices')->assertOk()->json('data'));
        $this->assertCount(1, $this->getJson('/api/clinic/invoices?status=issued')->json('data'));
        $this->assertCount(2, $this->getJson('/api/clinic/invoices?status=draft')->json('data'));
        $this->assertCount(1, $this->getJson('/api/clinic/invoices?from=2026-10-05&to=2026-10-15')->json('data'));
        $this->assertCount(2, $this->getJson('/api/clinic/invoices?from=2026-10-10')->json('data'));
    }

    public function test_list_filters_by_patient_appointment_and_search(): void
    {
        Sanctum::actingAs($this->receptionist());
        $patient = $this->makeBillingPatient($this->clinic);
        $appointment = $this->makeBillingAppointment($patient, $this->makeBillingDoctor($this->clinic));
        $mine = $this->invoiceService()->draft($this->clinic->id, $this->draftData($patient, ['appointment_id' => $appointment->id]));
        $this->draftFor($this->clinic);

        $this->assertSame([$mine->id], array_column($this->getJson("/api/clinic/invoices?patient_id={$patient->id}")->json('data'), 'id'));
        $this->assertSame([$mine->id], array_column($this->getJson("/api/clinic/invoices?appointment_id={$appointment->id}")->json('data'), 'id'));
        $issued = $this->invoiceService()->issue($mine);
        $this->assertSame([$mine->id], array_column($this->getJson('/api/clinic/invoices?q='.urlencode($issued->invoice_number))->json('data'), 'id'));
        $this->assertSame([$mine->id], array_column($this->getJson('/api/clinic/invoices?q='.$patient->phone)->json('data'), 'id'));
    }

    public function test_list_reports_amount_paid_and_balance(): void
    {
        Sanctum::actingAs($this->receptionist());
        $invoice = $this->issuedFor($this->clinic);
        $this->invoiceService()->recordPayment($invoice, ['amount' => 200, 'payment_method' => 'cash']);
        $refunded = $this->invoiceService()->recordPayment($invoice, ['amount' => 100, 'payment_method' => 'cash']);
        $this->invoiceService()->markRefunded($refunded, 'oops');
        Payment::create(['clinic_id' => $this->clinic->id, 'invoice_id' => $invoice->id, 'patient_id' => $invoice->patient_id,
            'amount' => 50, 'payment_method' => 'online', 'status' => 'failed', 'paid_at' => now()]);

        $row = $this->getJson('/api/clinic/invoices')->assertOk()->json('data.0');

        $this->assertEquals(200, $row['amount_paid']);
        $this->assertEquals(601, $row['balance']);
        $this->assertEquals(801, $row['total_amount']);
        $this->assertSame(['id', 'full_name', 'phone'], array_keys($row['patient']));
    }

    public function test_balance_can_be_negative_after_an_overpaying_online_capture(): void
    {
        Sanctum::actingAs($this->receptionist());
        $invoice = $this->issuedFor($this->clinic);
        $this->invoiceService()->recordPayment($invoice, ['amount' => 801, 'payment_method' => 'cash']);
        Payment::create(['clinic_id' => $this->clinic->id, 'invoice_id' => $invoice->id, 'patient_id' => $invoice->patient_id,
            'amount' => 100, 'payment_method' => 'online', 'status' => 'success', 'paid_at' => now()]);

        $this->assertEquals(-100, $this->getJson('/api/clinic/invoices')->json('data.0.balance'));
        $this->assertEquals(-100, $this->getJson("/api/clinic/invoices/{$invoice->id}")->json('data.balance'));
    }

    public function test_superseded_online_attempts_are_labelled_not_failed(): void
    {
        Sanctum::actingAs($this->receptionist());
        $invoice = $this->issuedFor($this->clinic);
        $base = ['clinic_id' => $this->clinic->id, 'invoice_id' => $invoice->id, 'patient_id' => $invoice->patient_id, 'amount' => 50, 'paid_at' => now()];
        Payment::create($base + ['payment_method' => 'online', 'status' => 'failed']);
        Payment::create($base + ['payment_method' => 'cash', 'status' => 'failed']);

        $payments = collect($this->getJson("/api/clinic/invoices/{$invoice->id}")->json('data.payments'));

        $online = $payments->firstWhere('payment_method', 'online');
        $this->assertTrue($online['superseded']);
        $this->assertSame('superseded', $online['display_status']);
        $cash = $payments->firstWhere('payment_method', 'cash');
        $this->assertFalse($cash['superseded']);
        $this->assertSame('failed', $cash['display_status']);
    }

    public function test_receptionist_can_create_but_a_doctor_without_billing_create_is_403(): void
    {
        $patient = $this->makeBillingPatient($this->clinic);
        $payload = ['patient_id' => $patient->id, 'items' => [['description' => 'X', 'quantity' => 1, 'unit_amount' => 10]]];

        Sanctum::actingAs($this->staffWith(['billing.view']));
        $this->postJson('/api/clinic/invoices', $payload)->assertStatus(403);
        $this->getJson('/api/clinic/invoices')->assertOk();

        $doctor = $this->systemUser('doctor');
        $this->makeBillingDoctor($this->clinic, ['user_id' => $doctor->id]);
        $this->assertFalse($doctor->can('billing.create'));
        Sanctum::actingAs($doctor);
        $this->postJson('/api/clinic/invoices', $payload)->assertStatus(403);

        Sanctum::actingAs($this->receptionist());
        $this->postJson('/api/clinic/invoices', $payload)->assertCreated();
    }

    public function test_cancel_requires_billing_edit(): void
    {
        $invoice = $this->draftFor($this->clinic);
        $issued = $this->issuedFor($this->clinic);
        $payment = $this->invoiceService()->recordPayment($issued, ['amount' => 10, 'payment_method' => 'cash']);

        Sanctum::actingAs($this->staffWith(['billing.view', 'billing.create']));
        $this->postJson("/api/clinic/invoices/{$invoice->id}/cancel", [])->assertStatus(403);
        $this->postJson("/api/clinic/payments/{$payment->id}/refund", ['reason' => 'x'])->assertStatus(403);

        Sanctum::actingAs($this->staffWith(['billing.edit']));
        $this->postJson("/api/clinic/invoices/{$invoice->id}/cancel", [])->assertOk();
        $this->postJson("/api/clinic/payments/{$payment->id}/refund", ['reason' => 'x'])->assertOk();
    }

    public function test_other_clinic_invoice_is_404_everywhere(): void
    {
        $other = $this->makeBillingClinic();
        $draft = $this->draftFor($other);
        $issued = $this->issuedFor($other);
        $payment = $this->invoiceService()->recordPayment($issued, ['amount' => 10, 'payment_method' => 'cash']);
        Sanctum::actingAs($this->receptionist());

        $this->getJson("/api/clinic/invoices/{$draft->id}")->assertNotFound();
        $this->putJson("/api/clinic/invoices/{$draft->id}", ['notes' => 'x'])->assertNotFound();
        $this->postJson("/api/clinic/invoices/{$draft->id}/issue")->assertNotFound();
        $this->postJson("/api/clinic/invoices/{$issued->id}/payments", ['amount' => 5, 'payment_method' => 'cash'])->assertNotFound();
        $this->postJson("/api/clinic/invoices/{$draft->id}/cancel", [])->assertNotFound();
        $this->postJson("/api/clinic/payments/{$payment->id}/refund", ['reason' => 'x'])->assertNotFound();
        $appt = $this->makeBillingAppointment($this->makeBillingPatient($other), $this->makeBillingDoctor($other));
        $this->getJson("/api/clinic/appointments/{$appt->id}/invoice-prefill")->assertNotFound();

        $this->assertSame('draft', $draft->fresh()->status);
        $this->assertCount(0, $this->getJson('/api/clinic/invoices')->json('data'));
    }

    public function test_super_admin_lists_across_clinics_and_filters_by_clinic_id(): void
    {
        $other = $this->makeBillingClinic();
        $a = $this->draftFor($this->clinic);
        $b = $this->draftFor($other);
        Sanctum::actingAs($this->superAdmin());

        $this->assertEqualsCanonicalizing([$a->id, $b->id], array_column($this->getJson('/api/super-admin/invoices')->assertOk()->json('data'), 'id'));
        $this->assertSame([$b->id], array_column($this->getJson("/api/super-admin/invoices?clinic_id={$other->id}")->json('data'), 'id'));
    }

    public function test_super_admin_twins_work_end_to_end(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $patient = $this->makeBillingPatient($this->clinic);
        $payload = ['patient_id' => $patient->id, 'items' => [['description' => 'X', 'quantity' => 1, 'unit_amount' => 100]]];

        $this->postJson('/api/super-admin/invoices', $payload)->assertStatus(422)->assertJsonValidationErrors('clinic_id');
        $id = $this->postJson('/api/super-admin/invoices', $payload + ['clinic_id' => $this->clinic->id])->assertCreated()->json('data.id');
        $this->assertSame($this->clinic->id, Invoice::find($id)->clinic_id);

        $this->putJson("/api/super-admin/invoices/{$id}", ['notes' => 'n'])->assertOk()->assertJsonPath('data.notes', 'n');
        $this->postJson("/api/super-admin/invoices/{$id}/issue")->assertOk()->assertJsonPath('data.status', 'issued');
        $pid = $this->postJson("/api/super-admin/invoices/{$id}/payments", ['amount' => 40, 'payment_method' => 'card'])->assertCreated()->json('data.id');
        $this->getJson("/api/super-admin/invoices/{$id}")->assertOk()->assertJsonCount(1, 'data.payments');
        $this->postJson("/api/super-admin/payments/{$pid}/refund", ['reason' => 'r'])->assertOk()->assertJsonPath('data.status', 'refunded');
        $this->postJson("/api/super-admin/invoices/{$id}/cancel", [])->assertOk()->assertJsonPath('data.status', 'cancelled');

        $other = $this->makeBillingClinic();
        $this->getJson("/api/super-admin/invoices/{$id}?clinic_id={$other->id}")->assertNotFound();
    }

    public function test_appointment_detail_carries_the_invoice_summary(): void
    {
        $patient = $this->makeBillingPatient($this->clinic);
        $appt = $this->makeBillingAppointment($patient, $this->makeBillingDoctor($this->clinic));
        $bare = $this->makeBillingAppointment($patient, $this->makeBillingDoctor($this->clinic));
        $invoice = $this->invoiceService()->issue($this->invoiceService()->draft($this->clinic->id, $this->draftData($patient, ['appointment_id' => $appt->id])));
        $this->invoiceService()->recordPayment($invoice, ['amount' => 300, 'payment_method' => 'cash']);

        Sanctum::actingAs($this->receptionist());
        $res = $this->getJson("/api/clinic/appointments/{$appt->id}/detail")->assertOk();
        $res->assertJsonPath('data.invoice.id', $invoice->id)
            ->assertJsonPath('data.invoice.number', $invoice->fresh()->invoice_number)
            ->assertJsonPath('data.invoice.status', 'issued');
        $this->assertEquals(801, $res->json('data.invoice.total'));
        $this->assertEquals(501, $res->json('data.invoice.balance'));
        $this->assertNull($this->getJson("/api/clinic/appointments/{$bare->id}/detail")->json('data.invoice'));

        Sanctum::actingAs($this->superAdmin());
        $this->getJson("/api/super-admin/appointments/{$appt->id}/detail")->assertOk()->assertJsonPath('data.invoice.id', $invoice->id);
    }

    public function test_cancelled_invoice_is_not_the_appointment_invoice(): void
    {
        $patient = $this->makeBillingPatient($this->clinic);
        $appt = $this->makeBillingAppointment($patient, $this->makeBillingDoctor($this->clinic));
        $invoice = $this->invoiceService()->draft($this->clinic->id, $this->draftData($patient, ['appointment_id' => $appt->id]));
        $this->invoiceService()->cancel($invoice);

        Sanctum::actingAs($this->receptionist());
        $this->assertNull($this->getJson("/api/clinic/appointments/{$appt->id}/detail")->json('data.invoice'));
    }

    public function test_prefill_returns_service_and_doctor_fee_lines(): void
    {
        $service = $this->makeBillingService($this->clinic, ['fee' => 250]);
        $doctor = $this->makeBillingDoctor($this->clinic, ['consultation_fee' => 400]);
        $appt = $this->makeBillingAppointment($this->makeBillingPatient($this->clinic), $doctor, $service);
        Sanctum::actingAs($this->receptionist());

        $res = $this->getJson("/api/clinic/appointments/{$appt->id}/invoice-prefill")->assertOk();

        $this->assertSame($appt->patient_id, $res->json('data.patient_id'));
        $this->assertSame($appt->id, $res->json('data.appointment_id'));
        $items = $res->json('data.items');
        $this->assertCount(2, $items);
        $this->assertSame($service->id, $items[0]['service_id']);
        $this->assertEquals(250, $items[0]['unit_amount']);
        $this->assertEquals(400, $items[1]['unit_amount']);
    }

    public function test_generic_invoice_and_payment_crud_is_retired(): void
    {
        $invoice = $this->draftFor($this->clinic);
        Sanctum::actingAs($this->receptionist());

        $this->postJson('/api/clinic/payments', ['invoice_id' => $invoice->id, 'amount' => 5])->assertStatus(404);
        $this->getJson('/api/clinic/payments')->assertStatus(404);
        $this->deleteJson("/api/clinic/invoices/{$invoice->id}")->assertStatus(405);

        Sanctum::actingAs($this->superAdmin());
        $this->postJson('/api/super-admin/payments', [])->assertStatus(404);
        $this->deleteJson("/api/super-admin/invoices/{$invoice->id}")->assertStatus(405);
    }
}
