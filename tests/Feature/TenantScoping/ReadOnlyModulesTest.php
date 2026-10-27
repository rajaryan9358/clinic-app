<?php

namespace Tests\Feature\TenantScoping;

use App\Models\AuditLog;
use App\Models\ReminderLog;
use App\Models\WhatsappFlowSession;
use App\Models\WhatsappMessage;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * System-generated records (audit trail, reminder and WhatsApp delivery
 * logs, bot sessions) are read-only through both the clinic and the
 * super-admin CRUD APIs.
 */
class ReadOnlyModulesTest extends TestCase
{
    use RefreshDatabase, TenantFixtures;

    /** @var array<string, int> path => id of an existing row in $clinic */
    private array $rows = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->setUpTenants();

        $l = $this->local;
        $this->rows = [
            'audit-logs' => AuditLog::create([
                'clinic_id' => $this->clinic->id, 'module' => 'patients', 'entity_type' => 'Patient', 'action' => 'created',
            ])->id,
            'reminders' => ReminderLog::create([
                'clinic_id' => $this->clinic->id, 'appointment_id' => $l['appointment_id'], 'patient_id' => $l['patient_id'],
                'channel' => 'whatsapp', 'reminder_type' => 'appointment_reminder', 'delivery_status' => 'sent',
            ])->id,
            'whatsapp/messages' => WhatsappMessage::create([
                'clinic_id' => $this->clinic->id, 'conversation_id' => $l['conversation_id'], 'direction' => 'outgoing',
                'message_type' => 'text', 'content_text' => 'Hello', 'delivery_status' => 'sent',
            ])->id,
            'whatsapp/sessions' => WhatsappFlowSession::create([
                'clinic_id' => $this->clinic->id, 'conversation_id' => $l['conversation_id'], 'flow_type' => 'support',
                'current_step' => 'start', 'status' => 'active', 'started_at' => now(),
            ])->id,
        ];
    }

    public static function modules(): array
    {
        return [
            'clinic audit logs' => ['clinic', 'audit-logs', AuditLog::class],
            'clinic reminders' => ['clinic', 'reminders', ReminderLog::class],
            'clinic whatsapp messages' => ['clinic', 'whatsapp/messages', WhatsappMessage::class],
            'clinic whatsapp sessions' => ['clinic', 'whatsapp/sessions', WhatsappFlowSession::class],
            'super admin audit logs' => ['super-admin', 'audit-logs', AuditLog::class],
            'super admin reminders' => ['super-admin', 'reminders', ReminderLog::class],
            'super admin whatsapp messages' => ['super-admin', 'whatsapp/messages', WhatsappMessage::class],
            'super admin whatsapp sessions' => ['super-admin', 'whatsapp/sessions', WhatsappFlowSession::class],
        ];
    }

    #[Test]
    #[DataProvider('modules')]
    public function writes_are_refused_and_reads_still_work(string $scope, string $path, string $model): void
    {
        Sanctum::actingAs($scope === 'clinic' ? $this->makeUser($this->clinic, 'clinic_admin') : $this->superAdmin());
        $base = "/api/{$scope}/{$path}";
        $id = $this->rows[$path];
        $before = $model::find($id)->getAttributes();
        $count = $model::count();

        $payload = ['patient_id' => $this->foreign['patient_id'], 'appointment_id' => $this->foreign['appointment_id'], 'status' => 'completed'];

        $this->postJson($base, $payload)->assertStatus(405);
        $this->putJson("{$base}/{$id}", $payload)->assertStatus(405);
        $this->deleteJson("{$base}/{$id}")->assertStatus(405);
        $this->postJson("{$base}/{$id}/restore")->assertStatus(405);
        $this->postJson("{$base}/{$id}/status", ['status' => 'completed'])->assertStatus(405);
        $this->postJson("{$base}/{$id}/block")->assertStatus(405);
        $this->postJson("{$base}/{$id}/unblock")->assertStatus(405);

        $this->assertSame($count, $model::count());
        $this->assertSame($before, $model::find($id)->getAttributes());

        $this->getJson($base)->assertOk();
        $this->getJson("{$base}/{$id}")->assertOk();
    }

    #[Test]
    public function audit_log_writes_need_no_permission_to_be_refused(): void
    {
        // Receptionists hold no audit_logs permission at all: the route itself refuses them.
        Sanctum::actingAs($this->makeUser($this->clinic, 'receptionist'));
        $this->deleteJson("/api/clinic/audit-logs/{$this->rows['audit-logs']}")->assertStatus(403);
        $this->assertSame(1, AuditLog::count());
    }
}
