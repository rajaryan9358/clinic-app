import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AppIcon from '../../components/AppIcon';
import { TASK_TYPE_LABELS } from './FollowupsPage';

// Add a follow-up: the few things staff actually decide (patient, type, due date, assignee, optional doctor). Status, priority and
// the rest take the table's defaults.

const apiError = (e, fallback) => e?.response?.data?.message || e?.message || fallback;
const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const todayYMD = () => new Date().toLocaleDateString('en-CA');

export default function FollowupFormPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

    const [patient, setPatient] = useState(null);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const queryRef = useRef('');

    const [taskType, setTaskType] = useState('call');
    const [dueDate, setDueDate] = useState(todayYMD);
    // Doctors and assistants default to themselves so the task lands in their own queue.
    const [assignee, setAssignee] = useState(() => (['doctor', 'assistant'].includes(user?.role) && user?.id ? String(user.id) : ''));
    const [staff, setStaff] = useState([]);
    // Doctor is optional. In a doctor-scoped session it defaults to that doctor, because the API
    // hides tasks without that doctor_id from them; it is shown and editable so nothing is hidden.
    const [doctorId, setDoctorId] = useState(() => {
        try { return localStorage.getItem('active_doctor_id') || ''; } catch { return ''; }
    });
    const [doctors, setDoctors] = useState([]);

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        client.get(`${base}/users`, { params: { per_page: 200 } })
            .then((res) => { if (!cancelled) setStaff(Array.isArray(res?.data?.data) ? res.data.data : []); })
            .catch(() => { if (!cancelled) setStaff([]); });
        client.get(`${base}/doctors`, { params: { per_page: 200 } })
            .then((res) => { if (!cancelled) setDoctors(Array.isArray(res?.data?.data) ? res.data.data : []); })
            .catch(() => { if (!cancelled) setDoctors([]); });
        return () => { cancelled = true; };
    }, [base]);

    const search = async (q) => {
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

    const canSubmit = Boolean(patient && taskType && dueDate) && !busy;

    const submit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setBusy(true);
        setError('');
        try {
            await client.post(`${base}/followups`, {
                patient_id: patient.id,
                task_type: taskType,
                due_date: dueDate,
                assigned_to_user_id: assignee ? Number(assignee) : null,
                doctor_id: doctorId ? Number(doctorId) : null,
                status: 'pending',
            });
            navigate('/workflows/followups', { replace: true });
        } catch (err) {
            setBusy(false);
            setError(apiError(err, 'Failed to add the follow-up'));
        }
    };

    return (
        <form onSubmit={submit} className="mx-auto max-w-xl space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2">
                    <AppIcon name="clipboard-check" className="h-5 w-5 text-slate-700" />
                    <h2 className="text-xl font-semibold text-slate-900">Add follow-up</h2>
                </div>
                <Link to="/workflows/followups" className="text-sm font-medium text-slate-600 hover:text-slate-900">Back to follow-ups</Link>
            </div>

            <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

                <div>
                    <label htmlFor="fu-patient" className="text-sm font-semibold text-slate-900">Patient</label>
                    {patient ? (
                        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-slate-900 bg-white px-3 py-2">
                            <div>
                                <div className="text-sm font-semibold text-slate-900">{patient.full_name || `Patient #${patient.id}`}</div>
                                <div className="text-xs text-slate-500">{patient.phone || 'No phone number'}</div>
                            </div>
                            <button type="button" onClick={() => setPatient(null)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                                Change
                            </button>
                        </div>
                    ) : (
                        <>
                            <input
                                id="fu-patient"
                                className={`mt-2 ${inputClass}`}
                                value={query}
                                onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
                                placeholder="Search by name or mobile"
                                autoComplete="off"
                            />
                            {searching ? <div className="mt-2 text-xs text-slate-500">Searching…</div> : null}
                            {!searching && query.trim() && !results.length ? <div className="mt-2 text-xs text-slate-500">No patients found.</div> : null}
                            {results.length ? (
                                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                                    {results.map((p) => (
                                        <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => setPatient(p)}
                                            className="block w-full rounded-xl border border-slate-200 px-3 py-2 text-left hover:border-slate-300 hover:bg-slate-50"
                                        >
                                            <div className="text-sm font-medium text-slate-900">{p.full_name || `Patient #${p.id}`}</div>
                                            <div className="text-xs text-slate-500">{p.phone || '—'}</div>
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </>
                    )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                        <label htmlFor="fu-type" className="text-sm font-semibold text-slate-900">Type</label>
                        <select id="fu-type" value={taskType} onChange={(e) => setTaskType(e.target.value)} className={`mt-2 ${inputClass}`}>
                            {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="fu-due" className="text-sm font-semibold text-slate-900">Due date</label>
                        <input id="fu-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`mt-2 ${inputClass}`} />
                    </div>
                </div>

                <div>
                    <label htmlFor="fu-assignee" className="text-sm font-semibold text-slate-900">Assigned to</label>
                    <select id="fu-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={`mt-2 ${inputClass}`}>
                        <option value="">Unassigned</option>
                        {user?.id && !staff.some((u) => String(u.id) === String(user.id)) ? <option value={String(user.id)}>{user.full_name || user.name || "Me"} (me)</option> : null}
                        {staff.map((u) => <option key={u.id} value={String(u.id)}>{u.full_name || u.name || `User #${u.id}`}</option>)}
                    </select>
                </div>

                <div>
                    <label htmlFor="fu-doctor" className="text-sm font-semibold text-slate-900">Doctor <span className="font-normal text-slate-500">(optional)</span></label>
                    <select id="fu-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className={`mt-2 ${inputClass}`}>
                        <option value="">No doctor</option>
                        {doctorId && !doctors.some((d) => String(d.id) === String(doctorId)) ? <option value={doctorId}>{`Doctor #${doctorId}`}</option> : null}
                        {doctors.map((d) => (
                            <option key={d.id} value={String(d.id)}>{[d.title, d.full_name || d.name].filter(Boolean).join(' ') || `Doctor #${d.id}`}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="flex justify-end gap-2">
                <Link to="/workflows/followups" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</Link>
                <button type="submit" disabled={!canSubmit} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                    {busy ? 'Adding…' : 'Add follow-up'}
                </button>
            </div>
        </form>
    );
}
