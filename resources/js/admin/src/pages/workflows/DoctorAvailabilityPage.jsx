import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import client from '../../api/client';
import { useScope } from '../../context/ScopeContext';
import AppIcon from '../../components/AppIcon';

// ── helpers ──────────────────────────────────────────────────────────────────
const inputBase = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200';

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
    if (mode === 'video') return 'bg-purple-100 text-purple-700 border-purple-200';
    if (mode === 'both') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    return 'bg-blue-100 text-blue-700 border-blue-200';
}
function modeLabel(mode) {
    if (mode === 'in_person') return 'Walk-in';
    if (mode === 'video') return 'Video';
    if (mode === 'both') return 'Both';
    return mode;
}

// ── page ──────────────────────────────────────────────────────────────────────
export default function DoctorAvailabilityPage() {
    const { context, roleKind } = useScope() || {};

    if (roleKind !== 'doctor') return <Navigate to="/dashboard" replace />;

    const doctorId = context?.active_doctor_id;
    const base = '/clinic';

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

    if (!doctorId) return null;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-xl font-bold text-gray-900">Availability</h1>
                <p className="mt-0.5 text-sm text-gray-500">Manage your weekly schedules and one-off exceptions.</p>
            </div>

            {error && (
                <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <AppIcon name="alert-triangle" className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}

            <div className="grid gap-4 xl:grid-cols-2">

                {/* ── LEFT: Schedules ── */}
                <div className="space-y-3">
                    {/* Add schedule form */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <h3 className="text-lg font-semibold">Add Schedule</h3>
                                <p className="mt-0.5 text-xs text-slate-500">Recurring weekly working hours per day</p>
                            </div>
                            <button
                                type="button"
                                onClick={addSchedule}
                                disabled={scheduleSaving}
                                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                            >
                                {scheduleSaving ? 'Saving…' : 'Add'}
                            </button>
                        </div>

                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Day</label>
                                <select className={inputBase} value={scheduleDraft.day_of_week} onChange={(e) => setScheduleDraft((p) => ({ ...p, day_of_week: e.target.value }))}>
                                    {DAY_NAMES.map((name, i) => <option key={i} value={String(i)}>{name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Start Time</label>
                                <input type="time" className={inputBase} value={scheduleDraft.start_time} onChange={(e) => setScheduleDraft((p) => ({ ...p, start_time: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">End Time</label>
                                <input type="time" className={inputBase} value={scheduleDraft.end_time} onChange={(e) => setScheduleDraft((p) => ({ ...p, end_time: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</label>
                                <select className={inputBase} value={scheduleDraft.consultation_mode} onChange={(e) => setScheduleDraft((p) => ({ ...p, consultation_mode: e.target.value }))}>
                                    <option value="in_person">Walk-in (In Person)</option>
                                    <option value="video">Video</option>
                                    <option value="both">Both</option>
                                </select>
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Slot Duration (min)</label>
                                <input type="number" className={inputBase} placeholder={`Default: ${slotDuration}`} value={scheduleDraft.slot_duration_minutes} onChange={(e) => setScheduleDraft((p) => ({ ...p, slot_duration_minutes: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Buffer Time (min)</label>
                                <input type="number" className={inputBase} placeholder={`Default: ${data?.doctor?.buffer_time_minutes ?? 0}`} value={scheduleDraft.buffer_time_minutes} onChange={(e) => setScheduleDraft((p) => ({ ...p, buffer_time_minutes: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Max Patients (optional)</label>
                                <input type="number" className={inputBase} value={scheduleDraft.max_patients} onChange={(e) => setScheduleDraft((p) => ({ ...p, max_patients: e.target.value }))} />
                            </div>
                            <div className="flex items-end">
                                <label className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm">
                                    <input type="checkbox" checked={Boolean(scheduleDraft.is_active)} onChange={(e) => setScheduleDraft((p) => ({ ...p, is_active: e.target.checked }))} />
                                    Active
                                </label>
                            </div>
                        </div>

                        {/* Slot preview */}
                        {scheduleDraft.start_time && scheduleDraft.end_time && (scheduleDraft.slot_duration_minutes || slotDuration) && (
                            <div className="mt-3">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Slot Preview</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {generateSlots(
                                        scheduleDraft.start_time,
                                        scheduleDraft.end_time,
                                        Number(scheduleDraft.slot_duration_minutes || slotDuration)
                                    ).map((slot) => (
                                        <span key={slot} className={`rounded-lg border px-2 py-1 text-xs font-medium ${modeChipClass(scheduleDraft.consultation_mode)}`}>
                                            {fmtTime(slot)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Current schedules */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <h3 className="mb-4 text-lg font-semibold">Current Schedules</h3>
                        {Object.keys(schedulesByDay).length === 0 ? (
                            <p className="text-sm text-slate-400">No schedules yet.</p>
                        ) : (
                            <div className="space-y-4">
                                {Object.entries(schedulesByDay)
                                    .sort(([a], [b]) => Number(a) - Number(b))
                                    .map(([day, daySchedules]) => (
                                        <div key={day}>
                                            <div className="mb-2 flex items-center gap-2">
                                                <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">{dayLabel(day)}</span>
                                            </div>
                                            <div className="space-y-2">
                                                {daySchedules.map((s) => {
                                                    const effectiveDur = s.slot_duration_minutes || slotDuration;
                                                    const slots = generateSlots(s.start_time, s.end_time, effectiveDur);
                                                    return (
                                                        <div key={s.id} className={`rounded-xl border p-3 ${modeChipClass(s.consultation_mode)}`}>
                                                            <div className="flex items-center justify-between gap-2">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="font-semibold text-sm">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</span>
                                                                    <span className="rounded-full border px-2 py-0.5 text-xs font-medium opacity-80">{modeLabel(s.consultation_mode)}</span>
                                                                    {!s.is_active && <span className="text-xs opacity-60">(inactive)</span>}
                                                                </div>
                                                                <button type="button" onClick={() => removeSchedule(s.id)} className="rounded-lg border border-current px-2 py-1 text-xs opacity-60 hover:opacity-100">Remove</button>
                                                            </div>
                                                            {slots.length > 0 && (
                                                                <div className="mt-2 flex flex-wrap gap-1">
                                                                    {slots.map((slot) => (
                                                                        <span key={slot} className="rounded border border-current bg-white/40 px-1.5 py-0.5 text-xs">{fmtTime(slot)}</span>
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
                    </div>
                </div>

                {/* ── RIGHT: Exceptions ── */}
                <div className="space-y-3">
                    {/* Add exception form */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <h3 className="text-lg font-semibold">Add Exception</h3>
                                <p className="mt-0.5 text-xs text-slate-500">One-off overrides: leave, block or special hours</p>
                            </div>
                            <button
                                type="button"
                                onClick={addException}
                                disabled={exceptionSaving}
                                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                            >
                                {exceptionSaving ? 'Saving…' : 'Add'}
                            </button>
                        </div>

                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Date</label>
                                <input type="date" className={inputBase} value={exceptionDraft.exception_date} onChange={(e) => setExceptionDraft((p) => ({ ...p, exception_date: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Type</label>
                                <select className={inputBase} value={exceptionDraft.type} onChange={(e) => setExceptionDraft((p) => ({ ...p, type: e.target.value }))}>
                                    <option value="leave">Leave (Full Day Off)</option>
                                    <option value="blocked">Blocked</option>
                                    <option value="special_hours">Special Hours</option>
                                </select>
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reason (optional)</label>
                                <input className={inputBase} value={exceptionDraft.reason} onChange={(e) => setExceptionDraft((p) => ({ ...p, reason: e.target.value }))} placeholder="e.g. Public holiday" />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Start Time <span className="font-normal normal-case text-slate-400">(partial day)</span>
                                </label>
                                <input type="time" className={inputBase} value={exceptionDraft.start_time} onChange={(e) => setExceptionDraft((p) => ({ ...p, start_time: e.target.value }))} />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    End Time <span className="font-normal normal-case text-slate-400">(partial day)</span>
                                </label>
                                <input type="time" className={inputBase} value={exceptionDraft.end_time} onChange={(e) => setExceptionDraft((p) => ({ ...p, end_time: e.target.value }))} />
                            </div>
                        </div>
                    </div>

                    {/* Current exceptions */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <h3 className="mb-4 text-lg font-semibold">Current Exceptions</h3>
                        {!(data?.doctor?.exceptions || []).length ? (
                            <p className="text-sm text-slate-400">No exceptions.</p>
                        ) : (
                            <div className="space-y-2">
                                {data.doctor.exceptions.map((ex) => {
                                    const typeColors = {
                                        leave: 'border-red-200 bg-red-50 text-red-800',
                                        blocked: 'border-orange-200 bg-orange-50 text-orange-800',
                                        special_hours: 'border-blue-200 bg-blue-50 text-blue-800',
                                    };
                                    const typeLabel = { leave: 'Leave', blocked: 'Blocked', special_hours: 'Special Hours' };
                                    return (
                                        <div key={ex.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 ${typeColors[ex.type] || 'border-slate-200 bg-slate-50 text-slate-800'}`}>
                                            <div className="flex flex-wrap items-center gap-3">
                                                <div>
                                                    <span className="font-semibold text-sm">{String(ex.exception_date).slice(0, 10)}</span>
                                                    <span className="ml-2 rounded-full border border-current bg-white/50 px-2 py-0.5 text-xs font-medium">{typeLabel[ex.type] || ex.type}</span>
                                                </div>
                                                {ex.start_time && ex.end_time && (
                                                    <span className="text-xs">{fmtTime(ex.start_time)} – {fmtTime(ex.end_time)}</span>
                                                )}
                                                {ex.reason && <span className="text-xs italic opacity-70">"{ex.reason}"</span>}
                                            </div>
                                            <button type="button" onClick={() => removeException(ex.id)} className="rounded-lg border border-current px-2.5 py-1 text-xs opacity-60 hover:opacity-100">Remove</button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
