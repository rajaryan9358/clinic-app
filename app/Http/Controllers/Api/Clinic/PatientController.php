<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\Patient;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use App\Services\Patients\PatientManagedByService;

class PatientController extends BaseClinicCrudController
{
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

        $managerId = $request->input('managed_by_patient_id');
        if ($managerId !== null && ! (is_int($managerId) || ctype_digit((string) $managerId))) {
            return $this->invalidHolder();
        }

        try {
            DB::transaction(function () use ($request, $model, $managerId) {
                $model->update($request->except(['clinic_id', 'managed_by_patient_id']));
                // Same rule as PUT patients/{id}/managed-by: holder must be in this clinic and keep the hierarchy flat.
                app(PatientManagedByService::class)->update($model, $managerId === null ? null : (int) $managerId);
            });
        } catch (ValidationException $e) {
            return $this->error((string) collect($e->errors())->collapse()->first(), $e->errors(), 422);
        }

        return $this->success('Record updated successfully', $model->refresh());
    }

    public function store(Request $request)
    {
        if (! $request->filled('managed_by_patient_id')) {
            return parent::store($request);
        }

        $data = $request->all();
        $data['clinic_id'] = $request->attributes->get('clinic_id') ?? $request->user()?->clinic_id;
        $managerId = $data['managed_by_patient_id'];
        unset($data['managed_by_patient_id']);

        if (! (is_int($managerId) || ctype_digit((string) $managerId))) {
            return $this->invalidHolder();
        }

        try {
            $model = DB::transaction(function () use ($data, $managerId) {
                $model = Patient::create($data);
                app(PatientManagedByService::class)->update($model, (int) $managerId);

                return $model;
            });
        } catch (ValidationException $e) {
            return $this->error((string) collect($e->errors())->collapse()->first(), $e->errors(), 422);
        }

        return $this->success('Record created successfully', $model->refresh(), 201);
    }

    private function invalidHolder()
    {
        $message = 'Choose an account holder in this clinic.';

        return $this->error($message, ['managed_by_patient_id' => [$message]], 422);
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
