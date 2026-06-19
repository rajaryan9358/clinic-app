<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\WhatsappFlowSession;

class WhatsappFlowSessionController extends BaseClinicCrudController
{
    protected string $modelClass = WhatsappFlowSession::class;
    protected array $searchable = ['flow_type', 'current_step', 'status'];
    protected array $filterable = ['branch_id', 'conversation_id', 'status'];
}
