import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../../api/client';
import AppointmentDetailDrawer from '../../components/AppointmentDetailDrawer';
import { useAuth } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';

const REFRESH_MS = 30_000;

const CHIP = {
    pending: ['Not confirmed', 'bg-amber-100 text-amber-800'],
    confirmed: ['Booked', 'bg-blue-100 text-blue-800'],
    checked_in: ['Waiting', 'bg-violet-100 text-violet-800'],
    in_consultation: ['With you', 'bg-teal-100 text-teal-800'],
    completed: ['Done', 'bg-emerald-100 text-emerald-800'],
};

function toYMD(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toMin(hhmm) {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    return Number.isFinite(h) ? h * 60 + (m || 0) : 0;
}

function fmtTime(hhmm) {
    const mins = toMin(hhmm);
    const h = Math.floor(mins / 60);
    return `${((h + 11) % 12) + 1}:${String(mins % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

function humanise(s) {
    return String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function splitList(v) {
    return String(v || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}

export default function DoctorToday() {
    const { user } = useAuth();
    const scope = useScope() || {};
    const navigate = useNavigate();
    const can = typeof scope.can === 'function' ? scope.can : () => false;
    const canPrescribe = can('appointments.prescribe');
    const activeDoctorId = scope.context?.active_doctor_id ?? null;

    const [now, setNow] = useState(() => new Date());
    const [rows, setRows] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [focusProfile, setFocusProfile] = useState(null);
    const [drawerId, setDrawerId] = useState(null);

    const load = useCallback(async () => {
        const ymd = toYMD(new Date());
        const params = { appointment_date: ymd, per_page: 100, sort_by: 'start_time', sort_dir: 'asc' };
        try {
            // A doctor's list defaults to the still-open visits; finished ones
            // are asked for separately so the day reads end to end.
            const [open, done] = await Promise.all([
                client.get('/clinic/appointments', { params }),
                client.get('/clinic/appointments', { params: { ...params, status: 'completed' } }),
            ]);
            const all = [...(open.data?.data || []), ...(done.data?.data || [])];
            const seen = new Set();
            setRows(all.filter((r) => (seen.has(r.id) ? false : seen.add(r.id))));
            setError('');
        } catch (e) {
            setError(e?.response?.data?.message || 'Could not load your day.');
        } finally {
            setLoaded(true);
            setNow(new Date());
        }
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, REFRESH_MS);
        return () => clearInterval(t);
    }, [load, activeDoctorId]);

    const day = useMemo(() => [...rows].sort((a, b) => toMin(a.start_time) - toMin(b.start_time)), [rows]);
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const withMe = day.find((r) => r.status === 'in_consultation');
    const waiting = day
        .filter((r) => r.status === 'checked_in')
        .sort((a, b) => new Date(a.checked_in_at || 0) - new Date(b.checked_in_at || 0));
    const upcoming = day.filter((r) => ['pending', 'confirmed'].includes(r.status) && toMin(r.start_time) >= nowMin - 30);
    const focus = withMe || waiting[0] || upcoming[0] || null;
    const seenCount = day.filter((r) => r.status === 'completed').length;
    const noRx = canPrescribe ? day.filter((r) => r.status === 'completed' && !(r.prescriptions_count > 0)) : [];

    // The focused patient's allergies and conditions, shown before they walk in.
    const focusPatientId = focus?.patient?.id || focus?.patient_id;
    useEffect(() => {
        setFocusProfile(null);
        if (!focusPatientId || !can('patients.view')) return undefined;
        let cancelled = false;
        client.get(`/clinic/patients/${focusPatientId}/profile`)
            .then(({ data }) => { if (!cancelled) setFocusProfile(data?.data || null); })
            .catch(() => {});
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusPatientId]);

    const move = async (appt, status) => {
        setBusy(true);
        try {
            await client.post(`/clinic/appointments/${appt.id}/lifecycle`, { status });
            if (status === 'in_consultation' && canPrescribe) {
                navigate(`/workflows/appointments/${appt.id}/prescription`);
                return;
            }
            await load();
        } catch (e) {
            setError(e?.response?.data?.message || 'Could not update the appointment.');
        } finally {
            setBusy(false);
        }
    };

    const fp = focusProfile?.patient;
    const med = fp?.medical_profile || fp?.medicalProfile || {};
    const allergies = splitList(med.allergies);
    const conditions = splitList(med.chronic_conditions);
    const waitedMin = focus?.status === 'checked_in' && focus.checked_in_at
        ? Math.max(0, Math.round((now - new Date(focus.checked_in_at)) / 60000)) : null;
    const focusLabel = focus?.status === 'in_consultation' ? 'With you now'
        : focus?.status === 'checked_in' ? `Next patient · waiting ${waitedMin ?? 0} min`
            : 'Next booking · not arrived yet';

    const name = String(user?.full_name || '').trim();
    const hour = now.getHours();
    const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(now);

    return (
        <div className="mx-auto max-w-[1400px] space-y-5">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="text-sm text-slate-500">{dateLabel}</p>
                    <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">{hello}{name ? `, ${name}` : ''}</h1>
                </div>
                <p className="text-sm text-slate-700">
                    <strong className="tabular-nums">{day.length}</strong> patients today · <strong className="tabular-nums">{seenCount}</strong> seen · <strong className="tabular-nums">{waiting.length}</strong> waiting
                </p>
            </header>

            {error && (
                <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    <span>{error}</span>
                    <button type="button" onClick={() => setError('')} className="font-semibold">Dismiss</button>
                </div>
            )}

            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 space-y-5">
                    <section aria-labelledby="focus-h" className="rounded-2xl border border-slate-200 bg-white">
                        {!loaded ? (
                            <div className="flex justify-center py-14"><span className="h-7 w-7 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>
                        ) : !focus ? (
                            <div className="px-6 py-10 text-center">
                                <p id="focus-h" className="text-base font-semibold text-slate-900">Nobody waiting right now</p>
                                <p className="mt-1 text-sm text-slate-600">{day.length ? 'Your remaining bookings are below.' : 'You have no bookings today.'}</p>
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-5 p-6">
                                <div className="min-w-0 flex-[1_1_320px]">
                                    <p id="focus-h" className={`text-xs font-semibold uppercase tracking-wider ${focus.status === 'checked_in' && waitedMin >= 20 ? 'text-amber-700' : 'text-slate-600'}`}>{focusLabel}</p>
                                    <h2 className="mt-1.5 text-2xl font-bold text-slate-900">{focus.patient?.full_name || 'Patient'}</h2>
                                    <p className="mt-0.5 text-sm text-slate-700">
                                        {[
                                            fp?.age ? `${fp.age} yrs` : null,
                                            fp?.gender ? humanise(fp.gender) : null,
                                            `${fmtTime(focus.start_time)} ${humanise(focus.visit_type) || 'visit'}`,
                                            focusProfile?.counts ? (focusProfile.counts.appointments > 1 ? `visit ${focusProfile.counts.appointments}` : 'first visit') : null,
                                        ].filter(Boolean).join(' · ')}
                                    </p>
                                    {(allergies.length || conditions.length) ? (
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                            {allergies.map((a) => <span key={`a-${a}`} className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">Allergy: {a}</span>)}
                                            {conditions.map((c) => <span key={`c-${c}`} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{c}</span>)}
                                        </div>
                                    ) : null}
                                    {(med.current_medications || focus.notes) ? (
                                        <div className="mt-4 space-y-1 rounded-xl bg-slate-50 px-4 py-3 text-sm">
                                            {med.current_medications ? <p><span className="font-semibold text-slate-700">Current medicines: </span>{med.current_medications}</p> : null}
                                            {focus.notes ? <p><span className="font-semibold text-slate-700">Reason: </span>{focus.notes}</p> : null}
                                        </div>
                                    ) : null}
                                </div>
                                <div className="flex flex-[0_1_220px] flex-col justify-center gap-2">
                                    {focus.status === 'checked_in' && (
                                        <button type="button" disabled={busy} onClick={() => move(focus, 'in_consultation')} className="h-12 rounded-xl bg-blue-600 text-base font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                                            {busy ? 'Starting…' : 'Start consultation'}
                                        </button>
                                    )}
                                    {focus.status === 'in_consultation' && canPrescribe && (
                                        <Link to={`/workflows/appointments/${focus.id}/prescription`} className="flex h-12 items-center justify-center rounded-xl bg-blue-600 text-base font-semibold text-white hover:bg-blue-700">
                                            Write prescription
                                        </Link>
                                    )}
                                    {focus.status === 'in_consultation' && (
                                        <button type="button" disabled={busy} onClick={() => move(focus, 'completed')} className="h-11 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50">
                                            Mark done
                                        </button>
                                    )}
                                    {focusPatientId && can('patients.view') ? (
                                        <Link to={`/modules/patients/${focusPatientId}`} className="flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-blue-700 hover:bg-blue-50">
                                            Full record
                                        </Link>
                                    ) : null}
                                </div>
                            </div>
                        )}
                    </section>

                    <section aria-labelledby="day-h" className="rounded-2xl border border-slate-200 bg-white">
                        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                            <h2 id="day-h" className="text-base font-semibold text-slate-900">Your day</h2>
                            <Link to="/workflows/my-profile?tab=calendar" className="text-sm font-semibold text-blue-700 hover:text-blue-900">Calendar</Link>
                        </div>
                        {loaded && !day.length ? <p className="px-5 py-6 text-sm text-slate-600">No bookings today.</p> : null}
                        <ul>
                            {day.map((r) => {
                                const [label, chip] = CHIP[r.status] || [humanise(r.status), 'bg-slate-100 text-slate-700'];
                                const isFocus = focus && r.id === focus.id;
                                return (
                                    <li key={r.id}>
                                        <button
                                            type="button"
                                            onClick={() => setDrawerId(r.id)}
                                            className={`grid w-full grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50 ${isFocus ? 'bg-blue-50/50 shadow-[inset_3px_0_0_#2563eb]' : ''}`}
                                        >
                                            <span className="text-sm font-semibold text-slate-700 tabular-nums">{fmtTime(r.start_time)}</span>
                                            <span className="min-w-0 truncate text-sm">
                                                <span className="font-semibold text-slate-900">{r.patient?.full_name || 'Patient'}</span>
                                                <span className="text-slate-600"> · {humanise(r.visit_type) || 'Visit'}</span>
                                            </span>
                                            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip}`}>{label}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                </div>

                <aside className="space-y-4">
                    {canPrescribe && (
                        <section aria-labelledby="fin-h" className="rounded-2xl border border-slate-200 bg-white">
                            <h2 id="fin-h" className="border-b border-slate-100 px-4 py-3 text-base font-semibold text-slate-900">To finish</h2>
                            {noRx.length === 0 ? (
                                <p className="px-4 py-4 text-sm text-slate-600">Every visit today has a prescription.</p>
                            ) : (
                                <ul className="p-1.5">
                                    {noRx.map((r) => (
                                        <li key={r.id}>
                                            <Link to={`/workflows/appointments/${r.id}/prescription`} className="block rounded-xl p-2.5 hover:bg-slate-50">
                                                <span className="block text-sm font-semibold text-slate-900">{r.patient?.full_name}</span>
                                                <span className="block text-xs text-slate-600">{fmtTime(r.start_time)} · no prescription yet</span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    )}
                    {waiting.length > 1 && (
                        <section aria-labelledby="wait-h" className="rounded-2xl border border-slate-200 bg-white">
                            <h2 id="wait-h" className="border-b border-slate-100 px-4 py-3 text-base font-semibold text-slate-900">Also waiting</h2>
                            <ul className="space-y-2 px-4 py-3 text-sm">
                                {waiting.slice(focus?.status === 'checked_in' ? 1 : 0).map((r) => (
                                    <li key={r.id} className="flex justify-between gap-2">
                                        <span className="truncate font-semibold text-slate-900">{r.patient?.full_name}</span>
                                        <span className="shrink-0 text-slate-600">{r.checked_in_at ? `${Math.max(0, Math.round((now - new Date(r.checked_in_at)) / 60000))} min` : ''}</span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                    <section aria-labelledby="av-h" className="rounded-2xl border border-slate-200 bg-white p-4">
                        <h2 id="av-h" className="text-base font-semibold text-slate-900">Availability</h2>
                        <p className="mt-1 text-sm text-slate-600">Weekly hours, leave and blocked time.</p>
                        <Link to="/workflows/my-availability" className="mt-2 inline-block text-sm font-semibold text-blue-700 hover:text-blue-900">Block time or take leave</Link>
                    </section>
                </aside>
            </div>

            <AppointmentDetailDrawer open={drawerId != null} appointmentId={drawerId} onClose={() => setDrawerId(null)} onChanged={load} />
        </div>
    );
}
