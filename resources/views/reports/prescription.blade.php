<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $title ?? 'Prescription' }}</title>
    <style>
        * { font-family: DejaVu Sans, sans-serif; }
        body { font-size: 12px; color: #0f172a; }
        h1 { font-size: 18px; margin: 0 0 6px; }
        h2 { font-size: 14px; margin: 14px 0 6px; }
        .muted { color: #64748b; }
        .box { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; margin: 10px 0; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #e2e8f0; padding: 6px 8px; vertical-align: top; }
        th { background: #f8fafc; text-align: left; }
    </style>
</head>
<body>
    <h1>{{ $title ?? 'Prescription' }}</h1>
    <div class="muted">Generated at: {{ $generatedAt ?? now()->format('Y-m-d H:i') }}</div>

    <div class="box">
        <div><strong>Patient:</strong> {{ $patientName ?? '-' }}</div>
        <div><strong>Doctor:</strong> {{ $doctorName ?? '-' }}</div>
        <div><strong>Date:</strong> {{ $appointmentDate ?? '-' }} {{ $appointmentTime ?? '' }}</div>
        <div><strong>Visit Type:</strong> {{ $visitType ?? '-' }}</div>
    </div>

    @php
        $rxData = is_array($prescriptionData ?? null) ? $prescriptionData : [];
        $complaints = is_array($rxData['complaints'] ?? null) ? $rxData['complaints'] : [];
        $diagnosis = trim((string)($rxData['diagnosis'] ?? ''));
        $medicines = is_array($rxData['medicines'] ?? null) ? $rxData['medicines'] : [];
        $advice = is_array($rxData['advice'] ?? null) ? $rxData['advice'] : [];
        $followUp = trim((string)($rxData['follow_up'] ?? ''));
    @endphp

    @if(empty($rxData))
        <div class="box muted">No prescription found.</div>
    @else
        <h2>Complaints</h2>
        <div class="box">
            @if(count($complaints))
                @foreach($complaints as $c)
                    <div>• {{ $c }}</div>
                @endforeach
            @else
                <div class="muted">-</div>
            @endif
        </div>

        <h2>Diagnosis</h2>
        <div class="box">{!! nl2br(e($diagnosis !== '' ? $diagnosis : '-')) !!}</div>

        <h2>Medicines</h2>
        <table>
            <thead>
                <tr>
                    <th style="width: 40%">Medicine</th>
                    <th style="width: 20%">Dosage</th>
                    <th style="width: 20%">Frequency</th>
                    <th style="width: 10%">Days</th>
                    <th style="width: 10%">Notes</th>
                </tr>
            </thead>
            <tbody>
                @forelse($medicines as $m)
                    @php
                        $name = (string)($m['name'] ?? $m['medicine'] ?? '');
                        $dosage = (string)($m['dosage'] ?? '');
                        $frequency = (string)($m['frequency'] ?? $m['timing'] ?? '');
                        $days = (string)($m['days'] ?? $m['duration_days'] ?? '');
                        $notes = (string)($m['notes'] ?? $m['instructions'] ?? '');
                    @endphp
                    <tr>
                        <td>{{ $name !== '' ? $name : '-' }}</td>
                        <td>{{ $dosage !== '' ? $dosage : '-' }}</td>
                        <td>{{ $frequency !== '' ? $frequency : '-' }}</td>
                        <td>{{ $days !== '' ? $days : '-' }}</td>
                        <td>{{ $notes !== '' ? $notes : '-' }}</td>
                    </tr>
                @empty
                    <tr><td colspan="5" class="muted">No medicines.</td></tr>
                @endforelse
            </tbody>
        </table>

        <h2>Advice</h2>
        <div class="box">
            @if(count($advice))
                @foreach($advice as $a)
                    <div>• {{ $a }}</div>
                @endforeach
            @else
                <div class="muted">-</div>
            @endif
        </div>

        <h2>Follow-up</h2>
        <div class="box">{!! nl2br(e($followUp !== '' ? $followUp : '-')) !!}</div>
    @endif
</body>
</html>
