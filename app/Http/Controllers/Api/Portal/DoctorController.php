<?php

namespace App\Http\Controllers\Api\Portal;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Doctor;
use App\Models\Patient;
use App\Services\Portal\PortalBookingPolicy;
use Illuminate\Http\Request;

/**
 * Doctors bookable from the patient portal, and a given doctor's free
 * slots for a date (plus the taken ones the acting profile could join
 * the waitlist for) — both scoped to the acting profile's clinic.
 */
class DoctorController extends Controller
{
    use ApiResponse;

    public function __construct(private readonly PortalBookingPolicy $bookingPolicy) {}

    public function index(Request $request)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');

        $doctors = Doctor::query()
            ->forClinic($patient->clinic_id)
            ->where('status', 'active')
            ->with(['schedules' => fn ($q) => $q->where('is_active', true)])
            ->orderBy('full_name')
            ->get();

        $data = $doctors->map(fn (Doctor $doctor) => [
            'id' => $doctor->id,
            'full_name' => $doctor->full_name,
            'specialization' => $doctor->specialization,
            'qualification' => $doctor->qualification,
            'consultation_modes' => $doctor->consultationModes(),
        ])->values();

        return $this->success('OK', $data->all());
    }

    public function slots(Request $request, int $id)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');

        $validated = $request->validate([
            'date' => ['required', 'date'],
        ]);

        $clinicId = (int) $patient->clinic_id;
        $date = (string) $validated['date'];

        // A live waitlist hold for the acting profile stays bookable for
        // them; `taken` lists the times they could join the waitlist for.
        return $this->success('OK', [
            'date' => $validated['date'],
            'slots' => $this->bookingPolicy->freeSlots($clinicId, $id, $date, null, (int) $patient->id),
            'taken' => $this->bookingPolicy->takenSlots($clinicId, $id, $date, (int) $patient->id),
        ]);
    }
}
