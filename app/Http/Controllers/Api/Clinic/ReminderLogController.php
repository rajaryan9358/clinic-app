<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\ReminderLog;

class ReminderLogController extends BaseClinicCrudController
{
    protected string $modelClass = ReminderLog::class;
    protected bool $readOnly = true;
    protected array $searchable = ['channel', 'reminder_type', 'delivery_status', 'provider_message_id'];
    protected array $filterable = ['delivery_status', 'reminder_type', 'appointment_id', 'patient_id'];
}
