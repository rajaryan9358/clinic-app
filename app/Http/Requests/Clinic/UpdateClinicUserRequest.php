<?php

namespace App\Http\Requests\Clinic;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateClinicUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        $actorRole = (string) ($this->user()?->role ?? '');
        if ($actorRole !== 'clinic_admin') {
            return false;
        }

        $clinicId = (int) ($this->attributes->get('clinic_id') ?? $this->user()?->clinic_id);
        $id = (int) ($this->route('id') ?? 0);
        if ($id <= 0) {
            return false;
        }

        $target = User::query()
            ->where('clinic_id', $clinicId)
            ->select(['id', 'role'])
            ->find($id);

        if (! $target) {
            return false;
        }

        $allowedManageRoles = match ($actorRole) {
            'clinic_admin' => ['receptionist', 'assistant'],
            default => [],
        };

        if (! in_array((string) $target->role, $allowedManageRoles, true)) {
            return false;
        }

        if ($this->filled('role')) {
            $newRole = (string) $this->input('role');
            if (! in_array($newRole, $allowedManageRoles, true)) {
                return false;
            }
        }

        return true;
    }

    public function rules(): array
    {
        return [
            'full_name' => ['sometimes', 'string', 'max:255'],
            'email' => ['sometimes', 'nullable', 'email'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:20'],
            'password' => ['sometimes', 'nullable', 'string', 'min:8'],
            'role' => ['sometimes', Rule::in(['receptionist', 'assistant'])],
            'status' => ['sometimes', 'nullable', Rule::in(['active', 'inactive', 'blocked'])],
            'login_type' => ['sometimes', 'nullable', Rule::in(['password', 'otp'])],
            'doctor_ids' => ['sometimes', 'array'],
            'doctor_ids.*' => ['integer', 'exists:doctors,id'],
        ];
    }
}
