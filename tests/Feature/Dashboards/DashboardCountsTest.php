<?php

namespace Tests\Feature\Dashboards;

use App\Models\AuditLog;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\FollowupTask;
use App\Models\Patient;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Counts and shape of the clinic dashboards (summary, clinic-admin,
 * receptionist, assistant).
 *
 * "Now" is pinned to 2026-10-27 06:30 UTC == 12:00 IST so that, apart from
 * the dedicated timezone cases, the app timezone (UTC) and the clinic
 * timezone (Asia/Kolkata) agree on what "today" is.
 */
class DashboardCountsTest extends TestCase
{
    use DashboardTestHelpers;
    use RefreshDatabase;

    private const TODAY = '2026-10-27';

    private Clinic $clinic;

    private Doctor $doctor;

    private Patient $patient;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        Carbon::setTestNow(Carbon::parse(self::TODAY.' 06:30:00', 'UTC'));

        $this->clinic = $this->makeClinic('Main');
        $this->doctor = $this->makeDoctor($this->clinic, 'Dr A');
        $this->patient = $this->makePatient($this->clinic);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /**
     * Today: 2 pending, 1 confirmed, 1 checked_in, 1 in_consultation,
     * 2 completed, 1 no_show, 1 cancelled (9 total) in the main clinic,
     * plus noise on other days and in another clinic.
     */
    private function seedTodayMix(): void
    {
        $mix = ['pending' => 2, 'confirmed' => 1, 'checked_in' => 1, 'in_consultation' => 1, 'completed' => 2, 'no_show' => 1, 'cancelled' => 1];
        foreach ($mix as $status => $n) {
            for ($i = 0; $i < $n; $i++) {
                $this->makeAppointment($this->clinic, $this->doctor, $this->patient, self::TODAY, $status);
            }
        }

        // Other days in the same clinic: never counted as "today".
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-26', 'completed');
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-28', 'confirmed');

        // Same day, other clinic: never counted.
        $other = $this->makeClinic('Other');
        $od = $this->makeDoctor($other, 'Dr Other');
        $op = $this->makePatient($other, 'Other', 'Person');
        foreach (['pending', 'checked_in', 'completed', 'no_show'] as $status) {
            $this->makeAppointment($other, $od, $op, self::TODAY, $status);
        }
    }

    #[Test]
    public function summary_returns_clinic_scoped_totals_and_today_count(): void
    {
        $this->seedTodayMix();
        FollowupTask::create(['clinic_id' => $this->clinic->id, 'patient_id' => $this->patient->id, 'due_date' => self::TODAY, 'task_type' => 'call', 'status' => 'pending']);
        FollowupTask::create(['clinic_id' => $this->clinic->id, 'patient_id' => $this->patient->id, 'due_date' => self::TODAY, 'task_type' => 'call', 'status' => 'done']);
        AuditLog::create(['clinic_id' => $this->clinic->id, 'module' => 'patients', 'entity_type' => 'patient', 'action' => 'created', 'created_at' => now()]);

        $admin = $this->makeUser($this->clinic, 'clinic_admin');
        Sanctum::actingAs($admin);

        $res = $this->getJson('/api/clinic/dashboard/summary')->assertOk();

        $res->assertJsonStructure(['success', 'message', 'data' => [
            'total_staff', 'total_doctors', 'total_patients', 'total_appointments',
            'today_appointments', 'pending_followups', 'recent_activity',
        ]]);
        $this->assertSame(1, $res->json('data.total_staff'));
        $this->assertSame(1, $res->json('data.total_doctors'));
        $this->assertSame(1, $res->json('data.total_patients'));
        $this->assertSame(11, $res->json('data.total_appointments'));
        $this->assertSame(9, $res->json('data.today_appointments'));
        $this->assertSame(1, $res->json('data.pending_followups'));
        $this->assertCount(1, $res->json('data.recent_activity'));
    }

