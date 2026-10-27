import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../api/client';
import AppointmentDetailDrawer from '../../components/AppointmentDetailDrawer';
import { useScope } from '../../context/ScopeContext';

const PX_PER_MIN = 1.6; // 96px per hour: a 15-minute booking is one readable line
const DEFAULT_START = 9 * 60;
const DEFAULT_END = 18 * 60;
const REFRESH_MS = 60_000;

const BLOCK_STYLES = {
    pending: 'bg-amber-50 text-amber-900 border border-dashed border-amber-400',
    confirmed: 'bg-blue-50 text-blue-900 border border-blue-200',
    checked_in: 'bg-violet-50 text-violet-900 border border-violet-200',
    in_consultation: 'bg-teal-50 text-teal-900 border border-teal-300',
    completed: 'bg-emerald-50 text-emerald-900 border border-emerald-200',
    no_show: 'bg-slate-50 text-slate-500 border border-slate-200 line-through',
    cancelled: 'bg-rose-50 text-rose-700 border border-rose-200 line-through opacity-70',
};

const STATUS_LABEL = {
    pending: 'Not confirmed',
    confirmed: 'Confirmed',
    checked_in: 'Checked in',
    in_consultation: 'With doctor',
    completed: 'Completed',
    no_show: 'No-show',
    cancelled: 'Cancelled',
};

