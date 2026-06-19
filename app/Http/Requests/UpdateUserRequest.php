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
            'role' => ['sometimes', Rule::in(['super_admin', 'clinic_admin', 'branch_manager', 'doctor', 'receptionist', 'assistant'])],
            'status' => ['sometimes', 'nullable', Rule::in(['active', 'inactive', 'blocked'])],
            'branch_ids' => ['sometimes', 'array'],
            'branch_ids.*' => ['integer', 'exists:branches,id'],
            'doctor_ids' => ['sometimes', 'array'],
            'doctor_ids.*' => ['integer', 'exists:doctors,id'],
        ];
    }
}
