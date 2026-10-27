<?php

namespace Tests\Feature\Appointments;

use App\Models\Appointment;
use App\Models\DoctorScheduleException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/** index / show / detail / availability / generate-tokens */
class AppointmentQueryEndpointsTest extends TestCase
{
    use AppointmentTestHelpers;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAppointments();
    }

    #[Test]
    public function index_returns_paginated_shape_scoped_to_the_clinic(): void
    {
        $this->actingAsStaff();
        foreach (range(1, 3) as $i) {
            $this->makeAppointment(['start_time' => sprintf('%02d:00:00', 8 + $i)]);
        }
        $this->makeAppointment(['clinic_id' => $this->otherClinic->id]);

        $res = $this->getJson('/api/clinic/appointments?per_page=2');

        $res->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonStructure([
                'data' => [['id', 'status', 'patient' => ['id', 'full_name', 'phone'], 'doctor' => ['id', 'full_name'], 'prescriptions_count']],
                'meta' => ['current_page', 'per_page', 'total', 'last_page'],
            ])
            ->assertJsonPath('meta.total', 3)
            ->assertJsonPath('meta.per_page', 2)
            ->assertJsonPath('meta.last_page', 2)
            ->assertJsonCount(2, 'data');

        $this->assertSame([$this->clinic->id], collect($res->json('data'))->pluck('clinic_id')->unique()->values()->all());
    }

    #[Test]
    public function index_ignores_an_invalid_sort_instead_of_erroring(): void
    {
        $this->actingAsStaff();
        $this->makeAppointment();

        $this->getJson('/api/clinic/appointments?sort_by=nope&sort_dir=sideways')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    #[Test]
    public function index_filters_by_doctor_status_and_date_range(): void
    {
        $this->actingAsStaff();
        $otherDoc = $this->makeDoctor($this->clinic, 'Dr Two');
        $a = $this->makeAppointment(['status' => 'confirmed']);
        $b = $this->makeAppointment(['status' => 'cancelled']);
        $c = $this->makeAppointment(['doctor_id' => $otherDoc->id]);
        $d = $this->makeAppointment(['appointment_date' => '2026-10-05']);

        $ids = fn (string $qs) => collect($this->getJson('/api/clinic/appointments?'.$qs)->assertOk()->json('data'))
            ->pluck('id')->sort()->values()->all();

        $this->assertSame([$c->id], $ids("doctor_id={$otherDoc->id}"));
        $this->assertSame([$b->id], $ids('status=cancelled'));
        $this->assertSame([$d->id], $ids('appointment_date_from=2026-10-04'));
        $this->assertSame([$a->id, $b->id, $c->id], $ids('appointment_date_from=2026-10-02&appointment_date_to=2026-10-02'));
    }

    #[Test]
    public function index_searches_by_patient_name(): void
    {
        $this->actingAsStaff();
        $match = $this->makeAppointment(['patient_id' => $this->makePatient(null, ['first_name' => 'Zubin', 'full_name' => 'Zubin Mehta'])->id]);
        $this->makeAppointment();

        $res = $this->getJson('/api/clinic/appointments?search=Zubin')->assertOk();

        $this->assertSame([$match->id], collect($res->json('data'))->pluck('id')->all());
    }

    #[Test]
    public function doctor_index_defaults_to_own_active_appointments_today(): void
    {
        $doctorUser = $this->staff('doctor');
        $this->doctor->update(['user_id' => $doctorUser->id]);
        \Laravel\Sanctum\Sanctum::actingAs($doctorUser);
        $otherDoc = $this->makeDoctor($this->clinic, 'Dr Two');

        $mine = $this->makeAppointment(['appointment_date' => $this->today, 'status' => 'checked_in']);
        $this->makeAppointment(['appointment_date' => $this->today, 'status' => 'completed']);
        $this->makeAppointment(['appointment_date' => $this->tomorrow]);
        $this->makeAppointment(['appointment_date' => $this->today, 'doctor_id' => $otherDoc->id]);

        $res = $this->getJson('/api/clinic/appointments')->assertOk();

        $this->assertSame([$mine->id], collect($res->json('data'))->pluck('id')->all());
    }

    #[Test]
    public function doctor_index_default_today_is_clinic_local_not_utc(): void
    {
        // 2026-10-01 20:00 UTC is already 2026-10-02 01:30 in Asia/Kolkata.
        $this->travelTo(\Illuminate\Support\Carbon::parse('2026-10-01 20:00:00', 'UTC'));
        $doctorUser = $this->staff('doctor');
        $this->doctor->update(['user_id' => $doctorUser->id]);
        \Laravel\Sanctum\Sanctum::actingAs($doctorUser);

        $localToday = $this->makeAppointment(['appointment_date' => $this->tomorrow]);
        $this->makeAppointment(['appointment_date' => $this->today, 'start_time' => '11:00:00', 'end_time' => '11:30:00']);

        $res = $this->getJson('/api/clinic/appointments')->assertOk();

        $this->assertSame([$localToday->id], collect($res->json('data'))->pluck('id')->all());
    }

    #[Test]
    public function show_returns_the_appointment(): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment();

        $this->getJson("/api/clinic/appointments/{$appointment->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $appointment->id)
            ->assertJsonPath('data.uuid', $appointment->uuid);
    }

    #[Test]
    public function detail_returns_timeline_communication_and_waitlist_sections(): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment(['appointment_date' => $this->today, 'start_time' => '09:00:00', 'end_time' => '09:30:00']);
        $this->postJson("/api/clinic/appointments/{$appointment->id}/lifecycle", ['status' => 'checked_in'])->assertOk();
        $this->postJson("/api/clinic/appointments/{$appointment->id}/reschedule", [
            'appointment_date' => $this->today, 'start_time' => '09:30', 'end_time' => '10:00',
        ])->assertOk();

        $res = $this->getJson("/api/clinic/appointments/{$appointment->id}/detail");

        $res->assertOk()
            ->assertJsonStructure(['data' => [
                'appointment' => ['id', 'patient', 'doctor'],
                'timeline' => ['status_changes', 'reschedules'],
                'communication' => ['reminders' => ['counts_by_delivery_status', 'recent'], 'whatsapp' => ['count', 'recent']],
                'waitlist',
            ]])
            ->assertJsonPath('data.appointment.id', $appointment->id)
            ->assertJsonCount(1, 'data.timeline.status_changes')
            ->assertJsonPath('data.timeline.status_changes.0.new_status', 'checked_in')
            ->assertJsonCount(1, 'data.timeline.reschedules');
        // Receptionist has whatsapp.view; reschedule queued one message.
        $this->assertGreaterThanOrEqual(1, $res->json('data.communication.whatsapp.count'));
    }

    #[Test]
    public function detail_hides_whatsapp_without_whatsapp_view(): void
    {
        \Laravel\Sanctum\Sanctum::actingAs($this->staffWith(['appointments.view']));
        $appointment = $this->makeAppointment();
        app(\App\Services\WhatsApp\PatientNotifier::class)->bookingConfirmed($appointment);
        $this->assertSame(1, \App\Models\WhatsappMessage::where('appointment_id', $appointment->id)->count());

        $this->getJson("/api/clinic/appointments/{$appointment->id}/detail")
            ->assertOk()
            ->assertJsonPath('data.communication.whatsapp.count', 0)
            ->assertJsonCount(0, 'data.communication.whatsapp.recent');
    }

    #[Test]
    public function availability_lists_slots_and_marks_booked_ones(): void
    {
        $this->actingAsStaff();
        $this->makeAppointment(['start_time' => '10:00:00', 'end_time' => '10:30:00']);
        $this->makeAppointment(['start_time' => '11:00:00', 'end_time' => '11:30:00', 'status' => 'cancelled']);

        $res = $this->getJson("/api/clinic/appointments/availability?doctor_id={$this->doctor->id}&from_date={$this->tomorrow}&to_date=2026-10-03");

        $res->assertOk()
            ->assertJsonPath('data.from_date', $this->tomorrow)
            ->assertJsonPath('data.to_date', '2026-10-03')
            ->assertJsonCount(2, 'data.days')
            ->assertJsonPath('data.days.0.date', $this->tomorrow);

        $slots = collect($res->json('data.days.0.slots'))->keyBy('start_time');
        $this->assertSame(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'], $slots->keys()->all());
        $this->assertSame('10:30', $slots['10:00']['end_time']);
        $this->assertFalse($slots['10:00']['available']);
        $this->assertTrue($slots['11:00']['available'], 'cancelled appointment frees its slot');
        $this->assertTrue($slots['09:30']['available']);
        $this->assertTrue(collect($res->json('data.days.1.slots'))->every(fn ($s) => $s['available']));
    }

    #[Test]
    public function availability_honours_exclude_appointment_id(): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment(['start_time' => '10:00:00', 'end_time' => '10:30:00']);

        $res = $this->getJson("/api/clinic/appointments/availability?doctor_id={$this->doctor->id}&from_date={$this->tomorrow}&to_date={$this->tomorrow}&exclude_appointment_id={$appointment->id}");

        $slot = collect($res->assertOk()->json('data.days.0.slots'))->firstWhere('start_time', '10:00');
        $this->assertTrue($slot['available']);
    }

    #[Test]
    public function availability_respects_leave_and_blocked_exceptions(): void
    {
        $this->actingAsStaff();
        DoctorScheduleException::create([
            'clinic_id' => $this->clinic->id, 'doctor_id' => $this->doctor->id,
            'exception_date' => $this->tomorrow, 'type' => 'leave',
        ]);
        DoctorScheduleException::create([
            'clinic_id' => $this->clinic->id, 'doctor_id' => $this->doctor->id,
            'exception_date' => '2026-10-03', 'type' => 'blocked', 'start_time' => '10:00:00', 'end_time' => '11:00:00',
        ]);

        // to_date runs one day past the blocked day: on SQLite the 'date'
        // cast stores 'Y-m-d 00:00:00', so whereBetween(exception_date,
        // [from, to]) misses an exception on to_date itself (MySQL DATE
        // columns don't have this problem).
        $res = $this->getJson("/api/clinic/appointments/availability?doctor_id={$this->doctor->id}&from_date={$this->tomorrow}&to_date=2026-10-04")->assertOk();

        $this->assertSame([], $res->json('data.days.0.slots'));
        $this->assertSame(['09:00', '09:30', '11:00', '11:30'], collect($res->json('data.days.1.slots'))->pluck('start_time')->all());
    }

    #[Test]
    public function availability_validates_input_and_scopes_the_doctor_to_the_clinic(): void
    {
        $this->actingAsStaff();

        $this->getJson('/api/clinic/appointments/availability')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['doctor_id', 'from_date', 'to_date']);

        $this->getJson("/api/clinic/appointments/availability?doctor_id={$this->otherDoctor->id}&from_date={$this->tomorrow}&to_date={$this->tomorrow}")
            ->assertNotFound();
    }

    #[Test]
    public function generate_tokens_numbers_the_days_live_appointments_by_start_time(): void
    {
        $this->actingAsStaff();
        $late = $this->makeAppointment(['start_time' => '11:00:00', 'end_time' => '11:30:00']);
        $early = $this->makeAppointment(['start_time' => '09:00:00', 'end_time' => '09:30:00']);
        $cancelled = $this->makeAppointment(['start_time' => '09:30:00', 'status' => 'cancelled']);
        $noShow = $this->makeAppointment(['start_time' => '10:00:00', 'status' => 'no_show']);
        $otherDay = $this->makeAppointment(['appointment_date' => '2026-10-03']);
        $otherClinic = $this->makeAppointment(['clinic_id' => $this->otherClinic->id]);

        $this->postJson('/api/clinic/appointments/generate-tokens', ['appointment_date' => $this->tomorrow])
            ->assertOk()
            ->assertJsonPath('data.date', $this->tomorrow)
            ->assertJsonPath('data.count', 2);

        $this->assertSame(1, $early->fresh()->token_number);
        $this->assertSame(2, $late->fresh()->token_number);
        $this->assertNull($cancelled->fresh()->token_number);
        $this->assertNull($noShow->fresh()->token_number);
        $this->assertNull($otherDay->fresh()->token_number);
        $this->assertNull($otherClinic->fresh()->token_number);
    }

    #[Test]
    public function generate_tokens_requires_a_date_and_edit_permission(): void
    {
        $this->actingAsStaff();
        $this->postJson('/api/clinic/appointments/generate-tokens', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['appointment_date']);

        \Laravel\Sanctum\Sanctum::actingAs($this->staffWith(['appointments.view']));
        $this->postJson('/api/clinic/appointments/generate-tokens', ['appointment_date' => $this->tomorrow])
            ->assertForbidden();
    }
}
