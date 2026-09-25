<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\Domain;

class DomainController extends BaseCrudController
{
    protected string $modelClass = Domain::class;
    protected array $searchable = ['host', 'type'];
    protected array $filterable = ['clinic_id', 'status', 'type'];
}
