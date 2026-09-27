<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\AppointmentPrescription;
use App\Support\Prescriptions\PrescriptionResolver;
use Barryvdh\DomPDF\Facade\Pdf;
use Barryvdh\DomPDF\PDF as PdfDocument;

/**
 * Renders the prescription PDF shared by the clinic and super-admin
 * "prescription.pdf" endpoints, the signed public WhatsApp link, and the
 * patient portal.
 */
class PrescriptionPdfRenderer
{
    /**
     * Staff "prescription.pdf": prefers the latest finalized prescription
     * so a newer, still-unreviewed draft never silently replaces what's
     * printed/downloaded, but falls back to the latest row (draft or not)
     * so the endpoint keeps working before anything has been finalized.
     */
    public function render(Appointment $appointment): PdfDocument
    {
        $rx = PrescriptionResolver::latestFinal($appointment->id) ?? PrescriptionResolver::latest($appointment->id);

        return $this->renderRow($appointment, $rx);
    }

    /**
     * Renders one specific prescription row regardless of its status —
     * used by the signed public WhatsApp link and the patient portal,
     * both of which already resolved the exact row they mean to show.
     */
    public function renderPrescription(AppointmentPrescription $rx): PdfDocument
    {
        $appointment = $rx->relationLoaded('appointment')
            ? $rx->appointment
            : Appointment::findOrFail($rx->appointment_id);

        return $this->renderRow($appointment, $rx);
    }

    private function renderRow(Appointment $appointment, ?AppointmentPrescription $rx): PdfDocument
    {
        $appointment->loadMissing(['patient:id,full_name', 'doctor:id,full_name']);

        $rxData = is_array($rx?->data) ? $rx->data : [];

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
