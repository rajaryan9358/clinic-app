<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $title ?? 'Doctors Report' }}</title>
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
    <h1>{{ $title ?? 'Doctors Report' }}</h1>
    <div class="meta muted">Generated at: {{ $generatedAt ?? now()->format('Y-m-d H:i') }}</div>

    <div class="meta">
        <span class="badge">Doctors: {{ $summary['doctors'] ?? count($doctors ?? []) }}</span>
        @if(isset($summary['appointments'])) <span class="badge">Appointments: {{ $summary['appointments'] }}</span> @endif
    </div>

    <table>
        <thead>
            <tr>
                <th style="width: 28%">Doctor</th>
                <th style="width: 18%">Specialization</th>
                <th style="width: 14%">Phone</th>
                <th style="width: 10%">Status</th>
                <th style="width: 10%">Total Appts</th>
                <th style="width: 10%">Completed</th>
                <th style="width: 10%">Upcoming</th>
            </tr>
        </thead>
        <tbody>
            @forelse(($doctors ?? []) as $d)
                <tr>
                    <td>{{ $d->full_name ?? ('Doctor #'.$d->id) }}</td>
                    <td>{{ $d->specialization ?? '-' }}</td>
                    <td>{{ $d->phone ?? '-' }}</td>
                    <td>{{ $d->status ?? '-' }}</td>
                    <td>{{ (int)($stats[$d->id]['total'] ?? 0) }}</td>
                    <td>{{ (int)($stats[$d->id]['completed'] ?? 0) }}</td>
                    <td>{{ (int)($stats[$d->id]['upcoming'] ?? 0) }}</td>
                </tr>
            @empty
                <tr>
                    <td colspan="7" class="muted">No doctors found.</td>
                </tr>
            @endforelse
        </tbody>
    </table>
</body>
</html>
