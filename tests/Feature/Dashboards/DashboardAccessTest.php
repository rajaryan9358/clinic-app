<?php

namespace Tests\Feature\Dashboards;

use App\Models\Clinic;
use App\Models\Role;
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
 * summary is open to every clinic user (scoped per user, see
 * DashboardCountsTest); the role dashboards are gated by permission:
 * clinic-admin -> dashboard.admin, receptionist -> dashboard.receptionist,
 * assistant -> dashboard.assistant. clinic_admin kind passes every check.
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

    private function userForRole(string $role): User
    {
        return match ($role) {
            'assistant' => $this->makeAssistant($this->clinic, [$this->makeDoctor($this->clinic)]),
            'doctor' => $this->makeDoctorUser($this->clinic, $this->makeDoctor($this->clinic)),
            default => $this->makeUser($this->clinic, $role),
        };
    }

    /** Expected status per system role and endpoint. */
    private const MATRIX = [
        'clinic_admin' => ['summary' => 200, 'clinic-admin' => 200, 'receptionist' => 200, 'assistant' => 200],
        'receptionist' => ['summary' => 200, 'clinic-admin' => 403, 'receptionist' => 200, 'assistant' => 403],
        'assistant' => ['summary' => 200, 'clinic-admin' => 403, 'receptionist' => 403, 'assistant' => 200],
        'doctor' => ['summary' => 200, 'clinic-admin' => 403, 'receptionist' => 403, 'assistant' => 403],
    ];

    public static function roleMatrix(): array
    {
        $out = [];
        foreach (self::MATRIX as $role => $expectations) {
            foreach ($expectations as $name => $status) {
                $out["{$role} -> {$name}"] = [$role, self::endpoints()[$name][0], $status];
            }
        }

        return $out;
    }

    #[Test]
    #[DataProvider('roleMatrix')]
    public function system_roles_follow_the_dashboard_access_matrix(string $role, string $uri, int $status): void
    {
        Sanctum::actingAs($this->userForRole($role));

        $res = $this->getJson($uri)->assertStatus($status);

        if ($status === 200) {
            $res->assertJsonPath('success', true);
        } else {
            $res->assertJsonPath('success', false);
            $this->assertStringStartsWith("You don't have permission to view the", $res->json('message'));
        }
    }

    #[Test]
    public function staff_with_no_permissions_only_gets_the_summary(): void
    {
        Sanctum::actingAs($this->staffWith($this->clinic, []));

        $this->getJson('/api/clinic/dashboard/summary')->assertOk();
        $this->getJson('/api/clinic/dashboard/clinic-admin')->assertForbidden()->assertJsonPath('success', false);
        $this->getJson('/api/clinic/dashboard/receptionist')->assertForbidden();
        $this->getJson('/api/clinic/dashboard/assistant')->assertForbidden();
    }

    public static function permissionGates(): array
    {
        return [
            'clinic-admin' => ['dashboard.admin', '/api/clinic/dashboard/clinic-admin'],
            'receptionist' => ['dashboard.receptionist', '/api/clinic/dashboard/receptionist'],
            'assistant' => ['dashboard.assistant', '/api/clinic/dashboard/assistant'],
        ];
    }

    #[Test]
    #[DataProvider('permissionGates')]
    public function custom_role_with_the_dashboard_permission_can_read_it(string $permission, string $uri): void
    {
        Sanctum::actingAs($this->staffWith($this->clinic, [$permission]));

        $this->getJson($uri)->assertOk()->assertJsonPath('success', true);
    }

    #[Test]
    #[DataProvider('permissionGates')]
    public function custom_role_without_the_dashboard_permission_is_forbidden(string $permission, string $uri): void
    {
        // Every other dashboard permission, plus a broad operational set:
        // none of them stands in for the one this endpoint needs.
        $others = array_values(array_diff(['dashboard.admin', 'dashboard.receptionist', 'dashboard.assistant'], [$permission]));
        Sanctum::actingAs($this->staffWith($this->clinic, array_merge($others, ['appointments.view', 'patients.view', 'reports.view', 'audit_logs.view'])));

        $this->getJson($uri)->assertForbidden()->assertJsonPath('success', false);
    }

    #[Test]
    public function custom_doctor_kind_role_with_dashboard_admin_can_read_the_admin_dashboard(): void
    {
        $role = Role::create(['name' => 'senior_doctor', 'guard_name' => 'web', 'label' => 'Senior doctor', 'kind' => 'doctor']);
        $role->syncPermissions(['dashboard.admin']);
        $user = $this->makeUser($this->clinic, 'doctor');
        $user->update(['role' => 'senior_doctor']);
        $user->syncRoles(['senior_doctor']);
        $this->makeDoctor($this->clinic, 'Dr Senior', ['user_id' => $user->id]);
        Sanctum::actingAs($user->fresh());

        $this->getJson('/api/clinic/dashboard/clinic-admin')->assertOk();
        $this->getJson('/api/clinic/dashboard/receptionist')->assertForbidden();
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
