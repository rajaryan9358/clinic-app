<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\WhatsappConversation;

class WhatsappConversationController extends BaseCrudController
{
    protected string $modelClass = WhatsappConversation::class;
    protected array $searchable = ['customer_phone', 'conversation_status'];
    protected array $filterable = ['clinic_id', 'branch_id', 'conversation_status', 'current_owner_type'];
}
