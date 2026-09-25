<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return (string) ($this->user()?->role ?? '') === 'super_admin';
    }

    public function rules(): array
    {
        return [
            'clinic_id' => ['nullable', 'exists:clinics,id'],
            'full_name' => ['required', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'required_without:phone'],
            'phone' => ['nullable', 'string', 'max:20', 'required_without:email'],
            'password' => ['required', 'string', 'min:8'],
            'role' => ['required', Rule::in(['super_admin', 'clinic_admin', 'receptionist', 'assistant'])],
            'status' => ['nullable', Rule::in(['active', 'inactive', 'blocked'])],
            'doctor_ids' => ['nullable', 'array'],
            'doctor_ids.*' => ['integer', 'exists:doctors,id'],
        ];
    }
}
