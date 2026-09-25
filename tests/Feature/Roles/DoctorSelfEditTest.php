<?php

namespace Tests\Feature\Roles;

use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DoctorSelfEditTest extends TestCase
{
    use RefreshDatabase;

    private const MESSAGE = 'Doctors edit their details from their profile.';

    private Clinic $clinic;
    private User $doctorUser;
    private Doctor $doctor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
        $this->doctorUser = $this->user('doctor');
        $this->doctor = Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr Me', 'user_id' => $this->doctorUser->id, 'status' => 'active']);
    }

    private function user(string $role): User
    {
        $u = User::create(['clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => $role,
            'email' => Str::random(6).'@x.test', 'password' => 'x', 'role' => $role, 'status' => 'active']);
        $u->syncRoles([$role]);

        return $u;
    }

    public function test_doctor_cannot_use_generic_doctor_write_routes(): void
    {
        Sanctum::actingAs($this->doctorUser);
        $id = $this->doctor->id;

        $this->putJson("/api/clinic/doctors/{$id}", ['status' => 'inactive'])
            ->assertStatus(403)->assertJson(['success' => false, 'message' => self::MESSAGE]);
        $this->assertSame('active', $this->doctor->fresh()->status);

        foreach (['block', 'unblock', 'restore'] as $action) {
            $this->postJson("/api/clinic/doctors/{$id}/{$action}")
                ->assertStatus(403)->assertJson(['message' => self::MESSAGE]);
        }
        $this->postJson("/api/clinic/doctors/{$id}/status", ['status' => 'inactive'])
            ->assertStatus(403)->assertJson(['message' => self::MESSAGE]);
        $this->assertSame('active', $this->doctor->fresh()->status);
    }

    public function test_doctor_can_still_edit_own_profile_fields(): void
    {
        Sanctum::actingAs($this->doctorUser);
        $this->putJson("/api/clinic/doctors/{$this->doctor->id}/profile", ['bio' => 'Hello'])->assertOk();
        $this->assertSame('Hello', $this->doctor->fresh()->bio);
    }

    public function test_clinic_admin_can_use_generic_doctor_update(): void
    {
        Sanctum::actingAs($this->user('clinic_admin'));
        $this->assertNotSame(403, $this->putJson("/api/clinic/doctors/{$this->doctor->id}", ['bio' => 'Admin'])->status());
    }
}
