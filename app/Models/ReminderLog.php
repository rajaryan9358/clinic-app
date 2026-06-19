<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ReminderLog extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'appointment_id', 'patient_id', 'channel', 'reminder_type', 'scheduled_for',
        'sent_at', 'delivery_status', 'provider_message_id', 'failure_reason',
    ];

    protected function casts(): array
    {
        return ['scheduled_for' => 'datetime', 'sent_at' => 'datetime'];
    }
}
