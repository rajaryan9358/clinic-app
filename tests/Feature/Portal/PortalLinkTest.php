<?php

namespace Tests\Feature\Portal;

use App\Models\Clinic;
use App\Models\ClinicSetting;
use App\Models\Patient;
use App\Models\PatientLoginLink;
use App\Models\Role;
use App\Models\User;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\WhatsAppGateway;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Task 3 of the patient-portal plan: staff-sent single-use magic login
 * links (POST /api/clinic/patients/{id}/portal-link and the super-admin
 * equivalent) and their public exchange (POST /api/portal/auth/link).
 * See app/Services/Portal/PortalLinkService.php.
 */
class PortalLinkTest extends TestCase
{
    use PortalTestHelpers, RefreshDatabase;

    private FakeWhatsAppGateway $fake;

    protected function setUp(): void
    {
        parent::setUp();

        $this->fake = new FakeWhatsAppGateway;
        $this->app->instance(WhatsAppGateway::class, $this->fake);

        $this->seed(RolesAndPermissionsSeeder::class);
    }

    private function staffWithPermissions(Clinic $clinic, array $permissions): User
    {
        $role = Role::create([
            'name' => 'r'.Str::random(8),
            'guard_name' => 'web',
            'label' => 'R',
            'kind' => 'staff',
        ]);
        $role->syncPermissions($permissions);

        $user = User::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Staff User',
            'email' => Str::random(8).'@clinic.test',
            'password' => 'secret',
            'role' => $role->name,
            'status' => 'active',
        ]);
        $user->syncRoles([$role->name]);

        return $user;
    }

    public function test_staff_with_permission_creates_link_and_sends_whatsapp(): void
    {
        $clinic = $this->makeClinic();
        $patient = $this->makePatient($clinic, ['first_name' => 'Ravi', 'last_name' => 'Kumar', 'phone' => '9876543210']);
        $staff = $this->staffWithPermissions($clinic, ['patients.portal_link']);

        Sanctum::actingAs($staff);

        Carbon::setTestNow('2026-01-01 10:00:00');
        $response = $this->postJson("/api/clinic/patients/{$patient->id}/portal-link");
        Carbon::setTestNow();

        $response->assertStatus(201);

        $url = $response->json('data.url');
        $this->assertMatchesRegularExpression('#/portal/login/[A-Za-z0-9]{40}$#', $url);

        $expiresAt = Carbon::parse($response->json('data.expires_at'));
        $this->assertTrue($expiresAt->equalTo(Carbon::parse('2026-01-08 10:00:00')));

        $this->assertNotNull($response->json('data.whatsapp.id'));
        $this->assertSame('sent', $response->json('data.whatsapp.delivery_status'));

        $link = PatientLoginLink::first();
        $this->assertNotNull($link);
        $this->assertSame($clinic->id, $link->clinic_id);
        $this->assertSame($patient->id, $link->patient_id);
        $this->assertSame(64, strlen($link->token_hash));
        $this->assertNull($link->consumed_at);
        $this->assertSame($staff->id, $link->created_by_user_id);

        $token = substr($url, strrpos($url, '/') + 1);
        $this->assertSame(hash('sha256', $token), $link->token_hash);

        $this->assertCount(1, $this->fake->sent);
        $sent = $this->fake->sent[0];
        $this->assertSame('portal_link', $sent['template']);

        $body = null;
        $button = null;
        foreach ($sent['components'] as $component) {
            if ($component['type'] === 'body') {
                $body = $component;
            }
            if ($component['type'] === 'button') {
                $button = $component;
            }
        }
        $this->assertSame(
            ['Ravi Kumar', $clinic->name],
            array_map(fn ($p) => $p['text'], $body['parameters']),
        );
        $this->assertSame($token, $button['parameters'][0]['text']);
    }

    public function test_creating_link_for_dependent_is_rejected(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic, ['phone' => '9876543210']);
        $dependent = $this->makePatient($clinic, [
            'phone' => '9876543210',
            'managed_by_patient_id' => $account->id,
        ]);
        $staff = $this->staffWithPermissions($clinic, ['patients.portal_link']);

        Sanctum::actingAs($staff);

        $response = $this->postJson("/api/clinic/patients/{$dependent->id}/portal-link");

        $response->assertStatus(422);
        $this->assertSame('Send the link to the account holder.', $response->json('message'));
        $this->assertCount(0, $this->fake->sent);
        $this->assertSame(0, PatientLoginLink::count());
    }

    public function test_creating_link_for_other_clinics_patient_is_not_found(): void
    {
        $clinic = $this->makeClinic();
        $otherClinic = $this->makeClinic();
        $otherPatient = $this->makePatient($otherClinic);
        $staff = $this->staffWithPermissions($clinic, ['patients.portal_link']);

        Sanctum::actingAs($staff);

        $response = $this->postJson("/api/clinic/patients/{$otherPatient->id}/portal-link");

        $response->assertStatus(404);
    }

    public function test_creating_link_without_permission_is_forbidden(): void
    {
        $clinic = $this->makeClinic();
        $patient = $this->makePatient($clinic);
        $doctor = $this->staffWithPermissions($clinic, ['patients.view', 'patients.edit']);

        Sanctum::actingAs($doctor);

        $response = $this->postJson("/api/clinic/patients/{$patient->id}/portal-link");

        $response->assertStatus(403);
        $this->assertStringStartsWith("You don't have permission to", $response->json('message'));
    }

    public function test_super_admin_can_send_link_for_any_clinic_patient(): void
    {
        $clinic = $this->makeClinic();
        $patient = $this->makePatient($clinic, ['phone' => '9876543210']);

        $superAdmin = User::create([
            'clinic_id' => null,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Super Admin',
            'email' => Str::random(8).'@x.test',
            'password' => 'secret',
            'role' => 'super_admin',
            'status' => 'active',
        ]);
        $superAdmin->assignRole('super_admin');

        Sanctum::actingAs($superAdmin);

        $response = $this->postJson("/api/super-admin/patients/{$patient->id}/portal-link");

        $response->assertStatus(201);
        $this->assertSame(1, PatientLoginLink::count());
        $this->assertCount(1, $this->fake->sent);
    }

    private function issueLink(Patient $patient): string
    {
        $staff = $this->staffWithPermissions($patient->clinic, ['patients.portal_link']);
        Sanctum::actingAs($staff);

        $response = $this->postJson("/api/clinic/patients/{$patient->id}/portal-link");
        $response->assertStatus(201);

        $url = $response->json('data.url');

        return substr($url, strrpos($url, '/') + 1);
    }

    public function test_exchange_valid_token_logs_in(): void
    {
        $clinic = $this->makeClinic();
        $patient = $this->makePatient($clinic, ['phone' => '9876543210']);
        $token = $this->issueLink($patient);

        $response = $this->postJson('/api/portal/auth/link', ['token' => $token]);

        $response->assertOk();
        $this->assertNotEmpty($response->json('data.token'));
        $this->assertSame($patient->id, $response->json('data.account.account.id'));

        $link = PatientLoginLink::first();
        $this->assertNotNull($link->consumed_at);
    }

    public function test_exchange_second_use_is_rejected(): void
    {
        $clinic = $this->makeClinic();
        $patient = $this->makePatient($clinic, ['phone' => '9876543210']);
        $token = $this->issueLink($patient);

        $this->postJson('/api/portal/auth/link', ['token' => $token])->assertOk();

        $second = $this->postJson('/api/portal/auth/link', ['token' => $token]);
        $second->assertStatus(422);
        $this->assertSame('This link has expired.', $second->json('message'));
    }

    public function test_exchange_after_seven_days_is_rejected(): void
    {
        $clinic = $this->makeClinic();
        $patient = $this->makePatient($clinic, ['phone' => '9876543210']);

        Carbon::setTestNow('2026-01-01 10:00:00');
        $token = $this->issueLink($patient);

        Carbon::setTestNow(Carbon::parse('2026-01-08 10:00:01'));
        $response = $this->postJson('/api/portal/auth/link', ['token' => $token]);
        Carbon::setTestNow();

        $response->assertStatus(422);
        $this->assertSame('This link has expired.', $response->json('message'));
    }

    public function test_exchange_for_unknown_token_is_rejected(): void
    {
        $response = $this->postJson('/api/portal/auth/link', ['token' => Str::random(40)]);

        $response->assertStatus(422);
        $this->assertSame('This link has expired.', $response->json('message'));
    }

    public function test_exchange_for_portal_disabled_clinic_is_rejected(): void
    {
        $clinic = $this->makeClinic();
        $patient = $this->makePatient($clinic, ['phone' => '9876543210']);
        $token = $this->issueLink($patient);

        ClinicSetting::updateOrCreate(['clinic_id' => $clinic->id], ['portal_enabled' => false]);

        $response = $this->postJson('/api/portal/auth/link', ['token' => $token]);
        $response->assertStatus(422);
        $this->assertSame('This link has expired.', $response->json('message'));
    }

    public function test_exchange_for_soft_deleted_patient_is_rejected(): void
    {
        $clinic = $this->makeClinic();
        $patient = $this->makePatient($clinic, ['phone' => '9876543210']);
        $token = $this->issueLink($patient);

        $patient->delete();

        $response = $this->postJson('/api/portal/auth/link', ['token' => $token]);
        $response->assertStatus(422);
        $this->assertSame('This link has expired.', $response->json('message'));
    }
}
