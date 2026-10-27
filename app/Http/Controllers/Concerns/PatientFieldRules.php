<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Validation\Rule;

/**
 * Staff-editable patient fields. managed_by_patient_id is deliberately absent:
 * it only changes through the managed-by endpoint (PatientManagedByService).
 */
trait PatientFieldRules
{
    protected function patientFieldRules(int $clinicId, bool $updating): array
    {
        $required = $updating ? ['sometimes', 'required'] : ['required'];

        return [
            'first_name' => [...$required, 'string', 'max:255'],
            'last_name' => ['nullable', 'string', 'max:255'],
            'full_name' => ['nullable', 'string', 'max:255'],
            'phone' => [...$required, 'string', 'max:20'],
            'alternate_phone' => ['nullable', 'string', 'max:20'],
            'email' => ['nullable', 'email', 'max:255'],
            'gender' => ['nullable', 'in:male,female,other'],
            'dob' => ['nullable', 'date'],
            'age' => ['nullable', 'integer', 'min:0', 'max:150'],
            'blood_group' => ['nullable', 'string', 'max:20'],
            'address_line_1' => ['nullable', 'string', 'max:255'],
            'address_line_2' => ['nullable', 'string', 'max:255'],
            'city' => ['nullable', 'string', 'max:255'],
            'state' => ['nullable', 'string', 'max:255'],
            'pincode' => ['nullable', 'string', 'max:20'],
            'occupation' => ['nullable', 'string', 'max:255'],
            'referred_by' => ['nullable', 'string', 'max:255'],
            'preferred_doctor_id' => ['nullable', 'integer', Rule::exists('doctors', 'id')->where('clinic_id', $clinicId)->whereNull('deleted_at')],
            'communication_consent' => ['sometimes', 'boolean'],
            'whatsapp_opt_in' => ['sometimes', 'boolean'],
            'sms_opt_in' => ['sometimes', 'boolean'],
            'email_opt_in' => ['sometimes', 'boolean'],
            'status_tag' => ['sometimes', 'in:active,followup_due,inactive,blocked'],
        ];
    }
}
