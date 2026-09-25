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

class UserManagementService
{
    /**
     * Validate that $actor may assign $roleName to a user in clinic $clinicId (null = clinic-less).
     * Spec §4: role must exist; doctor-kind roles are rejected on the staff form; clinic_admin-kind
     * roles may only be assigned by a clinic_admin (or super_admin) actor; super_admin-kind roles may
     * only be assigned to clinic-less users.
     *
     * @throws ValidationException when the role does not exist or is doctor/super_admin-kind in a
     *                             context that forbids it (422, field `role`).
     */
    private function assertAssignable(?User $actor, string $roleName, ?int $clinicId): Role
    {
        $role = Role::where('name', $roleName)->where('guard_name', 'web')->first();

        if (! $role) {
            throw ValidationException::withMessages(['role' => ['The selected role is invalid.']]);
        }

        if ($role->kind === 'doctor') {
            throw ValidationException::withMessages(['role' => ["Doctor logins are created from the doctor's profile."]]);
        }

        if ($role->kind === 'super_admin' && $clinicId !== null) {
            throw ValidationException::withMessages(['role' => ['The super admin role cannot be assigned to a clinic user.']]);
        }

        if ($role->kind === 'clinic_admin' && $actor !== null && ! in_array($actor->roleKind(), ['clinic_admin', 'super_admin'], true)) {
            abort(403, "You can't assign the Clinic Admin role.");
        }

        return $role;
    }

    public function create(array $data, ?User $actor = null): User
    {
        $role = null;
        if (! empty($data['role'])) {
            $role = $this->assertAssignable($actor, $data['role'], $data['clinic_id'] ?? null);
        }

        if (! empty($data['clinic_id']) && $role && $role->kind !== 'doctor') {
            app(PlanLimits::class)->assertCanAdd((int) $data['clinic_id'], 'staff');
        }

        return DB::transaction(function () use ($data, $role) {
            $user = User::create([
                'clinic_id' => $data['clinic_id'] ?? null,
                'uuid' => (string) Str::uuid(),
                'full_name' => $data['full_name'],
                'email' => $data['email'] ?? null,
                'phone' => $data['phone'] ?? null,
                'password' => Hash::make($data['password']),
                'role' => $data['role'],
                'status' => $data['status'] ?? 'active',
                'login_type' => $data['login_type'] ?? 'password',
            ]);

            $user->syncRoles([$data['role']]);

            $limitsToAssignedDoctors = (bool) ($role?->limit_to_assigned_doctors);

            if ($limitsToAssignedDoctors && array_key_exists('doctor_ids', $data)) {
                $doctorIds = is_array($data['doctor_ids']) ? array_values($data['doctor_ids']) : [];
                $doctorIds = array_values(array_unique(array_map('intval', $doctorIds)));
                $allowedDoctorIds = Doctor::query()
                    ->where('clinic_id', $user->clinic_id)
                    ->whereIn('id', $doctorIds)
                    ->pluck('id')
                    ->map(fn ($id) => (int) $id)
                    ->values()
                    ->all();

                $payload = [];
                foreach ($allowedDoctorIds as $doctorId) {
                    $payload[$doctorId] = ['clinic_id' => $user->clinic_id];
                }
                $user->assignedDoctors()->sync($payload);
            }

            return $user;
        });
    }

    public function resetPassword(User $user, string $password): void
    {
        $user->update(['password' => Hash::make($password)]);
    }

    public function update(User $user, array $data, ?User $actor = null): User
    {
        return DB::transaction(function () use ($user, $data, $actor) {
            $updatable = [
                'full_name',
                'email',
                'phone',
                'role',
                'status',
                'login_type',
            ];

            $role = null;
            if (array_key_exists('role', $data)) {
                if ($data['role'] !== $user->role) {
                    $role = $this->assertAssignable($actor, $data['role'], $data['clinic_id'] ?? $user->clinic_id);
                } else {
                    // Unchanged role (e.g. an existing doctor login edited from the super admin
                    // staff form) is always kept, even if it wouldn't be freshly assignable here.
                    $role = Role::where('name', $user->role)->where('guard_name', 'web')->first();
                }
            } else {
                $role = Role::where('name', $user->role)->where('guard_name', 'web')->first();
            }

            $payload = [];
            foreach ($updatable as $key) {
                if (array_key_exists($key, $data)) {
                    $payload[$key] = $data[$key];
                }
            }

            if (array_key_exists('password', $data) && filled($data['password'])) {
                $payload['password'] = Hash::make($data['password']);
            }

            if (! empty($payload)) {
                $user->update($payload);
            }

            if (array_key_exists('role', $payload)) {
                $user->syncRoles([$user->role]);
            }

            $limitsToAssignedDoctors = (bool) ($role?->limit_to_assigned_doctors);
            if ($limitsToAssignedDoctors && array_key_exists('doctor_ids', $data)) {
                $doctorIds = is_array($data['doctor_ids']) ? array_values($data['doctor_ids']) : [];
                $doctorIds = array_values(array_unique(array_map('intval', $doctorIds)));
                $allowedDoctorIds = Doctor::query()
                    ->where('clinic_id', $user->clinic_id)
                    ->whereIn('id', $doctorIds)
                    ->pluck('id')
                    ->map(fn ($id) => (int) $id)
                    ->values()
                    ->all();

                $payload = [];
                foreach ($allowedDoctorIds as $doctorId) {
                    $payload[$doctorId] = ['clinic_id' => $user->clinic_id];
                }
                $user->assignedDoctors()->sync($payload);
            }

            if (! $limitsToAssignedDoctors) {
                $user->assignedDoctors()->sync([]);
            }

            return $user->refresh();
        });
    }
}
