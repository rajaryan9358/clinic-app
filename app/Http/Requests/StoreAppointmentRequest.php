<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreAppointmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'clinic_id' => ['required', 'exists:clinics,id'],
            'doctor_id' => ['required', 'exists:doctors,id'],
            'patient_id' => ['nullable', 'exists:patients,id'],
            'service_id' => ['nullable', 'exists:services,id'],
            'appointment_date' => ['required', 'date'],
            'start_time' => ['required'],
            'end_time' => ['nullable'],
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
}
