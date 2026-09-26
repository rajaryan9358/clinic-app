<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Requests\StatusChangeRequest;
use App\Http\Requests\StoreDoctorRequest;
use App\Models\Doctor;
use App\Services\DoctorManagementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DoctorController extends BaseClinicCrudController
{
    protected string $modelClass = Doctor::class;
    protected array $searchable = ['full_name', 'specialization', 'phone', 'email'];
    protected array $filterable = ['status', 'specialization'];

    public function __construct(private readonly DoctorManagementService $doctorManagementService) {}

    public function store(Request $request)
    {
        $request->merge([
            'clinic_id' => $request->attributes->get('clinic_id'),
        ]);

        $data = validator($request->all(), (new StoreDoctorRequest())->rules())->validate();
        $data['clinic_id'] = $request->attributes->get('clinic_id');

        $doctor = $this->doctorManagementService->create($data, $request->user());

        return $this->success('Doctor created successfully', $doctor, 201);
    }

    /*
     * Doctor-kind users hold doctors.edit so they can edit their own profile via
     * DoctorProfileController (own record, limited fields). The generic write
     * routes below bypass those rules, so doctors are refused here.
     */
    private function refuseDoctorKind(): ?JsonResponse
    {
        if (request()->user()?->roleKind() === 'doctor') {
            return response()->json(['success' => false, 'message' => 'Doctors edit their details from their profile.'], 403);
        }

        return null;
    }

    public function update(Request $request, int $id)
    {
        return $this->refuseDoctorKind() ?? parent::update($request, $id);
    }

    public function destroy(int $id)
    {
        return $this->refuseDoctorKind() ?? parent::destroy($id);
    }

    public function restore(int $id)
    {
        return $this->refuseDoctorKind() ?? parent::restore($id);
    }

    public function changeStatus(StatusChangeRequest $request, int $id)
    {
        return $this->refuseDoctorKind() ?? parent::changeStatus($request, $id);
    }

    public function block(int $id)
    {
        return $this->refuseDoctorKind() ?? parent::block($id);
    }

    public function unblock(int $id)
    {
        return $this->refuseDoctorKind() ?? parent::unblock($id);
    }
}
