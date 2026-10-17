import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';
import AppIcon from '../../components/AppIcon';
import Skeleton from '../../components/Skeleton';
import StatusBadge from '../../components/StatusBadge';
import { formatDate, formatDateTime } from '../../utils/dateFormat';
import { formatRupees } from '../../utils/money';

const PAYMENT_METHODS = [
    { value: 'cash', label: 'Cash' },
    { value: 'upi', label: 'UPI' },
    { value: 'card', label: 'Card' },
    { value: 'bank_transfer', label: 'Bank transfer' },
    { value: 'other', label: 'Other' },
];

const METHOD_LABELS = { ...Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label])), online: 'Online' };

const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-500';
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500';
const btnPrimary = 'inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50';
const btnOutline = 'inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const btnDanger = 'inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50';

const apiError = (e, fallback) => e?.response?.data?.message || e?.message || fallback;

// A blob-typed request (the PDF) carries its error body as a Blob; read the message out of it.
async function blobApiError(e, fallback) {
    const data = e?.response?.data;
    if (data instanceof Blob) {
        try {
            const parsed = JSON.parse(await data.text());
            if (parsed?.message) return parsed.message;
        } catch {
            // not JSON; fall through
        }
        return fallback;
    }
    return apiError(e, fallback);
}

let lineSeq = 0;
const newLine = (over = {}) => ({
    key: `l${++lineSeq}`,
    service_id: null,
    description: '',
    quantity: '1',
    unit_amount: '',
    ...over,
});

const lineFromApi = (i) => newLine({
    service_id: i.service_id ?? null,
    description: i.description ?? '',
    quantity: String(i.quantity ?? 1),
    unit_amount: String(i.unit_amount ?? ''),
});

const EMPTY_FORM = { items: [newLine()], discount: '', tax: '', notes: '', invoiceDate: '' };

const formFromInvoice = (inv) => ({
    items: (inv.items || []).length ? inv.items.map(lineFromApi) : [newLine()],
    discount: Number(inv.discount_amount) > 0 ? String(inv.discount_amount) : '',
    // A hand-set tax is shown so it can be seen and kept; an automatic one stays blank so the server keeps computing it.
    tax: inv.tax_is_manual ? String(inv.tax_amount ?? '') : '',
    notes: inv.notes || '',
    invoiceDate: inv.invoice_date || '',
});

const snapshot = (form, patientId) => JSON.stringify({
    p: patientId,
    d: form.discount,
    t: form.tax,
    n: form.notes,
    dt: form.invoiceDate,
    i: form.items.map((l) => [l.service_id, l.description, l.quantity, l.unit_amount]),
});

// Visit types the doctor fee depends on, mapped to the server-rendered line on each doctor row.
const FEE_VISIT_TYPES = [
    { value: 'new', label: 'New consultation', lineKey: 'consultation_line' },
    { value: 'followup', label: 'Follow-up visit', lineKey: 'followup_line' },
];

const APPOINTMENT_WINDOW_DAYS = 90;

// Local calendar date (YYYY-MM-DD) N days ago; toISOString would shift it to UTC.
const dateDaysAgo = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const isBlankLine = (l) => !l.service_id && !l.description.trim() && l.unit_amount === '';

const lineAmount = (l) => {
    const q = Number(l.quantity);
    const u = Number(l.unit_amount);
    return Number.isFinite(q) && Number.isFinite(u) ? Math.round(q * u * 100) / 100 : 0;
};

