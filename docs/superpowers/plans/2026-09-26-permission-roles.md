# Permission-Based Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Super admin builds platform-wide roles from module permissions; every `/api/clinic` route is permission-checked; data scoping moves from role names to the role's kind.

**Architecture:** Spatie's `roles` table gains `label`, `kind`, `limit_to_assigned_doctors`, `is_system`, `description` (custom `App\Models\Role`). `users.role` stays the role *name* (now a free string). `App\Support\PermissionCatalogue` is the single list of permissions. A `perm:<name>` middleware (friendly 403) guards routes; `Gate::before` grants everything to super_admin and clinic_admin kinds. The React app reads `permissions[]` from `me/context`.

**Tech Stack:** Laravel 13 (PHP 8.4 at `/opt/homebrew/bin/php`), spatie/laravel-permission, Sanctum, SQLite in-memory tests, React 19 + Vite + Tailwind 4 (`resources/js/admin/src`).

**Spec:** `docs/superpowers/specs/2026-09-26-permission-roles-design.md`

## Global Constraints

- `php` → `/opt/homebrew/bin/php`; `npm` → `PATH=$HOME/.nvm/versions/node/v22.14.0/bin:$PATH npm ...` (">500 kB chunk" warning pre-existing).
- Role kinds: `super_admin`, `clinic_admin`, `staff`, `doctor`. System roles: super_admin, clinic_admin, doctor, receptionist (staff), assistant (staff, limit_to_assigned_doctors).
- Permission names `{module}.{action}`, guard `web`. Modules: patients, appointments, doctors, doctor_schedules, services, staff, whatsapp, reminders, followups, billing, reviews, reports, audit_logs, clinic_profile, clinic_settings, subscription. Actions view/create/edit/delete; `reports` and `audit_logs` have only `view`. Specials: `appointments.check_in`, `appointments.cancel`, `appointments.prescribe`, `subscription.manage`.
- Denied → HTTP 403 `{"success": false, "message": "You don't have permission to {verb} {module label}."}` where verb is view/create/edit/delete, or for specials the special's label (e.g. "check in appointments").
- clinic_admin kind always passes every permission; super_admin kind bypasses.
- Migrations are edited in place (schema rebuilt with `migrate:fresh`; dev DB backup before rebuild).
- Tests: `/opt/homebrew/bin/php artisan test`, pristine output. Feature tests seed `RolesAndPermissionsSeeder`.
- Never stage the root PDF, `.playwright-mcp/`, `.superpowers/`. Commit messages end with a blank line then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `permission-roles`.

## Review Focus

1. **Existing clinic users after the upgrade** (role strings `receptionist`, `assistant`, `doctor`, `clinic_admin`) keep working with the seeded defaults — no one is locked out. Test: Task 3 `test_system_roles_keep_their_day_to_day_access`.
2. **A super admin or clinic admin permission edit takes effect immediately** (Spatie caches permissions). Test: Task 5 `test_permission_change_takes_effect_immediately`.
3. **A staff user with `staff.edit` tries to promote themselves or edit/demote a clinic admin.** Must be 403. Test: Task 4 `test_staff_editor_cannot_touch_clinic_admins_or_self_promote`.
4. **Deleting or renaming a role that users have.** Delete → 422; label changes don't break users (name is immutable). Test: Task 5 `test_role_in_use_cannot_be_deleted_and_name_is_immutable`.
5. **A custom doctor-kind role** must scope exactly like `doctor` (own appointments/patients), and a custom staff role with limit_to_assigned_doctors like `assistant`. Test: Task 2 `test_custom_kinds_scope_like_builtins`.

---

## File Structure

**Create:** `app/Models/Role.php`, `app/Support/PermissionCatalogue.php`, `app/Http/Middleware/EnsurePermission.php`, `app/Http/Controllers/Api/SuperAdmin/RoleController.php`, `tests/Feature/Roles/*`, `resources/js/admin/src/pages/workflows/RolesPage.jsx`, `resources/js/admin/src/components/roles/PermissionGrid.jsx`.

**Modify (backend):** permission + users migrations, `config/permission.php`, `database/seeders/RolesAndPermissionsSeeder.php`, `app/Models/User.php`, `app/Providers/AppServiceProvider.php`, `bootstrap/app.php`, `routes/api.php`, middleware (ResolveClinicContext, EnsureClinicScope, EnsureClinicSubscription), clinic controllers (User, Doctor, DoctorProfile, Appointment, BaseClinicCrud, ClinicSetting, Subscription, Me, RolePermission), SuperAdmin DashboardController, `app/Services/UserManagementService.php`, `app/Services/DoctorManagementService.php`, `app/Http/Requests/StoreUserRequest.php`, `UpdateUserRequest.php`.
**Delete:** `app/Http/Controllers/Api/SuperAdmin/RolePermissionController.php` (replaced by RoleController).

---

### Task 1: Role model, catalogue, seeder, kind helpers, Gate::before

