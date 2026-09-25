<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return (string) ($this->user()?->role ?? '') === 'super_admin';
    }

    public function rules(): array
    {
        return [
            'clinic_id' => ['sometimes', 'nullable', 'exists:clinics,id'],
            'full_name' => ['sometimes', 'string', 'max:255'],
            'email' => ['sometimes', 'nullable', 'email'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:20'],
            'password' => ['sometimes', 'nullable', 'string', 'min:8'],
            'role' => ['sometimes', 'string', 'exists:roles,name'],
            'status' => ['sometimes', 'nullable', Rule::in(['active', 'inactive', 'blocked'])],
            'doctor_ids' => ['sometimes', 'array'],
            'doctor_ids.*' => ['integer', 'exists:doctors,id'],
        ];
    }
}
