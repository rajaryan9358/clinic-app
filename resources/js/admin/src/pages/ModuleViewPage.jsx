import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import client from '../api/client';
import AppIcon from '../components/AppIcon';
import StatusBadge from '../components/StatusBadge';
import { modules } from '../config/modules';
import { canAccessModule, canEditModule, isSuperAdminHiddenModuleKey } from '../config/access';
import { useAuth } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';
import { buildSections, humanizeValue, recordTitle, referenceModule } from '../utils/moduleRecord';
import { formatDate, formatDateTime, formatTime, isDateKey, isDateTimeKey, isTimeKey } from '../utils/dateFormat';
import { formatRupees } from '../utils/money';

const EMPTY_VALUE = <span className="text-slate-300">—</span>;

// One field value, formatted for reading. Same conventions as the list table:
// status-like keys become badges, date keys are formatted, booleans read Yes/No.
function FieldValue({ field, href }) {
    const { key, value, format } = field;

    // A reference the API gave us only as an id: "Appointment #412", linked when we can.
    if (format === 'ref') {
        const text = field.label + ' #' + value;
        return href ? <Link to={href} className="font-medium text-blue-700 hover:underline">{text}</Link> : text;
    }

    if (value === null || value === undefined || value === '') return EMPTY_VALUE;

    if (format === 'boolean' || typeof value === 'boolean') {
        const on = value === true || value === 1 || value === '1';
        return (
            <span className={`inline-flex items-center gap-1 text-sm font-medium ${on ? 'text-emerald-600' : 'text-slate-400'}`}>
                <AppIcon name={on ? 'check' : 'close'} className="h-3.5 w-3.5" />
                {on ? 'Yes' : 'No'}
            </span>
        );
    }

    if (String(key).includes('status')) return <StatusBadge status={String(value)} />;

    if (format === 'json') {
        return <pre className="max-h-72 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">{value}</pre>;
    }

    if (format === 'image') {
        return (
            <a href={String(value)} target="_blank" rel="noreferrer" title="Open full size">
                <img src={String(value)} alt={field.label} className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
            </a>
        );
    }

    if (format === 'money') return formatRupees(value);
    if (format === 'percent') return `${Number(value)}%`;
    if (format === 'minutes') return `${value} min`;
    if (format === 'enum') return humanizeValue(value);

    if (typeof value === 'string') {
        if (isDateTimeKey(key)) return formatDateTime(value);
        if (isDateKey(key)) return formatDate(value);
        if (isTimeKey(key)) return formatTime(value);
    }

    return String(value);
}

