<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\WhatsappMessage;

class WhatsappMessageController extends BaseClinicCrudController
{
    protected string $modelClass = WhatsappMessage::class;
    protected bool $readOnly = true;
    protected array $searchable = ['provider_message_id', 'content_text', 'delivery_status'];
    protected array $filterable = ['conversation_id', 'appointment_id', 'delivery_status', 'direction'];
}
