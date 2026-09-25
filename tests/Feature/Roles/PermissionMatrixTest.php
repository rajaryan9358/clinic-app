<?php
namespace Tests\Feature\Roles;

use App\Models\Clinic;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class PermissionMatrixTest extends TestCase
{
    use RefreshDatabase;

    private Clinic $clinic;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
    }

    private function staffWith(array $permissions): User
    {
        $role = Role::create(['name' => 'r'.Str::random(6), 'guard_name' => 'web', 'label' => 'R', 'kind' => 'staff']);
        $role->syncPermissions($permissions);
        $u = User::create(['clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'S',
            'email' => Str::random(6).'@x.test', 'password' => 'x', 'role' => $role->name, 'status' => 'active']);
        $u->syncRoles([$role->name]);

        return $u;
    }

    public static function routes(): array
    {
        return [
            'patients list' => ['GET', '/api/clinic/patients', 'patients.view'],
            'patients create' => ['POST', '/api/clinic/patients', 'patients.create'],
            'patients delete' => ['DELETE', '/api/clinic/patients/999', 'patients.delete'],
            'patient notes add' => ['POST', '/api/clinic/patients/999/notes', 'patients.edit'],
            'appointments list' => ['GET', '/api/clinic/appointments', 'appointments.view'],
            'availability' => ['GET', '/api/clinic/appointments/availability', 'appointments.view'],
            'reschedule' => ['POST', '/api/clinic/appointments/999/reschedule', 'appointments.edit'],
            'prescription voice' => ['POST', '/api/clinic/appointments/999/prescription/voice', 'appointments.prescribe'],
            'staff list' => ['GET', '/api/clinic/users', 'staff.view'],
            'staff create' => ['POST', '/api/clinic/users', 'staff.create'],
            'doctors create' => ['POST', '/api/clinic/doctors', 'doctors.create'],
            'doctor profile edit' => ['PUT', '/api/clinic/doctors/999/profile', 'doctors.edit'],
            'schedule add' => ['POST', '/api/clinic/doctors/999/schedules', 'doctor_schedules.create'],
            'schedule delete' => ['DELETE', '/api/clinic/doctors/999/schedules/1', 'doctor_schedules.delete'],
            'services create' => ['POST', '/api/clinic/services', 'services.create'],
            'whatsapp conversations' => ['GET', '/api/clinic/whatsapp/conversations', 'whatsapp.view'],
            'reminders' => ['GET', '/api/clinic/reminders', 'reminders.view'],
            'followups create' => ['POST', '/api/clinic/followups', 'followups.create'],
            'invoices' => ['GET', '/api/clinic/invoices', 'billing.view'],
            'payments create' => ['POST', '/api/clinic/payments', 'billing.create'],
            'reviews reply' => ['POST', '/api/clinic/reviews/999/reply', 'reviews.edit'],
            'reports' => ['GET', '/api/clinic/reports/patients.pdf', 'reports.view'],
            'audit logs' => ['GET', '/api/clinic/audit-logs', 'audit_logs.view'],
            'settings edit' => ['PUT', '/api/clinic/settings/clinic/999', 'clinic_settings.edit'],
            'domains' => ['GET', '/api/clinic/domains', 'clinic_settings.view'],
            'profile' => ['GET', '/api/clinic/clinic/profile', 'clinic_profile.view'],
            'profile edit' => ['PUT', '/api/clinic/clinic/profile', 'clinic_profile.edit'],
            'subscription' => ['GET', '/api/clinic/subscription', 'subscription.view'],
            'checkout' => ['POST', '/api/clinic/subscription/checkout', 'subscription.manage'],
            'assignable roles' => ['GET', '/api/clinic/roles', 'staff.view'],
        ];
    }

    #[DataProvider('routes')]
    public function test_route_requires_permission(string $method, string $uri, string $permission): void
    {
        Sanctum::actingAs($this->staffWith([]));
        $res = $this->json($method, $uri, []);
        $res->assertStatus(403);
        $this->assertStringStartsWith("You don't have permission to", $res->json('message'));

        Sanctum::actingAs($this->staffWith([$permission]));
        $this->assertNotSame(403, $this->json($method, $uri, [])->status(), "{$method} {$uri} still 403 with {$permission}");
    }

    public function test_open_routes_need_only_login(): void
    {
        Sanctum::actingAs($this->staffWith([]));
        $this->getJson('/api/clinic/me/context')->assertOk();
        $this->getJson('/api/clinic/dashboard/summary')->assertOk();
    }

    private function appointmentId(): int
    {
        $doctor = \App\Models\Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr A', 'slot_duration_minutes' => 30]);
        $date = now()->startOfDay();
        \App\Models\DoctorSchedule::create(['clinic_id' => $this->clinic->id, 'doctor_id' => $doctor->id, 'day_of_week' => $date->dayOfWeek,
            'start_time' => '00:00:00', 'end_time' => '23:59:00', 'consultation_mode' => 'in_person', 'is_active' => true]);
        Sanctum::actingAs($this->staffWith(['appointments.create', 'appointments.view', 'patients.create']));

        return (int) $this->postJson('/api/clinic/appointments', [
            'doctor_id' => $doctor->id, 'appointment_date' => $date->toDateString(),
            'start_time' => now()->addMinutes(5)->format('H:i'), 'end_time' => now()->addMinutes(35)->format('H:i'),
            'visit_type' => 'new', 'booking_channel' => 'walk_in',
            'patient' => ['phone' => '9000000009', 'first_name' => 'Pat', 'last_name' => 'One'],
        ])->assertCreated()->json('data.id');
    }

    public function test_lifecycle_cancel_and_check_in_need_their_specials(): void
    {
        $id = $this->appointmentId();

        Sanctum::actingAs($this->staffWith(['appointments.view', 'appointments.check_in']));
        $this->postJson("/api/clinic/appointments/{$id}/lifecycle", ['status' => 'cancelled', 'reason' => 'x'])
            ->assertStatus(403)->assertJsonFragment(['message' => "You don't have permission to cancel appointments."]);

        Sanctum::actingAs($this->staffWith(['appointments.view', 'appointments.cancel']));
        $this->postJson("/api/clinic/appointments/{$id}/lifecycle", ['status' => 'checked_in'])
            ->assertStatus(403)->assertJsonFragment(['message' => "You don't have permission to check in appointments."]);
        $this->assertNotSame(403, $this->postJson("/api/clinic/appointments/{$id}/lifecycle", ['status' => 'cancelled', 'reason' => 'x'])->status());
    }

    public function test_clinic_admin_passes_everything_without_explicit_permissions(): void
    {
        Role::findByName('clinic_admin', 'web')->syncPermissions([]);
        app(\Spatie\Permission\PermissionRegistrar::class)->forgetCachedPermissions();
        $admin = User::create(['clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'A',
            'email' => 'a@x.test', 'password' => 'x', 'role' => 'clinic_admin', 'status' => 'active']);
        $admin->syncRoles(['clinic_admin']);
        Sanctum::actingAs($admin);
        foreach (self::routes() as [$method, $uri]) {
            $this->assertNotSame(403, $this->json($method, $uri, [])->status(), "{$method} {$uri}");
        }
    }

    public function test_role_editing_routes_removed_from_clinic_api(): void
    {
        Sanctum::actingAs($this->staffWith(['staff.view', 'staff.edit']));
        $this->postJson('/api/clinic/roles/1/permissions', ['permissions' => []])->assertStatus(404);
        $this->getJson('/api/clinic/permissions')->assertStatus(404);
    }

    private function systemUser(string $role): User
    {
        $u = User::create(['clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => $role,
            'email' => Str::random(6).'@x.test', 'password' => 'x', 'role' => $role, 'status' => 'active']);
        $u->syncRoles([$role]);
        if ($role === 'doctor') {
            \App\Models\Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr Me', 'user_id' => $u->id]);
        }
        if ($role === 'assistant') {
            $doc = \App\Models\Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr Theirs']);
            $u->assignedDoctors()->attach($doc->id, ['clinic_id' => $this->clinic->id]); // match the pivot columns in User::assignedDoctors()
        }

        return $u;
    }

    public function test_system_roles_keep_their_day_to_day_access(): void
    {
        $checks = [
            'receptionist' => [['GET', '/api/clinic/patients'], ['GET', '/api/clinic/appointments'], ['GET', '/api/clinic/invoices']],
            'assistant' => [['GET', '/api/clinic/patients'], ['GET', '/api/clinic/appointments']],
            'doctor' => [['GET', '/api/clinic/appointments'], ['GET', '/api/clinic/patients']],
        ];
        foreach ($checks as $role => $requests) {
            Sanctum::actingAs($this->systemUser($role));
            foreach ($requests as [$m, $uri]) {
                $this->json($m, $uri)->assertOk();
            }
        }
    }
}
