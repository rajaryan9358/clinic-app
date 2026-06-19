<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AppointmentRescheduleLog extends Model
{
    use HasFactory, BelongsToClinicScope;

    public $timestamps = false;

    protected $fillable = [
        'clinic_id',
        'old_appointment_id',
        'new_appointment_id',
        'old_appointment_date',
        'old_start_time',
        'old_end_time',
        'new_appointment_date',
        'new_start_time',
        'new_end_time',
        'changed_by_user_id',
        'reason',
        'created_at',
    ];
}
