<?php

namespace Tests\Feature\Dashboards;

use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\View;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * The three clinic PDF reports. Rows are inspected by hooking a view
 * composer onto the report blade views, which captures the data handed to
 * DomPDF while still rendering a real PDF.
 */
class ReportPdfTest extends TestCase
{
    use DashboardTestHelpers;
    use RefreshDatabase;

    private Clinic $clinic;

    private Clinic $other;

    private Doctor $doctor;

    private Doctor $otherDoctor;

    private Patient $patient;

    private Patient $otherPatient;

    /** @var array<string, array> view name => captured data */
    private array $captured = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        Carbon::setTestNow(Carbon::parse('2026-10-27 06:30:00', 'UTC'));

        $this->clinic = $this->makeClinic('Main');
        $this->other = $this->makeClinic('Other');
        $this->doctor = $this->makeDoctor($this->clinic, 'Dr Main', ['specialization' => 'ENT']);
        $this->otherDoctor = $this->makeDoctor($this->other, 'Dr Foreign', ['specialization' => 'ENT']);
        $this->patient = $this->makePatient($this->clinic, 'Asha', 'Main');
        $this->otherPatient = $this->makePatient($this->other, 'Zed', 'Foreign');

        foreach (['reports.appointments', 'reports.patients', 'reports.doctors'] as $view) {
            View::composer($view, function ($v) use ($view) {
                $this->captured[$view] = $v->getData();
            });
        }
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public static function reports(): array
    {
        return [
            'appointments' => ['/api/clinic/reports/appointments.pdf', 'appointments-report.pdf'],
            'patients' => ['/api/clinic/reports/patients.pdf', 'patients-report.pdf'],
            'doctors' => ['/api/clinic/reports/doctors.pdf', 'doctors-report.pdf'],
        ];
    }

    public static function reportUris(): array
    {
        return array_map(fn (array $row) => [$row[0]], self::reports());
    }

    private function seedAppointments(): void
    {
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-20', 'completed');
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-25', 'cancelled');
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-27', 'confirmed');
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-11-02', 'pending');
        // Other clinic: must never appear.
        $this->makeAppointment($this->other, $this->otherDoctor, $this->otherPatient, '2026-10-25', 'completed');
        $this->makeAppointment($this->other, $this->otherDoctor, $this->otherPatient, '2026-10-27', 'confirmed');
    }

    private function capturedAppointments(): \Illuminate\Support\Collection
    {
        $this->assertArrayHasKey('reports.appointments', $this->captured, 'report view was not rendered');

        return $this->captured['reports.appointments']['appointments'];
    }

