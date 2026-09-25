<?php

namespace App\Services\Billing;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Doctor;
use App\Models\User;
use Illuminate\Validation\ValidationException;

class PlanLimits
{
    public function assertCanAdd(int $clinicId, string $resource): void
    {
        $sub = ClinicSubscription::query()->with('plan')->where('clinic_id', $clinicId)->first();
        $limit = $sub?->plan?->limitFor($resource);
        if ($limit === null) {
            return;
        }

        if ($this->count($clinicId, $resource) >= $limit) {
            $label = ['doctors' => 'doctors', 'staff' => 'staff users', 'appointments' => 'appointments per month'][$resource];
            throw ValidationException::withMessages([
                'plan' => "Your {$sub->plan->name} plan allows {$limit} {$label}. Upgrade your plan to add more.",
            ]);
        }
    }

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
