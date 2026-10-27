import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';
import AppIcon from '../../components/AppIcon';
import StatusBadge from '../../components/StatusBadge';

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
            icon: 'calendar',
        },
        followup: {
            label: 'Follow-up',
            dotBg: 'bg-violet-500',
            iconBg: 'bg-violet-100',
            iconColor: 'text-violet-600',
            badgeCls: 'bg-violet-100 text-violet-700',
            icon: 'restore',
        },
        note: {
            label: 'Note',
            dotBg: 'bg-slate-400',
            iconBg: 'bg-slate-100',
            iconColor: 'text-slate-500',
            badgeCls: 'bg-slate-100 text-slate-600',
            icon: 'edit',
        },
        invoice: {
            label: 'Invoice',
            dotBg: 'bg-amber-500',
            iconBg: 'bg-amber-100',
            iconColor: 'text-amber-600',
            badgeCls: 'bg-amber-100 text-amber-700',
            icon: 'file-text',
        },
        payment: {
            label: 'Payment',
            dotBg: 'bg-emerald-500',
            iconBg: 'bg-emerald-100',
            iconColor: 'text-emerald-600',
            badgeCls: 'bg-emerald-100 text-emerald-700',
            icon: 'credit-card',
        },
    };
    return configs[type] || {
        label: type,
        dotBg: 'bg-slate-300',
        iconBg: 'bg-slate-100',
        iconColor: 'text-slate-400',
        badgeCls: 'bg-slate-100 text-slate-600',
        icon: 'module',
    };
};

function groupByDate(events) {
    const groups = [];
    const seen = {};
    for (const ev of events) {
        // Group by the local calendar day: `at` is a UTC timestamp, so slicing
        // it would file early-morning events under the previous day.
        const at = ev.at ? new Date(ev.at) : null;
        const day = at && !Number.isNaN(at.getTime())
            ? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
            : 'Unknown';
        if (!seen[day]) {
            seen[day] = true;
            groups.push({ day, items: [] });
        }
        groups[groups.length - 1].items.push(ev);
    }
    return groups;
}