**Files:**
- Modify: `database/migrations/2026_03_28_191751_create_permission_tables.php` (roles table), `database/migrations/0001_01_01_000000_create_users_table.php` (role column), `config/permission.php` (`models.role`), `database/seeders/RolesAndPermissionsSeeder.php`, `app/Models/User.php`, `app/Providers/AppServiceProvider.php`
- Create: `app/Models/Role.php`, `app/Support/PermissionCatalogue.php`
- Test: `tests/Feature/Roles/RoleFoundationTest.php`

**Interfaces:**
- Produces:
  - `PermissionCatalogue::modules(): array` → `[key => ['label' => string, 'actions' => string[]]]`; `::specials(): array` → `[name => ['label' => string, 'module' => string]]`; `::all(): string[]` (every permission name); `::label(string $permission): string` (human phrase used in 403s, e.g. `create patients`, `check in appointments`); `::defaults(string $roleName): string[]`.
  - `App\Models\Role` (fillable name, guard_name, label, kind, limit_to_assigned_doctors, is_system, description; casts bools); constants `KINDS = ['super_admin','clinic_admin','staff','doctor']`.
  - `User::roleModel(): ?Role` (memoized), `User::roleKind(): string` (`super_admin` when role is super_admin; else role's kind; `staff` if role missing), `User::limitsToAssignedDoctors(): bool`.
  - `Gate::before` returns true for kinds super_admin and clinic_admin.

- [ ] **Step 1: Failing test**

```php
<?php
namespace Tests\Feature\Roles;

use App\Models\Clinic;
use App\Models\Role;
use App\Models\User;
use App\Support\PermissionCatalogue;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Tests\TestCase;

class RoleFoundationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    private function user(string $role): User
    {
        $clinic = Clinic::firstOrCreate(['slug' => 'c'], ['uuid' => (string) Str::uuid(), 'name' => 'C', 'status' => 'active']);
        $u = User::create(['clinic_id' => $role === 'super_admin' ? null : $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => $role,
            'email' => Str::random(6).'@x.test', 'password' => 'x', 'role' => $role, 'status' => 'active']);
        $u->syncRoles([$role]);

        return $u;
    }

    public function test_catalogue_is_seeded_exactly(): void
    {
        $this->assertEqualsCanonicalizing(PermissionCatalogue::all(), Permission::pluck('name')->all());
        $this->assertContains('appointments.check_in', PermissionCatalogue::all());
        $this->assertNotContains('reports.create', PermissionCatalogue::all());
        $this->assertSame('check in appointments', PermissionCatalogue::label('appointments.check_in'));
        $this->assertSame('create patients', PermissionCatalogue::label('patients.create'));
    }

    public function test_system_roles_have_kinds_and_flags(): void
    {
        $expect = ['super_admin' => 'super_admin', 'clinic_admin' => 'clinic_admin', 'doctor' => 'doctor', 'receptionist' => 'staff', 'assistant' => 'staff'];
        foreach ($expect as $name => $kind) {
            $role = Role::findByName($name, 'web');
            $this->assertInstanceOf(Role::class, $role);
            $this->assertSame($kind, $role->kind);
            $this->assertTrue($role->is_system);
        }
        $this->assertTrue(Role::findByName('assistant', 'web')->limit_to_assigned_doctors);
        $this->assertSame('Receptionist', Role::findByName('receptionist', 'web')->label);
    }

    public function test_kind_helpers_and_gate_before(): void
    {
        $this->assertSame('super_admin', $this->user('super_admin')->roleKind());
        $admin = $this->user('clinic_admin');
        $this->assertSame('clinic_admin', $admin->roleKind());
        $this->assertTrue($admin->can('staff.delete'));           // Gate::before — full access
        $recep = $this->user('receptionist');
        $this->assertSame('staff', $recep->roleKind());
        $this->assertTrue($recep->can('patients.create'));
        $this->assertFalse($recep->can('staff.view'));
        $this->assertTrue($this->user('assistant')->limitsToAssignedDoctors());
        $this->assertSame('doctor', $this->user('doctor')->roleKind());
    }
}
```

- [ ] **Step 2: Run — FAIL** (`Class "App\Support\PermissionCatalogue" not found`)

- [ ] **Step 3: Migrations** — in the permission migration's `roles` create block, after `guard_name` add:
```php
$table->string('label')->nullable();
$table->enum('kind', ['super_admin', 'clinic_admin', 'staff', 'doctor'])->default('staff');
$table->boolean('limit_to_assigned_doctors')->default(false);
$table->boolean('is_system')->default(false);
$table->text('description')->nullable();
```
In the users migration replace the role enum with `$table->string('role', 64);`.

- [ ] **Step 4: Catalogue**

```php
<?php
namespace App\Support;

class PermissionCatalogue
{
    private const CRUD = ['view', 'create', 'edit', 'delete'];

    public static function modules(): array
    {
        $m = fn (string $label, array $actions = self::CRUD) => ['label' => $label, 'actions' => $actions];

        return [
            'patients' => $m('patients'),
            'appointments' => $m('appointments'),
            'doctors' => $m('doctors'),
            'doctor_schedules' => $m('doctor schedules'),
            'services' => $m('services'),
            'staff' => $m('staff users'),
            'whatsapp' => $m('WhatsApp'),
            'reminders' => $m('reminders'),
            'followups' => $m('follow-ups'),
            'billing' => $m('invoices and payments'),
            'reviews' => $m('reviews'),
            'reports' => $m('reports', ['view']),
            'audit_logs' => $m('the audit log', ['view']),
            'clinic_profile' => $m('the clinic profile'),
            'clinic_settings' => $m('clinic settings'),
            'subscription' => $m('the subscription'),
        ];
    }

    public static function specials(): array
    {
        return [
            'appointments.check_in' => ['label' => 'check in appointments', 'module' => 'appointments'],
            'appointments.cancel' => ['label' => 'cancel appointments', 'module' => 'appointments'],
            'appointments.prescribe' => ['label' => 'write prescriptions and consultation notes', 'module' => 'appointments'],
            'subscription.manage' => ['label' => 'manage the subscription', 'module' => 'subscription'],
        ];
    }

    /** @return string[] */
    public static function all(): array
    {
        $names = [];
        foreach (self::modules() as $key => $def) {
            foreach ($def['actions'] as $action) {
                $names[] = "{$key}.{$action}";
            }
        }

        return array_merge($names, array_keys(self::specials()));
    }

    public static function label(string $permission): string
    {
        if (isset(self::specials()[$permission])) {
            return self::specials()[$permission]['label'];
        }
        [$module, $action] = array_pad(explode('.', $permission, 2), 2, '');

        return trim($action.' '.(self::modules()[$module]['label'] ?? $module));
    }

    /** @return string[] */
    public static function defaults(string $roleName): array
    {
        $crud = fn (string $m, array $a = ['view', 'create', 'edit']) => array_map(fn ($x) => "{$m}.{$x}", $a);

        return match ($roleName) {
            'clinic_admin' => self::all(),
            'doctor' => array_merge(
                $crud('patients', ['view', 'edit']),
                $crud('appointments', ['view', 'create', 'edit']),
                ['appointments.check_in', 'appointments.prescribe'],
                $crud('doctor_schedules', ['view', 'create', 'edit', 'delete']),
                ['doctors.view', 'doctors.edit', 'services.view'], // doctors.edit: own profile only (kind rule in DoctorProfileController)
                $crud('followups'),
            ),
            'receptionist' => array_merge(
                $crud('patients'), $crud('appointments'), ['appointments.check_in', 'appointments.cancel'],
                ['doctors.view', 'doctor_schedules.view', 'services.view', 'reminders.view'],
                $crud('followups'), $crud('whatsapp', ['view', 'create']), $crud('billing'), ['reports.view'],
            ),
            'assistant' => array_merge(
                $crud('patients'), $crud('appointments'), ['appointments.check_in'],
                ['doctors.view', 'doctor_schedules.view', 'services.view', 'followups.view'],
            ),
            default => [],
        };
    }
}
```

- [ ] **Step 5: Role model + config**

```php
<?php
namespace App\Models;

use Spatie\Permission\Models\Role as SpatieRole;

class Role extends SpatieRole
{
    public const KINDS = ['super_admin', 'clinic_admin', 'staff', 'doctor'];

    protected $fillable = ['name', 'guard_name', 'label', 'kind', 'limit_to_assigned_doctors', 'is_system', 'description'];

    protected $casts = ['limit_to_assigned_doctors' => 'boolean', 'is_system' => 'boolean'];
}
```
`config/permission.php`: `'role' => App\Models\Role::class,`

- [ ] **Step 6: Seeder** — replace the module/action loop and role blocks:
```php
app(PermissionRegistrar::class)->forgetCachedPermissions();

foreach (PermissionCatalogue::all() as $name) {
    Permission::firstOrCreate(['name' => $name, 'guard_name' => 'web']);
}

$system = [
    ['super_admin', 'Super Admin', 'super_admin', false],
    ['clinic_admin', 'Clinic Admin', 'clinic_admin', false],
    ['doctor', 'Doctor', 'doctor', false],
    ['receptionist', 'Receptionist', 'staff', false],
    ['assistant', 'Assistant', 'staff', true],
];
foreach ($system as [$name, $label, $kind, $limit]) {
    $role = Role::firstOrCreate(['name' => $name, 'guard_name' => 'web']);
    $role->fill(['label' => $label, 'kind' => $kind, 'limit_to_assigned_doctors' => $limit, 'is_system' => true])->save();
    if ($name !== 'super_admin') {
        $role->syncPermissions(PermissionCatalogue::defaults($name));
    }
}

app(PermissionRegistrar::class)->forgetCachedPermissions();
```
(import `App\Models\Role` instead of Spatie's Role.)

- [ ] **Step 7: User helpers + Gate**

`User.php`:
```php
private ?Role $resolvedRole = null;
private bool $roleResolved = false;

public function roleModel(): ?Role
{
    if (! $this->roleResolved) {
        $this->resolvedRole = $this->role ? Role::query()->where('name', $this->role)->where('guard_name', 'web')->first() : null;
        $this->roleResolved = true;
    }

    return $this->resolvedRole;
}

public function roleKind(): string
{
    if ($this->role === 'super_admin') {
        return 'super_admin';
    }

    return $this->roleModel()?->kind ?? 'staff';
}

public function limitsToAssignedDoctors(): bool
{
    return (bool) $this->roleModel()?->limit_to_assigned_doctors;
}
```
`AppServiceProvider::boot()`:
```php
\Illuminate\Support\Facades\Gate::before(function ($user) {
    return method_exists($user, 'roleKind') && in_array($user->roleKind(), ['super_admin', 'clinic_admin'], true) ? true : null;
});
```

- [ ] **Step 8: Run tests — PASS; full suite green** (existing tests that asserted old permission names, if any, update to catalogue names).
- [ ] **Step 9: Commit** `feat(roles): role kinds, permission catalogue, system role defaults`

---

### Task 2: Data scoping by kind

**Files:**
- Modify: `app/Http/Middleware/ResolveClinicContext.php`, `EnsureClinicScope.php`, `EnsureClinicSubscription.php`, `app/Http/Controllers/Api/Clinic/AppointmentController.php` (baseQuery doctor branch; lifecycle force check), `BaseClinicCrudController.php` (applyAccessScopes), `DoctorProfileController.php` (lines using `$role === 'doctor'` for scoping/self-edit), `app/Services/UserManagementService.php` (assistant doctor mapping → role flag), `app/Http/Controllers/Api/SuperAdmin/DashboardController.php` (staff counts)
- Test: `tests/Feature/Roles/KindScopingTest.php`

**Interfaces:** Consumes `User::roleKind()`, `User::limitsToAssignedDoctors()`, `Role` (Task 1).

Replacement rules (apply to every listed site):
- `$user->role === UserRole::SUPER_ADMIN->value` / `=== 'super_admin'` → `$user->roleKind() === 'super_admin'`
- `=== UserRole::DOCTOR->value` / `$role === 'doctor'` (scoping) → `$user->roleKind() === 'doctor'`
- `=== UserRole::ASSISTANT->value` (ResolveClinicContext) → `$user->limitsToAssignedDoctors()`
- Appointment lifecycle `$forceAllowed … === 'clinic_admin'` → `$request->user()->roleKind() === 'clinic_admin'`
- `UserManagementService` `$role === 'assistant'` / `!== 'assistant'` → `Role::findByName($role,'web')->limit_to_assigned_doctors` (true/false)
- SuperAdmin dashboard staff count: `->whereNotIn('role', Role::whereIn('kind', ['super_admin','doctor'])->pluck('name'))`
- `ResolveClinicContext` doctor lookup: find the Doctor with `user_id = $user->id` when kind is doctor (unchanged query).
Leave the non-scoping checks (UserController:23, DoctorController:21, ClinicSettingController:69, SubscriptionController:63/81, DoctorProfileController:26/117/126) for Task 3.

- [ ] **Step 1: Failing test** — `test_custom_kinds_scope_like_builtins`: seed roles; create Role `senior_doctor` (kind doctor) and `helper` (kind staff, limit_to_assigned_doctors true, permissions = defaults('assistant')), plus Role `front_desk` (kind staff, defaults('receptionist')). Clinic with doctors A and B (Doctor rows; A linked to a `senior_doctor` user). Appointments: one for A, one for B (today). Assert:
  - senior_doctor user `GET /api/clinic/appointments` → only A's appointment (data.data ids).
  - helper user assigned to doctor B (`$helper->assignedDoctors()->attach($docB->id, ['clinic_id' => $clinic->id])` — read User::assignedDoctors for pivot columns) → `GET /api/clinic/appointments` → only B's.
  - front_desk user → both.
  - helper with NO assigned doctors → 403 "No doctors assigned to assistant." (existing message).
  Build appointments the way `tests/Feature/AppointmentBookingTest.php` does (read it for required columns).
- [ ] **Step 2: Run — FAIL** (custom roles not recognised by the string checks)
- [ ] **Step 3: Apply the replacement rules.** Remove now-unused `UserRole` imports only where no other use remains.
- [ ] **Step 4: PASS; full suite green**
- [ ] **Step 5: Commit** `refactor(roles): scope data by role kind instead of role name`

---

### Task 3: Permission enforcement on clinic routes

**Files:**
- Create: `app/Http/Middleware/EnsurePermission.php`
- Modify: `bootstrap/app.php` (alias `perm`), `routes/api.php` (registerCrudRoutes module param; per-route `perm:`; remove clinic `POST roles/{roleId}/permissions` and `GET permissions`), `app/Http/Controllers/Api/Clinic/UserController.php` (drop `assertCanManageUsers` role check), `DoctorController.php` (drop line 21 check), `ClinicSettingController.php` (drop `authorizeWrite`), `SubscriptionController.php` (drop role aborts), `DoctorProfileController.php` (line 26 role abort → rely on route perm; lines 117/126 "non-admin limited fields" → `roleKind() !== 'clinic_admin'`), `AppointmentController::lifecycle` (special permission check), `app/Http/Controllers/Api/Clinic/RolePermissionController.php` (keep only `roles()` — Task 4 rewrites its body)
- Test: `tests/Feature/Roles/PermissionMatrixTest.php`

**Interfaces:**
- Produces: middleware alias `perm` (`perm:patients.create`); `registerCrudRoutes(string $prefix, string $controller, ?string $module = null)`.

- [ ] **Step 1: Failing test**

```php
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
```
If the lifecycle endpoint rejects `checked_in` for a time-window rule (e.g. "check-in allowed from 15 minutes before"), the appointment above starts in 5 minutes so it is inside the window; adjust the start time only if the rule differs, and keep the 403 assertions as written.

- [ ] **Step 2: Run — FAIL** (routes return 200/404/422 instead of 403)

- [ ] **Step 3: Middleware**

```php
<?php
namespace App\Http\Middleware;

use App\Support\PermissionCatalogue;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsurePermission
{
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        $user = $request->user();
        if (! $user || ! $user->can($permission)) {
            return response()->json([
                'success' => false,
                'message' => "You don't have permission to ".PermissionCatalogue::label($permission).'.',
            ], 403);
        }

        return $next($request);
    }
}
```
`bootstrap/app.php` alias `'perm' => \App\Http\Middleware\EnsurePermission::class,`

- [ ] **Step 4: Routes** — `registerCrudRoutes`:
```php
function registerCrudRoutes(string $prefix, string $controller, ?string $module = null): void {
    $p = fn (string $action) => $module ? ["perm:{$module}.{$action}"] : [];
    Route::prefix($prefix)->group(function () use ($controller, $p) {
        Route::get('/', [$controller, 'index'])->middleware($p('view'));
        Route::post('/', [$controller, 'store'])->middleware($p('create'));
        Route::get('/{id}', [$controller, 'show'])->middleware($p('view'));
        Route::put('/{id}', [$controller, 'update'])->middleware($p('edit'));
        Route::delete('/{id}', [$controller, 'destroy'])->middleware($p('delete'));
        Route::post('/{id}/restore', [$controller, 'restore'])->middleware($p('edit'));
        Route::post('/{id}/status', [$controller, 'changeStatus'])->middleware($p('edit'));
        Route::post('/{id}/block', [$controller, 'block'])->middleware($p('edit'));
        Route::post('/{id}/unblock', [$controller, 'unblock'])->middleware($p('edit'));
    });
}
```
(keep the `function_exists` guard). In the clinic group pass modules: users→`staff`, doctors→`doctors`, services→`services`, patients→`patients`, appointments→`appointments`, followups→`followups`, reminders→`reminders`, all five whatsapp groups→`whatsapp`, invoices/payments→`billing`, settings/clinic→`clinic_settings`, audit-logs→`audit_logs`, reviews→`reviews`, domains→`clinic_settings`. Note `settings/clinic` POST store must require `clinic_settings.edit` (not create): register it with module `clinic_settings` and add `->middleware('perm:clinic_settings.edit')` override by registering settings/clinic routes explicitly instead of via the helper if needed. For `audit_logs` (view-only module) the helper's create/edit/delete routes map to non-existent permissions → they 403 for everyone except clinic_admin (acceptable; spec says writes stay unavailable).
Explicit routes (add `->middleware('perm:…')` per the spec §3 table): reports/*.pdf `reports.view`; availability, detail, prescription (GET), prescription.pdf, report.pdf, summary (GET) `appointments.view`; generate-tokens, reschedule `appointments.edit`; prescription/voice, summary/voice `appointments.prescribe`; patients profile/notes(GET)/activity/global-summary(GET)/report.pdf `patients.view`; patients notes(POST)/medical-profile/global-summary(POST) `patients.edit`; doctors/{id}/profile GET `doctors.view`, PUT `doctors.edit`; schedules/exceptions POST `doctor_schedules.create`, PUT `doctor_schedules.edit`, DELETE `doctor_schedules.delete`; reviews generate-reply, reply `reviews.edit`; clinic/profile GET `clinic_profile.view`, PUT `clinic_profile.edit`; subscription GET `subscription.view`, checkout/verify `subscription.manage`; roles GET `staff.view`. Delete the clinic `POST roles/{roleId}/permissions` and `GET permissions` lines. me/context, dashboard/*, uploads/image: no perm.
**Doctor kind:** the doctor default role includes `doctors.edit` (Task 1) so a doctor can edit their OWN profile; `DoctorProfileController` keeps restricting doctor-kind users to their own record and limited fields.

- [ ] **Step 5: Controllers** — delete the role-based aborts listed under Files; in `AppointmentController::lifecycle` before changing status:
```php
$needed = $status === AppointmentStatus::CANCELLED ? 'appointments.cancel' : 'appointments.check_in';
if (! $request->user()->can($needed)) {
    return response()->json(['success' => false, 'message' => "You don't have permission to ".\App\Support\PermissionCatalogue::label($needed).'.'], 403);
}
```
and register the lifecycle route with `perm:appointments.view` (reaching it at all).

- [ ] **Step 6: PASS; full suite green** — fix existing tests that relied on old role aborts (e.g. ClinicSettingsTest expected 403 for receptionist → still 403 via permission since receptionist lacks clinic_settings.edit; SubscriptionController non-admin 403 → receptionist lacks subscription.manage → still 403). Adjust any expected message text to the new friendly message.
- [ ] **Step 7: Commit** `feat(roles): enforce permissions on every clinic route`

---

### Task 4: Role assignment rules and assignable roles; me/context permissions

**Files:**
- Modify: `app/Services/UserManagementService.php`, `app/Http/Controllers/Api/Clinic/UserController.php` (allowedTargetRoles / baseQuery / findModel), `app/Http/Requests/StoreUserRequest.php`, `UpdateUserRequest.php`, `app/Services/DoctorManagementService.php` (linked_user.role), `app/Http/Controllers/Api/Clinic/RolePermissionController.php` (`roles()` only), `app/Http/Controllers/Api/Clinic/MeController.php`
- Test: `tests/Feature/Roles/RoleAssignmentTest.php`

**Interfaces:**
- Produces: `GET /api/clinic/roles` → `data: [{name, label, kind, limit_to_assigned_doctors}]` (kind staff, plus clinic_admin for clinic_admin actors); `me/context` adds `role_label`, `role_kind`, `permissions: string[]`.

Rules (spec §4):
- Clinic staff create/update: role must exist; kind must be `staff` or `clinic_admin`; `clinic_admin` only when the actor's kind is clinic_admin; doctor kind → 422 `{"errors":{"role":["Doctor logins are created from the doctor's profile."]}}`.
- A non-clinic_admin actor (staff kind with staff.edit/delete) cannot update/delete/block a user whose role kind is clinic_admin, nor change their own role → 403 "You can't change a clinic admin." / "You can't change your own role."
- Super admin (StoreUserRequest/UpdateUserRequest): role must exist; `super_admin` only when `clinic_id` is null; doctor kind rejected on the staff form (same message); any other kind allowed. On update keep accepting an unchanged role (existing doctor logins).
- `DoctorManagementService`: linked user role = `linked_user.role` if given (must be kind doctor, else 422) else `doctor`.
- Assistant doctor mapping (`doctor_ids`) accepted only when the target role has `limit_to_assigned_doctors`.
- `me/context`: `'role_label' => $user->roleModel()?->label, 'role_kind' => $user->roleKind(), 'role_limits_assigned_doctors' => $user->limitsToAssignedDoctors(), 'permissions' => in_array($user->roleKind(), ['clinic_admin','super_admin'], true) ? PermissionCatalogue::all() : $user->getAllPermissions()->pluck('name')->values()->all()`.

- [ ] **Step 1: Failing tests** — write `RoleAssignmentTest` covering: clinic admin creates a user with a custom staff role (201) and with `doctor` (422 message above); staff-kind user with staff.create+staff.edit cannot create a clinic_admin (422 or 403 — use 403 "You can't assign the Clinic Admin role."), cannot edit an existing clinic admin (403), cannot change own role (403) — name it `test_staff_editor_cannot_touch_clinic_admins_or_self_promote`; super admin assigning `super_admin` with a clinic_id → 422; `GET /api/clinic/roles` as clinic admin includes clinic_admin, as staff editor excludes it and excludes doctor kinds; doctor onboarding with a custom doctor-kind role works and with a staff role → 422; me/context returns permissions (receptionist contains patients.create, not staff.view; clinic admin gets all).
- [ ] **Step 2: FAIL** → **Step 3: implement** (validation helpers in UserManagementService: `assertAssignable(User $actor, string $roleName, ?int $clinicId): Role`) → **Step 4: PASS; suite green** → **Step 5: Commit** `feat(roles): role assignment rules, assignable roles, permissions in context`

---

### Task 5: Super admin role builder API

**Files:**
- Create: `app/Http/Controllers/Api/SuperAdmin/RoleController.php`
- Delete: `app/Http/Controllers/Api/SuperAdmin/RolePermissionController.php`
- Modify: `routes/api.php` (super-admin: replace `roles`, `roles/{roleId}/permissions`, `permissions` routes)
- Test: `tests/Feature/Roles/RoleBuilderTest.php`

**Interfaces:** Produces (spec §5): `GET /super-admin/roles`, `GET /super-admin/permission-catalogue`, `POST /super-admin/roles`, `PUT /super-admin/roles/{id}`, `DELETE /super-admin/roles/{id}`. Role JSON: `{id, name, label, kind, limit_to_assigned_doctors, is_system, description, permissions: string[], users_count}`. users_count = `User::where('role', $role->name)->count()`.

Validation: `label` required string max 60; `kind` in staff,doctor (create only; system roles' kind immutable → 422 if sent different); `limit_to_assigned_doctors` boolean (only meaningful for staff; force false for doctor kind); `description` nullable max 500; `permissions` array of strings `Rule::in(PermissionCatalogue::all())`. `name` = `Str::slug($label, '_')`, unique among roles (422 "A role with this name already exists."), immutable after create. clinic_admin: PUT with `permissions` → 422 "Clinic Admin always has full access."; super_admin role: 404 (hidden). DELETE system → 422 "Built-in roles can't be deleted."; in use → 422 "Move its N users to another role first." After every write: `app(PermissionRegistrar::class)->forgetCachedPermissions()`.

- [ ] **Step 1: Failing tests** — include `test_permission_change_takes_effect_immediately` (receptionist `GET /api/clinic/patients` 200; super admin PUTs receptionist permissions without patients.view; same receptionist → 403 in the same test run) and `test_role_in_use_cannot_be_deleted_and_name_is_immutable` (PUT label changes label, not name; users still resolve; DELETE → 422 with count), plus create/validation/system/clinic_admin/super_admin-hidden/catalogue endpoint shape tests, and clinic admin → 403 on these routes.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS; suite green → Step 5: Commit** `feat(roles): super admin role builder API`

---

### Task 6: Clinic app — permissions drive navigation, routes, buttons, dashboards

**Files:** `resources/js/admin/src/context/ScopeContext.jsx` (expose `can`, `roleKind`, `roleLabel`), `config/navigation.js`, `config/access.js`, `App.jsx`, `components/Layout.jsx`, `pages/DashboardPage.jsx`, `pages/ModuleListPage.jsx`, `ModuleViewPage.jsx`, `ModuleFormPage.jsx`, `pages/workflows/AppointmentsFlowPage.jsx`, `components/AppointmentDetailDrawer.jsx`, `pages/workflows/PrescriptionPage.jsx`, `pages/billing/ClinicSubscriptionPage.jsx`, `pages/workflows/PatientProfilePage.jsx`, `pages/workflows/DoctorSetupFlowPage.jsx`, `pages/workflows/ClinicProfilePage.jsx`

**Interfaces:** Consumes `me/context` `{role_kind, role_label, role_limits_assigned_doctors, permissions[]}` (Task 4). Produces `useScope().can(name)`.

- [ ] **Step 1:** `ScopeContext`: `const can = useCallback((p) => { const k = context?.role_kind; if (k === 'clinic_admin' || k === 'super_admin') return true; return (context?.permissions || []).includes(p); }, [context]);` Expose `can`, `roleKind: context?.role_kind`, `roleLabel: context?.role_label`. Super admin (no clinic context) → `can` returns true.
- [ ] **Step 2:** `navigation.js`: replace the `clinic_admin`, `receptionist`, `assistant`, `doctor` blocks with one `clinic` list; each item gets `perm`. Items (section / label / target / perm): Overview `/dashboard` (none); Operations: Appointments `/workflows/appointments` `appointments.view`, Patients module `patients.view`; Clinic: Doctors `doctors.view`, Services `services.view`, Staff Users `staff.view`; Doctor practice (doctor kind only — show when `roleKind === 'doctor'`): Calendar `/workflows/my-profile?tab=calendar`, Availability `/workflows/my-availability`, Doctor Profile `/workflows/my-profile`; Communication: WhatsApp `whatsapp.view`, Reminders `reminders.view`; Settings: Clinic Profile `clinic_profile.view`, Subscription `subscription.view`. Export `navigationFor(user, scope)` returning super_admin's block for super admins, else the clinic list filtered by `scope.can(item.perm)` and the doctor-only rule. Update `Layout.jsx` to use it; header role badge shows `roleLabel`.
- [ ] **Step 3:** `access.js`: add `MODULE_PERMISSION = { patients: 'patients', appointments: 'appointments', doctors: 'doctors', services: 'services', users: 'staff', followups: 'followups', reminders: 'reminders', whatsappConversations: 'whatsapp', whatsappAccounts: 'whatsapp', whatsappTemplates: 'whatsapp', whatsappMessages: 'whatsapp', whatsappSessions: 'whatsapp', invoices: 'billing', payments: 'billing', reviews: 'reviews', auditLogs: 'audit_logs', clinicSettings: 'clinic_settings', domains: 'clinic_settings' }`; `canAccessModule(role, key, can)` → super admin keeps current rules; clinic users → `can(\`${MODULE_PERMISSION[key]}.view\`)`; `canCreateModule(role, key, can)` → `.create`; add `canEditModule` / `canDeleteModule`. Remove the clinic role-string branches and `allowedStaffRolesForCreator` (Task 7 replaces role selects). Update every caller to pass `scope.can`.
- [ ] **Step 4:** Buttons: ModuleListPage/ViewPage Add/Edit/Delete/Block by `canCreateModule/canEditModule/canDeleteModule`; AppointmentsFlowPage + AppointmentDetailDrawer: Check-in/Start/Complete/No-show buttons need `appointments.check_in`, Cancel needs `appointments.cancel`, Reschedule needs `appointments.edit`, Prescription/Summary voice buttons need `appointments.prescribe`; PatientProfilePage note/medical-profile edits need `patients.edit`; DoctorSetupFlowPage schedule add/edit/delete need `doctor_schedules.create/edit/delete`; ClinicProfilePage edit needs `clinic_profile.edit` (replace the old `readOnly = role === 'clinic_admin'` with `readOnly = !can('clinic_profile.edit')`); ClinicSubscriptionPage Pay needs `subscription.manage` (replace `role === 'clinic_admin'`).
- [ ] **Step 5:** `App.jsx`: a `RequirePerm perm="…"` wrapper redirecting to `/dashboard`; wrap `/workflows/appointments*` (`appointments.view`), `/workflows/subscription` (`subscription.view`), `/workflows/clinic-profile` (`clinic_profile.view`), `/workflows/create-staff` (`staff.create`), `/workflows/setup-doctor` (`doctors.create`). The 402 redirect for clinic_admin becomes: when locked and `can('subscription.manage')` → redirect to subscription page; otherwise lock screen.
- [ ] **Step 6:** `DashboardPage.jsx`: choose dashboard from `me/context` `role_kind` and `role_limits_assigned_doctors` (Task 4): clinic_admin kind → clinic admin dashboard; doctor → doctor; staff with role_limits_assigned_doctors → assistant; other staff → receptionist.
- [ ] **Step 7:** `grep -rn "role === 'receptionist'\|role === 'assistant'\|role === 'clinic_admin'\|role === 'doctor'" resources/js/admin/src` → only doctor-kind or super-admin checks that read `roleKind`, none on `user.role` strings for clinic roles. Build passes; PHP suite green.
- [ ] **Step 8: Commit** `feat(roles-ui): permissions drive clinic navigation, pages and actions`

---

### Task 7: Role pickers in staff forms and the super admin Roles page

**Files:** Create `pages/workflows/RolesPage.jsx`, `components/roles/PermissionGrid.jsx`; modify `App.jsx` (route `/workflows/roles`, OnlySuperAdmin), `config/navigation.js` (super_admin Admin section: Roles), `pages/workflows/CreateStaffWizardPage.jsx`, `pages/workflows/ClinicDetailPage.jsx` (StaffTab role select), `pages/ModuleFormPage.jsx` / `config/modules.js` users form role field, `pages/workflows/SetupDoctorWizardPage.jsx` (optional doctor-kind role select, default Doctor)

**Interfaces:** `GET /super-admin/roles`, `GET /super-admin/permission-catalogue`, POST/PUT/DELETE `/super-admin/roles`, `GET /clinic/roles` (Tasks 4-5).

- [ ] **Step 1: PermissionGrid** — props `{catalogue, value: string[], onChange, readOnly}`; table rows = catalogue modules (label), columns View/Create/Edit/Delete with a checkbox only where the module has that action; a "Special" section listing specials with checkboxes; row "all" toggle; readOnly renders checks disabled.
- [ ] **Step 2: RolesPage** — list (Label, Kind badge, Users, System badge, Edit); "New role" sheet: Label, Kind (Staff / Doctor, radio; disabled for system roles), "Only see assigned doctors' patients and appointments" (staff only), Description, PermissionGrid. clinic_admin opens with "Clinic Admin always has full access." and grid read-only (all checked). Delete with inline confirm; show API messages (in use / built-in). Save → POST/PUT and refetch.
- [ ] **Step 3: Role selects** — CreateStaffWizardPage and the clinic `users` form: options from `GET /clinic/roles` (clinic users) or `GET /super-admin/roles` filtered to kinds staff/clinic_admin (super admin; plus super_admin only when no clinic is chosen — the super admin role is not in the list, so offer "Super Admin" only in the super admin's own users module when `clinic_id` is empty). Show label; send `name`. Show the assigned-doctors picker when the chosen role's `limit_to_assigned_doctors` is true. ClinicDetailPage StaffTab: same list from `/super-admin/roles`.
- [ ] **Step 4:** SetupDoctorWizardPage / doctor linked-user form: optional "Login role" select listing doctor-kind roles (default Doctor); send `linked_user.role`.
- [ ] **Step 5:** Build passes; grep `allowedStaffRolesForCreator` empty.
- [ ] **Step 6: Commit** `feat(roles-ui): role builder page and role pickers`

---

### Task 8: End-to-end verification

- [ ] `/opt/homebrew/bin/php artisan test` green, pristine.
- [ ] MySQL backup (`/Applications/MAMP/Library/bin/mysqldump` of `clinic_new` → `.superpowers/backups/clinic_new-backup-<ts>.sql`, non-empty), then `/opt/homebrew/bin/php artisan migrate:fresh --seed`. Verify `roles` has 5 system roles with kinds; `permissions` count equals `PermissionCatalogue::all()` count.
- [ ] Serve on 8010 (a server may already run on 8000 — leave it). Browser pass (Playwright): super admin → Admin → Roles: create "Front Desk Lead" (staff) with patients view/create and appointments view/create/check-in; demo clinic admin → Staff Users → add a user with that role; log in as that user → sidebar shows only Appointments + Patients; patients list works; Staff Users page redirects to dashboard; an appointment's Cancel button is hidden; super admin removes patients.create from the role → the user's "Add patient" disappears after reload and the API returns 403.
- [ ] Fix-ups only if something fails (with a regression test); commit.
