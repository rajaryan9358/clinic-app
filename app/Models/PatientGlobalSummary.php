<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PatientGlobalSummary extends Model
{
    protected $fillable = [
        'clinic_id',
        'patient_id',
        'created_by_user_id',
        'overall_health_summary',
        'key_concerns',
        'treatment_progress',
        'recommended_focus',
        'summary_generated_at',
    ];

    protected $casts = [
        'key_concerns' => 'array',
        'summary_generated_at' => 'datetime',
    ];

    public function patient()
    {
        return $this->belongsTo(Patient::class);
    }
}
