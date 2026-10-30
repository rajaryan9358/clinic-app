import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import client from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import { Alert, Card, PageHeader, Spinner, btn, input as inputClass, label as labelClass } from '../components/ui';
import { modules } from '../config/modules';
import { canAccessModule, isSuperAdminHiddenModuleKey } from '../config/access';
import { useAuth } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';

// The permission check lives in the default-exported wrapper below, not
// here, so this component can call every hook it needs unconditionally.
// (An early-return between two hook calls can change how many hooks run
// between renders of the same mounted instance — e.g. once the scope
// context finishes loading — which React forbids and crashes on.)
function ModuleViewPageInner() {
    const { moduleKey, id } = useParams();
    const module = modules[moduleKey];
    const { user } = useAuth();
    const scope = useScope();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);
    const [record, setRecord] = useState(null);
    const [related, setRelated] = useState({ messages: null });
    const [actionError, setActionError] = useState('');
    const [actionSaving, setActionSaving] = useState(false);
    const [apptStatusReason, setApptStatusReason] = useState('');
    const [undoConfirmOpen, setUndoConfirmOpen] = useState(false);
    const [reschedule, setReschedule] = useState({ appointment_date: '', start_time: '', end_time: '', reason: '' });

    const [waOptions, setWaOptions] = useState({ users: null, doctors: null });
    const [waAssign, setWaAssign] = useState({ user_id: '' });
    const [waFollowup, setWaFollowup] = useState({ due_date: '', task_type: 'whatsapp', assigned_to_user_id: '', note: '' });
    const [waAppt, setWaAppt] = useState({ doctor_id: '', appointment_date: '', start_time: '', visit_type: 'followup', booking_channel: 'whatsapp' });
    const [waActionMsg, setWaActionMsg] = useState({ assign: '', followup: '', appointment: '' });

    useEffect(() => {
        const fetchOne = async () => {
            if (!module) return;
            const { data } = await client.get(`${base}/${module.path}/${id}`);
            setRecord(data.data);
        };
        fetchOne();
    }, [moduleKey, id, base]);

    useEffect(() => {
        if (moduleKey !== 'whatsappConversations') return;
        if (!record) return;

        const today = new Date();
        const toYMD = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        const todayYMD = toYMD(today);

        setWaFollowup((p) => ({ ...p, due_date: p.due_date || todayYMD }));
        setWaAppt((p) => ({
            ...p,
            appointment_date: p.appointment_date || todayYMD,
        }));

        const loadOptions = async () => {
            const clinicId = record?.clinic_id;
            const baseParams = { per_page: 200, sort_by: 'id', sort_dir: 'asc' };
            const scopedParams = user?.role === 'super_admin' && clinicId ? { ...baseParams, clinic_id: clinicId } : baseParams;

            try {
                const [usersRes, doctorsRes] = await Promise.all([
                    client.get(`${base}/users`, { params: { ...scopedParams, status: 'active' } }),
                    client.get(`${base}/doctors`, { params: { ...scopedParams, status: 'active' } }),
                ]);

                const users = usersRes.data?.data || [];
                const doctors = doctorsRes.data?.data || [];
                setWaOptions({ users, doctors });

                setWaAppt((p) => ({
                    ...p,
                    doctor_id: p.doctor_id || '',
                }));
            } catch {
                setWaOptions({ users: [], doctors: [] });
            }
        };

        loadOptions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [moduleKey, record?.id]);

    useEffect(() => {
        const loadRelated = async () => {
            if (!module) return;
            if (moduleKey === 'whatsappConversations') {
                try {
                    const { data } = await client.get(`${base}/whatsapp/messages`, {
                        params: {
                            conversation_id: id,
                            per_page: 50,
                            sort_by: 'id',
                            sort_dir: 'desc',
                        },
                    });
                    setRelated((p) => ({ ...p, messages: data?.data || [] }));
                } catch {
                    setRelated((p) => ({ ...p, messages: [] }));
                }
            }
        };
        loadRelated();
    }, [moduleKey, id, base, module]);

    const hiddenKeys = new Set(['password', 'remember_token', 'clinic_id', 'deleted_at', 'can_undo_status']);
    const entries = Object.entries(record || {}).filter(([key]) => !hiddenKeys.has(key));

    const renderValue = (value) => {
        if (value === null || value === undefined || value === '') return '—';
        // API timestamps (2026-10-27T19:37:43.000000Z) read better in local time.
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
            const d = new Date(value);
            if (!Number.isNaN(d.getTime())) {
                return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
            }
        }
        if (typeof value !== 'object') return String(value);

        if (Array.isArray(value)) return JSON.stringify(value, null, 2);

        const labelKeys = ['name', 'full_name', 'fullName', 'title', 'label'];
        for (const k of labelKeys) {
            if (value && (typeof value[k] === 'string' || typeof value[k] === 'number')) {
                return String(value[k]);
            }
        }

        return JSON.stringify(value, null, 2);
    };

    const lifecycleActions = useMemo(() => {
        const s = String(record?.status || '');
        const actions = [];

        if (s === 'pending') {
            actions.push({ label: 'Confirm', next: 'confirmed', primary: true });
            actions.push({ label: 'Cancel', next: 'cancelled' });
        } else if (s === 'confirmed') {
            actions.push({ label: 'Check In', next: 'checked_in', primary: true });
            actions.push({ label: 'Cancel', next: 'cancelled' });
            actions.push({ label: 'No Show', next: 'no_show' });
        } else if (s === 'checked_in') {
            actions.push({ label: 'Start Consultation', next: 'in_consultation', primary: true });
            actions.push({ label: 'Complete', next: 'completed', primary: true });
            actions.push({ label: 'Cancel', next: 'cancelled' });
        } else if (s === 'in_consultation') {
            actions.push({ label: 'Complete', next: 'completed', primary: true });
        }

        return actions;
    }, [record?.status]);

    if (!module) return <Alert tone="error">Unknown module.</Alert>;

    const runAppointmentStatusChange = async (nextStatus) => {
        if (!nextStatus) return;
        setActionSaving(true);
        setActionError('');
        try {
            await client.post(`${base}/appointments/${id}/lifecycle`, { status: nextStatus, reason: apptStatusReason || null });
            const { data } = await client.get(`${base}/${module.path}/${id}`);
            setRecord(data.data);
            setApptStatusReason('');
        } catch (e) {
            setActionError(e?.response?.data?.message || e?.message || 'Failed to change status');
        } finally {
            setActionSaving(false);
        }
    };

    // Undo of a cancel / no-show / completion (POST undo-status): the server
    // flags whether the date window is open; the permission mirrors the one
    // the original transition needed.
    const recordStatus = String(record?.status || '');
    const canUndoStatus = Boolean(record?.can_undo_status)
        && Boolean(scope?.can?.(recordStatus === 'cancelled' ? 'appointments.cancel' : 'appointments.check_in'));
    const undoLabel = { cancelled: 'cancellation', no_show: 'no-show', completed: 'completion' }[recordStatus] || 'status change';

    const runAppointmentUndo = async () => {
        setActionSaving(true);
        setActionError('');
        try {
            await client.post(`${base}/appointments/${id}/undo-status`);
            const { data } = await client.get(`${base}/${module.path}/${id}`);
            setRecord(data.data);
            setUndoConfirmOpen(false);
        } catch (e) {
            setUndoConfirmOpen(false);
            setActionError(e?.response?.data?.message || e?.message || 'Failed to undo');
        } finally {
            setActionSaving(false);
        }
    };

    const runAppointmentReschedule = async () => {
        setActionSaving(true);
        setActionError('');
        try {
            await client.post(`${base}/appointments/${id}/reschedule`, {
                appointment_date: reschedule.appointment_date,
                start_time: reschedule.start_time,
                end_time: reschedule.end_time || null,
                reason: reschedule.reason || null,
            });
            const { data } = await client.get(`${base}/${module.path}/${id}`);
            setRecord(data.data);
        } catch (e) {
            setActionError(e?.response?.data?.message || e?.message || 'Failed to reschedule');
        } finally {
            setActionSaving(false);
        }
    };

    const runAssignConversation = async () => {
        setActionSaving(true);
        setActionError('');
        setWaActionMsg((p) => ({ ...p, assign: '' }));
        try {
            const payload = {
                current_owner_type: 'staff',
                current_owner_user_id: waAssign.user_id ? Number(waAssign.user_id) : null,
            };
            await client.put(`${base}/${module.path}/${id}`, payload);
            const { data } = await client.get(`${base}/${module.path}/${id}`);
            setRecord(data.data);
            setWaActionMsg((p) => ({ ...p, assign: 'Assigned successfully.' }));
        } catch (e) {
            setActionError(e?.response?.data?.message || e?.message || 'Failed to assign conversation');
        } finally {
            setActionSaving(false);
        }
    };

    const runCreateFollowup = async () => {
        setActionSaving(true);
        setActionError('');
        setWaActionMsg((p) => ({ ...p, followup: '' }));
        try {
            if (!record?.patient_id) throw new Error('This conversation is not linked to a patient');
            const payload = {
                clinic_id: record?.clinic_id,
                patient_id: record?.patient_id,
                assigned_to_user_id: waFollowup.assigned_to_user_id ? Number(waFollowup.assigned_to_user_id) : null,
                due_date: waFollowup.due_date,
                task_type: waFollowup.task_type,
                status: 'pending',
                priority: 'medium',
                note: waFollowup.note || null,
            };
            const { data } = await client.post(`${base}/followups`, payload);
            const newId = data?.data?.id;
            setWaActionMsg((p) => ({
                ...p,
                followup: newId ? `Follow-up created (#${newId}).` : 'Follow-up created.',
            }));
        } catch (e) {
            setActionError(e?.response?.data?.message || e?.message || 'Failed to create follow-up');
        } finally {
            setActionSaving(false);
        }
    };

    const runCreateAppointment = async () => {
        setActionSaving(true);
        setActionError('');
        setWaActionMsg((p) => ({ ...p, appointment: '' }));
        try {
            if (!record?.patient_id) throw new Error('This conversation is not linked to a patient');

            const payload = {
                clinic_id: record?.clinic_id,
                patient_id: record?.patient_id,
                doctor_id: waAppt.doctor_id ? Number(waAppt.doctor_id) : null,
                appointment_date: waAppt.appointment_date,
                start_time: waAppt.start_time,
                end_time: null,
                visit_type: waAppt.visit_type,
                consultation_mode: 'in_person',
                booking_channel: waAppt.booking_channel,
                status: 'pending',
            };

            const { data } = await client.post(`${base}/appointments`, payload);
            const newId = data?.data?.id;
            setWaActionMsg((p) => ({
                ...p,
                appointment: newId ? `Appointment created (#${newId}).` : 'Appointment created.',
            }));
        } catch (e) {
            setActionError(e?.response?.data?.message || e?.message || 'Failed to create appointment');
        } finally {
            setActionSaving(false);
        }
    };

    return (
        <div className="mx-auto max-w-5xl space-y-5">
            <PageHeader
                title={`${module.label} details`}
                subtitle={record?.id ? `Record #${record.id}` : undefined}
                back={{ to: `/modules/${moduleKey}`, label: module.label }}
            />

            {moduleKey === 'appointments' ? (
                <Card title="Appointment actions" description="Guided actions instead of raw log tables.">
                    {actionError ? <div className="mb-4"><Alert tone="error">{actionError}</Alert></div> : null}

                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 p-4">
                            <h3 className="text-sm font-semibold text-slate-900">Change status</h3>
                            <div className="mt-3 grid gap-3">
                                <div>
                                    <label htmlFor="appt-status-reason" className={labelClass}>Reason (optional)</label>
                                    <input id="appt-status-reason" className={`${inputClass} h-10`} placeholder="Reason (optional)" value={apptStatusReason} onChange={(e) => setApptStatusReason(e.target.value)} />
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {lifecycleActions
                                        .filter((a) => scope?.can?.(a.next === 'cancelled' ? 'appointments.cancel' : 'appointments.check_in'))
                                        .map((a) => (
                                        <button
                                            key={a.next}
                                            type="button"
                                            disabled={actionSaving}
                                            onClick={() => runAppointmentStatusChange(a.next)}
                                            className={a.primary ? btn.primary : btn.secondary}
                                        >
                                            {actionSaving ? 'Working…' : a.label}
                                        </button>
                                    ))}
                                    {canUndoStatus ? (
                                        <button
                                            type="button"
                                            disabled={actionSaving}
                                            onClick={() => setUndoConfirmOpen(true)}
                                            className={btn.secondary}
                                        >
                                            Undo {undoLabel}
                                        </button>
                                    ) : null}
                                    {!lifecycleActions.length && !canUndoStatus ? (
                                        <p className="text-sm text-slate-600">No quick actions available.</p>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        {scope?.can?.('appointments.edit') ? (
                            <div className="rounded-xl border border-slate-200 p-4">
                                <h3 className="text-sm font-semibold text-slate-900">Reschedule</h3>
                                <div className="mt-3 grid gap-3">
                                    <div>
                                        <label htmlFor="resched-date" className={labelClass}>Date</label>
                                        <input id="resched-date" type="date" className={`${inputClass} h-10`} value={reschedule.appointment_date} onChange={(e) => setReschedule((p) => ({ ...p, appointment_date: e.target.value }))} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label htmlFor="resched-start" className={labelClass}>Start time</label>
                                            <input id="resched-start" type="time" className={`${inputClass} h-10`} value={reschedule.start_time} onChange={(e) => setReschedule((p) => ({ ...p, start_time: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label htmlFor="resched-end" className={labelClass}>End time</label>
                                            <input id="resched-end" type="time" className={`${inputClass} h-10`} value={reschedule.end_time} onChange={(e) => setReschedule((p) => ({ ...p, end_time: e.target.value }))} />
                                        </div>
                                    </div>
                                    <div>
                                        <label htmlFor="resched-reason" className={labelClass}>Reason (optional)</label>
                                        <input id="resched-reason" className={`${inputClass} h-10`} placeholder="Reason (optional)" value={reschedule.reason} onChange={(e) => setReschedule((p) => ({ ...p, reason: e.target.value }))} />
                                    </div>
                                    <button
                                        type="button"
                                        disabled={!reschedule.appointment_date || !reschedule.start_time || actionSaving}
                                        onClick={runAppointmentReschedule}
                                        className={btn.primary}
                                    >
                                        {actionSaving ? 'Working…' : 'Reschedule'}
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </Card>
            ) : null}

            {moduleKey === 'whatsappConversations' ? (
                <>
                <Card title="Quick actions" description="Act on a conversation without leaving the inbox.">
                    {actionError ? <div className="mb-4"><Alert tone="error">{actionError}</Alert></div> : null}

                    <div className="grid gap-4 lg:grid-cols-3">
                        <div className="rounded-xl border border-slate-200 p-4">
                            <h3 className="text-sm font-semibold text-slate-900">Assign to staff</h3>
                            <p className="mt-1 text-xs text-slate-600">Sets the current owner for handover.</p>
                            <div className="mt-3 grid gap-2">
                                <select
                                    className={`${inputClass} h-10`}
                                    aria-label="Staff user"
                                    value={waAssign.user_id}
                                    onChange={(e) => setWaAssign({ user_id: e.target.value })}
                                >
                                    <option value="">Select staff user</option>
                                    {(waOptions.users || []).map((u) => (
                                        <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    disabled={!waAssign.user_id || actionSaving}
                                    onClick={runAssignConversation}
                                    className={btn.primary}
                                >
                                    {actionSaving ? 'Working…' : 'Assign'}
                                </button>
                                {waActionMsg.assign ? <div className="text-xs text-emerald-700">{waActionMsg.assign}</div> : null}
                            </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 p-4">
                            <h3 className="text-sm font-semibold text-slate-900">Add follow-up</h3>
                            <p className="mt-1 text-xs text-slate-600">Creates a follow-up task for the patient.</p>
                            {!record?.patient_id ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Link a patient to enable follow-ups.</div> : null}
                            <div className="mt-3 grid gap-2">
                                <input type="date" className={`${inputClass} h-10`} aria-label="Due date" value={waFollowup.due_date} onChange={(e) => setWaFollowup((p) => ({ ...p, due_date: e.target.value }))} />
                                <select className={`${inputClass} h-10`} aria-label="Task type" value={waFollowup.task_type} onChange={(e) => setWaFollowup((p) => ({ ...p, task_type: e.target.value }))}>
                                    {['whatsapp', 'call', 'followup_visit', 'review_request', 'lab_reminder', 'custom'].map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <select className={`${inputClass} h-10`} aria-label="Assign to" value={waFollowup.assigned_to_user_id} onChange={(e) => setWaFollowup((p) => ({ ...p, assigned_to_user_id: e.target.value }))}>
                                    <option value="">Assign to (optional)</option>
                                    {(waOptions.users || []).map((u) => (
                                        <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                                    ))}
                                </select>
                                <input className={`${inputClass} h-10`} placeholder="Note (optional)" aria-label="Note" value={waFollowup.note} onChange={(e) => setWaFollowup((p) => ({ ...p, note: e.target.value }))} />
                                <button
                                    type="button"
                                    disabled={!record?.patient_id || !waFollowup.due_date || !waFollowup.task_type || actionSaving}
                                    onClick={runCreateFollowup}
                                    className={btn.primary}
                                >
                                    {actionSaving ? 'Working…' : 'Create Follow-up'}
                                </button>
                                {waActionMsg.followup ? <div className="text-xs text-emerald-700">{waActionMsg.followup}</div> : null}
                            </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 p-4">
                            <h3 className="text-sm font-semibold text-slate-900">Create appointment</h3>
                            <p className="mt-1 text-xs text-slate-600">Creates an appointment for the linked patient.</p>
                            {!record?.patient_id ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Link a patient to enable appointments.</div> : null}
                            <div className="mt-3 grid gap-2">
                                <select className={`${inputClass} h-10`} aria-label="Doctor" value={waAppt.doctor_id} onChange={(e) => setWaAppt((p) => ({ ...p, doctor_id: e.target.value }))}>
                                    <option value="">Select doctor</option>
                                    {(waOptions.doctors || []).map((d) => (
                                        <option key={d.id} value={d.id}>{d.full_name}</option>
                                    ))}
                                </select>
                                <div className="grid grid-cols-2 gap-2">
                                    <input type="date" className={`${inputClass} h-10`} aria-label="Date" value={waAppt.appointment_date} onChange={(e) => setWaAppt((p) => ({ ...p, appointment_date: e.target.value }))} />
                                    <input type="time" className={`${inputClass} h-10`} aria-label="Start time" value={waAppt.start_time} onChange={(e) => setWaAppt((p) => ({ ...p, start_time: e.target.value }))} />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <select className={`${inputClass} h-10`} aria-label="Visit type" value={waAppt.visit_type} onChange={(e) => setWaAppt((p) => ({ ...p, visit_type: e.target.value }))}>
                                        {['new', 'followup', 'routine', 'urgent'].map((v) => <option key={v} value={v}>{v}</option>)}
                                    </select>
                                    <select className={`${inputClass} h-10`} aria-label="Booking channel" value={waAppt.booking_channel} onChange={(e) => setWaAppt((p) => ({ ...p, booking_channel: e.target.value }))}>
                                        {['whatsapp', 'phone', 'walk_in', 'website', 'google', 'staff', 'other'].map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <button
                                    type="button"
                                    disabled={!record?.patient_id || !waAppt.doctor_id || !waAppt.appointment_date || !waAppt.start_time || !waAppt.visit_type || !waAppt.booking_channel || actionSaving}
                                    onClick={runCreateAppointment}
                                    className={btn.primary}
                                >
                                    {actionSaving ? 'Working…' : 'Create Appointment'}
                                </button>
                                {waActionMsg.appointment ? <div className="text-xs text-emerald-700">{waActionMsg.appointment}</div> : null}
                            </div>
                        </div>
                    </div>

                </Card>

                <Card title="Messages" description="Messages are shown inside the conversation (not as a standalone menu item).">
                    <div className="space-y-2">
                        {(related.messages === null) ? (
                            <p className="py-4 text-sm text-slate-600">Loading messages…</p>
                        ) : (related.messages.length === 0) ? (
                            <p className="py-4 text-sm text-slate-600">No messages found.</p>
                        ) : (
                            related.messages.map((m) => (
                                <div key={m.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-medium text-slate-600">{m.direction} · {m.delivery_status}</p>
                                        <p className="text-xs text-slate-500">#{m.id}</p>
                                    </div>
                                    <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap break-words">{m.content_text || m.message_type || '—'}</p>
                                </div>
                            ))
                        )}
                    </div>
                </Card>
                </>
            ) : null}

            <Card title="Details" bodyClassName="px-5 py-2">
                {!record ? <Spinner className="py-10" /> : (
                    <dl className="grid gap-x-8 md:grid-cols-2">
                        {entries.map(([key, value]) => {
                            const text = key.replaceAll('_', ' ');
                            return (
                                <div key={key} className="min-w-0 border-b border-slate-100 py-3">
                                    <dt className="text-xs font-medium text-slate-600">{text.charAt(0).toUpperCase() + text.slice(1)}</dt>
                                    <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-900">{renderValue(value)}</dd>
                                </div>
                            );
                        })}
                    </dl>
                )}
            </Card>

            <ConfirmDialog
                open={undoConfirmOpen}
                title={`Undo ${undoLabel}?`}
                message={`The appointment goes back to its previous status${recordStatus === 'cancelled' ? ' and the patient is sent the booking confirmation again' : ''}.`}
                confirmText="Undo"
                busy={actionSaving}
                onConfirm={runAppointmentUndo}
                onClose={() => setUndoConfirmOpen(false)}
            />
        </div>
    );
}

export default function ModuleViewPage() {
    const { moduleKey } = useParams();
    const { user } = useAuth();
    const scope = useScope();

    if (user?.role === 'super_admin' && isSuperAdminHiddenModuleKey(moduleKey)) {
        return <Navigate to="/dashboard" replace />;
    }

    if (!canAccessModule(user?.role, moduleKey, scope?.can)) {
        return <Navigate to="/dashboard" replace />;
    }

    return <ModuleViewPageInner />;
}
