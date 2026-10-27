<?php

namespace Tests\Feature\Doctors;

use App\Models\Doctor;
use App\Models\DoctorSchedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class DoctorScheduleTest extends TestCase
{
    use DoctorTestHelpers;
    use RefreshDatabase;

    private const DATE = '2026-11-04'; // a Wednesday

    private const DOW = 3;

    private Doctor $doctor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDoctors();
        $this->doctor = $this->makeDoctor(['slot_duration_minutes' => 30]);
        Sanctum::actingAs($this->makeUser('clinic_admin'));
    }

    private function slotStarts(?string $date = null): array
    {
        $date ??= self::DATE;
        $days = $this->getJson("/api/clinic/appointments/availability?doctor_id={$this->doctor->id}&from_date={$date}&to_date={$date}")
            ->assertOk()->json('data.days');

        return array_map(fn ($s) => $s['start_time'], $days[0]['slots']);
    }

    private function validSchedule(array $overrides = []): array
    {
        return array_merge([
            'day_of_week' => self::DOW, 'start_time' => '09:00', 'end_time' => '10:00', 'consultation_mode' => 'in_person',
        ], $overrides);
    }

    #[Test]
    public function store_creates_schedule_with_defaults_and_drives_availability(): void
    {
        $response = $this->postJson("/api/clinic/doctors/{$this->doctor->id}/schedules", $this->validSchedule([
            'max_patients' => 8, 'slot_duration_minutes' => 20,
        ]))->assertCreated();

        $schedule = DoctorSchedule::findOrFail($response->json('data.id'));
        $this->assertSame($this->clinic->id, (int) $schedule->clinic_id);
        $this->assertTrue($schedule->is_active);
        $this->assertSame(8, (int) $schedule->max_patients);

        $this->assertSame(['09:00', '09:20', '09:40'], $this->slotStarts());
    }

    /** @return array<string, array{array<string, mixed>, string}> */
    public static function invalidSchedules(): array
    {
        return [
            'day too high' => [['day_of_week' => 7], 'day_of_week'],
            'day negative' => [['day_of_week' => -1], 'day_of_week'],
            'day missing' => [['day_of_week' => null], 'day_of_week'],
            'bad start format' => [['start_time' => '9am'], 'start_time'],
            'end missing' => [['end_time' => null], 'end_time'],
            'bad mode' => [['consultation_mode' => 'phone'], 'consultation_mode'],
            'max patients zero' => [['max_patients' => 0], 'max_patients'],
            'slot too long' => [['slot_duration_minutes' => 241], 'slot_duration_minutes'],
        ];
    }

    #[Test]
    #[DataProvider('invalidSchedules')]
    public function store_validates_input(array $overrides, string $field): void
    {
        $this->postJson("/api/clinic/doctors/{$this->doctor->id}/schedules", $this->validSchedule($overrides))
            ->assertUnprocessable()->assertJsonValidationErrors([$field]);
        $this->assertSame(0, DoctorSchedule::count());
    }

    #[Test]
    public function store_rejects_end_time_before_start_time(): void
    {
        $this->postJson("/api/clinic/doctors/{$this->doctor->id}/schedules", $this->validSchedule([
            'start_time' => '12:00', 'end_time' => '09:00',
        ]))->assertUnprocessable()->assertJsonValidationErrors(['end_time']);
    }

    #[Test]
    public function overlapping_schedules_on_same_day_are_currently_accepted(): void
    {
        // Pinned current behaviour: there is no overlap check. Unsure if intended.
        $this->postJson("/api/clinic/doctors/{$this->doctor->id}/schedules", $this->validSchedule())->assertCreated();
        $this->postJson("/api/clinic/doctors/{$this->doctor->id}/schedules", $this->validSchedule([
            'start_time' => '09:30', 'end_time' => '10:30',
        ]))->assertCreated();

        $this->assertSame(2, DoctorSchedule::where('doctor_id', $this->doctor->id)->count());
    }

    #[Test]
    public function update_changes_schedule_fields(): void
    {
        $schedule = $this->makeSchedule($this->doctor, ['day_of_week' => self::DOW]);

        $this->putJson("/api/clinic/doctors/{$this->doctor->id}/schedules/{$schedule->id}", [
            'start_time' => '14:00', 'end_time' => '15:00', 'consultation_mode' => 'video',
        ])->assertOk()->assertJsonPath('data.consultation_mode', 'video');

        $this->assertSame(['14:00', '14:30'], $this->slotStarts());
    }

    #[Test]
    public function update_validates_input(): void
    {
        $schedule = $this->makeSchedule($this->doctor);

        $this->putJson("/api/clinic/doctors/{$this->doctor->id}/schedules/{$schedule->id}", [
            'day_of_week' => 9, 'consultation_mode' => 'phone',
        ])->assertUnprocessable()->assertJsonValidationErrors(['day_of_week', 'consultation_mode']);
    }

    #[Test]
    public function update_rejects_end_time_before_existing_start_time(): void
    {
        $schedule = $this->makeSchedule($this->doctor, ['start_time' => '09:00:00', 'end_time' => '11:00:00']);

        $this->putJson("/api/clinic/doctors/{$this->doctor->id}/schedules/{$schedule->id}", ['end_time' => '08:30'])
            ->assertUnprocessable()->assertJsonValidationErrors(['end_time']);
        $this->assertSame('11:00', substr((string) $schedule->fresh()->end_time, 0, 5));
    }

    #[Test]
    public function deactivated_schedule_yields_no_slots(): void
    {
        $schedule = $this->makeSchedule($this->doctor, ['day_of_week' => self::DOW]);
        $this->assertNotEmpty($this->slotStarts());

        $this->putJson("/api/clinic/doctors/{$this->doctor->id}/schedules/{$schedule->id}", ['is_active' => false])->assertOk();

        $this->assertSame([], $this->slotStarts());
    }

    #[Test]
    public function destroy_removes_schedule(): void
    {
        $schedule = $this->makeSchedule($this->doctor, ['day_of_week' => self::DOW]);

        $this->deleteJson("/api/clinic/doctors/{$this->doctor->id}/schedules/{$schedule->id}")->assertOk();

        $this->assertDatabaseMissing('doctor_schedules', ['id' => $schedule->id]);
        $this->assertSame([], $this->slotStarts());
    }

    #[Test]
    public function schedule_belonging_to_another_doctor_in_same_clinic_is_not_found(): void
    {
        $other = $this->makeDoctor();
        $schedule = $this->makeSchedule($other);

        $this->putJson("/api/clinic/doctors/{$this->doctor->id}/schedules/{$schedule->id}", ['day_of_week' => 5])->assertNotFound();
        $this->deleteJson("/api/clinic/doctors/{$this->doctor->id}/schedules/{$schedule->id}")->assertNotFound();

        $this->assertSame(1, (int) $schedule->fresh()->day_of_week);
    }

    #[Test]
    public function doctor_can_manage_own_schedules_but_not_a_colleagues(): void
    {
        [$user, $own] = $this->makeDoctorUser();
        Sanctum::actingAs($user);

        $id = $this->postJson("/api/clinic/doctors/{$own->id}/schedules", $this->validSchedule())->assertCreated()->json('data.id');
        $this->putJson("/api/clinic/doctors/{$own->id}/schedules/{$id}", ['end_time' => '11:00'])->assertOk();
        $this->deleteJson("/api/clinic/doctors/{$own->id}/schedules/{$id}")->assertOk();

        $colleagueSchedule = $this->makeSchedule($this->doctor);
        $this->postJson("/api/clinic/doctors/{$this->doctor->id}/schedules", $this->validSchedule())->assertNotFound();
        $this->deleteJson("/api/clinic/doctors/{$this->doctor->id}/schedules/{$colleagueSchedule->id}")->assertNotFound();
        $this->assertSame(1, DoctorSchedule::where('doctor_id', $this->doctor->id)->count());
    }
}
