<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Concerns\PatientFieldRules;
use App\Models\Patient;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

class PatientController extends BaseClinicCrudController
{
    use PatientFieldRules;

    protected string $modelClass = Patient::class;
    protected array $searchable = ['full_name', 'first_name', 'last_name', 'phone', 'email'];
    protected array $filterable = ['status_tag', 'preferred_doctor_id'];

    protected function rules(Request $request, ?Model $model = null): array
    {
        return $this->patientFieldRules($this->clinicId($request), $model !== null);
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
