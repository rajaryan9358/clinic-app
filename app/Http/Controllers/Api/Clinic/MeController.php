<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Models\Clinic;
use App\Models\Doctor;
use Illuminate\Http\Request;

class MeController
{
    use ApiResponse;

    public function context(Request $request)
    {
        $user = $request->user();
        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $user?->clinic_id);

        $allowedDoctorIds = $request->attributes->get('allowed_doctor_ids');
        $activeDoctorId = $request->attributes->get('active_doctor_id');

        $doctors = null;
        if (is_array($allowedDoctorIds)) {
            $doctors = Doctor::query()
                ->where('clinic_id', $clinicId)
                ->whereIn('id', $allowedDoctorIds)
                ->select(['id', 'full_name'])
                ->orderBy('full_name')
                ->get();
        }

        $clinic = Clinic::query()->with('subscription.plan:id,name')->select(['id', 'name', 'status', 'logo_url'])->find($clinicId);

        return $this->success('Context fetched', [
            'role' => (string) ($user?->role ?? ''),
            'active_doctor_id' => $activeDoctorId ? (int) $activeDoctorId : null,
            'allowed_doctors' => $doctors,
            'clinic_id' => $clinicId,
            'clinic_name' => $clinic?->name,
            'clinic_logo_url' => $clinic?->logo_url,
            'clinic_status' => $clinic?->status,
            'clinic_trial_ends_at' => $clinic?->subscription?->trial_ends_at?->toISOString(),
            'subscription' => $clinic?->subscription ? [
                'status' => $clinic->subscription->status,
                'plan_name' => $clinic->subscription->plan?->name,
                'billing_cycle' => $clinic->subscription->billing_cycle,
                'trial_ends_at' => $clinic->subscription->trial_ends_at?->toISOString(),
                'grace_ends_at' => $clinic->subscription->grace_ends_at?->toISOString(),
                'current_period_end' => $clinic->subscription->current_period_end?->toISOString(),
                'allows_access' => $clinic->status !== 'suspended' && $clinic->subscription->allowsAccess(),
            ] : null,
        ]);
    }
}
