<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class PatientMedicalProfile extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'patient_id', 'allergies', 'chronic_conditions', 'current_medications',
        'surgeries_history', 'family_history', 'notes',
    ];
}
