<?php

namespace Tests\Feature\Portal;

use App\Models\Appointment;
use App\Models\AppointmentPrescription;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\User;
use App\Support\PortalConsent;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Task 4 of the patient-portal plan: the consent gate
 * (App\Http\Middleware\RequirePortalConsent, `portal.consent`), the
 * dashboard shell (App\Http\Controllers\Api\Portal\DashboardController),
 * family profiles (App\Http\Controllers\Api\Portal\FamilyController,
 * reusing App\Support\Portal\PortalAccount::profiles()), and the staff
 * "managed by" endpoint (App\Services\Patients\PatientManagedByService).
 */
class PortalConsentFamilyTest extends TestCase
{
    use RefreshDatabase, PortalTestHelpers;

    private function consentFor(Patient $patient): void
    {
        $patient->forceFill([
            'consent_given_at' => now(),
            'consent_version' => PortalConsent::VERSION,
        ])->save();
    }

    // -- Consent gate ------------------------------------------------

    public function test_dashboard_without_consent_is_428(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic);
        $token = $this->portalToken($account);

        $response = $this->portalGet('/api/portal/dashboard', $token);

        $response->assertStatus(428);
        $this->assertFalse($response->json('success'));
        $this->assertSame('consent_required', $response->json('code'));
        $this->assertSame('Please accept the privacy notice to continue.', $response->json('message'));
    }

    public function test_consent_text_is_broken_into_paragraphs(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic);

        $response = $this->portalGet('/api/portal/consent', $this->portalToken($account));

        $response->assertOk();
        $paragraphs = array_values(array_filter(explode("\n", (string) $response->json('data.text')), 'strlen'));

        $this->assertGreaterThan(1, count($paragraphs), 'the privacy notice should render as several paragraphs, not one block');
        $this->assertSame(PortalConsent::VERSION, $response->json('data.version'));
    }

    public function test_repunctuating_the_notice_does_not_reprompt_consented_patients(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic);
        $this->consentFor($account);

        // Paragraph breaks are cosmetic: a patient who already accepted
        // this version must not be asked again.
        $this->portalGet('/api/portal/dashboard', $this->portalToken($account))->assertOk();
        $this->assertSame('2026-09-v1', PortalConsent::VERSION);
    }

    public function test_family_list_without_consent_is_428(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic);

        $token = $this->portalToken($account);

        $response = $this->portalGet('/api/portal/family', $token);

        $response->assertStatus(428);
        $this->assertSame('consent_required', $response->json('code'));

        // The consent gate is what refused it, nothing else about the route.
        $this->consentFor($account);
        $this->portalGet('/api/portal/family', $token)->assertOk();
    }

    public function test_adding_a_dependent_without_consent_is_428(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic);

        $token = $this->portalToken($account);

        $response = $this->portalPost('/api/portal/family', $token, null, [
            'full_name' => 'Dependent Child',
        ]);

        $response->assertStatus(428);
        $this->assertSame('consent_required', $response->json('code'));
        $this->assertSame(0, Patient::where('managed_by_patient_id', $account->id)->count());

        // Same request succeeds once consent is on file, so the 428 above
        // came from the gate and not from the payload or the route.
        $this->consentFor($account);
        $this->portalPost('/api/portal/family', $token, null, ['full_name' => 'Dependent Child'])->assertCreated();
        $this->assertSame(1, Patient::where('managed_by_patient_id', $account->id)->count());
    }

    public function test_get_consent_works_before_accepting(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic);
        $token = $this->portalToken($account);

        $response = $this->portalGet('/api/portal/consent', $token);

        $response->assertOk();
        $this->assertSame(PortalConsent::VERSION, $response->json('data.version'));
        $this->assertSame(PortalConsent::TEXT, $response->json('data.text'));
        $this->assertNull($response->json('data.given_at'));
        $this->assertFalse($response->json('data.current'));
    }

    public function test_post_consent_stamps_acting_profile_and_unlocks_dashboard(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic, ['communication_consent' => false]);
        $token = $this->portalToken($account);

        $response = $this->portalPost('/api/portal/consent', $token);

        $response->assertOk();
        $this->assertTrue($response->json('data.current'));
        $this->assertNotNull($response->json('data.given_at'));

        $account->refresh();
        $this->assertSame(PortalConsent::VERSION, $account->consent_version);
        $this->assertNotNull($account->consent_given_at);
        $this->assertTrue($account->communication_consent);

        $dashboard = $this->portalGet('/api/portal/dashboard', $token);
        $dashboard->assertOk();
    }

    public function test_consent_is_stamped_on_acting_profile_only(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic, ['phone' => '9876543210']);
        $dependent = $this->makePatient($clinic, [
            'phone' => '9876543210',
            'managed_by_patient_id' => $account->id,
        ]);
        $token = $this->portalToken($account);

        $response = $this->portalPost('/api/portal/consent', $token, $dependent->id);
        $response->assertOk();

        $account->refresh();
        $dependent->refresh();
        $this->assertNull($account->consent_version);
        $this->assertSame(PortalConsent::VERSION, $dependent->consent_version);

        // Dependent profile can now reach gated routes...
        $this->portalGet('/api/portal/dashboard', $token, $dependent->id)->assertOk();
        // ...but the account holder itself still needs to consent. (Explicit
        // id, not omitted: TestCase::withHeaders() merges into persistent
        // default headers, so the X-Patient-Id sent above would otherwise
        // leak into this request too.)
        $this->portalGet('/api/portal/dashboard', $token, $account->id)->assertStatus(428);
    }

    public function test_version_bump_reprompts_for_consent(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic);
        $this->consentFor($account);
        $token = $this->portalToken($account);

        $this->portalGet('/api/portal/dashboard', $token)->assertOk();

        $account->forceFill(['consent_version' => 'old'])->save();

        $response = $this->portalGet('/api/portal/dashboard', $token);
        $response->assertStatus(428);
        $this->assertSame('consent_required', $response->json('code'));
    }

    // -- Dashboard ----------------------------------------------------

    public function test_dashboard_counts_and_next_appointment(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-01-10 10:00:00', 'Asia/Kolkata'));
        $now = Carbon::now();

        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic);
        $this->consentFor($account);
        $token = $this->portalToken($account);

        $doctor = Doctor::create([
            'clinic_id' => $clinic->id,
            'full_name' => 'Dr Soonest',
            'specialization' => 'General Medicine',
            'slot_duration_minutes' => 30,
        ]);

        $tz = 'Asia/Kolkata';

        // Soonest upcoming: +2h today, pending.
        $soonest = Appointment::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $account->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => $now->clone()->timezone($tz)->toDateString(),
            'start_time' => $now->clone()->timezone($tz)->addHours(2)->format('H:i:s'),
            'end_time' => $now->clone()->timezone($tz)->addHours(2)->addMinutes(30)->format('H:i:s'),
            'visit_type' => 'new',
            'consultation_mode' => 'in_person',
            'booking_channel' => 'portal',
            'status' => 'pending',
        ]);

        // Also upcoming, but later: tomorrow, confirmed.
        Appointment::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $account->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => $now->clone()->timezone($tz)->addDay()->toDateString(),
            'start_time' => '09:00:00',
            'end_time' => '09:30:00',
            'visit_type' => 'followup',
            'consultation_mode' => 'in_person',
            'booking_channel' => 'portal',
            'status' => 'confirmed',
        ]);

        // In the past: does not count as upcoming.
        $past = Appointment::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $account->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => $now->clone()->timezone($tz)->subDay()->toDateString(),
            'start_time' => '09:00:00',
            'end_time' => '09:30:00',
            'visit_type' => 'new',
            'consultation_mode' => 'in_person',
            'booking_channel' => 'walk_in',
            'status' => 'completed',
        ]);

        // Upcoming but cancelled: does not count as upcoming.
        Appointment::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $account->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => $now->clone()->timezone($tz)->toDateString(),
            'start_time' => $now->clone()->timezone($tz)->addHours(4)->format('H:i:s'),
            'end_time' => $now->clone()->timezone($tz)->addHours(4)->addMinutes(30)->format('H:i:s'),
            'visit_type' => 'new',
            'consultation_mode' => 'in_person',
            'booking_channel' => 'portal',
            'status' => 'cancelled',
        ]);

        // Latest-final-per-appointment: draft + final on $past counts once.
        AppointmentPrescription::create([
            'clinic_id' => $clinic->id,
            'appointment_id' => $past->id,
            'status' => 'draft',
        ]);
        AppointmentPrescription::create([
            'clinic_id' => $clinic->id,
            'appointment_id' => $past->id,
            'status' => 'final',
        ]);

        // Another appointment with only a draft: not counted.
        $draftOnly = Appointment::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $account->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => $now->clone()->timezone($tz)->subDays(2)->toDateString(),
            'start_time' => '09:00:00',
            'end_time' => '09:30:00',
            'visit_type' => 'new',
            'consultation_mode' => 'in_person',
            'booking_channel' => 'walk_in',
            'status' => 'completed',
        ]);
        AppointmentPrescription::create([
            'clinic_id' => $clinic->id,
            'appointment_id' => $draftOnly->id,
            'status' => 'draft',
        ]);

        $response = $this->portalGet('/api/portal/dashboard', $token);
        $response->assertOk();

        $this->assertSame(2, $response->json('data.upcoming_count'));
        $this->assertSame(1, $response->json('data.finalized_prescriptions_count'));

        $next = $response->json('data.next_appointment');
        $this->assertSame($soonest->id, $next['id']);
        $this->assertSame('pending', $next['status']);
        $this->assertSame('new', $next['visit_type']);
        $this->assertSame('in_person', $next['consultation_mode']);
        $this->assertSame('portal', $next['booking_channel']);
        $this->assertSame($doctor->id, $next['doctor']['id']);
        $this->assertSame('Dr Soonest', $next['doctor']['name']);
        $this->assertSame('General Medicine', $next['doctor']['specialization']);

        Carbon::setTestNow();
    }

    // -- Family ---------------------------------------------------------

    public function test_post_family_while_acting_as_dependent_is_managed_by_account(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic, ['phone' => '9876543210']);
        $this->consentFor($account);
        $dependent = $this->makePatient($clinic, [
            'phone' => '9876543210',
            'managed_by_patient_id' => $account->id,
        ]);
        $this->consentFor($dependent);
        $token = $this->portalToken($account);

        $response = $this->portalPost('/api/portal/family', $token, $dependent->id, [
            'full_name' => 'Baby Kid',
            'dob' => '2020-01-01',
            'gender' => 'male',
        ]);

        $response->assertStatus(201);
        $newId = $response->json('data.id');
        $this->assertSame('dependent', $response->json('data.relation'));

        $new = Patient::findOrFail($newId);
        $this->assertSame($account->id, $new->managed_by_patient_id);
        $this->assertSame($account->phone, $new->phone);
        $this->assertSame($account->clinic_id, $new->clinic_id);
        $this->assertNotEmpty($new->uuid);
        $this->assertSame('Baby', $new->first_name);
        $this->assertSame('Kid', $new->last_name);

        $family = $this->portalGet('/api/portal/family', $token, $account->id);
        $family->assertOk();
        $this->assertContains($newId, collect($family->json('data'))->pluck('id')->all());
    }

    public function test_post_family_validates_full_name(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic);
        $this->consentFor($account);
        $token = $this->portalToken($account);

        $response = $this->portalPost('/api/portal/family', $token, null, []);

        $response->assertStatus(422);
    }

    // -- Staff managed-by -------------------------------------------------

    private function clinicAdmin(Clinic $clinic): User
    {
        $user = User::create([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Admin',
            'email' => 'admin-'.Str::random(8).'@x.test',
            'password' => 'x',
            'role' => 'clinic_admin',
            'status' => 'active',
        ]);
        $user->assignRole('clinic_admin');

        return $user;
    }

    public function test_staff_can_link_a_patient_to_an_account_holder_in_same_clinic(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);

        $clinic = $this->makeClinic();
        Sanctum::actingAs($this->clinicAdmin($clinic));

        $accountHolder = $this->makePatient($clinic, ['phone' => '9111111111']);
        $target = $this->makePatient($clinic, ['phone' => '9222222222']);

        $response = $this->putJson("/api/clinic/patients/{$target->id}/managed-by", [
            'managed_by_patient_id' => $accountHolder->id,
        ]);

        $response->assertOk();
        $this->assertSame($accountHolder->id, $target->refresh()->managed_by_patient_id);
    }

    public function test_staff_cannot_link_a_patient_to_itself(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);

        $clinic = $this->makeClinic();
        Sanctum::actingAs($this->clinicAdmin($clinic));

        $patient = $this->makePatient($clinic);

        $response = $this->putJson("/api/clinic/patients/{$patient->id}/managed-by", [
            'managed_by_patient_id' => $patient->id,
        ]);

        $response->assertStatus(422);
        $this->assertSame('Choose an account holder in this clinic.', $response->json('message'));
    }

    public function test_staff_cannot_link_a_patient_to_a_dependent(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);

        $clinic = $this->makeClinic();
        Sanctum::actingAs($this->clinicAdmin($clinic));

        $accountHolder = $this->makePatient($clinic, ['phone' => '9111111111']);
        $existingDependent = $this->makePatient($clinic, [
            'phone' => '9111111111',
            'managed_by_patient_id' => $accountHolder->id,
        ]);
        $target = $this->makePatient($clinic, ['phone' => '9222222222']);

        $response = $this->putJson("/api/clinic/patients/{$target->id}/managed-by", [
            'managed_by_patient_id' => $existingDependent->id,
        ]);

        $response->assertStatus(422);
        $this->assertSame('Choose an account holder in this clinic.', $response->json('message'));
    }

    public function test_staff_cannot_link_a_patient_to_another_clinics_patient(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);

        $clinic = $this->makeClinic();
        $otherClinic = $this->makeClinic();
        Sanctum::actingAs($this->clinicAdmin($clinic));

        $foreignAccountHolder = $this->makePatient($otherClinic, ['phone' => '9333333333']);
        $target = $this->makePatient($clinic, ['phone' => '9222222222']);

        $response = $this->putJson("/api/clinic/patients/{$target->id}/managed-by", [
            'managed_by_patient_id' => $foreignAccountHolder->id,
        ]);

        $response->assertStatus(422);
        $this->assertSame('Choose an account holder in this clinic.', $response->json('message'));
    }

    public function test_staff_cannot_make_a_patient_with_dependents_someone_elses_dependent(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);

        $clinic = $this->makeClinic();
        Sanctum::actingAs($this->clinicAdmin($clinic));

        $target = $this->makePatient($clinic, ['phone' => '9444444444']);
        $this->makePatient($clinic, [
            'phone' => '9444444444',
            'managed_by_patient_id' => $target->id,
        ]);
        $otherAccountHolder = $this->makePatient($clinic, ['phone' => '9555555555']);

        $response = $this->putJson("/api/clinic/patients/{$target->id}/managed-by", [
            'managed_by_patient_id' => $otherAccountHolder->id,
        ]);

        $response->assertStatus(422);
        $this->assertSame('Choose an account holder in this clinic.', $response->json('message'));
    }

    public function test_staff_clears_managed_by_with_null(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);

        $clinic = $this->makeClinic();
        Sanctum::actingAs($this->clinicAdmin($clinic));

        $accountHolder = $this->makePatient($clinic, ['phone' => '9111111111']);
        $dependent = $this->makePatient($clinic, [
            'phone' => '9111111111',
            'managed_by_patient_id' => $accountHolder->id,
        ]);

        $response = $this->putJson("/api/clinic/patients/{$dependent->id}/managed-by", [
            'managed_by_patient_id' => null,
        ]);

        $response->assertOk();
        $this->assertNull($dependent->refresh()->managed_by_patient_id);
    }

    public function test_super_admin_can_link_across_the_catalogue(): void
    {
        $this->seed(RolesAndPermissionsSeeder::class);

        $superAdmin = User::create([
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Super',
            'email' => 'super-'.Str::random(8).'@x.test',
            'password' => 'x',
            'role' => 'super_admin',
            'status' => 'active',
        ]);
        $superAdmin->assignRole('super_admin');
        Sanctum::actingAs($superAdmin);

        $clinic = $this->makeClinic();
        $accountHolder = $this->makePatient($clinic, ['phone' => '9111111111']);
        $target = $this->makePatient($clinic, ['phone' => '9222222222']);

        $response = $this->putJson("/api/super-admin/patients/{$target->id}/managed-by", [
            'managed_by_patient_id' => $accountHolder->id,
        ]);

        $response->assertOk();
        $this->assertSame($accountHolder->id, $target->refresh()->managed_by_patient_id);
    }
}
