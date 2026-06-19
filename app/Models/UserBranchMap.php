<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UserBranchMap extends Model
{
    use HasFactory, BelongsToClinicScope;

    public $timestamps = false;

    protected $table = 'user_branch_map';

    protected $fillable = [
        'clinic_id',
        'user_id',
        'branch_id',
        'is_default',
        'created_at',
    ];

    protected function casts(): array
    {
        return [
            'is_default' => 'boolean',
            'created_at' => 'datetime',
        ];
    }

    public function clinic(): BelongsTo
    {
        return $this->belongsTo(Clinic::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
