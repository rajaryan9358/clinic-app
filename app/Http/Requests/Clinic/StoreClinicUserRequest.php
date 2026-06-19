<?php

namespace App\Http\Requests\Clinic;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreClinicUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        $role = (string) ($this->user()?->role ?? '');
        if (! in_array($role, ['clinic_admin', 'branch_manager'], true)) {
            return false;
        }

        $targetRole = (string) ($this->input('role') ?? '');

        $allowed = match ($role) {
            'clinic_admin' => ['branch_manager', 'receptionist', 'assistant', 'doctor'],
            'branch_manager' => ['receptionist', 'assistant', 'doctor'],
            default => [],
        };

        return in_array($targetRole, $allowed, true);
    }

    public function rules(): array
    {
        return [
            'full_name' => ['required', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'required_without:phone'],
            'phone' => ['nullable', 'string', 'max:20', 'required_without:email'],
            'password' => ['required', 'string', 'min:8'],
            'role' => ['required', Rule::in(['branch_manager', 'receptionist', 'assistant', 'doctor'])],
            'status' => ['nullable', Rule::in(['active', 'inactive', 'blocked'])],
            'branch_ids' => ['nullable', 'array'],
            'branch_ids.*' => ['integer', 'exists:branches,id'],
            'doctor_ids' => ['nullable', 'array'],
            'doctor_ids.*' => ['integer', 'exists:doctors,id'],
        ];
    }
}
