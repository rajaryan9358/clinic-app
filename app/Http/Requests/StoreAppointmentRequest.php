<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreAppointmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * $clinicId scopes doctor/patient/service to that clinic; the doctor
     * must also be active and not deleted.
     */
    public function rules(?int $clinicId = null): array
    {
        $clinicId ??= $this->filled('clinic_id') ? (int) $this->input('clinic_id') : null;

        return [
            'clinic_id' => ['required', 'exists:clinics,id'],
            'doctor_id' => ['required', Rule::exists('doctors', 'id')
                ->where('clinic_id', $clinicId)
                ->where('status', 'active')
                ->whereNull('deleted_at')],
            'patient_id' => ['nullable', Rule::exists('patients', 'id')
                ->where('clinic_id', $clinicId)
                ->whereNull('deleted_at')],
            'service_id' => ['nullable', Rule::exists('services', 'id')->where('clinic_id', $clinicId)],
            'appointment_date' => ['required', 'date'],
            'start_time' => ['required'],
            'end_time' => ['nullable', 'after:start_time'],
            'visit_type' => ['required', 'in:new,followup,routine,urgent'],
            'consultation_mode' => ['nullable', 'in:in_person,video,phone'],
            'booking_channel' => ['required', 'in:walk_in,phone,website,whatsapp,google,staff,other'],
            'patient' => ['nullable', 'array'],
            'patient.phone' => ['required_with:patient', 'string'],
            'patient.first_name' => ['required_with:patient', 'string'],
            'patient.last_name' => ['nullable', 'string'],
            'patient.email' => ['nullable', 'email'],
            'patient.gender' => ['nullable', 'in:male,female,other'],
            'patient.dob' => ['nullable', 'date'],
            'patient.age' => ['nullable', 'integer', 'min:0'],
        ];
    }

    /**
     * Staff edit (PUT /appointments/{id}) whitelist. Status is accepted
     * only so the edit form can echo it back; AppointmentService::
     * updateDetails() rejects any change to it.
     */
    public static function updateRules(int $clinicId): array
    {
        return [
            'patient_id' => ['sometimes', 'required', Rule::exists('patients', 'id')->where('clinic_id', $clinicId)->whereNull('deleted_at')],
            'doctor_id' => ['sometimes', 'required', Rule::exists('doctors', 'id')->where('clinic_id', $clinicId)->whereNull('deleted_at')],
            'service_id' => ['sometimes', 'nullable', Rule::exists('services', 'id')->where('clinic_id', $clinicId)],
            'appointment_date' => ['sometimes', 'required', 'date'],
            'start_time' => ['sometimes', 'required'],
            'end_time' => ['sometimes', 'nullable', 'after:start_time'],
            'visit_type' => ['sometimes', 'required', 'in:new,followup,routine,urgent'],
            'consultation_mode' => ['sometimes', 'nullable', 'in:in_person,video,phone'],
            'booking_channel' => ['sometimes', 'required', 'in:walk_in,phone,website,whatsapp,google,staff,portal,other'],
            'notes' => ['sometimes', 'nullable', 'string'],
            'status' => ['sometimes', 'nullable', 'string'],
        ];
    }
}
