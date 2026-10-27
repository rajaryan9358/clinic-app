<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Http\Controllers\Concerns\PatientFieldRules;
use App\Models\Patient;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PatientController extends BaseCrudController
{
    use PatientFieldRules;

    protected string $modelClass = Patient::class;
    protected array $searchable = ['full_name', 'first_name', 'last_name', 'phone', 'email'];
    protected array $filterable = ['clinic_id', 'status_tag', 'preferred_doctor_id'];

    /** FKs must sit in the patient's own clinic, which can't change after creation. */
    protected function rules(Request $request, ?Model $model = null): array
    {
        $clinicId = $model ? (int) $model->clinic_id : (int) $request->input('clinic_id');

        return [
            'clinic_id' => $model
                ? ['sometimes', 'integer', Rule::in([$clinicId])]
                : ['required', 'integer', Rule::exists('clinics', 'id')->whereNull('deleted_at')],
            ...$this->patientFieldRules($clinicId, $model !== null),
        ];
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
