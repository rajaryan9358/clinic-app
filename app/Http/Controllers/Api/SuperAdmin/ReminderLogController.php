<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\ReminderLog;

class ReminderLogController extends BaseCrudController
{
    protected string $modelClass = ReminderLog::class;
    protected array $searchable = ['channel', 'reminder_type', 'delivery_status', 'provider_message_id'];
    protected array $filterable = ['clinic_id', 'delivery_status', 'reminder_type', 'appointment_id', 'patient_id'];
}
