<?php

namespace App\Models;

use App\Traits\BelongsToClinicScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ClinicSetting extends Model
{
    use HasFactory, BelongsToClinicScope;

    protected $fillable = [
        'clinic_id', 'booking_enabled', 'whatsapp_booking_enabled', 'auto_confirm_appointments',
        'allow_reschedule', 'allow_cancel', 'reschedule_cutoff_hours', 'cancel_cutoff_hours',
        'default_slot_duration_minutes', 'booking_notice_text', 'terms_text', 'privacy_policy_text',
        'walkin_enabled', 'token_system_enabled', 'max_advance_booking_days', 'min_booking_notice_minutes',
    ];

    protected function casts(): array
    {
        return [
            'booking_enabled' => 'boolean',
            'whatsapp_booking_enabled' => 'boolean',
            'auto_confirm_appointments' => 'boolean',
            'allow_reschedule' => 'boolean',
            'allow_cancel' => 'boolean',
            'walkin_enabled' => 'boolean',
            'token_system_enabled' => 'boolean',
            'max_advance_booking_days' => 'integer',
            'min_booking_notice_minutes' => 'integer',
        ];
    }

    public function clinic(): BelongsTo
    {
        return $this->belongsTo(Clinic::class);
    }
}
