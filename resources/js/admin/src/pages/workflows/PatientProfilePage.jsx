import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';
import AppIcon from '../../components/AppIcon';
import StatusBadge from '../../components/StatusBadge';

function tabButton(active) {
    return active
        ? 'rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white'
        : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';
}

function fmtDate(value) {
    if (!value) return '—';
    try {
        const s = String(value).slice(0, 10);
        const d = new Date(`${s}T00:00:00`);
        if (Number.isNaN(d.getTime())) return s;
        return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
    } catch {
        return String(value);
    }
}

function fmtDateTime(value) {
    if (!value) return '—';
    try {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return String(value);
        return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
    } catch {
        return String(value);
    }
}

const visitTypeLabel = (vt) => {
    if (!vt) return null;
    const map = { new: 'New', followup: 'Follow-up', routine: 'Routine', urgent: 'Urgent' };
    return map[vt] || String(vt).replace('_', ' ');
};

const visitTypeBg = (vt) => {
    const map = { new: 'bg-emerald-100 text-emerald-700', followup: 'bg-blue-100 text-blue-700', routine: 'bg-slate-100 text-slate-700', urgent: 'bg-rose-100 text-rose-700' };
    return map[vt] || 'bg-slate-100 text-slate-700';
};

const activityConfig = (type) => {
    const configs = {
        appointment: {
            label: 'Appointment',
            dotBg: 'bg-blue-500',
            iconBg: 'bg-blue-100',
            iconColor: 'text-blue-600',
            badgeCls: 'bg-blue-100 text-blue-700',
            icon: '🗓',
        },
        followup: {
            label: 'Follow-up',
            dotBg: 'bg-violet-500',
            iconBg: 'bg-violet-100',
            iconColor: 'text-violet-600',
            badgeCls: 'bg-violet-100 text-violet-700',
            icon: '🔁',
        },
        note: {
            label: 'Note',
            dotBg: 'bg-slate-400',
            iconBg: 'bg-slate-100',
            iconColor: 'text-slate-500',
            badgeCls: 'bg-slate-100 text-slate-600',
            icon: '📝',
        },
        invoice: {
            label: 'Invoice',
            dotBg: 'bg-amber-500',
            iconBg: 'bg-amber-100',
            iconColor: 'text-amber-600',
            badgeCls: 'bg-amber-100 text-amber-700',
            icon: '🧾',
        },
        payment: {
            label: 'Payment',
            dotBg: 'bg-emerald-500',
            iconBg: 'bg-emerald-100',
            iconColor: 'text-emerald-600',
            badgeCls: 'bg-emerald-100 text-emerald-700',
            icon: '💳',
        },
    };
    return configs[type] || {
        label: type,
        dotBg: 'bg-slate-300',
        iconBg: 'bg-slate-100',
        iconColor: 'text-slate-400',
        badgeCls: 'bg-slate-100 text-slate-600',
        icon: '•',
    };
};

function groupByDate(events) {
    const groups = [];
    const seen = {};
    for (const ev of events) {
        const day = ev.at ? String(ev.at).slice(0, 10) : 'Unknown';
        if (!seen[day]) {
            seen[day] = true;
            groups.push({ day, items: [] });
        }
        groups[groups.length - 1].items.push(ev);
    }
    return groups;
}

function fmtGroupDate(ymd) {
    if (!ymd || ymd === 'Unknown') return 'Unknown date';
    try {
        const d = new Date(`${ymd}T00:00:00`);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        if (d.getTime() === today.getTime()) return 'Today';
        if (d.getTime() === yesterday.getTime()) return 'Yesterday';
        return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
    } catch {
        return ymd;
    }
}

