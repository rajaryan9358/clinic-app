<?php

namespace Tests\Feature\Appointments;

use App\Models\Appointment;
use App\Models\AppointmentStatusLog;
use App\Models\Patient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class AppointmentCreateTest extends TestCase
{
    use AppointmentTestHelpers;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAppointments();
    }

    #[Test]
    public function books_for_an_existing_patient_and_logs_the_initial_status(): void
    {
        $user = $this->actingAsStaff();
        $patient = $this->makePatient();

        $res = $this->postJson('/api/clinic/appointments', $this->bookingPayload(['patient_id' => $patient->id]));

        $res->assertCreated()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.patient_id', $patient->id)
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.booked_by_user_id', $user->id)
            ->assertJsonPath('data.clinic_id', $this->clinic->id);

        $appointment = Appointment::findOrFail($res->json('data.id'));
        $this->assertNotEmpty($appointment->uuid);
        $this->assertDatabaseHas('appointment_status_logs', [
            'appointment_id' => $appointment->id,
            'old_status' => null,
            'new_status' => 'pending',
            'changed_by_user_id' => $user->id,
            'source' => 'staff',
        ]);
    }

    #[Test]
    public function clinic_id_in_the_payload_is_ignored_in_favour_of_the_users_clinic(): void
    {
        $this->actingAsStaff();
        $patient = $this->makePatient();

        $res = $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient_id' => $patient->id,
            'clinic_id' => $this->otherClinic->id,
        ]));

        $res->assertCreated()->assertJsonPath('data.clinic_id', $this->clinic->id);
    }

    #[Test]
    public function creates_an_inline_new_patient_in_the_staff_clinic(): void
    {
        $this->actingAsStaff();

        $res = $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient' => ['phone' => '9000000001', 'first_name' => 'Neha', 'last_name' => 'Shah', 'gender' => 'female'],
        ]));

        $res->assertCreated();
        $patient = Patient::where('phone', '9000000001')->firstOrFail();
        $this->assertSame($this->clinic->id, (int) $patient->clinic_id);
        $this->assertSame('Neha Shah', $patient->full_name);
        $this->assertSame('Shah', $patient->last_name);
        $this->assertSame($patient->id, (int) $res->json('data.patient_id'));
    }

    #[Test]
    public function inline_patient_with_an_existing_phone_reuses_that_patient(): void
    {
        $this->actingAsStaff();
        $existing = $this->makePatient(null, ['phone' => '9000000002', 'first_name' => 'Original', 'full_name' => 'Original']);

        $res = $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient' => ['phone' => '9000000002', 'first_name' => 'Different'],
        ]));

        $res->assertCreated()->assertJsonPath('data.patient_id', $existing->id);
        $this->assertSame(1, Patient::where('phone', '9000000002')->count());
        $this->assertSame('Original', $existing->fresh()->full_name);
    }

    #[Test]
    public function inline_patient_phone_matching_another_clinics_patient_creates_a_new_local_patient(): void
    {
        $this->actingAsStaff();
        $foreign = $this->makePatient($this->otherClinic, ['phone' => '9000000003']);

        $res = $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient' => ['phone' => '9000000003', 'first_name' => 'Local'],
        ]));

        $res->assertCreated();
        $this->assertNotSame($foreign->id, (int) $res->json('data.patient_id'));
        $this->assertSame(2, Patient::where('phone', '9000000003')->count());
    }

    public static function invalidPayloads(): array
    {
        return [
            'missing doctor' => [['doctor_id' => null], 'doctor_id'],
            'unknown doctor' => [['doctor_id' => 999999], 'doctor_id'],
            'missing date' => [['appointment_date' => null], 'appointment_date'],
            'bad date' => [['appointment_date' => 'not-a-date'], 'appointment_date'],
            'missing start' => [['start_time' => null], 'start_time'],
            'bad visit type' => [['visit_type' => 'checkup'], 'visit_type'],
            'missing booking channel' => [['booking_channel' => null], 'booking_channel'],
            'portal channel not allowed for staff' => [['booking_channel' => 'portal'], 'booking_channel'],
            'bad consultation mode' => [['consultation_mode' => 'carrier_pigeon'], 'consultation_mode'],
            'inline patient missing phone' => [['patient' => ['first_name' => 'X']], 'patient.phone'],
            'inline patient missing first name' => [['patient' => ['phone' => '9000000009']], 'patient.first_name'],
            'inline patient bad email' => [['patient' => ['phone' => '9000000009', 'first_name' => 'X', 'email' => 'nope']], 'patient.email'],
        ];
    }

    #[Test]
    #[DataProvider('invalidPayloads')]
    public function rejects_invalid_payloads(array $overrides, string $field): void
    {
        $this->actingAsStaff();

        $this->postJson('/api/clinic/appointments', $this->bookingPayload($overrides))
            ->assertStatus(422)
            ->assertJsonValidationErrors([$field]);

        $this->assertSame(0, Appointment::count());
    }

    public static function bookingChannels(): array
    {
        return array_map(fn ($c) => [$c], ['walk_in', 'phone', 'website', 'whatsapp', 'google', 'staff', 'other']);
    }

    #[Test]
    #[DataProvider('bookingChannels')]
    public function accepts_every_staff_booking_channel(string $channel): void
    {
        $this->actingAsStaff();
        $patient = $this->makePatient();

        $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient_id' => $patient->id,
            'booking_channel' => $channel,
        ]))->assertCreated()->assertJsonPath('data.booking_channel', $channel);
    }

    #[Test]
    public function staff_booking_sends_a_booking_confirmed_whatsapp(): void
    {
        $this->actingAsStaff();
        $patient = $this->makePatient();

        $this->postJson('/api/clinic/appointments', $this->bookingPayload(['patient_id' => $patient->id]))
            ->assertCreated();

        $this->assertDatabaseHas('whatsapp_messages', [
            'patient_id' => $patient->id,
            'notification_type' => 'booking_confirmed',
        ]);
    }

    #[Test]
    public function back_to_back_staff_bookings_are_allowed(): void
    {
        $this->actingAsStaff();
        $this->makeAppointment(['start_time' => '10:00:00', 'end_time' => '10:30:00']);

        $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient_id' => $this->makePatient()->id,
            'start_time' => '10:30',
            'end_time' => '11:00',
        ]))->assertCreated();
    }

    /**
     * AppointmentService::create() documents that staff bookings skip the
     * conflict check ("staff booking behaviour (no conflict check) is
     * unchanged") — only portal ('patient') bookings call assertSlotFree.
     * Pinned as-is; see report.
     */
    #[Test]
    public function staff_can_double_book_an_overlapping_slot_by_design(): void
    {
        $this->actingAsStaff();
        $this->makeAppointment(['start_time' => '10:00:00', 'end_time' => '10:30:00']);

        $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient_id' => $this->makePatient()->id,
            'start_time' => '10:15',
            'end_time' => '10:45',
        ]))->assertCreated();

        $this->assertSame(2, Appointment::where('doctor_id', $this->doctor->id)->count());
    }

    #[Test]
    public function rejects_end_time_before_start_time(): void
    {
        $this->actingAsStaff();

        $res = $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient_id' => $this->makePatient()->id,
            'start_time' => '11:00',
            'end_time' => '10:00',
        ]));

        $res->assertStatus(422);
    }

    #[Test]
    public function rejects_a_doctor_from_another_clinic(): void
    {
        $this->actingAsStaff();

        $res = $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient_id' => $this->makePatient()->id,
            'doctor_id' => $this->otherDoctor->id,
        ]));

        $res->assertStatus(422)->assertJsonValidationErrors(['doctor_id']);
    }

    #[Test]
    public function rejects_a_patient_from_another_clinic(): void
    {
        $this->actingAsStaff();
        $foreignPatient = $this->makePatient($this->otherClinic);

        $res = $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient_id' => $foreignPatient->id,
        ]));

        $res->assertStatus(422)->assertJsonValidationErrors(['patient_id']);
    }

    #[Test]
    public function rejects_booking_an_inactive_doctor(): void
    {
        $this->actingAsStaff();
        $this->doctor->update(['status' => 'inactive']);

        $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient_id' => $this->makePatient()->id,
        ]))->assertStatus(422);
    }

    /**
     * Staff create does not check schedule, exceptions or past dates
     * (back-office entry / walk-ins). Pinned as current behaviour.
     */
    #[Test]
    public function staff_can_book_outside_schedule_and_in_the_past(): void
    {
        $this->actingAsStaff();

        $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient_id' => $this->makePatient()->id,
            'appointment_date' => $this->yesterday,
            'start_time' => '20:00',
            'end_time' => '20:30',
        ]))->assertCreated();
    }

    /**
     * store() only passes validated keys to the service, and 'status' has
     * no rule, so a staff booking always starts 'pending'.
     */
    #[Test]
    public function client_supplied_status_is_ignored_and_booking_starts_pending(): void
    {
        $this->actingAsStaff();

        $res = $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient_id' => $this->makePatient()->id,
            'status' => 'confirmed',
        ]));

        $res->assertCreated()->assertJsonPath('data.status', 'pending');
        $this->assertSame('pending', AppointmentStatusLog::firstOrFail()->new_status);
    }
}
