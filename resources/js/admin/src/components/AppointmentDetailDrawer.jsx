import React, { useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';
import AppIcon from './AppIcon';
import StatusBadge from './StatusBadge';
import { Alert, Spinner, btn, input, label } from './ui';

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
        <li className="flex items-start justify-between gap-4 px-5 py-3">
            <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{title}</p>
                {description ? <p className="mt-0.5 text-sm text-slate-700">{description}</p> : null}
            </div>
            {meta ? <p className="shrink-0 text-xs text-slate-600">{meta}</p> : null}
        </li>
    );
}

function DrawerSection({ title, description, actions, children, bodyClassName = 'p-5' }) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div className="min-w-0">
                    <h3 className="text-base font-semibold text-slate-900">{title}</h3>
                    {description ? <p className="mt-0.5 text-sm text-slate-600">{description}</p> : null}
                </div>
                {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
            </div>
            <div className={bodyClassName}>{children}</div>
        </section>
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
    const [showUndoConfirm, setShowUndoConfirm] = useState(false);

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

    const undoStatus = async () => {
        setActionLoading(true);
        setActionError('');
        try {
            await client.post(`${base}/appointments/${appointmentId}/undo-status`);
            setShowUndoConfirm(false);
            const res = await client.get(`${base}/appointments/${appointmentId}/detail`);
            setPayload(res.data.data);
            onChanged?.();
        } catch (e) {
            setActionError(e?.response?.data?.message || e?.response?.data?.errors?.status?.[0] || e?.message || 'Undo failed');
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
        setShowUndoConfirm(false);
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
    const statusActions = (() => {
        if (!appt) return [];
        const acts = [];
        if (apptStatus === 'pending')
            acts.push({ label: 'Confirm', status: 'confirmed', style: 'indigo' });
        if (['pending', 'confirmed'].includes(apptStatus))
            acts.push({ label: 'Check in', status: 'checked_in', style: 'emerald' });
        if (apptStatus === 'checked_in')
            acts.push({ label: 'Start consultation', status: 'in_consultation', style: 'violet' });
        if (['checked_in', 'in_consultation'].includes(apptStatus))
            acts.push({ label: 'Complete', status: 'completed', style: 'emerald' });
        // Mirrors AppointmentStatus::allowedTransitions(); in_consultation can only complete.
        if (['pending', 'confirmed', 'checked_in'].includes(apptStatus)) {
            acts.push({ label: 'No show', status: 'no_show', style: 'orange' });
            acts.push({ label: 'Cancel', status: 'cancelled', style: 'rose' });
        }
        return acts.filter((a) => (a.status === 'cancelled' ? canCancel : canCheckIn));
    })();
    // Undo of a cancel / no-show / completion (POST undo-status). The server
    // flags whether the date window is still open; the permission mirrors
    // the one the original transition needed.
    const canUndo = Boolean(appt?.can_undo_status) && (apptStatus === 'cancelled' ? canCancel : canCheckIn);
    const undoLabel = { cancelled: 'cancellation', no_show: 'no-show', completed: 'completion' }[apptStatus] || 'status change';
    // Visual weight per action: the first forward step is the primary
    // button, other forward steps are secondary, cancel is destructive.
    const primaryActionStatus = statusActions.find((a) => !['no_show', 'cancelled'].includes(a.status))?.status;
    const actionClass = (a) => {
        if (a.style === 'rose') return btn.danger;
        if (a.status === primaryActionStatus) return btn.primary;
        return btn.secondary;
    };

    if (!open) return null;

    const patientLabel = appt?.patient?.full_name ? appt.patient.full_name : (appt?.patient_id ? `Patient #${appt.patient_id}` : '—');
    const detailRows = appt ? [
        ['Status', String(appt.status || '—')],
        ['UUID', appt.uuid || '—'],
        ['Patient', appt?.patient?.full_name || (appt.patient_id ? `Patient #${appt.patient_id}` : '—')],
        ['Phone', appt?.patient?.phone || '—'],
        ['Doctor', appt?.doctor?.full_name || (appt.doctor_id ? `Doctor #${appt.doctor_id}` : '—')],
        ['Service', appt.service_id ? `#${appt.service_id}` : '—'],
        ['Visit type', appt.visit_type || '—'],
        ['Consultation', appt.consultation_mode || '—'],
        ['Booking', appt.booking_channel || '—'],
        ['Token', appt.token_number || '—'],
        ['Confirmed at', formatDateTime(appt.confirmed_at) || '—'],
        ['Checked-in at', formatDateTime(appt.checked_in_at) || '—'],
        ['Completed at', formatDateTime(appt.completed_at) || '—'],
        ['Cancelled at', formatDateTime(appt.cancelled_at) || '—'],
        ['Cancellation reason', appt.cancellation_reason || '—', true],
        ['Notes', appt.notes || '—', true],
    ] : [];

    return (
        <div className="fixed inset-0 z-50 flex" aria-modal="true" role="dialog" aria-labelledby="appt-drawer-title">
            <div className="absolute inset-0 bg-slate-950/50" onClick={onClose} />

            <div className="relative ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
                <div className="border-b border-slate-200 bg-white px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-600">Appointment</p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                <h2 id="appt-drawer-title" className="truncate text-lg font-semibold text-slate-900">{patientLabel}</h2>
                                {appt?.status ? <StatusBadge status={appt.status} /> : null}
                            </div>
                            {appt?.appointment_date && appt?.start_time ? (
                                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-700">
                                    <AppIcon name="calendar" className="h-4 w-4 text-slate-500" />
                                    {prettySlotLabel({ date: appt.appointment_date, start: appt.start_time, end: appt.end_time })}
                                </p>
                            ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <button type="button" onClick={downloadAppointmentPdf} className={btn.ghost}>
                                <AppIcon name="download" className="h-4 w-4" />
                                <span className="hidden sm:inline">Download PDF</span>
                                <span className="sr-only sm:hidden">Download PDF</span>
                            </button>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Close"
                                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            >
                                <AppIcon name="close" className="h-5 w-5" />
                            </button>
                        </div>
                    </div>

                    {(statusActions.length > 0 || canUndo) && (
                        <div className="mt-4 space-y-3">
                            {actionError ? <Alert>{actionError}</Alert> : null}

                            <div className="flex flex-wrap gap-2">
                                {statusActions.map((a) => {
                                    if (a.status === 'cancelled') {
                                        return (
                                            <button
                                                key={a.status}
                                                type="button"
                                                disabled={actionLoading}
                                                onClick={() => setShowCancelInput((v) => !v)}
                                                className={actionClass(a)}
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
                                            className={actionClass(a)}
                                        >
                                            {actionLoading ? 'Saving…' : a.label}
                                        </button>
                                    );
                                })}
                                {canUndo ? (
                                    <button
                                        type="button"
                                        disabled={actionLoading}
                                        onClick={() => setShowUndoConfirm((v) => !v)}
                                        className={btn.secondary}
                                    >
                                        <AppIcon name="restore" className="h-4 w-4" />
                                        Undo {undoLabel}
                                    </button>
                                ) : null}
                            </div>

                            {showUndoConfirm && canUndo && (
                                <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                                    <p className="text-sm text-amber-900">
                                        Undo this {undoLabel}? The appointment goes back to its previous status
                                        {apptStatus === 'cancelled' ? ' and the patient is sent the booking confirmation again' : ''}.
                                    </p>
                                    <div className="flex flex-wrap justify-end gap-2">
                                        <button type="button" onClick={() => setShowUndoConfirm(false)} className={btn.secondary}>
                                            Dismiss
                                        </button>
                                        <button type="button" disabled={actionLoading} onClick={undoStatus} className={btn.primary}>
                                            {actionLoading ? 'Undoing…' : 'Confirm undo'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {showCancelInput && (
                                <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                                    <div>
                                        <label htmlFor="appt-cancel-reason" className={label}>Cancellation reason (optional)</label>
                                        <input
                                            id="appt-cancel-reason"
                                            type="text"
                                            value={cancelReason}
                                            onChange={(e) => setCancelReason(e.target.value)}
                                            placeholder="Cancellation reason (optional)"
                                            className={input}
                                        />
                                    </div>
                                    <div className="flex flex-wrap justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => { setShowCancelInput(false); setCancelReason(''); }}
                                            className={btn.secondary}
                                        >
                                            Dismiss
                                        </button>
                                        <button
                                            type="button"
                                            disabled={actionLoading}
                                            onClick={() => changeStatus('cancelled', cancelReason)}
                                            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                                        >
                                            {actionLoading ? 'Cancelling…' : 'Confirm cancel'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-5">
                    {loading ? <Spinner className="py-8" /> : null}
                    {error ? <Alert>{error}</Alert> : null}

                    {appt ? (
                        <DrawerSection title="Appointment details">
                            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                                {detailRows.map(([k, v, wide]) => (
                                    <div key={k} className={wide ? 'sm:col-span-2' : ''}>
                                        <dt className="text-xs font-medium text-slate-600">{k}</dt>
                                        <dd className="mt-0.5 break-words text-sm text-slate-900">{v}</dd>
                                    </div>
                                ))}
                            </dl>
                            {waitlist && (waitlist.waiting_count > 0 || waitlist.held_for) ? (
                                <div className="mt-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                    {waitlist.waiting_count > 0 ? (
                                        <div>{waitlist.waiting_count} waiting for this slot</div>
                                    ) : null}
                                    {waitlist.held_for ? (
                                        <div>Held for {waitlist.held_for.patient_name || 'a patient'} until {formatDateTime(waitlist.held_for.until) || '—'}</div>
                                    ) : null}
                                </div>
                            ) : null}
                        </DrawerSection>
                    ) : null}

                    <DrawerSection title="Timeline" description="Status changes and reschedules." bodyClassName="">
                        <ul className="divide-y divide-slate-100">
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
                        </ul>
                        {!statusLogs.length && !reschedules.length ? (
                            <p className="px-5 py-4 text-sm text-slate-600">No timeline events yet.</p>
                        ) : null}
                    </DrawerSection>

                    <DrawerSection title="Communication and reminders" description="Reminders and WhatsApp message summary for this appointment.">
                        <div className={`grid gap-4 ${canViewWhatsapp && waMessages.length ? 'md:grid-cols-2' : ''}`}>
                            <div>
                                <p className={label}>Reminder status counts</p>
                                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                                    {(reminders?.counts_by_delivery_status || []).map((r) => (
                                        <div key={r.delivery_status} className="flex items-center justify-between px-3 py-2 text-sm">
                                            <span className="text-slate-700">{r.delivery_status}</span>
                                            <span className="font-semibold text-slate-900">{r.count}</span>
                                        </div>
                                    ))}
                                    {!(reminders?.counts_by_delivery_status || []).length ? (
                                        <p className="px-3 py-2 text-sm text-slate-600">No reminders yet.</p>
                                    ) : null}
                                </div>
                            </div>

                            {canViewWhatsapp && waMessages.length ? (
                                <div>
                                    <p className={label}>WhatsApp messages</p>
                                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                                        {waMessages.map((m) => (
                                            <div key={m.id} className="px-3 py-2">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-sm font-medium capitalize text-slate-800">
                                                        {String(m.notification_type || m.message_type || 'message').replaceAll('_', ' ')}
                                                    </span>
                                                    <StatusBadge status={m.delivery_status} />
                                                </div>
                                                <p className="mt-0.5 text-xs text-slate-600">{formatDateTime(m.created_at)}</p>
                                                {m.delivery_status === 'failed' && m.error_message ? (
                                                    <p className="mt-1 text-xs text-rose-700">{m.error_message}</p>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <div className="mt-4">
                            <p className={label}>Recent reminders</p>
                            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                                {(reminders?.recent || []).map((r) => (
                                    <div key={r.id} className="px-3 py-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-medium text-slate-800">{r.channel} · {r.reminder_type}</p>
                                            <p className="text-xs text-slate-600">{r.delivery_status}</p>
                                        </div>
                                        <p className="text-xs text-slate-600">Scheduled: {formatDateTime(r.scheduled_for) || '—'}</p>
                                    </div>
                                ))}
                                {!(reminders?.recent || []).length ? (
                                    <p className="px-3 py-2 text-sm text-slate-600">No reminders linked.</p>
                                ) : null}
                            </div>
                        </div>
                    </DrawerSection>

                    {/* AI Summary Section */}
                    <DrawerSection
                        title="AI appointment summary"
                        description="Record the doctor-patient conversation to generate a structured summary."
                        actions={summary ? (
                            <button type="button" onClick={fetchSummary} className={btn.ghost}>
                                Refresh
                            </button>
                        ) : null}
                    >
                        {summaryError ? <div className="mb-3"><Alert>{summaryError}</Alert></div> : null}

                        {summaryLoading ? <Spinner className="py-6" /> : null}

                        {!summaryLoading && !summary ? (
                            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                                <p className="text-sm text-slate-600">No summary yet. Record the consultation to generate one.</p>
                                {summaryUploading ? (
                                    <div className="flex items-center gap-2 text-sm text-blue-700">
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                                        Transcribing and generating summary…
                                    </div>
                                ) : summaryRecording ? (
                                    <button
                                        type="button"
                                        onClick={stopSummaryRecording}
                                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700"
                                    >
                                        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                                        Stop recording
                                    </button>
                                ) : canPrescribe ? (
                                    <button type="button" onClick={startSummaryRecording} className={btn.secondary}>
                                        <AppIcon name="section" className="h-4 w-4" />
                                        Record &amp; generate summary
                                    </button>
                                ) : null}
                            </div>
                        ) : null}

                        {summary ? (
                            <div className="space-y-3">
                                {summary.patient_summary ? (
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <p className="text-xs font-semibold text-slate-700">Patient summary</p>
                                        <p className="mt-1.5 text-sm leading-relaxed text-slate-800">{summary.patient_summary}</p>
                                    </div>
                                ) : null}

                                {summary.doctor_suggestions ? (
                                    <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                                        <p className="text-xs font-semibold text-blue-800">Doctor suggestions</p>
                                        <p className="mt-1.5 text-sm leading-relaxed text-slate-800">{summary.doctor_suggestions}</p>
                                    </div>
                                ) : null}

                                {(summary.preferred_medications || []).length > 0 ? (
                                    <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                                        <p className="text-xs font-semibold text-amber-800">Preferred medications</p>
                                        <ul className="mt-1.5 space-y-1">
                                            {(summary.preferred_medications || []).map((m, i) => (
                                                <li key={i} className="flex items-start gap-2 text-sm text-slate-800">
                                                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                                                    <span><span className="font-medium">{m.name}</span>{m.note ? ` — ${m.note}` : ''}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ) : null}

                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                                    <span>Generated {formatDateTime(summary.created_at)}</span>
                                    {summaryUploading ? (
                                        <span className="text-blue-700">Regenerating…</span>
                                    ) : summaryRecording ? (
                                        <button
                                            type="button"
                                            onClick={stopSummaryRecording}
                                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 text-xs font-semibold text-white hover:bg-rose-700"
                                        >
                                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                                            Stop recording
                                        </button>
                                    ) : canPrescribe ? (
                                        <button type="button" onClick={startSummaryRecording} className={btn.ghost}>
                                            Regenerate
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        ) : null}
                    </DrawerSection>
                </div>
            </div>
        </div>
    );
}