function Notice({ tone, children }) {
    const tones = {
        error: 'border-rose-200 bg-rose-50 text-rose-700',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        warn: 'border-amber-200 bg-amber-50 text-amber-800',
    };
    return <div className={`rounded-xl border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}

function Card({ title, children, right }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {title ? (
                <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
                    {right}
                </div>
            ) : null}
            {children}
        </div>
    );
}

export default function InvoiceDetailPage() {
    const { id } = useParams();
    const isNew = !id;
    const [searchParams] = useSearchParams();
    const location = useLocation();
    const navigate = useNavigate();
    const { user } = useAuth();
    const scope = useScope();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);
    const canCreate = Boolean(scope?.can?.('billing.create'));
    const canEdit = Boolean(scope?.can?.('billing.edit'));

    const appointmentParam = searchParams.get('appointment_id') || '';
    const patientParam = searchParams.get('patient_id') || '';

    const [invoice, setInvoice] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [patient, setPatient] = useState(null);
    const [appointmentId, setAppointmentId] = useState(null);
    const [baseline, setBaseline] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [services, setServices] = useState([]);
    const [doctors, setDoctors] = useState([]);
    const [feePick, setFeePick] = useState({ doctorId: '', visitType: 'new' });

    // Appointments of the chosen patient that can still be billed (standalone New-invoice path only).
    const [billable, setBillable] = useState({ loading: false, error: '', items: [] });
    const prefillSeq = useRef(0);

    const [patientQuery, setPatientQuery] = useState('');
    const [patientResults, setPatientResults] = useState([]);
    const [patientSearching, setPatientSearching] = useState(false);
    const patientQueryRef = useRef('');

    const [cancelBox, setCancelBox] = useState({ open: false, reason: '' });
    const [payBox, setPayBox] = useState({ open: false, amount: '', method: 'cash', reference: '', notes: '' });
    const [refundBox, setRefundBox] = useState({ paymentId: null, reason: '' });

    const status = invoice?.status || 'draft';
    const editable = isNew ? canCreate : (status === 'draft' && canCreate);

    // Load (or reset) whenever the invoice, prefill target or route changes. A late response from
    // a previous target is dropped.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        setNotice('');
        setInvoice(null);
        setForm(EMPTY_FORM);
        setPatient(null);
        setAppointmentId(null);
        setBaseline('');
        setPatientQuery('');
        setPatientResults([]);
        setFeePick({ doctorId: '', visitType: 'new' });
        setBillable({ loading: false, error: '', items: [] });
        prefillSeq.current += 1; // drop any in-flight appointment prefill from the previous route
        setBusy((b) => (b === 'prefill' ? '' : b));
        setCancelBox({ open: false, reason: '' });
        setPayBox({ open: false, amount: '', method: 'cash', reference: '', notes: '' });
        setRefundBox({ paymentId: null, reason: '' });

        const loadPatient = async (pid) => {
            try {
                const res = await client.get(`${base}/patients/${pid}`);
                const p = res?.data?.data;
                return p ? { id: p.id, full_name: p.full_name, phone: p.phone } : { id: Number(pid), full_name: `Patient #${pid}`, phone: null };
            } catch {
                return { id: Number(pid), full_name: `Patient #${pid}`, phone: null };
            }
        };

        (async () => {
            try {
                if (!isNew) {
                    const res = await client.get(`${base}/invoices/${id}`);
                    if (cancelled) return;
                    const inv = res?.data?.data;
                    const f = formFromInvoice(inv);
                    setInvoice(inv);
                    setForm(f);
                    setPatient(inv.patient || null);
                    setAppointmentId(inv.appointment_id ?? null);
                    setBaseline(snapshot(f, inv.patient?.id ?? null));
                } else if (appointmentParam) {
                    const res = await client.get(`${base}/appointments/${appointmentParam}/invoice-prefill`);
                    if (cancelled) return;
                    const pre = res?.data?.data || {};
                    const p = pre.patient_id ? await loadPatient(pre.patient_id) : null;
                    if (cancelled) return;
                    const items = Array.isArray(pre.items) && pre.items.length ? pre.items.map(lineFromApi) : [newLine()];
                    const f = { ...EMPTY_FORM, items };
                    setForm(f);
                    setPatient(p);
                    setAppointmentId(pre.appointment_id ?? Number(appointmentParam));
                    setBaseline(snapshot(f, p?.id ?? null));
                } else if (patientParam) {
                    const p = await loadPatient(patientParam);
                    if (cancelled) return;
                    setPatient(p);
                    setBaseline(snapshot(EMPTY_FORM, p.id));
                } else {
                    setBaseline(snapshot(EMPTY_FORM, null));
                }
            } catch (e) {
                if (cancelled) return;
                setError(apiError(e, isNew ? 'Failed to load the appointment' : 'Failed to load invoice'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [base, id, isNew, appointmentParam, patientParam, location.key]);

    // Services for the line picker. Only needed while the invoice can be edited.
    useEffect(() => {
        if (!editable) return undefined;
        let cancelled = false;
        client.get(`${base}/services`, { params: { per_page: 200, status: 'active' } })
            .then((res) => {
                if (cancelled) return;
                setServices(Array.isArray(res?.data?.data) ? res.data.data : []);
            })
            .catch(() => {
                if (!cancelled) setServices([]);
            });
        return () => { cancelled = true; };
    }, [base, editable]);

    // Doctors for the fee picker. Each row carries the server-rendered consultation_line / followup_line.
    useEffect(() => {
        if (!editable) return undefined;
        let cancelled = false;
        client.get(`${base}/doctors`, { params: { per_page: 200, status: 'active' } })
            .then((res) => {
                if (cancelled) return;
                setDoctors(Array.isArray(res?.data?.data) ? res.data.data : []);
            })
            .catch(() => {
                if (!cancelled) setDoctors([]);
            });
        return () => { cancelled = true; };
    }, [base, editable]);

    // Once a patient is chosen on the standalone New-invoice path, find their appointments from the
    // last 90 days that are not cancelled and have no live (non-cancelled) invoice.
    const patientId = patient?.id ?? null;
    const offerAppointments = isNew && !appointmentParam && canCreate;
    useEffect(() => {
        if (!offerAppointments || !patientId) {
            setBillable({ loading: false, error: '', items: [] });
            return undefined;
        }
        let cancelled = false;
        setBillable({ loading: true, error: '', items: [] });
        (async () => {
            try {
                // For doctor-role users the server narrows an unfiltered list to open visits only, which
                // would hide completed ones; the second, completed-only request covers that. Results are merged by id.
                const window90 = {
                    patient_id: patientId,
                    appointment_date_from: dateDaysAgo(APPOINTMENT_WINDOW_DAYS),
                    appointment_date_to: dateDaysAgo(0),
                    per_page: 100,
                };
                const [invRes, allRes, completedRes] = await Promise.all([
                    client.get(`${base}/invoices`, { params: { patient_id: patientId, per_page: 100 } }),
                    client.get(`${base}/appointments`, { params: window90 }),
                    client.get(`${base}/appointments`, { params: { ...window90, status: 'completed' } }),
                ]);
                if (cancelled) return;
                const billed = new Set(
                    (invRes?.data?.data || [])
                        .filter((i) => i.status !== 'cancelled' && i.appointment_id)
                        .map((i) => Number(i.appointment_id)),
                );
                const byId = new Map();
                [allRes, completedRes].flatMap((r) => r?.data?.data || []).forEach((a) => byId.set(Number(a.id), a));
                const items = [...byId.values()]
                    .filter((a) => a.status !== 'cancelled' && !billed.has(Number(a.id)))
                    .sort((a, b) => String(b.appointment_date).localeCompare(String(a.appointment_date)) || b.id - a.id);
                setBillable({ loading: false, error: '', items });
            } catch (e) {
                if (cancelled) return;
                setBillable({ loading: false, error: apiError(e, "Failed to load the patient's appointments"), items: [] });
            }
        })();
        return () => { cancelled = true; };
    }, [base, offerAppointments, patientId]);

    const searchPatients = async (q) => {
        setPatientQuery(q);
        patientQueryRef.current = q;
        if (!q.trim()) {
            setPatientResults([]);
            setPatientSearching(false);
            return;
        }
        setPatientSearching(true);
        try {
            const { data } = await client.get(`${base}/patients`, { params: { search: q.trim(), per_page: 10 } });
            if (patientQueryRef.current !== q) return; // a newer search superseded this response
            setPatientResults(Array.isArray(data?.data) ? data.data : []);
        } catch {
            if (patientQueryRef.current !== q) return;
            setPatientResults([]);
        } finally {
            if (patientQueryRef.current === q) setPatientSearching(false);
        }
    };

    const dirty = editable && snapshot(form, patient?.id ?? null) !== baseline;

    const setLine = (key, patch) => setForm((p) => ({ ...p, items: p.items.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
    const removeLine = (key) => setForm((p) => ({ ...p, items: p.items.length > 1 ? p.items.filter((l) => l.key !== key) : p.items }));
    const addLine = () => setForm((p) => ({ ...p, items: [...p.items, newLine()] }));

    const pickService = (key, serviceId) => {
        if (!serviceId) {
            setLine(key, { service_id: null });
            return;
        }
        const svc = services.find((s) => String(s.id) === String(serviceId));
        if (!svc) return;
        setLine(key, { service_id: svc.id, description: svc.name, unit_amount: svc.fee != null ? String(svc.fee) : '' });
    };

    // Doctors offered for the chosen visit type: only those whose rendered line is present.
    const feeType = FEE_VISIT_TYPES.find((t) => t.value === feePick.visitType) || FEE_VISIT_TYPES[0];
    const feeDoctors = doctors.filter((d) => d[feeType.lineKey]);
    const feeDoctor = feeDoctors.find((d) => String(d.id) === String(feePick.doctorId));

    // Inserts the server-rendered fee line verbatim (description and amount are never built here).
    const addDoctorFee = () => {
        const line = feeDoctor?.[feeType.lineKey];
        if (!line) return;
        const fresh = newLine({
            service_id: line.service_id ?? null,
            description: line.description,
            quantity: String(line.quantity ?? 1),
            unit_amount: String(line.unit_amount),
        });
        // A lone untouched placeholder line gives way to the fee line rather than sitting beside it.
        setForm((p) => ({ ...p, items: p.items.length === 1 && isBlankLine(p.items[0]) ? [fresh] : [...p.items, fresh] }));
        setFeePick((p) => ({ ...p, doctorId: '' }));
    };

    // Lines belong to the patient they were built for (prefilled fees, hand-picked fees), so choosing
    // another patient discards them, after a confirm that says so when there is anything to lose.
    const changePatient = () => {
        const hasWork = form.items.some((l) => !isBlankLine(l));
        if (hasWork && !window.confirm('Changing the patient discards the lines on this invoice, including any fees prefilled from an appointment. Continue?')) return;
        prefillSeq.current += 1;
        setPatient(null);
        setAppointmentId(null);
        setForm((p) => ({ ...p, items: [newLine()] }));
    };

    const attachAppointment = async (apptId) => {
        if (!apptId || busy) return;
        const hasWork = form.items.some((l) => !isBlankLine(l));
        if (hasWork && !window.confirm('Attaching an appointment replaces the lines already on this invoice. Continue?')) return;
        const seq = ++prefillSeq.current;
        setBusy('prefill');
        setError('');
        setNotice('');
        try {
            const res = await client.get(`${base}/appointments/${apptId}/invoice-prefill`);
            if (seq !== prefillSeq.current) return; // route changed or a newer pick superseded this one
            const pre = res?.data?.data || {};
            const items = Array.isArray(pre.items) && pre.items.length ? pre.items.map(lineFromApi) : [newLine()];
            setForm((p) => ({ ...p, items }));
            setAppointmentId(pre.appointment_id ?? Number(apptId));
        } catch (e) {
            if (seq === prefillSeq.current) setError(apiError(e, 'Failed to load the appointment'));
        } finally {
            if (seq === prefillSeq.current) setBusy('');
        }
    };

    const subtotalEstimate = useMemo(
        () => Math.round(form.items.reduce((sum, l) => sum + lineAmount(l), 0) * 100) / 100,
        [form.items],
    );

    const buildPayload = () => {
        const payload = {
            invoice_date: form.invoiceDate || null,
            notes: form.notes.trim() || null,
            discount_amount: form.discount === '' ? 0 : Number(form.discount),
            items: form.items.map((l) => ({
                description: l.description.trim(),
                quantity: Number(l.quantity),
                unit_amount: Number(l.unit_amount),
                service_id: l.service_id || null,
            })),
        };
        if (form.tax !== '') payload.tax_amount = Number(form.tax);
        return payload;
    };

    const formProblem = () => {
        if (isNew && !patient) return 'Choose a patient.';
        if (!form.items.length) return 'Add at least one item.';
        for (const l of form.items) {
            if (!l.description.trim()) return 'Every item needs a description.';
            if (!Number.isInteger(Number(l.quantity)) || Number(l.quantity) < 1) return 'Every item needs a quantity of at least 1.';
            if (l.unit_amount === '' || !Number.isFinite(Number(l.unit_amount)) || Number(l.unit_amount) < 0) return 'Every item needs a price of 0 or more.';
        }
        return '';
    };

    // Runs one action: single-flight, clears messages, surfaces the API message verbatim.
    const run = async (name, fn, fallback) => {
        if (busy) return;
        setBusy(name);
        setError('');
        setNotice('');
        try {
            await fn();
        } catch (e) {
            setError(await blobApiError(e, fallback));
        } finally {
            setBusy('');
        }
    };

    const applyInvoice = (inv) => {
        const f = formFromInvoice(inv);
        setInvoice(inv);
        setForm(f);
        setPatient(inv.patient || patient);
        setBaseline(snapshot(f, inv.patient?.id ?? patient?.id ?? null));
    };

    const save = () => {
        const problem = formProblem();
        if (problem) {
            setError(problem);
            return Promise.resolve();
        }
        return run('save', async () => {
            if (isNew) {
                const payload = { ...buildPayload(), patient_id: patient.id };
                if (appointmentId) payload.appointment_id = appointmentId;
                const res = await client.post(`${base}/invoices`, payload);
                navigate(`/workflows/billing/${res.data.data.id}`, { replace: true, state: { created: res?.data?.message } });
            } else {
                const res = await client.put(`${base}/invoices/${invoice.id}`, buildPayload());
                applyInvoice(res.data.data);
                setNotice(res?.data?.message || 'Invoice updated.');
            }
        }, 'Failed to save invoice');
    };

    const issue = () => run('issue', async () => {
        const res = await client.post(`${base}/invoices/${invoice.id}/issue`);
        applyInvoice(res.data.data);
        setNotice(res?.data?.message || 'Invoice issued.');
    }, 'Failed to issue invoice');

    const cancelInvoice = () => run('cancel', async () => {
        const res = await client.post(`${base}/invoices/${invoice.id}/cancel`, { reason: cancelBox.reason.trim() || undefined });
        applyInvoice(res.data.data);
        setCancelBox({ open: false, reason: '' });
        setNotice(res?.data?.message || 'Invoice cancelled.');
    }, 'Failed to cancel invoice');

    const reload = async () => {
        const res = await client.get(`${base}/invoices/${invoice.id}`);
        applyInvoice(res.data.data);
    };

    const recordPayment = () => run('pay', async () => {
        const amount = Number(payBox.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            setError('Enter an amount greater than zero.');
            return;
        }
        const res = await client.post(`${base}/invoices/${invoice.id}/payments`, {
            amount,
            payment_method: payBox.method,
            reference_number: payBox.reference.trim() || undefined,
            notes: payBox.notes.trim() || undefined,
        });
        // The POST resolved, so the payment IS recorded. Close the box and clear the amount before
        // anything else; a refresh failure below must never read as a failed payment (re-entry risk).
        setPayBox({ open: false, amount: '', method: 'cash', reference: '', notes: '' });
        setNotice(res?.data?.message || 'Payment recorded.');
        try {
            await reload();
        } catch (e) {
            setNotice('');
            setError('Payment recorded — could not refresh, reload the page to see the updated balance.');
        }
    }, 'Failed to record payment');

    const refundPayment = () => run('refund', async () => {
        if (!refundBox.reason.trim()) {
            setError('Give a reason for the refund.');
            return;
        }
        const res = await client.post(`${base}/payments/${refundBox.paymentId}/refund`, { reason: refundBox.reason.trim() });
        setRefundBox({ paymentId: null, reason: '' });
        setNotice(res?.data?.message || 'Payment refunded.');
        try {
            await reload();
        } catch (e) {
            setNotice('');
            setError('Refund recorded — could not refresh, reload the page to see the updated balance.');
        }
    }, 'Failed to refund payment');

    const downloadPdf = () => run('pdf', async () => {
        const res = await client.get(`${base}/invoices/${invoice.id}/pdf`, { responseType: 'blob' });
        const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoice-${String(invoice.invoice_number || invoice.id).replace(/[\\/]/g, '-')}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    }, 'Failed to download the PDF');

    const sendWhatsApp = () => run('send', async () => {
        const res = await client.post(`${base}/invoices/${invoice.id}/send`);
        const delivery = res?.data?.data?.delivery_status;
        setNotice(`${res?.data?.message || 'Invoice sent.'}${delivery ? ` Delivery status: ${delivery}.` : ''}`);
    }, 'Failed to send the invoice');

    // Message handed over by the create redirect, shown once.
    useEffect(() => {
        const created = location.state?.created;
        if (created && !isNew) setNotice(created);
    }, [location.state, isNew]);

    const payments = invoice?.payments || [];
    const mainPayments = payments.filter((p) => !p.superseded);
    const supersededPayments = payments.filter((p) => p.superseded);
    const balance = Number(invoice?.balance ?? 0);
    const overpaid = invoice && status !== 'draft' && status !== 'cancelled' && balance < 0;
    const canTakePayment = canCreate && status === 'issued' && balance > 0;
    const canSend = canCreate && (status === 'issued' || status === 'paid');
    const title = isNew ? 'New invoice' : (invoice?.invoice_number || 'Draft invoice');

    const openPayBox = () => setPayBox({ open: true, amount: balance > 0 ? balance.toFixed(2) : '', method: 'cash', reference: '', notes: '' });

    if (loading) {
        return <Skeleton variant="fields" rows={8} />;
    }

    if (!isNew && !invoice) {
        return (
            <div className="space-y-3">
                {error ? <Notice tone="error">{error}</Notice> : null}
                <Link to="/workflows/billing" className="text-sm text-blue-700 hover:underline">Back to billing</Link>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-start gap-2">
                    <AppIcon name="file-text" className="mt-1 h-5 w-5 text-slate-700" />
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
                            {!isNew ? <StatusBadge status={status} /> : null}
                        </div>
                        <p className="mt-0.5 text-sm text-slate-600">
                            <Link to="/workflows/billing" className="text-blue-700 hover:underline">Billing</Link>
                            {invoice?.invoice_date ? ` · ${formatDate(invoice.invoice_date)}` : ''}
                            {invoice?.doctor_name ? ` · ${invoice.doctor_name}` : ''}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {editable ? (
                        <button type="button" onClick={save} disabled={Boolean(busy) || (!isNew && !dirty)} className={btnOutline}>
                            {busy === 'save' ? 'Saving…' : (isNew ? 'Create draft' : 'Save changes')}
                        </button>
                    ) : null}
                    {!isNew && status === 'draft' && canCreate ? (
                        <button
                            type="button"
                            onClick={issue}
                            disabled={Boolean(busy) || dirty}
                            title={dirty ? 'Save your changes before issuing' : undefined}
                            className={btnPrimary}
                        >
                            {busy === 'issue' ? 'Issuing…' : 'Issue invoice'}
                        </button>
                    ) : null}
                    {canTakePayment ? (
                        <button type="button" onClick={openPayBox} disabled={Boolean(busy)} className={btnPrimary}>Record payment</button>
                    ) : null}
                    {!isNew ? (
                        <button type="button" onClick={downloadPdf} disabled={Boolean(busy)} className={btnOutline}>
                            {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}
                        </button>
                    ) : null}
                    {canSend ? (
                        <button type="button" onClick={sendWhatsApp} disabled={Boolean(busy)} className={btnOutline}>
                            {busy === 'send' ? 'Sending…' : 'Send on WhatsApp'}
                        </button>
                    ) : null}
                    {!isNew && status !== 'cancelled' && canEdit ? (
                        <button type="button" onClick={() => setCancelBox({ open: true, reason: '' })} disabled={Boolean(busy)} className={btnDanger}>
                            Cancel invoice
                        </button>
                    ) : null}
                </div>
            </div>

            {error ? <Notice tone="error">{error}</Notice> : null}
            {notice ? <Notice tone="success">{notice}</Notice> : null}

            {overpaid ? (
                <Notice tone="warn">
                    This invoice is overpaid by <strong>{formatRupees(-balance)}</strong>. The clinic owes the patient this amount; refund a payment below to settle it.
                </Notice>
            ) : null}
            {status === 'cancelled' ? (
                <Notice tone="warn">
                    Cancelled{invoice?.cancelled_at ? ` on ${formatDateTime(invoice.cancelled_at)}` : ''}{invoice?.cancelled_reason ? ` — ${invoice.cancelled_reason}` : ''}.
                </Notice>
            ) : null}
            {!isNew && status !== 'draft' && status !== 'cancelled' ? (
                <p className="text-xs text-slate-500">This invoice is issued and can no longer be edited.</p>
            ) : null}

            {cancelBox.open ? (
                <Card title="Cancel this invoice?">
                    <label className={labelClass}>Reason (optional)</label>
                    <input
                        value={cancelBox.reason}
                        maxLength={500}
                        onChange={(e) => setCancelBox((p) => ({ ...p, reason: e.target.value }))}
                        className={inputClass}
                    />
                    <div className="mt-3 flex gap-2">
                        <button type="button" onClick={cancelInvoice} disabled={Boolean(busy)} className={btnDanger}>
                            {busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel invoice'}
                        </button>
                        <button type="button" onClick={() => setCancelBox({ open: false, reason: '' })} disabled={Boolean(busy)} className={btnOutline}>Keep invoice</button>
                    </div>
                </Card>
            ) : null}

            {payBox.open ? (
                <Card title="Record a payment" right={<span className="text-xs text-slate-500">Outstanding: <strong className="text-slate-900">{formatRupees(balance)}</strong></span>}>
                    <div className="grid gap-3 md:grid-cols-4">
                        <div>
                            <label className={labelClass}>Amount</label>
                            <input type="number" min="0" step="0.01" value={payBox.amount} onChange={(e) => setPayBox((p) => ({ ...p, amount: e.target.value }))} className={inputClass} />
                        </div>
                        <div>
                            <label className={labelClass}>Method</label>
                            <select value={payBox.method} onChange={(e) => setPayBox((p) => ({ ...p, method: e.target.value }))} className={inputClass}>
                                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelClass}>Reference</label>
                            <input value={payBox.reference} maxLength={100} onChange={(e) => setPayBox((p) => ({ ...p, reference: e.target.value }))} className={inputClass} />
                            <p className="mt-1 text-xs text-slate-500">Appears on the patient's copy of the invoice — keep internal remarks in Notes.</p>
                        </div>
                        <div>
                            <label className={labelClass}>Notes</label>
                            <input value={payBox.notes} maxLength={1000} onChange={(e) => setPayBox((p) => ({ ...p, notes: e.target.value }))} className={inputClass} />
                        </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                        <button type="button" onClick={recordPayment} disabled={Boolean(busy)} className={btnPrimary}>
                            {busy === 'pay' ? 'Recording…' : 'Record payment'}
                        </button>
                        <button type="button" onClick={() => setPayBox((p) => ({ ...p, open: false }))} disabled={Boolean(busy)} className={btnOutline}>Close</button>
                    </div>
                </Card>
            ) : null}

            <Card title="Patient">
                {isNew && !appointmentParam ? (
                    <div className="space-y-2">
                        {patient ? (
                            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                                <span><span className="font-medium text-slate-900">{patient.full_name}</span> <span className="text-slate-500">{patient.phone || ''}</span></span>
                                <button
                                    type="button"
                                    onClick={changePatient}
                                    disabled={Boolean(busy)}
                                    className="text-xs text-blue-700 hover:underline disabled:opacity-50"
                                >
                                    Change
                                </button>
                            </div>
                        ) : (
                            <>
                                <input
                                    type="search"
                                    value={patientQuery}
                                    onChange={(e) => searchPatients(e.target.value)}
                                    placeholder="Search patients by name or phone"
                                    className={inputClass}
                                />
                                {patientSearching ? <div className="text-xs text-slate-500">Searching…</div> : null}
                                {patientResults.length ? (
                                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                                        {patientResults.map((p) => (
                                            <li key={p.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => { setPatient({ id: p.id, full_name: p.full_name, phone: p.phone }); setPatientResults([]); setPatientQuery(''); }}
                                                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                                                >
                                                    <span className="font-medium text-slate-900">{p.full_name}</span>
                                                    <span className="text-xs text-slate-500">{p.phone || ''}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </>
                        )}

                        {patient && offerAppointments ? (
                            <div className="rounded-xl border border-slate-200 p-3">
                                <label className={labelClass}>Bill an appointment (last {APPOINTMENT_WINDOW_DAYS} days, optional)</label>
                                {appointmentId ? (
                                    <div className="flex items-center justify-between gap-2 text-sm text-slate-700">
                                        <span>Linked to appointment #{appointmentId}. Its fees were added as lines.</span>
                                        <button type="button" onClick={() => setAppointmentId(null)} disabled={Boolean(busy)} className="text-xs text-blue-700 hover:underline disabled:opacity-50">Unlink</button>
                                    </div>
                                ) : billable.loading ? (
                                    <div className="text-xs text-slate-500">Loading appointments…</div>
                                ) : billable.error ? (
                                    <Notice tone="error">{billable.error}</Notice>
                                ) : billable.items.length ? (
                                    <select
                                        value=""
                                        onChange={(e) => attachAppointment(e.target.value)}
                                        disabled={Boolean(busy)}
                                        className={inputClass}
                                    >
                                        <option value="">Choose an appointment to prefill from…</option>
                                        {billable.items.map((a) => (
                                            <option key={a.id} value={a.id}>
                                                {formatDate(a.appointment_date)}{a.doctor?.full_name ? ` · ${a.doctor.full_name}` : ''}{a.visit_type ? ` · ${a.visit_type}` : ''}{a.status ? ` · ${a.status.replace(/_/g, ' ')}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <p className="text-xs text-slate-500">No unbilled appointments for this patient in the last {APPOINTMENT_WINDOW_DAYS} days.</p>
                                )}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <div className="text-sm text-slate-700">
                        <span className="font-medium text-slate-900">{patient?.full_name || '—'}</span>
                        {patient?.phone ? <span className="text-slate-500"> · {patient.phone}</span> : null}
                        {appointmentId ? <div className="mt-1 text-xs text-slate-500">Linked to appointment #{appointmentId}</div> : null}
                    </div>
                )}
            </Card>

            <Card
                title="Items"
                right={editable ? <button type="button" onClick={addLine} className={btnOutline}><AppIcon name="plus" className="h-4 w-4" />Add line</button> : null}
            >
                {editable ? (
                    <div className="space-y-3">
                        <div className="grid gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 md:grid-cols-12">
                            <div className="md:col-span-4">
                                <label className={labelClass}>Doctor fee</label>
                                <select
                                    value={feeDoctor ? feePick.doctorId : ''}
                                    onChange={(e) => setFeePick((p) => ({ ...p, doctorId: e.target.value }))}
                                    disabled={!feeDoctors.length}
                                    className={inputClass}
                                >
                                    <option value="">{feeDoctors.length ? 'Choose a doctor' : 'No doctor has this fee set'}</option>
                                    {feeDoctors.map((d) => (
                                        <option key={d.id} value={d.id}>{d.full_name} — {formatRupees(d[feeType.lineKey].unit_amount)}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="md:col-span-4">
                                <label className={labelClass}>Visit type</label>
                                <select value={feePick.visitType} onChange={(e) => setFeePick((p) => ({ ...p, visitType: e.target.value }))} className={inputClass}>
                                    {FEE_VISIT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                            </div>
                            <div className="flex items-end md:col-span-4">
                                <button type="button" onClick={addDoctorFee} disabled={!feeDoctor} className={btnOutline}>
                                    <AppIcon name="plus" className="h-4 w-4" />Add doctor fee
                                </button>
                            </div>
                        </div>
                        {form.items.map((l) => (
                            <div key={l.key} className="grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-12">
                                <div className="md:col-span-3">
                                    <label className={labelClass}>Service</label>
                                    <select value={l.service_id ?? ''} onChange={(e) => pickService(l.key, e.target.value)} className={inputClass}>
                                        <option value="">Custom line</option>
                                        {services.map((s) => (
                                            <option key={s.id} value={s.id}>{s.name}{s.fee != null ? ` — ${formatRupees(s.fee)}` : ''}</option>
                                        ))}
                                        {l.service_id && !services.some((s) => s.id === l.service_id) ? <option value={l.service_id}>Service #{l.service_id}</option> : null}
                                    </select>
                                </div>
                                <div className="md:col-span-4">
                                    <label className={labelClass}>Description</label>
                                    <input value={l.description} maxLength={255} onChange={(e) => setLine(l.key, { description: e.target.value })} className={inputClass} />
                                </div>
                                <div className="md:col-span-1">
                                    <label className={labelClass}>Qty</label>
                                    <input type="number" min="1" step="1" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} className={inputClass} />
                                </div>
                                <div className="md:col-span-2">
                                    <label className={labelClass}>Price</label>
                                    <input type="number" min="0" step="0.01" value={l.unit_amount} onChange={(e) => setLine(l.key, { unit_amount: e.target.value })} className={inputClass} />
                                </div>
                                <div className="flex items-end justify-between gap-2 md:col-span-2">
                                    <div className="pb-2 text-sm font-medium text-slate-900">{formatRupees(lineAmount(l))}</div>
                                    <button
                                        type="button"
                                        onClick={() => removeLine(l.key)}
                                        disabled={form.items.length <= 1}
                                        className="mb-1 rounded-lg border border-red-100 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50">
                                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    <th className="px-3 py-2">Description</th>
                                    <th className="px-3 py-2 text-right">Qty</th>
                                    <th className="px-3 py-2 text-right">Price</th>
                                    <th className="px-3 py-2 text-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {(invoice?.items || []).map((i) => (
                                    <tr key={i.id}>
                                        <td className="px-3 py-2 text-slate-900">{i.description}</td>
                                        <td className="px-3 py-2 text-right text-slate-700">{i.quantity}</td>
                                        <td className="px-3 py-2 text-right text-slate-700">{formatRupees(i.unit_amount)}</td>
                                        <td className="px-3 py-2 text-right text-slate-900">{formatRupees(i.amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
                <Card title="Details">
                    <div className="space-y-3">
                        {editable ? (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className={labelClass}>Discount</label>
                                        <input type="number" min="0" step="0.01" value={form.discount} onChange={(e) => setForm((p) => ({ ...p, discount: e.target.value }))} className={inputClass} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Tax (override)</label>
                                        <input type="number" min="0" step="0.01" value={form.tax} onChange={(e) => setForm((p) => ({ ...p, tax: e.target.value }))} placeholder={invoice?.tax_is_manual ? undefined : 'Automatic'} className={inputClass} />
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500">
                                    {invoice?.tax_is_manual
                                        ? `Tax was set by hand (${formatRupees(invoice.tax_amount)}) and stays at that amount until you enter a different one; it cannot be switched back to automatic.`
                                        : `Leave tax blank to use the clinic's automatic tax${!isNew && Number(invoice?.tax_amount) > 0 ? ` (currently ${formatRupees(invoice.tax_amount)})` : ''}.`}
                                    {' '}Tax and the total are calculated when you save.
                                </p>
                                <div>
                                    <label className={labelClass}>Invoice date</label>
                                    <input type="date" value={form.invoiceDate} onChange={(e) => setForm((p) => ({ ...p, invoiceDate: e.target.value }))} className={inputClass} />
                                </div>
                                <div>
                                    <label className={labelClass}>Notes (internal)</label>
                                    <textarea rows={3} maxLength={2000} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={inputClass} />
                                </div>
                            </>
                        ) : (
                            <div className="text-sm text-slate-700">
                                <div className={labelClass}>Notes</div>
                                <div>{invoice?.notes || '—'}</div>
                                {invoice?.issued_at ? <div className="mt-3 text-xs text-slate-500">Issued {formatDateTime(invoice.issued_at)}</div> : null}
                            </div>
                        )}
                    </div>
                </Card>

                <Card title="Summary">
                    <dl className="space-y-2 text-sm">
                        {editable ? (
                            <>
                                <div className="flex justify-between"><dt className="text-slate-600">Subtotal (estimate)</dt><dd className="font-medium text-slate-900">{formatRupees(subtotalEstimate)}</dd></div>
                                {!isNew ? (
                                    <>
                                        <div className="flex justify-between"><dt className="text-slate-600">Saved total</dt><dd className="font-medium text-slate-900">{formatRupees(invoice.total_amount)}</dd></div>
                                    </>
                                ) : null}
                            </>
                        ) : (
                            <>
                                <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd className="text-slate-900">{formatRupees(invoice.subtotal)}</dd></div>
                                <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd className="text-slate-900">− {formatRupees(invoice.discount_amount)}</dd></div>
                                <div className="flex justify-between"><dt className="text-slate-600">Tax</dt><dd className="text-slate-900">{formatRupees(invoice.tax_amount)}</dd></div>
                                <div className="flex justify-between border-t border-slate-200 pt-2"><dt className="font-semibold text-slate-900">Total</dt><dd className="font-semibold text-slate-900">{formatRupees(invoice.total_amount)}</dd></div>
                                <div className="flex justify-between"><dt className="text-slate-600">Paid</dt><dd className="text-slate-900">{formatRupees(invoice.amount_paid)}</dd></div>
                                {status !== 'cancelled' ? (
                                    <div className="flex justify-between">
                                        <dt className={overpaid ? 'font-semibold text-rose-700' : 'font-semibold text-slate-900'}>{overpaid ? 'Balance (overpaid — refund due)' : 'Balance due'}</dt>
                                        <dd className={overpaid ? 'font-semibold text-rose-700' : 'font-semibold text-slate-900'}>{formatRupees(invoice.balance)}</dd>
                                    </div>
                                ) : null}
                            </>
                        )}
                    </dl>
                </Card>
            </div>

            {!isNew && status !== 'draft' ? (
                <Card title="Payments">
                    {mainPayments.length === 0 ? (
                        <p className="text-sm text-slate-600">No payments yet.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                                <thead className="bg-slate-50">
                                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        <th className="px-3 py-2">Date</th>
                                        <th className="px-3 py-2">Method</th>
                                        <th className="px-3 py-2">Reference</th>
                                        <th className="px-3 py-2 text-right">Amount</th>
                                        <th className="px-3 py-2">Status</th>
                                        {canEdit ? <th className="px-3 py-2 text-right">Actions</th> : null}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {mainPayments.map((p) => {
                                        const refunding = refundBox.paymentId === p.id;
                                        return (
                                            <React.Fragment key={p.id}>
                                                <tr className="align-top">
                                                    <td className="px-3 py-2 text-slate-700">{formatDateTime(p.paid_at) || '—'}</td>
                                                    <td className="px-3 py-2 text-slate-700">{METHOD_LABELS[p.payment_method] || p.payment_method}</td>
                                                    <td className="px-3 py-2 text-slate-700">{p.reference_number || '—'}</td>
                                                    <td className="px-3 py-2 text-right text-slate-900">{formatRupees(p.amount)}</td>
                                                    <td className="px-3 py-2">
                                                        <StatusBadge status={p.display_status} />
                                                        {p.status === 'refunded' && p.refund_reason ? <div className="mt-1 text-xs text-slate-500">{p.refund_reason}</div> : null}
                                                    </td>
                                                    {canEdit ? (
                                                        <td className="px-3 py-2 text-right">
                                                            {p.status === 'success' && !refunding ? (
                                                                <button
                                                                    type="button"
                                                                    disabled={Boolean(busy)}
                                                                    onClick={() => setRefundBox({ paymentId: p.id, reason: '' })}
                                                                    className="rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                                                                >
                                                                    Refund
                                                                </button>
                                                            ) : null}
                                                        </td>
                                                    ) : null}
                                                </tr>
                                                {refunding ? (
                                                    <tr>
                                                        <td colSpan={canEdit ? 6 : 5} className="px-3 py-3">
                                                            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                                                                <label className={labelClass}>Refund reason</label>
                                                                <input
                                                                    value={refundBox.reason}
                                                                    maxLength={500}
                                                                    onChange={(e) => setRefundBox((r) => ({ ...r, reason: e.target.value }))}
                                                                    className={inputClass}
                                                                />
                                                                <p className="mt-1 text-xs text-slate-600">This marks the payment refunded in the system. Return the money to the patient yourself.</p>
                                                                <div className="mt-3 flex flex-wrap gap-2">
                                                                    <button type="button" onClick={refundPayment} disabled={Boolean(busy)} className={btnDanger}>
                                                                        {busy === 'refund' ? 'Refunding…' : `Refund ${formatRupees(p.amount)}`}
                                                                    </button>
                                                                    <button type="button" onClick={() => setRefundBox({ paymentId: null, reason: '' })} disabled={Boolean(busy)} className={btnOutline}>Keep payment</button>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ) : null}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {supersededPayments.length ? (
                        <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {supersededPayments.length} abandoned checkout {supersededPayments.length === 1 ? 'attempt' : 'attempts'} (no money taken)
                            </summary>
                            <ul className="mt-2 space-y-1">
                                {supersededPayments.map((p) => (
                                    <li key={p.id} className="flex items-center justify-between gap-3">
                                        <span>{formatRupees(p.amount)} · {METHOD_LABELS[p.payment_method] || p.payment_method}{p.reference_number ? ` · ${p.reference_number}` : ''}</span>
                                        <StatusBadge status="superseded" />
                                    </li>
                                ))}
                            </ul>
                        </details>
                    ) : null}
                </Card>
            ) : null}
        </div>
    );
}
