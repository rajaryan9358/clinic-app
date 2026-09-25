# Remove the Branch System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clinic is a single location; every branch table, column, role, route, service and screen is removed.

**Architecture:** Edit the original migrations (no live data) and rebuild with `migrate:fresh --seed`. Location fields move to `clinics`, branch settings merge into `clinic_settings`, and scoping falls back to the existing `clinic_id` tenant scope. The React admin loses every branch selector, header, page and tab.

**Tech Stack:** Laravel 13 (PHP 8.4 at `/opt/homebrew/bin/php`), Sanctum, spatie/laravel-permission, MySQL (MAMP, port 8889) for dev, SQLite in-memory for tests, React 19 + Vite + Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-25-remove-branches-design.md`

## Global Constraints

- `php` is not on PATH. Always run `/opt/homebrew/bin/php`. Alias for this plan: `PHP=/opt/homebrew/bin/php`.
- Roles after this change: `super_admin`, `clinic_admin`, `doctor`, `receptionist`, `assistant`. No `branch_manager` anywhere.
- New `clinics` columns (all nullable): `address_line_1`, `address_line_2`, `city`, `state`, `pincode`, `latitude decimal(10,7)`, `longitude decimal(10,7)`, `phone varchar(20)`, `email`.
- New `clinic_settings` columns: `walkin_enabled bool default true`, `token_system_enabled bool default false`, `max_advance_booking_days uint default 30`, `min_booking_notice_minutes uint default 30`.
- Booking-window limits are stored, not enforced in `getDoctorAvailability`.
- Final grep gate: `grep -rinE "branch" app database routes resources/js/admin/src resources/views config` returns nothing.
- Follow existing code style: controllers use `ApiResponse` (`$this->success(...)`, `$this->error(...)`); React uses Tailwind utility classes and the existing `TextInput`/`Toggle`/`Field` helpers in each page.
- Commit after every task on branch `remove-branches`. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Receptionist/assistant requests after the branch block is removed.** They must still be limited to their own `clinic_id` and get 200, not 403 "No branches assigned". Test: Task 4 `ClinicContextTest`.
2. **Doctor schedules created before and after.** A schedule row with no `branch_id` must produce slots. Test: Task 3 `DoctorAvailabilityTest`.
3. **Clients that still send `branch_id` or `X-Branch-Id`.** An old tab or a cached bundle may send them. Requests must succeed and ignore them, not 500 on an unknown column. Test: Task 4 `ClinicContextTest::test_stale_branch_header_and_param_are_ignored`.
4. **Onboarding payloads.** The super admin wizard must create clinic + settings + admin in one call with location fields persisted. Test: Task 2 `ClinicCreationTest`.
5. **Fresh schema on MySQL.** Dropped FK columns and renamed indexes must build cleanly on MySQL, not just SQLite. Check: Task 5 step "migrate:fresh --seed on MySQL".

---

## File Structure

**Delete (backend)**
- `app/Models/Branch.php`, `app/Models/BranchSetting.php`, `app/Models/UserBranchMap.php`, `app/Models/DoctorBranchMap.php`
- `app/Services/BranchService.php`
- `app/Http/Controllers/Api/Clinic/BranchController.php`, `.../Clinic/BranchSettingController.php`, `.../SuperAdmin/BranchController.php`, `.../SuperAdmin/BranchSettingController.php`
- `app/Http/Requests/StoreBranchRequest.php`, `app/Http/Requests/UpdateBranchRequest.php`
- `database/migrations/2026_04_09_001000_create_branch_service_map_table.php`
- `database/migrations/2026_04_13_000100_drop_timezone_currency_from_clinics.php` (drops a `timezone` column no migration creates; breaks `migrate:fresh`)

**Delete (frontend)**
- `resources/js/admin/src/pages/workflows/BranchProfilePage.jsx`, `.../CreateBranchWizardPage.jsx`

**Create (tests)**
- `tests/Feature/NoBranchSchemaTest.php`, `tests/Feature/ClinicCreationTest.php`, `tests/Feature/DoctorAvailabilityTest.php`, `tests/Feature/ClinicContextTest.php`

**Modify**: every other file returned by `grep -rli branch app database routes resources config`.

---

### Task 1: Schema without branches

**Files:**
- Modify: `database/migrations/0001_01_01_000000_create_users_table.php`, `2026_03_29_000100_create_clinic_core_tables.php`, `2026_03_29_000200_create_doctors_and_services_tables.php`, `2026_03_29_000300_create_patient_tables.php`, `2026_03_29_000400_create_appointments_and_followups_tables.php`, `2026_03_29_000500_create_whatsapp_tables.php`, `2026_03_29_000600_create_settings_billing_and_logs_tables.php`, `2026_03_29_100000_add_updated_at_to_pivot_maps.php`, `2026_03_30_000100_create_reviews_table.php`
- Delete: `2026_04_09_001000_create_branch_service_map_table.php`, `2026_04_13_000100_drop_timezone_currency_from_clinics.php`
- Modify: `tests/Feature/ExampleTest.php`
- Test: `tests/Feature/NoBranchSchemaTest.php`

**Interfaces:**
- Produces: the schema listed in Global Constraints. No table has a `branch_id` column; tables `branches`, `branch_settings`, `user_branch_map`, `doctor_branch_map`, `branch_service_map` do not exist.

- [ ] **Step 1: Write the failing test**

```php
<?php
// tests/Feature/NoBranchSchemaTest.php
namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class NoBranchSchemaTest extends TestCase
{
    use RefreshDatabase;

    public function test_branch_tables_do_not_exist(): void
    {
        foreach (['branches', 'branch_settings', 'user_branch_map', 'doctor_branch_map', 'branch_service_map'] as $table) {
            $this->assertFalse(Schema::hasTable($table), "{$table} should not exist");
        }
    }

    public function test_no_table_has_a_branch_id_column(): void
    {
        $tables = array_map(fn ($t) => $t['name'], Schema::getTables());
        foreach ($tables as $table) {
            $this->assertFalse(Schema::hasColumn($table, 'branch_id'), "{$table}.branch_id should not exist");
        }
    }

    public function test_clinics_have_location_fields_and_settings_have_booking_fields(): void
    {
        $this->assertTrue(Schema::hasColumns('clinics', [
            'address_line_1', 'address_line_2', 'city', 'state', 'pincode', 'latitude', 'longitude', 'phone', 'email',
        ]));
        $this->assertTrue(Schema::hasColumns('clinic_settings', [
            'walkin_enabled', 'token_system_enabled', 'max_advance_booking_days', 'min_booking_notice_minutes',
        ]));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/opt/homebrew/bin/php artisan test --filter=NoBranchSchemaTest`
Expected: FAIL. Before the timezone migration is deleted, the error is `no such column: "timezone"`; after that, assertions like `branches should not exist` fail.

- [ ] **Step 3: Edit migrations**

1. `git rm database/migrations/2026_04_09_001000_create_branch_service_map_table.php database/migrations/2026_04_13_000100_drop_timezone_currency_from_clinics.php`
2. `0001_01_01_000000_create_users_table.php`: role enum becomes
   ```php
   $table->enum('role', ['super_admin', 'clinic_admin', 'doctor', 'receptionist', 'assistant']);
   ```
3. `2026_03_29_000100_create_clinic_core_tables.php`:
   - In `clinics`, after `owner_email`, add:
     ```php
     $table->string('address_line_1')->nullable();
     $table->string('address_line_2')->nullable();
     $table->string('city')->nullable();
     $table->string('state')->nullable();
     $table->string('pincode')->nullable();
     $table->decimal('latitude', 10, 7)->nullable();
     $table->decimal('longitude', 10, 7)->nullable();
     $table->string('phone', 20)->nullable();
     $table->string('email')->nullable();
     ```
   - Delete the whole `Schema::create('branches', ...)` block and the `Schema::create('user_branch_map', ...)` block.
   - In `domains`, delete the `branch_id` line.
   - In `down()`, delete `dropIfExists('user_branch_map')` and `dropIfExists('branches')`.
4. `2026_03_29_000200_create_doctors_and_services_tables.php`: delete the `doctor_branch_map` create block and its `dropIfExists`; in `doctor_schedules` delete the `branch_id` line and `$table->index(['clinic_id', 'branch_id'], 'ds_clinic_branch_idx');`; in `doctor_schedule_exceptions` delete the `branch_id` line.
5. `2026_03_29_000300_create_patient_tables.php`: in `patients` delete the `branch_id` line and `$table->index(['clinic_id', 'branch_id']);`; in `patient_notes` delete the `branch_id` line.
6. `2026_03_29_000400_create_appointments_and_followups_tables.php`: in `appointments` delete the `branch_id` line and replace the index with
   ```php
   $table->index(['clinic_id', 'appointment_date'], 'appt_clinic_date_idx');
   ```
   In `followup_tasks` delete the `branch_id` line.
7. `2026_03_29_000500_create_whatsapp_tables.php`: delete the five `branch_id` lines.
8. `2026_03_29_000600_create_settings_billing_and_logs_tables.php`:
   - In `clinic_settings`, after `default_slot_duration_minutes`, add:
     ```php
     $table->boolean('walkin_enabled')->default(true);
     $table->boolean('token_system_enabled')->default(false);
     $table->unsignedInteger('max_advance_booking_days')->default(30);
     $table->unsignedInteger('min_booking_notice_minutes')->default(30);
     ```
   - Delete the `branch_settings` create block and its `dropIfExists`.
   - Delete the `branch_id` lines in `invoices`, `audit_logs`, `file_uploads`.
9. `2026_03_29_100000_add_updated_at_to_pivot_maps.php`: delete the `user_branch_map` and `doctor_branch_map` blocks in `up()` and `down()`. If no other table remains in the file, `git rm` it.
10. `2026_03_30_000100_create_reviews_table.php`: delete the `branch_id` line; index becomes `$table->index(['clinic_id', 'review_date']);`.

- [ ] **Step 4: Fix the pre-existing ExampleTest (it asserts 200 on `/`, which redirects)**

```php
public function test_the_application_returns_a_successful_response(): void
{
    $this->get('/')->assertRedirect('/admin/login');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `/opt/homebrew/bin/php artisan test --filter='NoBranchSchemaTest|ExampleTest'`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add -A database/migrations tests/Feature/NoBranchSchemaTest.php tests/Feature/ExampleTest.php
git commit -m "refactor(db): remove branch tables and columns; move location and booking settings to clinic"
```

---

### Task 2: Models, roles, and clinic creation

**Files:**
- Delete: `app/Models/Branch.php`, `app/Models/BranchSetting.php`, `app/Models/UserBranchMap.php`, `app/Models/DoctorBranchMap.php`
- Modify: `app/Enums/UserRole.php`, `app/Models/Clinic.php`, `app/Models/ClinicSetting.php`, `app/Models/User.php`, `app/Models/Doctor.php`, `app/Models/Service.php`, and every model with `branch_id` in `$fillable` or a `branch()` relation (`Appointment`, `AuditLog`, `DoctorSchedule`, `DoctorScheduleException`, `Domain`, `FileUpload`, `FollowupTask`, `Invoice`, `Patient`, `PatientNote`, `Review`, `WhatsappAccount`, `WhatsappConversation`, `WhatsappFlowSession`, `WhatsappMessage`, `WhatsappTemplate`)
- Modify: `app/Services/ClinicCreationService.php`, `app/Services/AuditLogService.php`, `app/Http/Requests/StoreClinicRequest.php`, `app/Http/Requests/UpdateClinicRequest.php`, `database/seeders/RolesAndPermissionsSeeder.php`, `database/seeders/DemoClinicSeeder.php`
- Test: `tests/Feature/ClinicCreationTest.php`

**Interfaces:**
- Consumes: Task 1 schema.
- Produces: `ClinicCreationService::create(array $data, ?int $actorUserId = null): Clinic`. `$data` holds clinic columns (including the location fields) plus optional `clinic_admin` (`full_name`, `email`, `phone`, `password`), optional `settings` (any `clinic_settings` columns) and optional `domain` (`host`, `type`, `is_primary`, `status`). `main_branch` is no longer accepted.

- [ ] **Step 1: Write the failing test**

```php
<?php
// tests/Feature/ClinicCreationTest.php
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
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/opt/homebrew/bin/php artisan test --filter=ClinicCreationTest`
Expected: FAIL. `city` is not in `Clinic::$fillable` so it is null, and the `branch_manager` enum case still exists.

- [ ] **Step 3: Implement**

1. `git rm app/Models/Branch.php app/Models/BranchSetting.php app/Models/UserBranchMap.php app/Models/DoctorBranchMap.php`
2. `app/Enums/UserRole.php`: delete `case BRANCH_MANAGER = 'branch_manager';`.
3. `app/Models/Clinic.php`: add to `$fillable` after `owner_email`:
   ```php
   'address_line_1', 'address_line_2', 'city', 'state', 'pincode', 'latitude', 'longitude', 'phone', 'email',
   ```
   Delete the `branches()` relation and any `use App\Models\Branch;`.
4. `app/Models/ClinicSetting.php`: `$fillable` gains `'walkin_enabled', 'token_system_enabled', 'max_advance_booking_days', 'min_booking_notice_minutes'`; `casts()` gains `'walkin_enabled' => 'boolean', 'token_system_enabled' => 'boolean', 'max_advance_booking_days' => 'integer', 'min_booking_notice_minutes' => 'integer'`.
5. `app/Models/User.php`: delete the `branches()` relation (the `belongsToMany(Branch::class, 'user_branch_map')` with `withPivot(['clinic_id', 'is_default'])`) and its import. Keep `assignedDoctors()`.
6. `app/Models/Doctor.php`, `app/Models/Service.php`: delete the branch relations (`branches()` via `doctor_branch_map` / `branch_service_map`) and imports.
7. For each remaining model listed under **Files**, remove `'branch_id'` from `$fillable` and delete any `branch()` method and `Branch` import. Verify: `grep -n -i branch app/Models` prints nothing.
8. `app/Services/ClinicCreationService.php`: replace the body of `create` with:
   ```php
   return DB::transaction(function () use ($data, $actorUserId) {
       $clinicData = collect($data)->except(['clinic_admin', 'settings', 'domain'])->all();

       $trialEndsAt = null;
       $trialEnabled = SystemSetting::query()->where('key', 'trial_enabled')->first();
       if (! $trialEnabled || $trialEnabled->value !== '0') {
           $trialDaysSetting = SystemSetting::query()->where('key', 'trial_days')->first();
           $trialDays = $trialDaysSetting ? (int) $trialDaysSetting->value : 14;
           $trialEndsAt = now()->addDays($trialDays);
       }

       $clinic = Clinic::create([
           ...$clinicData,
           'uuid' => (string) Str::uuid(),
           'trial_ends_at' => $trialEndsAt,
       ]);

       if (! empty($data['clinic_admin'])) {
           $admin = User::create([
               'clinic_id' => $clinic->id,
               'uuid' => (string) Str::uuid(),
               'full_name' => $data['clinic_admin']['full_name'],
               'email' => $data['clinic_admin']['email'] ?? null,
               'phone' => $data['clinic_admin']['phone'] ?? null,
               'password' => Hash::make($data['clinic_admin']['password']),
               'role' => 'clinic_admin',
               'status' => 'active',
               'login_type' => 'password',
           ]);

           $admin->assignRole('clinic_admin');
       }

       ClinicSetting::firstOrCreate(
           ['clinic_id' => $clinic->id],
           [...($data['settings'] ?? []), 'clinic_id' => $clinic->id]
       );

       if (! empty($data['domain'])) {
           Domain::create([...$data['domain'], 'clinic_id' => $clinic->id]);
       }

       $this->auditLogService->log(
           module: 'clinics',
           entityType: Clinic::class,
           entityId: $clinic->id,
           action: 'create',
           clinicId: $clinic->id,
           userId: $actorUserId,
           newValues: $clinic->toArray(),
       );

       return $clinic;
   });
   ```
   Remove the `Branch` and `BranchSetting` imports.
9. `StoreClinicRequest` / `UpdateClinicRequest`: remove every `main_branch.*` rule. Add:
   ```php
   'address_line_1' => ['nullable', 'string', 'max:255'],
   'address_line_2' => ['nullable', 'string', 'max:255'],
   'city' => ['nullable', 'string', 'max:120'],
   'state' => ['nullable', 'string', 'max:120'],
   'pincode' => ['nullable', 'string', 'max:20'],
   'latitude' => ['nullable', 'numeric', 'between:-90,90'],
   'longitude' => ['nullable', 'numeric', 'between:-180,180'],
   'phone' => ['nullable', 'string', 'max:20'],
   'email' => ['nullable', 'email', 'max:255'],
   ```
   `StoreClinicRequest` also gets:
   ```php
   'settings' => ['nullable', 'array'],
   'settings.booking_enabled' => ['nullable', 'boolean'],
   'settings.walkin_enabled' => ['nullable', 'boolean'],
   'settings.token_system_enabled' => ['nullable', 'boolean'],
   'settings.max_advance_booking_days' => ['nullable', 'integer', 'min:0', 'max:365'],
   'settings.min_booking_notice_minutes' => ['nullable', 'integer', 'min:0', 'max:10080'],
   ```
   Remove any `domain.branch_id` rule.
10. `RolesAndPermissionsSeeder`: remove `'branches'` from `$modules` and `'branch_manager'` from `$roles` plus its permission block.
11. `app/Services/AuditLogService.php`: delete the `?int $branchId = null,` parameter (line ~17) and the `'branch_id' => $branchId,` key (line ~25). Find callers passing `branchId:` with `grep -rn "branchId:" app` and delete that named argument.
12. `DemoClinicSeeder`: replace the `main_branch` array with top-level clinic location keys (move its `address_line_1`, `city`, `state`, `pincode`, `phone`, `email` up into the clinic array). Remove any other branch references.

- [ ] **Step 4: Run tests to verify they pass**

Run: `/opt/homebrew/bin/php artisan test --filter='ClinicCreationTest|NoBranchSchemaTest'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A app/Models app/Enums app/Services/ClinicCreationService.php app/Services/AuditLogService.php app/Http/Requests/StoreClinicRequest.php app/Http/Requests/UpdateClinicRequest.php database/seeders tests/Feature/ClinicCreationTest.php
git commit -m "refactor: drop branch models and branch_manager role; clinic creation without branches"
```

---

### Task 3: Doctor availability without branches

**Files:**
- Modify: `app/Services/AppointmentService.php` (`getDoctorAvailability` at ~line 57; `branch_id` uses at ~297 and ~410)
- Modify: `app/Http/Controllers/Api/Clinic/AppointmentController.php` (`availability` ~line 179; any other `branch_id` rule), `app/Http/Controllers/Api/SuperAdmin/AppointmentController.php` (`availability` ~line 140), `app/Http/Requests/StoreAppointmentRequest.php`
- Test: `tests/Feature/DoctorAvailabilityTest.php`

**Interfaces:**
- Consumes: Task 1 schema, Task 2 models.
- Produces: `AppointmentService::getDoctorAvailability(int $clinicId, int $doctorId, string $fromDate, string $toDate, ?int $excludeAppointmentId = null): array`. `GET /api/clinic/appointments/availability` takes `doctor_id`, `from_date`, `to_date`, optional `exclude_appointment_id`.

- [ ] **Step 1: Write the failing test**

```php
<?php
// tests/Feature/DoctorAvailabilityTest.php
namespace Tests\Feature;

use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Services\AppointmentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Tests\TestCase;

class DoctorAvailabilityTest extends TestCase
{
    use RefreshDatabase;

    public function test_schedule_without_branch_produces_slots(): void
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
        $doctor = Doctor::create(['clinic_id' => $clinic->id, 'full_name' => 'Dr A', 'slot_duration_minutes' => 30]);

        $date = Carbon::now()->addDays(2)->startOfDay();
        DoctorSchedule::create([
            'clinic_id' => $clinic->id,
            'doctor_id' => $doctor->id,
            'day_of_week' => $date->dayOfWeek,
            'start_time' => '10:00:00',
            'end_time' => '11:00:00',
            'consultation_mode' => 'in_person',
            'is_active' => true,
        ]);

        $days = app(AppointmentService::class)->getDoctorAvailability(
            $clinic->id, $doctor->id, $date->toDateString(), $date->toDateString()
        );

        $this->assertCount(1, $days);
        $this->assertSame(['10:00', '10:30'], array_map(
            fn ($s) => substr($s['start_time'], 0, 5),
            $days[0]['slots']
        ));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/opt/homebrew/bin/php artisan test --filter=DoctorAvailabilityTest`
Expected: FAIL with a `TypeError`: argument 3 must be of type int, string given.

- [ ] **Step 3: Implement**

1. In `getDoctorAvailability`, change the signature to
   ```php
   public function getDoctorAvailability(int $clinicId, int $doctorId, string $fromDate, string $toDate, ?int $excludeAppointmentId = null): array
   ```
   Delete `->where('branch_id', $branchId)` from the `DoctorSchedule` query and from the `Appointment` query. Delete the whole `->where(function ($q) use ($branchId) { ... })` from the exceptions query.
2. At ~line 297 (patient creation inside appointment creation) delete `'branch_id' => $data['patient']['branch_id'] ?? null,`. At ~line 410 (overlap check on reschedule) delete `->where('branch_id', $appointment->branch_id)`. Remove every other `branch_id` in this file (`grep -n branch app/Services/AppointmentService.php` must print nothing).
3. Both `availability` controller methods: delete `'branch_id' => ['required', 'integer'],` and the `(int) $data['branch_id'],` argument.
4. In both AppointmentControllers and `StoreAppointmentRequest`, delete every `branch_id` validation rule, filter (`$request->filled('branch_id')`), eager-load (`'branch'`, `'branch:id,name'`) and assignment.

- [ ] **Step 4: Run tests to verify they pass**

Run: `/opt/homebrew/bin/php artisan test --filter=DoctorAvailabilityTest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Services/AppointmentService.php app/Http/Controllers/Api/Clinic/AppointmentController.php app/Http/Controllers/Api/SuperAdmin/AppointmentController.php app/Http/Requests/StoreAppointmentRequest.php tests/Feature/DoctorAvailabilityTest.php
git commit -m "refactor(appointments): availability and booking without branch"
```

---

### Task 4: Request scoping without branches

**Files:**
- Modify: `app/Http/Middleware/ResolveClinicContext.php`, `app/Http/Controllers/Api/Clinic/BaseClinicCrudController.php` (lines ~87-107), `app/Http/Controllers/Api/Clinic/MeController.php`, `app/Http/Controllers/Api/Clinic/PatientController.php` (lines 13, 19)
- Test: `tests/Feature/ClinicContextTest.php`

**Interfaces:**
- Consumes: Task 2 `UserRole` without `BRANCH_MANAGER`.
- Produces: `GET /api/clinic/me/context` returns `role`, `active_doctor_id`, `allowed_doctors`, `clinic_id`, `clinic_name`, `clinic_logo_url`, `clinic_status`, `clinic_trial_ends_at`. No branch keys. The request attributes `allowed_branch_ids` and `active_branch_id` are no longer set.

- [ ] **Step 1: Write the failing test**

```php
<?php
// tests/Feature/ClinicContextTest.php
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
        Patient::create(['clinic_id' => $mine->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Own Patient', 'phone' => '9000000001']);
        Patient::create(['clinic_id' => $other->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Other Patient', 'phone' => '9000000002']);
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
```

Before running, check the required columns on `patients` (`sed -n 8,50p database/migrations/2026_03_29_000300_create_patient_tables.php`). If any non-nullable column without a default is missing from the `Patient::create` calls above, add it to both calls with a plain value.

- [ ] **Step 2: Run test to verify it fails**

Run: `/opt/homebrew/bin/php artisan test --filter=ClinicContextTest`
Expected: FAIL. The middleware queries `$user->branches()`, which no longer exists after Task 2, so the requests return 500.

- [ ] **Step 3: Implement**

1. `ResolveClinicContext`: delete the whole `// Branch-scoped roles` `if (in_array($user->role, [...BRANCH_MANAGER...]))` block. Keep the doctor and assistant blocks unchanged.
2. `BaseClinicCrudController`: delete the `$allowedBranchIds` / `$activeBranchId` reads and both `if` blocks that filter `branches` and `branch_id` (lines ~87-107). If the method is now empty apart from clinic scoping, leave the clinic scoping as is.
3. `MeController::context`: delete the `use App\Models\Branch;` import, the `$allowedBranchIds`/`$activeBranchId`/`$branches` code, and the `'active_branch_id'` and `'allowed_branches'` response keys.
4. `Clinic/PatientController.php`: `$filterable` becomes `['status_tag', 'preferred_doctor_id']`; delete the `'branch:id,name',` eager-load.
5. Search the rest of the base CRUD layer: `grep -n -i branch app/Http/Controllers/Api/BaseCrudController.php app/Http/Controllers/Api/Clinic/BaseClinicCrudController.php app/Traits/BelongsToClinicScope.php`. Remove any hit (for example a `branch_id` filterable column).

- [ ] **Step 4: Run tests to verify they pass**

Run: `/opt/homebrew/bin/php artisan test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Http/Middleware/ResolveClinicContext.php app/Http/Controllers/Api/Clinic/BaseClinicCrudController.php app/Http/Controllers/Api/Clinic/MeController.php app/Http/Controllers/Api/Clinic/PatientController.php app/Http/Controllers/Api/BaseCrudController.php app/Traits tests/Feature/ClinicContextTest.php
git commit -m "refactor(auth): clinic-only request scoping, no branch context"
```

---

### Task 5: Remove remaining backend branch code

**Files:**
- Delete: `app/Services/BranchService.php`, `app/Http/Controllers/Api/Clinic/BranchController.php`, `app/Http/Controllers/Api/Clinic/BranchSettingController.php`, `app/Http/Controllers/Api/SuperAdmin/BranchController.php`, `app/Http/Controllers/Api/SuperAdmin/BranchSettingController.php`, `app/Http/Requests/StoreBranchRequest.php`, `app/Http/Requests/UpdateBranchRequest.php`
- Modify: `routes/api.php`, and every remaining hit of `grep -rli branch app resources/views database config`. Expected hits: Clinic + SuperAdmin `DoctorController`, `DoctorProfileController`, `ServiceController`, `UserController`, `DashboardController`, `ReviewController`, `PatientProfileController`, `PatientController`, `ReportController`, `WhatsappAccountController`, `WhatsappTemplateController`, `WhatsappMessageController`, `WhatsappFlowSessionController`, `WhatsappConversationController`, `DomainController`, `InvoiceController`, `FollowupTaskController`, `AuditLogController`, `UploadController`; `ClinicSettingController` (both); `UserManagementService`, `DoctorManagementService`, `AuditLogService`, `ReviewAiService` if hit; `app/Http/Requests/Clinic/StoreClinicUserRequest.php`, `UpdateClinicUserRequest.php`, `StoreUserRequest.php`, `UpdateUserRequest.php`, `StoreDoctorRequest.php`; `resources/views/reports/*.blade.php`.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: no route contains `branch`. `settings/clinic` accepts and returns the four merged settings.

- [ ] **Step 1: Delete files and routes**

```bash
git rm app/Services/BranchService.php \
  app/Http/Controllers/Api/Clinic/BranchController.php app/Http/Controllers/Api/Clinic/BranchSettingController.php \
  app/Http/Controllers/Api/SuperAdmin/BranchController.php app/Http/Controllers/Api/SuperAdmin/BranchSettingController.php \
  app/Http/Requests/StoreBranchRequest.php app/Http/Requests/UpdateBranchRequest.php
```

In `routes/api.php` delete the four `use ...Branch...Controller` imports and these lines:
```php
registerCrudRoutes('branches', SuperAdminBranchController::class);
Route::put('services/{id}/branches', [SuperAdminServiceController::class, 'syncBranches']);
registerCrudRoutes('settings/branch', SuperAdminBranchSettingController::class);
registerCrudRoutes('branches', ClinicBranchController::class);
registerCrudRoutes('settings/branch', ClinicBranchSettingController::class);
```
Delete the `syncBranches` method from `SuperAdmin/ServiceController`.

- [ ] **Step 2: Strip branch code from every remaining file**

For each file from `grep -rli branch app resources/views database config`, apply these rules:
- Validation: delete `branch_id`, `branch_ids`, `branch_ids.*`, `main_branch.*` rules. Delete `branch_manager` from any `Rule::in([...])` role list.
- Queries: delete `->where('branch_id', ...)`, `->whereIn('branch_id', ...)`, `when($request->branch_id, ...)` and `with(['branch' ...])` / `'branch:id,name'` eager-loads.
- Writes: delete `'branch_id' => ...` keys; delete `->branches()->sync(...)` / `UserBranchMap::` / `DoctorBranchMap::` calls.
- Role hierarchy (`UserManagementService`, Clinic `UserController`): remove `branch_manager` from creator/creatable maps. Clinic admin may create `receptionist` and `assistant`; super admin may create `super_admin`, `clinic_admin`, `receptionist`, `assistant`.
- Dashboards: delete per-branch counts or groupings; any `branch_manager` dashboard branch is removed.
- `ClinicSettingController` (both): add the four fields to validation:
  ```php
  'walkin_enabled' => ['sometimes', 'boolean'],
  'token_system_enabled' => ['sometimes', 'boolean'],
  'max_advance_booking_days' => ['sometimes', 'integer', 'min:0', 'max:365'],
  'min_booking_notice_minutes' => ['sometimes', 'integer', 'min:0', 'max:10080'],
  ```
- Blade reports: delete branch columns and header lines; where the header showed the branch address, show `$clinic->address_line_1`, `$clinic->city` and `$clinic->phone` instead (the controller already passes the clinic; if not, pass `Clinic::find($clinicId)` as `$clinic`).

- [ ] **Step 3: Grep gate (backend)**

Run: `grep -rinE "branch" app routes resources/views database config`
Expected: no output.

- [ ] **Step 4: Routes load and tests pass**

Run: `/opt/homebrew/bin/php artisan route:list --path=api | grep -ci branch ; /opt/homebrew/bin/php artisan test`
Expected: `0`, then all tests PASS.

- [ ] **Step 5: migrate:fresh --seed on MySQL (dev DB)**

Start MAMP MySQL first. Then:
Run: `/opt/homebrew/bin/php artisan migrate:fresh --seed`
Expected: every migration `DONE`, seeders complete, no SQL error.

- [ ] **Step 6: Commit**

```bash
git add -A app routes resources/views database config
git commit -m "refactor(api): remove branch controllers, routes, and branch fields from all endpoints"
```

---

### Task 6: Frontend shell (client, context, nav, access, routes)

**Files:**
- Delete: `resources/js/admin/src/pages/workflows/BranchProfilePage.jsx`, `resources/js/admin/src/pages/workflows/CreateBranchWizardPage.jsx`
- Modify: `resources/js/admin/src/api/client.js`, `context/ScopeContext.jsx`, `components/Layout.jsx`, `config/navigation.js`, `config/access.js`, `config/modules.js`, `App.jsx`, `components/AppIcon.jsx` (only if the `building` icon is now unused)

**Interfaces:**
- Produces: `config/access.js` no longer exports `isAutoBranchRole`. `allowedStaffRolesForCreator('super_admin')` returns `['super_admin', 'clinic_admin', 'receptionist', 'assistant']`; for `'clinic_admin'` it returns `['receptionist', 'assistant']`. The `modules` object has no `branches` or `branchSettings` key.

- [ ] **Step 1: Implement**

1. `git rm` the two pages. In `App.jsx` delete their imports and the `/workflows/create-branch` and `/workflows/branch-profile` routes.
2. `api/client.js`: delete the `active_branch_id` read and the `X-Branch-Id` header lines (~16-19).
3. `ScopeContext.jsx`: delete both `localStorage.setItem('active_branch_id', ...)` / `removeItem('active_branch_id')` lines and any exposed branch setter or value.
4. `Layout.jsx`: delete the branch switcher, branch labels and `allowed_branches` usage. Keep the doctor switcher.
5. `navigation.js`: delete the whole `branch_manager: [...]` block. In `clinic_admin` → `Clinic` section, delete `moduleItem('branches')`.
6. `access.js`:
   - `SUPER_ADMIN_HIDDEN_MODULE_KEYS` / `NON_CREATABLE_MODULE_KEYS`: remove `'branchSettings'`.
   - `canCreateModule`: delete the `// Branches` block.
   - `canAccessModule`: delete the `branch_manager` block; in the clinic_admin exclusion list keep `['clinics', 'domains', 'auditLogs', 'followups']`.
   - Delete `isAutoBranchRole`.
   - `allowedStaffRolesForCreator`:
     ```js
     if (r === 'super_admin') return ['super_admin', 'clinic_admin', 'receptionist', 'assistant'];
     if (r === 'clinic_admin') return ['receptionist', 'assistant'];
     return [];
     ```
7. `modules.js`: delete the `branches` and `branchSettings` module definitions and every `branch_id` field, column and filter in the other module definitions. Add the four settings fields to the `clinicSettings` module form, copying the style of its existing `booking_enabled` field (`walkin_enabled` and `token_system_enabled` as booleans; `max_advance_booking_days` and `min_booking_notice_minutes` as numbers).
8. Fix every import of `isAutoBranchRole`: `grep -rn isAutoBranchRole resources/js/admin/src`. At each call site, delete the branch-specific branch of the logic.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds. Unresolved imports of deleted pages or `isAutoBranchRole` fail here; fix them.

- [ ] **Step 3: Commit**

```bash
git add -A resources/js/admin/src
git commit -m "refactor(admin-ui): remove branch header, context, nav, access rules and pages"
```

---

### Task 7: Super admin screens (onboarding wizard, clinic detail)

**Files:**
- Modify: `resources/js/admin/src/pages/workflows/OnboardClinicWizardPage.jsx`, `resources/js/admin/src/pages/workflows/ClinicDetailPage.jsx`

**Interfaces:**
- Consumes: `POST /api/super-admin/clinics` payload from Task 2 (clinic fields + `settings` + `clinic_admin`); `settings/clinic` fields from Task 5.

- [ ] **Step 1: Onboarding wizard → two steps**

1. `STEPS` becomes `[{ num: 1, label: 'Clinic' }, { num: 2, label: 'Admin' }]`.
2. Delete the `branch` state (~line 80), the Step 2 Branch JSX block (~390-453) and its submit handler. Clinic-step state gains `address_line_1`, `address_line_2`, `city`, `state`, `pincode`, `phone`, `email` (all `''`) and `walkin_enabled: true`, `token_system_enabled: false`, `max_advance_booking_days: 30`, `min_booking_notice_minutes: 30`.
3. Step 1 JSX gets an "Address and contact" group with `TextInput`s for the seven location/contact fields (same markup as the existing clinic fields), and a "Booking" group reusing the four toggles/number inputs from the removed branch step, bound to the new names.
4. The Admin step (now step 2) submits:
   ```js
   {
     ...clinicFields, // name, legal_name, slug, owner_*, logo_url, colours, address/contact fields
     settings: {
       walkin_enabled: clinic.walkin_enabled,
       token_system_enabled: clinic.token_system_enabled,
       max_advance_booking_days: Number(clinic.max_advance_booking_days) || 30,
       min_booking_notice_minutes: Number(clinic.min_booking_notice_minutes) || 0,
     },
     clinic_admin: { full_name, email, phone, password },
   }
   ```
   Back button on step 2 goes to step 1.

- [ ] **Step 2: Clinic detail page**

1. `TABS`: delete `{ key: 'branches', ... }`. Delete the `BranchesTab` component (~466-705) and its render case.
2. `DomainsTab`, `DoctorsTab`, `ServicesTab`, `StaffTab`: delete branch selects, the `branches` fetches (`/branches?clinic_id=`), branch columns and `branch_id`/`branch_ids` in payloads. `StaffTab` role options: `clinic_admin`, `receptionist`, `assistant`.
3. `SettingsTab`: add `walkin_enabled` and `token_system_enabled` to the toggle list (`{ key: 'walkin_enabled', label: 'Walk-in appointments' }`, `{ key: 'token_system_enabled', label: 'Token system' }`), and two number `Field`s: "Max advance booking (days)" → `max_advance_booking_days`, "Min booking notice (minutes)" → `min_booking_notice_minutes`. Include them in the save payload.
4. Clinic edit form (Overview → edit): add the seven address/contact fields.

- [ ] **Step 3: Build and grep**

Run: `npm run build && grep -in branch resources/js/admin/src/pages/workflows/OnboardClinicWizardPage.jsx resources/js/admin/src/pages/workflows/ClinicDetailPage.jsx`
Expected: build succeeds; grep prints nothing.

- [ ] **Step 4: Commit**

```bash
git add resources/js/admin/src/pages/workflows/OnboardClinicWizardPage.jsx resources/js/admin/src/pages/workflows/ClinicDetailPage.jsx
git commit -m "feat(admin-ui): two-step clinic onboarding and clinic settings without branches"
```

---

### Task 8: Remaining admin pages and components

**Files:**
- Modify: `resources/js/admin/src/pages/ModuleFormPage.jsx`, `ModuleListPage.jsx`, `ModuleViewPage.jsx`, `DashboardPage.jsx`, `components/FormRenderer.jsx`, `components/DataTable.jsx`, `components/RecordDialog.jsx`, `components/AppointmentDetailDrawer.jsx`, `pages/workflows/AppointmentsFlowPage.jsx`, `DoctorSetupFlowPage.jsx`, `DoctorAvailabilityPage.jsx`, `SetupDoctorWizardPage.jsx`, `CreateStaffWizardPage.jsx`, `PatientProfilePage.jsx`, `MyDoctorProfilePage.jsx`

**Interfaces:**
- Consumes: availability API without `branch_id` (Task 3); `me/context` without branch keys (Task 4); `settings/clinic` with `max_advance_booking_days` (Task 5).

- [ ] **Step 1: Implement**

For each file, apply these rules:
- Remove `branch_id` / `branch_ids` form fields, default values, select options, `/branches` fetches, table columns, filters and query params (`params: { branch_id }`).
- Availability calls: drop `branch_id` from the params object.
- `DoctorSetupFlowPage` (~405-425): the calendar limit currently reads `max_advance_booking_days` from branch settings. Read it from `GET ${base}/settings/clinic` (first row's `max_advance_booking_days`) and keep the fallback of 30.
- Doctor schedules/exceptions forms: no branch picker; payload omits `branch_id`.
- `DashboardPage`: remove the `branch_manager` role branch and any branch labels.
- `CreateStaffWizardPage`: roles come from `allowedStaffRolesForCreator`; delete branch assignment step/fields.

- [ ] **Step 2: Frontend grep gate and build**

Run: `grep -rin branch resources/js/admin/src ; npm run build`
Expected: grep prints nothing; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add -A resources/js/admin/src
git commit -m "refactor(admin-ui): remove branch fields from all remaining pages"
```

---

### Task 9: End-to-end verification

**Files:** none (fix-ups only if a check fails)

- [ ] **Step 1: Global grep gate**

Run: `grep -rinE "branch" app database routes resources/js/admin/src resources/views config`
Expected: no output.

- [ ] **Step 2: Tests and build**

Run: `/opt/homebrew/bin/php artisan test && npm run build`
Expected: all tests PASS; build succeeds.

- [ ] **Step 3: Fresh MySQL schema + seed**

Run: `/opt/homebrew/bin/php artisan migrate:fresh --seed`
Expected: success.

- [ ] **Step 4: API smoke checks** (server: `/opt/homebrew/bin/php artisan serve --port=8010` in the background)

Get the super admin credentials from `database/seeders/SuperAdminSeeder.php`, and the clinic admin (`clinic-admin@demo-clinic.test` / `Admin@12345`) from `DemoClinicSeeder`.

```bash
B=http://127.0.0.1:8010/api
SA=$(curl -s -X POST $B/auth/login -H 'Accept: application/json' -d email=<super-admin-email> -d password=<super-admin-password> | jq -r '.data.token')
# 1. onboard a clinic
curl -s -X POST $B/super-admin/clinics -H "Authorization: Bearer $SA" -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Clinic","slug":"smoke","city":"Pune","settings":{"walkin_enabled":true},"clinic_admin":{"full_name":"Smoke Admin","email":"smoke@x.test","password":"Smoke@12345"}}' | jq '.success,.data.city'
# 2. clinic admin: doctor, schedule, availability
CA=$(curl -s -X POST $B/auth/login -H 'Accept: application/json' -d email=smoke@x.test -d password=Smoke@12345 | jq -r '.data.token')
DOC=$(curl -s -X POST $B/clinic/doctors -H "Authorization: Bearer $CA" -H 'Accept: application/json' -d full_name='Dr Smoke' -d slot_duration_minutes=30 | jq -r '.data.id')
curl -s -X POST $B/clinic/doctors/$DOC/schedules -H "Authorization: Bearer $CA" -H 'Accept: application/json' -d day_of_week=$(date -v+1d +%w) -d start_time=10:00 -d end_time=11:00 -d consultation_mode=in_person | jq '.success'
curl -s "$B/clinic/appointments/availability?doctor_id=$DOC&from_date=$(date -v+1d +%F)&to_date=$(date -v+1d +%F)" -H "Authorization: Bearer $CA" -H 'Accept: application/json' | jq '.data.days[0].slots | length'
```
Expected: `true`, `"Pune"`; a numeric doctor id; `true`; `2`. If a doctor or schedule endpoint needs more required fields, read the 422 message, add them, and note it in the report.

Then, in the browser at `http://127.0.0.1:8010/admin`: log in as super admin and onboard a clinic through the two-step wizard; open the clinic, and check that the Branches tab is gone and Settings shows the four booking fields.

- [ ] **Step 5: Commit any fix-ups**

```bash
git add -A && git commit -m "fix: post-removal smoke-test fixes"   # only if something changed
```
