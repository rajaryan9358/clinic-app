<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $title ?? 'Patient Report' }}</title>
    <style>
        * { font-family: DejaVu Sans, sans-serif; }
        body { font-size: 12px; color: #0f172a; }
        h1 { font-size: 18px; margin: 0 0 6px; }
        h2 { font-size: 14px; margin: 14px 0 6px; }
        .muted { color: #64748b; }
        .grid { width: 100%; }
        .box { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; margin: 10px 0; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #e2e8f0; padding: 6px 8px; vertical-align: top; }
        th { background: #f8fafc; text-align: left; }
    </style>
</head>
<body>
    <h1>{{ $title ?? 'Patient Report' }}</h1>
    <div class="muted">Generated at: {{ $generatedAt ?? now()->format('Y-m-d H:i') }}</div>

    <div class="box">
        <div><strong>Name:</strong> {{ $patient->full_name ?? ('Patient #'.$patient->id) }}</div>
        <div><strong>Phone:</strong> {{ $patient->phone ?? '-' }}</div>
        <div><strong>Email:</strong> {{ $patient->email ?? '-' }}</div>
        <div><strong>Branch:</strong> {{ $patient->branch->name ?? ($patient->branch_id ? ('Branch #'.$patient->branch_id) : '-') }}</div>
        <div><strong>Status:</strong> {{ $patient->status_tag ?? '-' }}</div>
    </div>

    <h2>Medical History</h2>
    <div class="box">
        <div><strong>Allergies:</strong> {{ $medical?->allergies ?? '-' }}</div>
        <div><strong>Chronic Conditions:</strong> {{ $medical?->chronic_conditions ?? '-' }}</div>
        <div><strong>Current Medications:</strong> {{ $medical?->current_medications ?? '-' }}</div>
        <div><strong>Surgeries History:</strong> {{ $medical?->surgeries_history ?? '-' }}</div>
        <div><strong>Family History:</strong> {{ $medical?->family_history ?? '-' }}</div>
        <div><strong>Notes:</strong> {{ $medical?->notes ?? '-' }}</div>
    </div>

    <h2>Follow-ups</h2>
    <table>
        <thead>
            <tr>
                <th style="width: 18%">Due Date</th>
                <th style="width: 20%">Type</th>
                <th style="width: 16%">Status</th>
                <th>Notes</th>
            </tr>
        </thead>
        <tbody>
            @forelse(($followups ?? []) as $f)
                <tr>
                    <td>{{ optional($f->due_date)->format('Y-m-d') ?? '-' }} {{ $f->due_time ? substr((string)$f->due_time,0,5) : '' }}</td>
                    <td>{{ $f->task_type ?? '-' }}</td>
                    <td>{{ $f->status ?? '-' }}</td>
                    <td>{{ $f->notes ?? '-' }}</td>
                </tr>
            @empty
                <tr><td colspan="4" class="muted">No follow-ups found.</td></tr>
            @endforelse
        </tbody>
    </table>

    <h2>Appointment History</h2>
    <table>
        <thead>
            <tr>
                <th style="width: 16%">Date</th>
                <th style="width: 10%">Time</th>
                <th style="width: 24%">Doctor</th>
                <th style="width: 18%">Branch</th>
                <th style="width: 16%">Status</th>
                <th style="width: 16%">Type</th>
            </tr>
        </thead>
        <tbody>
            @forelse(($appointments ?? []) as $a)
                <tr>
                    <td>{{ optional($a->appointment_date)->format('Y-m-d') ?? '-' }}</td>
                    <td>{{ $a->start_time ? substr((string)$a->start_time,0,5) : '-' }}</td>
                    <td>{{ $a->doctor->full_name ?? ($a->doctor_id ? ('Doctor #'.$a->doctor_id) : '-') }}</td>
                    <td>{{ $a->branch->name ?? ($a->branch_id ? ('Branch #'.$a->branch_id) : '-') }}</td>
                    <td>{{ $a->status ?? '-' }}</td>
                    <td>{{ $a->visit_type ? str_replace('_',' ', (string)$a->visit_type) : '-' }}</td>
                </tr>
            @empty
                <tr><td colspan="6" class="muted">No appointments found.</td></tr>
            @endforelse
        </tbody>
    </table>

    <h2>Notes</h2>
    <table>
        <thead>
            <tr>
                <th style="width: 16%">Date</th>
                <th style="width: 16%">Type</th>
                <th>Note</th>
            </tr>
        </thead>
        <tbody>
            @forelse(($notes ?? []) as $n)
                <tr>
                    <td>{{ optional($n->created_at)->format('Y-m-d') ?? '-' }}</td>
                    <td>{{ $n->note_type ?? '-' }}</td>
                    <td>{{ $n->note ?? '-' }}</td>
                </tr>
            @empty
                <tr><td colspan="3" class="muted">No notes found.</td></tr>
            @endforelse
        </tbody>
    </table>
</body>
</html>
