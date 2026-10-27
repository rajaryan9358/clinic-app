<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\WhatsappFlowSession;

class WhatsappFlowSessionController extends BaseClinicCrudController
{
    protected string $modelClass = WhatsappFlowSession::class;
    protected bool $readOnly = true;
    protected array $searchable = ['flow_type', 'current_step', 'status'];
    protected array $filterable = ['conversation_id', 'status'];
}
