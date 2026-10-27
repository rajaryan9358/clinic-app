<?php

namespace Tests\Feature\Doctors;

use App\Models\Service;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class DoctorProfileTest extends TestCase
{
    use DoctorTestHelpers;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDoctors();
    }

    private function service(string $name, $clinic = null): Service
    {
        return Service::create(['clinic_id' => ($clinic ?? $this->clinic)->id, 'name' => $name, 'status' => 'active']);
    }

    #[Test]
    public function profile_returns_doctor_with_services_schedules_exceptions_and_setup_flags(): void
    {
        Sanctum::actingAs($this->makeUser('clinic_admin'));
        $doctor = $this->makeDoctor(['full_name' => 'Dr Prof']);
        $this->makeSchedule($doctor);
        $this->makeException($doctor);

        $this->getJson("/api/clinic/doctors/{$doctor->id}/profile")
            ->assertOk()
            ->assertJsonPath('data.doctor.full_name', 'Dr Prof')
            ->assertJsonCount(1, 'data.doctor.schedules')
            ->assertJsonCount(1, 'data.doctor.exceptions')
            ->assertJsonPath('data.service_ids', [])
            ->assertJsonPath('data.setup.has_services', false)
            ->assertJsonPath('data.setup.has_schedules', true);
    }

    #[Test]
    public function admin_updates_profile_fields_status_and_service_mapping(): void
    {
        Sanctum::actingAs($this->makeUser('clinic_admin'));
        $doctor = $this->makeDoctor();
        $s1 = $this->service('Consult');
        $s2 = $this->service('Review');

        $this->putJson("/api/clinic/doctors/{$doctor->id}/profile", [
            'full_name' => 'Dr Updated',
            'bio' => 'Bio',
            'status' => 'inactive',
            'service_ids' => [$s1->id, $s2->id, $s1->id],
        ])->assertOk()->assertJsonPath('data.doctor.full_name', 'Dr Updated');

        $doctor->refresh();
        $this->assertSame('inactive', $doctor->status);
        $this->assertSame('Bio', $doctor->bio);
        $this->assertEqualsCanonicalizing([$s1->id, $s2->id], $doctor->services->pluck('id')->all());
        $this->assertDatabaseHas('doctor_services', ['doctor_id' => $doctor->id, 'service_id' => $s1->id, 'clinic_id' => $this->clinic->id]);

        // An empty list clears the mapping.
        $this->putJson("/api/clinic/doctors/{$doctor->id}/profile", ['service_ids' => []])->assertOk();
        $this->assertCount(0, $doctor->fresh()->services);
    }

    #[Test]
    public function admin_cannot_map_another_clinics_service(): void
    {
        Sanctum::actingAs($this->makeUser('clinic_admin'));
        $doctor = $this->makeDoctor();
        $foreign = $this->service('Foreign', $this->otherClinic);

        $this->putJson("/api/clinic/doctors/{$doctor->id}/profile", ['service_ids' => [$foreign->id]])
            ->assertUnprocessable()->assertJsonValidationErrors(['service_ids.0']);
        $this->assertCount(0, $doctor->fresh()->services);
    }

    #[Test]
    public function profile_update_validates_input(): void
    {
        Sanctum::actingAs($this->makeUser('clinic_admin'));
        $doctor = $this->makeDoctor();

        $this->putJson("/api/clinic/doctors/{$doctor->id}/profile", [
            'email' => 'nope', 'slot_duration_minutes' => 1, 'buffer_time_minutes' => 500, 'status' => 'blocked',
        ])->assertUnprocessable()->assertJsonValidationErrors(['email', 'slot_duration_minutes', 'buffer_time_minutes', 'status']);
    }

    #[Test]
    public function doctor_can_view_and_edit_only_allowed_fields_of_own_profile(): void
    {
        [$user, $doctor] = $this->makeDoctorUser();
        $service = $this->service('Consult');
        Sanctum::actingAs($user);

        $this->getJson("/api/clinic/doctors/{$doctor->id}/profile")->assertOk();

        $this->putJson("/api/clinic/doctors/{$doctor->id}/profile", [
            'bio' => 'Mine',
            'consultation_fee' => 750,
            'full_name' => 'Dr Hijack',
            'specialization' => 'Neuro',
            'status' => 'inactive',
            'service_ids' => [$service->id],
        ])->assertOk();

        $doctor->refresh();
        $this->assertSame('Mine', $doctor->bio);
        $this->assertSame('750.00', $doctor->consultation_fee);
        $this->assertSame('Dr Self', $doctor->full_name);
        $this->assertNull($doctor->specialization);
        $this->assertSame('active', $doctor->status);
        $this->assertCount(0, $doctor->services);
    }

    #[Test]
    public function doctor_cannot_view_or_edit_another_doctors_profile(): void
    {
        [$user] = $this->makeDoctorUser();
        $colleague = $this->makeDoctor(['full_name' => 'Dr Colleague']);
        Sanctum::actingAs($user);

        $this->getJson("/api/clinic/doctors/{$colleague->id}/profile")->assertNotFound();
        $this->putJson("/api/clinic/doctors/{$colleague->id}/profile", ['bio' => 'x'])->assertNotFound();
        $this->assertNull($colleague->fresh()->bio);
    }

    #[Test]
    public function doctor_listing_shows_only_own_record(): void
    {
        [$user, $doctor] = $this->makeDoctorUser();
        $this->makeDoctor();
        Sanctum::actingAs($user);

        $ids = collect($this->getJson('/api/clinic/doctors')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertSame([$doctor->id], $ids);
    }

    #[Test]
    public function non_admin_staff_with_doctors_edit_cannot_change_status_or_services(): void
    {
        $this->makeRole('doc_manager', 'staff', ['doctors.view', 'doctors.edit']);
        Sanctum::actingAs($this->makeUser('doc_manager'));
        $doctor = $this->makeDoctor();
        $service = $this->service('Consult');

        $this->putJson("/api/clinic/doctors/{$doctor->id}/profile", [
            'full_name' => 'Dr Staff Edit', 'status' => 'inactive', 'service_ids' => [$service->id],
        ])->assertOk();

        $doctor->refresh();
        $this->assertSame('Dr Staff Edit', $doctor->full_name);
        $this->assertSame('active', $doctor->status);
        $this->assertCount(0, $doctor->services);
    }
}
