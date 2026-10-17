import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AppIcon from '../../components/AppIcon';
import { formatTime } from '../../utils/dateFormat';

// Add a patient to the waitlist for a booked slot. Reached from the waitlist screen under the same
// appointments.view gate (App.jsx adds appointments.create, which is what shows the Add button there).
// Optional query parameters prefill the form: patient_id, doctor_id, date (YYYY-MM-DD).

const doctorLabel = (d) => [d?.title, d?.full_name || d?.name].filter(Boolean).join(' ').trim() || `Doctor #${d?.id}`;
const apiError = (e, fallback) => e?.response?.data?.message || e?.message || fallback;
const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function WaitlistAddPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

    const prefillPatientId = /^\d+$/.test(searchParams.get('patient_id') || '') ? searchParams.get('patient_id') : '';
    const today = new Date().toLocaleDateString('en-CA');

    const [doctors, setDoctors] = useState([]);
    const activeDoctors = useMemo(() => doctors.filter((d) => (d.status ?? 'active') === 'active'), [doctors]);

    const [patient, setPatient] = useState(null);
    const [prefillLoading, setPrefillLoading] = useState(Boolean(prefillPatientId));
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const queryRef = useRef('');

    const [rawDoctorId, setDoctorId] = useState(() => searchParams.get('doctor_id') || '');
    const [date, setDate] = useState(() => {
        const d = searchParams.get('date') || '';
        // Past dates have no joinable slots; don't prefill one.
        return YMD_RE.test(d) && d >= today ? d : '';
    });
    // Inactive doctors cannot be joined, so a prefilled one only counts once it is in the active list.
    const doctorId = activeDoctors.some((d) => String(d.id) === String(rawDoctorId)) ? String(rawDoctorId) : '';
    const [startTime, setStartTime] = useState('');
    const [slots, setSlots] = useState({ loading: false, error: '', items: [] });

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    // Reset the form whenever the route (including its prefill parameters) changes.
    useEffect(() => {
        queryRef.current = '';
        const d = searchParams.get('date') || '';
        setPatient(null);
        setQuery('');
        setResults([]);
        setSearching(false);
        setDoctorId(searchParams.get('doctor_id') || '');
        setDate(YMD_RE.test(d) && d >= today ? d : '');
        setStartTime('');
        setBusy(false);
        setError('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.key]);

    useEffect(() => {
        let cancelled = false;
        client.get(`${base}/doctors`, { params: { per_page: 200 } })
            .then((res) => {
                if (cancelled) return;
                setDoctors(Array.isArray(res?.data?.data) ? res.data.data : []);
            })
            .catch(() => {
                if (cancelled) return;
                setDoctors([]);
            });
        return () => { cancelled = true; };
    }, [base]);

    // A linked patient arrives as an id; load it so the form shows who is selected.
    useEffect(() => {
        if (!prefillPatientId) {
            setPrefillLoading(false);
            return undefined;
        }
        let cancelled = false;
        setPrefillLoading(true);
        client.get(`${base}/patients/${prefillPatientId}`)
            .then((res) => {
                if (cancelled) return;
                const p = res?.data?.data;
                if (p && p.id) setPatient(p);
            })
            .catch(() => {
                // Leave the patient unselected; the search box still works.
            })
            .finally(() => {
                if (!cancelled) setPrefillLoading(false);
            });
        return () => { cancelled = true; };
    }, [base, prefillPatientId, location.key]);

    // Booked times for the chosen doctor + date.
    useEffect(() => {
        if (!doctorId || !date) {
            setSlots({ loading: false, error: '', items: [] });
            return undefined;
        }
        let cancelled = false;
        setSlots({ loading: true, error: '', items: [] });
        client.get(`${base}/appointments/availability`, {
            params: { doctor_id: doctorId, from_date: date, to_date: date },
        })
            .then((res) => {
                if (cancelled) return;
                const days = Array.isArray(res?.data?.data?.days) ? res.data.data.days : [];
                const day = days.find((d) => d.date === date);
                const now = Date.now();
                const taken = (day?.slots || []).filter((s) => {
                    if (s.available) return false;
                    const start = new Date(`${date}T${String(s.start_time || '').slice(0, 5)}:00`);
                    return !Number.isNaN(start.getTime()) && start.getTime() > now;
                });
                setSlots({ loading: false, error: '', items: taken });
            })
            .catch((e) => {
                if (cancelled) return;
                setSlots({ loading: false, error: apiError(e, 'Failed to load slots'), items: [] });
            });
        return () => { cancelled = true; };
    }, [base, doctorId, date]);

    const searchPatients = async (q) => {
        queryRef.current = q;
        if (!q.trim()) {
            setResults([]);
            setSearching(false);
            return;
        }
        setSearching(true);
        try {
            const { data } = await client.get(`${base}/patients`, { params: { search: q.trim(), per_page: 10 } });
            if (queryRef.current !== q) return; // a newer search superseded this response
            setResults(Array.isArray(data?.data) ? data.data : []);
            setSearching(false);
        } catch {
            if (queryRef.current !== q) return;
            setResults([]);
            setSearching(false);
        }
    };

    const canSubmit = Boolean(patient && doctorId && date && startTime) && !busy;

    const submit = async () => {
        if (!canSubmit) return;
        setBusy(true);
        setError('');
        try {
            const res = await client.post(`${base}/waitlist`, {
                patient_id: patient.id,
                doctor_id: Number(doctorId),
                appointment_date: date,
                start_time: startTime,
            });
            navigate('/workflows/waitlist', { state: { notice: res?.data?.message || 'Added to the waitlist.' } });
        } catch (e) {
            setError(apiError(e, 'Failed to add to the waitlist'));
            setBusy(false);
        }
    };

    return (
        <div className="mx-auto max-w-2xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div>
                    <div className="flex items-center gap-2">
                        <AppIcon name="calendar-plus" className="h-5 w-5 text-slate-700" />
                        <h2 className="text-xl font-semibold text-slate-900">Add to waitlist</h2>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">Pick a patient and a booked slot. If the slot frees up, it is held for them.</p>
                </div>
                <Link
                    to="/workflows/waitlist"
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                    Back to waitlist
                </Link>
            </div>

            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                {error ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
                ) : null}

                <div>
                    <label className="text-sm font-semibold text-slate-900">Patient</label>
                    {patient ? (
                        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-slate-900 bg-white px-3 py-2">
                            <div>
                                <div className="text-sm font-semibold text-slate-900">{patient.full_name || `Patient #${patient.id}`}</div>
                                <div className="text-xs text-slate-500">{patient.phone || '—'}</div>
                            </div>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => setPatient(null)}
                                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                Change
                            </button>
                        </div>
                    ) : prefillLoading ? (
                        <div className="mt-2 text-sm text-slate-500">Loading patient…</div>
                    ) : (
                        <>
                            <input
                                className={`mt-2 ${inputClass}`}
                                value={query}
                                onChange={(e) => {
                                    const q = e.target.value;
                                    setQuery(q);
                                    searchPatients(q);
                                }}
                                placeholder="Search by name or mobile"
                            />
                            {searching ? <div className="mt-2 text-xs text-slate-500">Searching…</div> : null}
                            {!searching && query.trim() && !results.length ? (
                                <div className="mt-2 text-xs text-slate-500">No patients found.</div>
                            ) : null}
                            {results.length ? (
                                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                                    {results.map((p) => (
                                        <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => setPatient(p)}
                                            className="block w-full rounded-xl border border-slate-200 px-3 py-2 text-left hover:border-slate-300 hover:bg-slate-50"
                                        >
                                            <div className="text-sm font-medium text-slate-900">{p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || `Patient #${p.id}`}</div>
                                            <div className="text-xs text-slate-500">{p.phone || '—'}</div>
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </>
                    )}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                    <div>
                        <label className="text-sm font-semibold text-slate-900">Doctor</label>
                        <select
                            value={doctorId}
                            onChange={(e) => { setDoctorId(e.target.value); setStartTime(''); }}
                            className={`mt-2 ${inputClass}`}
                        >
                            <option value="">Select doctor</option>
                            {activeDoctors.map((d) => (
                                <option key={d.id} value={String(d.id)}>{doctorLabel(d)}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-semibold text-slate-900">Date</label>
                        <input
                            type="date"
                            min={today}
                            value={date}
                            onChange={(e) => { setDate(e.target.value); setStartTime(''); }}
                            className={`mt-2 ${inputClass}`}
                        />
                    </div>
                </div>

                <div>
                    <label className="text-sm font-semibold text-slate-900">Booked time</label>
                    {!doctorId || !date ? (
                        <div className="mt-2 text-sm text-slate-500">Select a doctor and date to see booked times.</div>
                    ) : slots.loading ? (
                        <div className="mt-2 text-sm text-slate-500">Loading booked times…</div>
                    ) : slots.error ? (
                        <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{slots.error}</div>
                    ) : !slots.items.length ? (
                        <div className="mt-2 text-sm text-slate-500">No booked times on this day — book the appointment directly.</div>
                    ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                            {slots.items.map((s) => (
                                <button
                                    key={s.start_time}
                                    type="button"
                                    onClick={() => setStartTime(s.start_time)}
                                    className={startTime === s.start_time
                                        ? 'rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white'
                                        : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50'}
                                >
                                    {formatTime(s.start_time)}–{formatTime(s.end_time)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                    <Link
                        to="/workflows/waitlist"
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                        Cancel
                    </Link>
                    <button
                        type="button"
                        disabled={!canSubmit}
                        onClick={submit}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                        {busy ? 'Adding…' : 'Add to waitlist'}
                    </button>
                </div>
            </div>
        </div>
    );
}