// Activity meta values arrive raw (2026-10-28, 10:30:00, in_consultation).
function fmtMetaValue(key, value) {
    const v = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(v)) return v.slice(0, 5);
    if (key === 'status' || key.endsWith('_status') || key === 'type') return v.replace(/_/g, ' ');
    return v;
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
    const canViewAppointments = Boolean(scope?.can?.('appointments.view'));
    const canBook = Boolean(scope?.can?.('appointments.create'));
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);

    const [tab, setTab] = useState('timeline');

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

    // Visits feed the next-visit banner and the AI summary card on every tab,
    // so they load with the profile; the rest load when their tab opens.
    useEffect(() => {
        if (!profile) return;
        if (canViewAppointments) loadAppointments();
        loadGlobalSummary();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profile?.patient?.id]);

    useEffect(() => {
        if (!profile) return;
        if (tab === 'notes') loadNotes();
        if (tab === 'timeline') loadActivity();
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

    const todayYMD = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const nextVisit = appointments
        .filter((a) => ['pending', 'confirmed', 'checked_in', 'in_consultation'].includes(a.status)
            && String(a.appointment_date || '').slice(0, 10) >= todayYMD)
        .sort((a, b) => `${a.appointment_date}${a.start_time}`.localeCompare(`${b.appointment_date}${b.start_time}`))[0];
    const age = patient?.age || (patient?.dob ? Math.floor((Date.now() - new Date(patient.dob)) / (365.25 * 864e5)) : null);
    const initials = String(patient?.full_name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    const savedMedical = patient?.medical_profile || patient?.medicalProfile || {};
    const splitList = (v) => String(v || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    const allergyList = splitList(savedMedical.allergies);
    const conditionList = splitList(savedMedical.chronic_conditions);
    const tabs = [
        { key: 'timeline', label: 'Everything' },
        ...(canViewAppointments ? [{ key: 'appointments', label: `Visits${counts.appointments ? ` · ${counts.appointments}` : ''}` }] : []),
        { key: 'notes', label: `Notes${counts.notes ? ` · ${counts.notes}` : ''}` },
        { key: 'medical', label: 'Medical' },
    ];

    if (loadingProfile && !patient) {
        return (
            <div className="flex justify-center py-20">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
        );
    }

    if (!patient) {
        return (
            <div className="space-y-3">
                {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
                <p className="text-sm text-slate-600">Patient not found. <Link to="/modules/patients" className="font-semibold text-blue-700">Back to patients</Link></p>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-[1400px] space-y-4">
            <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
                <Link to="/modules/patients" className="font-medium text-blue-700 hover:text-blue-900">Patients</Link>
                <span className="mx-1.5">/</span>
                <span className="text-slate-700">{patient.full_name}</span>
            </nav>

            {/* ── Identity header ── */}
            <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4">
                <div className="flex min-w-0 items-center gap-4">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-800">{initials}</span>
                    <div className="min-w-0">
                        <h1 className="truncate text-xl font-bold text-slate-900">{patient.full_name}</h1>
                        <p className="mt-0.5 text-sm text-slate-600">
                            {[age != null ? `${age} yrs` : null, patient.gender ? String(patient.gender).replace(/^\w/, (c) => c.toUpperCase()) : null, patient.phone, patient.blood_group ? `Blood ${patient.blood_group}` : null].filter(Boolean).join(' · ') || '—'}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {allergyList.map((a) => (
                                <span key={`al-${a}`} className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">Allergy: {a}</span>
                            ))}
                            {conditionList.map((c) => (
                                <span key={`co-${c}`} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{c}</span>
                            ))}
                            {patient.whatsapp_opt_in === false ? (
                                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">WhatsApp off</span>
                            ) : patient.whatsapp_opt_in ? (
                                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">WhatsApp on</span>
                            ) : null}
                            {patient.status_tag ? <StatusBadge status={patient.status_tag} /> : null}
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {canEditPatient ? (
                        <button type="button" onClick={() => { setTab('notes'); setNoteDialogOpen(true); }} className="h-10 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                            Add note
                        </button>
                    ) : null}
                    <button type="button" onClick={downloadPatientReport} disabled={pdfBusy} className="h-10 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">
                        {pdfBusy ? 'Preparing…' : 'Report PDF'}
                    </button>
                    {canEditPatient ? (
                        <Link to={`/modules/patients/${id}/edit`} className="flex h-10 items-center rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-800 hover:bg-slate-50">Edit</Link>
                    ) : null}
                    {canBook ? (
                        <Link to={`/workflows/appointments/new?patient_id=${id}`} className="flex h-10 items-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">Book appointment</Link>
                    ) : null}
                </div>
            </header>

            {nextVisit ? (
                <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                    <p className="text-sm text-slate-800">
                        <span className="font-semibold">Next visit: {String(nextVisit.appointment_date).slice(0, 10) === todayYMD ? 'Today' : fmtDate(nextVisit.appointment_date)} {String(nextVisit.start_time || '').slice(0, 5)}</span>
                        {nextVisit.doctor?.full_name ? ` with ${nextVisit.doctor.full_name}` : ''}
                        {nextVisit.visit_type ? ` · ${visitTypeLabel(nextVisit.visit_type)}` : ''}
                        {' · '}<span className="font-semibold text-blue-800">{String(nextVisit.status).replace(/_/g, ' ')}</span>
                    </p>
                    <Link to={`/workflows/appointments?open=${nextVisit.id}`} className="text-sm font-semibold text-blue-700 hover:text-blue-900">Open appointment</Link>
                </div>
            ) : null}

            {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                {/* ── Record ── */}
                <section aria-label="Patient record" className="min-w-0 rounded-2xl border border-slate-200 bg-white">
                    <div role="tablist" aria-label="Record sections" className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3">
                        {tabs.map((t) => (
                            <button
                                key={t.key}
                                type="button"
                                role="tab"
                                aria-selected={tab === t.key}
                                onClick={() => setTab(t.key)}
                                className={`h-11 whitespace-nowrap border-b-2 px-3 text-sm ${tab === t.key ? 'border-blue-600 font-semibold text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <div className="p-5">
                        {tab === 'timeline' ? (
                            <div>
                                <div className="mb-3 flex items-center justify-between">
                                    <p className="text-sm text-slate-600">Visits, notes, follow-ups, bills and payments, newest first.</p>
                                    <button type="button" onClick={loadActivity} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100">Refresh</button>
                                </div>
                                {activityLoading ? <p className="py-6 text-sm text-slate-500">Loading…</p> : null}
                                {!activityLoading && !activity.length ? <p className="py-10 text-center text-sm text-slate-500">Nothing yet. Visits, notes and bills will show up here.</p> : null}
                                {groupByDate(activity).map(({ day, items }) => (
                                    <div key={day} className="mb-5 last:mb-0">
                                        <div className="mb-2 flex items-center gap-3">
                                            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{fmtGroupDate(day)}</span>
                                            <div className="h-px flex-1 bg-slate-100" />
                                        </div>
                                        <ol className="space-y-2">
                                            {items.map((ev) => {
                                                const cfg = activityConfig(ev.type);
                                                const metaEntries = ev.meta ? Object.entries(ev.meta).filter(([, v]) => v != null && v !== '') : [];
                                                return (
                                                    <li key={`${ev.type}:${ev.id}`} className="flex items-start gap-3">
                                                        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cfg.iconBg} ${cfg.iconColor}`}>
                                                            <AppIcon name={cfg.icon} className="h-4 w-4" />
                                                        </span>
                                                        <div className="min-w-0 flex-1 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                                                            <div className="flex flex-wrap items-start justify-between gap-x-3">
                                                                <p className="min-w-0 text-sm text-slate-900">
                                                                    <span className="font-semibold">{cfg.label}</span>
                                                                    <span className="text-slate-700"> · {ev.title}</span>
                                                                </p>
                                                                <span className="shrink-0 text-xs text-slate-500">
                                                                    {ev.at ? new Date(ev.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }) : ''}
                                                                </span>
                                                            </div>
                                                            {metaEntries.length ? (
                                                                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-600">
                                                                    {metaEntries.map(([k, v]) => (
                                                                        <span key={k}><span className="text-slate-500">{k.replace(/_/g, ' ')}:</span> {fmtMetaValue(k, v)}</span>
                                                                    ))}
                                                                </p>
                                                            ) : null}
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ol>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {tab === 'appointments' ? (
                            <div>
                                {appointmentsLoading ? <p className="py-6 text-sm text-slate-500">Loading…</p> : null}
                                {!appointmentsLoading && !appointments.length ? <p className="py-10 text-center text-sm text-slate-500">No visits yet.</p> : null}
                                <ul className="divide-y divide-slate-100">
                                    {appointments.map((a) => (
                                        <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-slate-900">
                                                    {fmtDate(a.appointment_date)}
                                                    {a.start_time ? <span className="font-normal text-slate-600"> · {String(a.start_time).slice(0, 5)}</span> : null}
                                                    {a.doctor?.full_name ? <span className="font-normal text-slate-600"> · {a.doctor.full_name}</span> : null}
                                                </p>
                                                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                                    {a.visit_type ? <span className={`rounded-full px-2 py-0.5 font-semibold ${visitTypeBg(a.visit_type)}`}>{visitTypeLabel(a.visit_type)}</span> : null}
                                                    <StatusBadge status={a.status} />
                                                    {a.token_number != null ? <span>Token #{a.token_number}</span> : null}
                                                    {a.notes ? <span className="max-w-md truncate">{a.notes}</span> : null}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {(a.prescriptions_count ?? 0) > 0 ? (
                                                    <Link to={`/workflows/appointments/${a.id}/prescription`} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Prescription</Link>
                                                ) : null}
                                                <Link to={`/workflows/appointments?open=${a.id}`} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">Details</Link>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        {tab === 'notes' ? (
                            <div>
                                <div className="mb-3 flex items-center justify-between gap-2">
                                    <p className="text-sm text-slate-600">Internal notes. Private notes are marked.</p>
                                    {canEditPatient ? (
                                        <button type="button" onClick={() => setNoteDialogOpen(true)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white">Add note</button>
                                    ) : null}
                                </div>
                                {notesLoading ? <p className="py-6 text-sm text-slate-500">Loading…</p> : null}
                                {!notesLoading && !notes.length ? <p className="py-10 text-center text-sm text-slate-500">No notes yet.</p> : null}
                                <ul className="space-y-2">
                                    {notes.map((n) => (
                                        <li key={n.id} className="rounded-xl border border-slate-200 px-4 py-3">
                                            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                                <span className="font-semibold text-slate-900">
                                                    {String(n.note_type || 'note').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}
                                                    {n.is_private ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Private</span> : null}
                                                </span>
                                                <span className="text-xs text-slate-500">{fmtDateTime(n.created_at)}</span>
                                            </div>
                                            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{n.note}</p>
                                            <p className="mt-1.5 text-xs text-slate-500">
                                                {n.created_by_user?.full_name ? `By ${n.created_by_user.full_name}` : null}
                                                {n.doctor?.full_name ? ` · Doctor: ${n.doctor.full_name}` : null}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        {tab === 'medical' ? (
                            <div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    {[
                                        ['allergies', 'Allergies'],
                                        ['chronic_conditions', 'Ongoing conditions'],
                                        ['current_medications', 'Current medicines'],
                                        ['surgeries_history', 'Past surgeries'],
                                        ['family_history', 'Family history'],
                                        ['notes', 'Other notes'],
                                    ].map(([key, label]) => (
                                        <div key={key}>
                                            <label htmlFor={`med-${key}`} className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
                                            <textarea
                                                id={`med-${key}`}
                                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-600"
                                                rows={3}
                                                value={medical[key]}
                                                disabled={!canEditPatient}
                                                onChange={(e) => setMedical((p) => ({ ...p, [key]: e.target.value }))}
                                                placeholder={canEditPatient && key === 'allergies' ? 'Separate with commas, e.g. Penicillin, Peanuts' : ''}
                                            />
                                        </div>
                                    ))}
                                </div>
                                {canEditPatient ? (
                                    <div className="mt-3 flex justify-end">
                                        <button type="button" onClick={saveMedical} disabled={medicalSaving} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                                            {medicalSaving ? 'Saving…' : 'Save medical details'}
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </section>

                {/* ── Sidebar ── */}
                <aside className="space-y-4">
                    <section aria-labelledby="facts-h" className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between">
                            <h2 id="facts-h" className="text-sm font-semibold text-slate-900">Key facts</h2>
                            {canEditPatient ? <button type="button" onClick={() => setTab('medical')} className="text-xs font-semibold text-blue-700 hover:text-blue-900">Edit</button> : null}
                        </div>
                        <dl className="mt-3 space-y-2.5 text-sm">
                            {[
                                ['Ongoing conditions', savedMedical.chronic_conditions],
                                ['Current medicines', savedMedical.current_medications],
                                ['Appointments', `${counts.appointments ?? 0}${patient.no_show_count ? ` (${patient.no_show_count} no-show${patient.no_show_count === 1 ? '' : 's'})` : ''}`],
                                ['Last visit', patient.last_visit_date ? fmtDate(patient.last_visit_date) : null],
                                ['First visit', patient.first_visit_date ? fmtDate(patient.first_visit_date) : null],
                            ].map(([label, value]) => (
                                <div key={label}>
                                    <dt className="text-xs text-slate-500">{label}</dt>
                                    <dd className="mt-0.5 whitespace-pre-wrap text-slate-900">{value || value === 0 ? value : <span className="text-slate-400">—</span>}</dd>
                                </div>
                            ))}
                        </dl>
                    </section>

                    <section aria-labelledby="ai-h" className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-2">
                            <h2 id="ai-h" className="text-sm font-semibold text-slate-900">AI health summary</h2>
                            <button type="button" onClick={generateGlobalSummary} disabled={globalSummaryLoading} className="rounded-lg px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
                                {globalSummaryLoading ? 'Working…' : globalSummary ? 'Regenerate' : 'Generate'}
                            </button>
                        </div>
                        {globalSummaryError ? <p className="mt-2 text-xs text-rose-700">{globalSummaryError}</p> : null}
                        {globalSummary ? (
                            <div className="mt-2 space-y-2 text-sm text-slate-800">
                                {globalSummary.overall_health_summary ? <p className="leading-relaxed">{globalSummary.overall_health_summary}</p> : null}
                                {(globalSummary.key_concerns || []).length ? (
                                    <ul className="space-y-1">
                                        {globalSummary.key_concerns.map((c, i) => (
                                            <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />{c}</li>
                                        ))}
                                    </ul>
                                ) : null}
                                {globalSummary.recommended_focus ? <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900"><span className="font-semibold">Focus: </span>{globalSummary.recommended_focus}</p> : null}
                                {globalSummary.summary_generated_at ? <p className="text-xs text-slate-500">Generated {fmtDateTime(globalSummary.summary_generated_at)}</p> : null}
                            </div>
                        ) : !globalSummaryLoading ? (
                            <p className="mt-2 text-sm text-slate-500">A short overview from this patient’s visits, prescriptions and notes.</p>
                        ) : null}
                    </section>

                    <section aria-labelledby="fam-h" className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-2">
                            <h2 id="fam-h" className="text-sm font-semibold text-slate-900">Portal &amp; family</h2>
                            {canPortalLink && isAccountHolder ? (
                                <button type="button" onClick={sendPortalLink} disabled={portalLink.sending} className="rounded-lg px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                                    {portalLink.sending ? 'Sending…' : 'Send portal link'}
                                </button>
                            ) : null}
                        </div>

                        {portalLink.error ? <p className="mt-2 text-xs text-rose-700">{portalLink.error}</p> : null}
                        {portalLink.url ? (
                            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
                                <div className="flex items-center gap-2">
                                    <code className="min-w-0 flex-1 truncate text-xs text-emerald-900">{portalLink.url}</code>
                                    <button type="button" onClick={copyPortalLink} className="rounded-md border border-emerald-300 bg-white px-2 py-0.5 text-xs font-semibold text-emerald-800">{portalLink.copied ? 'Copied' : 'Copy'}</button>
                                </div>
                                <p className="mt-1 text-xs text-emerald-800">Expires {fmtDateTime(portalLink.expiresAt)} · WhatsApp: {portalLink.whatsappStatus || '—'}</p>
                            </div>
                        ) : null}

                        <dl className="mt-3 space-y-3 text-sm">
                            <div>
                                <dt className="text-xs text-slate-500">Consent</dt>
                                <dd className="mt-0.5 text-slate-900">{patient.consent_given_at ? `Accepted ${fmtDate(patient.consent_given_at)} (v${patient.consent_version || '—'})` : <span className="text-slate-500">Not yet accepted</span>}</dd>
                            </div>
                            <div>
                                <dt className="flex items-center justify-between text-xs text-slate-500">
                                    Managed by
                                    {canEditPatient && !managedBy.open ? <button type="button" onClick={() => setManagedBy((p) => ({ ...p, open: true }))} className="font-semibold text-blue-700">Change</button> : null}
                                </dt>
                                <dd className="mt-0.5 text-slate-900">
                                    {isAccountHolder ? <span className="text-slate-500">Nobody — this is the account holder</span> : family?.managed_by?.id ? (
                                        <Link to={`/modules/patients/${family.managed_by.id}`} className="font-medium text-blue-700">{family.managed_by.full_name}</Link>
                                    ) : (family?.managed_by?.full_name || `Patient #${patient.managed_by_patient_id}`)}
                                </dd>
                                {!isAccountHolder && canPortalLink ? <p className="mt-1 text-xs text-slate-500">Portal links go to the account holder, not this dependent.</p> : null}
                                {managedBy.open ? (
                                    <div className="mt-2">
                                        <input autoFocus type="text" placeholder="Search account holders…" value={managedBy.query} onChange={(e) => setManagedBy((p) => ({ ...p, query: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm" />
                                        <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200 bg-white">
                                            {managedBy.searching ? <p className="px-3 py-2 text-xs text-slate-500">Searching…</p> : managedBy.options.length ? managedBy.options.map((opt) => (
                                                <button key={opt.id} type="button" disabled={managedBy.saving} onClick={() => saveManagedBy(opt.id)} className="block w-full px-3 py-1.5 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50">
                                                    {opt.full_name}{opt.phone ? ` · ${opt.phone}` : ''}
                                                </button>
                                            )) : <p className="px-3 py-2 text-xs text-slate-500">No account holders found.</p>}
                                        </div>
                                        {managedBy.error ? <p className="mt-1 text-xs text-rose-600">{managedBy.error}</p> : null}
                                        <div className="mt-1.5 flex gap-2">
                                            {!isAccountHolder ? <button type="button" disabled={managedBy.saving} onClick={() => saveManagedBy(null)} className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-700">Clear</button> : null}
                                            <button type="button" disabled={managedBy.saving} onClick={() => setManagedBy({ open: false, query: '', options: [], searching: false, saving: false, error: '' })} className="rounded-md px-2 py-0.5 text-xs font-semibold text-slate-600">Cancel</button>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                            <div>
                                <dt className="text-xs text-slate-500">Dependents</dt>
                                <dd className="mt-0.5">
                                    {(family.dependents || []).length ? (
                                        <ul className="space-y-0.5">
                                            {family.dependents.map((d) => (
                                                <li key={d.id}><Link to={`/modules/patients/${d.id}`} className="font-medium text-blue-700">{d.full_name}</Link>{d.phone ? <span className="text-slate-500"> · {d.phone}</span> : null}</li>
                                            ))}
                                        </ul>
                                    ) : <span className="text-slate-500">None</span>}
                                </dd>
                            </div>
                            <div>
                                <dt className="flex items-center justify-between text-xs text-slate-500">
                                    Can also open
                                    {canEditPatient && !familyLinkForm.open ? <button type="button" onClick={() => setFamilyLinkForm((p) => ({ ...p, open: true }))} className="font-semibold text-blue-700">Add</button> : null}
                                </dt>
                                <dd className="mt-0.5">
                                    {familyLinkRemoveError ? <p className="text-xs text-rose-600">{familyLinkRemoveError}</p> : null}
                                    {(family.links || []).length ? (
                                        <ul className="space-y-1">
                                            {family.links.map((l) => (
                                                <li key={l.id} className="flex items-center justify-between gap-2">
                                                    <span className="min-w-0 truncate">
                                                        <Link to={`/modules/patients/${l.related_patient_id}`} className="font-medium text-blue-700">{l.related_patient?.full_name || `Patient #${l.related_patient_id}`}</Link>
                                                        {l.relation ? <span className="text-slate-500"> · {l.relation}</span> : null}
                                                    </span>
                                                    {canEditPatient ? (
                                                        <button type="button" disabled={familyLinkRemoving === l.id} onClick={() => removeFamilyLink(l.id)} className="shrink-0 text-xs font-semibold text-rose-600 disabled:opacity-50">
                                                            {familyLinkRemoving === l.id ? 'Removing…' : 'Remove'}
                                                        </button>
                                                    ) : null}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : <span className="text-slate-500">Nobody</span>}
                                    <p className="mt-1 text-xs text-slate-500">{patientFirstName} can open these people’s portal profiles, not the other way round.</p>
                                    {familyLinkForm.open ? (
                                        <div className="mt-2">
                                            <input autoFocus type="text" placeholder="Search patients…" value={familyLinkForm.query} onChange={(e) => setFamilyLinkForm((p) => ({ ...p, query: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm" />
                                            <input type="text" placeholder="Relation (optional, e.g. spouse)" value={familyLinkForm.relation} maxLength={50} onChange={(e) => setFamilyLinkForm((p) => ({ ...p, relation: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm" />
                                            <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200 bg-white">
                                                {familyLinkForm.searching ? <p className="px-3 py-2 text-xs text-slate-500">Searching…</p> : familyLinkForm.options.length ? familyLinkForm.options.map((opt) => (
                                                    <button key={opt.id} type="button" disabled={familyLinkForm.saving} onClick={() => addFamilyLink(opt.id)} className="block w-full px-3 py-1.5 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50">
                                                        {opt.full_name}{opt.phone ? ` · ${opt.phone}` : ''}
                                                    </button>
                                                )) : <p className="px-3 py-2 text-xs text-slate-500">No patients found.</p>}
                                            </div>
                                            {familyLinkForm.error ? <p className="mt-1 text-xs text-rose-600">{familyLinkForm.error}</p> : null}
                                            <button type="button" disabled={familyLinkForm.saving} onClick={() => setFamilyLinkForm({ open: false, query: '', options: [], searching: false, relation: '', saving: false, error: '' })} className="mt-1.5 rounded-md px-2 py-0.5 text-xs font-semibold text-slate-600">Cancel</button>
                                        </div>
                                    ) : null}
                                </dd>
                            </div>
                        </dl>
                    </section>
                </aside>
            </div>

            {noteDialogOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setNoteDialogOpen(false)}>
                    <div role="dialog" aria-modal="true" aria-labelledby="note-h" className="max-h-[88vh] w-full max-w-xl overflow-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                            <h2 id="note-h" className="text-lg font-semibold text-slate-900">Add note</h2>
                            <button type="button" onClick={() => setNoteDialogOpen(false)} aria-label="Close" className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
                        </div>
                        <div className="space-y-3 p-5">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                    <label htmlFor="note-type" className="mb-1 block text-xs font-medium text-slate-600">Type</label>
                                    <select id="note-type" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" value={noteDraft.note_type} onChange={(e) => setNoteDraft((p) => ({ ...p, note_type: e.target.value }))}>
                                        <option value="general">General</option>
                                        <option value="doctor_note">Doctor note</option>
                                        <option value="reception_note">Reception note</option>
                                        <option value="followup_note">Follow-up note</option>
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor="note-doctor" className="mb-1 block text-xs font-medium text-slate-600">Doctor (optional)</label>
                                    <select id="note-doctor" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" value={noteDraft.doctor_id} onChange={(e) => setNoteDraft((p) => ({ ...p, doctor_id: e.target.value }))}>
                                        <option value="">—</option>
                                        {doctorOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label htmlFor="note-body" className="mb-1 block text-xs font-medium text-slate-600">Note</label>
                                <textarea id="note-body" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" rows={5} value={noteDraft.note} onChange={(e) => setNoteDraft((p) => ({ ...p, note: e.target.value }))} />
                            </div>
                            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                                <input type="checkbox" checked={Boolean(noteDraft.is_private)} onChange={(e) => setNoteDraft((p) => ({ ...p, is_private: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                                Private (staff only)
                            </label>
                            <div className="flex justify-end gap-2 pt-1">
                                <button type="button" onClick={() => setNoteDialogOpen(false)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
                                <button type="button" onClick={addNote} disabled={noteSaving || !String(noteDraft.note || '').trim()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                                    {noteSaving ? 'Saving…' : 'Save note'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
