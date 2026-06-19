<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Branch extends Model
{
    use HasFactory, SoftDeletes, BelongsToClinicScope;

    protected static function booted(): void
    {
        static::deleted(function (Branch $branch) {
            BranchSetting::query()->where('branch_id', $branch->id)->delete();
        });

        static::restored(function (Branch $branch) {
            BranchSetting::query()->firstOrCreate(
                ['branch_id' => $branch->id],
                ['clinic_id' => $branch->clinic_id, 'branch_id' => $branch->id]
            );
        });
    }

    protected $table = 'branches';

    protected $fillable = [
        'clinic_id',
        'uuid',
        'name',
        'code',
        'address_line_1',
        'address_line_2',
        'city',
        'state',
        'pincode',
        'latitude',
        'longitude',
        'phone',
        'email',
        'is_main_branch',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'is_main_branch' => 'boolean',
            'latitude' => 'float',
            'longitude' => 'float',
        ];
    }

    public function clinic(): BelongsTo
    {
        return $this->belongsTo(Clinic::class);
    }

    public function users(): HasMany
    {
        return $this->hasMany(UserBranchMap::class);
    }

    public function services(): BelongsToMany
    {
        return $this->belongsToMany(Service::class, 'branch_service_map')
            ->withPivot(['clinic_id', 'created_at']);
    }
}
