<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\Doctor;
use App\Models\Patient;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Barryvdh\DomPDF\Facade\Pdf;

class ReportController extends Controller
{
    use ApiResponse;

    public function appointmentsPdf(Request $request)
    {
        $query = Appointment::query()
            ->with([
                'patient:id,full_name',
                'doctor:id,full_name',
            ]);

        if ($request->filled('clinic_id')) {
            $query->where('clinic_id', $request->input('clinic_id'));
        }

        if ($request->filled('appointment_date')) {
            $query->whereDate('appointment_date', $request->input('appointment_date'));
        }

        if ($request->filled('appointment_date_from')) {
            $query->whereDate('appointment_date', '>=', $request->input('appointment_date_from'));
        }

        if ($request->filled('appointment_date_to')) {
            $query->whereDate('appointment_date', '<=', $request->input('appointment_date_to'));
        }

        foreach (['doctor_id', 'patient_id', 'status'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->input($filter));
            }
        }

        if ($request->boolean('upcoming_only')) {
            $now = Carbon::now(config('app.clinic_timezone', 'Asia/Kolkata'));
            $today = $now->toDateString();
            $time = $now->format('H:i:s');
            $query->where(function (Builder $b) use ($today, $time) {
                $b->whereDate('appointment_date', '>', $today)
                    ->orWhere(function (Builder $q) use ($today, $time) {
                        $q->whereDate('appointment_date', $today)
                            ->where('start_time', '>', $time);
                    });
            });
        }

        $search = trim($request->string('search')->toString());
        if ($search !== '') {
            $query->where(function (Builder $b) use ($search) {
                $b->orWhere('uuid', 'like', "%{$search}%")
                    ->orWhere('status', 'like', "%{$search}%")
                    ->orWhere('visit_type', 'like', "%{$search}%")
                    ->orWhereHas('patient', fn (Builder $q) => $q->where('full_name', 'like', "%{$search}%"))
                    ->orWhereHas('doctor', fn (Builder $q) => $q->where('full_name', 'like', "%{$search}%"));
            });
        }

        $appointments = $query
            ->orderBy('appointment_date', 'desc')
            ->orderBy('start_time', 'desc')
            ->limit(200)
            ->get();

        $summary = [
            'total' => $appointments->count(),
            'completed' => $appointments->where('status', 'completed')->count(),
            'upcoming' => $appointments->whereIn('status', ['pending', 'confirmed', 'checked_in', 'in_consultation'])->count(),
            'cancelled' => $appointments->where('status', 'cancelled')->count(),
        ];

        $pdf = Pdf::loadView('reports.appointments', [
            'title' => 'Appointments Report',
            'generatedAt' => now()->format('Y-m-d H:i'),
            'appointments' => $appointments,
            'summary' => $summary,
            'context' => 'Showing up to 200 records (latest first)',
        ])->setPaper('a4', 'portrait');

