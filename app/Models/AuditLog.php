<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    use HasFactory;

    public $timestamps = false;

    protected $fillable = [
        'clinic_id', 'user_id', 'branch_id', 'module', 'entity_type', 'entity_id', 'action',
        'old_values_json', 'new_values_json', 'ip_address', 'user_agent', 'created_at',
    ];

    protected function casts(): array
    {
        return ['old_values_json' => 'array', 'new_values_json' => 'array', 'created_at' => 'datetime'];
    }
}
