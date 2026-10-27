<?php

namespace Tests\Feature\Patients;

use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Str;

/**
 * Fixture helpers for the clinic patients API tests: clinics, patients,
 * seeded-role users, ad-hoc permission roles and linked doctor users.
 * Expects RolesAndPermissionsSeeder to have been run in setUp().
 */
trait PatientTestHelpers
{
    protected function makeClinic(string $name = 'Clinic'): Clinic
    {
        return Clinic::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name.' '.Str::random(4),
            'slug' => Str::slug($name).'-'.Str::random(6),
            'status' => 'active',
        ]);
    }

    protected function makePatient(Clinic $clinic, array $attrs = []): Patient
    {
        return Patient::create(array_merge([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Test',
            'last_name' => 'Patient',
            'phone' => '98765'.random_int(10000, 99999),
        ], $attrs));
    }

    protected function makeUser(Clinic $clinic, string $role = 'clinic_admin', array $attrs = []): User
    {
        $user = User::create(array_merge([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => ucfirst($role).' User',
            'email' => $role.'-'.Str::random(8).'@x.test',
            'password' => 'x',
            'role' => $role,
            'status' => 'active',
        ], $attrs));
        $user->syncRoles([$role]);

        return $user;
    }

    /** A staff-kind user holding exactly the given permissions. */
    protected function staffWith(Clinic $clinic, array $permissions): User
    {
        $role = Role::create([
            'name' => 'r'.Str::random(8),
            'guard_name' => 'web',
            'label' => 'Custom',
            'kind' => 'staff',
        ]);
        $role->syncPermissions($permissions);

        return $this->makeUser($clinic, $role->name);
    }

    protected function makeDoctor(Clinic $clinic, ?User $user = null, array $attrs = []): Doctor
    {
        return Doctor::create(array_merge([
            'clinic_id' => $clinic->id,
            'user_id' => $user?->id,
            'full_name' => 'Dr '.Str::random(5),
            'slot_duration_minutes' => 30,
        ], $attrs));
    }

    /** A doctor-role user plus its linked Doctor row (required by clinic.context). */
    protected function makeDoctorUser(Clinic $clinic): array
    {
        $user = $this->makeUser($clinic, 'doctor');
        $doctor = $this->makeDoctor($clinic, $user);

        return [$user, $doctor];
    }
}
