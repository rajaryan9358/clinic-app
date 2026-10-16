<?php

namespace Tests\Feature\Portal;

use App\Models\Appointment;
use App\Models\AppointmentStatusLog;
use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\Patient;
use App\Models\Plan;
use App\Models\User;
use App\Models\WhatsappMessage;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\WhatsAppGateway;
use App\Support\PortalConsent;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Patient-portal appointments: list/detail, booking (pending, channel
 * `portal`), cancel/reschedule within the clinic's cutoffs, and the
 * doctors/free-slots endpoints. See app/Services/AppointmentService.php,
 * app/Services/Portal/PortalBookingPolicy.php and
 * app/Http/Controllers/Api/Portal/{AppointmentController,DoctorController}.
 *
 * Clock frozen at 2026-10-01 10:15 Asia/Kolkata (a Thursday): the doctor's
 * schedule is every day 09:00-12:00 in 30-minute slots, so by "now" the
 * 09:00/09:30/10:00 slots on *today* are already past, 10:30 is inside the
 * default 30-minute notice window (cutoff 10:45), and 11:00/11:30 remain
 * offered.
 */
class PortalAppointmentsTest extends TestCase
{
    use RefreshDatabase;
    use PortalTestHelpers;

    private FakeWhatsAppGateway $fake;

    private Clinic $clinic;

    protected Carbon $now;

    protected function setUp(): void
    {
        parent::setUp();

        $this->fake = new FakeWhatsAppGateway;
        $this->app->instance(WhatsAppGateway::class, $this->fake);

        $this->seed(RolesAndPermissionsSeeder::class);

        $this->now = Carbon::parse('2026-10-01 10:15:00', 'Asia/Kolkata');
        $this->travelTo($this->now);

        $this->clinic = $this->makeClinic();
    }

    private function makeDoctorWithSchedule(Clinic $clinic, string $mode = 'in_person'): Doctor
    {
        $doctor = Doctor::create([
            'clinic_id' => $clinic->id,
            'full_name' => 'Dr Asha Rao',
            'specialization' => 'General Medicine',
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
                'consultation_mode' => $mode,
                'slot_duration_minutes' => 30,
                'is_active' => true,
            ]);
        }

