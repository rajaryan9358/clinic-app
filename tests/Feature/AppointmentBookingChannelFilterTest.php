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
 * Task 7 of the patient-portal plan: staff can filter the appointment list
 * by `booking_channel` (including the new `portal` value) on both the
 * clinic and super-admin appointment index endpoints.
 */
class AppointmentBookingChannelFilterTest extends TestCase
{
    use RefreshDatabase;

    private Clinic $clinic;

    private Doctor $doctor;

    private Patient $patient;

    protected function setUp(): void
    {
        parent::setUp();

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
    }

    private function appointment(string $bookingChannel): Appointment
    {
        return Appointment::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $this->patient->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => Carbon::now()->toDateString(),
            'start_time' => '10:00:00',
            'end_time' => '10:30:00',
            'visit_type' => 'new',
            'booking_channel' => $bookingChannel,
            'status' => 'pending',
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

    public function test_clinic_index_filters_by_booking_channel_portal(): void
    {
        $portal = $this->appointment('portal');
        $this->appointment('walk_in');

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->getJson('/api/clinic/appointments?booking_channel=portal');

        $response->assertOk();
        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertSame([$portal->id], $ids);
    }

    public function test_super_admin_index_filters_by_booking_channel_portal(): void
    {
        $portal = $this->appointment('portal');
        $this->appointment('whatsapp');

        Sanctum::actingAs($this->superAdmin());
        $response = $this->getJson('/api/super-admin/appointments?booking_channel=portal');

        $response->assertOk();
        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertSame([$portal->id], $ids);
    }
}
