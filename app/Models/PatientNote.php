<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PatientNote extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'patient_id', 'doctor_id', 'created_by_user_id', 'note_type', 'note', 'is_private',
    ];

    protected function casts(): array
    {
        return ['is_private' => 'boolean'];
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function createdByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
