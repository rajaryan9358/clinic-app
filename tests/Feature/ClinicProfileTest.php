<?php

namespace Tests\Feature;

use App\Models\Clinic;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ClinicProfileTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    public function test_clinic_admin_can_update_own_clinic_address_and_contact(): void
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'Sunrise', 'slug' => 'sunrise', 'status' => 'active']);
        $admin = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Admin',
            'email' => 'admin@sunrise.test', 'password' => 'x', 'role' => 'clinic_admin', 'status' => 'active',
        ]);
        $admin->assignRole('clinic_admin');
        Sanctum::actingAs($admin);

        $response = $this->putJson('/api/clinic/clinic/profile', [
            'address_line_1' => '221B Baker Street',
            'address_line_2' => 'Near Central Park',
            'city' => 'Pune',
            'state' => 'Maharashtra',
            'pincode' => '411001',
            'phone' => '9800000000',
            'email' => 'contact@sunrise.test',
        ]);

        $response->assertOk();
        $this->assertSame('Pune', $clinic->fresh()->city);
        $this->assertSame('221B Baker Street', $clinic->fresh()->address_line_1);
        $this->assertSame('Maharashtra', $clinic->fresh()->state);
        $this->assertSame('411001', $clinic->fresh()->pincode);
        $this->assertSame('9800000000', $clinic->fresh()->phone);
        $this->assertSame('contact@sunrise.test', $clinic->fresh()->email);
    }

    public function test_clinic_admin_cannot_change_the_theme_colours(): void
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'Sunrise', 'slug' => 'sunrise', 'status' => 'active', 'primary_color' => '#2563EB']);
        $admin = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Admin',
            'email' => 'admin@sunrise.test', 'password' => 'x', 'role' => 'clinic_admin', 'status' => 'active',
        ]);
        $admin->assignRole('clinic_admin');
        Sanctum::actingAs($admin);

        $this->putJson('/api/clinic/clinic/profile', ['primary_color' => '#FF0000', 'secondary_color' => '#00FF00', 'city' => 'Pune'])
            ->assertOk();

        $this->assertSame('#2563EB', $clinic->fresh()->primary_color);
        $this->assertNull($clinic->fresh()->secondary_color);
        $this->assertSame('Pune', $clinic->fresh()->city);
    }

    public function test_whatsapp_status_reports_connection_and_templates_without_credentials(): void
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'Sunrise', 'slug' => 'sunrise', 'status' => 'active']);
        $admin = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Admin',
            'email' => 'admin@sunrise.test', 'password' => 'x', 'role' => 'clinic_admin', 'status' => 'active',
        ]);
        $admin->assignRole('clinic_admin');
        Sanctum::actingAs($admin);

        $res = $this->getJson('/api/clinic/whatsapp/status')->assertOk();

        $this->assertIsBool($res->json('data.connected'));
        $this->assertContains('booking_confirmed', array_column($res->json('data.templates'), 'type'));
        $this->assertStringNotContainsString('access_token', $res->getContent());
    }

    public function test_whatsapp_status_needs_clinic_settings_permission(): void
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'Sunrise', 'slug' => 'sunrise', 'status' => 'active']);
        $user = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Desk',
            'email' => 'desk@sunrise.test', 'password' => 'x', 'role' => 'receptionist', 'status' => 'active',
        ]);
        $user->assignRole('receptionist');
        Sanctum::actingAs($user);

        $this->getJson('/api/clinic/whatsapp/status')->assertForbidden();
    }
}
