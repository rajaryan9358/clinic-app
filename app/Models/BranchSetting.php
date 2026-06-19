<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class BranchSetting extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'branch_id', 'booking_enabled', 'walkin_enabled', 'token_system_enabled',
        'max_advance_booking_days', 'min_booking_notice_minutes',
    ];

    protected function casts(): array
    {
        return ['booking_enabled' => 'boolean', 'walkin_enabled' => 'boolean', 'token_system_enabled' => 'boolean'];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
