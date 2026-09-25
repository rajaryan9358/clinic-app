<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\AppointmentPrescription;
use App\Models\AppointmentSummary;
use App\Models\FollowupTask;
use App\Models\PatientGlobalSummary;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\PatientMedicalProfile;
use App\Models\PatientNote;
use App\Models\Payment;
use App\Services\PatientGlobalSummaryService;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class PatientProfileController extends Controller
{
    use ApiResponse;

    private function normalizeId(string $id): int
    {
        if ($id === '' || ! ctype_digit($id)) {
            abort(404);
        }

        return (int) $id;
    }

    private function findPatient(int $id): Patient
    {
        return Patient::query()
            ->withTrashed()
            ->with(['medicalProfile'])
            ->findOrFail($id);
    }

    public function profile(Request $request, string $id)
    {
        $patient = $this->findPatient($this->normalizeId($id));
        $clinicId = (int) $patient->clinic_id;

        $counts = [
            'appointments' => Appointment::query()->where('clinic_id', $clinicId)->where('patient_id', $patient->id)->count(),
            'followups' => FollowupTask::query()->where('clinic_id', $clinicId)->where('patient_id', $patient->id)->count(),
            'invoices' => Invoice::query()->where('clinic_id', $clinicId)->where('patient_id', $patient->id)->count(),
            'payments' => Payment::query()->where('clinic_id', $clinicId)->where('patient_id', $patient->id)->count(),
            'notes' => PatientNote::query()->where('clinic_id', $clinicId)->where('patient_id', $patient->id)->count(),
        ];

        return $this->success('Patient profile fetched', [
            'patient' => $patient,
            'counts' => $counts,
        ]);
    }

    public function notes(Request $request, string $id)
    {
        $patient = $this->findPatient($this->normalizeId($id));
        $clinicId = (int) $patient->clinic_id;

        $query = PatientNote::query()
            ->where('clinic_id', $clinicId)
            ->where('patient_id', $patient->id)
            ->with([
                'doctor:id,full_name',
                'createdByUser:id,full_name,role',
            ])
            ->orderByDesc('id');

        $result = $query->paginate((int) $request->input('per_page', 20));

        return $this->paginated('Patient notes fetched', $result);
    }

    public function storeNote(Request $request, string $id)
    {
        $patient = $this->findPatient($this->normalizeId($id));
        $clinicId = (int) $patient->clinic_id;

        $data = validator($request->all(), [
            'note_type' => ['required', 'in:general,doctor_note,reception_note,followup_note'],
            'note' => ['required', 'string'],
            'is_private' => ['nullable', 'boolean'],
            'doctor_id' => [
                'nullable',
                'integer',
                Rule::exists('doctors', 'id')->where('clinic_id', $clinicId),
            ],
        ])->validate();

        $note = PatientNote::create([
            'clinic_id' => $clinicId,
            'patient_id' => $patient->id,
            'doctor_id' => $data['doctor_id'] ?? null,
            'created_by_user_id' => $request->user()->id,
            'note_type' => $data['note_type'],
            'note' => $data['note'],
            'is_private' => (bool) ($data['is_private'] ?? false),
        ]);

        return $this->success('Note added', $note->load(['doctor:id,full_name', 'createdByUser:id,full_name,role']), 201);
    }

    public function updateMedicalProfile(Request $request, string $id)
    {
        $patient = $this->findPatient($this->normalizeId($id));
        $clinicId = (int) $patient->clinic_id;

        $data = validator($request->all(), [
            'allergies' => ['nullable', 'string'],
            'chronic_conditions' => ['nullable', 'string'],
            'current_medications' => ['nullable', 'string'],
            'surgeries_history' => ['nullable', 'string'],
            'family_history' => ['nullable', 'string'],
            'notes' => ['nullable', 'string'],
        ])->validate();

        $profile = PatientMedicalProfile::query()->updateOrCreate(
            ['clinic_id' => $clinicId, 'patient_id' => $patient->id],
            [
                'allergies' => $data['allergies'] ?? null,
                'chronic_conditions' => $data['chronic_conditions'] ?? null,
                'current_medications' => $data['current_medications'] ?? null,
                'surgeries_history' => $data['surgeries_history'] ?? null,
                'family_history' => $data['family_history'] ?? null,
                'notes' => $data['notes'] ?? null,
            ]
        );

        return $this->success('Medical profile saved', $profile);
    }

    public function activity(Request $request, string $id)
    {
        $patient = $this->findPatient($this->normalizeId($id));
        $clinicId = (int) $patient->clinic_id;

        $limit = (int) $request->input('limit', 50);
        $limit = max(10, min(200, $limit));

        $events = [];

        $notes = PatientNote::query()
            ->where('clinic_id', $clinicId)
            ->where('patient_id', $patient->id)
            ->orderByDesc('id')
            ->limit($limit)
            ->get(['id', 'note_type', 'note', 'created_at']);

        foreach ($notes as $note) {
            $events[] = [
                'type' => 'note',
                'id' => $note->id,
                'at' => $note->created_at,
                'title' => Str::limit((string) $note->note, 120),
                'meta' => ['note_type' => $note->note_type],
            ];
        }

        $appointments = Appointment::query()
            ->where('clinic_id', $clinicId)
            ->where('patient_id', $patient->id)
            ->orderByDesc('id')
            ->limit($limit)
            ->get(['id', 'appointment_date', 'start_time', 'status', 'created_at']);

        foreach ($appointments as $appt) {
            $events[] = [
                'type' => 'appointment',
                'id' => $appt->id,
                'at' => $appt->created_at,
                'title' => 'Appointment ' . (string) $appt->status,
                'meta' => [
                    'appointment_date' => optional($appt->appointment_date)->toDateString(),
                    'start_time' => $appt->start_time,
                    'status' => $appt->status,
                ],
            ];
        }

        $followups = FollowupTask::query()
            ->where('clinic_id', $clinicId)
            ->where('patient_id', $patient->id)
            ->orderByDesc('id')
            ->limit($limit)
            ->get(['id', 'due_date', 'task_type', 'status', 'created_at']);

        foreach ($followups as $task) {
            $events[] = [
                'type' => 'followup',
                'id' => $task->id,
                'at' => $task->created_at,
                'title' => 'Follow-up ' . (string) $task->status,
                'meta' => [
                    'due_date' => optional($task->due_date)->toDateString(),
                    'task_type' => $task->task_type,
                    'status' => $task->status,
                ],
            ];
        }

        $invoices = Invoice::query()
            ->where('clinic_id', $clinicId)
            ->where('patient_id', $patient->id)
            ->orderByDesc('id')
            ->limit($limit)
            ->get(['id', 'invoice_number', 'invoice_date', 'total_amount', 'status', 'created_at']);

        foreach ($invoices as $inv) {
            $events[] = [
                'type' => 'invoice',
                'id' => $inv->id,
                'at' => $inv->created_at,
                'title' => 'Invoice ' . (string) ($inv->invoice_number ?? ('#' . $inv->id)),
                'meta' => [
                    'invoice_date' => optional($inv->invoice_date)->toDateString(),
                    'total_amount' => $inv->total_amount,
                    'status' => $inv->status,
                ],
            ];
        }

        $payments = Payment::query()
            ->where('clinic_id', $clinicId)
            ->where('patient_id', $patient->id)
            ->orderByDesc('id')
            ->limit($limit)
            ->get(['id', 'amount', 'status', 'paid_at', 'created_at']);

        foreach ($payments as $pay) {
            $events[] = [
                'type' => 'payment',
                'id' => $pay->id,
                'at' => $pay->created_at,
                'title' => 'Payment ' . (string) $pay->status,
                'meta' => [
                    'amount' => $pay->amount,
                    'paid_at' => optional($pay->paid_at)->toISOString(),
                    'status' => $pay->status,
                ],
            ];
        }

        usort($events, fn ($a, $b) => ($b['at'] <=> $a['at']));
        $events = array_slice($events, 0, $limit);

        return $this->success('Patient activity fetched', ['events' => $events]);
    }

    public function reportPdf(Request $request, string $id)
    {
        $patient = $this->findPatient($this->normalizeId($id));
        $clinicId = (int) $patient->clinic_id;

        $appointments = Appointment::query()
            ->where('clinic_id', $clinicId)
            ->where('patient_id', $patient->id)
            ->with(['doctor:id,full_name'])
            ->orderByDesc('appointment_date')
            ->orderByDesc('start_time')
            ->get();

        $followups = FollowupTask::query()
            ->where('clinic_id', $clinicId)
            ->where('patient_id', $patient->id)
            ->orderByDesc('due_date')
            ->orderByDesc('id')
            ->get();

        $notes = PatientNote::query()
            ->where('clinic_id', $clinicId)
            ->where('patient_id', $patient->id)
            ->orderByDesc('id')
            ->get(['id', 'note_type', 'note', 'created_at']);

        $medical = PatientMedicalProfile::query()
            ->where('clinic_id', $clinicId)
            ->where('patient_id', $patient->id)
            ->first();

        $pdf = Pdf::loadView('reports.patient_detail', [
            'title' => 'Patient Report',
            'generatedAt' => now()->format('Y-m-d H:i'),
            'patient' => $patient,
            'medical' => $medical,
            'appointments' => $appointments,
            'followups' => $followups,
            'notes' => $notes,
        ])->setPaper('a4', 'portrait');

        return $pdf->download('patient-report-' . $patient->id . '.pdf');
    }

    public function globalSummary(Request $request, string $id)
    {
        $patient = $this->findPatient($this->normalizeId($id));
        $clinicId = (int) $patient->clinic_id;

        $summary = PatientGlobalSummary::query()
            ->where('clinic_id', $clinicId)
            ->where('patient_id', $patient->id)
            ->first();

        return $this->success('Global summary fetched', ['summary' => $summary]);
    }

    public function generateGlobalSummary(Request $request, string $id)
    {
        $patient = $this->findPatient($this->normalizeId($id));
        $clinicId = (int) $patient->clinic_id;

        $appointments = Appointment::query()
            ->where('clinic_id', $clinicId)
            ->where('patient_id', $patient->id)
            ->with(['doctor:id,full_name'])
            ->orderByDesc('appointment_date')
            ->limit(20)
            ->get(['id', 'appointment_date', 'start_time', 'visit_type', 'status', 'notes', 'doctor_id']);

        $summaries = AppointmentSummary::query()
            ->where('clinic_id', $clinicId)
            ->whereIn('appointment_id', $appointments->pluck('id'))
            ->orderByDesc('id')
            ->get(['appointment_id', 'patient_summary', 'doctor_suggestions', 'preferred_medications', 'created_at']);

        $prescriptions = AppointmentPrescription::query()
            ->where('clinic_id', $clinicId)
            ->whereIn('appointment_id', $appointments->pluck('id'))
            ->orderByDesc('id')
            ->get(['appointment_id', 'data']);

        $notes = PatientNote::query()
            ->where('clinic_id', $clinicId)
            ->where('patient_id', $patient->id)
            ->orderByDesc('id')
            ->limit(10)
            ->get(['note_type', 'note', 'created_at']);

        $service = app(PatientGlobalSummaryService::class);
        $result = $service->generate($patient, $appointments, $summaries, $notes, $prescriptions);

        $summary = PatientGlobalSummary::updateOrCreate(
            ['clinic_id' => $clinicId, 'patient_id' => $patient->id],
            [
                'created_by_user_id' => $request->user()?->id,
                'overall_health_summary' => $result['overall_health_summary'],
                'key_concerns' => $result['key_concerns'],
                'treatment_progress' => $result['treatment_progress'],
                'recommended_focus' => $result['recommended_focus'],
                'summary_generated_at' => now(),
            ]
        );

        return $this->success('Global summary generated', ['summary' => $summary]);
    }
}
