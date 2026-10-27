<?php

namespace Tests\Feature\Dashboards;

use App\Models\Clinic;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Who may call the dashboard endpoints.
 *
 * The four dashboard routes carry no `perm:` middleware, only the clinic
 * group middleware (auth:sanctum, clinic.scope, clinic.context,
 * clinic.subscription). These tests pin that: any authenticated clinic user
 * can read every dashboard, subject to the context middleware rules.
 */
class DashboardAccessTest extends TestCase
{
    use DashboardTestHelpers;
    use RefreshDatabase;

    private Clinic $clinic;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->clinic = $this->makeClinic('Main');
    }

    public static function endpoints(): array
    {
        return [
            'summary' => ['/api/clinic/dashboard/summary'],
            'clinic-admin' => ['/api/clinic/dashboard/clinic-admin'],
            'receptionist' => ['/api/clinic/dashboard/receptionist'],
            'assistant' => ['/api/clinic/dashboard/assistant'],
        ];
    }

    public static function endpointsByRole(): array
    {
        $out = [];
        foreach (['clinic_admin', 'receptionist', 'assistant', 'doctor'] as $role) {
            foreach (self::endpoints() as $name => [$uri]) {
                $out["{$role} -> {$name}"] = [$role, $uri];
            }
        }

        return $out;
    }

    private function userForRole(string $role): User
    {
        return match ($role) {
            'assistant' => $this->makeAssistant($this->clinic, [$this->makeDoctor($this->clinic)]),
            'doctor' => $this->makeDoctorUser($this->clinic, $this->makeDoctor($this->clinic)),
            default => $this->makeUser($this->clinic, $role),
        };
    }

    #[Test]
    #[DataProvider('endpointsByRole')]
    public function every_system_role_can_read_every_dashboard(string $role, string $uri): void
    {
        Sanctum::actingAs($this->userForRole($role));

        $this->getJson($uri)->assertOk()->assertJsonPath('success', true);
    }

    /** Pins current behaviour: no permission is required (see report notes). */
    #[Test]
    #[DataProvider('endpoints')]
    public function staff_with_no_permissions_can_still_read_dashboards(string $uri): void
    {
        Sanctum::actingAs($this->staffWith($this->clinic, []));

        $this->getJson($uri)->assertOk();
    }

    #[Test]
    #[DataProvider('endpoints')]
    public function unauthenticated_requests_are_rejected(string $uri): void
    {
        $this->getJson($uri)->assertUnauthorized();
    }

    #[Test]
    #[DataProvider('endpoints')]
    public function suspended_clinic_gets_payment_required(string $uri): void
    {
        $this->clinic->update(['status' => 'suspended']);
        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));

        $this->getJson($uri)->assertStatus(402)->assertJsonPath('code', 'SUBSCRIPTION_REQUIRED');
    }

    #[Test]
    public function assistant_without_assigned_doctors_is_forbidden(): void
    {
        Sanctum::actingAs($this->makeUser($this->clinic, 'assistant'));

        $this->getJson('/api/clinic/dashboard/assistant')->assertForbidden();
    }

    #[Test]
    public function doctor_user_without_linked_doctor_profile_is_forbidden(): void
    {
        Sanctum::actingAs($this->makeUser($this->clinic, 'doctor'));

        $this->getJson('/api/clinic/dashboard/summary')->assertForbidden();
    }

    #[Test]
    public function non_super_admin_without_clinic_is_forbidden(): void
    {
        $user = User::create([
            'clinic_id' => null, 'uuid' => (string) Str::uuid(), 'full_name' => 'Orphan',
            'email' => 'orphan@x.test', 'password' => 'x', 'role' => 'receptionist', 'status' => 'active',
        ]);
        $user->assignRole('receptionist');
        Sanctum::actingAs($user);

        $this->getJson('/api/clinic/dashboard/receptionist')->assertForbidden();
    }

    #[Test]
    public function assistant_cannot_widen_scope_with_x_doctor_id_of_unassigned_doctor(): void
    {
        $mine = $this->makeDoctor($this->clinic, 'Mine');
        $other = $this->makeDoctor($this->clinic, 'Other');
        Sanctum::actingAs($this->makeAssistant($this->clinic, [$mine]));

        $this->getJson('/api/clinic/dashboard/assistant', ['X-Doctor-Id' => (string) $other->id])->assertForbidden();
    }
}
