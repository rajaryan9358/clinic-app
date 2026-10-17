<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Http\Controllers\Concerns\GuardsManagedBy;
use App\Models\Patient;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class PatientController extends BaseCrudController
{
    use GuardsManagedBy;

    protected string $modelClass = Patient::class;
    protected array $searchable = ['full_name', 'first_name', 'last_name', 'phone', 'email'];
    protected array $filterable = ['clinic_id', 'status_tag', 'preferred_doctor_id'];

    public function store(Request $request)
    {
        if (! $request->filled('managed_by_patient_id')) {
            return parent::store($request);
        }

        return $this->storeGuardingManagedBy($request, $request->all());
    }

    public function update(Request $request, int $id)
    {
        $model = $this->findModel($id);

        if (! $request->has('managed_by_patient_id')) {
            return parent::update($request, $id);
        }

        return $this->updateGuardingManagedBy($request, $model, []);
    }

    protected function baseQuery(Request $request): Builder
    {
        return parent::baseQuery($request)->with([
            'clinic:id,name',
        ]);
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
