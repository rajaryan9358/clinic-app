<?php

namespace Tests\Feature\Roles;

use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\DoctorSchedule;
use App\Models\Role;
use App\Models\User;
use App\Support\PermissionCatalogue;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class KindScopingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    public function test_custom_kinds_scope_like_builtins(): void
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);

        $seniorDoctorRole = Role::create(['name' => 'senior_doctor', 'guard_name' => 'web', 'kind' => 'doctor', 'label' => 'Senior Doctor']);
        $seniorDoctorRole->syncPermissions(PermissionCatalogue::defaults('doctor'));

        $helperRole = Role::create(['name' => 'helper', 'guard_name' => 'web', 'kind' => 'staff', 'label' => 'Helper', 'limit_to_assigned_doctors' => true]);
        $helperRole->syncPermissions(PermissionCatalogue::defaults('assistant'));

        $frontDeskRole = Role::create(['name' => 'front_desk', 'guard_name' => 'web', 'kind' => 'staff', 'label' => 'Front Desk']);
        $frontDeskRole->syncPermissions(PermissionCatalogue::defaults('receptionist'));

        $docA = Doctor::create(['clinic_id' => $clinic->id, 'full_name' => 'Dr A', 'slot_duration_minutes' => 30]);
        $docB = Doctor::create(['clinic_id' => $clinic->id, 'full_name' => 'Dr B', 'slot_duration_minutes' => 30]);

        $today = Carbon::now()->startOfDay();
        foreach ([$docA, $docB] as $doc) {
            DoctorSchedule::create([
                'clinic_id' => $clinic->id,
                'doctor_id' => $doc->id,
                'day_of_week' => $today->dayOfWeek,
                'start_time' => '09:00:00',
                'end_time' => '17:00:00',
                'consultation_mode' => 'in_person',
                'is_active' => true,
            ]);
        }

        $seniorDoctorUser = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Sr Doc',
            'email' => 'sr@x.test', 'password' => 'x', 'role' => 'senior_doctor', 'status' => 'active',
        ]);
        $seniorDoctorUser->assignRole('senior_doctor');
        $docA->update(['user_id' => $seniorDoctorUser->id]);

        $helper = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Helper',
            'email' => 'helper@x.test', 'password' => 'x', 'role' => 'helper', 'status' => 'active',
        ]);
        $helper->assignRole('helper');

        $frontDesk = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Front Desk',
            'email' => 'fd@x.test', 'password' => 'x', 'role' => 'front_desk', 'status' => 'active',
        ]);
        $frontDesk->assignRole('front_desk');

        // Book both appointments via the front_desk (receptionist-equivalent) user.
        Sanctum::actingAs($frontDesk);
        $respA = $this->postJson('/api/clinic/appointments', [
            'doctor_id' => $docA->id,
            'appointment_date' => $today->toDateString(),
            'start_time' => '10:00',
            'end_time' => '10:30',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'patient' => ['phone' => '9000000001', 'first_name' => 'Pat', 'last_name' => 'A'],
        ]);
        $respA->assertCreated();
        $apptA = $respA->json('data.id');

        $respB = $this->postJson('/api/clinic/appointments', [
            'doctor_id' => $docB->id,
            'appointment_date' => $today->toDateString(),
            'start_time' => '11:00',
            'end_time' => '11:30',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'patient' => ['phone' => '9000000002', 'first_name' => 'Pat', 'last_name' => 'B'],
        ]);
        $respB->assertCreated();
        $apptB = $respB->json('data.id');

        $this->assertNotNull($apptA);
        $this->assertNotNull($apptB);

        // senior_doctor (custom role, kind doctor) sees only doctor A's appointment.
        Sanctum::actingAs($seniorDoctorUser);
        $list = $this->getJson('/api/clinic/appointments');
        $list->assertOk();
        $this->assertEqualsCanonicalizing([$apptA], collect($list->json('data'))->pluck('id')->all());

        // helper (custom role, kind staff, limit_to_assigned_doctors) with no assigned doctors -> 403.
        Sanctum::actingAs($helper);
        $this->getJson('/api/clinic/appointments')
            ->assertForbidden()
            ->assertJsonFragment(['message' => 'No doctors assigned to assistant.']);

        // helper assigned to doctor B -> only B's appointment.
        $helper->assignedDoctors()->attach($docB->id, ['clinic_id' => $clinic->id]);
        Sanctum::actingAs($helper);
        $list2 = $this->getJson('/api/clinic/appointments');
        $list2->assertOk();
        $this->assertEqualsCanonicalizing([$apptB], collect($list2->json('data'))->pluck('id')->all());

        // front_desk (custom role, kind staff, receptionist permissions) sees both.
        Sanctum::actingAs($frontDesk);
        $list3 = $this->getJson('/api/clinic/appointments');
        $list3->assertOk();
        $this->assertEqualsCanonicalizing([$apptA, $apptB], collect($list3->json('data'))->pluck('id')->all());
    }

    public function test_role_model_cache_is_reresolved_when_role_name_changes(): void
    {
        $clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C2', 'slug' => 'c2', 'status' => 'active']);
        $user = User::create([
            'clinic_id' => $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'Multi',
            'email' => 'multi@x.test', 'password' => 'x', 'role' => 'receptionist', 'status' => 'active',
        ]);
        $user->assignRole('receptionist');

        $this->assertSame('staff', $user->roleKind());

        // Changing the role on the same instance must not keep serving the stale, memoized role.
        $user->role = 'doctor';
        $this->assertSame('doctor', $user->roleKind());
    }
}