    #[Test]
    #[DataProvider('reports')]
    public function user_with_reports_view_gets_a_pdf_download(string $uri, string $filename): void
    {
        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));

        $res = $this->get($uri)->assertOk();

        $this->assertSame('application/pdf', $res->headers->get('Content-Type'));
        $this->assertStringContainsString($filename, (string) $res->headers->get('Content-Disposition'));
        $this->assertStringStartsWith('%PDF', $res->getContent());
    }

    #[Test]
    #[DataProvider('reportUris')]
    public function receptionist_has_reports_view_by_default(string $uri): void
    {
        Sanctum::actingAs($this->makeUser($this->clinic, 'receptionist'));

        $this->get($uri)->assertOk();
    }

    #[Test]
    #[DataProvider('reportUris')]
    public function custom_role_with_only_reports_view_is_allowed(string $uri): void
    {
        Sanctum::actingAs($this->staffWith($this->clinic, ['reports.view']));

        $this->get($uri)->assertOk();
    }

    #[Test]
    #[DataProvider('reportUris')]
    public function users_without_reports_view_are_forbidden(string $uri): void
    {
        foreach ([
            $this->staffWith($this->clinic, ['appointments.view', 'patients.view', 'doctors.view']),
            $this->makeAssistant($this->clinic, [$this->doctor]),
            $this->makeDoctorUser($this->clinic, $this->doctor),
        ] as $user) {
            Sanctum::actingAs($user);
            $res = $this->getJson($uri)->assertForbidden();
            $this->assertStringStartsWith("You don't have permission to", $res->json('message'));
        }
    }

    #[Test]
    #[DataProvider('reportUris')]
    public function unauthenticated_requests_are_rejected(string $uri): void
    {
        $this->getJson($uri)->assertUnauthorized();
    }

    #[Test]
    public function appointments_report_contains_only_current_clinic_rows_with_summary(): void
    {
        $this->seedAppointments();
        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));

        $this->get('/api/clinic/reports/appointments.pdf')->assertOk();

        $rows = $this->capturedAppointments();
        $this->assertCount(4, $rows);
        $this->assertSame([$this->clinic->id], $rows->pluck('clinic_id')->unique()->values()->all());
        $this->assertSame(
            ['2026-11-02', '2026-10-27', '2026-10-25', '2026-10-20'],
            $rows->map(fn ($a) => $a->appointment_date->toDateString())->all(),
            'latest first'
        );
        $this->assertSame(
            ['total' => 4, 'completed' => 1, 'upcoming' => 2, 'cancelled' => 1],
            $this->captured['reports.appointments']['summary']
        );
    }

    #[Test]
    public function appointments_report_filters_by_inclusive_date_range(): void
    {
        $this->seedAppointments();
        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));

        $this->get('/api/clinic/reports/appointments.pdf?appointment_date_from=2026-10-25&appointment_date_to=2026-10-27')->assertOk();

        $this->assertSame(
            ['2026-10-27', '2026-10-25'],
            $this->capturedAppointments()->map(fn ($a) => $a->appointment_date->toDateString())->all()
        );
    }

    #[Test]
    public function appointments_report_filters_by_single_date_and_status(): void
    {
        $this->seedAppointments();
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-27', 'no_show');
        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));

        $this->get('/api/clinic/reports/appointments.pdf?appointment_date=2026-10-27&status=no_show')->assertOk();

        $rows = $this->capturedAppointments();
        $this->assertCount(1, $rows);
        $this->assertSame('no_show', $rows->first()->status);
    }

    #[Test]
    public function appointments_report_doctor_filter_for_another_clinics_doctor_yields_nothing(): void
    {
        $this->seedAppointments();
        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));

        $this->get('/api/clinic/reports/appointments.pdf?doctor_id='.$this->otherDoctor->id)->assertOk();

        $this->assertCount(0, $this->capturedAppointments());
    }

    #[Test]
    public function appointments_report_search_does_not_escape_clinic_scope(): void
    {
        $this->seedAppointments();
        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));

        // "Foreign" only matches the other clinic's patient/doctor names.
        $this->get('/api/clinic/reports/appointments.pdf?search=Foreign')->assertOk();

        $this->assertCount(0, $this->capturedAppointments());
    }

    /**
     * There is no request validation on the report filters: a malformed
     * date is passed straight to whereDate(). Pin that it does not 500.
     */
    #[Test]
    public function appointments_report_with_malformed_date_does_not_error(): void
    {
        $this->seedAppointments();
        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));

        $this->get('/api/clinic/reports/appointments.pdf?appointment_date_from=not-a-date')->assertOk();
    }

    /**
     * A role limited to assigned doctors (assistant-style) that has been
     * granted reports.view should only see its active doctor's appointments,
     * as every other appointment endpoint enforces via active_doctor_id.
     */
    #[Test]
    public function doctor_limited_role_report_is_scoped_to_its_doctor(): void
    {
        $drB = $this->makeDoctor($this->clinic, 'Dr B');
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-27');
        $this->makeAppointment($this->clinic, $drB, $this->patient, '2026-10-27');

        $role = Role::create(['name' => 'limited_reporter', 'guard_name' => 'web', 'label' => 'L', 'kind' => 'staff', 'limit_to_assigned_doctors' => true]);
        $role->syncPermissions(['reports.view']);
        $user = User::create([
            'clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => 'L',
            'email' => 'l@x.test', 'password' => 'x', 'role' => $role->name, 'status' => 'active',
        ]);
        $user->syncRoles([$role->name]);
        $user->assignedDoctors()->attach($this->doctor->id, ['clinic_id' => $this->clinic->id]);
        Sanctum::actingAs($user);

        $this->get('/api/clinic/reports/appointments.pdf')->assertOk();

        $this->assertSame([$this->doctor->id], $this->capturedAppointments()->pluck('doctor_id')->unique()->values()->all());
    }

    #[Test]
    public function patients_report_contains_only_current_clinic_patients_and_appointment_stats(): void
    {
        $this->seedAppointments();
        $second = $this->makePatient($this->clinic, 'Bina', 'Main');
        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));

        $this->get('/api/clinic/reports/patients.pdf')->assertOk();

        $data = $this->captured['reports.patients'];
        $this->assertEqualsCanonicalizing([$this->patient->id, $second->id], $data['patients']->pluck('id')->all());
        $this->assertSame(['patients' => 2, 'appointments' => 4], $data['summary']);
        $this->assertSame(['total' => 4, 'completed' => 1, 'upcoming' => 2], $data['stats'][$this->patient->id]);
        $this->assertArrayNotHasKey($this->otherPatient->id, $data['stats']);
    }

    #[Test]
    public function patients_report_excludes_soft_deleted_unless_with_trashed(): void
    {
        $gone = $this->makePatient($this->clinic, 'Gone', 'Main');
        $gone->delete();
        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));

        $this->get('/api/clinic/reports/patients.pdf')->assertOk();
        $this->assertNotContains($gone->id, $this->captured['reports.patients']['patients']->pluck('id')->all());

        $this->get('/api/clinic/reports/patients.pdf?with_trashed=1')->assertOk();
        $this->assertContains($gone->id, $this->captured['reports.patients']['patients']->pluck('id')->all());
    }

    #[Test]
    public function doctors_report_contains_only_current_clinic_doctors_and_stats(): void
    {
        $this->seedAppointments();
        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));

        // Filter shared by both clinics' doctors: still only ours.
        $this->get('/api/clinic/reports/doctors.pdf?specialization=ENT')->assertOk();

        $data = $this->captured['reports.doctors'];
        $this->assertSame([$this->doctor->id], $data['doctors']->pluck('id')->all());
        $this->assertSame(['doctors' => 1, 'appointments' => 4], $data['summary']);
        $this->assertSame(['total' => 4, 'completed' => 1, 'upcoming' => 2], $data['stats'][$this->doctor->id]);
    }
}
