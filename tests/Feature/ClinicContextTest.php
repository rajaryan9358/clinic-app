<?php

namespace Tests\Feature;

use App\Models\Clinic;
use App\Models\Patient;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ClinicContextTest extends TestCase
{
    use RefreshDatabase;

    private function receptionist(Clinic $clinic): User
    {
        $user = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Rita',
            'email' => 'rita'.$clinic->id.'@x.test', 'password' => 'x', 'role' => 'receptionist', 'status' => 'active',
        ]);
        $user->assignRole('receptionist');
        return $user;
    }

    private function clinic(string $slug): Clinic
    {
        return Clinic::create(['uuid' => (string) Str::uuid(), 'name' => $slug, 'slug' => $slug, 'status' => 'active']);
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    public function test_receptionist_gets_context_without_branch_keys(): void
    {
        $clinic = $this->clinic('a');
        Sanctum::actingAs($this->receptionist($clinic));

        $res = $this->getJson('/api/clinic/me/context')->assertOk();

        $this->assertSame($clinic->id, $res->json('data.clinic_id'));
        $this->assertArrayNotHasKey('active_branch_id', $res->json('data'));
        $this->assertArrayNotHasKey('allowed_branches', $res->json('data'));
    }

    public function test_receptionist_lists_only_own_clinic_patients(): void
    {
        $mine = $this->clinic('mine');
        $other = $this->clinic('other');
        Patient::create(['clinic_id' => $mine->id, 'uuid' => (string) Str::uuid(), 'first_name' => 'Own', 'last_name' => 'Patient', 'full_name' => 'Own Patient', 'phone' => '9000000001']);
        Patient::create(['clinic_id' => $other->id, 'uuid' => (string) Str::uuid(), 'first_name' => 'Other', 'last_name' => 'Patient', 'full_name' => 'Other Patient', 'phone' => '9000000002']);
        Sanctum::actingAs($this->receptionist($mine));

        $body = $this->getJson('/api/clinic/patients')->assertOk()->getContent();

        $this->assertStringContainsString('Own Patient', $body);
        $this->assertStringNotContainsString('Other Patient', $body);
    }

    public function test_stale_branch_header_and_param_are_ignored(): void
    {
        $clinic = $this->clinic('b');
        Sanctum::actingAs($this->receptionist($clinic));

        $this->withHeader('X-Branch-Id', '999')
            ->getJson('/api/clinic/patients?branch_id=999')
            ->assertOk();
    }
}
