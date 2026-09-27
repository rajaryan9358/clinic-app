<?php

namespace App\Http\Controllers\Api\Portal;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\AppointmentPrescription;
use App\Models\Patient;
use App\Services\PrescriptionPdfRenderer;
use App\Support\Prescriptions\PrescriptionResolver;
use Illuminate\Http\Request;

/**
 * Patient-facing prescriptions, scoped to the *acting* profile
 * (`portal_patient`). Only finalized prescriptions are ever visible here —
 * a draft, however recent, must never reach a patient (see
 * PrescriptionResolver). Where an appointment has several final rows
 * (re-finalized after an edit), only the latest one is shown; a later,
 * still-unreviewed draft never hides or replaces the last final one.
 */
class PrescriptionController extends Controller
{
    use ApiResponse;

    public function index(Request $request)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');

        $appointmentIds = Appointment::where('patient_id', $patient->id)->pluck('id');

        $latestFinalIds = PrescriptionResolver::finalQuery()
            ->whereIn('appointment_id', $appointmentIds)
            ->selectRaw('MAX(id) as id')
            ->groupBy('appointment_id')
            ->pluck('id');

        $items = AppointmentPrescription::query()
            ->whereIn('id', $latestFinalIds)
            ->with('appointment.doctor')
            ->get()
            ->sortByDesc(fn (AppointmentPrescription $rx) => $this->appointmentSortKey($rx->appointment))
            ->values();

        return $this->success('OK', $items->map(fn (AppointmentPrescription $rx) => [
            'id' => $rx->id,
            'appointment_id' => $rx->appointment_id,
            'date' => optional($rx->appointment?->appointment_date)->toDateString(),
            'doctor_name' => $rx->appointment?->doctor?->full_name,
            'medicines' => $this->medicineNames($rx),
        ])->all());
    }

    public function show(Request $request, int $id)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');

        $appointmentIds = Appointment::where('patient_id', $patient->id)->pluck('id');

        $rx = PrescriptionResolver::finalQuery()
            ->whereIn('appointment_id', $appointmentIds)
            ->with(['appointment.doctor', 'appointment.clinic'])
            ->find($id);

        if (! $rx) {
            abort(404);
        }

        $appointment = $rx->appointment;

        return $this->success('OK', [
            'id' => $rx->id,
            'appointment_id' => $rx->appointment_id,
            'date' => optional($appointment?->appointment_date)->toDateString(),
            'doctor' => [
                'name' => $appointment?->doctor?->full_name,
                'specialization' => $appointment?->doctor?->specialization,
            ],
            'clinic' => [
                'name' => $appointment?->clinic?->name,
            ],
            'data' => is_array($rx->data) ? $rx->data : [],
            'finalized_at' => $rx->finalized_at,
        ]);
    }

    public function pdf(Request $request, int $id, PrescriptionPdfRenderer $renderer)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');

        $appointmentIds = Appointment::where('patient_id', $patient->id)->pluck('id');

        $rx = PrescriptionResolver::finalQuery()
            ->whereIn('appointment_id', $appointmentIds)
            ->find($id);

        if (! $rx) {
            abort(404);
        }

        return $renderer->renderPrescription($rx)->stream('prescription-'.$rx->appointment_id.'.pdf');
    }

    private function appointmentSortKey(?Appointment $appointment): string
    {
        if (! $appointment) {
            return '';
        }

        return $appointment->appointment_date->toDateString().' '.$appointment->start_time;
    }

    /** @return string[] */
    private function medicineNames(AppointmentPrescription $rx): array
    {
        $medicines = is_array($rx->data['medicines'] ?? null) ? $rx->data['medicines'] : [];

        return collect($medicines)
            ->map(fn ($m) => (string) ($m['name'] ?? $m['medicine'] ?? ''))
            ->filter(fn ($name) => $name !== '')
            ->values()
            ->all();
    }
}
