<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Requests\StoreDoctorRequest;
use App\Models\Doctor;
use App\Services\DoctorManagementService;
use Illuminate\Http\Request;

class DoctorController extends BaseClinicCrudController
{
    protected string $modelClass = Doctor::class;
    protected array $searchable = ['full_name', 'specialization', 'phone', 'email'];
    protected array $filterable = ['status', 'specialization'];

    public function __construct(private readonly DoctorManagementService $doctorManagementService) {}

    public function store(Request $request)
    {
        $role = (string) ($request->user()?->role ?? '');
        abort_if(! in_array($role, ['clinic_admin', 'branch_manager'], true), 403, 'Not allowed.');

        $request->merge([
            'clinic_id' => $request->attributes->get('clinic_id'),
        ]);

        $data = validator($request->all(), (new StoreDoctorRequest())->rules())->validate();
        $data['clinic_id'] = $request->attributes->get('clinic_id');

        $activeBranchId = $request->attributes->get('active_branch_id');
        if ($activeBranchId && empty($data['branch_ids'])) {
            $data['branch_ids'] = [(int) $activeBranchId];
        }

        $doctor = $this->doctorManagementService->create($data);

        return $this->success('Doctor created successfully', $doctor, 201);
    }
}
