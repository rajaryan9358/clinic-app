<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Models\Branch;
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

        $allowedBranchIds = $request->attributes->get('allowed_branch_ids');
        $activeBranchId = $request->attributes->get('active_branch_id');

        $branches = null;
        if (is_array($allowedBranchIds)) {
            $branches = Branch::query()
                ->where('clinic_id', $clinicId)
                ->whereIn('id', $allowedBranchIds)
                ->select(['id', 'name'])
                ->orderBy('name')
                ->get();
        }

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

        $clinic = Clinic::query()->select(['id', 'name', 'status', 'trial_ends_at', 'logo_url'])->find($clinicId);

        return $this->success('Context fetched', [
            'role' => (string) ($user?->role ?? ''),
            'active_branch_id' => $activeBranchId ? (int) $activeBranchId : null,
            'allowed_branches' => $branches,
            'active_doctor_id' => $activeDoctorId ? (int) $activeDoctorId : null,
            'allowed_doctors' => $doctors,
            'clinic_id' => $clinicId,
            'clinic_name' => $clinic?->name,
            'clinic_logo_url' => $clinic?->logo_url,
            'clinic_status' => $clinic?->status,
            'clinic_trial_ends_at' => $clinic?->trial_ends_at?->toISOString(),
        ]);
    }
}
