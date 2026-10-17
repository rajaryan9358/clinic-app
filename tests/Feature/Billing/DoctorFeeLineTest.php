<?php

namespace Tests\Feature\Billing;

use App\Models\Role;
use App\Models\User;
use App\Services\Billing\InvoiceService;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DoctorFeeLineTest extends TestCase
{
    use BillingTestHelpers, RefreshDatabase;

    private function staffWith(int $clinicId, array $permissions): User
    {
        $role = Role::create(['name' => 'r'.Str::random(6), 'guard_name' => 'web', 'label' => 'R', 'kind' => 'staff']);
        $role->syncPermissions($permissions);
        $u = User::create(['clinic_id' => $clinicId, 'uuid' => (string) Str::uuid(), 'full_name' => 'S',
            'email' => Str::random(6).'@x.test', 'password' => 'x', 'role' => $role->name, 'status' => 'active']);
        $u->syncRoles([$role->name]);

        return $u;
    }

    public function test_picked_and_prefilled_fee_lines_are_identical(): void
    {
        $clinic = $this->makeBillingClinic();
        $doctor = $this->makeBillingDoctor($clinic, ['full_name' => 'Dr Asha Rao', 'consultation_fee' => 500, 'followup_fee' => 250]);
        $service = $this->makeBillingService($clinic, ['fee' => 100]);
        $patient = $this->makeBillingPatient($clinic);

        foreach (['new' => 'Consultation - Dr Asha Rao', 'followup' => 'Follow-up consultation - Dr Asha Rao'] as $visit => $text) {
            $appointment = $this->makeBillingAppointment($patient, $doctor, $service, $visit);
            $line = InvoiceService::doctorFeeLine($doctor, $appointment->visit_type);
            $prefill = $this->invoiceService()->prefillFor($appointment);

            $this->assertSame($text, $line['description']);
            $this->assertContains($line, $prefill);
            $this->assertSame($line, end($prefill));
        }
    }

    public function test_doctor_without_a_fee_offers_no_line(): void
    {
        $clinic = $this->makeBillingClinic();
        $none = $this->makeBillingDoctor($clinic, ['consultation_fee' => null, 'followup_fee' => null]);
        $zero = $this->makeBillingDoctor($clinic, ['consultation_fee' => 0, 'followup_fee' => 0]);

        foreach ([$none, $zero] as $doctor) {
            $this->assertNull(InvoiceService::doctorFeeLine($doctor, 'new'));
            $this->assertNull(InvoiceService::doctorFeeLine($doctor, 'followup'));
        }
    }

    public function test_followup_visit_uses_the_followup_fee(): void
    {
        $clinic = $this->makeBillingClinic();
        $doctor = $this->makeBillingDoctor($clinic, ['full_name' => 'Dr Asha Rao', 'consultation_fee' => 500, 'followup_fee' => 250]);

        $followup = InvoiceService::doctorFeeLine($doctor, 'followup');
        $this->assertSame(250.0, $followup['unit_amount']);
        $this->assertSame(['description', 'service_id', 'quantity', 'unit_amount'], array_keys($followup));
        $this->assertNull($followup['service_id']);
        $this->assertSame(1, $followup['quantity']);
        $this->assertSame(500.0, InvoiceService::doctorFeeLine($doctor, 'new')['unit_amount']);
        $this->assertSame(500.0, InvoiceService::doctorFeeLine($doctor, 'something-else')['unit_amount']);
    }

    public function test_doctors_list_carries_both_fees(): void
    {
        $clinic = $this->makeBillingClinic();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->makeBillingDoctor($clinic, ['consultation_fee' => 500, 'followup_fee' => 250]);
        Sanctum::actingAs($this->staffWith($clinic->id, ['doctors.view']));

        $row = $this->getJson('/api/clinic/doctors')->assertOk()->json('data.0');
        $this->assertEquals(500, $row['consultation_fee']);
        $this->assertEquals(250, $row['followup_fee']);
    }

    public function test_doctor_fees_require_doctors_view(): void
    {
        $clinic = $this->makeBillingClinic();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->makeBillingDoctor($clinic, ['consultation_fee' => 500]);
        Sanctum::actingAs($this->staffWith($clinic->id, ['billing.view']));

        $this->getJson('/api/clinic/doctors')->assertStatus(403);
    }
}
