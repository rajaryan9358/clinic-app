<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\WhatsappFlowSession;

class WhatsappFlowSessionController extends BaseCrudController
{
    protected string $modelClass = WhatsappFlowSession::class;
    protected array $searchable = ['flow_type', 'current_step', 'status'];
    protected array $filterable = ['clinic_id', 'branch_id', 'conversation_id', 'status'];
}
