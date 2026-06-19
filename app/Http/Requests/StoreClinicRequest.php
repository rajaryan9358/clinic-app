<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

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
            'main_branch' => ['nullable', 'array'],
            'main_branch.name' => ['required_with:main_branch', 'string', 'max:255'],
            'clinic_admin' => ['nullable', 'array'],
            'clinic_admin.full_name' => ['required_with:clinic_admin', 'string', 'max:255'],
            'clinic_admin.password' => ['required_with:clinic_admin', 'string', 'min:8'],
            'clinic_admin.email' => ['nullable', 'email'],
            'clinic_admin.phone' => ['nullable', 'string', 'max:20'],
            'domain' => ['nullable', 'array'],
            'domain.host' => ['nullable', 'string', 'max:255', 'unique:domains,host'],
        ];
    }
}
