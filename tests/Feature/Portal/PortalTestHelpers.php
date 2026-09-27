<?php

namespace Tests\Feature\Portal;

use App\Models\Clinic;
use App\Models\ClinicSetting;
use App\Models\Patient;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/**
 * Fixture helpers shared by the patient-portal feature tests: clinics,
 * patients, portal Sanctum tokens, and JSON request helpers that set the
 * bearer token / X-Patient-Id headers the `portal.auth` middleware reads.
 */
trait PortalTestHelpers
{
    protected function makeClinic(array $settings = []): Clinic
    {
        $clinic = Clinic::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Portal Clinic '.Str::random(6),
            'slug' => 'portal-clinic-'.Str::random(6),
            'status' => 'active',
        ]);

        if ($settings !== []) {
            ClinicSetting::create(array_merge(['clinic_id' => $clinic->id], $settings));
        }

        return $clinic;
    }

    protected function makePatient(Clinic $clinic, array $attrs = []): Patient
    {
        return Patient::create(array_merge([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Test',
            'full_name' => 'Test Patient',
            'phone' => '9876543210',
        ], $attrs));
    }

    protected function portalToken(Patient $patient): string
    {
        return $patient->createToken('portal', ['portal'], now()->addDays(30))->plainTextToken;
    }

    protected function portalGet(string $uri, string $token, mixed $patientId = null, array $data = []): TestResponse
    {
        // The `portal` guard is a Sanctum RequestGuard, which caches its
        // resolved user for the guard instance's lifetime. Within a single
        // test method that instance survives across simulated requests, so
        // a second call with a different bearer token would otherwise see
        // the first call's cached user. Forget guards before each request
        // to force re-resolution from the current token, matching real
        // (one-guard-instance-per-request) production behaviour.
        app('auth')->forgetGuards();

        return $this->withHeaders($this->portalHeaders($token, $patientId))->getJson($uri, $data);
    }

    protected function portalPost(string $uri, string $token, mixed $patientId = null, array $data = []): TestResponse
    {
        app('auth')->forgetGuards();

        return $this->withHeaders($this->portalHeaders($token, $patientId))->postJson($uri, $data);
    }

    private function portalHeaders(string $token, mixed $patientId): array
    {
        $headers = ['Authorization' => 'Bearer '.$token];

        if ($patientId !== null) {
            $headers['X-Patient-Id'] = (string) $patientId;
        }

        return $headers;
    }
}
