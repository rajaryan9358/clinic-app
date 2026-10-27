<?php

namespace Tests\Feature\Appointments;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\Patient;
use App\Models\Role;
use App\Models\User;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\WhatsAppGateway;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

/**
 * Shared fixtures for the staff appointment API tests: clinic A (with a
 * doctor working every day 09:00-12:00 in 30-minute slots) and clinic B
 * (its own doctor), WhatsApp faked, the clock frozen at 2026-10-01 10:00
 * UTC. Call setUpAppointments() from setUp().
 */
trait AppointmentTestHelpers
{
    protected FakeWhatsAppGateway $fake;

    protected Clinic $clinic;

    protected Doctor $doctor;

    protected Clinic $otherClinic;

    protected Doctor $otherDoctor;

    protected string $today = '2026-10-01';

    protected string $tomorrow = '2026-10-02';

    protected string $yesterday = '2026-09-30';

    protected function setUpAppointments(): void
    {
        $this->fake = new FakeWhatsAppGateway;
        $this->app->instance(WhatsAppGateway::class, $this->fake);

        $this->seed(RolesAndPermissionsSeeder::class);

        $this->travelTo(Carbon::parse('2026-10-01 10:00:00', 'UTC'));

        $this->clinic = $this->makeClinic('A');
        $this->doctor = $this->makeDoctor($this->clinic);
        $this->otherClinic = $this->makeClinic('B');
        $this->otherDoctor = $this->makeDoctor($this->otherClinic, 'Dr Other');
    }

    protected function makeClinic(string $name): Clinic
    {
        return Clinic::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Clinic '.$name,
            'slug' => 'clinic-'.Str::lower($name).'-'.Str::random(6),
            'status' => 'active',
        ]);
    }

    protected function makeDoctor(Clinic $clinic, string $name = 'Dr Asha Rao', array $attrs = []): Doctor
    {
        $doctor = Doctor::create(array_merge([
            'clinic_id' => $clinic->id,
            'full_name' => $name,
            'status' => 'active',
            'slot_duration_minutes' => 30,
        ], $attrs));

        for ($day = 0; $day <= 6; $day++) {
            DoctorSchedule::create([
                'clinic_id' => $clinic->id,
                'doctor_id' => $doctor->id,
                'day_of_week' => $day,
                'start_time' => '09:00:00',
                'end_time' => '12:00:00',
                'consultation_mode' => 'in_person',
                'slot_duration_minutes' => 30,
                'is_active' => true,
            ]);
        }

        return $doctor;
    }

    protected function makePatient(?Clinic $clinic = null, array $attrs = []): Patient
    {
        return Patient::create(array_merge([
            'clinic_id' => ($clinic ?? $this->clinic)->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Ravi',
            'full_name' => 'Ravi Kumar',
            'phone' => '98765'.random_int(10000, 99999),
        ], $attrs));
    }

    protected function makeAppointment(array $overrides = []): Appointment
    {
        $clinicId = $overrides['clinic_id'] ?? $this->clinic->id;
        $patientId = $overrides['patient_id']
            ?? $this->makePatient(Clinic::find($clinicId))->id;

        return Appointment::create(array_merge([
            'clinic_id' => $clinicId,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $patientId,
            'doctor_id' => $clinicId === $this->clinic->id ? $this->doctor->id : $this->otherDoctor->id,
            'appointment_date' => $this->tomorrow,
            'start_time' => '10:00:00',
            'end_time' => '10:30:00',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => 'confirmed',
        ], $overrides));
    }

    protected function staff(string $role = 'receptionist', ?Clinic $clinic = null): User
    {
        $user = User::create([
            'clinic_id' => ($clinic ?? $this->clinic)->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => ucfirst($role).' User',
            'email' => $role.'-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => $role,
            'status' => 'active',
        ]);
        $user->assignRole($role);

        return $user;
    }

    /** A custom staff-kind role holding exactly $permissions. */
    protected function staffWith(array $permissions, ?Clinic $clinic = null): User
    {
        $role = Role::create(['name' => 'r'.Str::random(6), 'guard_name' => 'web', 'label' => 'R', 'kind' => 'staff']);
        $role->syncPermissions($permissions);
        $user = User::create([
            'clinic_id' => ($clinic ?? $this->clinic)->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Custom',
            'email' => Str::random(8).'@x.test',
            'password' => 'x',
            'role' => $role->name,
            'status' => 'active',
        ]);
        $user->syncRoles([$role->name]);

        return $user;
    }

    protected function actingAsStaff(string $role = 'receptionist', ?Clinic $clinic = null): User
    {
        $user = $this->staff($role, $clinic);
        Sanctum::actingAs($user);

        return $user;
    }

    protected function bookingPayload(array $overrides = []): array
    {
        return array_merge([
            'doctor_id' => $this->doctor->id,
            'appointment_date' => $this->tomorrow,
            'start_time' => '10:00',
            'end_time' => '10:30',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
        ], $overrides);
    }
}
