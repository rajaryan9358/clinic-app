<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class DoctorService extends Model
{
    use HasFactory, BelongsToClinicScope;

    public $timestamps = false;

    protected $fillable = ['clinic_id', 'doctor_id', 'service_id', 'created_at'];
}
