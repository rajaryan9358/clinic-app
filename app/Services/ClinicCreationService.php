<?php

namespace App\Services;

use App\Models\Clinic;
use App\Models\ClinicSetting;
use App\Models\Domain;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class ClinicCreationService
{
    public function __construct(private readonly AuditLogService $auditLogService) {}

    public function create(array $data, ?int $actorUserId = null): Clinic
    {
        return DB::transaction(function () use ($data, $actorUserId) {
            $clinicData = collect($data)->except(['clinic_admin', 'settings', 'domain'])->all();

            $clinic = Clinic::create([
                ...$clinicData,
                'uuid' => (string) Str::uuid(),
                'status' => $clinicData['status'] ?? 'active',
            ]);

            if (! empty($data['clinic_admin'])) {
                $admin = User::create([
                    'clinic_id' => $clinic->id,
                    'uuid' => (string) Str::uuid(),
                    'full_name' => $data['clinic_admin']['full_name'],
                    'email' => $data['clinic_admin']['email'] ?? null,
                    'phone' => $data['clinic_admin']['phone'] ?? null,
                    'password' => Hash::make($data['clinic_admin']['password']),
                    'role' => 'clinic_admin',
                    'status' => 'active',
                    'login_type' => 'password',
                ]);

                $admin->assignRole('clinic_admin');
            }

            ClinicSetting::firstOrCreate(
                ['clinic_id' => $clinic->id],
                [...($data['settings'] ?? []), 'clinic_id' => $clinic->id]
            );

            if (! empty($data['domain'])) {
                Domain::create([...$data['domain'], 'clinic_id' => $clinic->id]);
            }

            $this->auditLogService->log(
                module: 'clinics',
                entityType: Clinic::class,
                entityId: $clinic->id,
                action: 'create',
                clinicId: $clinic->id,
                userId: $actorUserId,
                newValues: $clinic->toArray(),
            );

            return $clinic;
        });
    }
}
