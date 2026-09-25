<?php

namespace Tests\Feature\Billing;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\ClinicSubscription;
use App\Models\Doctor;
use App\Models\Plan;
use App\Services\Billing\PlanLimits;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class PlanLimitsTest extends TestCase
{
    use RefreshDatabase;

    private Clinic $clinic;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
    }

    private function onPlan(array $limits): void
    {
        $plan = Plan::create(array_merge(['name' => 'Starter', 'monthly_price' => 99900], $limits));
        ClinicSubscription::create(['clinic_id' => $this->clinic->id, 'plan_id' => $plan->id, 'billing_cycle' => 'monthly', 'status' => 'active']);
    }

    public function test_doctor_limit_blocks_at_limit_with_message(): void
    {
        $this->onPlan(['max_doctors' => 1]);
        $limits = app(PlanLimits::class);
        $limits->assertCanAdd($this->clinic->id, 'doctors');          // 0 < 1 ok
        Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr A']);

        try {
            $limits->assertCanAdd($this->clinic->id, 'doctors');
            $this->fail('Expected limit');
        } catch (ValidationException $e) {
            $this->assertSame('Your Starter plan allows 1 doctors. Upgrade your plan to add more.', $e->errors()['plan'][0]);
        }
    }

    public function test_null_limit_and_no_subscription_are_unlimited(): void
    {
        app(PlanLimits::class)->assertCanAdd($this->clinic->id, 'doctors'); // no subscription
        $this->onPlan(['max_doctors' => null]);
        Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr A']);
        app(PlanLimits::class)->assertCanAdd($this->clinic->id, 'doctors');
        $this->assertTrue(true);
    }

    public function test_soft_deleted_doctor_and_cancelled_appointments_do_not_count(): void
    {
        $this->onPlan(['max_doctors' => 1, 'max_appointments_per_month' => 1]);
        Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Gone'])->delete();
        app(PlanLimits::class)->assertCanAdd($this->clinic->id, 'doctors');

        $this->assertSame(0, app(PlanLimits::class)->count($this->clinic->id, 'appointments'));
    }

    public function test_services_enforce_limits_through_api_calls(): void
    {
        $this->onPlan(['max_staff' => 1]);
        $service = app(\App\Services\UserManagementService::class);
        $service->create(['clinic_id' => $this->clinic->id, 'full_name' => 'A', 'email' => 'a@x.test', 'password' => 'Secret@123', 'role' => 'receptionist']);
        $this->expectException(ValidationException::class);
        $service->create(['clinic_id' => $this->clinic->id, 'full_name' => 'B', 'email' => 'b@x.test', 'password' => 'Secret@123', 'role' => 'receptionist']);
    }

    public function test_doctor_service_enforces_limit_through_create(): void
    {
        $this->onPlan(['max_doctors' => 1]);
        $service = app(\App\Services\DoctorManagementService::class);
        $service->create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr A']);
        $this->expectException(ValidationException::class);
        $service->create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr B']);
    }

    public function test_appointment_service_enforces_monthly_limit_through_create(): void
    {
        $this->onPlan(['max_appointments_per_month' => 1]);
        $doctor = Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr A', 'slot_duration_minutes' => 30]);
        $service = app(\App\Services\AppointmentService::class);

        $data = [
            'clinic_id' => $this->clinic->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => now()->addDay()->toDateString(),
            'start_time' => '10:00',
            'end_time' => '10:30',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'patient' => [
                'phone' => '9000000001',
                'first_name' => 'New',
                'last_name' => 'Patient',
            ],
        ];
        $service->create($data);

        $this->assertSame(1, app(PlanLimits::class)->count($this->clinic->id, 'appointments'));

        $data2 = $data;
        $data2['patient'] = [
            'phone' => '9000000002',
            'first_name' => 'Another',
            'last_name' => 'Patient',
        ];

        $this->expectException(ValidationException::class);
        $service->create($data2);
    }
}
