<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class DoctorScheduleException extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'doctor_id', 'exception_date', 'type', 'start_time', 'end_time', 'reason',
    ];

    protected function casts(): array
    {
        return [
            'exception_date' => 'date',
        ];
    }
}
