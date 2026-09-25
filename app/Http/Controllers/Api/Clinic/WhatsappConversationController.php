<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\WhatsappConversation;

class WhatsappConversationController extends BaseClinicCrudController
{
    protected string $modelClass = WhatsappConversation::class;
    protected array $searchable = ['customer_phone', 'conversation_status'];
    protected array $filterable = ['conversation_status', 'current_owner_type'];
}
