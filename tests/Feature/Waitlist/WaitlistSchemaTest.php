<?php

namespace Tests\Feature\Waitlist;

use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\PatientLoginLink;
use App\Models\User;
use App\Models\WaitlistEntry;
use App\Services\Portal\PortalLinkService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Task 1 of the waitlist (E3) plan: the `waitlist_entries` table/model,
 * the redirecting-login-link additions to PortalLinkService, and the
 * `WaitlistEntry::scopeActive` helper. The WhatsApp template and the
 * exchange endpoint's redirect_path filtering are covered by
 * tests/Feature/WhatsApp/NotifierTest.php and
 * tests/Feature/Portal/PortalLinkTest.php respectively; clinic-settings
 * validation is covered by tests/Feature/ClinicSettingsTest.php.
 */
class WaitlistSchemaTest extends TestCase
{
    use RefreshDatabase;

    private function clinic(): Clinic
    {
        return Clinic::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Waitlist Clinic',
            'slug' => 'waitlist-clinic-'.Str::random(6),
            'status' => 'active',
        ]);
    }

    private function doctor(Clinic $clinic): Doctor
    {
        return Doctor::create(['clinic_id' => $clinic->id, 'full_name' => 'Dr Waitlist']);
    }

    private function patient(Clinic $clinic, array $attrs = []): Patient
    {
        return Patient::create(array_merge([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Wait',
            'full_name' => 'Wait Lister',
            'phone' => '9876543210',
        ], $attrs));
    }

    public function test_waitlist_entries_table_has_expected_columns_and_indexes(): void
    {
        $this->assertTrue(Schema::hasTable('waitlist_entries'));
        $this->assertTrue(Schema::hasColumns('waitlist_entries', [
            'id', 'clinic_id', 'patient_id', 'doctor_id', 'appointment_date', 'start_time', 'end_time',
            'status', 'source', 'offered_at', 'hold_expires_at', 'booked_appointment_id', 'login_link_id',
            'created_by_user_id', 'created_at', 'updated_at',
        ]));

        $indexes = array_column(Schema::getIndexes('waitlist_entries'), 'name');
        $this->assertContains('waitlist_slot_idx', $indexes);
    }

    public function test_model_persists_a_full_row_and_casts_dates(): void
    {
        $clinic = $this->clinic();
        $doctor = $this->doctor($clinic);
        $patient = $this->patient($clinic);

        $entry = WaitlistEntry::create([
            'clinic_id' => $clinic->id,
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => '2026-10-05',
            'start_time' => '09:00:00',
            'end_time' => '09:15:00',
            'status' => 'waiting',
            'source' => 'portal',
        ]);

        $this->assertInstanceOf(Carbon::class, $entry->fresh()->appointment_date);
        $this->assertSame('2026-10-05', $entry->fresh()->appointment_date->toDateString());
        $this->assertSame('waiting', $entry->status);
        $this->assertTrue($entry->clinic->is($clinic));
        $this->assertTrue($entry->patient->is($patient));
        $this->assertTrue($entry->doctor->is($doctor));
    }

    public function test_scope_active_returns_only_waiting_and_offered_entries(): void
    {
        $clinic = $this->clinic();
        $doctor = $this->doctor($clinic);
        $patient = $this->patient($clinic);

        $base = [
            'clinic_id' => $clinic->id, 'patient_id' => $patient->id, 'doctor_id' => $doctor->id,
            'appointment_date' => '2026-10-05', 'start_time' => '09:00:00', 'source' => 'portal',
        ];

        $waiting = WaitlistEntry::create([...$base, 'status' => 'waiting']);
        $offered = WaitlistEntry::create([...$base, 'status' => 'offered']);
        WaitlistEntry::create([...$base, 'status' => 'booked']);
        WaitlistEntry::create([...$base, 'status' => 'declined']);
        WaitlistEntry::create([...$base, 'status' => 'expired']);
        WaitlistEntry::create([...$base, 'status' => 'removed']);

        $activeIds = WaitlistEntry::active()->pluck('id')->sort()->values()->all();

        $this->assertSame([$waiting->id, $offered->id], collect($activeIds)->sort()->values()->all());
    }

    public function test_issue_for_redirect_stores_hash_expiry_and_redirect_path(): void
    {
        $clinic = $this->clinic();
        $patient = $this->patient($clinic);
        $user = User::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Staff User',
            'email' => Str::random(8).'@clinic.test',
            'password' => 'secret',
            'role' => 'clinic_admin',
            'status' => 'active',
        ]);

        $service = $this->app->make(PortalLinkService::class);
        $expiresAt = Carbon::parse('2026-10-05 09:30:00');

        $result = $service->issueForRedirect($patient, $expiresAt, '/waitlist/7?profile=3', $user->id);

        $this->assertArrayHasKey('token', $result);
        $this->assertArrayHasKey('link', $result);
        $this->assertSame(40, strlen($result['token']));

        $link = PatientLoginLink::first();
        $this->assertNotNull($link);
        $this->assertSame($clinic->id, $link->clinic_id);
        $this->assertSame($patient->id, $link->patient_id);
        $this->assertSame(hash('sha256', $result['token']), $link->token_hash);
        $this->assertTrue($link->expires_at->equalTo($expiresAt));
        $this->assertSame('/waitlist/7?profile=3', $link->redirect_path);
        $this->assertSame($user->id, $link->created_by_user_id);
        $this->assertNull($link->consumed_at);
    }

    public function test_issue_for_redirect_does_not_send_any_whatsapp(): void
    {
        $fake = new \App\Services\WhatsApp\FakeWhatsAppGateway;
        $this->app->instance(\App\Services\WhatsApp\WhatsAppGateway::class, $fake);

        $clinic = $this->clinic();
        $patient = $this->patient($clinic);

        $service = $this->app->make(PortalLinkService::class);
        $service->issueForRedirect($patient, Carbon::now()->addMinutes(30), '/waitlist/1');

        $this->assertCount(0, $fake->sent);
        $this->assertSame(0, \App\Models\WhatsappMessage::count());
    }
}
