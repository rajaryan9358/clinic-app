<?php

namespace App\Http\Controllers\Api\Portal;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Concerns\WaitlistResponses;
use App\Http\Controllers\Controller;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\WaitlistEntry;
use App\Services\Portal\PortalBookingPolicy;
use App\Services\Waitlist\WaitlistService;
use App\Support\Portal\AppointmentPresenter;
use App\Support\Portal\WaitlistPresenter;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

/**
 * The acting profile's (`portal_patient`) waitlist: list its active
 * entries, read one (any status — the offer page shows "expired" after
 * staff booked over a hold), join a taken slot, leave, and book or
 * decline an offer. Rules live in WaitlistService; another profile's or
 * clinic's entry is a 404.
 */
class WaitlistController extends Controller
{
    use ApiResponse;
    use WaitlistResponses;

    public function __construct(
        private readonly WaitlistService $waitlist,
        private readonly PortalBookingPolicy $bookingPolicy,
    ) {}

    public function index(Request $request)
    {
        $patient = $this->patient($request);

        $entries = WaitlistEntry::query()
            ->where('patient_id', $patient->id)
            ->active()
            ->with('doctor')
            ->orderBy('appointment_date')
            ->orderBy('start_time')
            ->orderBy('id')
            ->get();

        return $this->success('OK', WaitlistPresenter::items($entries));
    }

    public function show(Request $request, int $id)
    {
        $entry = $this->entry($request, $id);

        return $this->success('OK', WaitlistPresenter::detail($entry->load(['doctor.schedules' => fn ($q) => $q->where('is_active', true), 'clinic'])));
    }

    public function store(Request $request)
    {
        $patient = $this->patient($request);
        $clinicId = (int) $patient->clinic_id;

        if (! $this->bookingPolicy->settings($clinicId)['booking_enabled']) {
            return $this->error("The clinic can't take online bookings right now. Please call the clinic.", null, 422);
        }

        $validated = $request->validate([
            'doctor_id' => ['required', 'integer'],
            'appointment_date' => ['required', 'date_format:Y-m-d'],
            'start_time' => ['required', 'string'],
        ]);

        // Only doctors the portal lists (active) can be waitlisted for.
        $doctor = Doctor::query()->forClinic($clinicId)->where('status', 'active')->find((int) $validated['doctor_id']);
        if (! $doctor) {
            abort(404);
        }

        try {
            $entry = $this->waitlist->join(
                $patient,
                $doctor->id,
                (string) $validated['appointment_date'],
                (string) $validated['start_time'],
                'portal',
            );
        } catch (ConflictHttpException|ValidationException $e) {
            return $this->waitlistError($e);
        }

        return $this->success('Added to the waitlist.', WaitlistPresenter::item($entry->load('doctor')), 201);
    }

    public function destroy(Request $request, int $id)
    {
        $entry = $this->entry($request, $id);

        $this->waitlist->remove($entry);

        return $this->success('Removed from the waitlist.', WaitlistPresenter::item($entry->refresh()->load('doctor')));
    }

    public function book(Request $request, int $id)
    {
        $entry = $this->entry($request, $id);

        $validated = $request->validate([
            'visit_type' => ['required', 'in:new,followup'],
            'consultation_mode' => ['required', 'in:in_person,video,phone'],
            'reason' => ['nullable', 'string', 'max:2000'],
        ]);

        try {
            $appointment = $this->waitlist->book($entry, $validated);
        } catch (ValidationException $e) {
            // assertSlotFree(): someone else's visit overlaps the held slot.
            if (isset($e->errors()['start_time'])) {
                return $this->error('That slot was just taken. Please pick another.', $e->errors(), 409);
            }

            return $this->waitlistError($e);
        }

        return $this->success('Appointment requested.', AppointmentPresenter::item($appointment->load('doctor')), 201);
    }

    public function decline(Request $request, int $id)
    {
        $entry = $this->entry($request, $id);

        try {
            $this->waitlist->decline($entry);
        } catch (ValidationException $e) {
            return $this->waitlistError($e);
        }

        return $this->success('Offer declined.', WaitlistPresenter::item($entry->refresh()->load('doctor')));
    }

    private function patient(Request $request): Patient
    {
        return $request->attributes->get('portal_patient');
    }

    /** The acting profile's own entry (any status), else 404. */
    private function entry(Request $request, int $id): WaitlistEntry
    {
        $patient = $this->patient($request);

        $entry = WaitlistEntry::query()
            ->forClinic((int) $patient->clinic_id)
            ->where('patient_id', $patient->id)
            ->find($id);
        if (! $entry) {
            abort(404);
        }

        return $entry;
    }
}
