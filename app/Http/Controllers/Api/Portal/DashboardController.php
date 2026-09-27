<?php

namespace App\Http\Controllers\Api\Portal;

use App\Enums\AppointmentStatus;
use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\AppointmentPrescription;
use App\Models\Patient;
use App\Support\Portal\AppointmentPresenter;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * The patient-portal dashboard shell: the soonest upcoming appointment,
 * how many upcoming appointments exist, and how many past appointments
 * have a finalized prescription — all scoped to the *acting* profile
 * (`portal_patient`), not the whole account.
 */
class DashboardController extends Controller
{
    use ApiResponse;

    private const UPCOMING_STATUSES = [
        AppointmentStatus::PENDING->value,
        AppointmentStatus::CONFIRMED->value,
        AppointmentStatus::CHECKED_IN->value,
        AppointmentStatus::IN_CONSULTATION->value,
    ];

    public function show(Request $request)
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');

        // appointment_date/start_time are clinic wall-clock values with
        // no timezone column, so each candidate's start instant is built
        // in config('app.clinic_timezone') before comparing against
        // "now" — see App\Console\Commands\SendWhatsAppReminders.
        $tz = config('app.clinic_timezone', 'Asia/Kolkata');
        $now = Carbon::now();

        $upcoming = Appointment::where('patient_id', $patient->id)
            ->whereIn('status', self::UPCOMING_STATUSES)
            ->whereDate('appointment_date', '>=', $now->clone()->timezone($tz)->toDateString())
            ->with('doctor')
            ->orderBy('appointment_date')
            ->orderBy('start_time')
            ->get()
            ->filter(function (Appointment $appointment) use ($tz, $now) {
                $start = Carbon::parse(
                    $appointment->appointment_date->toDateString().' '.$appointment->start_time,
                    $tz,
                );

                return $start->gte($now);
            })
            ->values();

        // Counts distinct appointments with at least one final
        // prescription (a patient may have several final rows per
        // appointment if it was amended) rather than every final row.
        $finalizedCount = AppointmentPrescription::where('status', 'final')
            ->whereHas('appointment', fn ($query) => $query->where('patient_id', $patient->id))
            ->distinct('appointment_id')
            ->count('appointment_id');

        return $this->success('OK', [
            'next_appointment' => $upcoming->first() ? AppointmentPresenter::item($upcoming->first()) : null,
            'upcoming_count' => $upcoming->count(),
            'finalized_prescriptions_count' => $finalizedCount,
        ]);
    }
}
