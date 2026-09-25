<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreClinicRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'slug' => ['required', 'string', 'max:255', 'unique:clinics,slug'],
            'legal_name' => ['nullable', 'string', 'max:255'],
            'owner_name' => ['nullable', 'string', 'max:255'],
            'owner_phone' => ['nullable', 'string', 'max:20'],
            'owner_email' => ['nullable', 'email', 'max:255'],
            'status' => ['nullable', 'in:active,trial,suspended,inactive'],
            'logo_url' => ['nullable', 'string', 'max:500'],
            'primary_color' => ['nullable', 'string', 'max:20'],
            'secondary_color' => ['nullable', 'string', 'max:20'],
            'address_line_1' => ['nullable', 'string', 'max:255'],
            'address_line_2' => ['nullable', 'string', 'max:255'],
            'city' => ['nullable', 'string', 'max:120'],
            'state' => ['nullable', 'string', 'max:120'],
            'pincode' => ['nullable', 'string', 'max:20'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'phone' => ['nullable', 'string', 'max:20'],
            'email' => ['nullable', 'email', 'max:255'],
            'clinic_admin' => ['nullable', 'array'],
            'clinic_admin.full_name' => ['required_with:clinic_admin', 'string', 'max:255'],
            'clinic_admin.password' => ['required_with:clinic_admin', 'string', 'min:8'],
            'clinic_admin.email' => ['nullable', 'email'],
            'clinic_admin.phone' => ['nullable', 'string', 'max:20'],
            'settings' => ['nullable', 'array'],
            'settings.booking_enabled' => ['sometimes', 'boolean'],
            'settings.walkin_enabled' => ['sometimes', 'boolean'],
            'settings.token_system_enabled' => ['sometimes', 'boolean'],
            'settings.max_advance_booking_days' => ['sometimes', 'integer', 'min:0', 'max:365'],
            'settings.min_booking_notice_minutes' => ['sometimes', 'integer', 'min:0', 'max:10080'],
            'domain' => ['nullable', 'array'],
            'domain.host' => ['nullable', 'string', 'max:255', 'unique:domains,host'],
            'subscription' => ['nullable', 'array'],
            'subscription.plan_id' => ['required_with:subscription', 'integer', Rule::exists('plans', 'id')->where('is_active', true)->whereNull('deleted_at')],
            'subscription.billing_cycle' => ['required_with:subscription', 'in:monthly,yearly'],
            'subscription.start_mode' => ['required_with:subscription', 'in:trial,pending_payment,paid_offline'],
            'subscription.trial_days' => ['sometimes', 'integer', 'min:1', 'max:365'],
            'subscription.offline_amount' => ['required_if:subscription.start_mode,paid_offline', 'integer', 'min:1'],
            'subscription.offline_period_months' => ['sometimes', 'integer', 'min:1', 'max:36'],
            'subscription.offline_notes' => ['nullable', 'string', 'max:500'],
        ];
    }
}
