<?php

namespace Tests\Feature\TenantScoping;

use App\Models\Domain;
use App\Models\FollowupTask;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\Review;
use App\Models\Service;
use App\Models\WhatsappConversation;
use App\Services\ReviewAiService;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Clinic CRUD modules that staff write through the generic admin form:
 * every foreign key must point into the caller's clinic, and the fields the
 * admin UI sends (resources/js/admin/src/config/modules.js) keep working.
 */
class WritableModulesTest extends TestCase
{
    use RefreshDatabase, TenantFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->setUpTenants();
        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));
    }

    /** [path, model, formFields keys, create payload as the admin UI sends it] */
    private function spec(string $module): array
    {
        $l = $this->local;

        return match ($module) {
            'followups' => ['followups', FollowupTask::class,
                ['clinic_id', 'patient_id', 'appointment_id', 'assigned_to_user_id', 'due_date', 'due_time', 'task_type', 'status', 'priority', 'note'],
                [
                    'patient_id' => $l['patient_id'], 'appointment_id' => $l['appointment_id'],
                    'assigned_to_user_id' => $l['assigned_to_user_id'], 'due_date' => '2026-10-05', 'due_time' => '10:30',
                    'task_type' => 'call', 'status' => 'pending', 'priority' => 'high', 'note' => 'Call back',
                ]],
            'invoices' => ['invoices', Invoice::class,
                ['clinic_id', 'patient_id', 'appointment_id', 'invoice_number', 'invoice_date', 'subtotal', 'discount_amount', 'tax_amount', 'total_amount', 'status'],
                [
                    'patient_id' => $l['patient_id'], 'appointment_id' => $l['appointment_id'], 'invoice_number' => 'INV-UI-1',
                    'invoice_date' => '2026-10-01', 'subtotal' => 1000, 'discount_amount' => 100, 'tax_amount' => 50,
                    'total_amount' => 950, 'status' => 'issued',
                ]],
            'payments' => ['payments', Payment::class,
                ['clinic_id', 'invoice_id', 'appointment_id', 'patient_id', 'amount', 'payment_method', 'reference_number', 'paid_at', 'status'],
                [
                    'invoice_id' => $l['invoice_id'], 'appointment_id' => $l['appointment_id'], 'patient_id' => $l['patient_id'],
                    'amount' => 950, 'payment_method' => 'upi', 'reference_number' => 'UPI123',
                    'paid_at' => '2026-10-01 11:00', 'status' => 'success',
                ]],
            'conversations' => ['whatsapp/conversations', WhatsappConversation::class,
                ['clinic_id', 'patient_id', 'customer_phone', 'conversation_status', 'current_owner_type'],
                [
                    'patient_id' => $l['patient_id'], 'customer_phone' => '9000012345',
                    'conversation_status' => 'open', 'current_owner_type' => 'bot',
                ]],
        };
    }

    public static function foreignKeys(): array
    {
        return [
            'followups patient' => ['followups', 'patient_id'],
            'followups appointment' => ['followups', 'appointment_id'],
            'followups assignee' => ['followups', 'assigned_to_user_id'],
            'followups doctor' => ['followups', 'doctor_id'],
            'invoices patient' => ['invoices', 'patient_id'],
            'invoices appointment' => ['invoices', 'appointment_id'],
            'payments patient' => ['payments', 'patient_id'],
            'payments appointment' => ['payments', 'appointment_id'],
            'payments invoice' => ['payments', 'invoice_id'],
            'conversations patient' => ['conversations', 'patient_id'],
            'conversations owner' => ['conversations', 'current_owner_user_id'],
        ];
    }

    public static function modules(): array
    {
        return [
            'followups' => ['followups'],
            'invoices' => ['invoices'],
            'payments' => ['payments'],
            'conversations' => ['conversations'],
        ];
    }

    #[Test]
    #[DataProvider('foreignKeys')]
    public function create_rejects_a_foreign_key_from_another_clinic(string $module, string $fk): void
    {
        [$path, $model, , $payload] = $this->spec($module);
        $before = $model::count();

        $this->postJson("/api/clinic/{$path}", [...$payload, $fk => $this->foreign[$fk]])
            ->assertStatus(422)
            ->assertJsonValidationErrors([$fk]);

        $this->assertSame($before, $model::count());
    }

    #[Test]
    #[DataProvider('foreignKeys')]
    public function update_rejects_a_foreign_key_from_another_clinic(string $module, string $fk): void
    {
        [$path, $model, , $payload] = $this->spec($module);
        $id = $this->postJson("/api/clinic/{$path}", $payload)->assertCreated()->json('data.id');
        $original = $model::find($id)->{$fk};

        $this->putJson("/api/clinic/{$path}/{$id}", [$fk => $this->foreign[$fk]])
            ->assertStatus(422)
            ->assertJsonValidationErrors([$fk]);

        $this->assertEquals($original, $model::find($id)->{$fk});
    }

    #[Test]
    #[DataProvider('modules')]
    public function admin_form_create_and_edit_round_trip(string $module): void
    {
        [$path, $model, $formKeys, $payload] = $this->spec($module);

        $res = $this->postJson("/api/clinic/{$path}", [...$payload, 'clinic_id' => $this->otherClinic->id])->assertCreated();
        $id = $res->json('data.id');
        $row = $model::findOrFail($id);
        $this->assertSame($this->clinic->id, (int) $row->clinic_id);
        foreach (array_intersect_key($payload, array_flip(['patient_id', 'appointment_id', 'invoice_id', 'assigned_to_user_id'])) as $key => $value) {
            $this->assertEquals($value, $row->{$key}, $key);
        }

        // The edit form reloads the record and sends back every non-empty form field.
        $record = $this->getJson("/api/clinic/{$path}/{$id}")->assertOk()->json('data');
        $edit = array_filter(array_intersect_key($record, array_flip($formKeys)), fn ($v) => $v !== null && $v !== '');
        $this->putJson("/api/clinic/{$path}/{$id}", $edit)->assertOk();

        $this->assertSame($this->clinic->id, (int) $model::find($id)->clinic_id);
    }

    #[Test]
    public function followup_from_whatsapp_conversation_view_still_works(): void
    {
        // ModuleViewPage::runCreateFollowup payload.
        $this->postJson('/api/clinic/followups', [
            'clinic_id' => $this->clinic->id,
            'patient_id' => $this->local['patient_id'],
            'assigned_to_user_id' => null,
            'due_date' => '2026-10-05',
            'task_type' => 'whatsapp',
            'status' => 'pending',
            'priority' => 'medium',
            'note' => null,
        ])->assertCreated();
    }

    #[Test]
    public function conversation_assign_action_still_works(): void
    {
        $id = $this->local['conversation_id'];

        // ModuleViewPage::runAssignConversation payload.
        $this->putJson("/api/clinic/whatsapp/conversations/{$id}", [
            'current_owner_type' => 'staff',
            'current_owner_user_id' => $this->local['current_owner_user_id'],
        ])->assertOk();

        $conversation = WhatsappConversation::find($id);
        $this->assertSame('staff', $conversation->current_owner_type);
        $this->assertSame($this->local['current_owner_user_id'], (int) $conversation->current_owner_user_id);
    }

    #[Test]
    public function system_fields_are_not_accepted(): void
    {
        [, , , $followup] = $this->spec('followups');
        $id = $this->postJson('/api/clinic/followups', [...$followup, 'completed_at' => '2026-10-01 10:00:00'])->assertCreated()->json('data.id');
        $this->assertNull(FollowupTask::find($id)->completed_at);

        [, , , $payment] = $this->spec('payments');
        $id = $this->postJson('/api/clinic/payments', [...$payment, 'collected_by_user_id' => $this->foreign['assigned_to_user_id']])->assertCreated()->json('data.id');
        $this->assertNull(Payment::find($id)->collected_by_user_id);

        $id = $this->local['conversation_id'];
        $this->putJson("/api/clinic/whatsapp/conversations/{$id}", ['tags_json' => ['x'], 'last_message_at' => '2026-10-01 10:00:00'])->assertOk();
        $conversation = WhatsappConversation::find($id);
        $this->assertNull($conversation->tags_json);
        $this->assertNull($conversation->last_message_at);
    }

    #[Test]
    public function invalid_enums_are_rejected(): void
    {
        [, , , $followup] = $this->spec('followups');
        $this->postJson('/api/clinic/followups', [...$followup, 'task_type' => 'nope'])->assertStatus(422)->assertJsonValidationErrors(['task_type']);

        [, , , $payment] = $this->spec('payments');
        $this->postJson('/api/clinic/payments', [...$payment, 'payment_method' => 'gold'])->assertStatus(422)->assertJsonValidationErrors(['payment_method']);

        $this->postJson("/api/clinic/invoices/{$this->local['invoice_id']}/block")->assertStatus(422);
        $this->assertSame('draft', Invoice::find($this->local['invoice_id'])->status);
    }

    #[Test]
    public function services_create_edit_and_toggle_with_admin_form_fields(): void
    {
        $id = $this->postJson('/api/clinic/services', [
            'clinic_id' => $this->otherClinic->id,
            'image_url' => '/storage/services/a.png',
            'name' => 'Consultation',
            'code' => 'CONS',
            'description' => 'General consult',
            'duration_minutes' => 15,
            'fee' => 300,
        ])->assertCreated()->json('data.id');

        $service = Service::findOrFail($id);
        $this->assertSame($this->clinic->id, (int) $service->clinic_id);
        $this->assertSame('/storage/services/a.png', $service->image_url);

        $this->putJson("/api/clinic/services/{$id}", ['name' => 'Consult', 'fee' => 350, 'clinic_id' => $this->otherClinic->id])->assertOk();
        $this->putJson("/api/clinic/services/{$id}", ['status' => 'inactive'])->assertOk();

        $service->refresh();
        $this->assertSame('Consult', $service->name);
        $this->assertSame('inactive', $service->status);
        $this->assertSame($this->clinic->id, (int) $service->clinic_id);

        $this->postJson('/api/clinic/services', ['code' => 'X'])->assertStatus(422)->assertJsonValidationErrors(['name']);
    }

    #[Test]
    public function domains_edit_with_admin_form_fields(): void
    {
        $domain = Domain::create(['clinic_id' => $this->clinic->id, 'host' => 'home.example.test', 'type' => 'booking']);
        Domain::create(['clinic_id' => $this->otherClinic->id, 'host' => 'other.example.test', 'type' => 'booking']);

        $this->putJson("/api/clinic/domains/{$domain->id}", [
            'clinic_id' => $this->otherClinic->id, 'host' => 'book.home.example.test', 'type' => 'portal',
            'is_primary' => true, 'ssl_status' => 'pending', 'status' => 'active',
        ])->assertOk();

        $domain->refresh();
        $this->assertSame('book.home.example.test', $domain->host);
        $this->assertTrue($domain->is_primary);
        $this->assertSame($this->clinic->id, (int) $domain->clinic_id);

        $this->putJson("/api/clinic/domains/{$domain->id}", ['host' => 'other.example.test'])
            ->assertStatus(422)->assertJsonValidationErrors(['host']);
        $this->putJson("/api/clinic/domains/{$domain->id}", ['type' => 'nope'])
            ->assertStatus(422)->assertJsonValidationErrors(['type']);
    }

    #[Test]
    public function review_writes_stay_in_the_callers_clinic(): void
    {
        $this->mock(ReviewAiService::class)->shouldReceive('analyzeAndPersistSentiment');

        $id = $this->postJson('/api/clinic/reviews', [
            'clinic_id' => $this->otherClinic->id, 'reviewer_name' => 'A', 'message' => 'Great', 'rating' => 5,
        ])->assertCreated()->json('data.id');
        $this->putJson("/api/clinic/reviews/{$id}", ['clinic_id' => $this->otherClinic->id, 'reviewer_name' => 'B'])->assertOk();

        $review = Review::findOrFail($id);
        $this->assertSame($this->clinic->id, (int) $review->clinic_id);
        $this->assertSame('B', $review->reviewer_name);
    }
}
