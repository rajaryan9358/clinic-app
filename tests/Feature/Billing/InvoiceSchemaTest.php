<?php

namespace Tests\Feature\Billing;

use App\Models\Clinic;
use App\Models\ClinicSetting;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\Payment;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class InvoiceSchemaTest extends TestCase
{
    use RefreshDatabase;

    private function clinic(): Clinic
    {
        return Clinic::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Inv Clinic', 'slug' => 'inv-'.Str::random(6), 'status' => 'active',
        ]);
    }

    private function patient(Clinic $clinic): Patient
    {
        return Patient::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'first_name' => 'Pat', 'full_name' => 'Pat Ient',
            'phone' => '9'.random_int(100000000, 999999999),
        ]);
    }

    private function payment(Clinic $clinic, Patient $patient, array $overrides = []): Payment
    {
        $payment = new Payment;
        $payment->forceFill(array_merge([
            'clinic_id' => $clinic->id, 'patient_id' => $patient->id, 'amount' => 500,
            'payment_method' => 'online', 'paid_at' => now(), 'status' => 'pending',
        ], $overrides))->save();

        return $payment;
    }

    public function test_invoice_items_and_counters_tables_exist_with_their_columns(): void
    {
        $this->assertTrue(Schema::hasColumns('invoice_items', [
            'id', 'invoice_id', 'service_id', 'description', 'quantity', 'unit_amount', 'amount', 'sort_order',
        ]));
        $this->assertTrue(Schema::hasColumns('invoice_counters', [
            'id', 'clinic_id', 'period', 'next_number',
        ]));
        $this->assertTrue(Schema::hasColumns('invoices', [
            'issued_at', 'cancelled_at', 'cancelled_reason', 'created_by_user_id',
        ]));
        $this->assertTrue(Schema::hasColumns('payments', [
            'razorpay_order_id', 'razorpay_payment_id', 'refunded_at', 'refund_reason',
        ]));
        $this->assertTrue(Schema::hasColumns('clinic_settings', [
            'invoicing_enabled', 'online_payment_enabled', 'invoice_prefix', 'invoice_tax_percent', 'invoice_footer_note',
        ]));
    }

    public function test_payment_accepts_the_online_method_and_gateway_ids(): void
    {
        $clinic = $this->clinic();
        $payment = $this->payment($clinic, $this->patient($clinic), [
            'razorpay_order_id' => 'order_1', 'razorpay_payment_id' => 'pay_1',
            'refunded_at' => now(), 'refund_reason' => 'duplicate',
        ])->fresh();

        $this->assertSame('online', $payment->payment_method);
        $this->assertSame('order_1', $payment->razorpay_order_id);
        $this->assertSame('pay_1', $payment->razorpay_payment_id);
        $this->assertNotNull($payment->refunded_at);
        $this->assertSame('duplicate', $payment->refund_reason);
    }

    public function test_razorpay_payment_id_is_unique(): void
    {
        $clinic = $this->clinic();
        $patient = $this->patient($clinic);
        $this->payment($clinic, $patient, ['razorpay_payment_id' => 'pay_dup']);

        // Pending payments carry NULL ids, and several of those must coexist.
        $this->payment($clinic, $patient);
        $this->payment($clinic, $patient);

        $this->expectException(QueryException::class);
        $this->payment($clinic, $patient, ['razorpay_payment_id' => 'pay_dup']);
    }

    public function test_billing_settings_default_when_the_clinic_has_no_row(): void
    {
        $this->assertSame([
            'invoicing_enabled' => true,
            'online_payment_enabled' => false,
            'invoice_prefix' => 'INV',
            'invoice_tax_percent' => 0.0,
            'invoice_footer_note' => null,
        ], ClinicSetting::billingFor($this->clinic()->id));
    }

    public function test_billing_settings_row_values_win(): void
    {
        $clinic = $this->clinic();
        ClinicSetting::create([
            'clinic_id' => $clinic->id, 'invoicing_enabled' => false, 'online_payment_enabled' => true,
            'invoice_prefix' => 'BILL', 'invoice_tax_percent' => 12.5, 'invoice_footer_note' => 'Thanks',
        ]);

        $this->assertSame([
            'invoicing_enabled' => false,
            'online_payment_enabled' => true,
            'invoice_prefix' => 'BILL',
            'invoice_tax_percent' => 12.5,
            'invoice_footer_note' => 'Thanks',
        ], ClinicSetting::billingFor($clinic->id));
    }

    public function test_billing_settings_row_with_null_footer_note(): void
    {
        $clinic = $this->clinic();
        ClinicSetting::create(['clinic_id' => $clinic->id]);

        $billing = ClinicSetting::billingFor($clinic->id);

        $this->assertNull($billing['invoice_footer_note']);
        $this->assertSame('INV', $billing['invoice_prefix']);
        $this->assertTrue($billing['invoicing_enabled']);
    }

    public function test_gateway_and_lifecycle_columns_are_not_mass_assignable(): void
    {
        $clinic = $this->clinic();
        $patient = $this->patient($clinic);
        $user = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'U',
            'email' => 'u@inv.test', 'password' => 'x', 'role' => 'clinic_admin', 'status' => 'active',
        ]);

        $payment = Payment::create([
            'clinic_id' => $clinic->id, 'patient_id' => $patient->id, 'amount' => 1,
            'payment_method' => 'cash', 'paid_at' => now(),
            'razorpay_payment_id' => 'pay_X', 'razorpay_order_id' => 'order_X',
            'refunded_at' => now(), 'refund_reason' => 'x',
        ])->fresh();
        $this->assertNull($payment->razorpay_payment_id);
        $this->assertNull($payment->razorpay_order_id);
        $this->assertNull($payment->refunded_at);
        $this->assertNull($payment->refund_reason);

        $invoice = Invoice::create([
            'clinic_id' => $clinic->id, 'patient_id' => $patient->id, 'invoice_number' => 'INV-1',
            'invoice_date' => now()->toDateString(), 'subtotal' => 1, 'total_amount' => 1,
            'issued_at' => now(), 'cancelled_at' => now(), 'cancelled_reason' => 'x',
            'created_by_user_id' => $user->id,
        ])->fresh();
        $this->assertNull($invoice->issued_at);
        $this->assertNull($invoice->cancelled_at);
        $this->assertNull($invoice->cancelled_reason);
        $this->assertNull($invoice->created_by_user_id);
    }

    public function test_invoice_tax_percent_rejects_101_and_accepts_100(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);
        $clinic = $this->clinic();
        $setting = ClinicSetting::create(['clinic_id' => $clinic->id]);
        $user = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Admin',
            'email' => 'admin@inv.test', 'password' => 'x', 'role' => 'clinic_admin', 'status' => 'active',
        ]);
        $user->assignRole('clinic_admin');
        Sanctum::actingAs($user);

        $this->putJson("/api/clinic/settings/clinic/{$setting->id}", ['invoice_tax_percent' => 101])
            ->assertStatus(422);
        $this->putJson("/api/clinic/settings/clinic/{$setting->id}", ['invoice_tax_percent' => 100])
            ->assertOk();

        $this->assertEquals(100, $setting->fresh()->invoice_tax_percent);
    }
}
