<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateClinicRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $clinicId = $this->route('clinic')?->id
            ?? $this->route('clinic')
            ?? $this->route('id');

        return self::rulesFor((int) $clinicId);
    }

    public static function rulesFor(int $clinicId): array
    {
        return [
            'name' => ['sometimes', 'string', 'max:255'],
            'slug' => ['sometimes', 'string', 'max:255', Rule::unique('clinics', 'slug')->ignore($clinicId)],
            'legal_name' => ['nullable', 'string', 'max:255'],
            'owner_name' => ['nullable', 'string', 'max:255'],
            'owner_phone' => ['nullable', 'string', 'max:20'],
            'owner_email' => ['nullable', 'email', 'max:255'],
            'status' => ['nullable', 'in:active,trial,suspended,inactive'],
            'trial_ends_at' => ['nullable', 'date'],
            'logo_url' => ['nullable', 'string', 'max:500'],
            'primary_color' => ['nullable', 'string', 'max:20'],
            'secondary_color' => ['nullable', 'string', 'max:20'],
        ];
    }
}
