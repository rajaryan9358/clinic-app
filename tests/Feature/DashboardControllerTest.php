<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Regression coverage for the receptionist/assistant dashboard endpoints.
 *
 * Both queries clone a base Appointment query, then left-join `patients`
 * and `doctors` to build the "upcoming" list. `patients` and `doctors` each
 * have their own `clinic_id` and (for doctors) `status` columns, so once
 * those joins are added, an unqualified `where('clinic_id', ...)` or
 * `whereIn('status', ...)` becomes ambiguous to MySQL and the endpoint
 * throws a 500 (SQLSTATE[23000] ... ambiguous). See the fix in
 * DashboardController::receptionist()/assistant() which qualifies those
 * columns with `appointments.`.
 */
class DashboardControllerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    private function makeClinicWithUpcomingAppointment(): array
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
        $doctor = Doctor::create(['clinic_id' => $clinic->id, 'full_name' => 'Dr A', 'slot_duration_minutes' => 30]);
        $patient = Patient::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Test',
            'last_name' => 'Patient',
            'phone' => '9000000002',
        ]);

        // Dashboards read the clinic-local clock; pin it mid-morning so the
        // appointment is always later on the same clinic day.
        $clinicNow = Carbon::now(config('app.clinic_timezone'))->setTime(10, 0);
        Carbon::setTestNow($clinicNow);

        $appointment = Appointment::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => $clinicNow->toDateString(),
            'start_time' => $clinicNow->copy()->addHour()->format('H:i:s'),
            'end_time' => $clinicNow->copy()->addHour()->addMinutes(30)->format('H:i:s'),
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => 'confirmed',
        ]);

        return [$clinic, $doctor, $patient, $appointment];
    }

    public function test_receptionist_dashboard_does_not_error_on_ambiguous_clinic_id(): void
    {
        [$clinic, $doctor, $patient, $appointment] = $this->makeClinicWithUpcomingAppointment();

        $receptionist = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Rita',
            'email' => 'rita@x.test', 'password' => 'x', 'role' => 'receptionist', 'status' => 'active',
        ]);
        $receptionist->assignRole('receptionist');
        Sanctum::actingAs($receptionist);

        $response = $this->getJson('/api/clinic/dashboard/receptionist');

        $response->assertOk();
        $this->assertTrue($response->json('success'));
        $this->assertSame(1, $response->json('data.kpis.total_today'));
        $this->assertCount(1, $response->json('data.upcoming'));
        $this->assertSame($appointment->id, $response->json('data.upcoming.0.id'));
        $this->assertSame('Test Patient', $response->json('data.upcoming.0.patient_name'));
        $this->assertSame('Dr A', $response->json('data.upcoming.0.doctor_name'));
    }

    public function test_assistant_dashboard_does_not_error_on_ambiguous_clinic_id(): void
    {
        [$clinic, $doctor, $patient, $appointment] = $this->makeClinicWithUpcomingAppointment();

        $assistant = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Amy',
            'email' => 'amy@x.test', 'password' => 'x', 'role' => 'assistant', 'status' => 'active',
        ]);
        $assistant->assignRole('assistant');
        $assistant->assignedDoctors()->attach($doctor->id, ['clinic_id' => $clinic->id]);
        Sanctum::actingAs($assistant);

        $response = $this->getJson('/api/clinic/dashboard/assistant');

        $response->assertOk();
        $this->assertTrue($response->json('success'));
        $this->assertSame(1, $response->json('data.kpis.total_today'));
        $this->assertCount(1, $response->json('data.upcoming'));
        $this->assertSame($appointment->id, $response->json('data.upcoming.0.id'));
        $this->assertSame('Test Patient', $response->json('data.upcoming.0.patient_name'));
        $this->assertSame('Dr A', $response->json('data.upcoming.0.doctor_name'));
    }
}
