<?php

namespace Tests\Feature;

use App\Models\Clinic;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SuperAdminUserUpdateTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    private function superAdmin(): User
    {
        $user = User::create([
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Super Admin',
            'email' => 'super@x.test',
            'password' => 'x',
            'role' => 'super_admin',
            'status' => 'active',
        ]);
        $user->assignRole('super_admin');

        return $user;
    }

    public function test_super_admin_can_update_a_doctor_user_keeping_doctor_role(): void
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'Doc Clinic', 'slug' => 'doc-clinic', 'status' => 'active']);

        $doctorUser = User::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Dr. Jane',
            'email' => 'jane@doc-clinic.test',
            'password' => 'x',
            'role' => 'doctor',
            'status' => 'active',
        ]);
        $doctorUser->assignRole('doctor');

        Sanctum::actingAs($this->superAdmin());

        $this->putJson("/api/super-admin/users/{$doctorUser->id}", [
            'role' => 'doctor',
        ])->assertSuccessful();
    }
}
