<?php

namespace App\Models;

use Spatie\Permission\Models\Role as SpatieRole;

class Role extends SpatieRole
{
    public const KINDS = ['super_admin', 'clinic_admin', 'staff', 'doctor'];

    protected $fillable = ['name', 'guard_name', 'label', 'kind', 'limit_to_assigned_doctors', 'is_system', 'description'];

    protected $casts = ['limit_to_assigned_doctors' => 'boolean', 'is_system' => 'boolean'];
}
