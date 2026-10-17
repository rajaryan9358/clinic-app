<?php

namespace Tests\Feature\Followups;

use App\Models\Clinic;
use App\Models\FollowupTask;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Feature\Billing\BillingTestHelpers;
use Tests\TestCase;

class FollowupCompleteTest extends TestCase
{
    use BillingTestHelpers, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    private function staffWith(int $clinicId, array $permissions, string $name = 'S'): User
    {
        $role = Role::create(['name' => 'r'.Str::random(6), 'guard_name' => 'web', 'label' => 'R', 'kind' => 'staff']);
        $role->syncPermissions($permissions);
        $u = User::create(['clinic_id' => $clinicId, 'uuid' => (string) Str::uuid(), 'full_name' => $name,
            'email' => Str::random(6).'@x.test', 'password' => 'x', 'role' => $role->name, 'status' => 'active']);
        $u->syncRoles([$role->name]);

        return $u;
    }

    private function task(int $clinicId, array $attrs = []): FollowupTask
    {
        $patient = $this->makeBillingPatient(Clinic::find($clinicId));

        return FollowupTask::create(array_merge([
            'clinic_id' => $clinicId, 'patient_id' => $patient->id, 'due_date' => '2026-10-20',
            'task_type' => 'call', 'status' => 'pending', 'priority' => 'medium',
        ], $attrs));
    }

    public function test_complete_sets_done_and_completed_at(): void
    {
        $clinic = $this->makeBillingClinic();
        $task = $this->task($clinic->id);
        Sanctum::actingAs($this->staffWith($clinic->id, ['followups.edit']));

        $this->postJson("/api/clinic/followups/{$task->id}/complete")
            ->assertOk()->assertJsonPath('data.status', 'done');

        $task->refresh();
        $this->assertSame('done', $task->status);
        $this->assertNotNull($task->completed_at);
    }

    public function test_completing_twice_is_idempotent(): void
    {
        $clinic = $this->makeBillingClinic();
        $task = $this->task($clinic->id);
        Sanctum::actingAs($this->staffWith($clinic->id, ['followups.edit']));

        $this->postJson("/api/clinic/followups/{$task->id}/complete")->assertOk();
        $first = $task->refresh()->completed_at;

        $this->travel(2)->hours();
        $this->postJson("/api/clinic/followups/{$task->id}/complete")->assertOk()->assertJsonPath('data.status', 'done');

        $this->assertTrue($first->equalTo($task->refresh()->completed_at));
    }

    public function test_closed_followups_cannot_be_completed(): void
    {
        $clinic = $this->makeBillingClinic();
        Sanctum::actingAs($this->staffWith($clinic->id, ['followups.edit']));

        foreach (['cancelled', 'skipped'] as $status) {
            $task = $this->task($clinic->id, ['status' => $status]);
            $this->postJson("/api/clinic/followups/{$task->id}/complete")
                ->assertStatus(422)->assertJsonFragment(['message' => 'This follow-up is already closed.']);
            $task->refresh();
            $this->assertSame($status, $task->status);
            $this->assertNull($task->completed_at);
        }
    }

    public function test_completing_a_followup_requires_followups_edit(): void
    {
        $clinic = $this->makeBillingClinic();
        $task = $this->task($clinic->id);
        Sanctum::actingAs($this->staffWith($clinic->id, ['followups.view']));

        $this->postJson("/api/clinic/followups/{$task->id}/complete")->assertStatus(403);
        $this->assertSame('pending', $task->refresh()->status);
    }

    public function test_completing_another_clinics_followup_is_404(): void
    {
        $mine = $this->makeBillingClinic();
        $other = $this->makeBillingClinic();
        $task = $this->task($other->id);
        Sanctum::actingAs($this->staffWith($mine->id, ['followups.edit']));

        $this->postJson("/api/clinic/followups/{$task->id}/complete")->assertStatus(404);
        $this->assertSame('pending', $task->refresh()->status);
    }

    public function test_list_carries_the_assignee_name(): void
    {
        $clinic = $this->makeBillingClinic();
        $assignee = $this->staffWith($clinic->id, [], 'Nurse Joy');
        $this->task($clinic->id, ['assigned_to_user_id' => $assignee->id]);
        Sanctum::actingAs($this->staffWith($clinic->id, ['followups.view']));

        $this->getJson('/api/clinic/followups')->assertOk()
            ->assertJsonPath('data.0.assignee.full_name', 'Nurse Joy');
    }
}
