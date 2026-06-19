<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\WhatsappMessage;

class WhatsappMessageController extends BaseClinicCrudController
{
    protected string $modelClass = WhatsappMessage::class;
    protected array $searchable = ['provider_message_id', 'content_text', 'delivery_status'];
    protected array $filterable = ['branch_id', 'conversation_id', 'delivery_status', 'direction'];
}
