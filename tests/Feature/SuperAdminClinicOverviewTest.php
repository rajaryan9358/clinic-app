<?php

namespace Tests\Feature;

use App\Models\Doctor;
use App\Models\User;
use App\Services\ClinicCreationService;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SuperAdminClinicOverviewTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    private function user(string $role, ?int $clinicId = null): User
    {
        $user = User::create([
            'clinic_id' => $clinicId,
            'uuid' => (string) Str::uuid(),
            'full_name' => ucfirst($role),
            'email' => $role.Str::random(4).'@x.test',
            'password' => 'x',
            'role' => $role,
            'status' => 'active',
        ]);
        $user->assignRole($role);

        return $user;
    }

    private function onboardClinic()
    {
        return app(ClinicCreationService::class)->create([
            'name' => 'Sunrise Clinic',
            'slug' => 'sunrise',
            'owner_name' => 'Asha Rao',
            'city' => 'Pune',
            'address_line_1' => '12 MG Road',
            'settings' => ['walkin_enabled' => false, 'max_advance_booking_days' => 14],
            'clinic_admin' => ['full_name' => 'Asha Admin', 'email' => 'asha@sunrise.test', 'phone' => '9800000000', 'password' => 'Secret@123'],
        ]);
    }

    public function test_overview_returns_clinic_settings_admins_and_counts(): void
    {
        $clinic = $this->onboardClinic();
        Doctor::create(['clinic_id' => $clinic->id, 'full_name' => 'Dr A']);
        $this->user('receptionist', $clinic->id);
        Sanctum::actingAs($this->user('super_admin'));

        $res = $this->getJson("/api/super-admin/clinics/{$clinic->id}/overview")->assertOk();

        $res->assertJsonPath('data.clinic.name', 'Sunrise Clinic')
            ->assertJsonPath('data.clinic.city', 'Pune')
            ->assertJsonPath('data.clinic.address_line_1', '12 MG Road')
            ->assertJsonPath('data.settings.walkin_enabled', false)
            ->assertJsonPath('data.settings.max_advance_booking_days', 14)
            ->assertJsonPath('data.admins.0.email', 'asha@sunrise.test')
            ->assertJsonPath('data.counts.doctors', 1)
            ->assertJsonPath('data.counts.staff', 2)
            ->assertJsonPath('data.counts.services', 0);

        $this->assertArrayNotHasKey('password', $res->json('data.admins.0'));
    }

    public function test_overview_is_super_admin_only(): void
    {
        $clinic = $this->onboardClinic();
        Sanctum::actingAs(User::where('email', 'asha@sunrise.test')->firstOrFail());

        $this->getJson("/api/super-admin/clinics/{$clinic->id}/overview")->assertForbidden();
    }

    public function test_overview_for_missing_clinic_is_404(): void
    {
        Sanctum::actingAs($this->user('super_admin'));

        $this->getJson('/api/super-admin/clinics/999999/overview')->assertNotFound();
    }
}
