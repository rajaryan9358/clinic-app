<?php

namespace Tests\Feature;

use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Services\AppointmentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Tests\TestCase;

class DoctorAvailabilityTest extends TestCase
{
    use RefreshDatabase;

    public function test_schedule_without_branch_produces_slots(): void
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
        $doctor = Doctor::create(['clinic_id' => $clinic->id, 'full_name' => 'Dr A', 'slot_duration_minutes' => 30]);

        $date = Carbon::now()->addDays(2)->startOfDay();
        DoctorSchedule::create([
            'clinic_id' => $clinic->id,
            'doctor_id' => $doctor->id,
            'day_of_week' => $date->dayOfWeek,
            'start_time' => '10:00:00',
            'end_time' => '11:00:00',
            'consultation_mode' => 'in_person',
            'is_active' => true,
        ]);

        $days = app(AppointmentService::class)->getDoctorAvailability(
            $clinic->id, $doctor->id, $date->toDateString(), $date->toDateString()
        );

        $this->assertCount(1, $days);
        $this->assertSame(['10:00', '10:30'], array_map(
            fn ($s) => substr($s['start_time'], 0, 5),
            $days[0]['slots']
        ));
    }
}
