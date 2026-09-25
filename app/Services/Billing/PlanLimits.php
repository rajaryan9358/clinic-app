<?php

namespace App\Services\Billing;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\User;

class PlanLimits
{
    public function count(int $clinicId, string $resource): int
    {
        return match ($resource) {
            'doctors' => Doctor::query()->where('clinic_id', $clinicId)->count(),
            'staff' => User::query()->where('clinic_id', $clinicId)->where('role', '!=', 'doctor')->count(),
            'appointments' => Appointment::query()->where('clinic_id', $clinicId)
                ->whereBetween('created_at', [now()->startOfMonth(), now()->endOfMonth()])
                ->where('status', '!=', 'cancelled')->count(),
        };
    }

    public function usage(Clinic $clinic): array
    {
        return [
            'doctors' => $this->count($clinic->id, 'doctors'),
            'staff' => $this->count($clinic->id, 'staff'),
            'appointments' => $this->count($clinic->id, 'appointments'),
        ];
    }
}
