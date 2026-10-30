import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import client from '../../api/client';
import { useScope } from '../../context/ScopeContext';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, btn, input, label } from '../../components/ui';

// ── helpers ──────────────────────────────────────────────────────────────────
const inputBase = input;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayLabel(d) { return DAY_NAMES[Number(d)] ?? String(d); }
function fmtTime(t) { if (!t) return ''; return String(t).slice(0, 5); }

function generateSlots(startTime, endTime, durationMin) {
    if (!startTime || !endTime || !durationMin) return [];
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const slots = [];
    let cur = sh * 60 + sm;
    const end = eh * 60 + em;
    while (cur + durationMin <= end) {
        slots.push(`${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`);
        cur += durationMin;
    }
    return slots;
}

function modeChipClass(mode) {
    if (mode === 'video') return 'bg-violet-50 text-violet-800 border-violet-200';
    if (mode === 'both') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    return 'bg-blue-50 text-blue-800 border-blue-200';
}
function modeTone(mode) {
    if (mode === 'video') return 'violet';
    if (mode === 'both') return 'green';
    return 'blue';
}
function modeLabel(mode) {
    if (mode === 'in_person') return 'Walk-in';
    if (mode === 'video') return 'Video';
    if (mode === 'both') return 'Both';
    return mode;
}

