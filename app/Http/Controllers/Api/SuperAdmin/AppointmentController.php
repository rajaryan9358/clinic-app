<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Enums\AppointmentStatus;
use App\Http\Controllers\Api\BaseCrudController;
use App\Http\Requests\StatusChangeRequest;
use App\Http\Requests\StoreAppointmentRequest;
use App\Models\Appointment;
use App\Models\AppointmentPrescription;
use App\Models\AppointmentRescheduleLog;
use App\Models\AppointmentStatusLog;
use App\Models\AppointmentSummary;
use App\Models\ReminderLog;
use App\Models\WhatsappMessage;
use App\Services\AppointmentService;
use App\Services\AppointmentPrescriptionAiService;
use App\Services\AppointmentSummaryAiService;
use App\Services\PrescriptionPdfRenderer;
use App\Services\WhatsApp\PatientNotifier;
use App\Services\WhatsApp\PhoneNumber;
use App\Support\Prescriptions\PrescriptionResolver;
use App\Support\Billing\InvoicePresenter;
use App\Support\Waitlist\StaffWaitlistPresenter;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;

class AppointmentController extends BaseCrudController
{
    protected string $modelClass = Appointment::class;

    protected array $searchable = ['uuid', 'status', 'visit_type'];

    protected array $filterable = ['clinic_id', 'doctor_id', 'patient_id', 'status', 'appointment_date', 'visit_type', 'booking_channel'];

    public function __construct(
        private readonly AppointmentService $appointmentService,
        private readonly AppointmentPrescriptionAiService $prescriptionAi,
        private readonly AppointmentSummaryAiService $summaryAi,
        private readonly PrescriptionPdfRenderer $prescriptionPdfRenderer,
    ) {}

    protected function baseQuery(Request $request): Builder
    {
        $query = parent::baseQuery($request)->with([
            'patient:id,full_name,phone',
            'doctor:id,full_name',
        ])->withCount('prescriptions');

        if ($request->filled('appointment_date_from')) {
            $query->whereDate('appointment_date', '>=', $request->input('appointment_date_from'));
        }

        if ($request->filled('appointment_date_to')) {
            $query->whereDate('appointment_date', '<=', $request->input('appointment_date_to'));
        }

        return $query;
    }

