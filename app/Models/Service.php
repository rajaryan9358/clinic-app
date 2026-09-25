<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Service extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'name', 'code', 'description', 'duration_minutes', 'fee', 'image_url', 'status',
    ];

    protected function casts(): array
    {
        return ['fee' => 'decimal:2'];
    }
}
