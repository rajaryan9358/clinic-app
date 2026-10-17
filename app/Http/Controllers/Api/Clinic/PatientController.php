<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Concerns\GuardsManagedBy;
use App\Models\Patient;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class PatientController extends BaseClinicCrudController
{
    use GuardsManagedBy;

    protected string $modelClass = Patient::class;
    protected array $searchable = ['full_name', 'first_name', 'last_name', 'phone', 'email'];
    protected array $filterable = ['status_tag', 'preferred_doctor_id'];

    protected function baseQuery(Request $request): Builder
    {
        return parent::baseQuery($request)->with([
            'clinic:id,name',
        ]);
    }

    public function update(Request $request, int $id)
    {
        $model = $this->findModel($id);

        if (! $request->has('managed_by_patient_id')) {
            return parent::update($request, $id);
        }

        return $this->updateGuardingManagedBy($request, $model, ['clinic_id']);
    }

    public function store(Request $request)
    {
        if (! $request->filled('managed_by_patient_id')) {
            return parent::store($request);
        }

        $data = $request->all();
        $data['clinic_id'] = $request->attributes->get('clinic_id') ?? $request->user()?->clinic_id;

        return $this->storeGuardingManagedBy($request, $data);
    }

    public function show(int $id)
    {
        $request = request();
        $query = $this->baseQuery($request);
        if ($this->supportsSoftDeletes()) {
            $query->withTrashed();
        }

        $model = $query->findOrFail($id);

        return $this->success('Record fetched successfully', $model);
    }
}
