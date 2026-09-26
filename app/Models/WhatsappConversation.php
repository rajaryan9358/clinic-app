<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class WhatsappConversation extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'patient_id', 'customer_phone', 'last_message_at',
        'last_incoming_at', 'last_outgoing_at', 'conversation_status', 'current_owner_type',
        'current_owner_user_id', 'tags_json',
    ];

    protected function casts(): array
    {
        return [
            'last_message_at' => 'datetime',
            'last_incoming_at' => 'datetime',
            'last_outgoing_at' => 'datetime',
            'tags_json' => 'array',
        ];
    }
}