export default function PatientProfilePage() {
    const { id } = useParams();
    const { user } = useAuth();
    const scope = useScope();
    const canEditPatient = Boolean(scope?.can?.('patients.edit'));
    const canPortalLink = Boolean(scope?.can?.('patients.portal_link'));
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

    const [tab, setTab] = useState('notes');

    const [profile, setProfile] = useState(null);
    const [loadingProfile, setLoadingProfile] = useState(false);
    const [error, setError] = useState('');
    const [pdfBusy, setPdfBusy] = useState(false);

    const [notes, setNotes] = useState([]);
    const [notesLoading, setNotesLoading] = useState(false);

    const [doctorOptions, setDoctorOptions] = useState([]);

    const [noteDraft, setNoteDraft] = useState({ note_type: 'general', note: '', is_private: false, doctor_id: '' });
    const [noteSaving, setNoteSaving] = useState(false);
    const [noteDialogOpen, setNoteDialogOpen] = useState(false);

    const [medical, setMedical] = useState({ allergies: '', chronic_conditions: '', current_medications: '', surgeries_history: '', family_history: '', notes: '' });
    const [medicalSaving, setMedicalSaving] = useState(false);

    const [appointments, setAppointments] = useState([]);
    const [appointmentsLoading, setAppointmentsLoading] = useState(false);

    const [activity, setActivity] = useState([]);
    const [activityLoading, setActivityLoading] = useState(false);

    // Global summary state
    const [globalSummary, setGlobalSummary] = useState(null);
    const [globalSummaryLoading, setGlobalSummaryLoading] = useState(false);
    const [globalSummaryError, setGlobalSummaryError] = useState('');

    // Portal link state
    const [portalLink, setPortalLink] = useState({ sending: false, error: '', url: '', expiresAt: '', whatsappStatus: '', copied: false });

    // "Managed by" picker state
    const [managedBy, setManagedBy] = useState({ open: false, query: '', options: [], searching: false, saving: false, error: '' });
    const managedByQueryRef = useRef('');

    // "Add family link" picker state
    const [familyLinkForm, setFamilyLinkForm] = useState({ open: false, query: '', options: [], searching: false, relation: '', saving: false, error: '' });
    const familyLinkQueryRef = useRef('');
    const [familyLinkRemoving, setFamilyLinkRemoving] = useState(null);
    const [familyLinkRemoveError, setFamilyLinkRemoveError] = useState('');

    const loadProfile = async () => {
        setLoadingProfile(true);
        setError('');
        try {
            const { data } = await client.get(`${base}/patients/${id}/profile`);
            setProfile(data?.data || null);

            const mp = data?.data?.patient?.medical_profile || data?.data?.patient?.medicalProfile;
            setMedical({
                allergies: mp?.allergies || '',
                chronic_conditions: mp?.chronic_conditions || '',
                current_medications: mp?.current_medications || '',
                surgeries_history: mp?.surgeries_history || '',
                family_history: mp?.family_history || '',
                notes: mp?.notes || '',
            });
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to load patient');
        } finally {
            setLoadingProfile(false);
        }
    };

    const loadDoctors = async (clinicId) => {
        try {
            const doctorParams = { per_page: 200 };
            if (user?.role === 'super_admin' && clinicId) {
                doctorParams.clinic_id = clinicId;
            }

            const doctorsRes = await client.get(`${base}/doctors`, { params: doctorParams });

            setDoctorOptions((doctorsRes.data?.data || []).map((d) => ({ value: String(d.id), label: d.full_name || `#${d.id}` })));
        } catch {
            setDoctorOptions([]);
        }
    };

    const loadNotes = async () => {
        setNotesLoading(true);
        setError('');
        try {
            const { data } = await client.get(`${base}/patients/${id}/notes`, { params: { per_page: 30 } });
            setNotes(data?.data || []);

            const clinicId = profile?.patient?.clinic_id;
            await loadDoctors(clinicId);
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to load notes');
        } finally {
            setNotesLoading(false);
        }
    };

    const addNote = async () => {
        setNoteSaving(true);
        setError('');
        try {
            await client.post(`${base}/patients/${id}/notes`, {
                note_type: noteDraft.note_type,
                note: noteDraft.note,
                is_private: Boolean(noteDraft.is_private),
                doctor_id: noteDraft.doctor_id ? Number(noteDraft.doctor_id) : null,
            });
            setNoteDraft({ note_type: 'general', note: '', is_private: false, doctor_id: '' });
            setNoteDialogOpen(false);
            await loadNotes();
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to add note');
        } finally {
            setNoteSaving(false);
        }
    };

    const saveMedical = async () => {
        setMedicalSaving(true);
        setError('');
        try {
            await client.put(`${base}/patients/${id}/medical-profile`, medical);
            await loadProfile();
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to save medical profile');
        } finally {
            setMedicalSaving(false);
        }
    };

    const loadAppointments = async () => {
        setAppointmentsLoading(true);
        setError('');
        try {
            const { data } = await client.get(`${base}/appointments`, {
                params: { patient_id: id, per_page: 30, sort_by: 'appointment_date', sort_dir: 'desc' },
            });
            setAppointments(data?.data || []);
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to load appointments');
        } finally {
            setAppointmentsLoading(false);
        }
    };

    const loadActivity = async () => {
        setActivityLoading(true);
        setError('');
        try {
            const { data } = await client.get(`${base}/patients/${id}/activity`, { params: { limit: 80 } });
            setActivity(data?.data?.events || []);
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to load activity');
        } finally {
            setActivityLoading(false);
        }
    };

    const loadGlobalSummary = async () => {
        setGlobalSummaryLoading(true);
        setGlobalSummaryError('');
        try {
            const { data } = await client.get(`${base}/patients/${id}/global-summary`);
            setGlobalSummary(data?.data?.summary || null);
        } catch {
            // silently ignore — no summary yet is fine
        } finally {
            setGlobalSummaryLoading(false);
        }
    };

    const generateGlobalSummary = async () => {
        setGlobalSummaryLoading(true);
        setGlobalSummaryError('');
        try {
            const { data } = await client.post(`${base}/patients/${id}/global-summary`);
            setGlobalSummary(data?.data?.summary || null);
        } catch (e) {
            setGlobalSummaryError(e?.response?.data?.message || e?.message || 'Failed to generate summary');
        } finally {
            setGlobalSummaryLoading(false);
        }
    };

    const sendPortalLink = async () => {
        setPortalLink({ sending: true, error: '', url: '', expiresAt: '', whatsappStatus: '', copied: false });
        try {
            const { data } = await client.post(`${base}/patients/${id}/portal-link`);
            const d = data?.data || {};
            setPortalLink({
                sending: false,
                error: '',
                url: d.url || '',
                expiresAt: d.expires_at || '',
                whatsappStatus: d.whatsapp?.delivery_status || '',
                copied: false,
            });
        } catch (e) {
            setPortalLink((p) => ({ ...p, sending: false, error: e?.response?.data?.message || e?.message || 'Failed to send link.' }));
        }
    };

    const copyPortalLink = async () => {
        if (!portalLink.url) return;
        try {
            await navigator.clipboard.writeText(portalLink.url);
            setPortalLink((p) => ({ ...p, copied: true }));
            setTimeout(() => setPortalLink((p) => ({ ...p, copied: false })), 2000);
        } catch {
            // clipboard access denied — no-op
        }
    };

    const searchManagedByOptions = async (q) => {
        managedByQueryRef.current = q;
        setManagedBy((p) => ({ ...p, searching: true }));
        try {
            const params = { search: q, per_page: 20 };
            if (user?.role === 'super_admin' && profile?.patient?.clinic_id) {
                params.clinic_id = profile.patient.clinic_id;
            }
            const { data } = await client.get(`${base}/patients`, { params });
            if (managedByQueryRef.current !== q) return; // a newer search superseded this response
            const rows = (data?.data || []).filter((p) => !p.managed_by_patient_id && String(p.id) !== String(id));
            setManagedBy((p) => ({ ...p, options: rows, searching: false }));
        } catch {
            if (managedByQueryRef.current !== q) return;
            setManagedBy((p) => ({ ...p, options: [], searching: false }));
        }
    };

    const saveManagedBy = async (managerId) => {
        setManagedBy((p) => ({ ...p, saving: true, error: '' }));
        try {
            await client.put(`${base}/patients/${id}/managed-by`, { managed_by_patient_id: managerId });
            setManagedBy({ open: false, query: '', options: [], searching: false, saving: false, error: '' });
            await loadProfile();
        } catch (e) {
            setManagedBy((p) => ({ ...p, saving: false, error: e?.response?.data?.message || e?.message || 'Failed to update.' }));
        }
    };

    useEffect(() => {
        if (!managedBy.open) return;
        const t = setTimeout(() => {
            searchManagedByOptions(managedBy.query);
        }, 250);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [managedBy.open, managedBy.query]);

    const searchFamilyLinkOptions = async (q) => {
        familyLinkQueryRef.current = q;
        setFamilyLinkForm((p) => ({ ...p, searching: true }));
        try {
            const params = { search: q, per_page: 20 };
            if (user?.role === 'super_admin' && profile?.patient?.clinic_id) {
                params.clinic_id = profile.patient.clinic_id;
            }
            const { data } = await client.get(`${base}/patients`, { params });
            if (familyLinkQueryRef.current !== q) return; // a newer search superseded this response
            const rows = (data?.data || []).filter((p) => String(p.id) !== String(id));
            setFamilyLinkForm((p) => ({ ...p, options: rows, searching: false }));
        } catch {
            if (familyLinkQueryRef.current !== q) return;
            setFamilyLinkForm((p) => ({ ...p, options: [], searching: false }));
        }
    };

    const addFamilyLink = async (relatedPatientId) => {
        setFamilyLinkForm((p) => ({ ...p, saving: true, error: '' }));
        try {
            await client.post(`${base}/patients/${id}/family-links`, {
                related_patient_id: relatedPatientId,
                relation: familyLinkForm.relation || null,
            });
            setFamilyLinkForm({ open: false, query: '', options: [], searching: false, relation: '', saving: false, error: '' });
            await loadProfile();
        } catch (e) {
            setFamilyLinkForm((p) => ({ ...p, saving: false, error: e?.response?.data?.message || e?.message || 'Failed to add family link.' }));
        }
    };

    const removeFamilyLink = async (linkId) => {
        setFamilyLinkRemoving(linkId);
        setFamilyLinkRemoveError('');
        try {
            await client.delete(`${base}/patients/${id}/family-links/${linkId}`);
            await loadProfile();
        } catch (e) {
            setFamilyLinkRemoveError(e?.response?.data?.message || e?.message || 'Failed to remove family link.');
        } finally {
            setFamilyLinkRemoving(null);
        }
    };

    useEffect(() => {
        if (!familyLinkForm.open) return;
        const t = setTimeout(() => {
            searchFamilyLinkOptions(familyLinkForm.query);
        }, 250);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [familyLinkForm.open, familyLinkForm.query]);

    useEffect(() => {
        // A client-side navigation from one patient to another reuses this
        // mounted component, so any in-flight/previously-shown per-patient
        // state (a just-issued portal link URL, an open "managed by"
        // search, a pending "add family link" form) must be cleared —
        // otherwise it can flash patient A's data while patient B loads.
        setPortalLink({ sending: false, error: '', url: '', expiresAt: '', whatsappStatus: '', copied: false });
        setManagedBy({ open: false, query: '', options: [], searching: false, saving: false, error: '' });
        setFamilyLinkForm({ open: false, query: '', options: [], searching: false, relation: '', saving: false, error: '' });
        setFamilyLinkRemoving(null);
        setFamilyLinkRemoveError('');
        managedByQueryRef.current = '';
        familyLinkQueryRef.current = '';
        loadProfile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [base, id]);

    useEffect(() => {
        if (!profile) return;
        if (tab === 'notes') loadNotes();
        if (tab === 'appointments') { loadAppointments(); loadGlobalSummary(); }
        if (tab === 'activity') loadActivity();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, profile]);

    const patient = profile?.patient;
    const counts = profile?.counts || {};
    const family = profile?.family || {};
    const isAccountHolder = !patient?.managed_by_patient_id;
    // A family link (patient_id -> related_patient_id) lets THIS patient's
    // portal account act for the related patient's profile — not the other
    // way around (see App\Support\Portal\PortalProfiles::allowedFor). Any
    // copy shown near the links list must say that direction explicitly.
    const patientFirstName = (patient?.full_name || '').trim().split(/\s+/)[0] || 'This patient';

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

    const downloadPatientReport = async () => {
        setPdfBusy(true);
        setError('');
        try {
            const res = await client.get(`${base}/patients/${id}/report.pdf`, { responseType: 'blob' });
            downloadBlob(res.data, `patient-report-${id}.pdf`);
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to download report');
        } finally {
            setPdfBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2">
                    <AppIcon name="module" className="h-5 w-5 text-slate-700" />
                    <div>
                        <h2 className="text-xl font-semibold text-slate-900">Patient Profile</h2>
                        <p className="mt-0.5 text-sm text-slate-600">Notes, visits, medical info and activity in one place.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Link to="/modules/patients" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Back to Patients</Link>
                    <button
                        type="button"
                        onClick={downloadPatientReport}
                        disabled={pdfBusy}
                        className={pdfBusy
                            ? 'rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-500'
                            : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
                        }
                    >
                        Download patient report
                    </button>
                    {canEditPatient ? (
                        <Link to={`/modules/patients/${id}/edit`} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">Edit</Link>
                    ) : null}
                </div>
            </div>

            {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                {loadingProfile ? (
                    <div className="text-sm text-slate-600">Loading…</div>
                ) : patient ? (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="text-lg font-semibold text-slate-900">{patient.full_name}</div>
                            <div className="mt-1 text-sm text-slate-600">Phone: <span className="font-medium text-slate-800">{patient.phone || '—'}</span></div>
                            <div className="mt-1 text-sm text-slate-600">Status: <span className="inline-block align-middle"><StatusBadge status={patient.status_tag} /></span></div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Appointments</div>
                                <div className="text-lg font-semibold">{counts.appointments ?? 0}</div>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</div>
                                <div className="text-lg font-semibold">{counts.notes ?? 0}</div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-sm text-slate-600">Patient not found.</div>
                )}
            </div>

            {patient ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h3 className="text-base font-semibold text-slate-900">Patient Portal &amp; Family</h3>
                            <p className="mt-0.5 text-sm text-slate-500">Consent status, portal login link and family access.</p>
                        </div>
                        {canPortalLink && isAccountHolder ? (
                            <button
                                type="button"
                                onClick={sendPortalLink}
                                disabled={portalLink.sending}
                                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                            >
                                {portalLink.sending ? 'Sending…' : 'Send portal link'}
                            </button>
                        ) : null}
                    </div>

                    {canPortalLink && !isAccountHolder ? (
                        <p className="mt-2 text-sm text-slate-500">
                            Portal links can only be sent to the account holder
                            {family?.managed_by?.full_name ? ` (${family.managed_by.full_name})` : ''}, not this dependent.
                        </p>
                    ) : null}

                    {portalLink.error ? (
                        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{portalLink.error}</div>
                    ) : null}

                    {portalLink.url ? (
                        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <code className="min-w-0 flex-1 truncate text-xs text-emerald-800">{portalLink.url}</code>
                                <button
                                    type="button"
                                    onClick={copyPortalLink}
                                    className="shrink-0 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                                >
                                    {portalLink.copied ? 'Copied!' : 'Copy'}
                                </button>
                            </div>
                            <p className="mt-1.5 text-xs text-emerald-700">
                                Expires {fmtDateTime(portalLink.expiresAt)} · WhatsApp: {portalLink.whatsappStatus || '—'}
                            </p>
                        </div>
                    ) : null}

                    <div className="mt-4 text-sm text-slate-600">
                        Consent:{' '}
                        {patient.consent_given_at ? (
                            <span className="font-medium text-slate-800">
                                Accepted {fmtDateTime(patient.consent_given_at)} (v{patient.consent_version || '—'})
                            </span>
                        ) : (
                            <span className="font-medium text-slate-500">Not yet accepted</span>
                        )}
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Managed by</div>
                            {isAccountHolder ? (
                                <p className="mt-1 text-sm text-slate-500">Account holder — not managed by anyone.</p>
                            ) : (
                                <p className="mt-1 text-sm text-slate-800">{family?.managed_by?.full_name || `Patient #${patient.managed_by_patient_id}`}</p>
                            )}

                            {canEditPatient ? (
                                <div className="mt-2">
                                    {managedBy.open ? (
                                        <div className="relative">
                                            <input
                                                autoFocus
                                                type="text"
                                                placeholder="Search account holders…"
                                                value={managedBy.query}
                                                onChange={(e) => setManagedBy((p) => ({ ...p, query: e.target.value }))}
                                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                                            />
                                            <div className="mt-1 max-h-48 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                                                {managedBy.searching ? (
                                                    <div className="px-3 py-2 text-sm text-slate-500">Searching…</div>
                                                ) : managedBy.options.length ? (
                                                    managedBy.options.map((opt) => (
                                                        <button
                                                            key={opt.id}
                                                            type="button"
                                                            disabled={managedBy.saving}
                                                            onClick={() => saveManagedBy(opt.id)}
                                                            className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                                                        >
                                                            {opt.full_name}{opt.phone ? ` · ${opt.phone}` : ''}
                                                        </button>
                                                    ))
                                                ) : (
                                                    <div className="px-3 py-2 text-sm text-slate-500">No account holders found.</div>
                                                )}
                                            </div>
                                            {managedBy.error ? (
                                                <div className="mt-1 text-xs text-rose-600">{managedBy.error}</div>
                                            ) : null}
                                            <div className="mt-2 flex items-center gap-2">
                                                {!isAccountHolder ? (
                                                    <button
                                                        type="button"
                                                        disabled={managedBy.saving}
                                                        onClick={() => saveManagedBy(null)}
                                                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                                    >
                                                        Clear
                                                    </button>
                                                ) : null}
                                                <button
                                                    type="button"
                                                    disabled={managedBy.saving}
                                                    onClick={() => setManagedBy({ open: false, query: '', options: [], searching: false, saving: false, error: '' })}
                                                    className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setManagedBy((p) => ({ ...p, open: true }))}
                                            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                        >
                                            Change…
                                        </button>
                                    )}
                                </div>
                            ) : null}
                        </div>

                        <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dependents</div>
                            {(family.dependents || []).length ? (
                                <ul className="mt-1 space-y-1 text-sm text-slate-800">
                                    {family.dependents.map((d) => (
                                        <li key={d.id}>{d.full_name}{d.phone ? ` · ${d.phone}` : ''}</li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="mt-1 text-sm text-slate-500">None</p>
                            )}
                        </div>
                    </div>

                    <div className="mt-4">
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Family Links</div>
                            {canEditPatient && !familyLinkForm.open ? (
                                <button
                                    type="button"
                                    onClick={() => setFamilyLinkForm((p) => ({ ...p, open: true }))}
                                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                    Add family link
                                </button>
                            ) : null}
                        </div>

                        {familyLinkRemoveError ? (
                            <div className="mt-2 text-xs text-rose-600">{familyLinkRemoveError}</div>
                        ) : null}

                        {(family.links || []).length ? (
                            <ul className="mt-1 space-y-1 text-sm text-slate-800">
                                {family.links.map((l) => (
                                    <li key={l.id} className="flex items-center justify-between gap-2">
                                        <span>
                                            {l.related_patient?.full_name || `Patient #${l.related_patient_id}`}
                                            {l.relation ? ` · ${l.relation}` : ''}
                                            {' — '}
                                            <span className="text-xs text-slate-500">
                                                {patientFirstName} can open {l.related_patient?.full_name || `Patient #${l.related_patient_id}`}&rsquo;s portal profile
                                            </span>
                                        </span>
                                        {canEditPatient ? (
                                            <button
                                                type="button"
                                                disabled={familyLinkRemoving === l.id}
                                                onClick={() => removeFamilyLink(l.id)}
                                                className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                            >
                                                {familyLinkRemoving === l.id ? 'Removing…' : 'Remove'}
                                            </button>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="mt-1 text-sm text-slate-500">None</p>
                        )}

                        {familyLinkForm.open ? (
                            <div className="relative mt-3">
                                <p className="mb-2 text-xs text-slate-500">
                                    {patientFirstName} will be able to open the portal profile of whoever you pick here — not the other way around.
                                </p>
                                <input
                                    autoFocus
                                    type="text"
                                    placeholder="Search patients…"
                                    value={familyLinkForm.query}
                                    onChange={(e) => setFamilyLinkForm((p) => ({ ...p, query: e.target.value }))}
                                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                                />
                                <input
                                    type="text"
                                    placeholder="Relation (optional, e.g. spouse)"
                                    value={familyLinkForm.relation}
                                    onChange={(e) => setFamilyLinkForm((p) => ({ ...p, relation: e.target.value }))}
                                    maxLength={50}
                                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                                />
                                <div className="mt-1 max-h-48 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                                    {familyLinkForm.searching ? (
                                        <div className="px-3 py-2 text-sm text-slate-500">Searching…</div>
                                    ) : familyLinkForm.options.length ? (
                                        familyLinkForm.options.map((opt) => (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                disabled={familyLinkForm.saving}
                                                onClick={() => addFamilyLink(opt.id)}
                                                className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                                            >
                                                {opt.full_name}{opt.phone ? ` · ${opt.phone}` : ''}
                                            </button>
                                        ))
                                    ) : (
                                        <div className="px-3 py-2 text-sm text-slate-500">No patients found.</div>
                                    )}
                                </div>
                                {familyLinkForm.error ? (
                                    <div className="mt-1 text-xs text-rose-600">{familyLinkForm.error}</div>
                                ) : null}
                                <div className="mt-2">
                                    <button
                                        type="button"
                                        disabled={familyLinkForm.saving}
                                        onClick={() => setFamilyLinkForm({ open: false, query: '', options: [], searching: false, relation: '', saving: false, error: '' })}
                                        className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <button type="button" onClick={() => setTab('notes')} className={tabButton(tab === 'notes')}>Notes</button>
                <button type="button" onClick={() => setTab('appointments')} className={tabButton(tab === 'appointments')}>Appointments</button>
                <button type="button" onClick={() => setTab('medical')} className={tabButton(tab === 'medical')}>Medical</button>
                <button type="button" onClick={() => setTab('activity')} className={tabButton(tab === 'activity')}>Activity</button>
            </div>

            {tab === 'notes' ? (
                <div className="space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h3 className="text-lg font-semibold">Notes</h3>
                                <p className="mt-0.5 text-sm text-slate-600">Internal notes for this patient.</p>
                            </div>
                            {canEditPatient ? (
                                <button
                                    type="button"
                                    onClick={() => setNoteDialogOpen(true)}
                                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                                >
                                    Add Note
                                </button>
                            ) : null}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <h3 className="text-lg font-semibold">Recent Notes</h3>
                        {notesLoading ? <div className="mt-2 text-sm text-slate-600">Loading…</div> : null}
                        {!notesLoading && !notes.length ? <div className="mt-2 text-sm text-slate-600">No notes yet.</div> : null}

                        <div className="mt-3 space-y-2">
                            {notes.map((n) => (
                                <div key={n.id} className="rounded-xl border border-slate-200 px-4 py-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                        <div className="font-semibold text-slate-900">{n.note_type}{n.is_private ? ' · private' : ''}</div>
                                        <div className="text-slate-600">{fmtDateTime(n.created_at)}</div>
                                    </div>
                                    <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{n.note}</div>
                                    <div className="mt-2 text-xs text-slate-500">
                                        {n.created_by_user?.full_name ? `By ${n.created_by_user.full_name}` : null}
                                        {n.doctor?.full_name ? ` · Doctor: ${n.doctor.full_name}` : null}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {noteDialogOpen ? (
                        <div
                            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
                            onClick={() => setNoteDialogOpen(false)}
                        >
                            <div
                                className="max-h-[88vh] w-full max-w-2xl overflow-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                                    <div>
                                        <div className="text-lg font-semibold text-slate-900">Add Note</div>
                                        <div className="mt-0.5 text-sm text-slate-600">Save a note to this patient profile.</div>
                                    </div>
                                    <button type="button" onClick={() => setNoteDialogOpen(false)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">Close</button>
                                </div>

                                <div className="p-5">
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <div>
                                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Type</label>
                                            <select
                                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                                                value={noteDraft.note_type}
                                                onChange={(e) => setNoteDraft((p) => ({ ...p, note_type: e.target.value }))}
                                            >
                                                <option value="general">general</option>
                                                <option value="doctor_note">doctor_note</option>
                                                <option value="reception_note">reception_note</option>
                                                <option value="followup_note">followup_note</option>
                                            </select>
                                        </div>

                                        <div className="flex items-end">
                                            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(noteDraft.is_private)}
                                                    onChange={(e) => setNoteDraft((p) => ({ ...p, is_private: e.target.checked }))}
                                                />
                                                Private
                                            </label>
                                        </div>

                                        <div>
                                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Doctor (optional)</label>
                                            <select
                                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                                                value={noteDraft.doctor_id}
                                                onChange={(e) => setNoteDraft((p) => ({ ...p, doctor_id: e.target.value }))}
                                            >
                                                <option value="">—</option>
                                                {doctorOptions.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="md:col-span-2">
                                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Note</label>
                                            <textarea
                                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                                                rows={5}
                                                value={noteDraft.note}
                                                onChange={(e) => setNoteDraft((p) => ({ ...p, note: e.target.value }))}
                                            />
                                        </div>
                                    </div>

                                    <div className="mt-4 flex items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setNoteDialogOpen(false)}
                                            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={addNote}
                                            disabled={noteSaving || !String(noteDraft.note || '').trim()}
                                            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                                        >
                                            {noteSaving ? 'Saving…' : 'Save Note'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {tab === 'medical' ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="text-lg font-semibold">Medical Profile</h3>
                        {canEditPatient ? (
                            <button
                                type="button"
                                onClick={saveMedical}
                                disabled={medicalSaving}
                                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                            >
                                {medicalSaving ? 'Saving…' : 'Save'}
                            </button>
                        ) : null}
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {[
                            ['allergies', 'Allergies'],
                            ['chronic_conditions', 'Chronic Conditions'],
                            ['current_medications', 'Current Medications'],
                            ['surgeries_history', 'Surgeries History'],
                            ['family_history', 'Family History'],
                        ].map(([key, label]) => (
                            <div key={key}>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
                                <textarea
                                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                                    rows={3}
                                    value={medical[key]}
                                    disabled={!canEditPatient}
                                    onChange={(e) => setMedical((p) => ({ ...p, [key]: e.target.value }))}
                                />
                            </div>
                        ))}
                        <div className="md:col-span-2">
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</label>
                            <textarea
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                                rows={4}
                                value={medical.notes}
                                disabled={!canEditPatient}
                                onChange={(e) => setMedical((p) => ({ ...p, notes: e.target.value }))}
                            />
                        </div>
                    </div>
                </div>
            ) : null}

            {tab === 'appointments' ? (
                <div className="space-y-4">
                    {/* Global Summary */}
                    <div className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 className="text-base font-semibold text-slate-900">AI Global Summary</h3>
                                <p className="mt-0.5 text-sm text-slate-500">
                                    {globalSummary?.summary_generated_at
                                        ? `Last generated ${fmtDateTime(globalSummary.summary_generated_at)}`
                                        : 'AI-powered health overview from all appointments, prescriptions, and notes.'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={generateGlobalSummary}
                                disabled={globalSummaryLoading}
                                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                            >
                                {globalSummaryLoading ? (
                                    <>
                                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                                        {globalSummary ? 'Regenerating…' : 'Generating…'}
                                    </>
                                ) : (
                                    <>
                                        <AppIcon name="section" className="h-4 w-4" />
                                        {globalSummary ? 'Regenerate' : 'Generate Summary'}
                                    </>
                                )}
                            </button>
                        </div>

                        {globalSummaryError ? (
                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{globalSummaryError}</div>
                        ) : null}

                        {globalSummaryLoading && !globalSummary ? (
                            <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />
                                Loading summary…
                            </div>
                        ) : null}

                        {!globalSummaryLoading && !globalSummary && !globalSummaryError ? (
                            <div className="mt-4 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 px-4 py-5 text-center">
                                <p className="text-sm text-slate-500">No summary yet. Click <span className="font-medium text-indigo-600">Generate Summary</span> to create one.</p>
                            </div>
                        ) : null}

                        {globalSummary ? (
                            <div className="mt-4 space-y-3">
                                {globalSummary.overall_health_summary ? (
                                    <div className="rounded-xl bg-indigo-50 p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Overall Health Summary</p>
                                        <p className="mt-1.5 text-sm text-slate-800 leading-relaxed">{globalSummary.overall_health_summary}</p>
                                    </div>
                                ) : null}

                                <div className="grid gap-3 md:grid-cols-2">
                                    {(globalSummary.key_concerns || []).length > 0 ? (
                                        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">Key Concerns</p>
                                            <ul className="mt-1.5 space-y-1">
                                                {(globalSummary.key_concerns || []).map((c, i) => (
                                                    <li key={i} className="flex items-start gap-2 text-sm text-slate-800">
                                                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                                                        {c}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ) : null}

                                    {globalSummary.treatment_progress ? (
                                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                                            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Treatment Progress</p>
                                            <p className="mt-1.5 text-sm text-slate-800 leading-relaxed">{globalSummary.treatment_progress}</p>
                                        </div>
                                    ) : null}

                                    {globalSummary.recommended_focus ? (
                                        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 md:col-span-2">
                                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Recommended Focus</p>
                                            <p className="mt-1.5 text-sm text-slate-800 leading-relaxed">{globalSummary.recommended_focus}</p>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        ) : null}
                    </div>

                    {/* Appointments Timeline */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <h3 className="text-base font-semibold text-slate-900">Appointment History</h3>
                        <p className="mt-0.5 text-sm text-slate-500">All visits ordered by most recent.</p>

                        {appointmentsLoading ? <div className="mt-4 text-sm text-slate-600">Loading…</div> : null}
                        {!appointmentsLoading && !appointments.length ? (
                            <div className="mt-4 flex flex-col items-center py-10 text-center">
                                <AppIcon name="calendar" className="mb-3 h-8 w-8 text-slate-200" />
                                <p className="text-sm font-medium text-slate-500">No appointments yet</p>
                            </div>
                        ) : null}

                        <div className="mt-4 relative">
                            {appointments.length > 0 ? (
                                <div className="absolute left-5 top-2 bottom-2 w-0.5 bg-slate-100" />
                            ) : null}
                            <div className="space-y-3">
                                {appointments.map((a, idx) => (
                                    <div key={a.id} className="relative flex gap-4">
                                        {/* Timeline dot */}
                                        <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-100 shadow-sm">
                                            <span className={`h-3 w-3 rounded-full ${
                                                a.status === 'completed' ? 'bg-emerald-500'
                                                : a.status === 'cancelled' || a.status === 'no_show' ? 'bg-rose-400'
                                                : a.status === 'in_progress' ? 'bg-blue-500'
                                                : 'bg-slate-400'
                                            }`} />
                                        </div>

                                        <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50/50 p-3 hover:bg-slate-50">
                                            <div className="flex flex-wrap items-start justify-between gap-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-sm font-semibold text-slate-900">
                                                        {fmtDate(a.appointment_date)}
                                                    </span>
                                                    {a.start_time ? (
                                                        <span className="text-xs text-slate-500">{String(a.start_time).slice(0, 5)}</span>
                                                    ) : null}
                                                    {a.visit_type ? (
                                                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${visitTypeBg(a.visit_type)}`}>
                                                            {visitTypeLabel(a.visit_type)}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <StatusBadge status={a.status} />
                                            </div>

                                            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                                                {a.doctor?.full_name ? (
                                                    <span>Dr. <span className="font-medium text-slate-800">{a.doctor.full_name}</span></span>
                                                ) : null}
                                                {a.token_number != null ? (
                                                    <span>Token <span className="font-medium text-slate-800">#{a.token_number}</span></span>
                                                ) : null}
                                                {(a.prescriptions_count ?? 0) > 0 ? (
                                                    <span className="text-indigo-600">{a.prescriptions_count} prescription{a.prescriptions_count !== 1 ? 's' : ''}</span>
                                                ) : null}
                                            </div>

                                            {a.notes ? (
                                                <p className="mt-1.5 text-xs text-slate-600 line-clamp-2">{a.notes}</p>
                                            ) : null}

                                            <div className="mt-2 flex items-center gap-2">
                                                <Link
                                                    to={`/workflows/appointments/${a.id}`}
                                                    className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                                                >
                                                    <AppIcon name="view" className="h-3 w-3" />
                                                    View Details
                                                </Link>
                                                {(a.prescriptions_count ?? 0) > 0 ? (
                                                    <Link
                                                        to={`/workflows/appointments/${a.id}/prescription`}
                                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                                    >
                                                        View Prescription
                                                    </Link>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {tab === 'activity' ? (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
                        <div>
                            <h3 className="text-base font-semibold text-slate-900">Activity Timeline</h3>
                            <p className="mt-0.5 text-sm text-slate-500">All patient events in chronological order.</p>
                        </div>
                        <button
                            type="button"
                            onClick={loadActivity}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                            Refresh
                        </button>
                    </div>

                    {activityLoading ? (
                        <div className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                            Loading activity…
                        </div>
                    ) : null}

                    {!activityLoading && !activity.length ? (
                        <div className="flex flex-col items-center py-14 text-center">
                            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">📋</div>
                            <p className="text-sm font-medium text-slate-500">No activity yet</p>
                            <p className="mt-1 text-xs text-slate-400">Events will appear here as the patient interacts with the clinic.</p>
                        </div>
                    ) : null}

                    {activity.length > 0 ? (
                        <div className="px-5 py-4">
                            {groupByDate(activity).map(({ day, items }) => (
                                <div key={day} className="mb-6 last:mb-0">
                                    {/* Date separator */}
                                    <div className="mb-3 flex items-center gap-3">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{fmtGroupDate(day)}</span>
                                        <div className="h-px flex-1 bg-slate-100" />
                                    </div>

                                    <div className="space-y-2">
                                        {items.map((ev) => {
                                            const cfg = activityConfig(ev.type);
                                            const metaEntries = ev.meta
                                                ? Object.entries(ev.meta).filter(([, v]) => v != null && v !== '')
                                                : [];
                                            return (
                                                <div key={`${ev.type}:${ev.id}`} className="flex items-start gap-3">
                                                    {/* Icon */}
                                                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm ${cfg.iconBg}`}>
                                                        {cfg.icon}
                                                    </div>

                                                    {/* Content */}
                                                    <div className="flex-1 min-w-0 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                                                        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.badgeCls}`}>
                                                                    {cfg.label}
                                                                </span>
                                                                <span className="text-sm text-slate-800 truncate">{ev.title}</span>
                                                            </div>
                                                            <span className="shrink-0 text-xs text-slate-400">
                                                                {ev.at ? new Date(ev.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }) : ''}
                                                            </span>
                                                        </div>

                                                        {metaEntries.length > 0 ? (
                                                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                                                {metaEntries.map(([k, v]) => (
                                                                    <span key={k} className="text-xs text-slate-500">
                                                                        <span className="text-slate-400">{k.replace(/_/g, ' ')}</span>
                                                                        {' · '}
                                                                        <span className="font-medium text-slate-600">{String(v)}</span>
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
