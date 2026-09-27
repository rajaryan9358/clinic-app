<?php

namespace App\Http\Controllers\Api\Portal;

use App\Enums\AppointmentStatus;
use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\Patient;
use App\Services\AppointmentService;
use App\Services\Portal\PortalBookingPolicy;
use App\Support\Portal\AppointmentPresenter;
use App\Support\Prescriptions\PrescriptionResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * Patient-facing appointments: list/detail (scoped to the *acting*
 * profile, `portal_patient` — never the whole family), booking a new
 * `pending` appointment (booking_channel `portal`), and cancel/reschedule
 * within the clinic's cutoffs (see PortalBookingPolicy).
 */
class AppointmentController extends Controller
{
    use ApiResponse;

    public function __construct(
        private readonly AppointmentService $appointmentService,
        private readonly PortalBookingPolicy $bookingPolicy,
    ) {}

    public function index(Request $request)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');
        $filter = (string) $request->query('filter', 'all');
        $tz = config('app.clinic_timezone', 'Asia/Kolkata');
        $now = Carbon::now($tz);

        $appointments = Appointment::where('patient_id', $patient->id)->with('doctor')->get();

        $startOf = fn (Appointment $a) => Carbon::parse($a->appointment_date->toDateString().' '.$a->start_time, $tz);

        if ($filter === 'upcoming') {
            $appointments = $appointments->filter(fn ($a) => $startOf($a)->gte($now))
                ->sortBy(fn ($a) => $startOf($a)->timestamp)
                ->values();
        } elseif ($filter === 'past') {
            $appointments = $appointments->filter(fn ($a) => $startOf($a)->lt($now))
                ->sortByDesc(fn ($a) => $startOf($a)->timestamp)
                ->values();
        } else {
            $appointments = $appointments->sortByDesc(fn ($a) => $startOf($a)->timestamp)->values();
        }

