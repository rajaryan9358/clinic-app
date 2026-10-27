<?php

namespace Tests\Feature\Dashboards;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Str;

/**
 * Shared fixtures for the clinic dashboard / report tests.
 */
trait DashboardTestHelpers
{
    protected function makeClinic(string $name = 'C'): Clinic
    {
        return Clinic::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'slug' => Str::slug($name).'-'.Str::random(5),
            'status' => 'active',
        ]);
    }

    protected function makeDoctor(Clinic $clinic, string $name = 'Dr A', array $attrs = []): Doctor
    {
        return Doctor::create(array_merge([
            'clinic_id' => $clinic->id,
            'full_name' => $name,
            'slot_duration_minutes' => 30,
        ], $attrs));
    }

    protected function makePatient(Clinic $clinic, string $first = 'Test', string $last = 'Patient', array $attrs = []): Patient
    {
        return Patient::create(array_merge([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => $first,
            'last_name' => $last,
            'full_name' => "{$first} {$last}",
            'phone' => '9'.random_int(100000000, 999999999),
        ], $attrs));
    }

    protected function makeAppointment(Clinic $clinic, Doctor $doctor, Patient $patient, string $date, string $status = 'confirmed', array $attrs = []): Appointment
    {
        return Appointment::create(array_merge([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => $date,
            'start_time' => '23:00:00',
            'end_time' => '23:30:00',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => $status,
        ], $attrs));
    }

    /** User with one of the seeded system roles. */
    protected function makeUser(Clinic $clinic, string $role): User
    {
        $user = User::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => ucfirst($role),
            'email' => $role.'-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => $role,
            'status' => 'active',
        ]);
        $user->assignRole($role);

        return $user;
    }

    /** Staff-kind user on a custom role with exactly the given permissions. */
    protected function staffWith(Clinic $clinic, array $permissions): User
    {
        $role = Role::create(['name' => 'r'.Str::random(6), 'guard_name' => 'web', 'label' => 'R', 'kind' => 'staff']);
        $role->syncPermissions($permissions);
        $user = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'S',
            'email' => Str::random(6).'@x.test', 'password' => 'x', 'role' => $role->name, 'status' => 'active',
        ]);
        $user->syncRoles([$role->name]);

        return $user;
    }

    protected function makeAssistant(Clinic $clinic, array $doctors): User
    {
        $assistant = $this->makeUser($clinic, 'assistant');
        foreach ($doctors as $doctor) {
            $assistant->assignedDoctors()->attach($doctor->id, ['clinic_id' => $clinic->id]);
        }

        return $assistant;
    }

    protected function makeDoctorUser(Clinic $clinic, Doctor $doctor): User
    {
        $user = $this->makeUser($clinic, 'doctor');
        $doctor->update(['user_id' => $user->id]);

        return $user;
    }
}
