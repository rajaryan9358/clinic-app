<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\AuditLog;

class AuditLogController extends BaseCrudController
{
    protected string $modelClass = AuditLog::class;
    protected bool $readOnly = true;
    protected array $searchable = ['module', 'entity_type', 'action'];
    protected array $filterable = ['clinic_id', 'user_id', 'module', 'action'];
}
