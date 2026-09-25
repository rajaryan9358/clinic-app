<?php

namespace App\Services;

use App\Models\Doctor;
use App\Models\User;
use App\Services\Billing\PlanLimits;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class UserManagementService
{
    public function create(array $data): User
    {
        if (! empty($data['clinic_id']) && ($data['role'] ?? null) !== 'doctor') {
            app(PlanLimits::class)->assertCanAdd((int) $data['clinic_id'], 'staff');
        }

        return DB::transaction(function () use ($data) {
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

            if (($data['role'] ?? null) === 'assistant' && array_key_exists('doctor_ids', $data)) {
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

    public function update(User $user, array $data): User
    {
        return DB::transaction(function () use ($user, $data) {
            $updatable = [
                'full_name',
                'email',
                'phone',
                'role',
                'status',
                'login_type',
            ];

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

            $role = (string) ($user->role ?? '');
            if ($role === 'assistant' && array_key_exists('doctor_ids', $data)) {
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

            if ($role !== 'assistant') {
                $user->assignedDoctors()->sync([]);
            }

            return $user->refresh();
        });
    }
}
