<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Doctor;
use App\Models\FollowupTask;
use App\Models\Patient;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    use ApiResponse;

    public function summary(Request $request)
    {
        $clinicId = $request->attributes->get('clinic_id');

        return $this->success('Dashboard summary fetched successfully', [
            'total_branches' => Branch::where('clinic_id', $clinicId)->count(),
            'total_staff' => User::where('clinic_id', $clinicId)->count(),
            'total_doctors' => Doctor::where('clinic_id', $clinicId)->count(),
            'total_patients' => Patient::where('clinic_id', $clinicId)->count(),
            'total_appointments' => Appointment::where('clinic_id', $clinicId)->count(),
            'today_appointments' => Appointment::where('clinic_id', $clinicId)->whereDate('appointment_date', now()->toDateString())->count(),
            'pending_followups' => FollowupTask::where('clinic_id', $clinicId)->where('status', 'pending')->count(),
            'recent_activity' => AuditLog::where('clinic_id', $clinicId)->latest('created_at')->limit(10)->get(),
        ]);
    }

    public function clinicAdmin(Request $request)
    {
        $clinicId = (int) $request->attributes->get('clinic_id');

        $today = Carbon::now()->toDateString();
        $from30 = Carbon::now()->subDays(29)->toDateString();
        $from7 = Carbon::now()->subDays(6)->toDateString();
        $to = $today;

        $todayStatus = Appointment::query()
            ->where('clinic_id', $clinicId)
            ->whereDate('appointment_date', $today)
            ->select('status', DB::raw('count(*) as count'))
            ->groupBy('status')
            ->orderByDesc('count')
            ->get()
            ->map(fn ($row) => ['status' => $row->status, 'count' => (int) $row->count])
            ->values();

        $appointmentsTrend30 = Appointment::query()
            ->where('clinic_id', $clinicId)
            ->whereBetween('appointment_date', [$from30, $to])
            ->select(DB::raw('date(appointment_date) as date'), DB::raw('count(*) as count'))
            ->groupBy(DB::raw('date(appointment_date)'))
            ->orderBy('date')
            ->get()
            ->keyBy('date');

        $trendSeries = [];
        for ($d = Carbon::parse($from30); $d->lte(Carbon::parse($to)); $d->addDay()) {
            $key = $d->toDateString();
            $trendSeries[] = [
                'date' => $key,
                'count' => (int) (($appointmentsTrend30[$key]->count ?? 0)),
            ];
        }

        $visitType30 = Appointment::query()
            ->where('clinic_id', $clinicId)
            ->whereBetween('appointment_date', [$from30, $to])
            ->select('visit_type', DB::raw('count(*) as count'))
            ->groupBy('visit_type')
            ->get();

        $newCount = (int) ($visitType30->firstWhere('visit_type', 'new')->count ?? 0);
        $repeatCount = (int) ($visitType30->sum('count') - $newCount);

        $bookingChannels30 = Appointment::query()
            ->where('clinic_id', $clinicId)
            ->whereBetween('appointment_date', [$from30, $to])
            ->select('booking_channel', DB::raw('count(*) as count'))
            ->groupBy('booking_channel')
            ->orderByDesc('count')
            ->get()
            ->map(fn ($row) => ['source' => $row->booking_channel ?: 'unknown', 'count' => (int) $row->count])
            ->values();

        $doctorPerf30 = Appointment::query()
            ->where('appointments.clinic_id', $clinicId)
            ->whereBetween('appointments.appointment_date', [$from30, $to])
            ->leftJoin('doctors', function ($join) {
                $join->on('appointments.doctor_id', '=', 'doctors.id');
            })
            ->select(
                'appointments.doctor_id',
                DB::raw('coalesce(doctors.full_name, "Unassigned") as doctor_name'),
                DB::raw('count(*) as total'),
                DB::raw('sum(case when appointments.status = "completed" then 1 else 0 end) as completed'),
                DB::raw('sum(case when appointments.status = "cancelled" then 1 else 0 end) as cancelled'),
                DB::raw('sum(case when appointments.status = "no_show" then 1 else 0 end) as no_show')
            )
            ->groupBy('appointments.doctor_id', 'doctors.full_name')
            ->orderByDesc('total')
            ->limit(10)
            ->get()
            ->map(fn ($row) => [
                'doctor_id' => $row->doctor_id,
                'doctor_name' => $row->doctor_name,
                'total' => (int) $row->total,
                'completed' => (int) $row->completed,
                'cancelled' => (int) $row->cancelled,
                'no_show' => (int) $row->no_show,
            ])
            ->values();

        $branchPerf30 = Appointment::query()
            ->where('appointments.clinic_id', $clinicId)
            ->whereBetween('appointments.appointment_date', [$from30, $to])
            ->leftJoin('branches', function ($join) {
                $join->on('appointments.branch_id', '=', 'branches.id');
            })
            ->select(
                'appointments.branch_id',
                DB::raw('coalesce(branches.name, "Unassigned") as branch_name'),
                DB::raw('count(*) as total')
            )
            ->groupBy('appointments.branch_id', 'branches.name')
            ->orderByDesc('total')
            ->limit(10)
            ->get()
            ->map(fn ($row) => [
                'branch_id' => $row->branch_id,
                'branch_name' => $row->branch_name,
                'total' => (int) $row->total,
            ])
            ->values();

        $followupsOverdue = FollowupTask::query()
            ->where('clinic_id', $clinicId)
            ->where('status', 'pending')
            ->whereDate('due_date', '<', $today)
            ->count();

        $followupsDueToday = FollowupTask::query()
            ->where('clinic_id', $clinicId)
            ->where('status', 'pending')
            ->whereDate('due_date', $today)
            ->count();

        $followupsDone7 = FollowupTask::query()
            ->where('clinic_id', $clinicId)
            ->whereBetween('due_date', [$from7, $to])
            ->where('status', 'done')
            ->count();

        $followupsTotal7 = FollowupTask::query()
            ->where('clinic_id', $clinicId)
            ->whereBetween('due_date', [$from7, $to])
            ->count();

        $followupCompletionRate7 = $followupsTotal7 > 0 ? round(($followupsDone7 / $followupsTotal7) * 100, 1) : null;

        $appointments30Total = Appointment::where('clinic_id', $clinicId)->whereBetween('appointment_date', [$from30, $to])->count();
        $appointments30NoShow = Appointment::where('clinic_id', $clinicId)->whereBetween('appointment_date', [$from30, $to])->where('status', 'no_show')->count();
        $appointments30Cancelled = Appointment::where('clinic_id', $clinicId)->whereBetween('appointment_date', [$from30, $to])->where('status', 'cancelled')->count();

        $noShowRate30 = $appointments30Total > 0 ? round(($appointments30NoShow / $appointments30Total) * 100, 1) : null;
        $cancelRate30 = $appointments30Total > 0 ? round(($appointments30Cancelled / $appointments30Total) * 100, 1) : null;

        $newPatients30 = Patient::query()
            ->where('clinic_id', $clinicId)
            ->whereBetween(DB::raw('date(created_at)'), [$from30, $to])
            ->count();

        $upcoming7Appointments = Appointment::query()
            ->where('clinic_id', $clinicId)
            ->whereBetween('appointment_date', [$today, Carbon::now()->addDays(6)->toDateString()])
            ->count();

        $alerts = [];
        if ($followupsOverdue > 0) {
            $alerts[] = [
                'severity' => 'high',
                'title' => 'Overdue follow-ups',
                'description' => "{$followupsOverdue} follow-up tasks are overdue.",
                'cta' => ['label' => 'Review Follow-ups', 'to' => '/modules/followups'],
            ];
        }

        if ($noShowRate30 !== null && $noShowRate30 >= 10) {
            $alerts[] = [
                'severity' => 'medium',
                'title' => 'No-show rate is elevated',
                'description' => "No-show rate is {$noShowRate30}% over the last 30 days.",
                'cta' => ['label' => 'View Appointments', 'to' => '/modules/appointments'],
            ];
        }

        if ($followupsDueToday > 0) {
            $alerts[] = [
                'severity' => 'low',
                'title' => 'Follow-ups due today',
                'description' => "{$followupsDueToday} follow-up tasks are due today.",
                'cta' => ['label' => 'Open Follow-ups', 'to' => '/modules/followups'],
            ];
        }

        return $this->success('Clinic admin dashboard fetched successfully', [
            'kpis' => [
                'today_appointments' => Appointment::where('clinic_id', $clinicId)->whereDate('appointment_date', $today)->count(),
                'today_completed' => Appointment::where('clinic_id', $clinicId)->whereDate('appointment_date', $today)->where('status', 'completed')->count(),
                'today_pending' => Appointment::where('clinic_id', $clinicId)->whereDate('appointment_date', $today)->whereIn('status', ['pending', 'confirmed', 'checked_in', 'in_consultation'])->count(),
                'upcoming_7d_appointments' => $upcoming7Appointments,
                'new_patients_30d' => $newPatients30,
                'appointments_30d' => $appointments30Total,
                'no_show_rate_30d' => $noShowRate30,
                'cancel_rate_30d' => $cancelRate30,
                'followups_overdue' => (int) $followupsOverdue,
                'followups_due_today' => (int) $followupsDueToday,
            ],
            'today' => [
                'appointment_status' => $todayStatus,
            ],
            'trends' => [
                'appointments_30d' => $trendSeries,
            ],
            'insights' => [
                'new_vs_repeat_30d' => [
                    ['label' => 'New', 'count' => $newCount],
                    ['label' => 'Repeat', 'count' => max(0, $repeatCount)],
                ],
                'booking_sources_30d' => $bookingChannels30,
                'doctor_performance_30d' => $doctorPerf30,
                'branch_performance_30d' => $branchPerf30,
                'followup_insights' => [
                    'overdue' => (int) $followupsOverdue,
                    'due_today' => (int) $followupsDueToday,
                    'completion_rate_7d' => $followupCompletionRate7,
                ],
            ],
            'alerts' => $alerts,
        ]);
    }

    public function receptionist(Request $request)
    {
        $clinicId  = (int) $request->attributes->get('clinic_id');
        $branchId  = $request->attributes->get('active_branch_id');
        $today     = Carbon::now()->toDateString();
        $nowTime   = Carbon::now()->format('H:i:s');

        $base = Appointment::query()
            ->where('clinic_id', $clinicId)
            ->whereDate('appointment_date', $today);

        if ($branchId) {
            $base->where('branch_id', (int) $branchId);
        }

        // KPI counts
        $totalToday       = (clone $base)->count();
        $pendingCount     = (clone $base)->whereIn('status', ['pending', 'confirmed'])->count();
        $checkedInCount   = (clone $base)->where('status', 'checked_in')->count();
        $inConsultation   = (clone $base)->where('status', 'in_consultation')->count();
        $completedCount   = (clone $base)->where('status', 'completed')->count();
        $noShowCount      = (clone $base)->where('status', 'no_show')->count();
        $cancelledCount   = (clone $base)->where('status', 'cancelled')->count();

        $newPatientsToday = Patient::query()
            ->where('clinic_id', $clinicId)
            ->when($branchId, fn ($q) => $q->where('branch_id', (int) $branchId))
            ->whereDate('created_at', $today)
            ->count();

        // Status breakdown for donut
        $statusBreakdown = (clone $base)
            ->select('status', DB::raw('count(*) as count'))
            ->groupBy('status')
            ->orderByDesc('count')
            ->get()
            ->map(fn ($r) => ['label' => $r->status, 'count' => (int) $r->count])
            ->values();

        // Upcoming appointments (not yet done, ordered by start_time)
        $upcoming = (clone $base)
            ->whereIn('status', ['pending', 'confirmed', 'checked_in'])
            ->where('start_time', '>=', $nowTime)
            ->leftJoin('patients', 'appointments.patient_id', '=', 'patients.id')
            ->leftJoin('doctors', 'appointments.doctor_id', '=', 'doctors.id')
            ->select(
                'appointments.id',
                'appointments.start_time',
                'appointments.status',
                'appointments.visit_type',
                DB::raw('coalesce(patients.full_name, concat(patients.first_name, " ", patients.last_name)) as patient_name'),
                DB::raw('coalesce(doctors.full_name, "—") as doctor_name'),
            )
            ->orderBy('appointments.start_time')
            ->limit(15)
            ->get()
            ->map(fn ($r) => [
                'id'           => $r->id,
                'start_time'   => $r->start_time,
                'status'       => $r->status,
                'visit_type'   => $r->visit_type,
                'patient_name' => $r->patient_name,
                'doctor_name'  => $r->doctor_name,
            ])
            ->values();

        return $this->success('Receptionist dashboard fetched successfully', [
            'kpis' => [
                'total_today'       => $totalToday,
                'waiting'           => $pendingCount,
                'checked_in'        => $checkedInCount,
                'in_consultation'   => $inConsultation,
                'completed'         => $completedCount,
                'no_show'           => $noShowCount,
                'cancelled'         => $cancelledCount,
                'new_patients_today'=> $newPatientsToday,
            ],
            'status_breakdown' => $statusBreakdown,
            'upcoming'         => $upcoming,
        ]);
    }

    public function assistant(Request $request)
    {
        $clinicId  = (int) $request->attributes->get('clinic_id');
        $branchId  = $request->attributes->get('active_branch_id');
        $today     = Carbon::now()->toDateString();
        $nowTime   = Carbon::now()->format('H:i:s');

        // Scope to doctors this assistant is assigned to
        $assignedDoctorIds = $request->user()
            ?->assignedDoctors()
            ->pluck('doctors.id')
            ->toArray() ?? [];

        $base = Appointment::query()
            ->where('clinic_id', $clinicId)
            ->whereDate('appointment_date', $today);

        if ($branchId) {
            $base->where('branch_id', (int) $branchId);
        }
        if (count($assignedDoctorIds) > 0) {
            $base->whereIn('doctor_id', $assignedDoctorIds);
        }

        $totalToday     = (clone $base)->count();
        $pendingCount   = (clone $base)->whereIn('status', ['pending', 'confirmed'])->count();
        $checkedInCount = (clone $base)->where('status', 'checked_in')->count();
        $inConsultation = (clone $base)->where('status', 'in_consultation')->count();
        $completedCount = (clone $base)->where('status', 'completed')->count();
        $noShowCount    = (clone $base)->where('status', 'no_show')->count();
        $cancelledCount = (clone $base)->where('status', 'cancelled')->count();

        $newPatientsToday = Patient::query()
            ->where('clinic_id', $clinicId)
            ->when($branchId, fn ($q) => $q->where('branch_id', (int) $branchId))
            ->whereDate('created_at', $today)
            ->count();

        $statusBreakdown = (clone $base)
            ->select('status', DB::raw('count(*) as count'))
            ->groupBy('status')
            ->orderByDesc('count')
            ->get()
            ->map(fn ($r) => ['label' => $r->status, 'count' => (int) $r->count])
            ->values();

        $upcoming = (clone $base)
            ->whereIn('status', ['pending', 'confirmed', 'checked_in'])
            ->where('start_time', '>=', $nowTime)
            ->leftJoin('patients', 'appointments.patient_id', '=', 'patients.id')
            ->leftJoin('doctors', 'appointments.doctor_id', '=', 'doctors.id')
            ->select(
                'appointments.id',
                'appointments.start_time',
                'appointments.status',
                'appointments.visit_type',
                DB::raw('coalesce(patients.full_name, concat(patients.first_name, " ", patients.last_name)) as patient_name'),
                DB::raw('coalesce(doctors.full_name, "—") as doctor_name'),
            )
            ->orderBy('appointments.start_time')
            ->limit(15)
            ->get()
            ->map(fn ($r) => [
                'id'           => $r->id,
                'start_time'   => $r->start_time,
                'status'       => $r->status,
                'visit_type'   => $r->visit_type,
                'patient_name' => $r->patient_name,
                'doctor_name'  => $r->doctor_name,
            ])
            ->values();

        return $this->success('Assistant dashboard fetched successfully', [
            'kpis' => [
                'total_today'        => $totalToday,
                'waiting'            => $pendingCount,
                'checked_in'         => $checkedInCount,
                'in_consultation'    => $inConsultation,
                'completed'          => $completedCount,
                'no_show'            => $noShowCount,
                'cancelled'          => $cancelledCount,
                'new_patients_today' => $newPatientsToday,
            ],
            'status_breakdown' => $statusBreakdown,
            'upcoming'         => $upcoming,
        ]);
    }
}