    public function index(Request $request)
    {
        $query = $this->baseQuery($request);

        $search = trim($request->string('search')->toString());
        if ($search !== '') {
            $query->where(function (Builder $builder) use ($search) {
                foreach ($this->searchable as $column) {
                    $builder->orWhere($column, 'like', "%{$search}%");
                }

                $builder->orWhereHas('patient', function (Builder $q) use ($search) {
                    $q->where('full_name', 'like', "%{$search}%");
                });

                $builder->orWhereHas('doctor', function (Builder $q) use ($search) {
                    $q->where('full_name', 'like', "%{$search}%");
                });
            });
        }

        foreach ($this->filterable as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->input($filter));
            }
        }

        $sortBy = $request->input('sort_by', $this->defaultSort);
        $sortDir = $request->input('sort_dir', 'desc');
        $query->orderBy($sortBy, $sortDir);

        $result = $query->paginate((int) $request->input('per_page', 15));

        return $this->paginated('Records fetched successfully', $result);
    }

    public function store(Request $request)
    {
        $data = validator($request->all(), (new StoreAppointmentRequest())->rules())->validate();
        $appointment = $this->appointmentService->create($data);

        return $this->success('Appointment created successfully', $appointment, 201);
    }

    public function lifecycle(StatusChangeRequest $request, int $id)
    {
        $appointment = $this->findModel($id);
        $status = AppointmentStatus::from($request->validated('status'));
        $force = $request->validated('force') ?? false;
        $forceAllowed = (bool) $force && (string) ($request->user()?->role ?? '') === 'super_admin';
        $updated = $this->appointmentService->changeStatus(
            $appointment,
            $status,
            $request->user()?->id,
            $request->validated('reason'),
            $forceAllowed
        );

        return $this->success('Appointment status changed successfully', $updated);
    }

    public function reschedule(Request $request, int $id)
    {
        $request->validate([
            'appointment_date' => ['required', 'date'],
            'start_time' => ['required'],
            'end_time' => ['nullable'],
            'reason' => ['nullable', 'string'],
        ]);

        $appointment = $this->findModel($id);
        $updatedAppointment = $this->appointmentService->reschedule(
            $appointment,
            $request->only(['appointment_date', 'start_time', 'end_time']),
            $request->user()?->id,
            $request->string('reason')->toString() ?: null
        );

        return $this->success('Appointment rescheduled successfully', $updatedAppointment);
    }

    public function availability(Request $request)
    {
        $data = $request->validate([
            'clinic_id' => ['required', 'integer'],
            'doctor_id' => ['required', 'integer'],
            'from_date' => ['required', 'date'],
            'to_date' => ['required', 'date'],
            'exclude_appointment_id' => ['nullable', 'integer'],
        ]);

        $days = $this->appointmentService->getDoctorAvailability(
            (int) $data['clinic_id'],
            (int) $data['doctor_id'],
            (string) $data['from_date'],
            (string) $data['to_date'],
            isset($data['exclude_appointment_id']) ? (int) $data['exclude_appointment_id'] : null,
        );

        return $this->success('Availability fetched successfully', [
            'from_date' => (string) $data['from_date'],
            'to_date' => (string) $data['to_date'],
            'days' => $days,
        ]);
    }

    public function detail(int $id)
    {
        $appointment = Appointment::query()
            ->with([
                'patient:id,full_name,phone',
                'doctor:id,full_name',
            ])
            ->findOrFail($id);

        $statusLogs = AppointmentStatusLog::query()
            ->where('clinic_id', $appointment->clinic_id)
            ->where('appointment_id', $appointment->id)
            ->orderBy('created_at')
            ->get();

        $rescheduleLogs = AppointmentRescheduleLog::query()
            ->where('clinic_id', $appointment->clinic_id)
            ->where(function ($q) use ($appointment) {
                $q->where('old_appointment_id', $appointment->id)
                    ->orWhere('new_appointment_id', $appointment->id);
            })
            ->orderBy('created_at')
            ->get();

        $reminders = ReminderLog::query()
            ->where('clinic_id', $appointment->clinic_id)
            ->where('appointment_id', $appointment->id)
            ->orderByDesc('scheduled_for')
            ->limit(10)
            ->get();

        $reminderCounts = ReminderLog::query()
            ->where('clinic_id', $appointment->clinic_id)
            ->where('appointment_id', $appointment->id)
            ->select('delivery_status', DB::raw('count(*) as count'))
            ->groupBy('delivery_status')
            ->get()
            ->map(fn ($row) => ['delivery_status' => $row->delivery_status ?: 'unknown', 'count' => (int) $row->count])
            ->values();

        $whatsapps = WhatsappMessage::query()
            ->where('clinic_id', $appointment->clinic_id)
            ->where('appointment_id', $appointment->id)
            ->orderByDesc('id')
            ->limit(5)
            ->get();

        $whatsappCount = WhatsappMessage::query()
            ->where('clinic_id', $appointment->clinic_id)
            ->where('appointment_id', $appointment->id)
            ->count();

        return $this->success('Appointment detail fetched successfully', [
            'appointment' => $appointment,
            'timeline' => [
                'status_changes' => $statusLogs,
                'reschedules' => $rescheduleLogs,
            ],
            'communication' => [
                'reminders' => [
                    'counts_by_delivery_status' => $reminderCounts,
                    'recent' => $reminders,
                ],
                'whatsapp' => [
                    'count' => (int) $whatsappCount,
                    'recent' => $whatsapps,
                ],
            ],
            'waitlist' => StaffWaitlistPresenter::forAppointment($appointment),
            'invoice' => InvoicePresenter::summaryForAppointment($appointment),
        ]);
    }

    public function prescription(int $id)
    {
        $appointment = Appointment::query()
            ->with(['patient:id,full_name,phone', 'doctor:id,full_name'])
            ->findOrFail($id);

        $latest = PrescriptionResolver::latest($appointment->id);

        return $this->success('Prescription fetched successfully', [
            'appointment_id' => $appointment->id,
            'prescription' => $latest,
            'status' => $latest?->status,
            'finalized_at' => $latest?->finalized_at,
            'latest_final_id' => PrescriptionResolver::latestFinal($appointment->id)?->id,
        ]);
    }

    public function finalizePrescription(Request $request, int $id)
    {
        $appointment = Appointment::query()->findOrFail($id);

        $latest = PrescriptionResolver::latest($appointment->id);

        if (! $latest) {
            abort(404, 'No prescription found for this appointment.');
        }

        if ($latest->status === 'final') {
            return $this->error('This prescription is already final.', null, 422);
        }

        $latest->status = 'final';
        $latest->finalized_at = now();
        $latest->finalized_by_user_id = $request->user()?->id;
        $latest->save();

        return $this->success('Prescription finalized successfully', $latest);
    }

    public function sendPrescription(Request $request, int $id)
    {
        $appointment = Appointment::query()
            ->with(['patient:id,full_name,phone', 'doctor:id,full_name'])
            ->findOrFail($id);

        $latest = PrescriptionResolver::latest($appointment->id);

        if (! $latest) {
            abort(404, 'No prescription found for this appointment.');
        }

        if (PhoneNumber::normalise($appointment->patient?->phone) === null) {
            return $this->error('Patient has no phone number.', null, 422);
        }

        if ($latest->status !== 'final') {
            return $this->error('Finalize the prescription first.', null, 422);
        }

        $prescription = PrescriptionResolver::latestFinal($appointment->id);

        $message = app(PatientNotifier::class)->prescriptionReady($prescription);

        return $this->success('Prescription sent', $message);
    }

    public function reportPdf(Request $request, int $id)
    {
        $appointment = Appointment::query()
            ->with(['patient:id,full_name,phone', 'doctor:id,full_name'])
            ->findOrFail($id);

        $statusLogs = AppointmentStatusLog::query()
            ->where('clinic_id', $appointment->clinic_id)
            ->where('appointment_id', $appointment->id)
            ->orderBy('created_at')
            ->get();

        $rescheduleLogs = AppointmentRescheduleLog::query()
            ->where('clinic_id', $appointment->clinic_id)
            ->where(function ($q) use ($appointment) {
                $q->where('old_appointment_id', $appointment->id)
                    ->orWhere('new_appointment_id', $appointment->id);
            })
            ->orderBy('created_at')
            ->get();

        $latest = AppointmentPrescription::query()
            ->where('clinic_id', $appointment->clinic_id)
            ->where('appointment_id', $appointment->id)
            ->orderByDesc('id')
            ->first();

        $rxData = is_array($latest?->data) ? $latest->data : [];

        $pdf = Pdf::loadView('reports.appointment_detail', [
            'title' => 'Appointment Report',
            'generatedAt' => now()->format('Y-m-d H:i'),
            'appointment' => $appointment,
            'statusLogs' => $statusLogs,
            'rescheduleLogs' => $rescheduleLogs,
            'prescriptionData' => $rxData,
        ])->setPaper('a4', 'portrait');

        return $pdf->download('appointment-report-' . $appointment->id . '.pdf');
    }

    public function prescriptionPdf(Request $request, int $id)
    {
        $appointment = Appointment::query()->findOrFail($id);
        $pdf = $this->prescriptionPdfRenderer->render($appointment);

        return $pdf->download('prescription-' . $appointment->id . '.pdf');
    }

    public function generatePrescriptionFromVoice(Request $request, int $id)
    {
        $request->validate([
            'audio' => ['required', 'file', 'max:10240'],
        ]);

        $appointment = Appointment::query()
            ->with(['patient:id,full_name,phone', 'doctor:id,full_name'])
            ->findOrFail($id);

        $audio = $request->file('audio');
        if (! $audio) {
            return $this->error('Audio file is required', null, 422);
        }

        $transcript = $this->prescriptionAi->transcribeAudio($audio);
        $generated = $this->prescriptionAi->generatePrescriptionFromTranscript($transcript, [
            'patient_name' => (string) ($appointment->patient?->full_name ?? ''),
            'doctor_name' => (string) ($appointment->doctor?->full_name ?? ''),
            'visit_type' => (string) ($appointment->visit_type ?? ''),
        ]);

        $rx = AppointmentPrescription::create([
            'clinic_id' => (int) $appointment->clinic_id,
            'appointment_id' => $appointment->id,
            'created_by_user_id' => $request->user()?->id,
            'source' => 'voice',
            'transcript_text' => $generated['transcript_text'] ?? null,
            'data' => $generated['data'] ?? null,
            'raw' => $generated['raw'] ?? null,
        ]);

        return $this->success('Prescription generated successfully', $rx, 201);
    }

    public function generateTokens(Request $request)
    {
        $request->validate([
            'appointment_date' => ['required', 'date'],
            'clinic_id' => ['required', 'integer'],
        ]);

        $clinicId = (int) $request->input('clinic_id');
        $date = $request->input('appointment_date');

        $query = Appointment::query()
            ->where('clinic_id', $clinicId)
            ->whereDate('appointment_date', $date)
            ->whereNotIn('status', ['cancelled', 'no_show'])
            ->orderBy('start_time');

        $appointments = $query->get(['id', 'start_time']);

        $token = 1;
        foreach ($appointments as $appt) {
            $appt->token_number = $token++;
            $appt->save();
        }

        return $this->success('Tokens generated successfully', [
            'date' => $date,
            'count' => $appointments->count(),
        ]);
    }

    public function summary(Request $request, int $id)
    {
        $appointment = Appointment::query()
            ->with(['patient:id,full_name,phone', 'doctor:id,full_name'])
            ->findOrFail($id);

        $latest = AppointmentSummary::query()
            ->where('clinic_id', (int) $appointment->clinic_id)
            ->where('appointment_id', $appointment->id)
            ->orderByDesc('id')
            ->first();

        return $this->success('Summary fetched successfully', [
            'appointment_id' => $appointment->id,
            'summary' => $latest,
        ]);
    }

    public function generateSummaryFromVoice(Request $request, int $id)
    {
        $request->validate([
            'audio' => ['required', 'file', 'max:10240'],
        ]);

        $appointment = Appointment::query()
            ->with(['patient:id,full_name,phone', 'doctor:id,full_name'])
            ->findOrFail($id);

        $audio = $request->file('audio');
        if (! $audio) {
            return $this->error('Audio file is required', null, 422);
        }

        $transcript = $this->summaryAi->transcribeAudio($audio);
        $generated = $this->summaryAi->generateSummaryFromTranscript($transcript, [
            'patient_name' => (string) ($appointment->patient?->full_name ?? ''),
            'doctor_name' => (string) ($appointment->doctor?->full_name ?? ''),
            'visit_type' => (string) ($appointment->visit_type ?? ''),
        ]);

        $summary = AppointmentSummary::create([
            'clinic_id' => (int) $appointment->clinic_id,
            'appointment_id' => $appointment->id,
            'created_by_user_id' => $request->user()?->id,
            'source' => 'voice',
            'transcript_text' => $generated['transcript_text'] ?? null,
            'patient_summary' => $generated['patient_summary'] ?? null,
            'doctor_suggestions' => $generated['doctor_suggestions'] ?? null,
            'preferred_medications' => $generated['preferred_medications'] ?? [],
            'raw' => $generated['raw'] ?? null,
        ]);

        return $this->success('Summary generated successfully', $summary, 201);
    }
}
