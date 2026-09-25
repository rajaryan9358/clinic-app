<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\AuditLog;

class AuditLogController extends BaseClinicCrudController
{
    protected string $modelClass = AuditLog::class;
    protected array $searchable = ['module', 'entity_type', 'action'];
    protected array $filterable = ['user_id', 'module', 'action'];
}
