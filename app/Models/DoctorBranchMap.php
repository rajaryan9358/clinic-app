<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class DoctorBranchMap extends Model
{
    use HasFactory, BelongsToClinicScope;

    public $timestamps = false;

    protected $table = 'doctor_branch_map';

    protected $fillable = ['clinic_id', 'doctor_id', 'branch_id', 'is_primary', 'created_at'];

    protected function casts(): array
    {
        return ['is_primary' => 'boolean', 'created_at' => 'datetime'];
    }
}
