<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

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

    public function branches(): BelongsToMany
    {
        return $this->belongsToMany(Branch::class, 'branch_service_map')
            ->withPivot(['clinic_id', 'created_at']);
    }
}
