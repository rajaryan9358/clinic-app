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
 * slots for a date — both scoped to the acting profile's clinic.
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

        $data = $doctors->map(function (Doctor $doctor) {
            $modes = collect();
            foreach ($doctor->schedules as $schedule) {
                if ($schedule->consultation_mode === 'both') {
                    $modes->push('in_person')->push('video');
                } else {
                    $modes->push($schedule->consultation_mode);
                }
            }

            return [
                'id' => $doctor->id,
                'full_name' => $doctor->full_name,
                'specialization' => $doctor->specialization,
                'qualification' => $doctor->qualification,
                'consultation_modes' => $modes->filter()->unique()->values()->all(),
            ];
        })->values();

        return $this->success('OK', $data->all());
    }

    public function slots(Request $request, int $id)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');

        $validated = $request->validate([
            'date' => ['required', 'date'],
        ]);

        $slots = $this->bookingPolicy->freeSlots(
            (int) $patient->clinic_id,
            $id,
            (string) $validated['date'],
        );

        return $this->success('OK', [
            'date' => $validated['date'],
            'slots' => $slots,
        ]);
    }
}
