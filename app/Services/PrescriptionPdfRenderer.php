<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\AppointmentPrescription;
use Barryvdh\DomPDF\Facade\Pdf;
use Barryvdh\DomPDF\PDF as PdfDocument;

/**
 * Renders the prescription PDF shared by the clinic and super-admin
 * "prescription.pdf" endpoints and the signed public WhatsApp link.
 */
class PrescriptionPdfRenderer
{
    public function render(Appointment $appointment): PdfDocument
    {
        $appointment->loadMissing(['patient:id,full_name', 'doctor:id,full_name']);

        $latest = AppointmentPrescription::query()
            ->where('clinic_id', $appointment->clinic_id)
            ->where('appointment_id', $appointment->id)
            ->orderByDesc('id')
            ->first();

        $rxData = is_array($latest?->data) ? $latest->data : [];

        $visitType = $appointment->visit_type ? str_replace('_', ' ', (string) $appointment->visit_type) : '-';
        $date = optional($appointment->appointment_date)->format('Y-m-d') ?? '-';
        $time = $appointment->start_time ? substr((string) $appointment->start_time, 0, 5) : '';

        return Pdf::loadView('reports.prescription', [
            'title' => 'Prescription',
            'generatedAt' => now()->format('Y-m-d H:i'),
            'patientName' => $appointment->patient?->full_name ?? ($appointment->patient_id ? ('Patient #'.$appointment->patient_id) : '-'),
            'doctorName' => $appointment->doctor?->full_name ?? ($appointment->doctor_id ? ('Doctor #'.$appointment->doctor_id) : '-'),
            'appointmentDate' => $date,
            'appointmentTime' => $time,
            'visitType' => $visitType,
            'prescriptionData' => $rxData,
        ])->setPaper('a4', 'portrait');
    }
}
