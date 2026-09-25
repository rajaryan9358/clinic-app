<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Permission\Traits\HasRoles;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasRoles, Notifiable, SoftDeletes;

    protected $fillable = [
        'clinic_id',
        'uuid',
        'full_name',
        'email',
        'phone',
        'password',
        'login_type',
        'role',
        'status',
        'last_login_at',
        'last_login_ip',
        'email_verified_at',
        'phone_verified_at',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'phone_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    public function clinic(): BelongsTo
    {
        return $this->belongsTo(Clinic::class);
    }

    public function assignedDoctors(): BelongsToMany
    {
        return $this->belongsToMany(Doctor::class, 'assistant_doctor_map', 'assistant_user_id', 'doctor_id')
            ->withPivot(['clinic_id'])
            ->withTimestamps();
    }

    private ?Role $resolvedRole = null;

    private bool $roleResolved = false;

    public function roleModel(): ?Role
    {
        if (! $this->roleResolved) {
            $this->resolvedRole = $this->role ? Role::query()->where('name', $this->role)->where('guard_name', 'web')->first() : null;
            $this->roleResolved = true;
        }

        return $this->resolvedRole;
    }

    public function roleKind(): string
    {
        if ($this->role === 'super_admin') {
            return 'super_admin';
        }

        return $this->roleModel()?->kind ?? 'staff';
    }

    public function limitsToAssignedDoctors(): bool
    {
        return (bool) $this->roleModel()?->limit_to_assigned_doctors;
    }
}
