<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\Service;

class ServiceController extends BaseCrudController
{
    protected string $modelClass = Service::class;
    protected array $searchable = ['name', 'code'];
    protected array $filterable = ['clinic_id', 'status'];
    protected array $statuses = ['active', 'inactive'];
}
