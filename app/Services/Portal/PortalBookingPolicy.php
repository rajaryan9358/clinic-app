<?php

namespace App\Services\Portal;

use App\Enums\AppointmentStatus;
use App\Models\Appointment;
use App\Models\ClinicSetting;
use App\Services\AppointmentService;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * Centralises the patient-portal's booking rules on top of the existing
 * `clinic_settings` cutoffs/window columns: whether a given appointment can
 * still be cancelled/rescheduled, and which slots are legitimately
 * "offered" for a booking/reschedule request.
 *
 * Two related-but-distinct concepts on purpose:
 *  - `freeSlots()` is what the portal shows the patient: offered AND
 *    currently available (not already booked) slots — used by the
 *    GET .../slots listing endpoint.
 *  - `slotFor()` validates that a submitted start_time is a legitimate
 *    offered slot (within the booking window/notice and aligned to the
 *    doctor's schedule grid) WITHOUT checking whether it's already
 *    booked — that check is deliberately left to
 *    `AppointmentService::assertSlotFree()` at create/reschedule time, so
 *    a slot that was free when listed but got taken in the meantime
 *    surfaces as a 409 "just taken" conflict rather than a generic
 *    "not an offered time" 422.
 */
final class PortalBookingPolicy
{
    /**
     * @return array{allow_cancel: bool, cancel_cutoff_hours: int, allow_reschedule: bool, reschedule_cutoff_hours: int, max_advance_booking_days: int, min_booking_notice_minutes: int, booking_enabled: bool}
     */
    public function settings(int $clinicId): array
    {
        $row = ClinicSetting::where('clinic_id', $clinicId)->first();

        return [
            'allow_cancel' => $row !== null ? (bool) $row->allow_cancel : true,
            'cancel_cutoff_hours' => $row !== null ? (int) $row->cancel_cutoff_hours : 2,
            'allow_reschedule' => $row !== null ? (bool) $row->allow_reschedule : true,
            'reschedule_cutoff_hours' => $row !== null ? (int) $row->reschedule_cutoff_hours : 2,
            'max_advance_booking_days' => $row !== null ? (int) $row->max_advance_booking_days : 30,
            'min_booking_notice_minutes' => $row !== null ? (int) $row->min_booking_notice_minutes : 30,
            'booking_enabled' => $row !== null ? (bool) $row->booking_enabled : true,
        ];
    }

    /**
     * @param  'cancel'|'reschedule'  $kind
     * @return string|null null when allowed, otherwise the blocked message.
     */
    public function canChange(Appointment $appointment, string $kind): ?string
    {
        $blockedMessage = 'Changes are closed for this visit. Please call the clinic.';

        // Only a still-open appointment (pending/confirmed) can be changed;
        // anything already checked in, completed, cancelled, a no-show, or
        // itself the product of an earlier reschedule is closed.
        if (! in_array($appointment->status, [AppointmentStatus::PENDING->value, AppointmentStatus::CONFIRMED->value], true)) {
            return $blockedMessage;
        }

        $settings = $this->settings((int) $appointment->clinic_id);

        $allowed = $kind === 'cancel' ? $settings['allow_cancel'] : $settings['allow_reschedule'];
        if (! $allowed) {
            return $blockedMessage;
        }

        $start = $this->startInstant($appointment);
        if ($start === null) {
            return null;
        }

        $cutoffHours = $kind === 'cancel' ? $settings['cancel_cutoff_hours'] : $settings['reschedule_cutoff_hours'];
        $tz = config('app.clinic_timezone', 'Asia/Kolkata');
        $now = Carbon::now($tz);

        if ($now->greaterThan($start->copy()->subHours($cutoffHours))) {
            return $blockedMessage;
        }

        return null;
    }

    /**
     * @return array<int, array{start_time: string, end_time: string}>
     */
    public function freeSlots(int $clinicId, int $doctorId, string $date, ?int $excludeAppointmentId = null): array
    {
        $this->assertDateInWindow($clinicId, $date);

        $tz = config('app.clinic_timezone', 'Asia/Kolkata');
        $settings = $this->settings($clinicId);
        $noticeCutoff = Carbon::now($tz)->addMinutes($settings['min_booking_notice_minutes']);

        $days = app(AppointmentService::class)->getDoctorAvailability($clinicId, $doctorId, $date, $date, $excludeAppointmentId);
        $slots = $days[0]['slots'] ?? [];

        $free = [];
        foreach ($slots as $slot) {
            if (! $slot['available']) {
                continue;
            }

            $slotStart = Carbon::parse($date.' '.$slot['start_time'], $tz);
            if ($slotStart->lessThan($noticeCutoff)) {
                continue;
            }

            $free[] = ['start_time' => $slot['start_time'], 'end_time' => $slot['end_time']];
        }

        return $free;
    }

    /**
     * Finds the offered slot matching $start on $date — aligned to the
     * doctor's schedule grid and outside the notice/advance window —
     * regardless of whether it's currently booked (see class docblock).
     *
     * @return array{start_time: string, end_time: string}
     */
    public function slotFor(int $clinicId, int $doctorId, string $date, string $start, ?int $excludeAppointmentId = null): array
    {
        $this->assertDateInWindow($clinicId, $date);

        $tz = config('app.clinic_timezone', 'Asia/Kolkata');
        $settings = $this->settings($clinicId);
        $noticeCutoff = Carbon::now($tz)->addMinutes($settings['min_booking_notice_minutes']);

        $days = app(AppointmentService::class)->getDoctorAvailability($clinicId, $doctorId, $date, $date, $excludeAppointmentId);
        $slots = $days[0]['slots'] ?? [];

        $normalisedStart = $this->normaliseTime($start);

        foreach ($slots as $slot) {
            if ($slot['start_time'] !== $normalisedStart) {
                continue;
            }

            $slotStart = Carbon::parse($date.' '.$slot['start_time'], $tz);
            if ($slotStart->lessThan($noticeCutoff)) {
                break;
            }

            return ['start_time' => $slot['start_time'], 'end_time' => $slot['end_time']];
        }

        throw ValidationException::withMessages([
            'start_time' => 'Please choose one of the available times.',
        ]);
    }

    private function assertDateInWindow(int $clinicId, string $date): void
    {
        $tz = config('app.clinic_timezone', 'Asia/Kolkata');
        $settings = $this->settings($clinicId);
        $today = Carbon::now($tz)->toDateString();
        $maxDate = Carbon::now($tz)->addDays($settings['max_advance_booking_days'])->toDateString();

        if ($date < $today || $date > $maxDate) {
            throw ValidationException::withMessages([
                'appointment_date' => 'Choose a date within the clinic\'s booking window.',
            ]);
        }
    }

    private function normaliseTime(string $time): string
    {
        try {
            return Carbon::parse($time)->format('H:i');
        } catch (\Throwable) {
            return $time;
        }
    }

    private function startInstant(Appointment $appointment): ?Carbon
    {
        if (! $appointment->appointment_date || ! $appointment->start_time) {
            return null;
        }

        $tz = config('app.clinic_timezone', 'Asia/Kolkata');

        try {
            return Carbon::parse($appointment->appointment_date->toDateString().' '.$appointment->start_time, $tz);
        } catch (\Throwable) {
            return null;
        }
    }
}
