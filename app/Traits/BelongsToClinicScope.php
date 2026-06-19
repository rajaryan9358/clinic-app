<?php

namespace App\Traits;

use Illuminate\Database\Eloquent\Builder;

trait BelongsToClinicScope
{
    public function scopeForClinic(Builder $query, int $clinicId): Builder
    {
        return $query->where('clinic_id', $clinicId);
    }
}