        return $this->success('OK', $appointments->map(fn ($a) => AppointmentPresenter::item($a))->all());
    }

    public function show(Request $request, int $id)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');

        $appointment = Appointment::where('patient_id', $patient->id)
            ->with(['doctor', 'clinic'])
            ->find($id);

        if (! $appointment) {
            abort(404);
        }

        $hasFinalPrescription = PrescriptionResolver::latestFinal($appointment->id) !== null;

        return $this->success('OK', AppointmentPresenter::detail($appointment, $hasFinalPrescription));
    }

    public function store(Request $request)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');
        $clinicId = (int) $patient->clinic_id;

        $settings = $this->bookingPolicy->settings($clinicId);
        if (! $settings['booking_enabled']) {
            return $this->error("The clinic can't take online bookings right now. Please call the clinic.", null, 422);
        }

        $validated = $request->validate([
            'doctor_id' => ['required', 'integer'],
            'appointment_date' => ['required', 'date'],
            'start_time' => ['required', 'string'],
            'visit_type' => ['nullable', 'in:new,followup,routine,urgent'],
            'consultation_mode' => ['nullable', 'in:in_person,video,phone'],
            'reason' => ['nullable', 'string', 'max:2000'],
        ]);

        $doctorId = (int) $validated['doctor_id'];
        $date = (string) $validated['appointment_date'];

        $slot = $this->resolveSlot($clinicId, $doctorId, $date, (string) $validated['start_time']);
        if ($slot instanceof JsonResponse) {
            return $slot;
        }

        try {
            $appointment = $this->appointmentService->create([
                'clinic_id' => $clinicId,
                'doctor_id' => $doctorId,
                'patient_id' => $patient->id,
                'appointment_date' => $date,
                'start_time' => $slot['start_time'],
                'end_time' => $slot['end_time'],
                'visit_type' => $validated['visit_type'] ?? 'new',
                'consultation_mode' => $validated['consultation_mode'] ?? 'in_person',
                'booking_channel' => 'portal',
                'status' => 'pending',
                'notes' => $validated['reason'] ?? null,
            ], 'patient');
        } catch (ValidationException $e) {
            return $this->bookingConflictResponse($e);
        }

        return $this->success('Appointment requested.', AppointmentPresenter::item($appointment->load('doctor')), 201);
    }

    public function cancel(Request $request, int $id)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');

        $appointment = Appointment::where('patient_id', $patient->id)->find($id);
        if (! $appointment) {
            abort(404);
        }

        $blockedReason = $this->bookingPolicy->canChange($appointment, 'cancel');
        if ($blockedReason !== null) {
            return $this->error($blockedReason, null, 422);
        }

        $validated = $request->validate([
            'reason' => ['nullable', 'string', 'max:2000'],
        ]);

        $updated = $this->appointmentService->changeStatus(
            $appointment,
            AppointmentStatus::CANCELLED,
            null,
            $validated['reason'] ?? null,
            false,
            'patient',
        );

        return $this->success('Appointment cancelled.', AppointmentPresenter::item($updated->load('doctor')));
    }

    public function reschedule(Request $request, int $id)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');

        $appointment = Appointment::where('patient_id', $patient->id)->find($id);
        if (! $appointment) {
            abort(404);
        }

        $blockedReason = $this->bookingPolicy->canChange($appointment, 'reschedule');
        if ($blockedReason !== null) {
            return $this->error($blockedReason, null, 422);
        }

        $validated = $request->validate([
            'appointment_date' => ['required', 'date'],
            'start_time' => ['required', 'string'],
        ]);

        $date = (string) $validated['appointment_date'];

        $slot = $this->resolveSlot(
            (int) $appointment->clinic_id,
            (int) $appointment->doctor_id,
            $date,
            (string) $validated['start_time'],
            $appointment->id,
        );
        if ($slot instanceof JsonResponse) {
            return $slot;
        }

        try {
            $updated = $this->appointmentService->reschedule(
                $appointment,
                [
                    'appointment_date' => $date,
                    'start_time' => $slot['start_time'],
                    'end_time' => $slot['end_time'],
                ],
                null,
                null,
                'patient',
                AppointmentStatus::PENDING->value,
            );
        } catch (ValidationException $e) {
            return $this->bookingConflictResponse($e);
        }

        return $this->success('Appointment rescheduled.', AppointmentPresenter::item($updated->load('doctor')));
    }

    /**
     * Shared by store()/reschedule(): resolves a submitted date/start_time
     * to the matching offered slot via PortalBookingPolicy::slotFor(), or
     * returns the 422 response for "not an offered time"/"outside the
     * booking window" so the caller can early-return it.
     */
    private function resolveSlot(int $clinicId, int $doctorId, string $date, string $start, ?int $excludeAppointmentId = null): array|JsonResponse
    {
        try {
            return $this->bookingPolicy->slotFor($clinicId, $doctorId, $date, $start, $excludeAppointmentId);
        } catch (ValidationException $e) {
            $errors = $e->errors();
            $message = $errors['appointment_date'][0] ?? ($errors['start_time'][0] ?? 'Please choose one of the available times.');

            return $this->error($message, $errors, 422);
        }
    }

    /**
     * Shared by store()/reschedule(): translates the ValidationException
     * that AppointmentService::create()/reschedule() throw for a slot that
     * got taken between resolveSlot() and the write (start_time -> 409) or,
     * for store() only, a plan limit hit (plan -> 422 with the plan's own
     * message). Any other validation error is a bug, not a user-facing
     * case, so it's rethrown rather than swallowed.
     */
    private function bookingConflictResponse(ValidationException $e): JsonResponse
    {
        $errors = $e->errors();

        if (isset($errors['start_time'])) {
            return $this->error('That slot was just taken. Please pick another.', $errors, 409);
        }

        if (isset($errors['plan'])) {
            return $this->error($errors['plan'][0], $errors, 422);
        }

        throw $e;
    }
}
