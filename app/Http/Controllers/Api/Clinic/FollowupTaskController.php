<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\FollowupTask;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class FollowupTaskController extends BaseClinicCrudController
{
    protected string $modelClass = FollowupTask::class;
    protected array $searchable = ['task_type', 'status', 'priority'];
    protected array $filterable = ['doctor_id', 'assigned_to_user_id', 'patient_id', 'status'];
    protected array $statuses = ['pending', 'done', 'skipped', 'cancelled'];

    protected function rules(Request $request, ?Model $model = null): array
    {
        $clinicId = $this->clinicId($request);
        $required = $model ? ['sometimes', 'required'] : ['required'];

        return [
            'patient_id' => [...$required, 'integer', Rule::exists('patients', 'id')->where('clinic_id', $clinicId)->whereNull('deleted_at')],
            'appointment_id' => ['nullable', 'integer', Rule::exists('appointments', 'id')->where('clinic_id', $clinicId)],
            'assigned_to_user_id' => ['nullable', 'integer', Rule::exists('users', 'id')->where('clinic_id', $clinicId)->whereNull('deleted_at')],
            'doctor_id' => ['nullable', 'integer', Rule::exists('doctors', 'id')->where('clinic_id', $clinicId)->whereNull('deleted_at')],
            'due_date' => [...$required, 'date'],
            'due_time' => ['nullable', 'date_format:H:i,H:i:s'],
            'task_type' => [...$required, 'in:call,whatsapp,review_request,followup_visit,lab_reminder,custom'],
            'status' => ['sometimes', 'in:pending,done,skipped,cancelled'],
            'priority' => ['sometimes', 'in:low,medium,high'],
            'note' => ['nullable', 'string', 'max:5000'],
        ];
    }

    protected function baseQuery(Request $request): Builder
    {
        $clinicId = $this->clinicId($request);

        return parent::baseQuery($request)->with([
            'patient' => fn ($q) => $q->select('id', 'full_name', 'phone')->where('clinic_id', $clinicId),
            'doctor' => fn ($q) => $q->select('id', 'full_name')->where('clinic_id', $clinicId),
            'appointment' => fn ($q) => $q
                ->select('id', 'status', 'visit_type', 'appointment_date', 'start_time')
                ->where('clinic_id', $clinicId)
                ->withCount('prescriptions'),
        ]);
    }
}
