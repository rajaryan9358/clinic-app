<?php

namespace Tests\Feature\Appointments;

use App\Models\Appointment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/** Tenant isolation, doctor/assistant scoping and permission gates. */
class AppointmentAccessTest extends TestCase
{
    use AppointmentTestHelpers;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAppointments();
    }

    public static function foreignAppointmentRequests(): array
    {
        return [
            'show' => ['GET', '', []],
            'detail' => ['GET', '/detail', []],
            'update' => ['PUT', '', ['notes' => 'hijacked']],
            'delete' => ['DELETE', '', []],
            'lifecycle' => ['POST', '/lifecycle', ['status' => 'cancelled']],
            'reschedule' => ['POST', '/reschedule', ['appointment_date' => '2026-10-03', 'start_time' => '11:00', 'end_time' => '11:30']],
            'generic status' => ['POST', '/status', ['status' => 'cancelled']],
        ];
    }

    #[Test]
    #[DataProvider('foreignAppointmentRequests')]
    public function clinic_b_admin_cannot_touch_clinic_a_appointments(string $method, string $suffix, array $payload): void
    {
        $appointment = $this->makeAppointment();
        $before = $appointment->fresh()->toArray();

        $this->actingAsStaff('clinic_admin', $this->otherClinic);

        $this->json($method, "/api/clinic/appointments/{$appointment->id}{$suffix}", $payload)->assertNotFound();

        $this->assertSame($before, $appointment->fresh()?->toArray());
    }

    #[Test]
    public function clinic_b_index_does_not_list_clinic_a_appointments(): void
    {
        $this->makeAppointment();
        $this->actingAsStaff('clinic_admin', $this->otherClinic);

        $this->getJson('/api/clinic/appointments')->assertOk()->assertJsonPath('meta.total', 0);
    }

    #[Test]
    public function clinic_b_generate_tokens_does_not_touch_clinic_a(): void
    {
        $appointment = $this->makeAppointment();
        $this->actingAsStaff('clinic_admin', $this->otherClinic);

        $this->postJson('/api/clinic/appointments/generate-tokens', ['appointment_date' => $this->tomorrow])
            ->assertOk()->assertJsonPath('data.count', 0);
        $this->assertNull($appointment->fresh()->token_number);
    }

    #[Test]
    public function update_cannot_move_an_appointment_to_another_clinics_doctor(): void
    {
        $this->actingAsStaff('clinic_admin');
        $appointment = $this->makeAppointment();

        $this->putJson("/api/clinic/appointments/{$appointment->id}", ['doctor_id' => $this->otherDoctor->id]);

        $this->assertSame($this->doctor->id, (int) $appointment->fresh()->doctor_id);
    }

    #[Test]
    public function clinic_admin_can_update_and_delete(): void
    {
        $this->actingAsStaff('clinic_admin');
        $appointment = $this->makeAppointment();

        $this->putJson("/api/clinic/appointments/{$appointment->id}", ['notes' => 'Bring reports', 'clinic_id' => $this->otherClinic->id])
            ->assertOk()
            ->assertJsonPath('data.notes', 'Bring reports')
            ->assertJsonPath('data.clinic_id', $this->clinic->id);

        $this->deleteJson("/api/clinic/appointments/{$appointment->id}")->assertOk();
        $this->assertNull(Appointment::find($appointment->id));
    }

    public static function gatedRoutes(): array
    {
        return [
            'create' => ['POST', '/api/clinic/appointments', 'appointments.create'],
            'update' => ['PUT', '/api/clinic/appointments/{id}', 'appointments.edit'],
            'reschedule' => ['POST', '/api/clinic/appointments/{id}/reschedule', 'appointments.edit'],
            'generate tokens' => ['POST', '/api/clinic/appointments/generate-tokens', 'appointments.edit'],
            'delete' => ['DELETE', '/api/clinic/appointments/{id}', 'appointments.delete'],
            'generic status' => ['POST', '/api/clinic/appointments/{id}/status', 'appointments.edit'],
        ];
    }

    #[Test]
    #[DataProvider('gatedRoutes')]
    public function view_only_role_is_forbidden(string $method, string $uri, string $permission): void
    {
        $appointment = $this->makeAppointment();
        Sanctum::actingAs($this->staffWith(['appointments.view']));

        $this->json($method, str_replace('{id}', (string) $appointment->id, $uri), $this->bookingPayload())
            ->assertForbidden()
            ->assertJsonPath('success', false);

        $this->assertNotNull(Appointment::find($appointment->id));
        $this->assertSame(1, Appointment::count());
    }

    #[Test]
    public function no_permissions_cannot_read(): void
    {
        $appointment = $this->makeAppointment();
        Sanctum::actingAs($this->staffWith([]));

        $this->getJson('/api/clinic/appointments')->assertForbidden();
        $this->getJson("/api/clinic/appointments/{$appointment->id}")->assertForbidden();
        $this->getJson("/api/clinic/appointments/{$appointment->id}/detail")->assertForbidden();
    }

    #[Test]
    public function receptionist_cannot_delete_by_default(): void
    {
        $appointment = $this->makeAppointment();
        $this->actingAsStaff('receptionist');

        $this->deleteJson("/api/clinic/appointments/{$appointment->id}")->assertForbidden();
    }

    #[Test]
    public function unauthenticated_requests_are_rejected(): void
    {
        $this->getJson('/api/clinic/appointments')->assertUnauthorized();
    }

    #[Test]
    public function doctor_is_scoped_to_their_own_appointments(): void
    {
        $doctorUser = $this->staff('doctor');
        $this->doctor->update(['user_id' => $doctorUser->id]);
        $otherDoc = $this->makeDoctor($this->clinic, 'Dr Two');
        $theirs = $this->makeAppointment(['doctor_id' => $otherDoc->id]);
        $mine = $this->makeAppointment(['appointment_date' => $this->today, 'start_time' => '09:00:00']);
        Sanctum::actingAs($doctorUser);

        $this->getJson("/api/clinic/appointments/{$theirs->id}")->assertNotFound();
        $this->getJson("/api/clinic/appointments/{$theirs->id}/detail")->assertNotFound();
        $this->postJson("/api/clinic/appointments/{$theirs->id}/lifecycle", ['status' => 'checked_in'])->assertNotFound();
        $this->getJson("/api/clinic/appointments/{$mine->id}")->assertOk();

        $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'doctor_id' => $otherDoc->id,
            'patient_id' => $this->makePatient()->id,
        ]))->assertForbidden();
        $this->postJson('/api/clinic/appointments', $this->bookingPayload([
            'patient_id' => $this->makePatient()->id,
        ]))->assertCreated()->assertJsonPath('data.doctor_id', $this->doctor->id);
    }

    #[Test]
    public function assistant_is_scoped_to_assigned_doctors(): void
    {
        $assistant = $this->staff('assistant');
        $assistant->assignedDoctors()->attach($this->doctor->id, ['clinic_id' => $this->clinic->id]);
        $otherDoc = $this->makeDoctor($this->clinic, 'Dr Two');
        $theirs = $this->makeAppointment(['doctor_id' => $otherDoc->id]);
        $mine = $this->makeAppointment();
        Sanctum::actingAs($assistant);

        $this->getJson("/api/clinic/appointments/{$theirs->id}")->assertNotFound();
        $this->postJson("/api/clinic/appointments/{$theirs->id}/reschedule", [
            'appointment_date' => '2026-10-03', 'start_time' => '11:00', 'end_time' => '11:30',
        ])->assertNotFound();
        $this->getJson("/api/clinic/appointments/{$mine->id}")->assertOk();

        $ids = collect($this->getJson('/api/clinic/appointments')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertSame([$mine->id], $ids);
    }

    #[Test]
    public function assistant_without_assigned_doctors_is_forbidden(): void
    {
        Sanctum::actingAs($this->staff('assistant'));

        $this->getJson('/api/clinic/appointments')
            ->assertForbidden()
            ->assertJsonPath('message', 'No doctors assigned to assistant.');
    }

    #[Test]
    public function update_cannot_change_status_but_may_echo_it(): void
    {
        $this->actingAsStaff('clinic_admin');
        $appointment = $this->makeAppointment();

        $this->putJson("/api/clinic/appointments/{$appointment->id}", ['status' => 'completed'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['status']);
        $this->assertSame('confirmed', $appointment->fresh()->status);

        $this->putJson("/api/clinic/appointments/{$appointment->id}", ['status' => 'confirmed', 'notes' => 'ok'])
            ->assertOk()
            ->assertJsonPath('data.notes', 'ok');
    }

    #[Test]
    public function update_moving_the_slot_runs_the_conflict_check_and_logs_a_reschedule(): void
    {
        $this->actingAsStaff('clinic_admin');
        $this->makeAppointment(['start_time' => '11:00:00', 'end_time' => '11:30:00']);
        $appointment = $this->makeAppointment(['start_time' => '09:00:00', 'end_time' => '09:30:00']);

        $this->putJson("/api/clinic/appointments/{$appointment->id}", ['start_time' => '11:00', 'end_time' => '11:30'])
            ->assertStatus(422);
        $this->assertSame('09:00:00', $appointment->fresh()->start_time);

        $this->putJson("/api/clinic/appointments/{$appointment->id}", ['start_time' => '10:00', 'end_time' => '10:30'])
            ->assertOk();
        $this->assertSame('10:00', substr($appointment->fresh()->start_time, 0, 5));
        $this->assertDatabaseHas('appointment_reschedule_logs', ['old_appointment_id' => $appointment->id, 'old_start_time' => '09:00:00']);
    }

    #[Test]
    public function update_cannot_attach_another_clinics_patient(): void
    {
        $this->actingAsStaff('clinic_admin');
        $appointment = $this->makeAppointment();

        $this->putJson("/api/clinic/appointments/{$appointment->id}", ['patient_id' => $this->makePatient($this->otherClinic)->id])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['patient_id']);
    }

    #[Test]
    public function block_and_unblock_do_not_write_a_status(): void
    {
        $this->actingAsStaff('clinic_admin');
        $appointment = $this->makeAppointment();

        $this->postJson("/api/clinic/appointments/{$appointment->id}/block")->assertStatus(422);
        $this->postJson("/api/clinic/appointments/{$appointment->id}/unblock")->assertStatus(422);
        $this->assertSame('confirmed', $appointment->fresh()->status);

        $this->postJson('/api/clinic/appointments/999999/block')->assertNotFound();
    }
}
