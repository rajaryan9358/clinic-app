<?php

namespace App\Services;

use App\Models\Doctor;
use App\Models\Role;
use App\Models\User;
use App\Services\Billing\PlanLimits;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class DoctorManagementService
{
    /**
     * Resolve the role for a linked doctor login: the given `linked_user.role` (must
     * be a doctor-kind role) or the system `doctor` role by default. A non-admin actor
     * (e.g. a staff.create/doctors.create holder onboarding a doctor) may only hand
     * out permissions they hold themselves — including via the default `doctor` role,
     * which typically carries far more than a doctors.create-only actor has. This
     * mirrors UserManagementService::assertAssignable and closes the same takeover
     * path through the doctor-onboarding form.
     */
    private function assertDoctorRole(?string $roleName, ?User $actor = null): Role
    {
        $roleName = $roleName ?: 'doctor';
        $role = Role::where('name', $roleName)->where('guard_name', 'web')->first();

        if (! $role || $role->kind !== 'doctor') {
            throw ValidationException::withMessages(['linked_user.role' => ['The selected role is invalid.']]);
        }

        if ($actor !== null && ! in_array($actor->roleKind(), ['clinic_admin', 'super_admin'], true)) {
            $rolePermissions = $role->permissions->pluck('name');
            $actorPermissions = $actor->getAllPermissions()->pluck('name');

            if ($rolePermissions->diff($actorPermissions)->isNotEmpty()) {
                abort(403, "You can't assign a role with permissions you don't have.");
            }
        }

        return $role;
    }

    public function create(array $data, ?User $actor = null): Doctor
    {
        app(PlanLimits::class)->assertCanAdd((int) $data['clinic_id'], 'doctors');

        return DB::transaction(function () use ($data, $actor) {
            $doctorUserId = null;

            if (! empty($data['create_linked_user']) && ! empty($data['linked_user'])) {
                $role = $this->assertDoctorRole($data['linked_user']['role'] ?? null, $actor);

                $doctorUser = User::create([
                    'clinic_id' => $data['clinic_id'],
                    'uuid' => (string) Str::uuid(),
                    'full_name' => $data['linked_user']['full_name'] ?? $data['full_name'],
                    'email' => $data['linked_user']['email'] ?? null,
                    'phone' => $data['linked_user']['phone'] ?? null,
                    'password' => Hash::make($data['linked_user']['password'] ?? 'Change@123'),
                    'role' => $role->name,
                    'status' => 'active',
                    'login_type' => 'password',
                ]);
                $doctorUser->assignRole($role->name);
                $doctorUserId = $doctorUser->id;
            }

            $doctor = Doctor::create([
                ...$data,
                'user_id' => $doctorUserId,
            ]);

            if (! empty($data['schedules'])) {
                $doctor->schedules()->createMany(array_map(function ($schedule) use ($data) {
                    return [
                        ...$schedule,
                        'clinic_id' => $data['clinic_id'],
                    ];
                }, $data['schedules']));
            }

            return $doctor;
        });
    }
}
