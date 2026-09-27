<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AppointmentPrescription extends Model
{
    protected $fillable = [
        'clinic_id',
        'appointment_id',
        'created_by_user_id',
        'source',
        'transcript_text',
        'data',
        'raw',
        'status',
        'finalized_at',
        'finalized_by_user_id',
    ];

    protected $casts = [
        'data' => 'array',
        'raw' => 'array',
        'finalized_at' => 'datetime',
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
