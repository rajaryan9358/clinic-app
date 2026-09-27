<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\AppointmentPrescription;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\User;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\WhatsAppGateway;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Prescription draft/final status: the staff "finalize" endpoint and the
 * "send to patient" gate that requires a final prescription. See
 * App\Support\Prescriptions\PrescriptionResolver and the Clinic/SuperAdmin
 * AppointmentController::{finalizePrescription,sendPrescription}.
 */
class PrescriptionFinalizeTest extends TestCase
{
    use RefreshDatabase;

    private Clinic $clinic;

    private Doctor $doctor;

    private Patient $patient;

    private Appointment $appointment;

    protected function setUp(): void
    {
        parent::setUp();

        $this->app->instance(WhatsAppGateway::class, new FakeWhatsAppGateway);

        $this->seed(RolesAndPermissionsSeeder::class);

        $this->clinic = Clinic::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Sunrise Clinic',
            'slug' => 'sunrise-clinic-'.Str::random(6),
            'status' => 'active',
        ]);

        $this->doctor = Doctor::create([
            'clinic_id' => $this->clinic->id,
            'full_name' => 'Dr Asha Rao',
            'slot_duration_minutes' => 30,
        ]);

        $this->patient = Patient::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Ravi',
            'full_name' => 'Ravi Kumar',
            'phone' => '9876543210',
        ]);

        $this->appointment = Appointment::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $this->patient->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => Carbon::now()->toDateString(),
            'start_time' => '10:00:00',
            'end_time' => '10:30:00',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => 'completed',
        ]);
    }

    private function clinicAdmin(): User
    {
        $user = User::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Amit Admin',
            'email' => 'amit-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => 'clinic_admin',
            'status' => 'active',
        ]);
        $user->assignRole('clinic_admin');

        return $user;
    }

    private function receptionist(): User
    {
        $user = User::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Rita Reception',
            'email' => 'rita-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => 'receptionist',
            'status' => 'active',
        ]);
        $user->assignRole('receptionist');

        return $user;
    }

    private function superAdmin(): User
    {
        $user = User::create([
            'clinic_id' => null,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Super Admin',
            'email' => 'super-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => 'super_admin',
            'status' => 'active',
        ]);
        $user->assignRole('super_admin');

        return $user;
    }

    private function rx(array $overrides = []): AppointmentPrescription
    {
        return AppointmentPrescription::create(array_merge([
            'clinic_id' => $this->clinic->id,
            'appointment_id' => $this->appointment->id,
            'data' => ['notes' => 'Take rest'],
        ], $overrides));
    }

    // --- Clinic: finalize ----------------------------------------------

    public function test_clinic_finalize_sets_status_and_finalized_fields(): void
    {
        $rx = $this->rx();
        $admin = $this->clinicAdmin();

        Sanctum::actingAs($admin);
        $response = $this->postJson("/api/clinic/appointments/{$this->appointment->id}/prescription/finalize");

        $response->assertOk();
        $this->assertTrue($response->json('success'));

        $rx->refresh();
        $this->assertSame('final', $rx->status);
        $this->assertNotNull($rx->finalized_at);
        $this->assertSame($admin->id, $rx->finalized_by_user_id);
        $this->assertSame('final', $response->json('data.status'));
    }

    public function test_clinic_finalize_with_no_prescription_returns_404(): void
    {
        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->postJson("/api/clinic/appointments/{$this->appointment->id}/prescription/finalize");

        $response->assertNotFound();
    }

    public function test_clinic_finalize_already_final_returns_422(): void
    {
        $this->rx(['status' => 'final', 'finalized_at' => now()]);

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->postJson("/api/clinic/appointments/{$this->appointment->id}/prescription/finalize");

        $response->assertStatus(422);
        $this->assertSame('This prescription is already final.', $response->json('message'));
    }

    public function test_clinic_finalize_requires_prescribe_permission(): void
    {
        $this->rx();

        Sanctum::actingAs($this->receptionist());
        $response = $this->postJson("/api/clinic/appointments/{$this->appointment->id}/prescription/finalize");

        $response->assertForbidden();
    }

    // --- Clinic: send requires final ------------------------------------

    public function test_clinic_send_with_draft_latest_returns_422_even_if_older_final_exists(): void
    {
        $this->rx(['status' => 'final', 'finalized_at' => now()]);
        $this->rx(['status' => 'draft']);

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->postJson("/api/clinic/appointments/{$this->appointment->id}/prescription/send");

        $response->assertStatus(422);
        $this->assertSame('Finalize the prescription first.', $response->json('message'));
    }

    public function test_clinic_send_with_final_latest_succeeds(): void
    {
        $this->rx(['status' => 'final', 'finalized_at' => now()]);

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->postJson("/api/clinic/appointments/{$this->appointment->id}/prescription/send");

        $response->assertOk();
        $this->assertTrue($response->json('success'));
    }

    public function test_clinic_prescription_get_includes_status_finalized_at_and_latest_final_id(): void
    {
        $final = $this->rx(['status' => 'final', 'finalized_at' => now()]);
        $draft = $this->rx(['status' => 'draft']);

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->getJson("/api/clinic/appointments/{$this->appointment->id}/prescription");

        $response->assertOk();
        $data = $response->json('data');

        $this->assertSame($draft->id, $data['prescription']['id']);
        $this->assertSame('draft', $data['status']);
        $this->assertNull($data['finalized_at']);
        $this->assertSame($final->id, $data['latest_final_id']);
    }

    // --- Super-admin: finalize / send ------------------------------------

    public function test_super_admin_finalize_sets_status(): void
    {
        $rx = $this->rx();

        Sanctum::actingAs($this->superAdmin());
        $response = $this->postJson("/api/super-admin/appointments/{$this->appointment->id}/prescription/finalize");

        $response->assertOk();
        $rx->refresh();
        $this->assertSame('final', $rx->status);
        $this->assertNotNull($rx->finalized_at);
    }

    public function test_super_admin_finalize_already_final_returns_422(): void
    {
        $this->rx(['status' => 'final', 'finalized_at' => now()]);

        Sanctum::actingAs($this->superAdmin());
        $response = $this->postJson("/api/super-admin/appointments/{$this->appointment->id}/prescription/finalize");

        $response->assertStatus(422);
        $this->assertSame('This prescription is already final.', $response->json('message'));
    }

    public function test_super_admin_send_with_draft_latest_returns_422_even_if_older_final_exists(): void
    {
        $this->rx(['status' => 'final', 'finalized_at' => now()]);
        $this->rx(['status' => 'draft']);

        Sanctum::actingAs($this->superAdmin());
        $response = $this->postJson("/api/super-admin/appointments/{$this->appointment->id}/prescription/send");

        $response->assertStatus(422);
        $this->assertSame('Finalize the prescription first.', $response->json('message'));
    }

    public function test_super_admin_send_with_final_latest_succeeds(): void
    {
        $this->rx(['status' => 'final', 'finalized_at' => now()]);

        Sanctum::actingAs($this->superAdmin());
        $response = $this->postJson("/api/super-admin/appointments/{$this->appointment->id}/prescription/send");

        $response->assertOk();
        $this->assertTrue($response->json('success'));
    }

    // --- Staff prescription.pdf still works for drafts -------------------

    public function test_clinic_prescription_pdf_works_for_draft_only(): void
    {
        $this->rx(['status' => 'draft']);

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->get("/api/clinic/appointments/{$this->appointment->id}/prescription.pdf");

        $response->assertOk();
        $response->assertHeader('Content-Type', 'application/pdf');
    }
}
