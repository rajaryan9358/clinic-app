import React, { useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';
import AppIcon from './AppIcon';
import StatusBadge from './StatusBadge';

function prettyDateLabel(ymd) {
    try {
        if (!ymd) return '';
        const s = String(ymd);
        const d = s.includes('T') ? new Date(s) : new Date(`${s.slice(0, 10)}T00:00:00`);
        if (Number.isNaN(d.getTime())) return s;
        return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' }).format(d);
    } catch {
        return String(ymd || '');
    }
}

function prettyTimeLabel(value) {
    if (!value) return '';
    const s = String(value);
    // Server provides HH:MM[:SS]
    return s.slice(0, 5);
}

function prettySlotLabel({ date, start, end }) {
    if (!date || !start) return '';
    const day = prettyDateLabel(String(date));
    const time = end ? `${prettyTimeLabel(start)}–${prettyTimeLabel(end)}` : prettyTimeLabel(start);
    return `${day} · ${time}`;
}

function formatDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
    }).format(d);
}

function TimelineItem({ title, meta, description }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-slate-900">{title}</p>
                    {description ? <p className="mt-1 text-sm text-slate-700">{description}</p> : null}
                </div>
                {meta ? <p className="text-xs text-slate-500">{meta}</p> : null}
            </div>
        </div>
    );
}

