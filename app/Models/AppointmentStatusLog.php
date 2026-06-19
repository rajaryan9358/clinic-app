<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AppointmentStatusLog extends Model
{
    use HasFactory, BelongsToClinicScope;

    public $timestamps = false;

    protected $fillable = [
        'clinic_id', 'appointment_id', 'old_status', 'new_status', 'changed_by_user_id', 'source', 'reason', 'created_at',
    ];
}
