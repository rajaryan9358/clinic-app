<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Api\BaseCrudController;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

abstract class BaseClinicCrudController extends BaseCrudController
{
    private static array $hasColumnCache = [];

    protected function baseQuery(Request $request): Builder
    {
        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $request->user()?->clinic_id);

        $query = parent::baseQuery($request)->where('clinic_id', $clinicId);

        return $this->applyAccessScopes($request, $query);
    }

    protected function findModel(int $id): Model
    {
        $request = request();
        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $request->user()?->clinic_id);

        $query = ($this->modelClass)::query()->where('clinic_id', $clinicId);
        $query = $this->applyAccessScopes($request, $query);

        if ($this->supportsSoftDeletes()) {
            $query->withTrashed();
        }

        return $query->findOrFail($id);
    }

    public function update(Request $request, int $id)
    {
        $model = $this->findModel($id);
        $model->update($request->except(['clinic_id']));

        return $this->success('Record updated successfully', $model->refresh());
    }

    public function restore(int $id)
    {
        if (! $this->supportsSoftDeletes()) {
            return $this->error('Restore is not supported for this module', null, 422);
        }

        $request = request();
        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $request->user()?->clinic_id);

        $query = ($this->modelClass)::query()->withTrashed()->where('clinic_id', $clinicId);
        $query = $this->applyAccessScopes($request, $query);
        $model = $query->findOrFail($id);
        $model->restore();

        return $this->success('Record restored successfully', $model->refresh());
    }

    public function store(Request $request)
    {
        $data = $request->all();
        $data['clinic_id'] = $request->attributes->get('clinic_id') ?? $request->user()?->clinic_id;

        $model = ($this->modelClass)::create($data);

        return $this->success('Record created successfully', $model, 201);
    }

    private function applyAccessScopes(Request $request, Builder $query): Builder
    {
        $role = (string) ($request->user()?->role ?? '');

        if ($query->getModel()->getTable() === 'doctors') {
            $activeDoctorId = $request->attributes->get('active_doctor_id');
            if ($role === 'doctor' && $activeDoctorId) {
                $query->where('id', (int) $activeDoctorId);
            }

            return $query;
        }

        $activeDoctorId = $request->attributes->get('active_doctor_id');
        if ($activeDoctorId && $this->modelHasColumn($query, 'doctor_id')) {
            $query->where('doctor_id', (int) $activeDoctorId);
        }

        if ($activeDoctorId && $this->modelHasColumn($query, 'preferred_doctor_id')) {
            $query->where('preferred_doctor_id', (int) $activeDoctorId);
        }

        return $query;
    }

    private function modelHasColumn(Builder $query, string $column): bool
    {
        $table = $query->getModel()->getTable();
        $cacheKey = $table.'.'.$column;
        if (array_key_exists($cacheKey, self::$hasColumnCache)) {
            return (bool) self::$hasColumnCache[$cacheKey];
        }

        return self::$hasColumnCache[$cacheKey] = Schema::hasColumn($table, $column);
    }
}
