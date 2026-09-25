<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\WhatsappTemplate;

class WhatsappTemplateController extends BaseCrudController
{
    protected string $modelClass = WhatsappTemplate::class;
    protected array $searchable = ['name', 'template_key', 'status'];
    protected array $filterable = ['clinic_id', 'status', 'category'];
}
