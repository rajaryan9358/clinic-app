<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreDoctorRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'clinic_id' => ['required', 'exists:clinics,id'],
            'title' => ['nullable', 'string', 'max:255'],
            'full_name' => ['required', 'string', 'max:255'],
            'specialization' => ['nullable', 'string', 'max:255'],
            'qualification' => ['nullable', 'string', 'max:255'],
            'gender' => ['nullable', 'in:male,female,other'],
            'experience_years' => ['nullable', 'integer', 'min:0', 'max:80'],
            'phone' => ['nullable', 'string', 'max:20'],
            'email' => ['nullable', 'email'],
            'create_linked_user' => ['nullable', 'boolean'],
            'linked_user' => ['nullable', 'array'],
            'linked_user.full_name' => ['nullable', 'string', 'max:255'],
            'linked_user.email' => ['nullable', 'email'],
            'linked_user.phone' => ['nullable', 'string', 'max:20'],
            'linked_user.password' => ['required_if:create_linked_user,1', 'required_if:create_linked_user,true', 'string', 'min:6'],
            'linked_user.role' => ['nullable', 'string', 'exists:roles,name'],
            'consultation_fee' => ['nullable', 'numeric', 'min:0'],
            'followup_fee' => ['nullable', 'numeric', 'min:0'],
            'slot_duration_minutes' => ['nullable', 'integer', 'min:5', 'max:240'],
            'buffer_time_minutes' => ['nullable', 'integer', 'min:0', 'max:120'],
            'photo_url' => ['nullable', 'string', 'max:2048'],
            'status' => ['nullable', 'in:active,inactive'],
            'schedules' => ['nullable', 'array'],
        ];
    }
}
