<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class WhatsappMessage extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'conversation_id', 'patient_id', 'appointment_id', 'direction', 'message_type',
        'template_name', 'notification_type', 'provider_message_id', 'from_phone', 'to_phone', 'content_text', 'payload_json',
        'delivery_status', 'error_message', 'sent_by_user_id',
    ];

    protected function casts(): array
    {
        return ['payload_json' => 'array'];
    }
}
