<?php

namespace Tests\Feature;

use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AppointmentBookingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    public function test_receptionist_books_appointment_with_inline_new_patient(): void
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
        $doctor = Doctor::create(['clinic_id' => $clinic->id, 'full_name' => 'Dr A', 'slot_duration_minutes' => 30]);

        $date = Carbon::now()->addDays(2)->startOfDay();
        DoctorSchedule::create([
            'clinic_id' => $clinic->id,
            'doctor_id' => $doctor->id,
            'day_of_week' => $date->dayOfWeek,
            'start_time' => '10:00:00',
            'end_time' => '11:00:00',
            'consultation_mode' => 'in_person',
            'is_active' => true,
        ]);

        $receptionist = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Rita',
            'email' => 'rita@x.test', 'password' => 'x', 'role' => 'receptionist', 'status' => 'active',
        ]);
        $receptionist->assignRole('receptionist');
        Sanctum::actingAs($receptionist);

        $response = $this->postJson('/api/clinic/appointments', [
            'doctor_id' => $doctor->id,
            'appointment_date' => $date->toDateString(),
            'start_time' => '10:00',
            'end_time' => '10:30',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'patient' => [
                'phone' => '9000000001',
                'first_name' => 'New',
                'last_name' => 'Patient',
            ],
        ]);

        $response->assertCreated();
        $this->assertTrue($response->json('success'));
        $this->assertDatabaseHas('appointments', [
            'clinic_id' => $clinic->id,
            'doctor_id' => $doctor->id,
        ]);
        $this->assertDatabaseHas('patients', [
            'clinic_id' => $clinic->id,
            'phone' => '9000000001',
        ]);
    }
}
