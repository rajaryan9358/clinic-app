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
        'reminder_hours_before', 'portal_enabled', 'waitlist_enabled', 'waitlist_hold_minutes',
        'invoicing_enabled', 'online_payment_enabled', 'invoice_prefix', 'invoice_tax_percent', 'invoice_footer_note',
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
            'portal_enabled' => 'boolean',
            'waitlist_enabled' => 'boolean',
            'max_advance_booking_days' => 'integer',
            'min_booking_notice_minutes' => 'integer',
            'reminder_hours_before' => 'integer',
            'waitlist_hold_minutes' => 'integer',
            'invoicing_enabled' => 'boolean',
            'online_payment_enabled' => 'boolean',
            'invoice_tax_percent' => 'decimal:2',
        ];
    }

    public function clinic(): BelongsTo
    {
        return $this->belongsTo(Clinic::class);
    }

    /**
     * Validation rules covering every writable clinic_settings field.
     * Shared by the clinic-scoped and super-admin settings controllers so
     * store() and update() apply the same constraints.
     */
    public static function validationRules(): array
    {
        return [
            'booking_enabled' => ['sometimes', 'boolean'],
            'whatsapp_booking_enabled' => ['sometimes', 'boolean'],
            'auto_confirm_appointments' => ['sometimes', 'boolean'],
            'allow_reschedule' => ['sometimes', 'boolean'],
            'allow_cancel' => ['sometimes', 'boolean'],
            'reschedule_cutoff_hours' => ['sometimes', 'integer', 'min:0', 'max:8760'],
            'cancel_cutoff_hours' => ['sometimes', 'integer', 'min:0', 'max:8760'],
            'default_slot_duration_minutes' => ['sometimes', 'integer', 'min:1', 'max:480'],
            'booking_notice_text' => ['sometimes', 'nullable', 'string'],
            'terms_text' => ['sometimes', 'nullable', 'string'],
            'privacy_policy_text' => ['sometimes', 'nullable', 'string'],
            'walkin_enabled' => ['sometimes', 'boolean'],
            'token_system_enabled' => ['sometimes', 'boolean'],
            'max_advance_booking_days' => ['sometimes', 'integer', 'min:0', 'max:365'],
            'min_booking_notice_minutes' => ['sometimes', 'integer', 'min:0', 'max:10080'],
            'reminder_hours_before' => ['sometimes', 'integer', 'min:0', 'max:168'],
            'portal_enabled' => ['sometimes', 'boolean'],
            'waitlist_enabled' => ['sometimes', 'boolean'],
            'waitlist_hold_minutes' => ['sometimes', 'integer', 'min:5', 'max:240'],
            'invoicing_enabled' => ['sometimes', 'boolean'],
            'online_payment_enabled' => ['sometimes', 'boolean'],
            'invoice_prefix' => ['sometimes', 'string', 'max:10'],
            'invoice_tax_percent' => ['sometimes', 'numeric', 'min:0', 'max:100'],
            'invoice_footer_note' => ['sometimes', 'nullable', 'string', 'max:500'],
        ];
    }
}
