<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class PatientFamilyLink extends Model
{
    use HasFactory, BelongsToClinicScope;

    public $timestamps = false;

    protected $fillable = [
        'clinic_id', 'patient_id', 'related_patient_id', 'relation', 'created_at',
    ];
}
