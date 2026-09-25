<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $title ?? 'Appointments Report' }}</title>
    <style>
        * { font-family: DejaVu Sans, sans-serif; }
        body { font-size: 12px; color: #0f172a; }
        h1 { font-size: 18px; margin: 0 0 6px; }
        .muted { color: #64748b; }
        .meta { margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #e2e8f0; padding: 6px 8px; vertical-align: top; }
        th { background: #f8fafc; text-align: left; }
        .badge { display: inline-block; padding: 2px 6px; border-radius: 10px; border: 1px solid #cbd5e1; font-size: 11px; }
    </style>
</head>
<body>
    <h1>{{ $title ?? 'Appointments Report' }}</h1>
    <div class="meta muted">
        Generated at: {{ $generatedAt ?? now()->format('Y-m-d H:i') }}
        @if(!empty($context))
            &nbsp;•&nbsp; {{ $context }}
        @endif
    </div>

    @if(!empty($summary))
        <div class="meta">
            <span class="badge">Total: {{ $summary['total'] ?? count($appointments ?? []) }}</span>
            @if(isset($summary['completed'])) <span class="badge">Completed: {{ $summary['completed'] }}</span> @endif
            @if(isset($summary['upcoming'])) <span class="badge">Upcoming: {{ $summary['upcoming'] }}</span> @endif
            @if(isset($summary['cancelled'])) <span class="badge">Cancelled: {{ $summary['cancelled'] }}</span> @endif
        </div>
    @endif

    <table>
        <thead>
            <tr>
                <th style="width: 16%">Date</th>
                <th style="width: 10%">Time</th>
                <th style="width: 20%">Patient</th>
                <th style="width: 20%">Doctor</th>
                <th style="width: 10%">Type</th>
                <th style="width: 10%">Status</th>
            </tr>
        </thead>
        <tbody>
            @forelse(($appointments ?? []) as $a)
                <tr>
                    <td>{{ optional($a->appointment_date)->format('Y-m-d') ?? '-' }}</td>
                    <td>{{ $a->start_time ? substr((string)$a->start_time, 0, 5) : '-' }}</td>
                    <td>{{ $a->patient->full_name ?? ($a->patient_id ? ('Patient #'.$a->patient_id) : '-') }}</td>
                    <td>{{ $a->doctor->full_name ?? ($a->doctor_id ? ('Doctor #'.$a->doctor_id) : '-') }}</td>
                    <td>{{ $a->visit_type ? str_replace('_',' ', (string)$a->visit_type) : '-' }}</td>
                    <td>{{ $a->status ?? '-' }}</td>
                </tr>
            @empty
                <tr>
                    <td colspan="6" class="muted">No appointments found.</td>
                </tr>
            @endforelse
        </tbody>
    </table>
</body>
</html>
