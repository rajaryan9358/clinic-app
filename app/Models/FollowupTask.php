<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FollowupTask extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'patient_id', 'appointment_id', 'assigned_to_user_id', 'doctor_id', 'due_date',
        'due_time', 'task_type', 'status', 'priority', 'note', 'completed_at',
    ];

    protected function casts(): array
    {
        return ['due_date' => 'date', 'completed_at' => 'datetime'];
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function appointment(): BelongsTo
    {
        return $this->belongsTo(Appointment::class);
    }
}