// First status-like field on the record, shown beside the title.
function headerStatus(record) {
    const key = ['status', 'conversation_status', 'delivery_status'].find((k) => record?.[k]);
    return key ? record[key] : null;
}

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
    const [loadError, setLoadError] = useState('');
    const [related, setRelated] = useState({ messages: null });
    const [actionError, setActionError] = useState('');
    const [actionSaving, setActionSaving] = useState(false);

    const [waOptions, setWaOptions] = useState({ users: null, doctors: null });
    const [waAssign, setWaAssign] = useState({ user_id: '' });
    const [waFollowup, setWaFollowup] = useState({ due_date: '', task_type: 'whatsapp', assigned_to_user_id: '', note: '' });
    const [waAppt, setWaAppt] = useState({ doctor_id: '', appointment_date: '', start_time: '', visit_type: 'followup', booking_channel: 'whatsapp' });
    const [waActionMsg, setWaActionMsg] = useState({ assign: '', followup: '', appointment: '' });

    // The parent keys this component by module + id, so state starts fresh on
    // every route change; `cancelled` stops a slow response from a page we have
    // already left landing on the new one.
    useEffect(() => {
        if (!module) return undefined;
        let cancelled = false;
        client.get(`${base}/${module.path}/${id}`)
            .then(({ data }) => {
                if (!cancelled) setRecord(data.data);
            })
            .catch((e) => {
                if (!cancelled) setLoadError(e?.response?.data?.message || e?.message || 'Failed to load record');
            });
        return () => {
            cancelled = true;
        };
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
        if (!module || moduleKey !== 'whatsappConversations') return undefined;
        let cancelled = false;
        client.get(`${base}/whatsapp/messages`, {
            params: {
                conversation_id: id,
                per_page: 50,
                sort_by: 'id',
                sort_dir: 'desc',
            },
        })
            .then(({ data }) => {
                if (!cancelled) setRelated((p) => ({ ...p, messages: data?.data || [] }));
            })
            .catch(() => {
                if (!cancelled) setRelated((p) => ({ ...p, messages: [] }));
            });
        return () => {
            cancelled = true;
        };
    }, [moduleKey, id, base, module]);

    const sections = useMemo(() => buildSections(module, record), [module, record]);
    const title = recordTitle(module, record);
    const status = headerStatus(record);
    // Same gate the list uses for its Edit action (and not for a soft-deleted row).
    const canEdit = canEditModule(user?.role, moduleKey, scope?.can) && !record?.deleted_at;

    // Link a bare reference only to a record page this user can already open.
    const hrefFor = (field) => {
        if (field.format !== 'ref') return null;
        const target = referenceModule(field.key);
        if (!target) return null;
        if (target === 'clinics') return user?.role === 'super_admin' ? `/workflows/clinics/${field.value}` : null;
        if (target === 'patients' && scope?.roleKind === 'doctor') return null; // App.jsx blocks doctors from patient profiles
        if (!canAccessModule(user?.role, target, scope?.can)) return null;
        return `/modules/${target}/${field.value}`;
    };

    if (!module) return <div className="rounded border bg-white p-4">Unknown module.</div>;

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
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100">
                        <AppIcon name={module.icon || 'module'} className="h-5 w-5 text-slate-600" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{module.singular || module.label}</p>
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="truncate text-xl font-semibold text-slate-900">{record ? title : '…'}</h2>
                            {status ? <StatusBadge status={String(status)} /> : null}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Link to={`/modules/${moduleKey}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                        Back to {module.label}
                    </Link>
                    {record && canEdit ? (
                        <Link to={`/modules/${moduleKey}/${id}/edit`} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
                            <AppIcon name="edit" className="h-4 w-4" />
                            Edit
                        </Link>
                    ) : null}
                </div>
            </div>

            {loadError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{loadError}</div>
            ) : !record ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">Loading…</div>
            ) : (
                <div className="space-y-4">
                    {sections.length === 0 ? (
                        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">
                            This record has no details to show yet.
                        </div>
                    ) : null}
                    {sections.map((section) => {
                        const body = (
                            <dl className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                                {section.fields.map((field) => (
                                    <div key={field.key} className={`min-w-0 ${field.format === 'json' ? 'sm:col-span-2' : ''}`}>
                                        <dt className="text-xs font-medium text-slate-500">{field.label}</dt>
                                        <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-900">
                                            <FieldValue field={field} href={hrefFor(field)} />
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        );
                        // Technical details stay out of the way until opened.
                        return section.collapsed ? (
                            <details key={section.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <summary className="cursor-pointer text-sm font-semibold text-slate-900">{section.title}</summary>
                                {body}
                            </details>
                        ) : (
                            <section key={section.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <h3 className="text-sm font-semibold text-slate-900">{section.title}</h3>
                                {body}
                            </section>
                        );
                    })}
                </div>
            )}

            {moduleKey === 'whatsappConversations' ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-base font-semibold text-slate-900">Quick Actions</h3>
                    <p className="mt-1 text-sm text-slate-600">Act on a conversation without leaving the inbox.</p>

                    {actionError ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}

                    <div className="mt-4 grid gap-4 lg:grid-cols-3">
                        <div className="rounded-xl border border-slate-200 p-4">
                            <p className="text-sm font-semibold text-slate-800">Assign to Staff</p>
                            <p className="mt-1 text-xs text-slate-600">Sets the current owner for handover.</p>
                            <div className="mt-2 grid gap-2">
                                <select
                                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
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
                                    className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                                >
                                    {actionSaving ? 'Working…' : 'Assign'}
                                </button>
                                {waActionMsg.assign ? <div className="text-xs text-emerald-700">{waActionMsg.assign}</div> : null}
                            </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 p-4">
                            <p className="text-sm font-semibold text-slate-800">Add Follow-up</p>
                            <p className="mt-1 text-xs text-slate-600">Creates a follow-up task for the patient.</p>
                            {!record?.patient_id ? <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Link a patient to enable follow-ups.</div> : null}
                            <div className="mt-2 grid gap-2">
                                <input type="date" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" value={waFollowup.due_date} onChange={(e) => setWaFollowup((p) => ({ ...p, due_date: e.target.value }))} />
                                <select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" value={waFollowup.task_type} onChange={(e) => setWaFollowup((p) => ({ ...p, task_type: e.target.value }))}>
                                    {['whatsapp', 'call', 'followup_visit', 'review_request', 'lab_reminder', 'custom'].map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" value={waFollowup.assigned_to_user_id} onChange={(e) => setWaFollowup((p) => ({ ...p, assigned_to_user_id: e.target.value }))}>
                                    <option value="">Assign to (optional)</option>
                                    {(waOptions.users || []).map((u) => (
                                        <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                                    ))}
                                </select>
                                <input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" placeholder="Note (optional)" value={waFollowup.note} onChange={(e) => setWaFollowup((p) => ({ ...p, note: e.target.value }))} />
                                <button
                                    type="button"
                                    disabled={!record?.patient_id || !waFollowup.due_date || !waFollowup.task_type || actionSaving}
                                    onClick={runCreateFollowup}
                                    className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                                >
                                    {actionSaving ? 'Working…' : 'Create Follow-up'}
                                </button>
                                {waActionMsg.followup ? <div className="text-xs text-emerald-700">{waActionMsg.followup}</div> : null}
                            </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 p-4">
                            <p className="text-sm font-semibold text-slate-800">Create Appointment</p>
                            <p className="mt-1 text-xs text-slate-600">Creates an appointment for the linked patient.</p>
                            {!record?.patient_id ? <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Link a patient to enable appointments.</div> : null}
                            <div className="mt-2 grid gap-2">
                                <select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" value={waAppt.doctor_id} onChange={(e) => setWaAppt((p) => ({ ...p, doctor_id: e.target.value }))}>
                                    <option value="">Select doctor</option>
                                    {(waOptions.doctors || []).map((d) => (
                                        <option key={d.id} value={d.id}>{d.full_name}</option>
                                    ))}
                                </select>
                                <div className="grid grid-cols-2 gap-2">
                                    <input type="date" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" value={waAppt.appointment_date} onChange={(e) => setWaAppt((p) => ({ ...p, appointment_date: e.target.value }))} />
                                    <input type="time" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" value={waAppt.start_time} onChange={(e) => setWaAppt((p) => ({ ...p, start_time: e.target.value }))} />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" value={waAppt.visit_type} onChange={(e) => setWaAppt((p) => ({ ...p, visit_type: e.target.value }))}>
                                        {['new', 'followup', 'routine', 'urgent'].map((v) => <option key={v} value={v}>{v}</option>)}
                                    </select>
                                    <select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" value={waAppt.booking_channel} onChange={(e) => setWaAppt((p) => ({ ...p, booking_channel: e.target.value }))}>
                                        {['whatsapp', 'phone', 'walk_in', 'website', 'google', 'staff', 'other'].map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <button
                                    type="button"
                                    disabled={!record?.patient_id || !waAppt.doctor_id || !waAppt.appointment_date || !waAppt.start_time || !waAppt.visit_type || !waAppt.booking_channel || actionSaving}
                                    onClick={runCreateAppointment}
                                    className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                                >
                                    {actionSaving ? 'Working…' : 'Create Appointment'}
                                </button>
                                {waActionMsg.appointment ? <div className="text-xs text-emerald-700">{waActionMsg.appointment}</div> : null}
                            </div>
                        </div>
                    </div>

                    <div className="mt-5 border-t border-slate-200 pt-5">
                    <h3 className="text-base font-semibold text-slate-900">Messages</h3>
                    <p className="mt-1 text-sm text-slate-600">Messages are shown inside the conversation (not as a standalone menu item).</p>
                    <div className="mt-3 space-y-2">
                        {(related.messages === null) ? (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">Loading messages…</div>
                        ) : (related.messages.length === 0) ? (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">No messages found.</div>
                        ) : (
                            related.messages.map((m) => (
                                <div key={m.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{m.direction} · {m.delivery_status}</p>
                                        <p className="text-xs text-slate-500">#{m.id}</p>
                                    </div>
                                    <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap break-words">{m.content_text || m.message_type || '—'}</p>
                                </div>
                            ))
                        )}
                    </div>
                    </div>
                </div>
            ) : null}

        </div>
    );
}

export default function ModuleViewPage() {
    const { moduleKey, id } = useParams();
    const { user } = useAuth();
    const scope = useScope();

    if (user?.role === 'super_admin' && isSuperAdminHiddenModuleKey(moduleKey)) {
        return <Navigate to="/dashboard" replace />;
    }

    if (!canAccessModule(user?.role, moduleKey, scope?.can)) {
        return <Navigate to="/dashboard" replace />;
    }

    // Keyed so moving between records starts from clean state.
    return <ModuleViewPageInner key={`${moduleKey}:${id}`} />;
}