        return $doctor;
    }

    /**
     * `makePatient()` leaves `consent_version` null, which the
     * `portal.consent` gate (guarding every route under test here) would
     * reject with a 428. Every acting profile used in these tests needs
     * it pre-stamped.
     */
    private function consentedPatient(Clinic $clinic, array $attrs = []): Patient
    {
        $patient = $this->makePatient($clinic, $attrs);
        $patient->forceFill(['consent_given_at' => now(), 'consent_version' => PortalConsent::VERSION])->save();

        return $patient;
    }

    private function receptionist(Clinic $clinic): User
    {
        $user = User::create([
            'clinic_id' => $clinic->id,
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

    private function directAppointment(Clinic $clinic, Doctor $doctor, Patient $patient, array $overrides = []): Appointment
    {
        return Appointment::create(array_merge([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => $this->now->toDateString(),
            'start_time' => '11:00:00',
            'end_time' => '11:30:00',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => 'confirmed',
        ], $overrides));
    }

    // --- List / detail -----------------------------------------------

    public function test_list_filters_and_ordering_and_detail_scoping(): void
    {
        $doctor = $this->makeDoctorWithSchedule($this->clinic);
        $patient = $this->consentedPatient($this->clinic);
        $other = $this->consentedPatient($this->clinic, ['phone' => '9000000111']);

        $upcomingSoon = $this->directAppointment($this->clinic, $doctor, $patient, [
            'appointment_date' => $this->now->copy()->addDay()->toDateString(),
            'start_time' => '09:00:00',
            'status' => 'confirmed',
        ]);
        $upcomingLater = $this->directAppointment($this->clinic, $doctor, $patient, [
            'appointment_date' => $this->now->copy()->addDays(2)->toDateString(),
            'start_time' => '10:00:00',
            'status' => 'pending',
        ]);
        $past = $this->directAppointment($this->clinic, $doctor, $patient, [
            'appointment_date' => $this->now->copy()->subDay()->toDateString(),
            'start_time' => '09:00:00',
            'status' => 'completed',
        ]);
        $othersAppointment = $this->directAppointment($this->clinic, $doctor, $other, [
            'appointment_date' => $this->now->copy()->addDay()->toDateString(),
            'start_time' => '11:00:00',
        ]);

        $token = $this->portalToken($patient);

        $upcoming = $this->portalGet('/api/portal/appointments?filter=upcoming', $token, $patient->id);
        $upcoming->assertOk();
        $this->assertSame([$upcomingSoon->id, $upcomingLater->id], array_column($upcoming->json('data'), 'id'));

        app('auth')->forgetGuards();
        $pastResp = $this->portalGet('/api/portal/appointments?filter=past', $token, $patient->id);
        $pastResp->assertOk();
        $this->assertSame([$past->id], array_column($pastResp->json('data'), 'id'));

        app('auth')->forgetGuards();
        $all = $this->portalGet('/api/portal/appointments?filter=all', $token, $patient->id);
        $all->assertOk();
        $this->assertCount(3, $all->json('data'));
        $ids = array_column($all->json('data'), 'id');
        $this->assertNotContains($othersAppointment->id, $ids);

        // Each item carries the change flags.
        $item = collect($all->json('data'))->firstWhere('id', $upcomingSoon->id);
        $this->assertArrayHasKey('can_cancel', $item);
        $this->assertArrayHasKey('can_reschedule', $item);
        $this->assertArrayHasKey('change_blocked_reason', $item);
        $this->assertTrue($item['can_cancel']);
        $this->assertNull($item['change_blocked_reason']);

        $pastItem = collect($all->json('data'))->firstWhere('id', $past->id);
        $this->assertFalse($pastItem['can_cancel']);
        $this->assertNotNull($pastItem['change_blocked_reason']);

        app('auth')->forgetGuards();
        $detail = $this->portalGet("/api/portal/appointments/{$upcomingSoon->id}", $token, $patient->id);
        $detail->assertOk();
        $this->assertSame($upcomingSoon->id, $detail->json('data.id'));
        $this->assertArrayHasKey('clinic', $detail->json('data'));
        $this->assertArrayHasKey('has_final_prescription', $detail->json('data'));

        app('auth')->forgetGuards();
        $this->portalGet("/api/portal/appointments/{$othersAppointment->id}", $token, $patient->id)->assertNotFound();
    }

    public function test_list_filters_in_sql_rather_than_loading_every_appointment(): void
    {
        $doctor = $this->makeDoctorWithSchedule($this->clinic);
        $patient = $this->consentedPatient($this->clinic);

        foreach (range(1, 3) as $i) {
            $this->directAppointment($this->clinic, $doctor, $patient, [
                'appointment_date' => $this->now->copy()->addDays($i)->toDateString(),
                'start_time' => '09:00:00',
            ]);
            $this->directAppointment($this->clinic, $doctor, $patient, [
                'appointment_date' => $this->now->copy()->subDays($i)->toDateString(),
                'start_time' => '09:00:00',
            ]);
        }

        $selects = [];
        \Illuminate\Support\Facades\DB::listen(function ($query) use (&$selects) {
            if (str_contains($query->sql, 'from "appointments"') || str_contains($query->sql, 'from `appointments`')) {
                $selects[] = $query->sql;
            }
        });

        $this->portalGet('/api/portal/appointments?filter=past', $this->portalToken($patient), $patient->id)->assertOk();

        $listQuery = collect($selects)->first(fn (string $sql) => str_contains($sql, 'patient_id'));

        $this->assertNotNull($listQuery, 'expected a query selecting the patient\'s appointments');
        $this->assertStringContainsString(
            'appointment_date',
            $listQuery,
            'the past/upcoming split must happen in SQL, not by loading every appointment into PHP'
        );
    }

    public function test_an_appointment_starting_exactly_now_counts_as_upcoming(): void
    {
        $doctor = $this->makeDoctorWithSchedule($this->clinic);
        $patient = $this->consentedPatient($this->clinic);

        $startingNow = $this->directAppointment($this->clinic, $doctor, $patient, [
            'appointment_date' => $this->now->copy()->toDateString(),
            'start_time' => $this->now->copy()->format('H:i:s'),
        ]);

        $token = $this->portalToken($patient);

        $upcoming = $this->portalGet('/api/portal/appointments?filter=upcoming', $token, $patient->id);
        $upcoming->assertOk();
        $this->assertSame([$startingNow->id], array_column($upcoming->json('data'), 'id'));

        app('auth')->forgetGuards();
        $past = $this->portalGet('/api/portal/appointments?filter=past', $token, $patient->id);
        $past->assertOk();
        $this->assertSame([], array_column($past->json('data'), 'id'));
    }

    public function test_item_exposes_independent_cancel_and_reschedule_blocked_reasons(): void
    {
        // allow_cancel disabled, allow_reschedule left enabled: cancel and
        // reschedule must be judged independently rather than collapsing
        // into a single flag/reason, since a patient who can still
        // reschedule must not lose that button/explanation just because
        // cancelling happens to be off.
        $clinic = $this->makeClinic(['allow_cancel' => false, 'allow_reschedule' => true]);
        $doctor = $this->makeDoctorWithSchedule($clinic);
        $patient = $this->consentedPatient($clinic);
        $token = $this->portalToken($patient);

        $threeHoursOut = $this->now->copy()->addHours(3);
        $appt = $this->directAppointment($clinic, $doctor, $patient, [
            'appointment_date' => $threeHoursOut->toDateString(),
            'start_time' => $threeHoursOut->format('H:i:s'),
            'status' => 'confirmed',
        ]);

        $detail = $this->portalGet("/api/portal/appointments/{$appt->id}", $token, $patient->id);
        $detail->assertOk();

        $data = $detail->json('data');
        $this->assertFalse($data['can_cancel']);
        $this->assertTrue($data['can_reschedule']);
        $this->assertSame('Changes are closed for this visit. Please call the clinic.', $data['cancel_blocked_reason']);
        $this->assertNull($data['reschedule_blocked_reason']);
        // Back-compat: the collapsed field still reflects whichever
        // action is blocked.
        $this->assertSame($data['cancel_blocked_reason'], $data['change_blocked_reason']);
    }

    // --- Booking -------------------------------------------------------

    public function test_book_creates_pending_portal_appointment_without_whatsapp(): void
    {
        $doctor = $this->makeDoctorWithSchedule($this->clinic);
        $patient = $this->consentedPatient($this->clinic);
        $token = $this->portalToken($patient);

        $date = $this->now->copy()->addDay()->toDateString();

        $response = $this->portalPost('/api/portal/appointments', $token, $patient->id, [
            'doctor_id' => $doctor->id,
            'appointment_date' => $date,
            'start_time' => '09:00',
            'reason' => 'Fever and cough',
        ]);

        $response->assertCreated();
        $this->assertSame('pending', $response->json('data.status'));
        $this->assertSame('portal', $response->json('data.booking_channel'));
        $this->assertSame('09:30', $response->json('data.end_time'));

        $appointment = Appointment::findOrFail($response->json('data.id'));
        $this->assertSame('Fever and cough', $appointment->notes);
        $this->assertSame($patient->id, $appointment->patient_id);

        $lastLog = AppointmentStatusLog::where('appointment_id', $appointment->id)->latest('id')->first();
        $this->assertNotNull($lastLog);
        $this->assertSame('patient', $lastLog->source);

        $this->assertSame(0, WhatsappMessage::where('appointment_id', $appointment->id)->count());
        $this->assertCount(0, $this->fake->sent);
    }

    public function test_book_rejects_times_that_are_not_offered_slots(): void
    {
        $doctor = $this->makeDoctorWithSchedule($this->clinic);
        $patient = $this->consentedPatient($this->clinic);
        $token = $this->portalToken($patient);

        $tomorrow = $this->now->copy()->addDay()->toDateString();
        $today = $this->now->toDateString();

        // Not aligned to the 30-minute grid.
        $this->portalPost('/api/portal/appointments', $token, $patient->id, [
            'doctor_id' => $doctor->id,
            'appointment_date' => $tomorrow,
            'start_time' => '09:10',
        ])->assertStatus(422);

        // A slot today that has already passed ("now" is 10:15).
        app('auth')->forgetGuards();
        $this->portalPost('/api/portal/appointments', $token, $patient->id, [
            'doctor_id' => $doctor->id,
            'appointment_date' => $today,
            'start_time' => '09:00',
        ])->assertStatus(422);

        // A slot inside the 30-minute notice window (cutoff is 10:45; 10:30 < 10:45).
        app('auth')->forgetGuards();
        $this->portalPost('/api/portal/appointments', $token, $patient->id, [
            'doctor_id' => $doctor->id,
            'appointment_date' => $today,
            'start_time' => '10:30',
        ])->assertStatus(422);

        // Beyond the clinic's max advance booking window (default 30 days).
        app('auth')->forgetGuards();
        $this->portalPost('/api/portal/appointments', $token, $patient->id, [
            'doctor_id' => $doctor->id,
            'appointment_date' => $this->now->copy()->addDays(31)->toDateString(),
            'start_time' => '09:00',
        ])->assertStatus(422);

        // A date in the past.
        app('auth')->forgetGuards();
        $this->portalPost('/api/portal/appointments', $token, $patient->id, [
            'doctor_id' => $doctor->id,
            'appointment_date' => $this->now->copy()->subDay()->toDateString(),
            'start_time' => '09:00',
        ])->assertStatus(422);

        // Another clinic's doctor.
        $otherClinic = $this->makeClinic();
        $otherDoctor = $this->makeDoctorWithSchedule($otherClinic);
        app('auth')->forgetGuards();
        $this->portalPost('/api/portal/appointments', $token, $patient->id, [
            'doctor_id' => $otherDoctor->id,
            'appointment_date' => $tomorrow,
            'start_time' => '09:00',
        ])->assertNotFound();

        $this->assertSame(0, Appointment::count());
    }

    public function test_book_when_booking_disabled_returns_422_exact_message(): void
    {
        $clinic = $this->makeClinic(['booking_enabled' => false]);
        $doctor = $this->makeDoctorWithSchedule($clinic);
        $patient = $this->consentedPatient($clinic);
        $token = $this->portalToken($patient);

        $response = $this->portalPost('/api/portal/appointments', $token, $patient->id, [
            'doctor_id' => $doctor->id,
            'appointment_date' => $this->now->copy()->addDay()->toDateString(),
            'start_time' => '09:00',
        ]);

        $response->assertStatus(422);
        $this->assertSame("The clinic can't take online bookings right now. Please call the clinic.", $response->json('message'));
        $this->assertSame(0, Appointment::count());
    }

    public function test_second_booking_of_same_slot_is_409(): void
    {
        $doctor = $this->makeDoctorWithSchedule($this->clinic);
        $patientA = $this->consentedPatient($this->clinic);
        $patientB = $this->consentedPatient($this->clinic, ['phone' => '9000000222']);
        $tokenA = $this->portalToken($patientA);
        $tokenB = $this->portalToken($patientB);

        $date = $this->now->copy()->addDay()->toDateString();

        $first = $this->portalPost('/api/portal/appointments', $tokenA, $patientA->id, [
            'doctor_id' => $doctor->id,
            'appointment_date' => $date,
            'start_time' => '09:00',
        ]);
        $first->assertCreated();

        app('auth')->forgetGuards();
        $second = $this->portalPost('/api/portal/appointments', $tokenB, $patientB->id, [
            'doctor_id' => $doctor->id,
            'appointment_date' => $date,
            'start_time' => '09:00',
        ]);
        $second->assertStatus(409);
        $this->assertSame('That slot was just taken. Please pick another.', $second->json('message'));

        $this->assertSame(1, Appointment::where('doctor_id', $doctor->id)->count());
    }

    public function test_plan_limit_returns_422_message(): void
    {
        $plan = Plan::create(['name' => 'Starter', 'monthly_price' => 99900, 'max_appointments_per_month' => 1]);
        ClinicSubscription::create(['clinic_id' => $this->clinic->id, 'plan_id' => $plan->id, 'billing_cycle' => 'monthly', 'status' => 'active']);

        $doctor = $this->makeDoctorWithSchedule($this->clinic);
        $patient = $this->consentedPatient($this->clinic);

        // One non-cancelled appointment already this month hits the limit.
        $this->directAppointment($this->clinic, $doctor, $patient);

        $token = $this->portalToken($patient);
        $response = $this->portalPost('/api/portal/appointments', $token, $patient->id, [
            'doctor_id' => $doctor->id,
            'appointment_date' => $this->now->copy()->addDay()->toDateString(),
            'start_time' => '09:00',
        ]);

        $response->assertStatus(422);
        $this->assertSame('Your Starter plan allows 1 appointments per month. Upgrade your plan to add more.', $response->json('message'));
    }

    public function test_staff_confirming_portal_booking_sends_confirmation(): void
    {
        $doctor = $this->makeDoctorWithSchedule($this->clinic);
        $patient = $this->consentedPatient($this->clinic);
        $token = $this->portalToken($patient);

        $booked = $this->portalPost('/api/portal/appointments', $token, $patient->id, [
            'doctor_id' => $doctor->id,
            'appointment_date' => $this->now->copy()->addDay()->toDateString(),
            'start_time' => '09:00',
        ]);
        $booked->assertCreated();
        $portalAppointmentId = $booked->json('data.id');

        $this->assertSame(0, WhatsappMessage::where('appointment_id', $portalAppointmentId)->count());

        Sanctum::actingAs($this->receptionist($this->clinic));
        $this->postJson("/api/clinic/appointments/{$portalAppointmentId}/lifecycle", ['status' => 'confirmed'])
            ->assertOk();

        $this->assertSame(1, WhatsappMessage::where('appointment_id', $portalAppointmentId)
            ->where('notification_type', 'booking_confirmed')->count());

        // A staff-created (non-portal) pending appointment already got its
        // row at creation; confirming it must not send a second one.
        Sanctum::actingAs($this->receptionist($this->clinic));
        $staffCreate = $this->postJson('/api/clinic/appointments', [
            'doctor_id' => $doctor->id,
            'patient_id' => $patient->id,
            'appointment_date' => $this->now->copy()->addDays(2)->toDateString(),
            'start_time' => '10:00',
            'end_time' => '10:30',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
        ]);
        $staffCreate->assertCreated();
        $staffAppointmentId = $staffCreate->json('data.id');

        $this->assertSame(1, WhatsappMessage::where('appointment_id', $staffAppointmentId)
            ->where('notification_type', 'booking_confirmed')->count());

        Sanctum::actingAs($this->receptionist($this->clinic));
        $this->postJson("/api/clinic/appointments/{$staffAppointmentId}/lifecycle", ['status' => 'confirmed'])
            ->assertOk();

        $this->assertSame(1, WhatsappMessage::where('appointment_id', $staffAppointmentId)
            ->where('notification_type', 'booking_confirmed')->count());
    }

    // --- Cancel ---------------------------------------------------------

    public function test_cancel_respects_cutoff_and_settings(): void
    {
        $doctor = $this->makeDoctorWithSchedule($this->clinic);
        $patient = $this->consentedPatient($this->clinic);
        $token = $this->portalToken($patient);

        // 3 hours before, default cutoff is 2 hours -> allowed.
        $threeHoursOut = $this->now->copy()->addHours(3);
        $appt = $this->directAppointment($this->clinic, $doctor, $patient, [
            'appointment_date' => $threeHoursOut->toDateString(),
            'start_time' => $threeHoursOut->format('H:i:s'),
            'status' => 'confirmed',
        ]);

        $response = $this->portalPost("/api/portal/appointments/{$appt->id}/cancel", $token, $patient->id, [
            'reason' => 'Feeling better',
        ]);
        $response->assertOk();
        $this->assertSame('cancelled', $response->json('data.status'));

        $appt->refresh();
        $this->assertSame('Feeling better', $appt->cancellation_reason);

        $this->assertSame(1, WhatsappMessage::where('appointment_id', $appt->id)
            ->where('notification_type', 'appointment_updated')->count());

        $lastLog = AppointmentStatusLog::where('appointment_id', $appt->id)->latest('id')->first();
        $this->assertSame('patient', $lastLog->source);

        // 1 hour before, cutoff 2 hours -> blocked.
        $oneHourOut = $this->now->copy()->addHour();
        $apptSoon = $this->directAppointment($this->clinic, $doctor, $patient, [
            'appointment_date' => $oneHourOut->toDateString(),
            'start_time' => $oneHourOut->format('H:i:s'),
            'status' => 'confirmed',
        ]);

        app('auth')->forgetGuards();
        $blocked = $this->portalPost("/api/portal/appointments/{$apptSoon->id}/cancel", $token, $patient->id);
        $blocked->assertStatus(422);
        $this->assertSame('Changes are closed for this visit. Please call the clinic.', $blocked->json('message'));

        // allow_cancel = false clinic-wide.
        $noCancelClinic = $this->makeClinic(['allow_cancel' => false]);
        $noCancelDoctor = $this->makeDoctorWithSchedule($noCancelClinic);
        $noCancelPatient = $this->consentedPatient($noCancelClinic);
        $noCancelAppt = $this->directAppointment($noCancelClinic, $noCancelDoctor, $noCancelPatient, [
            'appointment_date' => $threeHoursOut->toDateString(),
            'start_time' => $threeHoursOut->format('H:i:s'),
            'status' => 'confirmed',
        ]);
        $noCancelToken = $this->portalToken($noCancelPatient);

        app('auth')->forgetGuards();
        $this->portalPost("/api/portal/appointments/{$noCancelAppt->id}/cancel", $noCancelToken, $noCancelPatient->id)
            ->assertStatus(422);

        // A completed appointment can never be cancelled.
        $completed = $this->directAppointment($this->clinic, $doctor, $patient, [
            'appointment_date' => $this->now->copy()->subDay()->toDateString(),
            'start_time' => '09:00:00',
            'status' => 'completed',
        ]);
        app('auth')->forgetGuards();
        $this->portalPost("/api/portal/appointments/{$completed->id}/cancel", $token, $patient->id)
            ->assertStatus(422);
    }

    // --- Reschedule -------------------------------------------------------

    public function test_reschedule_moves_to_pending_and_checks_slot(): void
    {
        $doctor = $this->makeDoctorWithSchedule($this->clinic);
        $patient = $this->consentedPatient($this->clinic);
        $token = $this->portalToken($patient);

        $threeHoursOut = $this->now->copy()->addHours(3);
        $appt = $this->directAppointment($this->clinic, $doctor, $patient, [
            'appointment_date' => $threeHoursOut->toDateString(),
            'start_time' => $threeHoursOut->format('H:i:s'),
            'status' => 'confirmed',
        ]);

        $newDate = $this->now->copy()->addDay()->toDateString();

        $response = $this->portalPost("/api/portal/appointments/{$appt->id}/reschedule", $token, $patient->id, [
            'appointment_date' => $newDate,
            'start_time' => '09:00',
        ]);
        $response->assertOk();
        $this->assertSame('pending', $response->json('data.status'));

        $appt->refresh();
        $this->assertSame($newDate, $appt->appointment_date->toDateString());
        $this->assertSame('09:00', $appt->start_time);

        $this->assertDatabaseHas('appointment_reschedule_logs', [
            'old_appointment_id' => $appt->id,
        ]);

        $this->assertSame(1, WhatsappMessage::where('appointment_id', $appt->id)
            ->where('notification_type', 'appointment_updated')->count());

        // Taken slot -> 409.
        $taken = $this->directAppointment($this->clinic, $doctor, $this->consentedPatient($this->clinic, ['phone' => '9000000333']), [
            'appointment_date' => $newDate,
            'start_time' => '10:00:00',
            'status' => 'confirmed',
        ]);

        app('auth')->forgetGuards();
        $conflict = $this->portalPost("/api/portal/appointments/{$appt->id}/reschedule", $token, $patient->id, [
            'appointment_date' => $newDate,
            'start_time' => '10:00',
        ]);
        $conflict->assertStatus(409);

        // Not-offered time -> 422.
        app('auth')->forgetGuards();
        $this->portalPost("/api/portal/appointments/{$appt->id}/reschedule", $token, $patient->id, [
            'appointment_date' => $newDate,
            'start_time' => '10:10',
        ])->assertStatus(422);

        // Inside reschedule_cutoff_hours -> 422.
        $oneHourOut = $this->now->copy()->addHour();
        $soon = $this->directAppointment($this->clinic, $doctor, $patient, [
            'appointment_date' => $oneHourOut->toDateString(),
            'start_time' => $oneHourOut->format('H:i:s'),
            'status' => 'confirmed',
        ]);
        app('auth')->forgetGuards();
        $this->portalPost("/api/portal/appointments/{$soon->id}/reschedule", $token, $patient->id, [
            'appointment_date' => $newDate,
            'start_time' => '11:00',
        ])->assertStatus(422);

        unset($taken);
    }

    // --- Doctors / slots --------------------------------------------------

    public function test_doctors_and_slots(): void
    {
        $doctor = $this->makeDoctorWithSchedule($this->clinic, 'both');
        $inactiveDoctor = Doctor::create([
            'clinic_id' => $this->clinic->id,
            'full_name' => 'Dr Retired',
            'status' => 'inactive',
        ]);
        $otherClinic = $this->makeClinic();
        $otherClinicDoctor = $this->makeDoctorWithSchedule($otherClinic);

        $patient = $this->consentedPatient($this->clinic);
        $token = $this->portalToken($patient);

        $doctorsResponse = $this->portalGet('/api/portal/doctors', $token, $patient->id);
        $doctorsResponse->assertOk();
        $ids = array_column($doctorsResponse->json('data'), 'id');
        $this->assertContains($doctor->id, $ids);
        $this->assertNotContains($inactiveDoctor->id, $ids);
        $this->assertNotContains($otherClinicDoctor->id, $ids);

        $doctorPayload = collect($doctorsResponse->json('data'))->firstWhere('id', $doctor->id);
        sort($doctorPayload['consultation_modes']);
        $this->assertSame(['in_person', 'video'], $doctorPayload['consultation_modes']);

        // Today: slots before "now" + notice (10:45) are excluded, leaving 11:00 and 11:30.
        app('auth')->forgetGuards();
        $todaySlots = $this->portalGet('/api/portal/doctors/'.$doctor->id.'/slots?date='.$this->now->toDateString(), $token, $patient->id);
        $todaySlots->assertOk();
        $this->assertSame(
            ['11:00', '11:30'],
            array_column($todaySlots->json('data.slots'), 'start_time'),
        );

        // Tomorrow, with one slot already booked.
        $tomorrow = $this->now->copy()->addDay()->toDateString();
        $this->directAppointment($this->clinic, $doctor, $patient, [
            'appointment_date' => $tomorrow,
            'start_time' => '10:00:00',
            'status' => 'confirmed',
        ]);

        app('auth')->forgetGuards();
        $tomorrowSlots = $this->portalGet('/api/portal/doctors/'.$doctor->id.'/slots?date='.$tomorrow, $token, $patient->id);
        $tomorrowSlots->assertOk();
        $this->assertNotContains('10:00', array_column($tomorrowSlots->json('data.slots'), 'start_time'));
        $this->assertContains('09:00', array_column($tomorrowSlots->json('data.slots'), 'start_time'));
    }
}
