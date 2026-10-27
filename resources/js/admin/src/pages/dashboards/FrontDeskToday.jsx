import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import AppointmentDetailDrawer from '../../components/AppointmentDetailDrawer';
import { useAuth } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';

const REFRESH_MS = 30_000;
const LATE_AFTER_MIN = 15;

const STATUS_CHIP = {
    pending: ['Not confirmed', 'bg-amber-100 text-amber-800'],
    confirmed: ['Confirmed', 'bg-blue-100 text-blue-800'],
    checked_in: ['Checked in', 'bg-violet-100 text-violet-800'],
    in_consultation: ['With doctor', 'bg-teal-100 text-teal-800'],
    completed: ['Completed', 'bg-emerald-100 text-emerald-800'],
    no_show: ['No-show', 'bg-slate-100 text-slate-600'],
    cancelled: ['Cancelled', 'bg-rose-100 text-rose-800'],
};

// Lane → statuses it holds, and the one-click move for a card in it.
const LANES = [
    { key: 'arriving', title: 'Arriving', statuses: ['pending', 'confirmed'], next: { status: 'checked_in', label: 'Check in' } },
    { key: 'waiting', title: 'Waiting', statuses: ['checked_in'], next: { status: 'in_consultation', label: 'Send in' } },
    { key: 'consult', title: 'With doctor', statuses: ['in_consultation'], next: { status: 'completed', label: 'Mark done' } },
    { key: 'done', title: 'Done', statuses: ['completed', 'no_show'], next: null },
];

