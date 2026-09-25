<?php

namespace Tests\Feature;

use App\Models\ClinicSetting;
use App\Models\User;
use App\Services\ClinicCreationService;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClinicCreationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    public function test_creates_clinic_with_location_settings_and_admin_without_branch(): void
    {
        $clinic = app(ClinicCreationService::class)->create([
            'name' => 'Sunrise Clinic',
            'slug' => 'sunrise',
            'address_line_1' => '12 MG Road',
            'city' => 'Pune',
            'pincode' => '411001',
            'phone' => '9800000000',
            'settings' => ['walkin_enabled' => false, 'max_advance_booking_days' => 14],
            'clinic_admin' => [
                'full_name' => 'Asha Rao',
                'email' => 'asha@sunrise.test',
                'password' => 'Secret@123',
            ],
        ]);

        $this->assertSame('Pune', $clinic->fresh()->city);
        $this->assertSame('12 MG Road', $clinic->fresh()->address_line_1);

        $settings = ClinicSetting::where('clinic_id', $clinic->id)->firstOrFail();
        $this->assertFalse($settings->walkin_enabled);
        $this->assertSame(14, (int) $settings->max_advance_booking_days);
        $this->assertSame(30, (int) $settings->min_booking_notice_minutes);

        $admin = User::where('email', 'asha@sunrise.test')->firstOrFail();
        $this->assertSame($clinic->id, $admin->clinic_id);
        $this->assertSame('clinic_admin', $admin->role);
    }

    public function test_branch_manager_role_no_longer_exists(): void
    {
        $this->assertNull(\App\Enums\UserRole::tryFrom('branch_manager'));
        $this->assertDatabaseMissing('roles', ['name' => 'branch_manager']);
    }

    public function test_super_admin_create_clinic_with_explicit_null_setting_returns_422(): void
    {
        $superAdmin = User::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(), 'full_name' => 'Super',
            'email' => 'super@x.test', 'password' => 'x', 'role' => 'super_admin', 'status' => 'active',
        ]);
        $superAdmin->assignRole('super_admin');
        \Laravel\Sanctum\Sanctum::actingAs($superAdmin);

        $response = $this->postJson('/api/super-admin/clinics', [
            'name' => 'Null Settings Clinic',
            'slug' => 'null-settings-clinic',
            'settings' => ['max_advance_booking_days' => null],
        ]);

        $response->assertStatus(422);
    }
}
