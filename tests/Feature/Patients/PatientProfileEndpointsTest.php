<?php

namespace Tests\Feature\Patients;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\FollowupTask;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\PatientMedicalProfile;
use App\Models\PatientNote;
use App\Models\Payment;
use App\Models\User;
use App\Services\PatientGlobalSummaryService;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Mockery\MockInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Api\Clinic\PatientProfileController: profile, notes, medical profile,
 * activity, global summary and report.pdf (routes/api.php patients/{id}/...).
 */
class PatientProfileEndpointsTest extends TestCase
{
    use RefreshDatabase, PatientTestHelpers;

    private Clinic $clinic;

    private User $admin;

    private Doctor $doctor;

    private Patient $patient;

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        $this->seed(RolesAndPermissionsSeeder::class);

        $this->clinic = $this->makeClinic('Sunrise');
        $this->admin = $this->makeUser($this->clinic, 'clinic_admin', ['full_name' => 'Amit Admin']);
        $this->doctor = $this->makeDoctor($this->clinic, null, ['full_name' => 'Dr Mehta']);
        $this->patient = $this->makePatient($this->clinic, ['first_name' => 'Ravi', 'last_name' => 'Kumar']);
    }

    private function appointment(Patient $patient, array $attrs = []): Appointment
    {
        return Appointment::create(array_merge([
            'clinic_id' => $patient->clinic_id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $patient->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => '2026-10-01',
            'start_time' => '10:00:00',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => 'completed',
        ], $attrs));
    }

    private function followup(Patient $patient): FollowupTask
    {
        return FollowupTask::create([
            'clinic_id' => $patient->clinic_id, 'patient_id' => $patient->id,
            'due_date' => '2026-11-01', 'task_type' => 'call', 'status' => 'pending',
        ]);
    }

    private function invoice(Patient $patient): Invoice
    {
        return Invoice::create([
            'clinic_id' => $patient->clinic_id, 'patient_id' => $patient->id,
            'invoice_number' => 'INV-'.Str::random(8), 'invoice_date' => '2026-10-01',
            'subtotal' => 500, 'total_amount' => 500, 'status' => 'paid',
        ]);
    }

    private function payment(Patient $patient): Payment
    {
        return Payment::create([
            'clinic_id' => $patient->clinic_id, 'patient_id' => $patient->id,
            'amount' => 500, 'payment_method' => 'cash', 'paid_at' => now(), 'status' => 'success',
        ]);
    }

    private function note(Patient $patient, User $author, string $text = 'A note'): PatientNote
    {
        return PatientNote::create([
            'clinic_id' => $patient->clinic_id, 'patient_id' => $patient->id,
            'created_by_user_id' => $author->id, 'note_type' => 'general', 'note' => $text,
        ]);
    }

    // --- Profile -------------------------------------------------------

    #[Test]
    public function profile_returns_patient_medical_profile_and_history_counts(): void
    {
        PatientMedicalProfile::create(['clinic_id' => $this->clinic->id, 'patient_id' => $this->patient->id, 'allergies' => 'Penicillin']);
        $this->appointment($this->patient);
        $this->appointment($this->patient, ['appointment_date' => '2026-10-05']);
        $this->followup($this->patient);
        $this->invoice($this->patient);
        $this->payment($this->patient);
        $this->note($this->patient, $this->admin);

        // Noise: another patient in the same clinic.
        $other = $this->makePatient($this->clinic);
        $this->appointment($other);
        $this->note($other, $this->admin);

        Sanctum::actingAs($this->admin);
        $res = $this->getJson("/api/clinic/patients/{$this->patient->id}/profile")->assertOk();

        $res->assertJsonPath('data.patient.id', $this->patient->id)
            ->assertJsonPath('data.patient.full_name', 'Ravi Kumar')
            ->assertJsonPath('data.patient.medical_profile.allergies', 'Penicillin')
            ->assertJsonPath('data.counts', [
                'appointments' => 2, 'followups' => 1, 'invoices' => 1, 'payments' => 1, 'notes' => 1,
            ])
            ->assertJsonPath('data.family.managed_by', null)
            ->assertJsonPath('data.family.links', []);
    }

    #[Test]
    public function profile_of_soft_deleted_patient_is_still_viewable(): void
    {
        $this->patient->delete();
        Sanctum::actingAs($this->admin);

        $this->getJson("/api/clinic/patients/{$this->patient->id}/profile")
            ->assertOk()
            ->assertJsonPath('data.patient.id', $this->patient->id);
    }

    #[Test]
    public function profile_with_non_numeric_id_is_404(): void
    {
        Sanctum::actingAs($this->admin);

        $this->getJson('/api/clinic/patients/abc/profile')->assertNotFound();
        $this->getJson('/api/clinic/patients/999999/profile')->assertNotFound();
    }

    // --- Notes ---------------------------------------------------------

    #[Test]
    public function store_note_records_author_and_optional_doctor(): void
    {
        $receptionist = $this->makeUser($this->clinic, 'receptionist', ['full_name' => 'Rita Reception']);
        Sanctum::actingAs($receptionist);

        $res = $this->postJson("/api/clinic/patients/{$this->patient->id}/notes", [
            'note_type' => 'reception_note',
            'note' => 'Prefers morning slots',
            'doctor_id' => $this->doctor->id,
            'is_private' => true,
        ]);

        $res->assertCreated()
            ->assertJsonPath('data.note', 'Prefers morning slots')
            ->assertJsonPath('data.is_private', true)
            ->assertJsonPath('data.created_by_user.id', $receptionist->id)
            ->assertJsonPath('data.created_by_user.full_name', 'Rita Reception')
            ->assertJsonPath('data.doctor.full_name', 'Dr Mehta');

        $this->assertDatabaseHas('patient_notes', [
            'clinic_id' => $this->clinic->id,
            'patient_id' => $this->patient->id,
            'created_by_user_id' => $receptionist->id,
            'doctor_id' => $this->doctor->id,
            'note_type' => 'reception_note',
        ]);
    }

    #[Test]
    public function store_note_ignores_author_spoofing_in_payload(): void
    {
        $other = $this->makeUser($this->clinic, 'receptionist');
        Sanctum::actingAs($this->admin);

        $res = $this->postJson("/api/clinic/patients/{$this->patient->id}/notes", [
            'note_type' => 'general', 'note' => 'x', 'created_by_user_id' => $other->id,
        ])->assertCreated();

        $this->assertSame($this->admin->id, PatientNote::findOrFail($res->json('data.id'))->created_by_user_id);
    }

    public static function invalidNotePayloads(): array
    {
        return [
            'missing note' => [['note_type' => 'general'], 'note'],
            'missing type' => [['note' => 'x'], 'note_type'],
            'bad type' => [['note_type' => 'gossip', 'note' => 'x'], 'note_type'],
            'non-bool private' => [['note_type' => 'general', 'note' => 'x', 'is_private' => 'maybe'], 'is_private'],
            'unknown doctor' => [['note_type' => 'general', 'note' => 'x', 'doctor_id' => 999999], 'doctor_id'],
        ];
    }

    #[Test]
    #[DataProvider('invalidNotePayloads')]
    public function store_note_validates_payload(array $payload, string $field): void
    {
        Sanctum::actingAs($this->admin);

        $this->postJson("/api/clinic/patients/{$this->patient->id}/notes", $payload)
            ->assertStatus(422)
            ->assertJsonValidationErrors([$field]);
        $this->assertSame(0, PatientNote::count());
    }

    #[Test]
    public function store_note_rejects_doctor_from_another_clinic(): void
    {
        $otherClinic = $this->makeClinic('Other');
        $foreignDoctor = $this->makeDoctor($otherClinic);
        Sanctum::actingAs($this->admin);

        $this->postJson("/api/clinic/patients/{$this->patient->id}/notes", [
            'note_type' => 'doctor_note', 'note' => 'x', 'doctor_id' => $foreignDoctor->id,
        ])->assertStatus(422)->assertJsonValidationErrors(['doctor_id']);
    }

    #[Test]
    public function notes_list_is_paginated_newest_first_and_scoped_to_patient(): void
    {
        $first = $this->note($this->patient, $this->admin, 'first');
        $second = $this->note($this->patient, $this->admin, 'second');
        $this->note($this->makePatient($this->clinic), $this->admin, 'someone else');
        Sanctum::actingAs($this->admin);

        $res = $this->getJson("/api/clinic/patients/{$this->patient->id}/notes?per_page=1")->assertOk();

        $this->assertSame([$second->id], array_column($res->json('data'), 'id'));
        $res->assertJsonPath('meta.total', 2)
            ->assertJsonPath('meta.last_page', 2)
            ->assertJsonPath('data.0.created_by_user.full_name', 'Amit Admin');

        $page2 = $this->getJson("/api/clinic/patients/{$this->patient->id}/notes?per_page=1&page=2")->assertOk();
        $this->assertSame([$first->id], array_column($page2->json('data'), 'id'));
    }

    // --- Medical profile -----------------------------------------------

    #[Test]
    public function medical_profile_is_created_then_updated_in_place(): void
    {
        Sanctum::actingAs($this->admin);
        $uri = "/api/clinic/patients/{$this->patient->id}/medical-profile";

        $this->putJson($uri, ['allergies' => 'Peanuts', 'chronic_conditions' => 'Asthma'])
            ->assertOk()
            ->assertJsonPath('data.allergies', 'Peanuts');

        $this->putJson($uri, ['allergies' => 'Peanuts, Dust', 'current_medications' => 'Inhaler'])
            ->assertOk();

        $this->assertSame(1, PatientMedicalProfile::where('patient_id', $this->patient->id)->count());
        $profile = PatientMedicalProfile::where('patient_id', $this->patient->id)->firstOrFail();
        $this->assertSame('Peanuts, Dust', $profile->allergies);
        $this->assertSame('Inhaler', $profile->current_medications);
        $this->assertSame($this->clinic->id, $profile->clinic_id);
        // PUT is a full replace: fields omitted from the second call are cleared.
        $this->assertNull($profile->chronic_conditions);

        $this->getJson("/api/clinic/patients/{$this->patient->id}/profile")
            ->assertJsonPath('data.patient.medical_profile.allergies', 'Peanuts, Dust');
    }

    #[Test]
    public function medical_profile_rejects_non_string_fields(): void
    {
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/clinic/patients/{$this->patient->id}/medical-profile", ['allergies' => ['a', 'b']])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['allergies']);
        $this->assertSame(0, PatientMedicalProfile::count());
    }

    // --- Activity ------------------------------------------------------

    #[Test]
    public function activity_merges_event_types_newest_first(): void
    {
        Carbon::setTestNow('2026-10-01 09:00:00');
        $this->appointment($this->patient);
        Carbon::setTestNow('2026-10-02 09:00:00');
        $this->followup($this->patient);
        Carbon::setTestNow('2026-10-03 09:00:00');
        $this->invoice($this->patient);
        Carbon::setTestNow('2026-10-04 09:00:00');
        $this->payment($this->patient);
        Carbon::setTestNow('2026-10-05 09:00:00');
        $this->note($this->patient, $this->admin, 'Latest note');
        Carbon::setTestNow();

        // Noise from another patient must not appear.
        $this->note($this->makePatient($this->clinic), $this->admin, 'not mine');

        Sanctum::actingAs($this->admin);
        $res = $this->getJson("/api/clinic/patients/{$this->patient->id}/activity")->assertOk();

        $this->assertSame(
            ['note', 'payment', 'invoice', 'followup', 'appointment'],
            array_column($res->json('data.events'), 'type'),
        );
        $res->assertJsonPath('data.events.0.title', 'Latest note')
            ->assertJsonPath('data.events.4.title', 'Appointment completed')
            ->assertJsonPath('data.events.4.meta.appointment_date', '2026-10-01');
    }

    #[Test]
    public function activity_limit_is_clamped_to_minimum_of_ten(): void
    {
        foreach (range(1, 12) as $i) {
            $this->note($this->patient, $this->admin, "n{$i}");
        }
        Sanctum::actingAs($this->admin);

        $res = $this->getJson("/api/clinic/patients/{$this->patient->id}/activity?limit=1")->assertOk();

        $this->assertCount(10, $res->json('data.events'));
    }

    // --- Report PDF ----------------------------------------------------

    #[Test]
    public function report_pdf_downloads_a_pdf(): void
    {
        PatientMedicalProfile::create(['clinic_id' => $this->clinic->id, 'patient_id' => $this->patient->id, 'allergies' => 'Dust']);
        $this->appointment($this->patient);
        $this->followup($this->patient);
        $this->note($this->patient, $this->admin);
        Sanctum::actingAs($this->admin);

        $res = $this->get("/api/clinic/patients/{$this->patient->id}/report.pdf");

        $res->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $res->assertDownload("patient-report-{$this->patient->id}.pdf");
        $this->assertStringStartsWith('%PDF', $res->getContent());
    }

    // --- Global summary (AI service faked) ------------------------------

    #[Test]
    public function global_summary_get_is_null_until_generated_and_post_stores_faked_result(): void
    {
        $this->mock(PatientGlobalSummaryService::class, function (MockInterface $m) {
            $m->shouldReceive('generate')->once()->andReturn([
                'overall_health_summary' => 'Stable',
                'key_concerns' => ['BP'],
                'treatment_progress' => 'Improving',
                'recommended_focus' => 'Diet',
            ]);
        });
        $this->appointment($this->patient);
        Sanctum::actingAs($this->admin);
        $uri = "/api/clinic/patients/{$this->patient->id}/global-summary";

        $this->getJson($uri)->assertOk()->assertJsonPath('data.summary', null);

        $this->postJson($uri)->assertOk()
            ->assertJsonPath('data.summary.overall_health_summary', 'Stable')
            ->assertJsonPath('data.summary.key_concerns', ['BP']);

        $this->getJson($uri)->assertOk()
            ->assertJsonPath('data.summary.recommended_focus', 'Diet')
            ->assertJsonPath('data.summary.created_by_user_id', $this->admin->id);
    }

    // --- Tenant isolation ---------------------------------------------

    public static function patientEndpoints(): array
    {
        return [
            'show' => ['GET', ''],
            'update' => ['PUT', ''],
            'delete' => ['DELETE', ''],
            'restore' => ['POST', '/restore'],
            'profile' => ['GET', '/profile'],
            'notes list' => ['GET', '/notes'],
            'notes create' => ['POST', '/notes'],
            'medical profile' => ['PUT', '/medical-profile'],
            'activity' => ['GET', '/activity'],
            'global summary' => ['GET', '/global-summary'],
            'global summary generate' => ['POST', '/global-summary'],
            'report pdf' => ['GET', '/report.pdf'],
        ];
    }

    #[Test]
    #[DataProvider('patientEndpoints')]
    public function other_clinic_admin_gets_404_on_every_patient_endpoint(string $method, string $suffix): void
    {
        $this->mock(PatientGlobalSummaryService::class, fn (MockInterface $m) => $m->shouldNotReceive('generate'));
        PatientMedicalProfile::create(['clinic_id' => $this->clinic->id, 'patient_id' => $this->patient->id, 'allergies' => 'Secret']);
        $this->note($this->patient, $this->admin, 'secret note');

        $intruderClinic = $this->makeClinic('Intruder');
        Sanctum::actingAs($this->makeUser($intruderClinic, 'clinic_admin'));

        $payload = [
            'note_type' => 'general', 'note' => 'injected',
            'allergies' => 'overwritten', 'first_name' => 'Hacked', 'city' => 'Nowhere',
        ];
        $this->json($method, "/api/clinic/patients/{$this->patient->id}{$suffix}", $payload)->assertNotFound();

        $fresh = Patient::withTrashed()->findOrFail($this->patient->id);
        $this->assertSame('Ravi', $fresh->first_name);
        $this->assertNull($fresh->deleted_at);
        $this->assertSame(1, PatientNote::count());
        $this->assertSame('Secret', PatientMedicalProfile::firstOrFail()->allergies);
    }

    public static function profilePermissionRoutes(): array
    {
        return [
            'profile' => ['GET', '/profile', 'patients.view'],
            'notes list' => ['GET', '/notes', 'patients.view'],
            'activity' => ['GET', '/activity', 'patients.view'],
            'global summary' => ['GET', '/global-summary', 'patients.view'],
            'report pdf' => ['GET', '/report.pdf', 'patients.view'],
            'notes create' => ['POST', '/notes', 'patients.edit'],
            'medical profile' => ['PUT', '/medical-profile', 'patients.edit'],
        ];
    }

    #[Test]
    #[DataProvider('profilePermissionRoutes')]
    public function profile_route_requires_its_permission(string $method, string $suffix, string $permission): void
    {
        $uri = "/api/clinic/patients/{$this->patient->id}{$suffix}";
        $payload = ['note_type' => 'general', 'note' => 'x', 'allergies' => 'x'];
        $others = array_values(array_diff(['patients.view', 'patients.create', 'patients.edit', 'patients.delete'], [$permission]));

        Sanctum::actingAs($this->staffWith($this->clinic, $others));
        $this->json($method, $uri, $payload)->assertForbidden();

        Sanctum::actingAs($this->staffWith($this->clinic, [$permission]));
        $this->assertContains($this->json($method, $uri, $payload)->status(), [200, 201]);
    }

    #[Test]
    public function global_summary_generate_requires_edit_permission(): void
    {
        $this->mock(PatientGlobalSummaryService::class, fn (MockInterface $m) => $m->shouldNotReceive('generate'));
        Sanctum::actingAs($this->staffWith($this->clinic, ['patients.view']));

        $this->postJson("/api/clinic/patients/{$this->patient->id}/global-summary")->assertForbidden();
    }

    #[Test]
    public function doctor_cannot_reach_profile_endpoints_of_patients_preferring_another_doctor(): void
    {
        [$user] = $this->makeDoctorUser($this->clinic);
        Sanctum::actingAs($user);
        $base = "/api/clinic/patients/{$this->patient->id}";

        $this->getJson("{$base}/notes")->assertNotFound();
        $this->postJson("{$base}/notes", ['note_type' => 'doctor_note', 'note' => 'x'])->assertNotFound();
        $this->putJson("{$base}/medical-profile", ['allergies' => 'x'])->assertNotFound();
        $this->getJson("{$base}/activity")->assertNotFound();
        $this->get("{$base}/report.pdf")->assertNotFound();
    }
}