        return $pdf->download('appointments-report.pdf');
    }

    public function patientsPdf(Request $request)
    {
        $query = Patient::query();

        if ($request->filled('clinic_id')) {
            $query->where('clinic_id', $request->input('clinic_id'));
        }

        $search = trim($request->string('search')->toString());
        if ($search !== '') {
            $query->where(function (Builder $b) use ($search) {
                $b->orWhere('full_name', 'like', "%{$search}%")
                    ->orWhere('first_name', 'like', "%{$search}%")
                    ->orWhere('last_name', 'like', "%{$search}%")
                    ->orWhere('phone', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        foreach (['status_tag', 'preferred_doctor_id'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->input($filter));
            }
        }

        if ($request->boolean('with_trashed')) {
            $query->withTrashed();
        }

        $patients = $query->orderByDesc('id')->limit(200)->get();
        $patientIds = $patients->pluck('id')->all();

        $stats = [];
        if (! empty($patientIds)) {
            $clinicId = $request->filled('clinic_id') ? (int) $request->input('clinic_id') : null;
            $apptQuery = Appointment::query()->whereIn('patient_id', $patientIds);
            if ($clinicId) {
                $apptQuery->where('clinic_id', $clinicId);
            }

            $rows = $apptQuery
                ->selectRaw('patient_id, status, count(*) as c')
                ->groupBy('patient_id', 'status')
                ->get();

            foreach ($rows as $r) {
                $pid = (int) $r->patient_id;
                $status = (string) ($r->status ?? 'unknown');
                $stats[$pid]['total'] = ($stats[$pid]['total'] ?? 0) + (int) $r->c;
                if ($status === 'completed') {
                    $stats[$pid]['completed'] = ($stats[$pid]['completed'] ?? 0) + (int) $r->c;
                }
                if (in_array($status, ['pending', 'confirmed', 'checked_in', 'in_consultation'], true)) {
                    $stats[$pid]['upcoming'] = ($stats[$pid]['upcoming'] ?? 0) + (int) $r->c;
                }
            }
        }

        $summary = [
            'patients' => $patients->count(),
            'appointments' => array_sum(array_map(fn ($s) => (int) ($s['total'] ?? 0), $stats)),
        ];

        $pdf = Pdf::loadView('reports.patients', [
            'title' => 'Patients Report',
            'generatedAt' => now()->format('Y-m-d H:i'),
            'patients' => $patients,
            'stats' => $stats,
            'summary' => $summary,
        ])->setPaper('a4', 'portrait');

        return $pdf->download('patients-report.pdf');
    }

    public function doctorsPdf(Request $request)
    {
        $query = Doctor::query();

        if ($request->filled('clinic_id')) {
            $query->where('clinic_id', $request->input('clinic_id'));
        }

        $search = trim($request->string('search')->toString());
        if ($search !== '') {
            $query->where(function (Builder $b) use ($search) {
                $b->orWhere('full_name', 'like', "%{$search}%")
                    ->orWhere('specialization', 'like', "%{$search}%")
                    ->orWhere('phone', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        foreach (['status', 'specialization'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->input($filter));
            }
        }

        if ($request->boolean('with_trashed')) {
            $query->withTrashed();
        }

        $doctors = $query->orderByDesc('id')->limit(200)->get();
        $doctorIds = $doctors->pluck('id')->all();

        $stats = [];
        if (! empty($doctorIds)) {
            $clinicId = $request->filled('clinic_id') ? (int) $request->input('clinic_id') : null;
            $apptQuery = Appointment::query()->whereIn('doctor_id', $doctorIds);
            if ($clinicId) {
                $apptQuery->where('clinic_id', $clinicId);
            }

            $rows = $apptQuery
                ->selectRaw('doctor_id, status, count(*) as c')
                ->groupBy('doctor_id', 'status')
                ->get();

            foreach ($rows as $r) {
                $did = (int) $r->doctor_id;
                $status = (string) ($r->status ?? 'unknown');
                $stats[$did]['total'] = ($stats[$did]['total'] ?? 0) + (int) $r->c;
                if ($status === 'completed') {
                    $stats[$did]['completed'] = ($stats[$did]['completed'] ?? 0) + (int) $r->c;
                }
                if (in_array($status, ['pending', 'confirmed', 'checked_in', 'in_consultation'], true)) {
                    $stats[$did]['upcoming'] = ($stats[$did]['upcoming'] ?? 0) + (int) $r->c;
                }
            }
        }

        $summary = [
            'doctors' => $doctors->count(),
            'appointments' => array_sum(array_map(fn ($s) => (int) ($s['total'] ?? 0), $stats)),
        ];

        $pdf = Pdf::loadView('reports.doctors', [
            'title' => 'Doctors Report',
            'generatedAt' => now()->format('Y-m-d H:i'),
            'doctors' => $doctors,
            'stats' => $stats,
            'summary' => $summary,
        ])->setPaper('a4', 'portrait');

        return $pdf->download('doctors-report.pdf');
    }
}