function toYMD(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function minutesOfDay(hhmm) {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

function fmtTime(hhmm) {
    const mins = minutesOfDay(hhmm);
    if (mins == null) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

function humanise(s) {
    return String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function greeting(now) {
    const h = now.getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function Stat({ label, value, sub }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-medium text-slate-600">{label}</p>
            <p className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900 tabular-nums">{value}</span>
                {sub && <span className="truncate text-xs text-slate-500">{sub}</span>}
            </p>
        </div>
    );
}

function QueueCard({ appt, lane, now, busy, onOpen, onMove, onUndo }) {
    const [label, chip] = STATUS_CHIP[appt.status] || [humanise(appt.status), 'bg-slate-100 text-slate-700'];
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const start = minutesOfDay(appt.start_time);
    let note = '';
    let noteClass = 'text-slate-600';
    if (appt.status === 'checked_in' && appt.checked_in_at) {
        const waited = Math.max(0, Math.round((now - new Date(appt.checked_in_at)) / 60000));
        note = `Waiting ${waited} min`;
        if (waited >= 20) noteClass = 'font-semibold text-amber-700';
    } else if (lane.key === 'arriving' && start != null && nowMins - start > LATE_AFTER_MIN) {
        note = `${nowMins - start} min late`;
        noteClass = 'font-semibold text-rose-700';
    }

    return (
        <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <button type="button" onClick={() => onOpen(appt.id)} className="block w-full text-left">
                <span className="flex items-center justify-between gap-2">
                    <span className="whitespace-nowrap text-sm font-bold text-slate-900 tabular-nums">{fmtTime(appt.start_time)}</span>
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip}`}>{label}</span>
                </span>
                <span className="mt-1.5 block truncate text-sm font-semibold text-slate-900">{appt.patient?.full_name || 'Patient'}</span>
                <span className="mt-0.5 block truncate text-xs text-slate-600">
                    {[appt.doctor?.full_name, humanise(appt.visit_type), humanise(appt.booking_channel)].filter(Boolean).join(' · ')}
                </span>
                {note && <span className={`mt-1 block text-xs ${noteClass}`}>{note}</span>}
            </button>
            {lane.next && (
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => onMove(appt, lane.next.status)}
                    className="mt-2.5 h-9 w-full rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                >
                    {busy ? 'Saving…' : lane.next.label}
                </button>
            )}
            {!lane.next && appt.can_undo_status && (
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => onUndo(appt)}
                    className="mt-2.5 h-9 w-full rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                    {busy ? 'Saving…' : 'Undo'}
                </button>
            )}
        </article>
    );
}

export default function FrontDeskToday() {
    const { user } = useAuth();
    const scope = useScope() || {};
    const can = typeof scope.can === 'function' ? scope.can : () => false;
    const activeDoctorId = scope.context?.active_doctor_id ?? null;

    const [now, setNow] = useState(() => new Date());
    const [rows, setRows] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [doctorFilter, setDoctorFilter] = useState('all');
    const [offers, setOffers] = useState([]);
    const [waitlist, setWaitlist] = useState([]);
    const [failedMessages, setFailedMessages] = useState(0);
    const [drawerId, setDrawerId] = useState(null);
    const [phoneLane, setPhoneLane] = useState('waiting');

    const load = useCallback(async () => {
        const ymd = toYMD(new Date());
        try {
            const res = await client.get('/clinic/appointments', {
                params: { appointment_date: ymd, per_page: 200, sort_by: 'start_time', sort_dir: 'asc' },
            });
            setRows(Array.isArray(res.data?.data) ? res.data.data : []);
            setError('');
        } catch (e) {
            setError(e?.response?.data?.message || 'Could not load today’s appointments.');
        } finally {
            setLoaded(true);
            setNow(new Date());
        }

        // Side panels are best-effort: a failure here shouldn't hide the queue.
        const side = [
            client.get('/clinic/waitlist', { params: { status: 'offered', per_page: 5 } })
                .then((r) => setOffers(r.data?.data || [])).catch(() => setOffers([])),
            client.get('/clinic/waitlist', { params: { status: 'waiting', date: ymd, per_page: 5 } })
                .then((r) => setWaitlist(r.data?.data || [])).catch(() => setWaitlist([])),
        ];
        if (can('whatsapp.view')) {
            side.push(client.get('/clinic/whatsapp/messages', {
                params: { delivery_status: 'failed', per_page: 50, sort_by: 'id', sort_dir: 'desc' },
            }).then((r) => {
                const list = r.data?.data || [];
                setFailedMessages(list.filter((m) => String(m.created_at || '').slice(0, 10) === ymd || toYMD(new Date(m.created_at)) === ymd).length);
            }).catch(() => setFailedMessages(0)));
        }
        await Promise.all(side);
        // can() identity changes per render; the permission set it reads is what matters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeDoctorId]);

    useEffect(() => {
        load();
        const t = setInterval(load, REFRESH_MS);
        return () => clearInterval(t);
    }, [load]);

    const doctors = useMemo(() => {
        const map = new Map();
        rows.forEach((r) => { if (r.doctor?.id) map.set(r.doctor.id, r.doctor.full_name); });
        return [...map.entries()].map(([id, name]) => ({ id: String(id), name }));
    }, [rows]);

    const visible = useMemo(
        () => rows.filter((r) => doctorFilter === 'all' || String(r.doctor?.id) === doctorFilter),
        [rows, doctorFilter],
    );

    const lanes = useMemo(() => LANES.map((lane) => {
        const items = visible.filter((r) => lane.statuses.includes(r.status));
        // Done is most-recent first; everything else runs in booking order.
        if (lane.key === 'done') items.reverse();
        return { ...lane, items };
    }), [visible]);

    const count = (statuses) => visible.filter((r) => statuses.includes(r.status)).length;
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const arriving = lanes[0].items;
    const nextArrival = arriving.find((r) => (minutesOfDay(r.start_time) ?? 0) >= nowMins);
    const late = arriving.filter((r) => nowMins - (minutesOfDay(r.start_time) ?? nowMins) > LATE_AFTER_MIN);
    const unconfirmed = visible.filter((r) => r.status === 'pending');
    const waitingRows = lanes[1].items;
    const avgWait = waitingRows.length
        ? Math.round(waitingRows.reduce((sum, r) => sum + (r.checked_in_at ? (now - new Date(r.checked_in_at)) / 60000 : 0), 0) / waitingRows.length)
        : null;
    const cancelled = count(['cancelled']);
    const noShows = count(['no_show']);

    const flash = (msg) => {
        setNotice(msg);
        setTimeout(() => setNotice(''), 3500);
    };

    const move = async (appt, status) => {
        setBusyId(appt.id);
        try {
            await client.post(`/clinic/appointments/${appt.id}/lifecycle`, { status });
            flash(`${appt.patient?.full_name || 'Appointment'}: ${STATUS_CHIP[status]?.[0] || humanise(status)}`);
            await load();
        } catch (e) {
            setError(e?.response?.data?.message || 'Could not update the appointment.');
        } finally {
            setBusyId(null);
        }
    };

    const undo = async (appt) => {
        setBusyId(appt.id);
        try {
            await client.post(`/clinic/appointments/${appt.id}/undo-status`);
            flash(`Undone for ${appt.patient?.full_name || 'appointment'}`);
            await load();
        } catch (e) {
            setError(e?.response?.data?.message || 'Could not undo.');
        } finally {
            setBusyId(null);
        }
    };

    const attention = [];
    if (unconfirmed.length) {
        attention.push({
            key: 'unconfirmed', dot: 'bg-amber-500', href: '/workflows/appointments',
            title: `${unconfirmed.length} booking${unconfirmed.length === 1 ? '' : 's'} not confirmed`,
            sub: unconfirmed.slice(0, 2).map((r) => `${r.patient?.full_name} ${fmtTime(r.start_time)}`).join(', '),
        });
    }
    if (late.length) {
        attention.push({
            key: 'late', dot: 'bg-rose-500', href: '/workflows/appointments',
            title: `${late.length} patient${late.length === 1 ? ' is' : 's are'} running late`,
            sub: late.slice(0, 2).map((r) => r.patient?.full_name).join(', '),
        });
    }
    offers.forEach((o) => {
        const mins = o.hold_expires_at ? Math.max(0, Math.round((new Date(o.hold_expires_at) - now) / 60000)) : null;
        attention.push({
            key: `offer${o.id}`, dot: 'bg-blue-500', href: '/workflows/waitlist',
            title: 'Waitlist offer held',
            sub: `${o.patient?.full_name} · ${fmtTime(o.start_time)}${mins != null ? ` · ${mins} min left to accept` : ''}`,
        });
    });
    if (failedMessages > 0) {
        attention.push({
            key: 'failed', dot: 'bg-red-600', href: '/workflows/communication/delivery-issues',
            title: `${failedMessages} WhatsApp message${failedMessages === 1 ? '' : 's'} not delivered today`,
            sub: 'Check the number or whether they opted out',
        });
    }

    const firstName = String(user?.full_name || '').split(/\s+/)[0];
    const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(now);

    return (
        <div className="mx-auto max-w-[1400px] space-y-5">
            <header className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <p className="text-sm text-slate-500">{dateLabel}</p>
                    <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
                        {greeting(now)}{firstName ? `, ${firstName}` : ''}
                    </h1>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {doctors.length > 1 && (
                        <div role="group" aria-label="Filter by doctor" className="flex flex-wrap rounded-xl border border-slate-200 bg-white p-1">
                            {[{ id: 'all', name: 'All doctors' }, ...doctors].map((d) => (
                                <button
                                    key={d.id}
                                    type="button"
                                    aria-pressed={doctorFilter === d.id}
                                    onClick={() => setDoctorFilter(d.id)}
                                    className={`h-8 rounded-lg px-3 text-sm ${doctorFilter === d.id ? 'bg-slate-900 font-semibold text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                                >
                                    {d.name}
                                </button>
                            ))}
                        </div>
                    )}
                    {can('appointments.create') && (
                        <Link to="/workflows/appointments/new" className="flex h-10 items-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">
                            Book appointment
                        </Link>
                    )}
                </div>
            </header>

            {error && (
                <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    <span>{error}</span>
                    <button type="button" onClick={() => setError('')} className="font-semibold">Dismiss</button>
                </div>
            )}
            {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{notice}</div>}

            <section aria-label="Today at a glance" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <Stat label="Booked today" value={visible.length - cancelled} sub={cancelled ? `${cancelled} cancelled` : ''} />
                <Stat label="Still to arrive" value={arriving.length} sub={nextArrival ? `next at ${fmtTime(nextArrival.start_time)}` : ''} />
                <Stat label="Waiting now" value={waitingRows.length} sub={avgWait != null ? `avg ${avgWait} min` : ''} />
                <Stat label="With doctor" value={lanes[2].items.length} />
                <Stat label="Done" value={count(['completed'])} sub={noShows ? `${noShows} no-show${noShows === 1 ? '' : 's'}` : ''} />
            </section>

            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
                <section aria-labelledby="queue-h" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                        <h2 id="queue-h" className="text-base font-semibold text-slate-900">Live queue</h2>
                        <Link to="/workflows/appointments" className="text-sm font-semibold text-blue-700 hover:text-blue-900">Open schedule</Link>
                    </div>
                    {!loaded ? (
                        <div className="flex justify-center py-16"><span className="h-7 w-7 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>
                    ) : (
                        <>
                        {/* Phones: one lane at a time, picked from tabs */}
                        <div className="md:hidden">
                            <div role="tablist" aria-label="Queue" className="flex gap-1.5 overflow-x-auto px-3 pt-3">
                                {lanes.map((lane) => (
                                    <button
                                        key={lane.key}
                                        type="button"
                                        role="tab"
                                        aria-selected={phoneLane === lane.key}
                                        onClick={() => setPhoneLane(lane.key)}
                                        className={`h-9 shrink-0 rounded-full px-3 text-sm ${phoneLane === lane.key ? 'bg-slate-900 font-semibold text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
                                    >
                                        {lane.title} · {lane.items.length}
                                    </button>
                                ))}
                            </div>
                            {lanes.filter((lane) => lane.key === phoneLane).map((lane) => (
                                <div key={lane.key} className="flex flex-col gap-2.5 p-3">
                                    {lane.items.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Nobody here</p>}
                                    {lane.items.map((appt) => (
                                        <QueueCard key={appt.id} appt={appt} lane={lane} now={now} busy={busyId === appt.id} onOpen={setDrawerId} onMove={move} onUndo={undo} />
                                    ))}
                                </div>
                            ))}
                        </div>

                        <div className="hidden overflow-x-auto md:block">
                            <div className="grid min-w-[760px] grid-cols-4">
                                {lanes.map((lane, i) => (
                                    <div key={lane.key} className={`flex min-h-[420px] flex-col gap-2.5 p-3 ${i % 2 ? 'bg-slate-50/60' : ''} ${i ? 'border-l border-slate-100' : ''}`}>
                                        <div className="flex items-center justify-between px-1">
                                            <h3 className="text-sm font-semibold text-slate-700">{lane.title}</h3>
                                            <span className="rounded-full bg-slate-200 px-2 text-xs font-semibold text-slate-700 tabular-nums">{lane.items.length}</span>
                                        </div>
                                        {lane.items.length === 0 && <p className="px-1 py-6 text-center text-xs text-slate-400">Nobody here</p>}
                                        {lane.items.map((appt) => (
                                            <QueueCard
                                                key={appt.id}
                                                appt={appt}
                                                lane={lane}
                                                now={now}
                                                busy={busyId === appt.id}
                                                onOpen={setDrawerId}
                                                onMove={move}
                                                onUndo={undo}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                        </>
                    )}
                </section>

                <aside className="space-y-4">
                    <section aria-labelledby="att-h" className="rounded-2xl border border-slate-200 bg-white">
                        <h2 id="att-h" className="border-b border-slate-100 px-4 py-3 text-base font-semibold text-slate-900">Needs attention</h2>
                        {attention.length === 0 ? (
                            <p className="flex items-center gap-2 px-4 py-4 text-sm text-slate-600">
                                <AppIcon name="check" className="h-4 w-4 text-emerald-600" /> All clear for now.
                            </p>
                        ) : (
                            <ul className="p-1.5">
                                {attention.map((a) => (
                                    <li key={a.key}>
                                        <Link to={a.href} className="flex gap-3 rounded-xl p-2.5 hover:bg-slate-50">
                                            <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${a.dot}`} aria-hidden="true" />
                                            <span className="min-w-0">
                                                <span className="block text-sm font-semibold text-slate-900">{a.title}</span>
                                                {a.sub && <span className="mt-0.5 block truncate text-xs text-slate-600">{a.sub}</span>}
                                            </span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <section aria-labelledby="wl-h" className="rounded-2xl border border-slate-200 bg-white">
                        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                            <h2 id="wl-h" className="text-base font-semibold text-slate-900">Waitlist today</h2>
                            <Link to="/workflows/waitlist" className="text-sm font-semibold text-blue-700 hover:text-blue-900">Open</Link>
                        </div>
                        {waitlist.length === 0 ? (
                            <p className="px-4 py-4 text-sm text-slate-600">Nobody waiting for a slot today.</p>
                        ) : (
                            <ul className="space-y-2.5 px-4 py-3">
                                {waitlist.map((w) => (
                                    <li key={w.id} className="flex justify-between gap-2 text-sm">
                                        <span className="min-w-0 truncate">
                                            <span className="font-semibold text-slate-900">{w.patient?.full_name}</span>
                                            <span className="text-slate-600"> · {w.doctor?.name}</span>
                                        </span>
                                        <span className="flex-shrink-0 text-slate-600 tabular-nums">{fmtTime(w.start_time)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </aside>
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

