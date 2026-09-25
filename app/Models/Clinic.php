<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Clinic extends Model
{
    use HasFactory, SoftDeletes, BelongsToClinicScope;

    protected static function booted(): void
    {
        static::deleted(function (Clinic $clinic) {
            ClinicSetting::query()->where('clinic_id', $clinic->id)->delete();
        });

        static::restored(function (Clinic $clinic) {
            ClinicSetting::query()->firstOrCreate(['clinic_id' => $clinic->id], ['clinic_id' => $clinic->id]);
        });
    }

    protected $fillable = [
        'uuid',
        'name',
        'legal_name',
        'slug',
        'owner_name',
        'owner_phone',
        'owner_email',
        'address_line_1', 'address_line_2', 'city', 'state', 'pincode', 'latitude', 'longitude', 'phone', 'email',
        'logo_url',
        'primary_color',
        'secondary_color',
        'status',
        'trial_ends_at',
        'notes',
    ];

    protected $casts = [
        'trial_ends_at' => 'datetime',
    ];

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function doctors(): HasMany
    {
        return $this->hasMany(Doctor::class);
    }

    public function patients(): HasMany
    {
        return $this->hasMany(Patient::class);
    }
}
