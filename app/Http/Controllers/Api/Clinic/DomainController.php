<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\Domain;

class DomainController extends BaseClinicCrudController
{
    protected string $modelClass = Domain::class;
    protected array $searchable = ['host', 'type'];
    protected array $filterable = ['branch_id', 'status', 'type'];
}
