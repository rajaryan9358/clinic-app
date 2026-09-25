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
     * be a doctor-kind role) or the system `doctor` role by default.
     */
    private function assertDoctorRole(?string $roleName): Role
    {
        $roleName = $roleName ?: 'doctor';
        $role = Role::where('name', $roleName)->where('guard_name', 'web')->first();

        if (! $role || $role->kind !== 'doctor') {
            throw ValidationException::withMessages(['linked_user.role' => ['The selected role is invalid.']]);
        }

        return $role;
    }

    public function create(array $data): Doctor
    {
        app(PlanLimits::class)->assertCanAdd((int) $data['clinic_id'], 'doctors');

        return DB::transaction(function () use ($data) {
            $doctorUserId = null;

            if (! empty($data['create_linked_user']) && ! empty($data['linked_user'])) {
                $role = $this->assertDoctorRole($data['linked_user']['role'] ?? null);

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
