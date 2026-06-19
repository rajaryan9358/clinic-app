import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AppointmentDetailDrawer from '../../components/AppointmentDetailDrawer';
import StatusBadge from '../../components/StatusBadge';
import AppIcon from '../../components/AppIcon';
import ConfirmDialog from '../../components/ConfirmDialog';

function modeButton(active) {
    return active
        ? 'rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white'
        : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';
}

export default function AppointmentsFlowPage() {
    const { user } = useAuth();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);
    const isClinicAdmin = user?.role === 'clinic_admin';
    const canUsePrescription = ['doctor', 'assistant'].includes(String(user?.role || ''));
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const tabsStorageKey = useMemo(() => {
        const role = String(user?.role || 'user');
        return `workflows:appointments:tabs:v1:${role}`;
    }, [user]);

    const loadSavedTabs = () => {
        try {
            const raw = localStorage.getItem(tabsStorageKey);
            if (!raw) return { mode: null, status: null };
            const parsed = JSON.parse(raw);
            return {
                mode: parsed?.mode ?? null,
                status: parsed?.status ?? null,
            };
        } catch {
            return { mode: null, status: null };
        }
    };

    const toYMD = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const addDaysYMD = (ymd, days) => {
        const d = new Date(`${ymd}T00:00:00`);
        if (Number.isNaN(d.getTime())) return ymd;
        d.setDate(d.getDate() + Number(days || 0));
        return toYMD(d);
    };

    // Use local dates (not UTC) to avoid off-by-one-day issues.
    const todayYMD = useMemo(() => toYMD(new Date()), []);

    const isAfterNow = (appointmentDate, startTime) => {
        const ymd = String(appointmentDate || '').slice(0, 10);
        if (!ymd) return false;
        const hhmm = String(startTime || '').slice(0, 5) || '00:00';
        const dt = new Date(`${ymd}T${hhmm}:00`);
        if (Number.isNaN(dt.getTime())) return false;
        return dt.getTime() > Date.now();
    };

    const [mode, setMode] = useState(() => {
        const saved = loadSavedTabs().mode;
        const allowed = new Set(['today', 'calendar', 'upcoming', 'list', 'range']);
        return allowed.has(String(saved)) ? String(saved) : 'today';
    }); // today | calendar | upcoming | list | range
    const [date, setDate] = useState(() => toYMD(new Date()));
    const [range, setRange] = useState({ from: '', to: '' });
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState(() => {
        const saved = loadSavedTabs().status;
        return typeof saved === 'string' ? saved : '';
    });
    const [visitType, setVisitType] = useState('');

    const [branchId, setBranchId] = useState('');
    const [branchOptions, setBranchOptions] = useState({ loading: false, error: '', items: [] });
    const [pdfBusy, setPdfBusy] = useState(false);

    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [sortByToken, setSortByToken] = useState(false);
    const [tokenGenerating, setTokenGenerating] = useState(false);

        const [drawer, setDrawer] = useState({ open: false, id: null });
        const [selectedId, setSelectedId] = useState(null);
    const [menu, setMenu] = useState({ open: false, id: null, top: 0, left: 0 });
    const [menuSavingId, setMenuSavingId] = useState(null);
    const [detailDialog, setDetailDialog] = useState({ open: false, type: '', id: null, loading: false, error: '', record: null });

        const [confirm, setConfirm] = useState({ open: false, appointmentId: null, title: '', message: '', nextStatus: '', danger: false, busy: false, confirmDisabled: false, showForce: false });
    const [cancelDialog, setCancelDialog] = useState({ open: false, appointmentId: null, reason: '', busy: false, error: '' });
    const [rescheduleDialog, setRescheduleDialog] = useState({
        open: false,
        appointmentId: null,
        busy: false,
        error: '',
        reason: '',
        appointment: null,
        availability: { loading: false, error: '', days: [] },
        slotDate: '',
        selection: { appointment_date: '', start_time: '', end_time: '' },
    });
    const [completeDialog, setCompleteDialog] = useState({
        open: false,
        appointmentId: null,
        busy: false,
        error: '',
        appointment: null,
        setFollowUp: false,
        followMode: 'days', // days | date
        followDays: 7,
        followDate: '',
        availability: { loading: false, error: '', days: [] },
        slotDate: '',
        selection: { appointment_date: '', start_time: '', end_time: '' },
    });

    const rxRecorderRef = useRef(null);
    const rxStreamRef = useRef(null);
    const rxChunksRef = useRef([]);
    const [rxVoice, setRxVoice] = useState({
        open: false,
        appointmentId: null,
        phase: 'idle', // idle | requesting | recording | stopping | processing
        error: '',
    });

    const cleanupRxRecorder = () => {
        try {
            rxRecorderRef.current?.stop?.();
        } catch {
            // ignore
        }
        rxRecorderRef.current = null;
        try {
            rxStreamRef.current?.getTracks?.().forEach((t) => t.stop());
        } catch {
            // ignore
        }
        rxStreamRef.current = null;
        rxChunksRef.current = [];
    };

    useEffect(() => {
        return () => {
            cleanupRxRecorder();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const openRxVoice = (appointmentId) => {
        cleanupRxRecorder();
        setRxVoice({ open: true, appointmentId, phase: 'idle', error: '' });
    };

    const startRxRecording = async () => {
        const apptId = rxVoice.appointmentId;
        if (!apptId) return;

        setRxVoice((p) => ({ ...p, open: true, phase: 'requesting', error: '' }));
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            rxStreamRef.current = stream;
            rxChunksRef.current = [];

            const recorder = new MediaRecorder(stream);
            rxRecorderRef.current = recorder;

            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size) rxChunksRef.current.push(e.data);
            };

            recorder.onstop = async () => {
                const blob = new Blob(rxChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
                rxChunksRef.current = [];
                setRxVoice((p) => ({ ...p, phase: 'processing', error: '' }));

                try {
                    const fd = new FormData();
                    const mime = String(recorder.mimeType || blob.type || '').toLowerCase();
                    const ext = mime.includes('mp4')
                        ? 'mp4'
                        : mime.includes('mpeg') || mime.includes('mp3')
                            ? 'mp3'
                            : mime.includes('wav')
                                ? 'wav'
                                : 'webm';
                    fd.append('audio', blob, `recording.${ext}`);
                    await client.post(`${base}/appointments/${apptId}/prescription/voice`, fd);

                    setRows((prev) => prev.map((r) => {
                        if (String(r.id) !== String(apptId)) return r;
                        const current = Number(r.prescriptions_count || 0);
                        return { ...r, prescriptions_count: Math.max(1, current + 1) };
                    }));

                    cleanupRxRecorder();
                    setRxVoice({ open: false, appointmentId: null, phase: 'idle', error: '' });
                    navigate(`/workflows/appointments/${apptId}/prescription`);
                } catch (e) {
                    cleanupRxRecorder();
                    setRxVoice((p) => ({
                        ...p,
                        open: true,
                        phase: 'idle',
                        error: e?.response?.data?.message || e?.message || 'Failed to generate prescription',
                    }));
                }
            };

            recorder.start();
            setRxVoice((p) => ({ ...p, open: true, phase: 'recording', error: '' }));
        } catch (e) {
            cleanupRxRecorder();
            setRxVoice((p) => ({ ...p, open: true, phase: 'idle', error: e?.message || 'Microphone permission denied' }));
        }
    };

    const stopRxRecording = async () => {
        if (!rxRecorderRef.current) return;
        setRxVoice((p) => ({ ...p, phase: 'stopping', error: '' }));
        try {
            rxRecorderRef.current.stop();
        } catch (e) {
            cleanupRxRecorder();
            setRxVoice((p) => ({ ...p, phase: 'idle', error: e?.message || 'Failed to stop recording' }));
        }
    };

    const effectiveDate = mode === 'today' ? todayYMD : date;
    const showingLabel = mode === 'upcoming'
        ? 'Upcoming'
        : mode === 'list'
            ? 'All'
            : mode === 'range'
                ? `${range.from || '—'} to ${range.to || '—'}`
                : effectiveDate;

    const fetchList = async (overrides = {}) => {
        setLoading(true);
        setError('');
        try {
            const nextMode = overrides.mode ?? mode;
            const nextDate = overrides.date ?? date;
            const nextRange = overrides.range ?? range;
            const nextSearch = overrides.search ?? search;
            const nextStatus = overrides.status ?? status;
            const nextBranchId = overrides.branchId ?? branchId;
            const nextVisitType = overrides.visitType ?? visitType;

            const nextEffectiveDate = nextMode === 'today' ? todayYMD : nextDate;
            const params = { page: 1, per_page: 50, sort_by: 'start_time', sort_dir: 'asc' };
            if (nextMode === 'today' || nextMode === 'calendar') params.appointment_date = nextEffectiveDate;
            if (nextMode === 'upcoming') {
                params.per_page = 200;
                params.appointment_date_from = todayYMD;
                params.sort_by = 'appointment_date';
                params.sort_dir = 'asc';
            }
            if (nextMode === 'range') {
                if (nextRange.from) params.appointment_date_from = nextRange.from;
                if (nextRange.to) params.appointment_date_to = nextRange.to;
                params.sort_by = 'appointment_date';
                params.sort_dir = 'asc';
            }
            if (String(nextSearch || '').trim()) params.search = String(nextSearch).trim();
            if (nextStatus) params.status = nextStatus;
            if (nextVisitType) params.visit_type = nextVisitType;
            if (isClinicAdmin && String(nextBranchId || '').trim()) params.branch_id = String(nextBranchId).trim();
            const res = await client.get(`${base}/appointments`, { params });
            let nextRows = res.data.data || [];
            if (nextMode === 'upcoming') {
                nextRows = nextRows.filter((r) => isAfterNow(r.appointment_date, r.start_time));
            }
            setRows(nextRows);
            // keep selection only if the row still exists
            if (selectedId && !nextRows.some((r) => String(r.id) === String(selectedId))) {
                setSelectedId(null);
            }
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to load appointments');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchList();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [base, mode]);

    useEffect(() => {
        try {
            localStorage.setItem(tabsStorageKey, JSON.stringify({ mode, status }));
        } catch {
            // ignore
        }
    }, [mode, status, tabsStorageKey]);

    useEffect(() => {
        const t = setTimeout(() => {
            fetchList({ search });
        }, 250);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search]);

    useEffect(() => {
        if (mode !== 'range') return;
        const t = setTimeout(() => {
            fetchList({ range });
        }, 200);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, range.from, range.to]);

    useEffect(() => {
        if (mode !== 'range') return;
        setRange((prev) => {
            if (prev.from || prev.to) return prev;
            return { from: todayYMD, to: todayYMD };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);

    useEffect(() => {
        if (mode === 'calendar') fetchList();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [date]);

    useEffect(() => {
        if (!isClinicAdmin) return;
        fetchList({ branchId });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId]);

    useEffect(() => {
        const loadBranches = async () => {
            if (!isClinicAdmin) return;
            setBranchOptions((p) => ({ ...p, loading: true, error: '' }));
            try {
                const res = await client.get(`${base}/branches`, { params: { per_page: 200 } });
                const items = Array.isArray(res?.data?.data) ? res.data.data : [];
                setBranchOptions({ loading: false, error: '', items });
            } catch (e) {
                setBranchOptions({ loading: false, error: e?.response?.data?.message || e?.message || 'Failed to load branches', items: [] });
            }
        };

        loadBranches();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isClinicAdmin, base]);

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

    const downloadAppointmentsPdf = async () => {
        setPdfBusy(true);
        setError('');
        try {
            const params = { sort_by: 'start_time', sort_dir: 'asc' };
            if (mode === 'today' || mode === 'calendar') params.appointment_date = effectiveDate;
            if (mode === 'upcoming') {
                params.upcoming_only = 1;
                params.appointment_date_from = todayYMD;
                params.sort_by = 'appointment_date';
                params.sort_dir = 'asc';
            }
            if (mode === 'range') {
                if (range.from) params.appointment_date_from = range.from;
                if (range.to) params.appointment_date_to = range.to;
                params.sort_by = 'appointment_date';
                params.sort_dir = 'asc';
            }
            if (String(search || '').trim()) params.search = String(search).trim();
            if (status) params.status = status;
            if (isClinicAdmin && String(branchId || '').trim()) params.branch_id = String(branchId).trim();

            const res = await client.get(`${base}/reports/appointments.pdf`, { params, responseType: 'blob' });
            downloadBlob(res.data, 'appointments-report.pdf');
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to download report');
        } finally {
            setPdfBusy(false);
        }
    };


    useEffect(() => {
        const open = searchParams.get('open');
        const id = open && String(open).match(/^\d+$/) ? Number(open) : null;
        if (!id) return;
        setDrawer({ open: true, id });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    const statusTabs = [
        { value: '', label: 'All' },
        { value: 'pending', label: 'Pending' },
        { value: 'confirmed', label: 'Confirmed' },
        { value: 'checked_in', label: 'Checked-in' },
        { value: 'in_consultation', label: 'In consult' },
        { value: 'completed', label: 'Completed' },
        { value: 'cancelled', label: 'Cancelled' },
        { value: 'no_show', label: 'No show' },
        { value: 'rescheduled', label: 'Rescheduled' },
    ];

    const statusTabClass = (active) => (active
        ? 'rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white'
        : 'rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50'
    );

    useEffect(() => {
        if (!menu.open) return;
        const onDown = () => setMenu({ open: false, id: null, top: 0, left: 0 });
        const onScroll = () => setMenu({ open: false, id: null, top: 0, left: 0 });
        const onResize = () => setMenu({ open: false, id: null, top: 0, left: 0 });
        document.addEventListener('pointerdown', onDown);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
    }, [menu.open]);

    useEffect(() => {
        setSortByToken(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, effectiveDate]);

    const prettyDateLabel = (ymd) => {
        try {
            const d = new Date(`${ymd}T00:00:00`);
            return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: '2-digit' }).format(d);
        } catch {
            return ymd;
        }
    };

    const dateChipMeta = (ymd) => {
        try {
            const d = new Date(`${String(ymd).slice(0, 10)}T00:00:00`);
            const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d);
            const month = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(d);
            const day = new Intl.DateTimeFormat(undefined, { day: '2-digit' }).format(d);
            return { weekday, month, day };
        } catch {
            return { weekday: '', month: '', day: String(ymd).slice(8, 10) };
        }
    };

    const parseLocalDateTime = (ymd, time) => {
        if (!ymd || !time) return null;
        const datePart = String(ymd).slice(0, 10); // supports YYYY-MM-DD and full ISO strings
        const timeStr = String(time);
        const timePart = timeStr.slice(0, 8);
        const normalized = timePart.length === 5 ? `${timePart}:00` : timePart; // HH:mm -> HH:mm:ss
        const d = new Date(`${datePart}T${normalized}`);
        return Number.isNaN(d.getTime()) ? null : d;
    };

    const prettyDateTime = (d) => {
        try {
            return new Intl.DateTimeFormat(undefined, {
                weekday: 'short',
                month: 'short',
                day: '2-digit',
                hour: 'numeric',
                minute: '2-digit',
            }).format(d);
        } catch {
            return String(d);
        }
    };

    const actionDotClass = (next) => {
        const s = String(next || '').toLowerCase();
        if (s === 'confirmed') return 'bg-emerald-500';
        if (s === 'checked_in') return 'bg-indigo-500';
        if (s === 'in_consultation') return 'bg-violet-500';
        if (s === 'completed') return 'bg-emerald-600';
        if (s === 'cancelled') return 'bg-rose-500';
        if (s === 'no_show') return 'bg-amber-500';
        if (s === 'rescheduled') return 'bg-slate-600';
        if (s === 'pending') return 'bg-blue-500';
        return 'bg-slate-400';
    };

    const rowLifecycleActions = (current) => {
        const s = String(current || '');
        const actions = [];

        if (s === 'pending') {
            actions.push({ label: 'Confirm', next: 'confirmed' });
            actions.push({ label: 'Cancel', kind: 'cancel' });
        } else if (s === 'confirmed') {
            actions.push({ label: 'Check In', next: 'checked_in' });
            actions.push({ label: 'Cancel', kind: 'cancel' });
            actions.push({ label: 'No Show', next: 'no_show' });
        } else if (s === 'checked_in') {
            actions.push({ label: 'Start Consultation', next: 'in_consultation' });
            actions.push({ label: 'Complete', kind: 'complete' });
            actions.push({ label: 'Cancel', kind: 'cancel' });
        } else if (s === 'in_consultation') {
            actions.push({ label: 'Complete', kind: 'complete' });
        } else if (s === 'completed') {
            actions.push({ label: 'Reopen', next: 'checked_in' });
        } else if (s === 'cancelled') {
            actions.push({ label: 'Restore', next: 'confirmed' });
        } else if (s === 'no_show') {
            actions.push({ label: 'Restore', next: 'confirmed' });
        }

        // Mark Rescheduled = pick a new slot (reschedule) and set status back to confirmed.
        if (['pending', 'confirmed', 'no_show'].includes(s)) {
            actions.push({ label: 'Mark Rescheduled', kind: 'reschedule' });
        }

        return actions.map((a) => ({
            kind: a.kind || 'lifecycle',
            label: a.label,
            next: a.next || null,
        }));
    };

    const rowById = useMemo(() => {
        const m = new Map();
        for (const r of rows) m.set(String(r.id), r);
        return m;
    }, [rows]);

    const generateTokens = async () => {
        setTokenGenerating(true);
        setError('');
        try {
            const params = { appointment_date: effectiveDate };
            if (isClinicAdmin && branchId) params.branch_id = branchId;
            await client.post(`${base}/appointments/generate-tokens`, params);
            await fetchList();
            setSortByToken(true);
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to generate tokens');
        } finally {
            setTokenGenerating(false);
        }
    };

    const displayRows = useMemo(() => {
        if (!sortByToken) return rows;
        return [...rows].sort((a, b) => {
            const ta = a.token_number ?? 9999;
            const tb = b.token_number ?? 9999;
            return ta - tb;
        });
    }, [rows, sortByToken]);

    const hasTokens = rows.some((r) => r.token_number != null);

    const closeMenu = () => setMenu({ open: false, id: null, top: 0, left: 0 });

    const fetchAppointmentDetail = async (appointmentId) => {
        const res = await client.get(`${base}/appointments/${appointmentId}/detail`);
        return res?.data?.data?.appointment || null;
    };

    const fetchAvailability = async ({ doctorId, branchId, fromDate, toDate, excludeAppointmentId }) => {
        const params = {
            doctor_id: doctorId,
            branch_id: branchId,
            from_date: fromDate,
            to_date: toDate,
        };
        if (excludeAppointmentId) params.exclude_appointment_id = excludeAppointmentId;
        const res = await client.get(`${base}/appointments/availability`, { params });
        return Array.isArray(res?.data?.data?.days) ? res.data.data.days : [];
    };

    const openConfirmLifecycle = (appointmentId, nextStatus, label, row) => {
        const pretty = String(nextStatus || '').replaceAll('_', ' ');

        let title = 'Confirm Status Change';
        let message = `Change status to ${label || pretty}?`;
        let confirmDisabled = false;
        let showForce = false;

        if (String(nextStatus) === 'checked_in') {
            const apptStart = parseLocalDateTime(row?.appointment_date, row?.start_time);
            if (apptStart) {
                const allowedFrom = new Date(apptStart.getTime() - 15 * 60 * 1000);
                if (new Date().getTime() < allowedFrom.getTime()) {
                    title = 'Check-in Not Allowed Yet';
                    message = `Check-in is allowed from ${prettyDateTime(allowedFrom)} (15 minutes before the appointment).`;
                    confirmDisabled = true;
                    showForce = String(user?.role || '') === 'clinic_admin';
                }
            }
        }

        if (String(nextStatus) === 'no_show') {
            const apptStart = parseLocalDateTime(row?.appointment_date, row?.start_time);
            if (apptStart) {
                const allowedAfter = new Date(apptStart.getTime() + 15 * 60 * 1000);
                if (new Date().getTime() < allowedAfter.getTime()) {
                    title = 'No-show Not Allowed Yet';
                    message = `No-show is allowed only after ${prettyDateTime(allowedAfter)} (15 minutes after the appointment).`;
                    confirmDisabled = true;
                    showForce = String(user?.role || '') === 'clinic_admin';
                }
            }
        }

        setConfirm({
            open: true,
            appointmentId,
            nextStatus,
            title,
            message,
            danger: String(nextStatus) === 'cancelled',
            busy: false,
            confirmDisabled,
            showForce,
        });
    };

    const runLifecycle = async ({ appointmentId, nextStatus, reason, force }) => {
        await client.post(`${base}/appointments/${appointmentId}/lifecycle`, {
            status: nextStatus,
            reason: reason || null,
            force: force || false,
        });
    };

    const openCancel = (appointmentId) => {
        setCancelDialog({ open: true, appointmentId, reason: '', busy: false, error: '' });
    };

    const openReschedule = async (appointmentId) => {
        setRescheduleDialog((prev) => ({
            ...prev,
            open: true,
            appointmentId,
            busy: false,
            error: '',
            reason: '',
            appointment: null,
            availability: { loading: true, error: '', days: [] },
            slotDate: todayYMD,
            selection: { appointment_date: '', start_time: '', end_time: '' },
        }));

        try {
            const appt = await fetchAppointmentDetail(appointmentId);
            if (!appt?.doctor_id || !appt?.branch_id) throw new Error('Missing doctor/branch for availability');
            const fromDate = todayYMD;
            const toDate = addDaysYMD(todayYMD, 13);
            const days = await fetchAvailability({
                doctorId: appt.doctor_id,
                branchId: appt.branch_id,
                fromDate,
                toDate,
                excludeAppointmentId: appointmentId,
            });

            setRescheduleDialog((prev) => ({
                ...prev,
                appointment: appt,
                availability: { loading: false, error: '', days },
                slotDate: days?.[0]?.date || fromDate,
            }));
        } catch (e) {
            setRescheduleDialog((prev) => ({
                ...prev,
                availability: { loading: false, error: e?.response?.data?.message || e?.message || 'Failed to load slots', days: [] },
            }));
        }
    };

    const openComplete = async (appointmentId) => {
        setCompleteDialog((prev) => ({
            ...prev,
            open: true,
            appointmentId,
            busy: false,
            error: '',
            appointment: null,
            setFollowUp: false,
            followMode: 'days',
            followDays: 7,
            followDate: '',
            availability: { loading: false, error: '', days: [] },
            slotDate: '',
            selection: { appointment_date: '', start_time: '', end_time: '' },
        }));

        try {
            const appt = await fetchAppointmentDetail(appointmentId);
            setCompleteDialog((prev) => ({ ...prev, appointment: appt }));
        } catch (e) {
            setCompleteDialog((prev) => ({ ...prev, error: e?.response?.data?.message || e?.message || 'Failed to load appointment' }));
        }
    };

    const rescheduleChipStripRef = useRef(null);
    const activeRescheduleChipRef = useRef(null);
    const followChipStripRef = useRef(null);
    const activeFollowChipRef = useRef(null);

    const scrollChipIntoView = (containerEl, chipEl) => {
        if (!containerEl || !chipEl) return;
        try {
            chipEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } catch {
            // no-op
        }
    };

    useEffect(() => {
        if (!rescheduleDialog.open) return;
        const raf = requestAnimationFrame(() => {
            scrollChipIntoView(rescheduleChipStripRef.current, activeRescheduleChipRef.current);
        });
        return () => cancelAnimationFrame(raf);
    }, [rescheduleDialog.open, rescheduleDialog.slotDate, (rescheduleDialog.availability.days || []).length]);

    const followLoadKeyRef = useRef('');
    useEffect(() => {
        if (!completeDialog.open || !completeDialog.setFollowUp) return;

        const appt = completeDialog.appointment;
        const doctorId = appt?.doctor_id;
        const branchId = appt?.branch_id;
        if (!doctorId || !branchId) {
            setCompleteDialog((p) => ({
                ...p,
                availability: { loading: false, error: 'Missing doctor/branch for availability.', days: [] },
            }));
            return;
        }

        const baseDate = (appt?.appointment_date && String(appt.appointment_date).slice(0, 10)) || todayYMD;
        const mode = completeDialog.followMode;

        const fromDate = baseDate;
        const toDate = addDaysYMD(baseDate, 14);

        const clampDays = (n) => Math.max(0, Math.min(14, Number.isFinite(n) ? n : 0));

        let target = baseDate;
        if (mode === 'days') {
            target = addDaysYMD(baseDate, clampDays(Number(completeDialog.followDays || 0)));
        } else {
            target = String(completeDialog.followDate || '').slice(0, 10) || baseDate;
        }

        const key = `${doctorId}|${branchId}|${mode}|${fromDate}|${toDate}`;
        if (followLoadKeyRef.current === key) {
            if (String(completeDialog.slotDate || '') === String(target) && String(completeDialog.followDate || '') === String(target)) return;
            setCompleteDialog((p) => ({
                ...p,
                followDate: target,
                slotDate: target,
                selection: { appointment_date: '', start_time: '', end_time: '' },
            }));
            return;
        }
        followLoadKeyRef.current = key;

        const t = setTimeout(async () => {
            setCompleteDialog((p) => ({
                ...p,
                followDate: target,
                availability: { loading: true, error: '', days: [] },
                slotDate: target,
                selection: { appointment_date: '', start_time: '', end_time: '' },
            }));

            try {
                const days = await fetchAvailability({ doctorId, branchId, fromDate, toDate });
                const hasTarget = (days || []).some((d) => String(d.date) === String(target));
                const nextSlotDate = hasTarget ? target : (days?.[0]?.date || fromDate);
                setCompleteDialog((p) => ({
                    ...p,
                    followDate: nextSlotDate,
                    availability: { loading: false, error: '', days },
                    slotDate: nextSlotDate,
                }));
            } catch (err) {
                setCompleteDialog((p) => ({
                    ...p,
                    availability: { loading: false, error: err?.response?.data?.message || err?.message || 'Failed to load slots', days: [] },
                }));
            }
        }, 250);

        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        completeDialog.open,
        completeDialog.setFollowUp,
        completeDialog.followMode,
        completeDialog.followDays,
        completeDialog.followDate,
        completeDialog.appointment?.doctor_id,
        completeDialog.appointment?.branch_id,
        completeDialog.appointment?.appointment_date,
        todayYMD,
    ]);

    useEffect(() => {
        if (!completeDialog.open || !completeDialog.setFollowUp) return;
        const raf = requestAnimationFrame(() => {
            scrollChipIntoView(followChipStripRef.current, activeFollowChipRef.current);
        });
        return () => cancelAnimationFrame(raf);
    }, [completeDialog.open, completeDialog.setFollowUp, completeDialog.slotDate, (completeDialog.availability.days || []).length]);

    const handleMenuAction = (appointmentId, action) => {
        if (!appointmentId || !action) return;
        closeMenu();
        setSelectedId(appointmentId);

        if (action.kind === 'cancel') {
            openCancel(appointmentId);
            return;
        }
        if (action.kind === 'reschedule') {
            openReschedule(appointmentId);
            return;
        }
        if (action.kind === 'complete') {
            openComplete(appointmentId);
            return;
        }
        if (action.kind === 'lifecycle' && action.next) {
            openConfirmLifecycle(appointmentId, action.next, action.label, rowById.get(String(appointmentId)));
        }
    };

    const openEntityDialog = async (type, id) => {
        if (!type || !id) return;
        setDetailDialog({ open: true, type, id, loading: true, error: '', record: null });
        try {
            const res = await client.get(`${base}/${type === 'patient' ? 'patients' : 'doctors'}/${id}`);
            setDetailDialog({ open: true, type, id, loading: false, error: '', record: res?.data?.data || null });
        } catch (e) {
            setDetailDialog({ open: true, type, id, loading: false, error: e?.response?.data?.message || e?.message || 'Failed to load', record: null });
        }
    };

    return (
        <div className="space-y-4">
            <style>{`
                @keyframes rxbar { 0%, 100% { transform: scaleY(0.35); opacity: .55; } 50% { transform: scaleY(1); opacity: 1; } }
            `}</style>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2">
                    <AppIcon name="module" className="h-5 w-5 text-slate-700" />
                    <div>
                        <h2 className="text-xl font-semibold text-slate-900">Appointments</h2>
                        <p className="mt-0.5 text-sm text-slate-600">Flow-based view with a detail drawer.</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={downloadAppointmentsPdf}
                        disabled={pdfBusy}
                        className={pdfBusy
                            ? 'rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-500'
                            : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
                        }
                    >
                        Download PDF report
                    </button>
                    <Link
                        to="/workflows/appointments/new"
                        className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                        New Appointment
                    </Link>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setMode('today')} className={modeButton(mode === 'today')}>Today</button>
                    <button type="button" onClick={() => setMode('upcoming')} className={modeButton(mode === 'upcoming')}>Upcoming</button>
                    <button type="button" onClick={() => setMode('calendar')} className={modeButton(mode === 'calendar')}>Calendar</button>
                    <button type="button" onClick={() => setMode('range')} className={modeButton(mode === 'range')}>Range</button>
                    <button type="button" onClick={() => setMode('list')} className={modeButton(mode === 'list')}>List</button>
                </div>

                {mode === 'calendar' ? (
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
                ) : mode === 'range' ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            type="date"
                            value={range.from}
                            onChange={(e) => setRange((prev) => ({ ...prev, from: e.target.value }))}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                        />
                        <span className="text-sm text-slate-500">to</span>
                        <input
                            type="date"
                            value={range.to}
                            onChange={(e) => setRange((prev) => ({ ...prev, to: e.target.value }))}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                        />
                    </div>
                ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        Showing: <span className="font-semibold">{showingLabel}</span>
                    </div>
                )}

                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search patient / doctor / type"
                    className="min-w-[240px] flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                />

                {(mode === 'today' || mode === 'calendar') ? (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={generateTokens}
                            disabled={tokenGenerating || loading}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                            {tokenGenerating ? 'Generating…' : hasTokens ? 'Regenerate Tokens' : 'Generate Tokens'}
                        </button>
                        {hasTokens ? (
                            <button
                                type="button"
                                onClick={() => setSortByToken((p) => !p)}
                                className={sortByToken
                                    ? 'rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white'
                                    : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
                                }
                            >
                                Sort by Token
                            </button>
                        ) : null}
                    </div>
                ) : null}

                {isClinicAdmin ? (
                    <select
                        value={branchId}
                        onChange={(e) => setBranchId(e.target.value)}
                        className="min-w-[220px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                        <option value="">All branches</option>
                        {branchOptions.loading ? <option disabled>Loading…</option> : null}
                        {(branchOptions.items || []).map((b) => (
                            <option key={String(b.id)} value={String(b.id)}>
                                {b.name || `#${b.id}`}
                            </option>
                        ))}
                    </select>
                ) : null}
            </div>

            {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">{error}</div>
            ) : null}

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-3">
                    <p className="text-sm font-semibold text-slate-900">Queue</p>
                    <p className="mt-0.5 text-sm text-slate-600">Use the row actions to open details or change status.</p>
                </div>

                <div className="border-b border-slate-200 px-5 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex gap-2 overflow-x-auto py-1">
                            {statusTabs.map((t) => (
                                <button
                                    key={t.value || 'all'}
                                    type="button"
                                    onClick={() => {
                                        setStatus(t.value);
                                        fetchList({ status: t.value });
                                    }}
                                    className={statusTabClass(status === t.value)}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                        <div className="h-5 w-px bg-slate-200" />
                        <div className="flex gap-2 overflow-x-auto py-1">
                            {[
                                { value: '', label: 'All Types' },
                                { value: 'new', label: 'New' },
                                { value: 'followup', label: 'Follow-up' },
                            ].map((t) => (
                                <button
                                    key={t.value || 'all-types'}
                                    type="button"
                                    onClick={() => {
                                        setVisitType(t.value);
                                        fetchList({ visitType: t.value });
                                    }}
                                    className={visitType === t.value
                                        ? 'whitespace-nowrap rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white'
                                        : 'whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50'
                                    }
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="p-5 text-sm text-slate-600">Loading…</div>
                ) : !rows.length ? (
                    <div className="p-5 text-sm text-slate-600">No appointments found.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                            <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                    {hasTokens ? <th className="px-4 py-3 font-semibold">Token</th> : null}
                                    <th className="px-4 py-3 font-semibold">Time</th>
                                    <th className="px-4 py-3 font-semibold">Patient</th>
                                    <th className="px-4 py-3 font-semibold">Type</th>
                                    <th className="px-4 py-3 font-semibold">Doctor</th>
                                    <th className="px-4 py-3 font-semibold">Status</th>
                                    <th className="px-4 py-3 font-semibold">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayRows.map((r) => (
                                    (() => {
                                        const actions = rowLifecycleActions(r.status);
                                        const hasMoreActions = actions.length > 0;
                                        return (
                                    <tr
                                        key={r.id}
                                        className={String(selectedId) === String(r.id)
                                            ? 'border-t border-slate-100 bg-slate-50/70 cursor-pointer'
                                            : 'border-t border-slate-100 hover:bg-slate-50/70 cursor-pointer'
                                        }
                                        onClick={() => setSelectedId(r.id)}
                                    >
                                        {hasTokens ? (
                                            <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                                {r.token_number != null ? (
                                                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-lg font-bold text-white shadow">
                                                        {r.token_number}
                                                    </div>
                                                ) : (
                                                    <div className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-slate-300 text-sm text-slate-400">
                                                        —
                                                    </div>
                                                )}
                                            </td>
                                        ) : null}
                                        <td className="px-4 py-3">
                                            {(() => {
                                                const dateYMD = r.appointment_date ? String(r.appointment_date).slice(0, 10) : null;
                                                const timeStr = r.start_time ? String(r.start_time).slice(0, 5) : null;
                                                const active = !['cancelled', 'no_show', 'completed'].includes(r.status);
                                                let urgency = null;
                                                if (active && dateYMD && timeStr) {
                                                    const apptMs = new Date(`${dateYMD}T${timeStr}:00`).getTime();
                                                    const nowMs = Date.now();
                                                    const diffMin = (apptMs - nowMs) / 60000;
                                                    if (diffMin < 0) urgency = 'overdue';
                                                    else if (diffMin < 30) urgency = 'soon';
                                                }
                                                return (
                                                    <div className="flex flex-col">
                                                        <span className={
                                                            urgency === 'overdue' ? 'text-sm font-semibold text-rose-600'
                                                            : urgency === 'soon' ? 'text-sm font-semibold text-amber-500'
                                                            : 'text-sm font-medium text-slate-900'
                                                        }>
                                                            {timeStr || '—'}
                                                        </span>
                                                        <span className={
                                                            urgency === 'overdue' ? 'text-xs font-medium text-rose-500'
                                                            : urgency === 'soon' ? 'text-xs font-medium text-amber-400'
                                                            : 'text-xs text-slate-500'
                                                        }>
                                                            {dateYMD ? prettyDateLabel(dateYMD) : '—'}
                                                        </span>
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                        <td className="px-4 py-3 text-slate-700">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (r.patient_id) openEntityDialog('patient', r.patient_id);
                                                }}
                                                className="text-left font-medium text-slate-900 hover:underline"
                                            >
                                                {r?.patient?.full_name || (r.patient_id ? `Patient #${r.patient_id}` : '—')}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                                {r.visit_type === 'new'
                                                    ? 'New'
                                                    : r.visit_type === 'followup'
                                                        ? 'Follow-up'
                                                        : r.visit_type
                                                            ? String(r.visit_type).replace('_', ' ')
                                                            : '—'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-700">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (r.doctor_id) openEntityDialog('doctor', r.doctor_id);
                                                }}
                                                className="text-left font-medium text-slate-900 hover:underline"
                                            >
                                                {r?.doctor?.full_name || (r.doctor_id ? `Doctor #${r.doctor_id}` : '—')}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3">
                                            <StatusBadge status={r.status} />
                                        </td>
                                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setDrawer({ open: true, id: r.id })}
                                                    className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                                                >
                                                    <AppIcon name="view" className="h-3.5 w-3.5" />
                                                    Details
                                                </button>

                                                {canUsePrescription && (Number(r?.prescriptions_count || 0) > 0 ? (
                                                    <Link
                                                        to={`/workflows/appointments/${r.id}/prescription`}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                                    >
                                                        <AppIcon name="view" className="h-3.5 w-3.5" />
                                                        View Prescription
                                                    </Link>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            openRxVoice(r.id);
                                                        }}
                                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                                    >
                                                        <AppIcon name="section" className="h-3.5 w-3.5" />
                                                        Generate Prescription
                                                    </button>
                                                ))}

                                                {hasMoreActions ? (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedId(r.id);

                                                            if (menu.open && String(menu.id) === String(r.id)) {
                                                                closeMenu();
                                                                return;
                                                            }

                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                            const menuWidth = 240;
                                                            const gap = 8;
                                                            const left = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, rect.right - menuWidth));
                                                            const top = Math.min(window.innerHeight - 12, rect.bottom + gap);

                                                            setMenu({
                                                                open: true,
                                                                id: r.id,
                                                                top,
                                                                left,
                                                            });
                                                        }}
                                                        className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                                        aria-haspopup="menu"
                                                        aria-expanded={menu.open && String(menu.id) === String(r.id)}
                                                    >
                                                        ⋯
                                                    </button>
                                                ) : null}
                                            </div>
                                        </td>
                                    </tr>
                                        );
                                    })()
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {menu.open ? (
                <div
                    className="fixed z-[60] w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
                    role="menu"
                    style={{ top: `${menu.top}px`, left: `${menu.left}px` }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="p-2">
                        {rowLifecycleActions(rows.find((r) => String(r.id) === String(menu.id))?.status).map((a) => (
                            <button
                                key={`${a.kind}:${a.next || a.label}`}
                                type="button"
                                role="menuitem"
                                disabled={menuSavingId === menu.id}
                                onClick={() => handleMenuAction(menu.id, a)}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                <span className={`h-2.5 w-2.5 rounded-full ${actionDotClass(a.next || a.kind)}`} />
                                <span className="flex-1">{a.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            <ConfirmDialog
                open={confirm.open}
                title={confirm.title}
                message={confirm.message}
                confirmText="Confirm"
                cancelText="Cancel"
                danger={confirm.danger}
                busy={confirm.busy}
                confirmDisabled={confirm.confirmDisabled}
                showForce={confirm.showForce}
                forceText="Force Change"
                onForce={async () => {
                    if (!confirm.appointmentId || !confirm.nextStatus) return;
                    setConfirm((p) => ({ ...p, busy: true }));
                    setError('');
                    try {
                        await runLifecycle({ appointmentId: confirm.appointmentId, nextStatus: confirm.nextStatus, reason: null, force: true });
                        setConfirm({ open: false, appointmentId: null, title: '', message: '', nextStatus: '', danger: false, busy: false, confirmDisabled: false, showForce: false });
                        await fetchList();
                    } catch (e) {
                        setError(e?.response?.data?.message || e?.message || 'Failed to change status');
                        setConfirm((p) => ({ ...p, busy: false }));
                    }
                }}
                onClose={() => setConfirm({ open: false, appointmentId: null, title: '', message: '', nextStatus: '', danger: false, busy: false, confirmDisabled: false, showForce: false })}
                onConfirm={async () => {
                    if (!confirm.appointmentId || !confirm.nextStatus) return;
                    setConfirm((p) => ({ ...p, busy: true }));
                    setError('');
                    try {
                        await runLifecycle({ appointmentId: confirm.appointmentId, nextStatus: confirm.nextStatus, reason: null, force: false });
                        setConfirm({ open: false, appointmentId: null, title: '', message: '', nextStatus: '', danger: false, busy: false, confirmDisabled: false, showForce: false });
                        await fetchList();
                    } catch (e) {
                        setError(e?.response?.data?.message || e?.message || 'Failed to change status');
                        setConfirm((p) => ({ ...p, busy: false }));
                    }
                }}
            />

            {cancelDialog.open ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" aria-modal="true" role="dialog" onClick={() => !cancelDialog.busy && setCancelDialog({ open: false, appointmentId: null, reason: '', busy: false, error: '' })}>
                    <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
                            <div className="flex items-center gap-2">
                                <AppIcon name="section" className="h-5 w-5 text-slate-700" />
                                <h3 className="text-base font-semibold text-slate-900">Cancel Appointment</h3>
                            </div>
                            <button
                                type="button"
                                disabled={cancelDialog.busy}
                                onClick={() => setCancelDialog({ open: false, appointmentId: null, reason: '', busy: false, error: '' })}
                                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                Close
                            </button>
                        </div>

                        <div className="space-y-3 px-5 py-4">
                            {cancelDialog.error ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{cancelDialog.error}</div>
                            ) : null}
                            <div>
                                <label className="text-sm font-semibold text-slate-900">Reason (optional)</label>
                                <textarea
                                    value={cancelDialog.reason}
                                    onChange={(e) => setCancelDialog((p) => ({ ...p, reason: e.target.value }))}
                                    rows={3}
                                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                    placeholder="Add a cancellation reason…"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
                            <button
                                type="button"
                                disabled={cancelDialog.busy}
                                onClick={() => setCancelDialog({ open: false, appointmentId: null, reason: '', busy: false, error: '' })}
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                disabled={cancelDialog.busy}
                                onClick={async () => {
                                    if (!cancelDialog.appointmentId) return;
                                    setCancelDialog((p) => ({ ...p, busy: true, error: '' }));
                                    setError('');
                                    try {
                                        await runLifecycle({ appointmentId: cancelDialog.appointmentId, nextStatus: 'cancelled', reason: cancelDialog.reason || null });
                                        setCancelDialog({ open: false, appointmentId: null, reason: '', busy: false, error: '' });
                                        await fetchList();
                                    } catch (e) {
                                        setCancelDialog((p) => ({ ...p, busy: false, error: e?.response?.data?.message || e?.message || 'Failed to cancel' }));
                                    }
                                }}
                                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                                {cancelDialog.busy ? 'Cancelling…' : 'Confirm Cancel'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {rescheduleDialog.open ? (
                <div className="fixed inset-0 z-50 flex" aria-modal="true" role="dialog">
                    <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => !rescheduleDialog.busy && setRescheduleDialog({
                        open: false,
                        appointmentId: null,
                        busy: false,
                        error: '',
                        appointment: null,
                        availability: { loading: false, error: '', days: [] },
                        slotDate: '',
                        selection: { appointment_date: '', start_time: '', end_time: '' },
                    })} />

                    <div className="relative m-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <AppIcon name="calendar" className="h-5 w-5 text-slate-700" />
                                    <h3 className="text-base font-semibold text-slate-900">Mark Rescheduled</h3>
                                </div>
                                <p className="mt-1 text-sm text-slate-600">Pick a new slot. This will update the appointment time and set status to Confirmed.</p>
                            </div>
                            <button
                                type="button"
                                disabled={rescheduleDialog.busy}
                                onClick={() => setRescheduleDialog({
                                    open: false,
                                    appointmentId: null,
                                    busy: false,
                                    error: '',
                                    reason: '',
                                    appointment: null,
                                    availability: { loading: false, error: '', days: [] },
                                    slotDate: '',
                                    selection: { appointment_date: '', start_time: '', end_time: '' },
                                })}
                                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                Close
                            </button>
                        </div>

                        <div className="space-y-4 px-5 py-4">
                            {rescheduleDialog.error ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{rescheduleDialog.error}</div>
                            ) : null}
                            {rescheduleDialog.availability.error ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{rescheduleDialog.availability.error}</div>
                            ) : null}

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div ref={rescheduleChipStripRef} className="flex flex-nowrap gap-2 overflow-x-auto pb-2 whitespace-nowrap">
                                    {rescheduleDialog.availability.loading ? (
                                        <div className="text-sm text-slate-600">Loading slots…</div>
                                    ) : (rescheduleDialog.availability.days || []).length ? (
                                        (rescheduleDialog.availability.days || []).map((d) => (
                                            (() => {
                                                const meta = dateChipMeta(d.date);
                                                const active = rescheduleDialog.slotDate === d.date;
                                                return (
                                                    <button
                                                        key={d.date}
                                                            ref={active ? activeRescheduleChipRef : null}
                                                        type="button"
                                                        onClick={() => setRescheduleDialog((p) => ({ ...p, slotDate: d.date }))}
                                                        className={active
                                                            ? 'min-w-[84px] rounded-xl bg-slate-900 px-3 py-2 text-left text-white'
                                                            : 'min-w-[84px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-slate-700 hover:bg-slate-50'
                                                        }
                                                    >
                                                        <div className="flex items-baseline justify-between">
                                                            <span className={active ? 'text-xs font-semibold text-white/90' : 'text-xs font-semibold text-slate-600'}>{meta.weekday}</span>
                                                            <span className={active ? 'text-xs font-semibold text-white/90' : 'text-xs font-semibold text-slate-600'}>{meta.month}</span>
                                                        </div>
                                                        <div className={active ? 'mt-0.5 text-lg font-bold leading-none text-white' : 'mt-0.5 text-lg font-bold leading-none text-slate-900'}>
                                                            {meta.day}
                                                        </div>
                                                    </button>
                                                );
                                            })()
                                        ))
                                    ) : (
                                        <div className="text-sm text-slate-600">No availability found.</div>
                                    )}
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                    {((rescheduleDialog.availability.days || []).find((x) => x.date === rescheduleDialog.slotDate)?.slots || []).map((s, idx) => {
                                        const isSelected = rescheduleDialog.selection.appointment_date === rescheduleDialog.slotDate
                                            && String(rescheduleDialog.selection.start_time || '') === String(s.start_time);
                                        const disabled = !s.available;
                                        return (
                                            <button
                                                key={`${rescheduleDialog.slotDate}:${s.start_time}:${idx}`}
                                                type="button"
                                                disabled={disabled}
                                                onClick={() => {
                                                    setRescheduleDialog((p) => ({
                                                        ...p,
                                                        selection: { appointment_date: rescheduleDialog.slotDate, start_time: s.start_time, end_time: s.end_time },
                                                    }));
                                                }}
                                                className={disabled
                                                    ? 'rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-400'
                                                    : isSelected
                                                        ? 'rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white'
                                                        : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50'
                                                }
                                            >
                                                {String(s.start_time || '').slice(0, 5)}–{String(s.end_time || '').slice(0, 5)}
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="mt-3">
                                    <label className="text-sm font-semibold text-slate-900">Reason (optional)</label>
                                    <textarea
                                        value={rescheduleDialog.reason}
                                        onChange={(e) => setRescheduleDialog((p) => ({ ...p, reason: e.target.value }))}
                                        rows={2}
                                        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                        placeholder="Add a reschedule reason…"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
                            <button
                                type="button"
                                disabled={rescheduleDialog.busy}
                                onClick={() => setRescheduleDialog({
                                    open: false,
                                    appointmentId: null,
                                    busy: false,
                                    error: '',
                                    reason: '',
                                    appointment: null,
                                    availability: { loading: false, error: '', days: [] },
                                    slotDate: '',
                                    selection: { appointment_date: '', start_time: '', end_time: '' },
                                })}
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={rescheduleDialog.busy}
                                onClick={async () => {
                                    const apptId = rescheduleDialog.appointmentId;
                                    const sel = rescheduleDialog.selection;
                                    if (!apptId) return;
                                    if (!sel.appointment_date || !sel.start_time) {
                                        setRescheduleDialog((p) => ({ ...p, error: 'Select a slot to continue.' }));
                                        return;
                                    }

                                    const selDt = parseLocalDateTime(sel.appointment_date, sel.start_time);
                                    if (selDt && selDt.getTime() < new Date().getTime()) {
                                        setRescheduleDialog((p) => ({ ...p, error: 'Reschedule must be in the future. Past dates/times are not allowed.' }));
                                        return;
                                    }

                                    setRescheduleDialog((p) => ({ ...p, busy: true, error: '' }));
                                    setError('');
                                    try {
                                        await client.post(`${base}/appointments/${apptId}/reschedule`, {
                                            appointment_date: sel.appointment_date,
                                            start_time: sel.start_time,
                                            end_time: sel.end_time || null,
                                            reason: String(rescheduleDialog.reason || '').trim() || null,
                                        });
                                        await runLifecycle({ appointmentId: apptId, nextStatus: 'confirmed', reason: null });
                                        setRescheduleDialog({
                                            open: false,
                                            appointmentId: null,
                                            busy: false,
                                            error: '',
                                            reason: '',
                                            appointment: null,
                                            availability: { loading: false, error: '', days: [] },
                                            slotDate: '',
                                            selection: { appointment_date: '', start_time: '', end_time: '' },
                                        });
                                        await fetchList();
                                    } catch (e) {
                                        setRescheduleDialog((p) => ({ ...p, busy: false, error: e?.response?.data?.message || e?.message || 'Failed to reschedule' }));
                                    }
                                }}
                                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                            >
                                {rescheduleDialog.busy ? 'Saving…' : 'Confirm Reschedule'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {completeDialog.open ? (
                <div className="fixed inset-0 z-50 flex" aria-modal="true" role="dialog">
                    <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => !completeDialog.busy && setCompleteDialog({
                        open: false,
                        appointmentId: null,
                        busy: false,
                        error: '',
                        appointment: null,
                        setFollowUp: false,
                        followMode: 'days',
                        followDays: 7,
                        followDate: '',
                        availability: { loading: false, error: '', days: [] },
                        slotDate: '',
                        selection: { appointment_date: '', start_time: '', end_time: '' },
                    })} />

                    <div className="relative m-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <AppIcon name="section" className="h-5 w-5 text-slate-700" />
                                    <h3 className="text-base font-semibold text-slate-900">Complete Appointment</h3>
                                </div>
                                <p className="mt-1 text-sm text-slate-600">Optionally schedule a follow-up before completing.</p>
                            </div>
                            <button
                                type="button"
                                disabled={completeDialog.busy}
                                onClick={() => setCompleteDialog({
                                    open: false,
                                    appointmentId: null,
                                    busy: false,
                                    error: '',
                                    appointment: null,
                                    setFollowUp: false,
                                    followMode: 'days',
                                    followDays: 7,
                                    followDate: '',
                                    availability: { loading: false, error: '', days: [] },
                                    slotDate: '',
                                    selection: { appointment_date: '', start_time: '', end_time: '' },
                                })}
                                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                Close
                            </button>
                        </div>

                        <div className="space-y-4 px-5 py-4">
                            {completeDialog.error ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{completeDialog.error}</div>
                            ) : null}

                            <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
                                <input
                                    type="checkbox"
                                    checked={completeDialog.setFollowUp}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setCompleteDialog((p) => {
                                            const baseDate = (p?.appointment?.appointment_date && String(p.appointment.appointment_date).slice(0, 10)) || todayYMD;
                                            const target = addDaysYMD(baseDate, Number(p.followDays || 0));
                                            return {
                                                ...p,
                                                setFollowUp: checked,
                                                error: '',
                                                followDate: checked ? (p.followMode === 'days' ? target : (p.followDate || todayYMD)) : '',
                                                availability: checked ? { loading: true, error: '', days: [] } : { loading: false, error: '', days: [] },
                                                slotDate: checked ? (p.followMode === 'days' ? target : (p.slotDate || p.followDate || todayYMD)) : '',
                                                selection: { appointment_date: '', start_time: '', end_time: '' },
                                            };
                                        });
                                    }}
                                />
                                Set follow-up
                            </label>

                            {completeDialog.setFollowUp ? (
                                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setCompleteDialog((p) => ({ ...p, followMode: 'days' }))}
                                            className={completeDialog.followMode === 'days'
                                                ? 'rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white'
                                                : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
                                            }
                                        >
                                            X days
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setCompleteDialog((p) => ({ ...p, followMode: 'date' }))}
                                            className={completeDialog.followMode === 'date'
                                                ? 'rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white'
                                                : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
                                            }
                                        >
                                            Pick date
                                        </button>
                                    </div>

                                    {completeDialog.followMode === 'days' ? (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <label className="text-sm font-semibold text-slate-900">After</label>
                                            <input
                                                type="number"
                                                min={0}
                                                max={14}
                                                value={completeDialog.followDays}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setCompleteDialog((p) => {
                                                        const baseDate = (p?.appointment?.appointment_date && String(p.appointment.appointment_date).slice(0, 10)) || todayYMD;
                                                        const num = Math.max(0, Math.min(14, Number(val || 0)));
                                                        const target = addDaysYMD(baseDate, num);
                                                        return {
                                                            ...p,
                                                            followDays: val,
                                                            followDate: target,
                                                            slotDate: target,
                                                            selection: { appointment_date: '', start_time: '', end_time: '' },
                                                        };
                                                    });
                                                }}
                                                className="w-24 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                                            />
                                            <span className="text-sm text-slate-600">days</span>
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm text-slate-600">Pick a date from the chips below.</span>
                                        </div>
                                    )}

                                    {completeDialog.availability.error ? (
                                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{completeDialog.availability.error}</div>
                                    ) : null}

                                    <div ref={followChipStripRef} className="flex gap-2 overflow-x-auto pb-2">
                                        {completeDialog.availability.loading ? (
                                            <div className="text-sm text-slate-600">Loading slots…</div>
                                        ) : (completeDialog.availability.days || []).length ? (
                                            (completeDialog.availability.days || []).map((d) => (
                                                (() => {
                                                    const meta = dateChipMeta(d.date);
                                                    const active = completeDialog.slotDate === d.date;
                                                    return (
                                                        <button
                                                            key={d.date}
                                                            ref={active ? activeFollowChipRef : null}
                                                            type="button"
                                                            onClick={() => setCompleteDialog((p) => ({ ...p, slotDate: d.date, followDate: d.date }))}
                                                            className={active
                                                                ? 'min-w-[84px] rounded-xl bg-slate-900 px-3 py-2 text-left text-white'
                                                                : 'min-w-[84px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-slate-700 hover:bg-slate-50'
                                                            }
                                                        >
                                                            <div className="flex items-baseline justify-between">
                                                                <span className={active ? 'text-xs font-semibold text-white/90' : 'text-xs font-semibold text-slate-600'}>{meta.weekday}</span>
                                                                <span className={active ? 'text-xs font-semibold text-white/90' : 'text-xs font-semibold text-slate-600'}>{meta.month}</span>
                                                            </div>
                                                            <div className={active ? 'mt-0.5 text-lg font-bold leading-none text-white' : 'mt-0.5 text-lg font-bold leading-none text-slate-900'}>
                                                                {meta.day}
                                                            </div>
                                                        </button>
                                                    );
                                                })()
                                            ))
                                        ) : (
                                            <div className="text-sm text-slate-600">Load slots to pick a time.</div>
                                        )}
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        {((completeDialog.availability.days || []).find((x) => x.date === completeDialog.slotDate)?.slots || []).map((s, idx) => {
                                            const isSelected = completeDialog.selection.appointment_date === completeDialog.slotDate
                                                && String(completeDialog.selection.start_time || '') === String(s.start_time);
                                            const disabled = !s.available;
                                            return (
                                                <button
                                                    key={`${completeDialog.slotDate}:${s.start_time}:${idx}`}
                                                    type="button"
                                                    disabled={disabled}
                                                    onClick={() => setCompleteDialog((p) => ({
                                                        ...p,
                                                        selection: { appointment_date: completeDialog.slotDate, start_time: s.start_time, end_time: s.end_time },
                                                    }))}
                                                    className={disabled
                                                        ? 'rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-400'
                                                        : isSelected
                                                            ? 'rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white'
                                                            : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50'
                                                    }
                                                >
                                                    {String(s.start_time || '').slice(0, 5)}–{String(s.end_time || '').slice(0, 5)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
                            <button
                                type="button"
                                disabled={completeDialog.busy}
                                onClick={() => setCompleteDialog({
                                    open: false,
                                    appointmentId: null,
                                    busy: false,
                                    error: '',
                                    appointment: null,
                                    setFollowUp: false,
                                    followMode: 'days',
                                    followDays: 7,
                                    followDate: '',
                                    availability: { loading: false, error: '', days: [] },
                                    slotDate: '',
                                    selection: { appointment_date: '', start_time: '', end_time: '' },
                                })}
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                Back
                            </button>

                            {completeDialog.setFollowUp ? (
                                <>
                                    <button
                                        type="button"
                                        disabled={completeDialog.busy}
                                        onClick={async () => {
                                            const apptId = completeDialog.appointmentId;
                                            if (!apptId) return;
                                            setCompleteDialog((p) => ({ ...p, busy: true, error: '' }));
                                            setError('');
                                            try {
                                                await runLifecycle({ appointmentId: apptId, nextStatus: 'completed', reason: null });
                                                setCompleteDialog({
                                                    open: false,
                                                    appointmentId: null,
                                                    busy: false,
                                                    error: '',
                                                    appointment: null,
                                                    setFollowUp: false,
                                                    followMode: 'days',
                                                    followDays: 7,
                                                    followDate: '',
                                                    availability: { loading: false, error: '', days: [] },
                                                    slotDate: '',
                                                    selection: { appointment_date: '', start_time: '', end_time: '' },
                                                });
                                                await fetchList();
                                            } catch (e) {
                                                setCompleteDialog((p) => ({ ...p, busy: false, error: e?.response?.data?.message || e?.message || 'Failed to complete' }));
                                            }
                                        }}
                                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                    >
                                        {completeDialog.busy ? 'Working…' : 'Complete without Follow-up'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={completeDialog.busy}
                                        onClick={async () => {
                                            const apptId = completeDialog.appointmentId;
                                            const appt = completeDialog.appointment;
                                            const sel = completeDialog.selection;
                                            if (!apptId || !appt) return;
                                            if (!sel.appointment_date || !sel.start_time) {
                                                setCompleteDialog((p) => ({ ...p, error: 'Select a follow-up slot to continue.' }));
                                                return;
                                            }

                                            setCompleteDialog((p) => ({ ...p, busy: true, error: '' }));
                                            setError('');
                                            try {
                                                const payload = {
                                                    clinic_id: appt.clinic_id,
                                                    branch_id: appt.branch_id,
                                                    doctor_id: appt.doctor_id,
                                                    patient_id: appt.patient_id,
                                                    service_id: appt.service_id || null,
                                                    appointment_date: sel.appointment_date,
                                                    start_time: sel.start_time,
                                                    end_time: sel.end_time || null,
                                                    visit_type: 'followup',
                                                    consultation_mode: appt.consultation_mode || 'in_person',
                                                    booking_channel: appt.booking_channel || 'staff',
                                                };

                                                const createRes = await client.post(`${base}/appointments`, payload);
                                                const newId = createRes?.data?.data?.id;
                                                if (newId) {
                                                    await runLifecycle({ appointmentId: newId, nextStatus: 'confirmed', reason: null });
                                                }

                                                await runLifecycle({ appointmentId: apptId, nextStatus: 'completed', reason: null });
                                                setCompleteDialog({
                                                    open: false,
                                                    appointmentId: null,
                                                    busy: false,
                                                    error: '',
                                                    appointment: null,
                                                    setFollowUp: false,
                                                    followMode: 'days',
                                                    followDays: 7,
                                                    followDate: '',
                                                    availability: { loading: false, error: '', days: [] },
                                                    slotDate: '',
                                                    selection: { appointment_date: '', start_time: '', end_time: '' },
                                                });
                                                await fetchList();
                                            } catch (e) {
                                                setCompleteDialog((p) => ({ ...p, busy: false, error: e?.response?.data?.message || e?.message || 'Failed to set follow-up/complete' }));
                                            }
                                        }}
                                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                                    >
                                        {completeDialog.busy ? 'Working…' : 'Set Follow-up & Complete'}
                                    </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    disabled={completeDialog.busy}
                                    onClick={async () => {
                                        const apptId = completeDialog.appointmentId;
                                        if (!apptId) return;
                                        setCompleteDialog((p) => ({ ...p, busy: true, error: '' }));
                                        setError('');
                                        try {
                                            await runLifecycle({ appointmentId: apptId, nextStatus: 'completed', reason: null });
                                            setCompleteDialog({
                                                open: false,
                                                appointmentId: null,
                                                busy: false,
                                                error: '',
                                                appointment: null,
                                                setFollowUp: false,
                                                followMode: 'days',
                                                followDays: 7,
                                                followDate: '',
                                                availability: { loading: false, error: '', days: [] },
                                                slotDate: '',
                                                selection: { appointment_date: '', start_time: '', end_time: '' },
                                            });
                                            await fetchList();
                                        } catch (e) {
                                            setCompleteDialog((p) => ({ ...p, busy: false, error: e?.response?.data?.message || e?.message || 'Failed to complete' }));
                                        }
                                    }}
                                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                                >
                                    {completeDialog.busy ? 'Completing…' : 'Complete'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}

            {detailDialog.open ? (
                <div className="fixed inset-0 z-50 flex" aria-modal="true" role="dialog">
                    <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setDetailDialog({ open: false, type: '', id: null, loading: false, error: '', record: null })} />

                    <div className="relative m-auto w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <AppIcon name="view" className="h-5 w-5 text-slate-700" />
                                    <h3 className="text-base font-semibold text-slate-900">
                                        {detailDialog.type === 'patient' ? 'Patient' : 'Doctor'} Detail
                                    </h3>
                                </div>
                                <p className="mt-1 text-sm text-slate-600">Quick view in dialog.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setDetailDialog({ open: false, type: '', id: null, loading: false, error: '', record: null })}
                                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                                Close
                            </button>
                        </div>

                        <div className="space-y-3 px-5 py-4">
                            {detailDialog.loading ? (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">Loading…</div>
                            ) : null}
                            {detailDialog.error ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{detailDialog.error}</div>
                            ) : null}

                            {!detailDialog.loading && detailDialog.record ? (
                                <div className="rounded-xl border border-slate-200 bg-white p-4">
                                    <div className="text-sm font-semibold text-slate-900">
                                        {detailDialog.record.full_name || detailDialog.record.name || `${detailDialog.type} #${detailDialog.id}`}
                                    </div>
                                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-700">
                                        <div><span className="text-slate-500">Phone:</span> {detailDialog.record.phone || '—'}</div>
                                        <div><span className="text-slate-500">Email:</span> {detailDialog.record.email || '—'}</div>
                                    </div>
                                </div>
                            ) : null}

                            <div className="flex justify-end">
                                <Link
                                    to={detailDialog.type === 'patient' ? `/modules/patients/${detailDialog.id}` : `/modules/doctors/${detailDialog.id}`}
                                    className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                                    onClick={() => setDetailDialog({ open: false, type: '', id: null, loading: false, error: '', record: null })}
                                >
                                    View detailed profile
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {rxVoice.open ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
                    onClick={() => {
                        if (rxVoice.phase === 'recording' || rxVoice.phase === 'processing' || rxVoice.phase === 'stopping') return;
                        cleanupRxRecorder();
                        setRxVoice((p) => ({ ...p, open: false, appointmentId: null }));
                    }}
                >
                    <div
                        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-900 to-slate-700 px-5 py-4 text-white">
                            <div className="flex items-center gap-2">
                                <AppIcon name="section" className="h-5 w-5" />
                                <h3 className="text-lg font-semibold">Voice Prescription</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (rxVoice.phase === 'recording' || rxVoice.phase === 'processing' || rxVoice.phase === 'stopping') return;
                                    cleanupRxRecorder();
                                    setRxVoice((p) => ({ ...p, open: false, appointmentId: null }));
                                }}
                                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
                            >
                                Close
                            </button>
                        </div>

                        <div className="space-y-4 p-5">
                            {rxVoice.error ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                    {rxVoice.error}
                                </div>
                            ) : null}

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recording</div>
                                <div className="mt-3 flex items-center justify-center gap-2">
                                    {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                                        const active = rxVoice.phase === 'recording' || rxVoice.phase === 'stopping';
                                        return (
                                            <div
                                                key={i}
                                                className={active ? 'h-8 w-1 rounded bg-slate-700/70' : 'h-2 w-1 rounded bg-slate-400/60'}
                                                style={active ? { animation: `rxbar 0.9s ${i * 0.08}s infinite ease-in-out`, transformOrigin: 'center' } : undefined}
                                            />
                                        );
                                    })}
                                </div>

                                {rxVoice.phase === 'processing' ? (
                                    <div className="mt-3 text-center text-sm text-slate-700">Processing audio…</div>
                                ) : rxVoice.phase === 'requesting' ? (
                                    <div className="mt-3 text-center text-sm text-slate-700">Requesting microphone…</div>
                                ) : null}
                            </div>

                            <div className="flex items-center justify-center gap-2">
                                {rxVoice.phase === 'recording' ? (
                                    <button
                                        type="button"
                                        onClick={stopRxRecording}
                                        className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
                                    >
                                        Stop Recording
                                    </button>
                                ) : rxVoice.phase === 'processing' || rxVoice.phase === 'stopping' ? (
                                    <button
                                        type="button"
                                        disabled
                                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white opacity-60"
                                    >
                                        Processing…
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={startRxRecording}
                                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                                    >
                                        Start Recording
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            <AppointmentDetailDrawer
                open={drawer.open}
                appointmentId={drawer.id}
                onClose={() => setDrawer({ open: false, id: null })}
                onChanged={() => fetchList()}
            />
        </div>
    );
}
