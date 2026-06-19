<?php

namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Http\Request;

class AuditLogService
{
    public function log(
        string $module,
        string $entityType,
        ?int $entityId,
        string $action,
        ?int $clinicId = null,
        ?int $userId = null,
        ?int $branchId = null,
        ?array $oldValues = null,
        ?array $newValues = null,
        ?Request $request = null
    ): AuditLog {
        return AuditLog::create([
            'clinic_id' => $clinicId,
            'user_id' => $userId,
            'branch_id' => $branchId,
            'module' => $module,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'action' => $action,
            'old_values_json' => $oldValues,
            'new_values_json' => $newValues,
            'ip_address' => $request?->ip(),
            'user_agent' => $request?->userAgent(),
            'created_at' => now(),
        ]);
    }
}
