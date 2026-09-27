<?php

namespace Tests\Feature\WhatsApp;

use App\Enums\AppointmentStatus;
use App\Models\Appointment;
use App\Models\AppointmentPrescription;
use App\Models\AppointmentStatusLog;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\Patient;
use App\Models\User;
use App\Models\WhatsappMessage;
use App\Services\AppointmentService;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\WhatsAppGateway;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use RuntimeException;
use Tests\TestCase;

/**
 * Wires WhatsApp notifications onto appointment events (booking, reschedule,
 * cancel, prescription created) plus the manual "send prescription" endpoint.
 * See app/Services/AppointmentService.php, app/Models/AppointmentPrescription.php,
 * and the Clinic/SuperAdmin AppointmentController::sendPrescription methods.
 */
class TriggerTest extends TestCase
{
    use RefreshDatabase;

    private FakeWhatsAppGateway $fake;

    private Clinic $clinic;

    private Doctor $doctor;

    private Patient $patient;

    protected function setUp(): void
    {
        parent::setUp();

        $this->fake = new FakeWhatsAppGateway;
        $this->app->instance(WhatsAppGateway::class, $this->fake);

        $this->seed(RolesAndPermissionsSeeder::class);

        $this->clinic = Clinic::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Sunrise Clinic',
            'slug' => 'sunrise-clinic-'.Str::random(6),
            'status' => 'active',
        ]);

        $this->doctor = Doctor::create([
            'clinic_id' => $this->clinic->id,
            'full_name' => 'Dr Asha Rao',
            'slot_duration_minutes' => 30,
        ]);

        $this->patient = Patient::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Ravi',
            'last_name' => 'Kumar',
            'full_name' => 'Ravi Kumar',
            'phone' => '9876543210',
        ]);
    }

    private function receptionist(): User
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

    private function clinicAdmin(): User
    {
        $user = User::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Amit Admin',
            'email' => 'amit-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => 'clinic_admin',
            'status' => 'active',
        ]);
        $user->assignRole('clinic_admin');

        return $user;
    }

    private function scheduleFor(Carbon $date, string $start = '09:00:00', string $end = '13:00:00'): void
    {
        DoctorSchedule::create([
            'clinic_id' => $this->clinic->id,
            'doctor_id' => $this->doctor->id,
            'day_of_week' => $date->dayOfWeek,
            'start_time' => $start,
            'end_time' => $end,
            'consultation_mode' => 'in_person',
            'is_active' => true,
        ]);
    }

    private function bookAppointment(Carbon $date, string $start = '10:00', string $end = '10:30'): Appointment
    {
        $this->scheduleFor($date);
        Sanctum::actingAs($this->receptionist());

        $response = $this->postJson('/api/clinic/appointments', [
            'doctor_id' => $this->doctor->id,
            'patient_id' => $this->patient->id,
            'appointment_date' => $date->toDateString(),
            'start_time' => $start,
            'end_time' => $end,
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
        ]);

        $response->assertCreated();

        return Appointment::find($response->json('data.id'));
    }

    /** @param array<int, array<string, mixed>> $components */
    private function bodyParams(array $components): array
    {
        foreach ($components as $component) {
            if ($component['type'] === 'body') {
                return array_map(fn ($p) => $p['text'], $component['parameters']);
            }
        }

        $this->fail('No body component found.');
    }

    public function test_booking_creates_one_booking_confirmed_row(): void
    {
        $date = Carbon::now()->addDays(3)->startOfDay();
        $appointment = $this->bookAppointment($date);

        $this->assertSame(1, WhatsappMessage::where('appointment_id', $appointment->id)
            ->where('notification_type', 'booking_confirmed')
            ->count());

        $this->assertCount(1, $this->fake->sent);
        $this->assertSame('booking_confirmed', $this->fake->sent[0]['template']);
    }

    /**
     * Task 5 (patient-portal booking): AppointmentService::create()'s
     * $source parameter defaults to 'staff' (unchanged behaviour above);
     * a 'patient' booking with booking_channel 'portal' must record the
     * status log with source 'patient' and send no WhatsApp at all — the
     * confirmation waits until staff/super-admin actually confirms it.
     */
    public function test_portal_channel_booking_sends_no_whatsapp_message(): void
    {
        $date = Carbon::now()->addDays(3)->startOfDay();
        $this->scheduleFor($date);

        $appointment = app(AppointmentService::class)->create([
            'clinic_id' => $this->clinic->id,
            'doctor_id' => $this->doctor->id,
            'patient_id' => $this->patient->id,
            'appointment_date' => $date->toDateString(),
            'start_time' => '10:00',
            'end_time' => '10:30',
            'visit_type' => 'new',
            'booking_channel' => 'portal',
            'status' => 'pending',
        ], 'patient');

        $this->assertSame(0, WhatsappMessage::where('appointment_id', $appointment->id)->count());
        $this->assertCount(0, $this->fake->sent);

        $log = AppointmentStatusLog::where('appointment_id', $appointment->id)->first();
        $this->assertNotNull($log);
        $this->assertSame('patient', $log->source);
    }

    /**
     * changeStatus() only fires bookingConfirmed for a pending -> confirmed
     * transition when booking_channel is 'portal' — this is what lets
     * staff confirming a portal booking send the (only) confirmation.
     */
    public function test_confirming_a_portal_booking_sends_booking_confirmed(): void
    {
        $date = Carbon::now()->addDays(3)->startOfDay();
        $this->scheduleFor($date);

        $appointment = app(AppointmentService::class)->create([
            'clinic_id' => $this->clinic->id,
            'doctor_id' => $this->doctor->id,
            'patient_id' => $this->patient->id,
            'appointment_date' => $date->toDateString(),
            'start_time' => '10:00',
            'end_time' => '10:30',
            'visit_type' => 'new',
            'booking_channel' => 'portal',
            'status' => 'pending',
        ], 'patient');

        app(AppointmentService::class)->changeStatus($appointment, AppointmentStatus::CONFIRMED);

        $this->assertSame(1, WhatsappMessage::where('appointment_id', $appointment->id)
            ->where('notification_type', 'booking_confirmed')->count());
        $this->assertCount(1, $this->fake->sent);
        $this->assertSame('booking_confirmed', $this->fake->sent[0]['template']);
    }

    public function test_reschedule_creates_appointment_updated_with_rescheduled_status_line_and_new_datetime(): void
    {
        $date = Carbon::now()->addDays(3)->startOfDay();
        $appointment = $this->bookAppointment($date);

        Sanctum::actingAs($this->receptionist());
        $response = $this->postJson("/api/clinic/appointments/{$appointment->id}/reschedule", [
            'appointment_date' => $date->toDateString(),
            'start_time' => '11:00',
            'end_time' => '11:30',
        ]);
        $response->assertOk();

        $this->assertSame(1, WhatsappMessage::where('appointment_id', $appointment->id)
            ->where('notification_type', 'appointment_updated')
            ->count());

        $sent = $this->fake->sent[array_key_last($this->fake->sent)];
        $params = $this->bodyParams($sent['components']);
        $statusLine = $params[2];
        $this->assertStringContainsString('has been rescheduled to', $statusLine);

        $newMoment = Carbon::parse($date->toDateString().' 11:00:00');
        $this->assertSame($newMoment->format('D, d M Y'), $params[3]);
        $this->assertSame($newMoment->format('g:i A'), $params[4]);
    }

    public function test_cancelling_creates_appointment_updated_with_cancelled_status_line(): void
    {
        $date = Carbon::now()->addDays(3)->startOfDay();
        $appointment = $this->bookAppointment($date);

        Sanctum::actingAs($this->receptionist());
        $response = $this->postJson("/api/clinic/appointments/{$appointment->id}/lifecycle", [
            'status' => 'cancelled',
        ]);
        $response->assertOk();

        $this->assertSame(1, WhatsappMessage::where('appointment_id', $appointment->id)
            ->where('notification_type', 'appointment_updated')
            ->count());

        $sent = $this->fake->sent[array_key_last($this->fake->sent)];
        $params = $this->bodyParams($sent['components']);
        $this->assertStringContainsString('has been cancelled', $params[2]);
    }

    public function test_other_lifecycle_changes_create_no_whatsapp_message(): void
    {
        // Use a past appointment so the check-in 15-minute window never blocks the transition.
        $date = Carbon::now()->subDays(2)->startOfDay();
        $appointment = $this->bookAppointment($date);

        // Reset the fake so only lifecycle-triggered sends are counted below.
        $this->fake->sent = [];

        Sanctum::actingAs($this->receptionist());

        $this->postJson("/api/clinic/appointments/{$appointment->id}/lifecycle", ['status' => 'checked_in'])
            ->assertOk();
        $this->postJson("/api/clinic/appointments/{$appointment->id}/lifecycle", ['status' => 'completed'])
            ->assertOk();

        $this->assertSame(0, WhatsappMessage::where('appointment_id', $appointment->id)
            ->where('notification_type', 'appointment_updated')
            ->count());
        $this->assertCount(0, $this->fake->sent);
    }

    public function test_appointment_prescription_created_sends_nothing(): void
    {
        // Ruling: the only prescription-creation path today is
        // generatePrescriptionFromVoice, which saves an unreviewed AI draft
        // and creates a new row on every re-record. An automatic
        // created-hook would WhatsApp unreviewed/duplicate prescriptions to
        // patients, so prescriptions are sent ONLY via the manual
        // POST .../prescription/send endpoints — creating a row by itself
        // must never trigger a send.
        $date = Carbon::now()->addDays(3)->startOfDay();
        $appointment = $this->bookAppointment($date);

        // Reset the fake so only prescription-related sends are counted below.
        $this->fake->sent = [];

        $rx = AppointmentPrescription::create([
            'clinic_id' => $this->clinic->id,
            'appointment_id' => $appointment->id,
            'data' => ['notes' => 'Take rest'],
        ]);

        $this->assertSame(0, WhatsappMessage::where('appointment_id', $appointment->id)
            ->where('notification_type', 'prescription_ready')
            ->count());
        $this->assertCount(0, $this->fake->sent);
        $this->assertNotNull($rx->id);
    }

    public function test_manual_send_prescription_endpoint_returns_200_and_creates_one_row(): void
    {
        $date = Carbon::now()->addDays(3)->startOfDay();
        $appointment = $this->bookAppointment($date);

        AppointmentPrescription::create([
            'clinic_id' => $this->clinic->id,
            'appointment_id' => $appointment->id,
            'data' => ['notes' => 'Take rest'],
            'status' => 'final',
        ]);

        $this->assertSame(0, WhatsappMessage::where('appointment_id', $appointment->id)
            ->where('notification_type', 'prescription_ready')
            ->count());

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->postJson("/api/clinic/appointments/{$appointment->id}/prescription/send");

        $response->assertOk();
        $this->assertTrue($response->json('success'));
        $this->assertNotNull($response->json('data.id'));

        $this->assertSame(1, WhatsappMessage::where('appointment_id', $appointment->id)
            ->where('notification_type', 'prescription_ready')
            ->count());
    }

    public function test_manual_send_prescription_with_no_prescription_returns_404(): void
    {
        $date = Carbon::now()->addDays(3)->startOfDay();
        $appointment = $this->bookAppointment($date);

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->postJson("/api/clinic/appointments/{$appointment->id}/prescription/send");

        $response->assertNotFound();
    }

    public function test_manual_send_prescription_with_no_phone_returns_422(): void
    {
        $date = Carbon::now()->addDays(3)->startOfDay();
        $appointment = $this->bookAppointment($date);

        AppointmentPrescription::create([
            'clinic_id' => $this->clinic->id,
            'appointment_id' => $appointment->id,
            'data' => ['notes' => 'Take rest'],
        ]);

        $this->patient->phone = '';
        $this->patient->save();

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->postJson("/api/clinic/appointments/{$appointment->id}/prescription/send");

        $response->assertStatus(422);
        $this->assertSame('Patient has no phone number.', $response->json('message'));
    }

    public function test_rolled_back_booking_sends_nothing(): void
    {
        $date = Carbon::now()->addDays(3)->startOfDay();
        $this->scheduleFor($date);

        $data = [
            'clinic_id' => $this->clinic->id,
            'doctor_id' => $this->doctor->id,
            'patient_id' => $this->patient->id,
            'appointment_date' => $date->toDateString(),
            'start_time' => '10:00',
            'end_time' => '10:30',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
        ];

        try {
            DB::transaction(function () use ($data) {
                app(AppointmentService::class)->create($data);
                throw new RuntimeException('rollback for test');
            });
            $this->fail('Expected RuntimeException to propagate.');
        } catch (RuntimeException $e) {
            $this->assertSame('rollback for test', $e->getMessage());
        }

        $this->assertSame(0, Appointment::count());
        $this->assertSame(0, WhatsappMessage::count());
        $this->assertCount(0, $this->fake->sent);
    }

    public function test_super_admin_manual_send_prescription_endpoint_returns_200(): void
    {
        $date = Carbon::now()->addDays(3)->startOfDay();
        $appointment = $this->bookAppointment($date);

        AppointmentPrescription::create([
            'clinic_id' => $this->clinic->id,
            'appointment_id' => $appointment->id,
            'data' => ['notes' => 'Take rest'],
            'status' => 'final',
        ]);

        $superAdmin = User::create([
            'clinic_id' => null,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Super Admin',
            'email' => 'super-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => 'super_admin',
            'status' => 'active',
        ]);
        $superAdmin->assignRole('super_admin');

        Sanctum::actingAs($superAdmin);
        $response = $this->postJson("/api/super-admin/appointments/{$appointment->id}/prescription/send");

        $response->assertOk();
        $this->assertTrue($response->json('success'));
        $this->assertSame(1, WhatsappMessage::where('appointment_id', $appointment->id)
            ->where('notification_type', 'prescription_ready')
            ->count());
    }

    public function test_manual_send_for_another_clinics_appointment_returns_404_and_sends_nothing(): void
    {
        $otherClinic = Clinic::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Other Clinic',
            'slug' => 'other-clinic-'.Str::random(6),
            'status' => 'active',
        ]);
        $otherDoctor = Doctor::create([
            'clinic_id' => $otherClinic->id,
            'full_name' => 'Dr Other',
            'slot_duration_minutes' => 30,
        ]);
        $otherPatient = Patient::create([
            'clinic_id' => $otherClinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Someone',
            'full_name' => 'Someone Else',
            'phone' => '9000000002',
        ]);
        $date = Carbon::now()->addDays(3)->startOfDay();
        DoctorSchedule::create([
            'clinic_id' => $otherClinic->id,
            'doctor_id' => $otherDoctor->id,
            'day_of_week' => $date->dayOfWeek,
            'start_time' => '09:00:00',
            'end_time' => '13:00:00',
            'consultation_mode' => 'in_person',
            'is_active' => true,
        ]);
        $otherAppointment = Appointment::create([
            'clinic_id' => $otherClinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $otherPatient->id,
            'doctor_id' => $otherDoctor->id,
            'appointment_date' => $date->toDateString(),
            'start_time' => '10:00:00',
            'end_time' => '10:30:00',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => 'confirmed',
        ]);
        AppointmentPrescription::create([
            'clinic_id' => $otherClinic->id,
            'appointment_id' => $otherAppointment->id,
            'data' => ['notes' => 'Take rest'],
        ]);

        $this->fake->sent = [];

        // A user scoped to $this->clinic must not be able to send a
        // prescription belonging to a different clinic's appointment.
        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->postJson("/api/clinic/appointments/{$otherAppointment->id}/prescription/send");

        $response->assertNotFound();
        $this->assertCount(0, $this->fake->sent);
        $this->assertSame(0, WhatsappMessage::where('appointment_id', $otherAppointment->id)
            ->where('notification_type', 'prescription_ready')
            ->count());
    }

    public function test_not_configured_marks_rows_skipped_and_booking_succeeds(): void
    {
        $this->fake->configured = false;

        $date = Carbon::now()->addDays(3)->startOfDay();
        $appointment = $this->bookAppointment($date);

        $row = WhatsappMessage::where('appointment_id', $appointment->id)
            ->where('notification_type', 'booking_confirmed')
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('skipped', $row->delivery_status);
        $this->assertSame('WhatsApp not configured', $row->error_message);
        $this->assertCount(0, $this->fake->sent);
    }
}
