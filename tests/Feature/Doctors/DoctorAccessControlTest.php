<?php

namespace Tests\Feature\Doctors;

use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\DoctorScheduleException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class DoctorAccessControlTest extends TestCase
{
    use DoctorTestHelpers;
    use RefreshDatabase;

    private Doctor $doctorA;

    private DoctorSchedule $scheduleA;

    private DoctorScheduleException $exceptionA;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDoctors();
        $this->doctorA = $this->makeDoctor(['full_name' => 'Dr A']);
        $this->scheduleA = $this->makeSchedule($this->doctorA);
        $this->exceptionA = $this->makeException($this->doctorA);
    }

    /** @return array<string, array{string, string, array<string, mixed>}> */
    public static function doctorEndpoints(): array
    {
        $schedule = ['day_of_week' => 2, 'start_time' => '09:00', 'end_time' => '10:00', 'consultation_mode' => 'in_person'];

        return [
            'show' => ['GET', '/api/clinic/doctors/{doctor}', []],
            'update' => ['PUT', '/api/clinic/doctors/{doctor}', ['full_name' => 'Hacked']],
            'status' => ['POST', '/api/clinic/doctors/{doctor}/status', ['status' => 'inactive']],
            'delete' => ['DELETE', '/api/clinic/doctors/{doctor}', []],
            'restore' => ['POST', '/api/clinic/doctors/{doctor}/restore', []],
            'profile' => ['GET', '/api/clinic/doctors/{doctor}/profile', []],
            'update profile' => ['PUT', '/api/clinic/doctors/{doctor}/profile', ['full_name' => 'Hacked']],
            'store schedule' => ['POST', '/api/clinic/doctors/{doctor}/schedules', $schedule],
            'update schedule' => ['PUT', '/api/clinic/doctors/{doctor}/schedules/{schedule}', ['day_of_week' => 5]],
            'delete schedule' => ['DELETE', '/api/clinic/doctors/{doctor}/schedules/{schedule}', []],
            'store exception' => ['POST', '/api/clinic/doctors/{doctor}/exceptions', ['exception_date' => '2026-11-04', 'type' => 'leave']],
            'delete exception' => ['DELETE', '/api/clinic/doctors/{doctor}/exceptions/{exception}', []],
        ];
    }

    private function url(string $template): string
    {
        return strtr($template, [
            '{doctor}' => $this->doctorA->id,
            '{schedule}' => $this->scheduleA->id,
            '{exception}' => $this->exceptionA->id,
        ]);
    }

    private function assertDoctorAUntouched(): void
    {
        $doctor = Doctor::withTrashed()->findOrFail($this->doctorA->id);
        $this->assertSame('Dr A', $doctor->full_name);
        $this->assertSame('active', $doctor->status);
        $this->assertFalse($doctor->trashed());
        $this->assertSame(1, (int) $this->scheduleA->fresh()->day_of_week);
        $this->assertNotNull($this->exceptionA->fresh());
        $this->assertSame(1, DoctorSchedule::count());
        $this->assertSame(1, DoctorScheduleException::count());
    }

    #[Test]
    #[DataProvider('doctorEndpoints')]
    public function other_clinic_admin_gets_404_on_every_doctor_endpoint(string $method, string $url, array $payload): void
    {
        Sanctum::actingAs($this->makeUser('clinic_admin', $this->otherClinic));

        $this->json($method, $this->url($url), $payload)->assertNotFound();

        $this->assertDoctorAUntouched();
    }

    #[Test]
    public function other_clinic_admin_does_not_see_doctor_in_listing_or_availability(): void
    {
        Sanctum::actingAs($this->makeUser('clinic_admin', $this->otherClinic));

        $this->assertSame([], $this->getJson('/api/clinic/doctors?search=Dr%20A')->assertOk()->json('data'));
        $this->getJson("/api/clinic/appointments/availability?doctor_id={$this->doctorA->id}&from_date=2026-11-02&to_date=2026-11-03")
            ->assertNotFound();
    }

    #[Test]
    public function other_clinic_doctor_cannot_touch_this_clinics_doctor(): void
    {
        [$foreignUser] = $this->makeDoctorUser($this->otherClinic);
        Sanctum::actingAs($foreignUser);

        $this->getJson("/api/clinic/doctors/{$this->doctorA->id}/profile")->assertNotFound();
        $this->putJson("/api/clinic/doctors/{$this->doctorA->id}/profile", ['bio' => 'x'])->assertNotFound();
        $this->deleteJson("/api/clinic/doctors/{$this->doctorA->id}/schedules/{$this->scheduleA->id}")->assertNotFound();

        $this->assertDoctorAUntouched();
    }

    /** @return array<string, array{string, string, array<string, mixed>}> */
    public static function receptionistForbidden(): array
    {
        $schedule = ['day_of_week' => 2, 'start_time' => '09:00', 'end_time' => '10:00', 'consultation_mode' => 'in_person'];

        return [
            'create doctor' => ['POST', '/api/clinic/doctors', ['full_name' => 'Dr R']],
            'update doctor' => ['PUT', '/api/clinic/doctors/{doctor}', ['full_name' => 'Hacked']],
            'delete doctor' => ['DELETE', '/api/clinic/doctors/{doctor}', []],
            'status' => ['POST', '/api/clinic/doctors/{doctor}/status', ['status' => 'inactive']],
            'update profile' => ['PUT', '/api/clinic/doctors/{doctor}/profile', ['full_name' => 'Hacked']],
            'store schedule' => ['POST', '/api/clinic/doctors/{doctor}/schedules', $schedule],
            'update schedule' => ['PUT', '/api/clinic/doctors/{doctor}/schedules/{schedule}', ['day_of_week' => 5]],
            'delete schedule' => ['DELETE', '/api/clinic/doctors/{doctor}/schedules/{schedule}', []],
            'store exception' => ['POST', '/api/clinic/doctors/{doctor}/exceptions', ['exception_date' => '2026-11-04', 'type' => 'leave']],
            'delete exception' => ['DELETE', '/api/clinic/doctors/{doctor}/exceptions/{exception}', []],
        ];
    }

    #[Test]
    #[DataProvider('receptionistForbidden')]
    public function receptionist_without_doctor_write_permissions_gets_403(string $method, string $url, array $payload): void
    {
        Sanctum::actingAs($this->makeUser('receptionist'));

        $this->json($method, $this->url($url), $payload)->assertForbidden()->assertJsonPath('success', false);

        $this->assertDoctorAUntouched();
        $this->assertSame(1, Doctor::count());
    }

    #[Test]
    public function receptionist_can_view_doctors_and_profiles(): void
    {
        Sanctum::actingAs($this->makeUser('receptionist'));

        $this->getJson('/api/clinic/doctors')->assertOk()->assertJsonPath('meta.total', 1);
        $this->getJson("/api/clinic/doctors/{$this->doctorA->id}")->assertOk();
        $this->getJson("/api/clinic/doctors/{$this->doctorA->id}/profile")->assertOk();
    }

    #[Test]
    public function role_without_doctors_view_cannot_list_or_view_profiles(): void
    {
        $this->makeRole('no_doctors', 'staff', ['patients.view']);
        Sanctum::actingAs($this->makeUser('no_doctors'));

        $this->getJson('/api/clinic/doctors')->assertForbidden();
        $this->getJson("/api/clinic/doctors/{$this->doctorA->id}/profile")->assertForbidden();
    }

    #[Test]
    public function schedule_permissions_are_checked_per_action(): void
    {
        // Can create schedules/exceptions, but neither edit nor delete them.
        $this->makeRole('scheduler', 'staff', ['doctors.view', 'doctor_schedules.view', 'doctor_schedules.create']);
        Sanctum::actingAs($this->makeUser('scheduler'));
        $base = "/api/clinic/doctors/{$this->doctorA->id}";

        $this->postJson("{$base}/schedules", ['day_of_week' => 2, 'start_time' => '09:00', 'end_time' => '10:00', 'consultation_mode' => 'video'])->assertCreated();
        $this->postJson("{$base}/exceptions", ['exception_date' => '2026-11-05', 'type' => 'leave'])->assertCreated();
        $this->putJson("{$base}/schedules/{$this->scheduleA->id}", ['day_of_week' => 5])->assertForbidden();
        $this->deleteJson("{$base}/schedules/{$this->scheduleA->id}")->assertForbidden();
        $this->deleteJson("{$base}/exceptions/{$this->exceptionA->id}")->assertForbidden();
        // Profile editing needs doctors.edit.
        $this->putJson("{$base}/profile", ['bio' => 'x'])->assertForbidden();

        $this->assertSame(2, DoctorSchedule::count());
        $this->assertSame(2, DoctorScheduleException::count());
    }

    #[Test]
    public function doctor_cannot_create_or_delete_doctors(): void
    {
        [$user, $own] = $this->makeDoctorUser();
        Sanctum::actingAs($user);

        $this->postJson('/api/clinic/doctors', ['full_name' => 'Dr Sneaky'])->assertForbidden();
        $this->deleteJson("/api/clinic/doctors/{$own->id}")->assertForbidden();
        $this->assertNotSoftDeleted('doctors', ['id' => $own->id]);
    }

    #[Test]
    public function doctor_user_without_linked_doctor_record_is_refused(): void
    {
        Sanctum::actingAs($this->makeUser('doctor'));

        $this->getJson('/api/clinic/doctors')->assertForbidden();
        $this->getJson("/api/clinic/doctors/{$this->doctorA->id}/profile")->assertForbidden();
    }
}