// ── page ──────────────────────────────────────────────────────────────────────
export default function DoctorAvailabilityPage() {
    const { context, roleKind, ready, can } = useScope() || {};
    const doctorId = context?.active_doctor_id;
    const base = '/clinic';
    const canAddSchedule = Boolean(can?.('doctor_schedules.create'));
    const canRemoveSchedule = Boolean(can?.('doctor_schedules.delete'));

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [scheduleDraft, setScheduleDraft] = useState({
        day_of_week: '1',
        start_time: '10:00',
        end_time: '13:00',
        consultation_mode: 'in_person',
        max_patients: '',
        slot_duration_minutes: '',
        buffer_time_minutes: '',
        is_active: true,
    });
    const [scheduleSaving, setScheduleSaving] = useState(false);

    const [exceptionDraft, setExceptionDraft] = useState({
        exception_date: new Date().toISOString().slice(0, 10),
        type: 'leave',
        start_time: '',
        end_time: '',
        reason: '',
    });
    const [exceptionSaving, setExceptionSaving] = useState(false);

    const loadProfile = async () => {
        if (!doctorId) return;
        setLoading(true);
        setError('');
        try {
            const res = await client.get(`${base}/doctors/${doctorId}/profile`);
            const d = res.data?.data || null;
            setData(d);
            const doc = d?.doctor;
            if (doc) {
                setScheduleDraft((p) => ({
                    ...p,
                    slot_duration_minutes: doc.slot_duration_minutes ?? 15,
                    buffer_time_minutes: doc.buffer_time_minutes ?? 0,
                }));
            }
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to load profile');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadProfile();
    }, [doctorId]);

    const schedulesByDay = useMemo(() => {
        const map = {};
        for (const s of (data?.doctor?.schedules || [])) {
            const d = String(s.day_of_week);
            if (!map[d]) map[d] = [];
            map[d].push(s);
        }
        return map;
    }, [data]);

    const slotDuration = Number(data?.doctor?.slot_duration_minutes) || 15;

    const addSchedule = async () => {
        setScheduleSaving(true);
        setError('');
        try {
            await client.post(`${base}/doctors/${doctorId}/schedules`, {
                day_of_week: Number(scheduleDraft.day_of_week),
                start_time: scheduleDraft.start_time,
                end_time: scheduleDraft.end_time,
                consultation_mode: scheduleDraft.consultation_mode,
                max_patients: scheduleDraft.max_patients === '' ? null : Number(scheduleDraft.max_patients),
                slot_duration_minutes: scheduleDraft.slot_duration_minutes === '' ? null : Number(scheduleDraft.slot_duration_minutes),
                buffer_time_minutes: scheduleDraft.buffer_time_minutes === '' ? null : Number(scheduleDraft.buffer_time_minutes),
                is_active: Boolean(scheduleDraft.is_active),
            });
            await loadProfile();
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to add schedule');
        } finally {
            setScheduleSaving(false);
        }
    };

    const removeSchedule = async (scheduleId) => {
        setError('');
        try {
            await client.delete(`${base}/doctors/${doctorId}/schedules/${scheduleId}`);
            await loadProfile();
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to remove schedule');
        }
    };

    const addException = async () => {
        setExceptionSaving(true);
        setError('');
        try {
            await client.post(`${base}/doctors/${doctorId}/exceptions`, {
                exception_date: exceptionDraft.exception_date,
                type: exceptionDraft.type,
                start_time: exceptionDraft.start_time || null,
                end_time: exceptionDraft.end_time || null,
                reason: exceptionDraft.reason || null,
            });
            await loadProfile();
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to add exception');
        } finally {
            setExceptionSaving(false);
        }
    };

    const removeException = async (exceptionId) => {
        setError('');
        try {
            await client.delete(`${base}/doctors/${doctorId}/exceptions/${exceptionId}`);
            await loadProfile();
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to remove exception');
        }
    };

    // Wait for the scope context to load before deciding: roleKind is empty
    // during that brief window, and redirecting on that would incorrectly
    // bounce a real doctor off their own availability page on page load.
    // This check runs after every hook above so hook order never changes
    // between renders (React requires hooks to run unconditionally).
    if (ready && roleKind !== 'doctor') return <Navigate to="/dashboard" replace />;

    if (!doctorId) return null;

    if (loading) {
        return <Spinner className="py-20" />;
    }

    const setS = (key) => (e) => setScheduleDraft((p) => ({ ...p, [key]: e.target.value }));
    const setX = (key) => (e) => setExceptionDraft((p) => ({ ...p, [key]: e.target.value }));
    const previewSlots = scheduleDraft.start_time && scheduleDraft.end_time && (scheduleDraft.slot_duration_minutes || slotDuration)
        ? generateSlots(scheduleDraft.start_time, scheduleDraft.end_time, Number(scheduleDraft.slot_duration_minutes || slotDuration))
        : null;

    return (
        <div className="mx-auto max-w-[1400px] space-y-5">
            <PageHeader title="Availability" subtitle="Manage your weekly schedules and one-off exceptions." />

            {error && <Alert>{error}</Alert>}

            <div className="grid items-start gap-5 xl:grid-cols-2">

                {/* ── LEFT: Schedules ── */}
                <div className="space-y-5">
                    <Card
                        title="Add schedule"
                        description="Recurring weekly working hours per day."
                        actions={canAddSchedule ? (
                            <button type="button" onClick={addSchedule} disabled={scheduleSaving} className={btn.primary}>
                                {scheduleSaving ? 'Saving…' : 'Add'}
                            </button>
                        ) : null}
                    >
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label htmlFor="av-day" className={label}>Day</label>
                                <select id="av-day" className={inputBase} value={scheduleDraft.day_of_week} onChange={setS('day_of_week')}>
                                    {DAY_NAMES.map((name, i) => <option key={i} value={String(i)}>{name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="av-mode" className={label}>Mode</label>
                                <select id="av-mode" className={inputBase} value={scheduleDraft.consultation_mode} onChange={setS('consultation_mode')}>
                                    <option value="in_person">Walk-in (in person)</option>
                                    <option value="video">Video</option>
                                    <option value="both">Both</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="av-start" className={label}>Start time</label>
                                <input id="av-start" type="time" className={inputBase} value={scheduleDraft.start_time} onChange={setS('start_time')} />
                            </div>
                            <div>
                                <label htmlFor="av-end" className={label}>End time</label>
                                <input id="av-end" type="time" className={inputBase} value={scheduleDraft.end_time} onChange={setS('end_time')} />
                            </div>
                            <div>
                                <label htmlFor="av-slot" className={label}>Slot duration (min)</label>
                                <input id="av-slot" type="number" className={inputBase} placeholder={`Default: ${slotDuration}`} value={scheduleDraft.slot_duration_minutes} onChange={setS('slot_duration_minutes')} />
                            </div>
                            <div>
                                <label htmlFor="av-buffer" className={label}>Buffer time (min)</label>
                                <input id="av-buffer" type="number" className={inputBase} placeholder={`Default: ${data?.doctor?.buffer_time_minutes ?? 0}`} value={scheduleDraft.buffer_time_minutes} onChange={setS('buffer_time_minutes')} />
                            </div>
                            <div>
                                <label htmlFor="av-max" className={label}>Max patients (optional)</label>
                                <input id="av-max" type="number" className={inputBase} value={scheduleDraft.max_patients} onChange={setS('max_patients')} />
                            </div>
                            <div className="flex items-end">
                                <label className="inline-flex h-10 cursor-pointer items-center gap-2 text-sm font-medium text-slate-900">
                                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" checked={Boolean(scheduleDraft.is_active)} onChange={(e) => setScheduleDraft((p) => ({ ...p, is_active: e.target.checked }))} />
                                    Active
                                </label>
                            </div>
                        </div>

                        {/* Slot preview */}
                        {previewSlots && (
                            <div className="mt-5 border-t border-slate-100 pt-4">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Slot preview</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {previewSlots.map((slot) => (
                                        <span key={slot} className={`rounded-lg border px-2 py-1 text-xs font-medium tabular-nums ${modeChipClass(scheduleDraft.consultation_mode)}`}>
                                            {fmtTime(slot)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </Card>

                    <Card title="Current schedules" bodyClassName={Object.keys(schedulesByDay).length === 0 ? '' : 'p-5'}>
                        {Object.keys(schedulesByDay).length === 0 ? (
                            <EmptyState icon="calendar" title="No schedules yet" />
                        ) : (
                            <div className="space-y-5">
                                {Object.entries(schedulesByDay)
                                    .sort(([a], [b]) => Number(a) - Number(b))
                                    .map(([day, daySchedules]) => (
                                        <div key={day}>
                                            <div className="mb-2 flex items-center gap-3">
                                                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{dayLabel(day)}</span>
                                                <div className="h-px flex-1 bg-slate-100" />
                                            </div>
                                            <div className="space-y-2">
                                                {daySchedules.map((s) => {
                                                    const effectiveDur = s.slot_duration_minutes || slotDuration;
                                                    const slots = generateSlots(s.start_time, s.end_time, effectiveDur);
                                                    return (
                                                        <div key={s.id} className="rounded-xl border border-slate-200 p-3">
                                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="text-sm font-semibold tabular-nums text-slate-900">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</span>
                                                                    <Badge tone={modeTone(s.consultation_mode)}>{modeLabel(s.consultation_mode)}</Badge>
                                                                    {!s.is_active && <Badge>Inactive</Badge>}
                                                                </div>
                                                                {canRemoveSchedule ? (
                                                                    <button type="button" onClick={() => removeSchedule(s.id)} className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50">Remove</button>
                                                                ) : null}
                                                            </div>
                                                            {slots.length > 0 && (
                                                                <div className="mt-2 flex flex-wrap gap-1">
                                                                    {slots.map((slot) => (
                                                                        <span key={slot} className={`rounded-md border px-1.5 py-0.5 text-xs tabular-nums ${modeChipClass(s.consultation_mode)}`}>{fmtTime(slot)}</span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </Card>
                </div>

                {/* ── RIGHT: Exceptions ── */}
                <div className="space-y-5">
                    <Card
                        title="Add exception"
                        description="One-off overrides: leave, block or special hours."
                        actions={canAddSchedule ? (
                            <button type="button" onClick={addException} disabled={exceptionSaving} className={btn.primary}>
                                {exceptionSaving ? 'Saving…' : 'Add'}
                            </button>
                        ) : null}
                    >
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label htmlFor="ex-date" className={label}>Date</label>
                                <input id="ex-date" type="date" className={inputBase} value={exceptionDraft.exception_date} onChange={setX('exception_date')} />
                            </div>
                            <div>
                                <label htmlFor="ex-type" className={label}>Type</label>
                                <select id="ex-type" className={inputBase} value={exceptionDraft.type} onChange={setX('type')}>
                                    <option value="leave">Leave (full day off)</option>
                                    <option value="blocked">Blocked</option>
                                    <option value="special_hours">Special hours</option>
                                </select>
                            </div>
                            <div className="sm:col-span-2">
                                <label htmlFor="ex-reason" className={label}>Reason (optional)</label>
                                <input id="ex-reason" className={inputBase} value={exceptionDraft.reason} onChange={setX('reason')} placeholder="e.g. Public holiday" />
                            </div>
                            <div>
                                <label htmlFor="ex-start" className={label}>Start time <span className="font-normal text-slate-500">(partial day)</span></label>
                                <input id="ex-start" type="time" className={inputBase} value={exceptionDraft.start_time} onChange={setX('start_time')} />
                            </div>
                            <div>
                                <label htmlFor="ex-end" className={label}>End time <span className="font-normal text-slate-500">(partial day)</span></label>
                                <input id="ex-end" type="time" className={inputBase} value={exceptionDraft.end_time} onChange={setX('end_time')} />
                            </div>
                        </div>
                    </Card>

                    <Card title="Current exceptions" bodyClassName="">
                        {!(data?.doctor?.exceptions || []).length ? (
                            <EmptyState icon="calendar" title="No exceptions" />
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {data.doctor.exceptions.map((ex) => {
                                    const typeTone = { leave: 'red', blocked: 'amber', special_hours: 'blue' };
                                    const typeLabel = { leave: 'Leave', blocked: 'Blocked', special_hours: 'Special hours' };
                                    return (
                                        <li key={ex.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                                            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                                                <span className="text-sm font-semibold tabular-nums text-slate-900">{String(ex.exception_date).slice(0, 10)}</span>
                                                <Badge tone={typeTone[ex.type] || 'slate'}>{typeLabel[ex.type] || ex.type}</Badge>
                                                {ex.start_time && ex.end_time && (
                                                    <span className="text-sm tabular-nums text-slate-700">{fmtTime(ex.start_time)} – {fmtTime(ex.end_time)}</span>
                                                )}
                                                {ex.reason && <span className="text-sm text-slate-600">{ex.reason}</span>}
                                            </div>
                                            {canRemoveSchedule ? (
                                                <button type="button" onClick={() => removeException(ex.id)} className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50">Remove</button>
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </Card>
                </div>
            </div>
        </div>
    );
}