function toYMD(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftYMD(ymd, days) {
    const d = new Date(`${ymd}T00:00:00`);
    d.setDate(d.getDate() + days);
    return toYMD(d);
}

function toMin(hhmm) {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

function fmtMin(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? ' am' : ' pm'}`;
}

function hhmm(mins) {
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/**
 * Give overlapping bookings in one doctor's column side-by-side lanes, so a
 * double booking shows as two narrow blocks instead of one hiding the other.
 */
function layoutBlocks(appts) {
    const sorted = [...appts].sort((a, b) => a.start - b.start || b.end - a.end);
    const out = [];
    let cluster = [];
    let clusterEnd = -1;
    const flush = () => {
        const laneEnds = [];
        cluster.forEach((a) => {
            let lane = laneEnds.findIndex((end) => end <= a.start);
            if (lane === -1) { lane = laneEnds.length; laneEnds.push(a.end); } else { laneEnds[lane] = a.end; }
            a.lane = lane;
        });
        cluster.forEach((a) => out.push({ ...a, lanes: laneEnds.length }));
        cluster = [];
    };
    sorted.forEach((a) => {
        if (cluster.length && a.start >= clusterEnd) flush();
        cluster.push(a);
        clusterEnd = Math.max(clusterEnd, a.end);
    });
    if (cluster.length) flush();
    return out;
}

export default function ScheduleDayView({ initialDate }) {
    const scope = useScope() || {};
    const can = typeof scope.can === 'function' ? scope.can : () => false;
    const allowedDoctors = scope.context?.allowed_doctors;
    const canBook = can('appointments.create');
    const canViewDoctors = can('doctors.view');

    const todayYMD = toYMD(new Date());
    const [date, setDate] = useState(initialDate || todayYMD);
    const [doctorList, setDoctorList] = useState([]);
    const [appts, setAppts] = useState([]);
    const [slots, setSlots] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [doctorFilter, setDoctorFilter] = useState('all');
    const [showCancelled, setShowCancelled] = useState(false);
    const [drawerId, setDrawerId] = useState(null);
    const [now, setNow] = useState(() => new Date());
    const scrollRef = useRef(null);
    const scrolledFor = useRef('');

    // Doctors: a doctor-limited role gets its own list from the scope context;
    // otherwise everyone active (when the role may view doctors).
    useEffect(() => {
        if (Array.isArray(allowedDoctors)) {
            setDoctorList(allowedDoctors.map((d) => ({ id: d.id, full_name: d.full_name })));
            return;
        }
        if (!canViewDoctors) return;
        client.get('/clinic/doctors', { params: { per_page: 100, sort_by: 'full_name', sort_dir: 'asc' } })
            .then((r) => setDoctorList((r.data?.data || []).filter((d) => !d.status || d.status === 'active')))
            .catch(() => setDoctorList([]));
    }, [allowedDoctors, canViewDoctors]);

    const load = useCallback(async () => {
        try {
            const res = await client.get('/clinic/appointments', {
                params: { appointment_date: date, per_page: 200, sort_by: 'start_time', sort_dir: 'asc' },
            });
            setAppts(Array.isArray(res.data?.data) ? res.data.data : []);
            setError('');
        } catch (e) {
            setError(e?.response?.data?.message || 'Could not load the schedule.');
        } finally {
            setLoading(false);
            setNow(new Date());
        }
    }, [date]);

    useEffect(() => {
        setLoading(true);
        load();
        const t = setInterval(load, REFRESH_MS);
        return () => clearInterval(t);
    }, [load]);

    // Working hours and free slots per doctor for this day.
    useEffect(() => {
        if (!doctorList.length) { setSlots({}); return undefined; }
        let cancelled = false;
        Promise.all(doctorList.map((d) => client.get('/clinic/appointments/availability', {
            params: { doctor_id: d.id, from_date: date, to_date: date },
        }).then((r) => [d.id, r.data?.data?.days?.[0]?.slots || []]).catch(() => [d.id, []])))
            .then((pairs) => { if (!cancelled) setSlots(Object.fromEntries(pairs)); });
        return () => { cancelled = true; };
    }, [doctorList, date, appts]);

    // Columns: known doctors plus anyone with a booking today we didn't list.
    const columns = useMemo(() => {
        const map = new Map(doctorList.map((d) => [String(d.id), { id: d.id, name: d.full_name }]));
        appts.forEach((a) => {
            if (a.doctor?.id && !map.has(String(a.doctor.id))) map.set(String(a.doctor.id), { id: a.doctor.id, name: a.doctor.full_name });
        });
        return [...map.values()];
    }, [doctorList, appts]);

    const shownColumns = doctorFilter === 'all' ? columns : columns.filter((c) => String(c.id) === doctorFilter);

    const visibleAppts = useMemo(
        () => appts.filter((a) => showCancelled || a.status !== 'cancelled'),
        [appts, showCancelled],
    );

    const [startMin, endMin] = useMemo(() => {
        let lo = Infinity;
        let hi = -Infinity;
        Object.values(slots).flat().forEach((s) => {
            lo = Math.min(lo, toMin(s.start_time));
            hi = Math.max(hi, toMin(s.end_time));
        });
        visibleAppts.forEach((a) => {
            lo = Math.min(lo, toMin(a.start_time));
            hi = Math.max(hi, toMin(a.end_time) ?? toMin(a.start_time) + 15);
        });
        if (!Number.isFinite(lo)) return [DEFAULT_START, DEFAULT_END];
        return [Math.floor(lo / 60) * 60, Math.min(24 * 60, Math.ceil(hi / 60) * 60)];
    }, [slots, visibleAppts]);

    const height = (endMin - startMin) * PX_PER_MIN;
    const isToday = date === todayYMD;
    const nowMin = now.getHours() * 60 + now.getMinutes();

    // Scroll to the current time (or the first booking) once per day shown.
    useEffect(() => {
        if (loading || !scrollRef.current || scrolledFor.current === date) return;
        scrolledFor.current = date;
        const firstAppt = visibleAppts.map((a) => toMin(a.start_time)).sort((a, b) => a - b)[0];
        const target = isToday ? nowMin - 60 : (firstAppt ?? startMin) - 30;
        scrollRef.current.scrollTop = Math.max(0, (target - startMin) * PX_PER_MIN);
    }, [loading, date, isToday, nowMin, startMin, visibleAppts]);

    const blocksFor = (doctorId) => layoutBlocks(
        visibleAppts
            .filter((a) => String(a.doctor?.id) === String(doctorId))
            .map((a) => {
                const start = toMin(a.start_time);
                const end = Math.max(start + 10, toMin(a.end_time) ?? start + 15);
                return { appt: a, start, end };
            }),
    );

    const counts = useMemo(() => {
        const c = { total: 0, pending: 0 };
        appts.forEach((a) => {
            if (a.status !== 'cancelled') c.total += 1;
            if (a.status === 'pending') c.pending += 1;
        });
        return c;
    }, [appts]);

    const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
        .format(new Date(`${date}T00:00:00`));

    const hours = [];
    for (let m = startMin; m < endMin; m += 60) hours.push(m);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" aria-label="Previous day" onClick={() => setDate((d) => shiftYMD(d, -1))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">‹</button>
                    <button type="button" onClick={() => setDate(todayYMD)} disabled={isToday} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">Today</button>
                    <button type="button" aria-label="Next day" onClick={() => setDate((d) => shiftYMD(d, 1))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">›</button>
                    <label className="sr-only" htmlFor="schedule-date">Date</label>
                    <input id="schedule-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800" />
                    <span className="ml-1 text-sm font-semibold text-slate-900">{dateLabel}</span>
                    <span className="text-sm text-slate-500">· {counts.total} booked{counts.pending ? ` · ${counts.pending} not confirmed` : ''}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {columns.length > 1 && (
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                            Doctor
                            <select value={doctorFilter} onChange={(e) => setDoctorFilter(e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800">
                                <option value="all">All doctors</option>
                                {columns.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                            </select>
                        </label>
                    )}
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                        <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                        Show cancelled
                    </label>
                </div>
            </div>

            {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {loading && !appts.length ? (
                    <div className="flex justify-center py-20"><span className="h-7 w-7 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>
                ) : shownColumns.length === 0 ? (
                    <p className="px-5 py-16 text-center text-sm text-slate-600">No doctors or bookings for this day.</p>
                ) : (
                    <div ref={scrollRef} className="max-h-[calc(100vh-230px)] min-h-[420px] overflow-auto">
                        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${shownColumns.length}, minmax(200px, 1fr))`, minWidth: 56 + shownColumns.length * 200 }}>
                            {/* Doctor headers stay put while the day scrolls */}
                            <div className="sticky top-0 z-20 border-b border-slate-200 bg-white" />
                            {shownColumns.map((c) => {
                                const daySlots = slots[c.id] || [];
                                const free = daySlots.filter((s) => s.available && (!isToday || toMin(s.start_time) > nowMin)).length;
                                const booked = visibleAppts.filter((a) => String(a.doctor?.id) === String(c.id) && a.status !== 'cancelled').length;
                                return (
                                    <div key={c.id} className="sticky top-0 z-20 border-b border-l border-slate-200 bg-white px-3 py-2.5">
                                        <p className="truncate text-sm font-semibold text-slate-900">{c.name}</p>
                                        <p className="text-xs text-slate-500">
                                            {booked} booked{daySlots.length ? ` · ${free} free` : ' · no hours set'}
                                        </p>
                                    </div>
                                );
                            })}

                            {/* Hour labels */}
                            <div className="relative" style={{ height }}>
                                {hours.map((m) => (
                                    <span key={m} className="absolute right-2 -translate-y-1/2 text-[11px] text-slate-500 tabular-nums" style={{ top: (m - startMin) * PX_PER_MIN }}>
                                        {m === startMin ? '' : fmtMin(m).replace(':00', '')}
                                    </span>
                                ))}
                            </div>

                            {shownColumns.map((c) => (
                                <div
                                    key={c.id}
                                    className="relative border-l border-slate-200 bg-slate-50"
                                    style={{
                                        height,
                                        backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${60 * PX_PER_MIN - 1}px, #e2e8f0 ${60 * PX_PER_MIN - 1}px, #e2e8f0 ${60 * PX_PER_MIN}px)`,
                                        backgroundPositionY: `${(startMin % 60) * PX_PER_MIN}px`,
                                    }}
                                >
                                    {/* Working hours are white; free future slots offer a one-click booking */}
                                    {(slots[c.id] || []).map((s) => {
                                        const sMin = toMin(s.start_time);
                                        const eMin = toMin(s.end_time);
                                        const top = (sMin - startMin) * PX_PER_MIN;
                                        const h = (eMin - sMin) * PX_PER_MIN;
                                        const bookable = s.available && canBook && (!isToday || sMin > nowMin) && date >= todayYMD;
                                        return (
                                            <div key={s.start_time} className="absolute inset-x-0 bg-white" style={{ top, height: h }}>
                                                {bookable && (
                                                    <Link
                                                        to={`/workflows/appointments/new?doctor_id=${c.id}&appointment_date=${date}&start_time=${hhmm(sMin)}`}
                                                        className="group absolute inset-x-1 inset-y-px flex items-center rounded-md px-2 text-xs font-semibold text-blue-700 opacity-0 hover:bg-blue-50 hover:opacity-100 focus:bg-blue-50 focus:opacity-100"
                                                        aria-label={`Book ${c.name} at ${fmtMin(sMin)}`}
                                                    >
                                                        + Book {fmtMin(sMin)}
                                                    </Link>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {blocksFor(c.id).map(({ appt, start, end, lane, lanes }) => {
                                        const top = (start - startMin) * PX_PER_MIN + 1;
                                        const h = Math.max(22, (end - start) * PX_PER_MIN - 2);
                                        const width = `calc((100% - 8px) / ${lanes})`;
                                        return (
                                            <button
                                                key={appt.id}
                                                type="button"
                                                onClick={() => setDrawerId(appt.id)}
                                                className={`absolute z-10 overflow-hidden rounded-lg px-2 py-1 text-left shadow-sm hover:z-20 hover:shadow-md focus:z-20 ${BLOCK_STYLES[appt.status] || 'bg-slate-50 text-slate-800 border border-slate-200'}`}
                                                style={{ top, height: h, left: `calc(4px + ${width} * ${lane})`, width }}
                                                title={`${fmtMin(start)} ${appt.patient?.full_name || ''} · ${STATUS_LABEL[appt.status] || appt.status}`}
                                            >
                                                <span className="block truncate text-xs font-semibold">
                                                    {fmtMin(start)} · {appt.patient?.full_name || 'Patient'}
                                                </span>
                                                {h >= 38 && (
                                                    <span className="block truncate text-[11px] opacity-80">
                                                        {STATUS_LABEL[appt.status] || appt.status}{appt.visit_type ? ` · ${String(appt.visit_type).replace(/_/g, ' ')}` : ''}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}

                                    {isToday && nowMin >= startMin && nowMin <= endMin && (
                                        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-red-500" style={{ top: (nowMin - startMin) * PX_PER_MIN }} />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                {['pending', 'confirmed', 'checked_in', 'in_consultation', 'completed', 'no_show'].map((s) => (
                    <span key={s} className="flex items-center gap-1.5">
                        <span className={`h-3 w-3 rounded ${BLOCK_STYLES[s]}`} aria-hidden="true" />
                        {STATUS_LABEL[s]}
                    </span>
                ))}
                {canBook && <span className="text-slate-500">Hover a white (free) slot to book it.</span>}
            </div>

            <AppointmentDetailDrawer
                open={drawerId != null}
                appointmentId={drawerId}
                onClose={() => setDrawerId(null)}
                onChanged={load}
            />
        </div>
    );
}
