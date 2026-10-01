<?php

namespace Tests\Feature\Waitlist;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\Patient;
use App\Models\User;
use App\Models\WaitlistEntry;
use App\Models\WhatsappMessage;
use App\Services\Waitlist\WaitlistService;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\WhatsAppGateway;
use App\Support\PortalConsent;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Feature\Portal\PortalTestHelpers;

/**
 * Shared fixtures for the waitlist feature tests: a clinic (no settings
 * row ⇒ waitlist on, 30-minute hold) with a doctor working every day
 * 09:00-12:00 in 30-minute slots, and the clock frozen at 2026-10-01
 * 10:15 Asia/Kolkata. Call setUpWaitlist() from setUp().
 */
trait WaitlistTestHelpers
{
    use PortalTestHelpers;

    protected FakeWhatsAppGateway $fake;

    protected Clinic $clinic;

    protected Doctor $doctor;

    protected Carbon $now;

    protected string $tomorrow;

    protected function setUpWaitlist(): void
    {
        $this->fake = new FakeWhatsAppGateway;
        $this->app->instance(WhatsAppGateway::class, $this->fake);

        $this->seed(RolesAndPermissionsSeeder::class);

        $this->now = Carbon::parse('2026-10-01 10:15:00', 'Asia/Kolkata');
        // Freeze in UTC (the app timezone): Carbon parses zone-less DB
        // timestamps in the test-now's zone, so an IST test-now would
        // misread every stored datetime.
        $this->travelTo($this->now->copy()->utc());
        $this->tomorrow = $this->now->copy()->addDay()->toDateString();

        // No clinic_settings row: the waitlist must default to on, 30 minutes.
        $this->clinic = $this->makeClinic();
        $this->doctor = $this->makeDoctorWithSchedule($this->clinic);
    }

    protected function makeDoctorWithSchedule(Clinic $clinic): Doctor
    {
        $doctor = Doctor::create([
            'clinic_id' => $clinic->id,
            'full_name' => 'Dr Asha Rao',
            'status' => 'active',
            'slot_duration_minutes' => 30,
        ]);

        for ($day = 0; $day <= 6; $day++) {
            DoctorSchedule::create([
                'clinic_id' => $clinic->id,
                'doctor_id' => $doctor->id,
                'day_of_week' => $day,
                'start_time' => '09:00:00',
                'end_time' => '12:00:00',
                'consultation_mode' => 'in_person',
                'slot_duration_minutes' => 30,
                'is_active' => true,
            ]);
        }

        return $doctor;
    }

    protected function consentedPatient(array $attrs = [], ?Clinic $clinic = null): Patient
    {
        $patient = $this->makePatient($clinic ?? $this->clinic, array_merge([
            'phone' => '90000'.random_int(10000, 99999),
            'full_name' => 'Patient '.Str::random(4),
        ], $attrs));
        $patient->forceFill(['consent_given_at' => now(), 'consent_version' => PortalConsent::VERSION])->save();

        return $patient;
    }

    protected function appointment(Patient $patient, string $date, string $start, array $overrides = [], ?Doctor $doctor = null): Appointment
    {
        $startAt = Carbon::parse($date.' '.$start);

        return Appointment::create(array_merge([
            'clinic_id' => $patient->clinic_id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $patient->id,
            'doctor_id' => ($doctor ?? $this->doctor)->id,
            'appointment_date' => $date,
            'start_time' => $startAt->format('H:i:s'),
            'end_time' => $startAt->copy()->addMinutes(30)->format('H:i:s'),
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => 'confirmed',
        ], $overrides));
    }

    protected function receptionist(): User
    {
        $user = User::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Rita Reception',
            'email' => 'rita-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => 'receptionist',
            'status' => 'active',
        ]);
        $user->assignRole('receptionist');

        return $user;
    }

    protected function service(): WaitlistService
    {
        return app(WaitlistService::class);
    }

    protected function join(Patient $patient, string $date, string $start, string $source = 'portal'): WaitlistEntry
    {
        return $this->service()->join($patient, $this->doctor->id, $date, $start, $source);
    }

    /** An entry already holding the slot for $patient (as slotFreed would leave it). */
    protected function offeredEntry(Patient $patient, string $date, string $start, int $holdMinutes = 30): WaitlistEntry
    {
        return WaitlistEntry::create([
            'clinic_id' => $patient->clinic_id,
            'patient_id' => $patient->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => $date,
            'start_time' => Carbon::parse($start)->format('H:i:s'),
            'end_time' => Carbon::parse($start)->addMinutes(30)->format('H:i:s'),
            'status' => 'offered',
            'source' => 'portal',
            'offered_at' => now(),
            'hold_expires_at' => now()->addMinutes($holdMinutes),
        ]);
    }

    protected function assertValidationMessage(string $expected, \Closure $callback): void
    {
        try {
            $callback();
            $this->fail('Expected a ValidationException: '.$expected);
        } catch (ValidationException $e) {
            $this->assertSame($expected, collect($e->errors())->flatten()->first());
        }
    }

    protected function assertHttpError(int $status, string $expected, \Closure $callback): void
    {
        try {
            $callback();
            $this->fail('Expected an HttpException: '.$expected);
        } catch (HttpException $e) {
            $this->assertSame($status, $e->getStatusCode());
            $this->assertSame($expected, $e->getMessage());
        }
    }

    protected function waitlistMessages(): Builder
    {
        return WhatsappMessage::where('notification_type', 'waitlist_slot_open');
    }
}
