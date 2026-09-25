<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $title ?? 'Appointment Report' }}</title>
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
    <h1>{{ $title ?? 'Appointment Report' }}</h1>
    <div class="muted">Generated at: {{ $generatedAt ?? now()->format('Y-m-d H:i') }}</div>

    <div class="box">
        <div><strong>Appointment ID:</strong> {{ $appointment->id }}</div>
        <div><strong>Date:</strong> {{ optional($appointment->appointment_date)->format('Y-m-d') ?? '-' }}</div>
        <div><strong>Time:</strong>
            @php
                $st = $appointment->start_time ? substr((string)$appointment->start_time,0,5) : '';
                $et = $appointment->end_time ? substr((string)$appointment->end_time,0,5) : '';
            @endphp
            {{ $st !== '' ? ($et !== '' ? ($st.'–'.$et) : $st) : '-' }}
        </div>
        <div><strong>Status:</strong> {{ $appointment->status ?? '-' }}</div>
        <div><strong>Visit Type:</strong> {{ $appointment->visit_type ? str_replace('_',' ', (string)$appointment->visit_type) : '-' }}</div>
        <div><strong>Doctor:</strong> {{ $appointment->doctor->full_name ?? ($appointment->doctor_id ? ('Doctor #'.$appointment->doctor_id) : '-') }}</div>
        <div><strong>Patient:</strong> {{ $appointment->patient->full_name ?? ($appointment->patient_id ? ('Patient #'.$appointment->patient_id) : '-') }}</div>
        @if(!empty($appointment->patient?->phone))
            <div><strong>Patient Phone:</strong> {{ $appointment->patient->phone }}</div>
        @endif
        @if(!empty($appointment->uuid))
            <div><strong>Reference:</strong> {{ $appointment->uuid }}</div>
        @endif
        @if(!empty($appointment->token_number))
            <div><strong>Token:</strong> {{ $appointment->token_number }}</div>
        @endif
        @if(!empty($appointment->consultation_mode))
            <div><strong>Consultation:</strong> {{ $appointment->consultation_mode }}</div>
        @endif
        @if(!empty($appointment->booking_channel))
            <div><strong>Booking:</strong> {{ $appointment->booking_channel }}</div>
        @endif
        @if(!empty($appointment->confirmed_at))
            <div><strong>Confirmed at:</strong> {{ optional($appointment->confirmed_at)->format('Y-m-d H:i') }}</div>
        @endif
        @if(!empty($appointment->checked_in_at))
            <div><strong>Checked-in at:</strong> {{ optional($appointment->checked_in_at)->format('Y-m-d H:i') }}</div>
        @endif
        @if(!empty($appointment->completed_at))
            <div><strong>Completed at:</strong> {{ optional($appointment->completed_at)->format('Y-m-d H:i') }}</div>
        @endif
        @if(!empty($appointment->cancelled_at))
            <div><strong>Cancelled at:</strong> {{ optional($appointment->cancelled_at)->format('Y-m-d H:i') }}</div>
        @endif
        @if(!empty($appointment->cancellation_reason))
            <div><strong>Cancellation reason:</strong> {{ $appointment->cancellation_reason }}</div>
        @endif
        @if(!empty($appointment->notes))
            <div><strong>Notes:</strong> {{ $appointment->notes }}</div>
        @endif
        @if(!empty($appointment->service_id))
            <div><strong>Service:</strong> {{ 'Service #'.$appointment->service_id }}</div>
        @endif
    </div>

    @php
        $statusLogs = $statusLogs ?? collect();
        $rescheduleLogs = $rescheduleLogs ?? collect();
    @endphp

    <h2>Timeline</h2>
    @if(($statusLogs instanceof \Illuminate\Support\Collection ? $statusLogs->count() : count($statusLogs)) === 0 && ($rescheduleLogs instanceof \Illuminate\Support\Collection ? $rescheduleLogs->count() : count($rescheduleLogs)) === 0)
        <div class="box muted">No timeline events yet.</div>
    @else
        <h2>Status changes</h2>
        <table>
            <thead>
                <tr>
                    <th style="width: 18%">At</th>
                    <th style="width: 20%">From</th>
                    <th style="width: 20%">To</th>
                    <th style="width: 42%">Reason</th>
                </tr>
            </thead>
            <tbody>
                @forelse($statusLogs as $l)
                    <tr>
                        <td>{{ !empty($l->created_at) ? \Carbon\Carbon::parse($l->created_at)->format('Y-m-d H:i') : '-' }}</td>
                        <td>{{ $l->old_status ?? '-' }}</td>
                        <td>{{ $l->new_status ?? '-' }}</td>
                        <td>{{ $l->reason ?? '-' }}</td>
                    </tr>
                @empty
                    <tr><td colspan="4" class="muted">No status changes.</td></tr>
                @endforelse
            </tbody>
        </table>

        <h2>Reschedules</h2>
        <table>
            <thead>
                <tr>
                    <th style="width: 18%">At</th>
                    <th style="width: 34%">Old slot</th>
                    <th style="width: 34%">New slot</th>
                    <th style="width: 14%">Reason</th>
                </tr>
            </thead>
            <tbody>
                @forelse($rescheduleLogs as $l)
                    @php
                        $oldDate = !empty($l->old_appointment_date) ? \Carbon\Carbon::parse($l->old_appointment_date)->format('Y-m-d') : '-';
                        $newDate = !empty($l->new_appointment_date) ? \Carbon\Carbon::parse($l->new_appointment_date)->format('Y-m-d') : '-';
                        $oldStart = !empty($l->old_start_time) ? substr((string)$l->old_start_time,0,5) : '';
                        $oldEnd = !empty($l->old_end_time) ? substr((string)$l->old_end_time,0,5) : '';
                        $newStart = !empty($l->new_start_time) ? substr((string)$l->new_start_time,0,5) : '';
                        $newEnd = !empty($l->new_end_time) ? substr((string)$l->new_end_time,0,5) : '';
                        $oldTime = $oldStart !== '' ? ($oldEnd !== '' ? ($oldStart.'–'.$oldEnd) : $oldStart) : '';
                        $newTime = $newStart !== '' ? ($newEnd !== '' ? ($newStart.'–'.$newEnd) : $newStart) : '';
                        $old = trim($oldDate . ' ' . $oldTime);
                        $new = trim($newDate . ' ' . $newTime);
                    @endphp
                    <tr>
                        <td>{{ !empty($l->created_at) ? \Carbon\Carbon::parse($l->created_at)->format('Y-m-d H:i') : '-' }}</td>
                        <td>{{ $old !== '' ? $old : '-' }}</td>
                        <td>{{ $new !== '' ? $new : '-' }}</td>
                        <td>{{ $l->reason ?? '-' }}</td>
                    </tr>
                @empty
                    <tr><td colspan="4" class="muted">No reschedules.</td></tr>
                @endforelse
            </tbody>
        </table>
    @endif

    @php
        $rxData = is_array($prescriptionData ?? null) ? $prescriptionData : [];
        $complaints = is_array($rxData['complaints'] ?? null) ? $rxData['complaints'] : [];
        $diagnosis = trim((string)($rxData['diagnosis'] ?? ''));
        $medicines = is_array($rxData['medicines'] ?? null) ? $rxData['medicines'] : [];
        $advice = is_array($rxData['advice'] ?? null) ? $rxData['advice'] : [];
        $followUp = trim((string)($rxData['follow_up'] ?? ''));
    @endphp

    <h2>Prescription</h2>
    @if(empty($rxData))
        <div class="box muted">No prescription found for this appointment.</div>
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
                    <th style="width: 38%">Medicine</th>
                    <th style="width: 18%">Dosage</th>
                    <th style="width: 22%">Frequency</th>
                    <th style="width: 12%">Days</th>
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
