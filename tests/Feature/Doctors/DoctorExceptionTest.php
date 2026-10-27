<?php

namespace Tests\Feature\Doctors;

use App\Models\Doctor;
use App\Models\DoctorScheduleException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class DoctorExceptionTest extends TestCase
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
        $this->makeSchedule($this->doctor, ['day_of_week' => self::DOW, 'start_time' => '09:00:00', 'end_time' => '11:00:00']);
        Sanctum::actingAs($this->makeUser('clinic_admin'));
    }

    /** Slot start times per date across [from, to]. */
    private function slotsByDate(string $from, string $to): array
    {
        $days = $this->getJson("/api/clinic/appointments/availability?doctor_id={$this->doctor->id}&from_date={$from}&to_date={$to}")
            ->assertOk()->json('data.days');

        return collect($days)->mapWithKeys(fn ($d) => [$d['date'] => array_map(fn ($s) => $s['start_time'], $d['slots'])])->all();
    }

    /**
     * Slots for one date, queried over a surrounding 3-day window. A single-day
     * query misses exceptions on SQLite (see the incomplete test below).
     */
    private function slotsOn(string $date): array
    {
        $from = date('Y-m-d', strtotime($date.' -1 day'));
        $to = date('Y-m-d', strtotime($date.' +1 day'));

        return $this->slotsByDate($from, $to)[$date];
    }

    private function addException(array $payload)
    {
        return $this->postJson("/api/clinic/doctors/{$this->doctor->id}/exceptions", $payload);
    }

    #[Test]
    public function store_creates_exception_for_own_clinic(): void
    {
        $response = $this->addException(['exception_date' => self::DATE, 'type' => 'leave', 'reason' => 'Conference'])
            ->assertCreated()->assertJsonPath('data.type', 'leave');

        $exception = DoctorScheduleException::findOrFail($response->json('data.id'));
        $this->assertSame($this->clinic->id, (int) $exception->clinic_id);
        $this->assertSame(self::DATE, $exception->exception_date->toDateString());
    }

    #[Test]
    public function store_validates_input(): void
    {
        $this->addException(['exception_date' => 'not-a-date', 'type' => 'holiday', 'start_time' => '9am'])
            ->assertUnprocessable()->assertJsonValidationErrors(['exception_date', 'type', 'start_time']);
        $this->addException([])->assertUnprocessable()->assertJsonValidationErrors(['exception_date', 'type']);
    }

    #[Test]
    public function baseline_schedule_produces_slots(): void
    {
        $this->assertSame(['09:00', '09:30', '10:00', '10:30'], $this->slotsOn(self::DATE));
    }

    #[Test]
    public function leave_removes_all_slots_for_that_date_only(): void
    {
        $this->addException(['exception_date' => self::DATE, 'type' => 'leave'])->assertCreated();

        $slots = $this->slotsByDate(self::DATE, '2026-11-11');
        $this->assertSame([], $slots[self::DATE]);
        $this->assertSame(['09:00', '09:30', '10:00', '10:30'], $slots['2026-11-11']);
    }

    #[Test]
    public function full_day_block_removes_all_slots(): void
    {
        $this->addException(['exception_date' => self::DATE, 'type' => 'blocked'])->assertCreated();

        $this->assertSame([], $this->slotsOn(self::DATE));
    }

    #[Test]
    public function partial_block_removes_only_the_blocked_window(): void
    {
        $this->addException(['exception_date' => self::DATE, 'type' => 'blocked', 'start_time' => '09:30', 'end_time' => '10:30'])->assertCreated();

        $this->assertSame(['09:00', '10:30'], $this->slotsOn(self::DATE));
    }

    #[Test]
    public function special_hours_replace_the_weekly_schedule_even_on_an_unscheduled_day(): void
    {
        $this->addException(['exception_date' => self::DATE, 'type' => 'special_hours', 'start_time' => '15:00', 'end_time' => '16:00'])->assertCreated();
        $this->addException(['exception_date' => '2026-11-05', 'type' => 'special_hours', 'start_time' => '08:00', 'end_time' => '08:30'])->assertCreated();

        $this->assertSame(['15:00', '15:30'], $this->slotsOn(self::DATE));
        $this->assertSame(['08:00'], $this->slotsOn('2026-11-05'));
    }

    #[Test]
    public function store_rejects_timed_exception_with_end_before_start(): void
    {
        $this->addException(['exception_date' => self::DATE, 'type' => 'blocked', 'start_time' => '11:00', 'end_time' => '09:00'])
            ->assertUnprocessable()->assertJsonValidationErrors(['end_time']);
    }

    #[Test]
    public function special_hours_require_both_times(): void
    {
        $this->addException(['exception_date' => self::DATE, 'type' => 'special_hours'])
            ->assertUnprocessable()->assertJsonValidationErrors(['start_time', 'end_time']);
        $this->addException(['exception_date' => self::DATE, 'type' => 'blocked', 'start_time' => '09:30'])
            ->assertUnprocessable()->assertJsonValidationErrors(['end_time']);
        $this->assertSame(0, DoctorScheduleException::count());
    }

    #[Test]
    public function single_day_availability_query_honours_exceptions(): void
    {

        $this->addException(['exception_date' => self::DATE, 'type' => 'leave'])->assertCreated();

        $this->assertSame([], $this->slotsByDate(self::DATE, self::DATE)[self::DATE]);
    }

    #[Test]
    public function destroy_removes_exception_and_restores_slots(): void
    {
        $id = $this->addException(['exception_date' => self::DATE, 'type' => 'leave'])->json('data.id');
        $this->assertSame([], $this->slotsOn(self::DATE));

        $this->deleteJson("/api/clinic/doctors/{$this->doctor->id}/exceptions/{$id}")->assertOk();

        $this->assertDatabaseMissing('doctor_schedule_exceptions', ['id' => $id]);
        $this->assertCount(4, $this->slotsOn(self::DATE));
    }

    #[Test]
    public function exception_of_another_doctor_is_not_found_and_does_not_affect_this_doctor(): void
    {
        $other = $this->makeDoctor();
        $exception = $this->makeException($other, ['exception_date' => self::DATE, 'type' => 'leave']);

        $this->deleteJson("/api/clinic/doctors/{$this->doctor->id}/exceptions/{$exception->id}")->assertNotFound();
        $this->assertDatabaseHas('doctor_schedule_exceptions', ['id' => $exception->id]);
        $this->assertCount(4, $this->slotsOn(self::DATE));
    }
}
