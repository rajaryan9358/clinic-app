<?php

namespace Tests\Feature\TenantScoping;

use App\Models\FollowupTask;
use App\Models\Patient;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * A follow-up row written before FK validation existed may still point at
 * another clinic's patient/doctor/appointment; the list must not expose them.
 */
class FollowupEagerLoadLeakTest extends TestCase
{
    use RefreshDatabase, TenantFixtures;

    #[Test]
    public function foreign_relations_on_a_legacy_row_are_not_exposed(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->setUpTenants();
        $foreignPatient = Patient::find($this->foreign['patient_id']);

        $task = FollowupTask::create([
            'clinic_id' => $this->clinic->id,
            'patient_id' => $this->foreign['patient_id'],
            'doctor_id' => $this->foreign['doctor_id'],
            'appointment_id' => $this->foreign['appointment_id'],
            'due_date' => '2026-10-05',
            'task_type' => 'call',
        ]);

        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));

        $index = $this->getJson('/api/clinic/followups')->assertOk();
        $row = collect($index->json('data'))->firstWhere('id', $task->id);
        $this->assertNotNull($row);
        $this->assertNull($row['patient']);
        $this->assertNull($row['doctor']);
        $this->assertNull($row['appointment']);

        $show = $this->getJson("/api/clinic/followups/{$task->id}")->assertOk();
        $this->assertNull($show->json('data.patient'));

        foreach ([$index, $show] as $res) {
            $this->assertStringNotContainsString($foreignPatient->full_name, $res->getContent());
            $this->assertStringNotContainsString($foreignPatient->phone, $res->getContent());
        }
    }

    #[Test]
    public function same_clinic_relations_still_load(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->setUpTenants();

        FollowupTask::create([
            'clinic_id' => $this->clinic->id,
            'patient_id' => $this->local['patient_id'],
            'doctor_id' => $this->local['doctor_id'],
            'appointment_id' => $this->local['appointment_id'],
            'due_date' => '2026-10-05',
            'task_type' => 'call',
        ]);

        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));

        $row = $this->getJson('/api/clinic/followups')->assertOk()->json('data.0');
        $this->assertSame($this->local['patient_id'], $row['patient']['id']);
        $this->assertSame($this->local['doctor_id'], $row['doctor']['id']);
        $this->assertSame($this->local['appointment_id'], $row['appointment']['id']);
    }
}
