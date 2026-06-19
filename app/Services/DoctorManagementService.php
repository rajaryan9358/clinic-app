<?php

namespace App\Services;

use App\Models\Doctor;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class DoctorManagementService
{
    public function create(array $data): Doctor
    {
        return DB::transaction(function () use ($data) {
            $doctorUserId = null;

            if (! empty($data['create_linked_user']) && ! empty($data['linked_user'])) {
                $doctorUser = User::create([
                    'clinic_id' => $data['clinic_id'],
                    'uuid' => (string) Str::uuid(),
                    'full_name' => $data['linked_user']['full_name'] ?? $data['full_name'],
                    'email' => $data['linked_user']['email'] ?? null,
                    'phone' => $data['linked_user']['phone'] ?? null,
                    'password' => Hash::make($data['linked_user']['password'] ?? 'Change@123'),
                    'role' => 'doctor',
                    'status' => 'active',
                    'login_type' => 'password',
                ]);
                $doctorUser->assignRole('doctor');
                $doctorUserId = $doctorUser->id;
            }

            $doctor = Doctor::create([
                ...$data,
                'user_id' => $doctorUserId,
            ]);

            if (! empty($data['branch_ids'])) {
                $payload = [];
                foreach ($data['branch_ids'] as $index => $branchId) {
                    $payload[$branchId] = ['clinic_id' => $data['clinic_id'], 'is_primary' => $index === 0];
                }
                $doctor->branches()->sync($payload);
            }

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