    #[Test]
    public function summary_recent_activity_excludes_other_clinics_and_caps_at_ten(): void
    {
        $other = $this->makeClinic('Other');
        for ($i = 0; $i < 12; $i++) {
            AuditLog::create(['clinic_id' => $this->clinic->id, 'module' => 'm', 'entity_type' => 'x', 'action' => 'a'.$i, 'created_at' => now()->subMinutes($i)]);
        }
        AuditLog::create(['clinic_id' => $other->id, 'module' => 'm', 'entity_type' => 'x', 'action' => 'foreign', 'created_at' => now()->addMinute()]);

        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));
        $res = $this->getJson('/api/clinic/dashboard/summary')->assertOk();

        $activity = $res->json('data.recent_activity');
        $this->assertCount(10, $activity);
        $this->assertSame('a0', $activity[0]['action'], 'latest first');
        $this->assertNotContains('foreign', array_column($activity, 'action'));
    }

    #[Test]
    public function receptionist_kpis_count_each_status_for_today_only(): void
    {
        $this->seedTodayMix();
        // A patient registered today in this clinic, plus one in another clinic.
        $other = Clinic::where('name', 'Other')->first();
        $this->makePatient($other, 'Foreign', 'New');

        Sanctum::actingAs($this->makeUser($this->clinic, 'receptionist'));
        $res = $this->getJson('/api/clinic/dashboard/receptionist')->assertOk();

        $res->assertJsonStructure(['data' => [
            'kpis' => ['total_today', 'waiting', 'checked_in', 'in_consultation', 'completed', 'no_show', 'cancelled', 'new_patients_today'],
            'status_breakdown',
            'upcoming',
        ]]);
        $this->assertSame([
            'total_today' => 9,
            'waiting' => 3,          // pending + confirmed
            'checked_in' => 1,
            'in_consultation' => 1,
            'completed' => 2,
            'no_show' => 1,
            'cancelled' => 1,
            'new_patients_today' => 1,
        ], $res->json('data.kpis'));

        $breakdown = collect($res->json('data.status_breakdown'))->pluck('count', 'label')->all();
        $this->assertEquals(['pending' => 2, 'confirmed' => 1, 'checked_in' => 1, 'in_consultation' => 1, 'completed' => 2, 'no_show' => 1, 'cancelled' => 1], $breakdown);
        $this->assertSame(9, array_sum($breakdown));
    }

    #[Test]
    public function receptionist_upcoming_lists_only_waiting_or_checked_in_later_today_in_start_order(): void
    {
        $late = $this->makeAppointment($this->clinic, $this->doctor, $this->patient, self::TODAY, 'pending', ['start_time' => '15:00:00']);
        $early = $this->makeAppointment($this->clinic, $this->doctor, $this->patient, self::TODAY, 'checked_in', ['start_time' => '13:00:00']);
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, self::TODAY, 'completed', ['start_time' => '10:00:00']);
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, self::TODAY, 'in_consultation', ['start_time' => '10:00:00']);
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, self::TODAY, 'cancelled', ['start_time' => '10:00:00']);
        // Already-past slot (now is 06:30 UTC == 12:00 clinic-local).
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, self::TODAY, 'confirmed', ['start_time' => '11:00:00']);
        // Tomorrow.
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-28', 'confirmed', ['start_time' => '09:00:00']);

        Sanctum::actingAs($this->makeUser($this->clinic, 'receptionist'));
        $res = $this->getJson('/api/clinic/dashboard/receptionist')->assertOk();

        $this->assertSame([$early->id, $late->id], array_column($res->json('data.upcoming'), 'id'));
        $this->assertSame('Test Patient', $res->json('data.upcoming.0.patient_name'));
        $this->assertSame('Dr A', $res->json('data.upcoming.0.doctor_name'));
    }

    #[Test]
    public function receptionist_dashboard_is_all_zero_for_an_empty_day(): void
    {
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-26', 'completed');
        Sanctum::actingAs($this->makeUser($this->clinic, 'receptionist'));

        $res = $this->getJson('/api/clinic/dashboard/receptionist')->assertOk();

        $this->assertSame(0, $res->json('data.kpis.total_today'));
        $this->assertSame(0, $res->json('data.kpis.waiting'));
        $this->assertSame([], $res->json('data.status_breakdown'));
        $this->assertSame([], $res->json('data.upcoming'));
    }

    #[Test]
    public function assistant_dashboard_counts_only_assigned_doctors(): void
    {
        $this->seedTodayMix(); // all for Dr A
        $drB = $this->makeDoctor($this->clinic, 'Dr B');
        $this->makeAppointment($this->clinic, $drB, $this->patient, self::TODAY, 'checked_in');
        $this->makeAppointment($this->clinic, $drB, $this->patient, self::TODAY, 'completed');

        Sanctum::actingAs($this->makeAssistant($this->clinic, [$drB]));
        $res = $this->getJson('/api/clinic/dashboard/assistant')->assertOk();

        $this->assertSame(2, $res->json('data.kpis.total_today'));
        $this->assertSame(1, $res->json('data.kpis.checked_in'));
        $this->assertSame(1, $res->json('data.kpis.completed'));
        $this->assertSame(0, $res->json('data.kpis.waiting'));
        $this->assertSame(0, $res->json('data.kpis.no_show'));
        $upcoming = $res->json('data.upcoming');
        $this->assertCount(1, $upcoming);
        $this->assertSame('Dr B', $upcoming[0]['doctor_name']);
    }

    #[Test]
    public function assistant_with_several_doctors_sees_all_of_them(): void
    {
        $this->seedTodayMix(); // 9 for Dr A today
        $drB = $this->makeDoctor($this->clinic, 'Dr B');
        $drC = $this->makeDoctor($this->clinic, 'Dr C');
        $this->makeAppointment($this->clinic, $drB, $this->patient, self::TODAY, 'pending');
        $this->makeAppointment($this->clinic, $drC, $this->patient, self::TODAY, 'pending');

        Sanctum::actingAs($this->makeAssistant($this->clinic, [$this->doctor, $drB]));
        $res = $this->getJson('/api/clinic/dashboard/assistant')->assertOk();

        $this->assertSame(10, $res->json('data.kpis.total_today'));
        $this->assertSame(4, $res->json('data.kpis.waiting'));
        $this->assertSame(10, array_sum(array_column($res->json('data.status_breakdown'), 'count')));
    }

    #[Test]
    public function clinic_admin_dashboard_kpis_and_insights(): void
    {
        $this->seedTodayMix();
        $drB = $this->makeDoctor($this->clinic, 'Dr B');
        // Within the last 30 days (not today), plus one 40 days ago (out of window).
        $this->makeAppointment($this->clinic, $drB, $this->patient, '2026-10-10', 'no_show', ['visit_type' => 'followup', 'booking_channel' => 'phone']);
        $this->makeAppointment($this->clinic, $drB, $this->patient, '2026-09-17', 'completed');
        // Upcoming window (today .. today+6).
        $this->makeAppointment($this->clinic, $drB, $this->patient, '2026-11-02', 'confirmed');
        $this->makeAppointment($this->clinic, $drB, $this->patient, '2026-11-03', 'confirmed'); // today+7: out

        // Follow-ups: 1 overdue pending, 2 due today pending, 1 done in last 7d, other clinic noise.
        $f = fn (string $due, string $status, ?Clinic $c = null, ?Patient $p = null) => FollowupTask::create([
            'clinic_id' => ($c ?? $this->clinic)->id, 'patient_id' => ($p ?? $this->patient)->id,
            'due_date' => $due, 'task_type' => 'call', 'status' => $status,
        ]);
        $f('2026-10-25', 'pending');
        $f(self::TODAY, 'pending');
        $f(self::TODAY, 'pending');
        $f('2026-10-24', 'done');
        $other = Clinic::where('name', 'Other')->first();
        $f('2026-10-20', 'pending', $other, Patient::where('clinic_id', $other->id)->first());

        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));
        $res = $this->getJson('/api/clinic/dashboard/clinic-admin')->assertOk();

        $res->assertJsonStructure(['data' => [
            'kpis' => ['today_appointments', 'today_completed', 'today_pending', 'upcoming_7d_appointments', 'new_patients_30d',
                'appointments_30d', 'no_show_rate_30d', 'cancel_rate_30d', 'followups_overdue', 'followups_due_today'],
            'today' => ['appointment_status'],
            'trends' => ['appointments_30d'],
            'insights' => ['new_vs_repeat_30d', 'booking_sources_30d', 'doctor_performance_30d', 'followup_insights'],
            'alerts',
        ]]);

        $this->assertSame(9, $res->json('data.kpis.today_appointments'));
        $this->assertSame(2, $res->json('data.kpis.today_completed'));
        $this->assertSame(5, $res->json('data.kpis.today_pending')); // pending x2, confirmed, checked_in, in_consultation
        $this->assertSame(1, $res->json('data.kpis.followups_overdue'));
        $this->assertSame(2, $res->json('data.kpis.followups_due_today'));
        $this->assertSame(1, $res->json('data.kpis.new_patients_30d'));

        $todayStatus = collect($res->json('data.today.appointment_status'))->pluck('count', 'status')->all();
        $this->assertSame(9, array_sum($todayStatus));

        $trend = $res->json('data.trends.appointments_30d');
        $this->assertCount(30, $trend);
        $this->assertSame('2026-09-28', $trend[0]['date']);
        $this->assertSame(self::TODAY, $trend[29]['date']);
        $this->assertSame(1, collect($trend)->firstWhere('date', '2026-10-10')['count']);

        $titles = array_column($res->json('data.alerts'), 'title');
        $this->assertContains('Overdue follow-ups', $titles);
        $this->assertContains('Follow-ups due today', $titles);
    }

    /**
     * The 30-day windows use whereBetween('appointment_date', [$from30, $today]).
     * Today's appointments must be inside the window (and the trend point for
     * today must be non-zero).
     */
    #[Test]
    public function clinic_admin_30_day_window_includes_today(): void
    {
        $this->seedTodayMix(); // 9 today: 1 no_show, 1 cancelled
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-10', 'completed', ['visit_type' => 'followup', 'booking_channel' => 'phone']);

        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));
        $res = $this->getJson('/api/clinic/dashboard/clinic-admin')->assertOk();

        $trend = $res->json('data.trends.appointments_30d');
        $this->assertSame(9, $trend[29]['count']);
        // In window: 9 today + 2026-10-26 (seedTodayMix) + 2026-10-10.
        $this->assertSame(11, $res->json('data.kpis.appointments_30d'));
        $this->assertSame(9.1, (float) $res->json('data.kpis.no_show_rate_30d'));
        $this->assertSame(9.1, (float) $res->json('data.kpis.cancel_rate_30d'));
        $this->assertSame(10, $res->json('data.kpis.upcoming_7d_appointments')); // 9 today + 1 tomorrow

        $newVsRepeat = collect($res->json('data.insights.new_vs_repeat_30d'))->pluck('count', 'label')->all();
        $this->assertSame(['New' => 10, 'Repeat' => 1], $newVsRepeat);

        $perf = $res->json('data.insights.doctor_performance_30d');
        $this->assertCount(1, $perf, 'other clinic doctor must not appear');
        $this->assertSame('Dr A', $perf[0]['doctor_name']);
        $this->assertSame(11, $perf[0]['total']);
        $this->assertSame(4, $perf[0]['completed']);
        $this->assertSame(1, $perf[0]['no_show']);
        $this->assertSame(1, $perf[0]['cancelled']);

        $sources = collect($res->json('data.insights.booking_sources_30d'))->pluck('count', 'source')->all();
        $this->assertSame(['walk_in' => 10, 'phone' => 1], $sources);
    }

    #[Test]
    public function clinic_admin_rates_are_null_with_no_appointments(): void
    {
        Sanctum::actingAs($this->makeUser($this->clinic, 'clinic_admin'));
        $res = $this->getJson('/api/clinic/dashboard/clinic-admin')->assertOk();

        $this->assertNull($res->json('data.kpis.no_show_rate_30d'));
        $this->assertNull($res->json('data.kpis.cancel_rate_30d'));
        $this->assertNull($res->json('data.insights.followup_insights.completion_rate_7d'));
        $this->assertSame([], $res->json('data.alerts'));
        $this->assertCount(30, $res->json('data.trends.appointments_30d'));
    }

    /**
     * Doctor-kind users get the clinic-wide summary: the dashboard
     * controller does not narrow by active_doctor_id.
     */
    #[Test]
    public function doctor_user_summary_is_clinic_wide_not_doctor_scoped(): void
    {
        $drB = $this->makeDoctor($this->clinic, 'Dr B');
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, self::TODAY);
        $this->makeAppointment($this->clinic, $drB, $this->patient, self::TODAY);

        Sanctum::actingAs($this->makeDoctorUser($this->clinic, $this->doctor));
        $res = $this->getJson('/api/clinic/dashboard/summary')->assertOk();

        $this->assertSame(2, $res->json('data.today_appointments'));
    }

    // ---------------------------------------------------------------
    // Timezone: the clinic runs on Asia/Kolkata (UTC+05:30) while the
    // app timezone is UTC. Appointment dates/times are clinic-local.
    // ---------------------------------------------------------------

    /**
     * 2026-10-27 20:00 UTC == 2026-10-28 01:30 IST. For the clinic it is
     * already the 28th, so the 28th's appointments are "today".
     */
    #[Test]
    public function today_counts_use_the_clinic_day_just_after_ist_midnight(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-27 20:00:00', 'UTC'));
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-27', 'completed');
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-28', 'confirmed');
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-28', 'checked_in');

        Sanctum::actingAs($this->makeUser($this->clinic, 'receptionist'));

        $rec = $this->getJson('/api/clinic/dashboard/receptionist')->assertOk();
        $this->assertSame(2, $rec->json('data.kpis.total_today'));
        $this->assertSame(0, $rec->json('data.kpis.completed'));

        $sum = $this->getJson('/api/clinic/dashboard/summary')->assertOk();
        $this->assertSame(2, $sum->json('data.today_appointments'));
    }

    /**
     * Just before IST midnight (18:29 UTC == 23:59 IST) both zones agree it
     * is still the 27th: pins the non-buggy side of the boundary.
     */
    #[Test]
    public function today_counts_just_before_ist_midnight_use_same_day(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-27 18:29:00', 'UTC'));
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-27', 'completed');
        $this->makeAppointment($this->clinic, $this->doctor, $this->patient, '2026-10-28', 'confirmed');

        Sanctum::actingAs($this->makeUser($this->clinic, 'receptionist'));
        $res = $this->getJson('/api/clinic/dashboard/receptionist')->assertOk();

        $this->assertSame(1, $res->json('data.kpis.total_today'));
        $this->assertSame(1, $res->json('data.kpis.completed'));
    }

    /**
     * 04:30 UTC == 10:00 IST. A 09:00 (clinic-local) slot is already past and
     * must not be listed as upcoming; an 11:00 slot must be.
     */
    #[Test]
    public function upcoming_list_compares_start_time_in_clinic_local_time(): void
    {
        Carbon::setTestNow(Carbon::parse(self::TODAY.' 04:30:00', 'UTC'));
        $past = $this->makeAppointment($this->clinic, $this->doctor, $this->patient, self::TODAY, 'confirmed', ['start_time' => '09:00:00']);
        $future = $this->makeAppointment($this->clinic, $this->doctor, $this->patient, self::TODAY, 'confirmed', ['start_time' => '11:00:00']);

        Sanctum::actingAs($this->makeUser($this->clinic, 'receptionist'));
        $res = $this->getJson('/api/clinic/dashboard/receptionist')->assertOk();

        $ids = array_column($res->json('data.upcoming'), 'id');
        $this->assertNotContains($past->id, $ids);
        $this->assertContains($future->id, $ids);
    }
}
