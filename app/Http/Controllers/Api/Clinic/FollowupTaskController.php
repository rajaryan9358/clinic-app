<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\FollowupTask;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class FollowupTaskController extends BaseClinicCrudController
{
    protected string $modelClass = FollowupTask::class;
    protected array $searchable = ['task_type', 'status', 'priority'];
    protected array $filterable = ['doctor_id', 'assigned_to_user_id', 'patient_id', 'status'];

    protected function baseQuery(Request $request): Builder
    {
        return parent::baseQuery($request)->with([
            'patient:id,full_name,phone',
            'doctor:id,full_name',
            'appointment' => fn ($q) => $q
                ->select('id', 'status', 'visit_type', 'appointment_date', 'start_time')
                ->withCount('prescriptions'),
        ]);
    }
}
