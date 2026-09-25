<?php

namespace Tests\Feature;

use App\Models\Clinic;
use App\Models\ClinicSetting;
use App\Models\Doctor;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ClinicSettingsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    private function clinic(string $slug): Clinic
    {
        return Clinic::create(['uuid' => (string) Str::uuid(), 'name' => $slug, 'slug' => $slug, 'status' => 'active']);
    }

    private function user(Clinic $clinic, string $role): User
    {
        $user = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => ucfirst($role),
            'email' => $role.$clinic->id.'@x.test', 'password' => 'x', 'role' => $role, 'status' => 'active',
        ]);
        $user->assignRole($role);

        return $user;
    }

    // F1: validation on PUT settings/clinic/{id}

    public function test_clinic_admin_put_with_empty_max_advance_booking_days_returns_422(): void
    {
        $clinic = $this->clinic('a');
        $setting = ClinicSetting::create(['clinic_id' => $clinic->id]);
        Sanctum::actingAs($this->user($clinic, 'clinic_admin'));

        $this->putJson("/api/clinic/settings/clinic/{$setting->id}", [
            'max_advance_booking_days' => '',
        ])->assertStatus(422);
    }

    public function test_clinic_admin_put_with_negative_max_advance_booking_days_returns_422(): void
    {
        $clinic = $this->clinic('b');
        $setting = ClinicSetting::create(['clinic_id' => $clinic->id]);
        Sanctum::actingAs($this->user($clinic, 'clinic_admin'));

        $this->putJson("/api/clinic/settings/clinic/{$setting->id}", [
            'max_advance_booking_days' => -5,
        ])->assertStatus(422);
    }

    public function test_clinic_admin_valid_put_saves_settings(): void
    {
        $clinic = $this->clinic('c');
        $setting = ClinicSetting::create(['clinic_id' => $clinic->id]);
        Sanctum::actingAs($this->user($clinic, 'clinic_admin'));

        $this->putJson("/api/clinic/settings/clinic/{$setting->id}", [
            'max_advance_booking_days' => 45,
            'walkin_enabled' => false,
        ])->assertOk();

        $this->assertSame(45, (int) $setting->fresh()->max_advance_booking_days);
        $this->assertFalse($setting->fresh()->walkin_enabled);
    }

    // F2: only clinic_admin can write clinic settings

    public function test_receptionist_cannot_create_clinic_settings(): void
    {
        $clinic = $this->clinic('d');
        Sanctum::actingAs($this->user($clinic, 'receptionist'));

        $this->postJson('/api/clinic/settings/clinic', [
            'walkin_enabled' => false,
        ])->assertStatus(403);
    }

    public function test_receptionist_cannot_update_clinic_settings(): void
    {
        $clinic = $this->clinic('e');
        $setting = ClinicSetting::create(['clinic_id' => $clinic->id]);
        Sanctum::actingAs($this->user($clinic, 'receptionist'));

        $this->putJson("/api/clinic/settings/clinic/{$setting->id}", [
            'walkin_enabled' => false,
        ])->assertStatus(403);
    }

    public function test_assistant_cannot_update_clinic_settings(): void
    {
        $clinic = $this->clinic('f');
        $setting = ClinicSetting::create(['clinic_id' => $clinic->id]);
        $doctor = Doctor::create(['clinic_id' => $clinic->id, 'full_name' => 'Dr F']);
        $assistant = $this->user($clinic, 'assistant');
        $assistant->assignedDoctors()->attach($doctor->id, ['clinic_id' => $clinic->id]);
        Sanctum::actingAs($assistant);

        $this->putJson("/api/clinic/settings/clinic/{$setting->id}", [
            'walkin_enabled' => false,
        ])->assertStatus(403);
    }

    public function test_doctor_cannot_update_clinic_settings(): void
    {
        $clinic = $this->clinic('g');
        $setting = ClinicSetting::create(['clinic_id' => $clinic->id]);
        $doctorUser = $this->user($clinic, 'doctor');
        Doctor::create(['clinic_id' => $clinic->id, 'user_id' => $doctorUser->id, 'full_name' => 'Dr G']);
        Sanctum::actingAs($doctorUser);

        $this->putJson("/api/clinic/settings/clinic/{$setting->id}", [
            'walkin_enabled' => false,
        ])->assertStatus(403);
    }

    public function test_clinic_admin_can_create_clinic_settings(): void
    {
        $clinic = $this->clinic('h');
        Sanctum::actingAs($this->user($clinic, 'clinic_admin'));

        $this->postJson('/api/clinic/settings/clinic', [
            'walkin_enabled' => false,
        ])->assertSuccessful();
    }
}
