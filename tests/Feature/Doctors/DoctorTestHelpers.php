<?php

namespace Tests\Feature\Doctors;

use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\DoctorScheduleException;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Support\Str;
use Spatie\Permission\PermissionRegistrar;

/**
 * Fixtures for the clinic doctor / profile / schedule tests. Call
 * setUpDoctors() from setUp(): it seeds the role catalogue and creates
 * clinic A (the acting clinic) and clinic B (a foreign tenant).
 */
trait DoctorTestHelpers
{
    protected Clinic $clinic;

    protected Clinic $otherClinic;

    protected function setUpDoctors(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->clinic = $this->makeClinic('a');
        $this->otherClinic = $this->makeClinic('b');
    }

    protected function makeClinic(string $slug): Clinic
    {
        return Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'Clinic '.strtoupper($slug), 'slug' => $slug, 'status' => 'active']);
    }

    protected function makeUser(string $role, ?Clinic $clinic = null): User
    {
        $clinic ??= $this->clinic;
        $user = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => ucfirst($role),
            'email' => Str::random(8).'@x.test', 'password' => 'x', 'role' => $role, 'status' => 'active',
        ]);
        $user->assignRole($role);

        return $user;
    }

    /** A custom role of the given kind holding exactly $permissions. */
    protected function makeRole(string $name, string $kind, array $permissions): Role
    {
        $role = Role::create(['name' => $name, 'guard_name' => 'web', 'label' => $name, 'kind' => $kind, 'limit_to_assigned_doctors' => false, 'is_system' => false]);
        $role->syncPermissions($permissions);
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        return $role;
    }

    protected function makeDoctor(array $attrs = [], ?Clinic $clinic = null): Doctor
    {
        $clinic ??= $this->clinic;

        return Doctor::create(array_merge([
            'clinic_id' => $clinic->id, 'full_name' => 'Dr '.Str::random(5), 'slot_duration_minutes' => 30, 'status' => 'active',
        ], $attrs));
    }

    /** A doctor-role user linked to a doctor record in the given clinic. */
    protected function makeDoctorUser(?Clinic $clinic = null): array
    {
        $clinic ??= $this->clinic;
        $user = $this->makeUser('doctor', $clinic);
        $doctor = $this->makeDoctor(['user_id' => $user->id, 'full_name' => 'Dr Self'], $clinic);

        return [$user, $doctor];
    }

    protected function makeSchedule(Doctor $doctor, array $attrs = []): DoctorSchedule
    {
        return DoctorSchedule::create(array_merge([
            'clinic_id' => $doctor->clinic_id, 'doctor_id' => $doctor->id, 'day_of_week' => 1,
            'start_time' => '10:00:00', 'end_time' => '11:00:00', 'consultation_mode' => 'in_person', 'is_active' => true,
        ], $attrs));
    }

    protected function makeException(Doctor $doctor, array $attrs = []): DoctorScheduleException
    {
        return DoctorScheduleException::create(array_merge([
            'clinic_id' => $doctor->clinic_id, 'doctor_id' => $doctor->id, 'exception_date' => '2026-11-04', 'type' => 'leave',
        ], $attrs));
    }
}
