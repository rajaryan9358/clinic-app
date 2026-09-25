<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\WhatsappMessage;

class WhatsappMessageController extends BaseCrudController
{
    protected string $modelClass = WhatsappMessage::class;
    protected array $searchable = ['provider_message_id', 'content_text', 'delivery_status'];
    protected array $filterable = ['clinic_id', 'conversation_id', 'delivery_status', 'direction'];
}
