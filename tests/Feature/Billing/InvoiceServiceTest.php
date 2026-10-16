<?php

namespace Tests\Feature\Billing;

use App\Models\InvoiceCounter;
use App\Models\User;
use App\Services\Billing\InvoiceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class InvoiceServiceTest extends TestCase
{
    use BillingTestHelpers, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-16 10:00:00'));
    }

    public function test_draft_computes_subtotal_tax_and_total(): void
    {
        $clinic = $this->makeBillingClinic(['invoice_tax_percent' => 10]);
        $patient = $this->makeBillingPatient($clinic);

        $user = User::create(['clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Rita', 'email' => 'r-'.Str::random(6).'@x.test', 'password' => 'x', 'role' => 'receptionist', 'status' => 'active']);

        $invoice = $this->invoiceService()->draft($clinic->id, $this->draftData($patient, ['discount_amount' => 100]), $user->id);

        // subtotal 500 + 301 = 801; (801 - 100) * 10% = 70.10; total 771.10
        $this->assertSame('801.00', $invoice->subtotal);
        $this->assertSame('100.00', $invoice->discount_amount);
        $this->assertSame('70.10', $invoice->tax_amount);
        $this->assertSame('771.10', $invoice->total_amount);
        $this->assertSame('draft', $invoice->status);
        $this->assertSame($user->id, $invoice->created_by_user_id);
        $this->assertCount(2, $invoice->items);
        $this->assertSame('301.00', $invoice->items[1]->amount);
    }

    public function test_explicit_tax_amount_overrides_the_clinic_percent(): void
    {
        $clinic = $this->makeBillingClinic(['invoice_tax_percent' => 10]);
        $patient = $this->makeBillingPatient($clinic);

        $invoice = $this->invoiceService()->draft($clinic->id, $this->draftData($patient, ['tax_amount' => 25]));

        $this->assertSame('25.00', $invoice->tax_amount);
        $this->assertSame('826.00', $invoice->total_amount);
    }

    public function test_discount_above_subtotal_is_422(): void
    {
        $clinic = $this->makeBillingClinic();
        $patient = $this->makeBillingPatient($clinic);

        $this->assertValidationMessage('The discount cannot be more than the subtotal.', fn () => $this->invoiceService()
            ->draft($clinic->id, $this->draftData($patient, ['discount_amount' => 801.01])));
    }

    public function test_update_replaces_items_and_recomputes_totals(): void
    {
        $clinic = $this->makeBillingClinic();
        $patient = $this->makeBillingPatient($clinic);
        $invoice = $this->invoiceService()->draft($clinic->id, $this->draftData($patient));

        $updated = $this->invoiceService()->update($invoice, [
            'items' => [['description' => 'Only', 'quantity' => 3, 'unit_amount' => 100]],
        ]);

        $this->assertSame('300.00', $updated->subtotal);
        $this->assertSame('300.00', $updated->total_amount);
        $this->assertCount(1, $updated->items);
        $this->assertSame(1, $invoice->items()->count());
    }

    public function test_issue_allocates_the_first_number_of_the_financial_year(): void
    {
        $clinic = $this->makeBillingClinic();
        $invoice = $this->invoiceService()->draft($clinic->id, $this->draftData($this->makeBillingPatient($clinic)));

        $issued = $this->invoiceService()->issue($invoice);

        $this->assertSame('INV/2026-27/00001', $issued->invoice_number);
        $this->assertSame('issued', $issued->status);
        $this->assertNotNull($issued->issued_at);
        $this->assertSame('INV/2026-27/00001', $invoice->fresh()->invoice_number);
    }

    public function test_second_invoice_gets_the_next_number(): void
    {
        $clinic = $this->makeBillingClinic(['invoice_prefix' => 'ABC']);
        $patient = $this->makeBillingPatient($clinic);
        $a = $this->invoiceService()->issue($this->invoiceService()->draft($clinic->id, $this->draftData($patient)));
        $b = $this->invoiceService()->issue($this->invoiceService()->draft($clinic->id, $this->draftData($patient)));

        $this->assertSame('ABC/2026-27/00001', $a->invoice_number);
        $this->assertSame('ABC/2026-27/00002', $b->invoice_number);
    }

    public function test_numbers_are_per_clinic(): void
    {
        $c1 = $this->makeBillingClinic();
        $c2 = $this->makeBillingClinic();
        $a = $this->invoiceService()->issue($this->invoiceService()->draft($c1->id, $this->draftData($this->makeBillingPatient($c1))));
        $b = $this->invoiceService()->issue($this->invoiceService()->draft($c2->id, $this->draftData($this->makeBillingPatient($c2))));

        $this->assertSame('INV/2026-27/00001', $a->invoice_number);
        $this->assertSame('INV/2026-27/00001', $b->invoice_number);
    }

    public function test_financial_year_runs_april_to_march(): void
    {
        $this->assertSame('2026-27', InvoiceService::financialYear(Carbon::parse('2026-04-01')));
        $this->assertSame('2025-26', InvoiceService::financialYear(Carbon::parse('2026-03-31')));
        $this->assertSame('2026-27', InvoiceService::financialYear(Carbon::parse('2027-03-31')));
        $this->assertSame('2099-00', InvoiceService::financialYear(Carbon::parse('2099-12-01')));
    }

    public function test_issuing_twice_is_422(): void
    {
        $clinic = $this->makeBillingClinic();
        $invoice = $this->invoiceService()->draft($clinic->id, $this->draftData($this->makeBillingPatient($clinic)));
        $this->invoiceService()->issue($invoice);

        $this->assertValidationMessage('This invoice has already been issued.', fn () => $this->invoiceService()->issue($invoice));
        $this->assertSame(2, InvoiceCounter::where('clinic_id', $clinic->id)->value('next_number'));
    }

    public function test_editing_an_issued_invoice_is_422(): void
    {
        $clinic = $this->makeBillingClinic();
        $invoice = $this->invoiceService()->draft($clinic->id, $this->draftData($this->makeBillingPatient($clinic)));
        $this->invoiceService()->issue($invoice);

        $this->assertValidationMessage('Only a draft invoice can be edited.', fn () => $this->invoiceService()->update($invoice, ['notes' => 'x']));
    }

    public function test_cancel_keeps_the_number(): void
    {
        $clinic = $this->makeBillingClinic();
        $invoice = $this->invoiceService()->draft($clinic->id, $this->draftData($this->makeBillingPatient($clinic)));
        $issued = $this->invoiceService()->issue($invoice);

        $cancelled = $this->invoiceService()->cancel($issued, 'Duplicate');

        $this->assertSame('cancelled', $cancelled->status);
        $this->assertSame('INV/2026-27/00001', $cancelled->invoice_number);
        $this->assertSame('Duplicate', $cancelled->cancelled_reason);
        $this->assertNotNull($cancelled->cancelled_at);
    }

    public function test_prefill_suggests_service_and_doctor_fee_lines(): void
    {
        $clinic = $this->makeBillingClinic();
        $doctor = $this->makeBillingDoctor($clinic, ['consultation_fee' => 600, 'followup_fee' => 300]);
        $service = $this->makeBillingService($clinic, ['fee' => 250]);
        $patient = $this->makeBillingPatient($clinic);

        $new = $this->invoiceService()->prefillFor($this->makeBillingAppointment($patient, $doctor, $service, 'new'));
        $follow = $this->invoiceService()->prefillFor($this->makeBillingAppointment($patient, $doctor, $service, 'followup'));
        $bare = $this->invoiceService()->prefillFor($this->makeBillingAppointment($patient, $this->makeBillingDoctor($clinic, ['consultation_fee' => 0])));

        $this->assertCount(2, $new);
        $this->assertSame($service->id, $new[0]['service_id']);
        $this->assertEquals(250, $new[0]['unit_amount']);
        $this->assertSame(1, $new[0]['quantity']);
        $this->assertEquals(600, $new[1]['unit_amount']);
        $this->assertEquals(300, $follow[1]['unit_amount']);
        $this->assertSame([], $bare);
    }

    public function test_concurrent_issue_allocates_distinct_numbers(): void
    {
        // SQLite ignores lockForUpdate(); this pins sequential allocation and the
        // counter arithmetic (the lock itself protects MySQL in production).
        $clinic = $this->makeBillingClinic();
        $patient = $this->makeBillingPatient($clinic);
        $a = $this->invoiceService()->draft($clinic->id, $this->draftData($patient));
        $b = $this->invoiceService()->draft($clinic->id, $this->draftData($patient));

        $numbers = DB::transaction(fn () => [
            $this->invoiceService()->issue($a)->invoice_number,
            $this->invoiceService()->issue($b)->invoice_number,
        ]);

        $this->assertNotSame($numbers[0], $numbers[1]);
        $this->assertSame(3, InvoiceCounter::where('clinic_id', $clinic->id)->where('period', '2026-27')->value('next_number'));
    }
}
