<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\WhatsappTemplate;

class WhatsappTemplateController extends BaseClinicCrudController
{
    protected string $modelClass = WhatsappTemplate::class;
    protected array $searchable = ['name', 'template_key', 'status'];
    protected array $filterable = ['status', 'category'];
}
