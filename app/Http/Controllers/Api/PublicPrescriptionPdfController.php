<?php

namespace App\Http\Controllers\Api;

use App\Models\AppointmentPrescription;
use App\Services\PrescriptionPdfRenderer;
use Illuminate\Http\Request;

/**
 * Public, signature-only endpoint linked from the "prescription_ready"
 * WhatsApp template. No auth: the signed URL itself is the access control.
 */
class PublicPrescriptionPdfController
{
    public function __invoke(Request $request, AppointmentPrescription $prescription, PrescriptionPdfRenderer $renderer)
    {
        return $renderer->renderPrescription($prescription)->stream('prescription-'.$prescription->appointment_id.'.pdf');
    }
}
