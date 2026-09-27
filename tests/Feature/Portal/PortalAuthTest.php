<?php

namespace Tests\Feature\Portal;

use App\Models\Patient;
use App\Models\PatientFamilyLink;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Task 1 of the patient-portal plan: the `portal` Sanctum guard, profile
 * resolution (who a signed-in patient may act for), and the
 * GET /api/portal/auth/me + POST /api/portal/auth/logout endpoints.
 * See app/Support/Portal/PortalProfiles.php, app/Support/Portal/PortalAccount.php,
 * and app/Http/Middleware/AuthenticatePortal.php.
 */
class PortalAuthTest extends TestCase
{
    use RefreshDatabase, PortalTestHelpers;

    public function test_me_returns_account_profiles_and_clinic(): void
    {
        $clinicA = $this->makeClinic();
        $clinicB = $this->makeClinic();

        $account = $this->makePatient($clinicA, ['phone' => '9876543210']);

        $dependent = $this->makePatient($clinicA, [
            'phone' => '9876543210',
            'managed_by_patient_id' => $account->id,
        ]);

        $related = $this->makePatient($clinicA, ['phone' => '9111111111']);
        PatientFamilyLink::create([
            'clinic_id' => $clinicA->id,
            'patient_id' => $account->id,
            'related_patient_id' => $related->id,
            'relation' => 'spouse',
        ]);

        $samePhoneSameClinic = $this->makePatient($clinicA, ['phone' => '9876543210']);
        $samePhoneOtherClinic = $this->makePatient($clinicB, ['phone' => '9876543210']);

        $token = $this->portalToken($account);

        $response = $this->portalGet('/api/portal/auth/me', $token);

        $response->assertOk();
        $this->assertTrue($response->json('success'));

        $profiles = $response->json('data.profiles');
        $this->assertCount(4, $profiles);

        $relationsById = collect($profiles)->pluck('relation', 'id');
        $this->assertSame('self', $relationsById[$account->id]);
        $this->assertSame('dependent', $relationsById[$dependent->id]);
        $this->assertSame('family', $relationsById[$related->id]);
        $this->assertSame('same_phone', $relationsById[$samePhoneSameClinic->id]);
        $this->assertArrayNotHasKey($samePhoneOtherClinic->id, $relationsById->all());

        $clinicIds = collect($response->json('data.clinics'))->pluck('clinic_id')->unique()->values();
        $this->assertTrue($clinicIds->contains($clinicA->id));
        $this->assertTrue($clinicIds->contains($clinicB->id));

        $this->assertNotNull($response->json('data.clinic.name'));
        $this->assertSame($clinicA->id, $response->json('data.clinic.id'));
    }

    public function test_family_link_is_one_directional(): void
    {
        $clinic = $this->makeClinic();
        $linker = $this->makePatient($clinic, ['phone' => '9876543210']);
        $related = $this->makePatient($clinic, ['phone' => '9111111111']);

        PatientFamilyLink::create([
            'clinic_id' => $clinic->id,
            'patient_id' => $linker->id,
            'related_patient_id' => $related->id,
            'relation' => 'spouse',
        ]);

        // The linker can act for the related patient.
        $linkerToken = $this->portalToken($linker);
        $this->portalGet('/api/portal/auth/me', $linkerToken, $related->id)->assertOk();

        // But the related patient's own token cannot act for the linker.
        $relatedToken = $this->portalToken($related);
        $response = $this->portalGet('/api/portal/auth/me', $relatedToken, $linker->id);

        $response->assertStatus(403);
        $this->assertSame("You can't view this profile.", $response->json('message'));
    }

    public function test_foreign_or_invalid_profile_header_is_403(): void
    {
        $clinic = $this->makeClinic();
        $otherClinic = $this->makeClinic();

        $account = $this->makePatient($clinic, ['phone' => '9876543210']);
        $token = $this->portalToken($account);

        $foreignClinicPatient = $this->makePatient($otherClinic, ['phone' => '9222222222']);
        $strangerSameClinic = $this->makePatient($clinic, ['phone' => '9333333333']);
        $deletedDependent = $this->makePatient($clinic, [
            'phone' => '9876543210',
            'managed_by_patient_id' => $account->id,
        ]);
        $deletedDependent->delete();

        $cases = [
            'abc',
            $foreignClinicPatient->id,
            $strangerSameClinic->id,
            $deletedDependent->id,
        ];

        foreach ($cases as $patientId) {
            $response = $this->portalGet('/api/portal/auth/me', $token, $patientId);
            $response->assertStatus(403);
            $this->assertSame("You can't view this profile.", $response->json('message'));
        }
    }

    public function test_tokens_do_not_cross_guards(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);

        $clinic = $this->makeClinic();
        $patient = $this->makePatient($clinic);
        $patientToken = $this->portalToken($patient);

        $response = $this->withHeaders(['Authorization' => 'Bearer '.$patientToken])
            ->getJson('/api/clinic/patients');
        $response->assertStatus(401);

        $user = User::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Staff User',
            'email' => 'staff-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => 'clinic_admin',
            'status' => 'active',
        ]);
        $user->assignRole('clinic_admin');
        $userToken = $user->createToken('api-token')->plainTextToken;

        $response = $this->withHeaders(['Authorization' => 'Bearer '.$userToken])
            ->getJson('/api/portal/auth/me');
        $response->assertStatus(401);
    }

    public function test_disabled_portal_or_deleted_patient_is_401(): void
    {
        $clinic = $this->makeClinic(['portal_enabled' => false]);
        $account = $this->makePatient($clinic);
        $token = $this->portalToken($account);

        $response = $this->portalGet('/api/portal/auth/me', $token);
        $response->assertStatus(401);
        $this->assertSame('Session expired. Please sign in again.', $response->json('message'));

        $enabledClinic = $this->makeClinic();
        $activeAccount = $this->makePatient($enabledClinic);
        $activeToken = $this->portalToken($activeAccount);
        $activeAccount->delete();

        $response = $this->portalGet('/api/portal/auth/me', $activeToken);
        $response->assertStatus(401);

        $anotherClinic = $this->makeClinic();
        $expiringAccount = $this->makePatient($anotherClinic);
        $expiringToken = $this->portalToken($expiringAccount);

        Carbon::setTestNow(now()->addDays(31));
        $response = $this->portalGet('/api/portal/auth/me', $expiringToken);
        $response->assertStatus(401);
        Carbon::setTestNow();
    }

    public function test_logout_revokes_token(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic);
        $token = $this->portalToken($account);

        $response = $this->portalPost('/api/portal/auth/logout', $token);
        $response->assertOk();
        $this->assertTrue($response->json('success'));

        $response = $this->portalGet('/api/portal/auth/me', $token);
        $response->assertStatus(401);
    }
}
