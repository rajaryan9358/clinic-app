<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AppointmentSummary extends Model
{
    protected $fillable = [
        'clinic_id',
        'appointment_id',
        'created_by_user_id',
        'source',
        'transcript_text',
        'patient_summary',
        'doctor_suggestions',
        'preferred_medications',
        'raw',
    ];

    protected $casts = [
        'preferred_medications' => 'array',
        'raw' => 'array',
    ];

    public function appointment()
    {
        return $this->belongsTo(Appointment::class);
    }

    public function clinic()
    {
        return $this->belongsTo(Clinic::class);
    }

    public function createdBy()
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
