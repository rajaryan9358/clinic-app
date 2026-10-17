<?php

namespace App\Http\Controllers\Concerns;

use App\Models\Patient;
use App\Services\Patients\PatientManagedByService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Generic patient CRUD writes that route `managed_by_patient_id` through
 * PatientManagedByService (same-clinic, flat hierarchy) instead of mass
 * assignment. Requires the ApiResponse trait on the using class.
 */
trait GuardsManagedBy
{
    private function managedByError(ValidationException $e)
    {
        return $this->error((string) collect($e->errors())->collapse()->first(), $e->errors(), 422);
    }

    /** @param  array<int, string>  $except */
    private function updateGuardingManagedBy(Request $request, Patient $model, array $except)
    {
        try {
            $request->validate(['managed_by_patient_id' => ['nullable', 'integer']]);
            $managerId = $request->input('managed_by_patient_id');

            DB::transaction(function () use ($request, $model, $managerId, $except) {
                $model->update($request->except(array_merge($except, ['managed_by_patient_id'])));
                app(PatientManagedByService::class)->update($model, $managerId === null ? null : (int) $managerId);
            });
        } catch (ValidationException $e) {
            return $this->managedByError($e);
        }

        return $this->success('Record updated successfully', $model->refresh());
    }

    /** @param  array<string, mixed>  $data  already includes clinic_id */
    private function storeGuardingManagedBy(Request $request, array $data)
    {
        try {
            $request->validate(['managed_by_patient_id' => ['nullable', 'integer']]);
            $managerId = $data['managed_by_patient_id'];
            unset($data['managed_by_patient_id']);

            $model = DB::transaction(function () use ($data, $managerId) {
                $model = Patient::create($data);
                app(PatientManagedByService::class)->update($model, (int) $managerId);

                return $model;
            });
        } catch (ValidationException $e) {
            return $this->managedByError($e);
        }

        return $this->success('Record created successfully', $model->refresh(), 201);
    }
}
