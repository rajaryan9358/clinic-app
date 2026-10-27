<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\Patient;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PatientController extends BaseClinicCrudController
{
    protected string $modelClass = Patient::class;
    protected array $searchable = ['full_name', 'first_name', 'last_name', 'phone', 'email'];
    protected array $filterable = ['status_tag', 'preferred_doctor_id'];

    protected function rules(Request $request, ?Model $model = null): array
    {
        $clinicId = $this->clinicId($request);
        $required = $model ? ['sometimes', 'required'] : ['required'];

        return [
            'first_name' => [...$required, 'string', 'max:255'],
            'last_name' => ['nullable', 'string', 'max:255'],
            'full_name' => ['nullable', 'string', 'max:255'],
            'phone' => [...$required, 'string', 'max:20'],
            'alternate_phone' => ['nullable', 'string', 'max:20'],
            'email' => ['nullable', 'email', 'max:255'],
            'gender' => ['nullable', 'in:male,female,other'],
            'dob' => ['nullable', 'date'],
            'age' => ['nullable', 'integer', 'min:0', 'max:150'],
            'blood_group' => ['nullable', 'string', 'max:20'],
            'address_line_1' => ['nullable', 'string', 'max:255'],
            'address_line_2' => ['nullable', 'string', 'max:255'],
            'city' => ['nullable', 'string', 'max:255'],
            'state' => ['nullable', 'string', 'max:255'],
            'pincode' => ['nullable', 'string', 'max:20'],
            'occupation' => ['nullable', 'string', 'max:255'],
            'referred_by' => ['nullable', 'string', 'max:255'],
            'preferred_doctor_id' => ['nullable', 'integer', Rule::exists('doctors', 'id')->where('clinic_id', $clinicId)->whereNull('deleted_at')],
            'communication_consent' => ['sometimes', 'boolean'],
            'whatsapp_opt_in' => ['sometimes', 'boolean'],
            'sms_opt_in' => ['sometimes', 'boolean'],
            'email_opt_in' => ['sometimes', 'boolean'],
            'status_tag' => ['sometimes', 'in:active,followup_due,inactive,blocked'],
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