export default function AppointmentDetailDrawer({ open, appointmentId, onClose, onChanged }) {
    const { user } = useAuth();
    const scope = useScope();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);
    const canCancel = Boolean(scope?.can?.('appointments.cancel'));
    const canCheckIn = Boolean(scope?.can?.('appointments.check_in'));
    const canPrescribe = Boolean(scope?.can?.('appointments.prescribe'));
    // Super admin has no clinic permission list to check against, so the
    // WhatsApp panel is always fetched for them; everyone else needs the
    // explicit permission.
    const canViewWhatsapp = user?.role === 'super_admin' || Boolean(scope?.can?.('whatsapp.view'));

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [payload, setPayload] = useState(null);

    // WhatsApp messages linked to this appointment (Task 6)
    const [waMessages, setWaMessages] = useState([]);

    // Status actions
    const [actionLoading, setActionLoading] = useState(false);
    const [actionError, setActionError] = useState('');
    const [cancelReason, setCancelReason] = useState('');
    const [showCancelInput, setShowCancelInput] = useState(false);

    // Summary state
    const [summary, setSummary] = useState(null);
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState('');
    const [summaryRecording, setSummaryRecording] = useState(false);
    const [summaryUploading, setSummaryUploading] = useState(false);
    const summaryMediaRef = React.useRef(null);
    const summaryChunksRef = React.useRef([]);

    const fetchSummary = async () => {
        if (!appointmentId) return;
        setSummaryLoading(true);
        setSummaryError('');
        try {
            const res = await client.get(`${base}/appointments/${appointmentId}/summary`);
            setSummary(res.data.data?.summary || null);
        } catch (e) {
            setSummaryError(e?.response?.data?.message || e?.message || 'Failed to load summary');
        } finally {
            setSummaryLoading(false);
        }
    };

    const startSummaryRecording = async () => {
        setSummaryError('');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mr = new MediaRecorder(stream);
            summaryChunksRef.current = [];
            mr.ondataavailable = (e) => { if (e.data.size > 0) summaryChunksRef.current.push(e.data); };
            mr.onstop = async () => {
                stream.getTracks().forEach((t) => t.stop());
                const blob = new Blob(summaryChunksRef.current, { type: 'audio/webm' });
                const file = new File([blob], 'summary.webm', { type: 'audio/webm' });
                const formData = new FormData();
                formData.append('audio', file);
                setSummaryUploading(true);
                setSummaryError('');
                try {
                    const res = await client.post(`${base}/appointments/${appointmentId}/summary/voice`, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' },
                    });
                    setSummary(res.data.data || null);
                } catch (e) {
                    setSummaryError(e?.response?.data?.message || e?.message || 'Failed to generate summary');
                } finally {
                    setSummaryUploading(false);
                }
            };
            mr.start();
            summaryMediaRef.current = mr;
            setSummaryRecording(true);
        } catch (e) {
            setSummaryError('Microphone access denied or unavailable');
        }
    };

    const stopSummaryRecording = () => {
        if (summaryMediaRef.current && summaryRecording) {
            summaryMediaRef.current.stop();
            summaryMediaRef.current = null;
        }
        setSummaryRecording(false);
    };

    const downloadBlob = (data, filename) => {
        try {
            const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            // ignore
        }
    };

    const downloadAppointmentPdf = async () => {
        if (!appointmentId) return;
        setError('');
        try {
            const res = await client.get(`${base}/appointments/${appointmentId}/report.pdf`, { responseType: 'blob' });
            downloadBlob(res.data, `appointment-report-${appointmentId}.pdf`);
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to download report');
        }
    };

    const changeStatus = async (status, reason) => {
        setActionLoading(true);
        setActionError('');
        try {
            await client.post(`${base}/appointments/${appointmentId}/lifecycle`, { status, reason: reason || undefined });
            setShowCancelInput(false);
            setCancelReason('');
            // Reload detail data
            const res = await client.get(`${base}/appointments/${appointmentId}/detail`);
            setPayload(res.data.data);
            onChanged?.();
        } catch (e) {
            setActionError(e?.response?.data?.message || e?.response?.data?.errors?.status?.[0] || e?.message || 'Action failed');
        } finally {
            setActionLoading(false);
        }
    };

    useEffect(() => {
        if (!open || !appointmentId) return;
        let cancelled = false;
        setLoading(true);
        setError('');
        setPayload(null);
        setSummary(null);
        setSummaryError('');
        setActionError('');
        setShowCancelInput(false);
        setCancelReason('');
        (async () => {
            try {
                const [detailRes, summaryRes] = await Promise.allSettled([
                    client.get(`${base}/appointments/${appointmentId}/detail`),
                    client.get(`${base}/appointments/${appointmentId}/summary`),
                ]);
                if (cancelled) return;
                if (detailRes.status === 'fulfilled') setPayload(detailRes.value.data.data);
                else setError(detailRes.reason?.response?.data?.message || detailRes.reason?.message || 'Failed to load appointment');
                if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value.data.data?.summary || null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [open, appointmentId, base]);

    useEffect(() => {
        if (!open || !appointmentId || !canViewWhatsapp) {
            setWaMessages([]);
            return;
        }
        let cancelled = false;
        client.get(`${base}/whatsapp/messages`, { params: { appointment_id: appointmentId, per_page: 20, sort_by: 'created_at', sort_dir: 'desc' } })
            .then((res) => {
                if (cancelled) return;
                setWaMessages(Array.isArray(res.data?.data) ? res.data.data : []);
            })
            .catch(() => {
                if (cancelled) return;
                setWaMessages([]);
            });
        return () => { cancelled = true; };
    }, [open, appointmentId, base, canViewWhatsapp]);

    const appt = payload?.appointment;
    const statusLogs = payload?.timeline?.status_changes || [];
    const reschedules = payload?.timeline?.reschedules || [];
    const reminders = payload?.communication?.reminders;
    const waitlist = payload?.waitlist || null;

    // Compute status actions outside JSX to avoid IIFE issues
    const apptStatus = String(appt?.status || '').toLowerCase();
    const isTerminal = ['completed', 'cancelled', 'no_show', 'rescheduled'].includes(apptStatus);
    const statusActions = (() => {
        if (!appt) return [];
        const acts = [];
        if (apptStatus === 'pending')
            acts.push({ label: 'Confirm', status: 'confirmed', style: 'indigo' });
        if (['pending', 'confirmed'].includes(apptStatus))
            acts.push({ label: 'Check In', status: 'checked_in', style: 'emerald' });
        if (apptStatus === 'checked_in')
            acts.push({ label: 'Start Consultation', status: 'in_consultation', style: 'violet' });
        if (['checked_in', 'in_consultation'].includes(apptStatus))
            acts.push({ label: 'Complete', status: 'completed', style: 'emerald' });
        if (['confirmed', 'checked_in', 'in_consultation'].includes(apptStatus))
            acts.push({ label: 'No Show', status: 'no_show', style: 'orange' });
        if (!isTerminal)
            acts.push({ label: 'Cancel', status: 'cancelled', style: 'rose' });
        return acts.filter((a) => (a.status === 'cancelled' ? canCancel : canCheckIn));
    })();
    const actionStyleMap = {
        indigo:  'bg-indigo-600 hover:bg-indigo-700 text-white',
        emerald: 'bg-emerald-600 hover:bg-emerald-700 text-white',
        violet:  'bg-violet-600 hover:bg-violet-700 text-white',
        orange:  'bg-orange-500 hover:bg-orange-600 text-white',
        rose:    'bg-rose-600 hover:bg-rose-700 text-white',
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex" aria-modal="true" role="dialog">
            <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={onClose} />

            <div className="relative ml-auto h-full w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
                <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <AppIcon name="module" className="h-5 w-5 text-slate-700" />
                                <h3 className="text-base font-semibold text-slate-900">Appointment</h3>
                                {appt?.status ? <StatusBadge status={appt.status} /> : null}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-slate-700">
                                    {appt?.patient?.full_name ? appt.patient.full_name : (appt?.patient_id ? `Patient #${appt.patient_id}` : '—')}
                                </span>
                                {appt?.appointment_date && appt?.start_time ? (
                                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800">
                                        {prettySlotLabel({ date: appt.appointment_date, start: appt.start_time, end: appt.end_time })}
                                    </span>
                                ) : null}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                            Close
                        </button>
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={downloadAppointmentPdf}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                            Download PDF
                        </button>
                    </div>
                </div>

                <div className="space-y-4 p-5">
                    {loading ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">Loading…</div>
                    ) : null}
                    {error ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
                    ) : null}

                    {statusActions.length > 0 && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <h4 className="mb-3 text-sm font-semibold text-slate-900">Actions</h4>

                            {actionError ? (
                                <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div>
                            ) : null}

                            <div className="flex flex-wrap gap-2">
                                {statusActions.map((a) => {
                                    if (a.status === 'cancelled') {
                                        return (
                                            <button
                                                key={a.status}
                                                type="button"
                                                disabled={actionLoading}
                                                onClick={() => setShowCancelInput((v) => !v)}
                                                className={`rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50 ${actionStyleMap[a.style]}`}
                                            >
                                                {a.label}
                                            </button>
                                        );
                                    }
                                    return (
                                        <button
                                            key={a.status}
                                            type="button"
                                            disabled={actionLoading}
                                            onClick={() => changeStatus(a.status)}
                                            className={`rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50 ${actionStyleMap[a.style]}`}
                                        >
                                            {actionLoading ? 'Saving…' : a.label}
                                        </button>
                                    );
                                })}
                            </div>

                            {showCancelInput && (
                                <div className="mt-3 flex flex-col gap-2">
                                    <input
                                        type="text"
                                        value={cancelReason}
                                        onChange={(e) => setCancelReason(e.target.value)}
                                        placeholder="Cancellation reason (optional)"
                                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            disabled={actionLoading}
                                            onClick={() => changeStatus('cancelled', cancelReason)}
                                            className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                                        >
                                            {actionLoading ? 'Cancelling…' : 'Confirm Cancel'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setShowCancelInput(false); setCancelReason(''); }}
                                            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                        >
                                            Dismiss
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {appt ? (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <h4 className="text-sm font-semibold text-slate-900">Appointment Details</h4>
                            <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
                                <div><span className="text-slate-500">Status:</span> <span className="font-semibold">{String(appt.status || '—')}</span></div>
                                <div><span className="text-slate-500">UUID:</span> {appt.uuid || '—'}</div>
                                <div><span className="text-slate-500">Patient:</span> {appt?.patient?.full_name || (appt.patient_id ? `Patient #${appt.patient_id}` : '—')}</div>
                                <div><span className="text-slate-500">Phone:</span> {appt?.patient?.phone || '—'}</div>
                                <div><span className="text-slate-500">Doctor:</span> {appt?.doctor?.full_name || (appt.doctor_id ? `Doctor #${appt.doctor_id}` : '—')}</div>
                                <div><span className="text-slate-500">Service:</span> {appt.service_id ? `#${appt.service_id}` : '—'}</div>
                                <div><span className="text-slate-500">Visit type:</span> {appt.visit_type || '—'}</div>
                                <div><span className="text-slate-500">Consultation:</span> {appt.consultation_mode || '—'}</div>
                                <div><span className="text-slate-500">Booking:</span> {appt.booking_channel || '—'}</div>
                                <div><span className="text-slate-500">Token:</span> {appt.token_number || '—'}</div>
                                <div><span className="text-slate-500">Confirmed at:</span> {formatDateTime(appt.confirmed_at) || '—'}</div>
                                <div><span className="text-slate-500">Checked-in at:</span> {formatDateTime(appt.checked_in_at) || '—'}</div>
                                <div><span className="text-slate-500">Completed at:</span> {formatDateTime(appt.completed_at) || '—'}</div>
                                <div><span className="text-slate-500">Cancelled at:</span> {formatDateTime(appt.cancelled_at) || '—'}</div>
                                <div className="md:col-span-2"><span className="text-slate-500">Cancellation reason:</span> {appt.cancellation_reason || '—'}</div>
                                <div className="md:col-span-2"><span className="text-slate-500">Notes:</span> {appt.notes || '—'}</div>
                            </div>
                            {waitlist && (waitlist.waiting_count > 0 || waitlist.held_for) ? (
                                <div className="mt-3 space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                    {waitlist.waiting_count > 0 ? (
                                        <div>{waitlist.waiting_count} waiting for this slot</div>
                                    ) : null}
                                    {waitlist.held_for ? (
                                        <div>Held for {waitlist.held_for.patient_name || 'a patient'} until {formatDateTime(waitlist.held_for.until) || '—'}</div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <h4 className="text-sm font-semibold text-slate-900">Timeline</h4>
                        <p className="mt-1 text-sm text-slate-600">Status changes and reschedules.</p>
                        <div className="mt-3 space-y-2">
                            {[...statusLogs.map((l) => ({
                                kind: 'status',
                                at: l.created_at,
                                title: `${l.old_status || '—'} → ${l.new_status}`,
                                description: l.reason || null,
                            })),
                            ...reschedules.map((l) => ({
                                kind: 'reschedule',
                                at: l.created_at,
                                title: l?.old_appointment_date && l?.old_start_time && l?.new_appointment_date && l?.new_start_time
                                    ? `Rescheduled: ${prettySlotLabel({ date: l.old_appointment_date, start: l.old_start_time, end: l.old_end_time })} → ${prettySlotLabel({ date: l.new_appointment_date, start: l.new_start_time, end: l.new_end_time })}`
                                    : 'Rescheduled',
                                description: l.reason || null,
                            }))]
                                .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
                                .map((it, idx) => (
                                    <TimelineItem
                                        key={`${it.kind}:${it.at}:${idx}`}
                                        title={it.title}
                                        description={it.description}
                                        meta={formatDateTime(it.at)}
                                    />
                                ))}
                            {!statusLogs.length && !reschedules.length ? (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No timeline events yet.</div>
                            ) : null}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <h4 className="text-sm font-semibold text-slate-900">Communication / Reminders</h4>
                        <p className="mt-1 text-sm text-slate-600">Reminders and WhatsApp message summary for this appointment.</p>

                        <div className={`mt-3 grid gap-4 ${canViewWhatsapp && waMessages.length ? 'md:grid-cols-2' : ''}`}>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reminder status counts</p>
                                <div className="mt-2 space-y-1">
                                    {(reminders?.counts_by_delivery_status || []).map((r) => (
                                        <div key={r.delivery_status} className="flex items-center justify-between text-sm">
                                            <span className="text-slate-700">{r.delivery_status}</span>
                                            <span className="font-semibold text-slate-900">{r.count}</span>
                                        </div>
                                    ))}
                                    {!(reminders?.counts_by_delivery_status || []).length ? (
                                        <p className="text-sm text-slate-600">No reminders yet.</p>
                                    ) : null}
                                </div>
                            </div>

                            {canViewWhatsapp && waMessages.length ? (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">WhatsApp Messages</p>
                                    <div className="mt-2 space-y-2">
                                        {waMessages.map((m) => (
                                            <div key={m.id} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                                        {String(m.notification_type || m.message_type || 'message').replaceAll('_', ' ')}
                                                    </span>
                                                    <StatusBadge status={m.delivery_status} />
                                                </div>
                                                <p className="mt-1 text-xs text-slate-500">{formatDateTime(m.created_at)}</p>
                                                {m.delivery_status === 'failed' && m.error_message ? (
                                                    <p className="mt-1 text-xs text-rose-600">{m.error_message}</p>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent reminders</p>
                            <div className="mt-2 space-y-2">
                                {(reminders?.recent || []).map((r) => (
                                    <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm font-medium text-slate-800">{r.channel} · {r.reminder_type}</p>
                                            <p className="text-xs text-slate-500">{r.delivery_status}</p>
                                        </div>
                                            <p className="text-xs text-slate-600">Scheduled: {formatDateTime(r.scheduled_for) || '—'}</p>
                                    </div>
                                ))}
                                {!(reminders?.recent || []).length ? (
                                    <p className="text-sm text-slate-600">No reminders linked.</p>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    {/* AI Summary Section */}
                    <div className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h4 className="text-sm font-semibold text-slate-900">AI Appointment Summary</h4>
                                <p className="mt-0.5 text-xs text-slate-500">Record the doctor-patient conversation to generate a structured summary.</p>
                            </div>
                            {summary ? (
                                <button
                                    type="button"
                                    onClick={fetchSummary}
                                    className="shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                    Refresh
                                </button>
                            ) : null}
                        </div>

                        {summaryError ? (
                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{summaryError}</div>
                        ) : null}

                        {summaryLoading ? (
                            <div className="mt-3 text-sm text-slate-500">Loading summary…</div>
                        ) : null}

                        {!summaryLoading && !summary ? (
                            <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-4 text-center">
                                <p className="text-sm text-slate-600">No summary yet. Record the consultation to generate one.</p>
                                {summaryUploading ? (
                                    <div className="flex items-center gap-2 text-sm text-indigo-600">
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
                                        Transcribing and generating summary…
                                    </div>
                                ) : summaryRecording ? (
                                    <button
                                        type="button"
                                        onClick={stopSummaryRecording}
                                        className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
                                    >
                                        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                                        Stop Recording
                                    </button>
                                ) : canPrescribe ? (
                                    <button
                                        type="button"
                                        onClick={startSummaryRecording}
                                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                                    >
                                        <AppIcon name="section" className="h-4 w-4" />
                                        Record &amp; Generate Summary
                                    </button>
                                ) : null}
                            </div>
                        ) : null}

                        {summary ? (
                            <div className="mt-4 space-y-3">
                                {summary.patient_summary ? (
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Patient Summary</p>
                                        <p className="mt-1.5 text-sm text-slate-800 leading-relaxed">{summary.patient_summary}</p>
                                    </div>
                                ) : null}

                                {summary.doctor_suggestions ? (
                                    <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Doctor Suggestions</p>
                                        <p className="mt-1.5 text-sm text-slate-800 leading-relaxed">{summary.doctor_suggestions}</p>
                                    </div>
                                ) : null}

                                {(summary.preferred_medications || []).length > 0 ? (
                                    <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">Preferred Medications</p>
                                        <ul className="mt-1.5 space-y-1">
                                            {(summary.preferred_medications || []).map((m, i) => (
                                                <li key={i} className="flex items-start gap-2 text-sm text-slate-800">
                                                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                                                    <span><span className="font-medium">{m.name}</span>{m.note ? ` — ${m.note}` : ''}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ) : null}

                                <div className="flex items-center justify-between text-xs text-slate-400">
                                    <span>Generated {formatDateTime(summary.created_at)}</span>
                                    {summaryUploading ? (
                                        <span className="text-indigo-500">Regenerating…</span>
                                    ) : summaryRecording ? (
                                        <button
                                            type="button"
                                            onClick={stopSummaryRecording}
                                            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700"
                                        >
                                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                                            Stop Recording
                                        </button>
                                    ) : canPrescribe ? (
                                        <button
                                            type="button"
                                            onClick={startSummaryRecording}
                                            className="rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                                        >
                                            Regenerate
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
