import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import StatusBadge from '../../components/StatusBadge';
import ClinicStatusBadge from '../../components/billing/ClinicStatusBadge.jsx';
import SubscriptionCard from '../../components/billing/SubscriptionCard.jsx';
import { useAssignableRoles } from '../../hooks/useAssignableRoles';
import { formatDate } from '../../utils/dateFormat';

const TABS = [
    { key: 'overview',  label: 'Overview',       icon: 'dashboard' },
    { key: 'doctors',   label: 'Doctors',         icon: 'stethoscope' },
    { key: 'services',  label: 'Services',        icon: 'clipboard-check' },
    { key: 'staff',     label: 'Staff Users',     icon: 'users' },
    { key: 'settings',  label: 'Clinic Settings', icon: 'settings' },
];

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function Card({ children, className = '' }) {
    return <div className={`rounded-xl border border-gray-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

function InfoRow({ label, value }) {
    if (value == null || value === '') return null;
    return (
        <div className="flex items-start gap-4 border-b border-gray-100 py-2.5 last:border-0">
            <span className="w-44 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
            <span className="text-sm text-gray-800">{value}</span>
        </div>
    );
}

function SectionHeader({ title, subtitle, action }) {
    return (
        <div className="flex items-center justify-between gap-4 pb-4">
            <div>
                <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
            </div>
            {action}
        </div>
    );
}

function EmptyState({ icon, text }) {
    return (
        <div className="flex flex-col items-center justify-center py-14 text-center">
            <AppIcon name={icon} className="mb-3 h-8 w-8 text-gray-200" />
            <p className="text-sm text-gray-400">{text}</p>
        </div>
    );
}

function LoadingState() {
    return (
        <div className="flex items-center justify-center py-14">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
    );
}

// ── Services Tab ─────────────────────────────────────────────────────────────

function ServicesTab({ clinicId }) {
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [sheet, setSheet] = useState({ open: false, mode: 'clinic', service: null });
    const [form, setForm] = useState({ name: '', code: '', description: '', duration_minutes: '', fee: '', status: 'active' });
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const svcRes = await client.get('/super-admin/services', { params: { clinic_id: clinicId, per_page: 200 } });
            setServices(Array.isArray(svcRes.data?.data) ? svcRes.data.data : []);
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to load services');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [clinicId]);

    const openAdd = () => {
        setSaveError('');
        setForm({ name: '', code: '', description: '', duration_minutes: '', fee: '' });
        setSheet({ open: true, mode: 'add', service: null });
    };

    const openEdit = (service) => {
        setSaveError('');
        setForm({
            name: service?.name || '',
            code: service?.code || '',
            description: service?.description || '',
            duration_minutes: service?.duration_minutes ?? '',
            fee: service?.fee ?? '',
            status: service?.status || 'active',
        });
        setSheet({ open: true, mode: 'edit', service });
    };

    const save = async (e) => {
        e.preventDefault();
        setSaving(true);
        setSaveError('');

        try {
            const payload = {
                clinic_id: clinicId,
                name: String(form.name || '').trim(),
                code: String(form.code || '').trim() || null,
                description: String(form.description || '').trim() || null,
                duration_minutes: form.duration_minutes === '' ? null : Number(form.duration_minutes),
                fee: form.fee === '' ? null : Number(form.fee),
                status: 'active',
            };

            if (!payload.name) {
                setSaveError('Service name is required.');
                return;
            }

            if (sheet.service?.id) {
                await client.put(`/super-admin/services/${sheet.service.id}`, payload);
            } else {
                await client.post('/super-admin/services', payload);
            }

            await load();
            setSheet({ open: false, mode: 'add', service: null });
        } catch (e) {
            setSaveError(e?.response?.data?.message || 'Failed to save service');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <LoadingState />;
    if (error) return <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>;

    return (
        <>
            <SectionHeader
                title="Services"
                subtitle="Create services for this clinic."
                action={
                    <Btn variant="primary" onClick={openAdd}>
                        <AppIcon name="plus" className="h-3.5 w-3.5" /> Add Service
                    </Btn>
                }
            />

            {!services.length ? (
                <EmptyState icon="clipboard-check" text="No services yet." />
            ) : (
                <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    {services.map((svc) => {
                        return (
                            <div key={svc.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-gray-900">{svc.name}</p>
                                    <p className="mt-0.5 text-xs text-gray-500">
                                        {svc.code ? `${svc.code} · ` : ''}
                                        {svc.duration_minutes ? `${svc.duration_minutes} min · ` : ''}
                                        {svc.fee != null && svc.fee !== '' ? `₹${svc.fee}` : ''}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Btn onClick={() => openEdit(svc)}>Edit</Btn>
                                    <DeleteBtn endpoint={`/super-admin/services/${svc.id}`} onDeleted={load} label="service" />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <Sheet
                open={sheet.open}
                title={sheet.mode === 'edit' ? `Edit Service — ${sheet.service?.name}` : 'Add Service'}
                subtitle="Configure the service details."
                onClose={() => setSheet({ open: false, mode: 'add', service: null })}
                footer={
                    <div className="flex items-center justify-between gap-3">
                        {saveError && <p className="text-sm text-red-600">{saveError}</p>}
                        <div className="ml-auto flex gap-2">
                            <Btn onClick={() => setSheet({ open: false, mode: 'add', service: null })} disabled={saving}>Cancel</Btn>
                            <Btn variant="primary" type="submit" disabled={saving} className="min-w-[110px]">
                                {saving ? 'Saving…' : 'Save'}
                            </Btn>
                        </div>
                    </div>
                }
            >
                <form onSubmit={save} className="space-y-4">
                    <Field label="Service Name" required>
                        <TextInput value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} placeholder="Consultation" />
                    </Field>

                    <Field label="Code">
                        <TextInput value={form.code} onChange={(v) => setForm((p) => ({ ...p, code: v }))} placeholder="CONS" />
                    </Field>

                    <Field label="Description">
                        <TextInput value={form.description} onChange={(v) => setForm((p) => ({ ...p, description: v }))} placeholder="" />
                    </Field>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Duration (minutes)">
                            <TextInput type="number" value={form.duration_minutes} onChange={(v) => setForm((p) => ({ ...p, duration_minutes: v }))} placeholder="15" />
                        </Field>
                        <Field label="Fee">
                            <TextInput type="number" value={form.fee} onChange={(v) => setForm((p) => ({ ...p, fee: v }))} placeholder="500" />
                        </Field>
                    </div>
                </form>
            </Sheet>
        </>
    );
}

function DeleteBtn({ endpoint, onDeleted, label = 'item' }) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);

    if (!confirming) {
        return (
            <button
                type="button"
                onClick={() => setConfirming(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
            >
                <AppIcon name="trash" className="h-3.5 w-3.5" />
                Delete
            </button>
        );
    }

    return (
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5">
            <span className="text-xs font-semibold text-red-700">Delete {label}?</span>
            <button
                type="button"
                disabled={busy}
                onClick={async () => {
                    setBusy(true);
                    try {
                        await client.delete(endpoint);
                        setConfirming(false);
                        onDeleted();
                    } catch {
                        setConfirming(false);
                    } finally {
                        setBusy(false);
                    }
                }}
                className="rounded px-1.5 py-0.5 text-xs font-bold text-red-700 hover:bg-red-200 disabled:opacity-50"
            >
                {busy ? '…' : 'Yes'}
            </button>
            <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded px-1.5 py-0.5 text-xs font-semibold text-gray-600 hover:bg-gray-200"
            >
                No
            </button>
        </div>
    );
}

function Btn({ onClick, children, variant = 'secondary', disabled, type = 'button', className = '' }) {
    const base = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50';
    const styles = {
        primary: 'bg-blue-600 text-white hover:bg-blue-700',
        secondary: 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
        danger: 'bg-red-600 text-white hover:bg-red-700',
        ghost: 'text-blue-600 hover:underline text-xs font-medium',
    };
    return (
        <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]} ${className}`}>
            {children}
        </button>
    );
}

// ── Inline Modal Sheet ────────────────────────────────────────────────────────

function Sheet({ open, title, subtitle, onClose, children, footer }) {
    const overlayRef = useRef(null);
    useEffect(() => {
        if (!open) return;
        const handler = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-end" aria-modal="true" role="dialog">
            <div
                ref={overlayRef}
                className="absolute inset-0 bg-black/30 backdrop-blur-sm"
                onClick={onClose}
            />
            <div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                        {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                    >
                        <AppIcon name="close" className="h-4 w-4" />
                    </button>
                </div>
                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
                {/* Footer */}
                {footer && <div className="border-t border-gray-200 px-6 py-4">{footer}</div>}
            </div>
        </div>
    );
}

// ── Small form helpers ────────────────────────────────────────────────────────

function Field({ label, required, error, hint, children }) {
    return (
        <div>
            <label className="mb-1 block text-xs font-semibold text-gray-700">
                {label}{required && <span className="ml-0.5 text-red-500">*</span>}
            </label>
            {children}
            {hint && !error && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
    );
}

function TextInput({ value, onChange, placeholder, type = 'text', disabled = false, readOnly = false }) {
    return (
        <input
            type={type}
            value={value || ''}
            disabled={disabled}
            readOnly={readOnly}
            onChange={(e) => (onChange ? onChange(e.target.value) : undefined)}
            placeholder={placeholder}
            className={`w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${disabled ? 'bg-gray-50 text-gray-500' : ''}`}
        />
    );
}

function SelectInput({ value, onChange, options, disabled = false }) {
    return (
        <select
            value={value || ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={`w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${disabled ? 'bg-gray-50 text-gray-500' : ''}`}
        >
            {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
            ))}
        </select>
    );
}

function DoctorMultiSelect({ options, value, onChange, loading, error }) {
    const selected = Array.isArray(value) ? value.map(String) : [];
    const toggle = (id) => {
        const idStr = String(id);
        const next = selected.includes(idStr) ? selected.filter((v) => v !== idStr) : [...selected, idStr];
        onChange(next);
    };

    if (loading) return <p className="text-sm text-gray-400">Loading doctors…</p>;
    if (error) return <p className="text-sm text-red-600">{error}</p>;
    if (!options.length) return <p className="text-sm text-gray-400">No doctors yet.</p>;

    return (
        <div className="max-h-48 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200">
            {options.map((doc) => {
                const checked = selected.includes(String(doc.id));
                const name = [doc.title, doc.full_name].filter(Boolean).join(' ').trim() || `Doctor #${doc.id}`;
                return (
                    <label
                        key={doc.id}
                        className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors ${checked ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                    >
                        <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(doc.id)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-gray-800">{name}</span>
                    </label>
                );
            })}
        </div>
    );
}

function Toggle({ checked, onChange, label }) {
    return (
        <label className="flex cursor-pointer items-center gap-3">
            <div className="relative">
                <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
                <div className={`flex h-5 w-9 items-center rounded-full transition-colors ${Boolean(checked) ? 'bg-blue-600' : 'bg-gray-200'}`}>
                    <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${Boolean(checked) ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
            </div>
            <span className="text-sm text-gray-700">{label}</span>
        </label>
    );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function yesNo(value) {
    if (value == null) return null;
    return value ? 'Yes' : 'No';
}

function ColorValue({ color }) {
    return (
        <span className="inline-flex items-center gap-2">
            <span className="h-4 w-4 rounded border border-gray-200" style={{ backgroundColor: color }} />
            <span className="font-mono text-xs">{color}</span>
        </span>
    );
}

function OverviewTab({ clinic, clinicId, onEditClinic, onSubscriptionLoaded }) {
    const [overview, setOverview] = useState(null);
    const [error, setError] = useState('');

    const loadOverview = () => {
        setError('');
        return client.get(`/super-admin/clinics/${clinicId}/overview`)
            .then((res) => {
                const data = res.data?.data || null;
                setOverview(data);
                onSubscriptionLoaded?.(data?.subscription || null);
            })
            .catch((e) => setError(e?.response?.data?.message || 'Could not load clinic overview.'));
    };

    // Refetch whenever the clinic record changes (e.g. after the Edit sheet saves).
    useEffect(() => { loadOverview(); }, [clinicId, clinic?.updated_at]);

    if (error) return <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>;
    if (!overview) return <LoadingState />;

    const c = overview.clinic || {};
    const s = overview.settings || {};
    const admins = overview.admins || [];
    const counts = overview.counts || {};
    const address = [c.address_line_1, c.address_line_2, c.city, c.state, c.pincode].filter(Boolean).join(', ');

    return (
        <div className="space-y-5">
            <SubscriptionCard clinicId={clinicId} subscription={overview.subscription} onChanged={loadOverview} />

            <div className="grid gap-3 sm:grid-cols-3">
                {[['Doctors', counts.doctors], ['Staff users', counts.staff], ['Services', counts.services]].map(([label, value]) => (
                    <Card key={label} className="px-5 py-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
                        <p className="mt-1 text-2xl font-bold text-gray-900 tabular-nums">{value ?? 0}</p>
                    </Card>
                ))}
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
                <Card className="p-5">
                    <SectionHeader
                        title="Clinic"
                        action={<Btn onClick={onEditClinic}><AppIcon name="edit" className="h-3.5 w-3.5" /> Edit</Btn>}
                    />
                    {c.logo_url && (
                        <div className="mb-3">
                            <img src={c.logo_url} alt={`${c.name} logo`} className="h-14 w-14 rounded-lg border border-gray-200 object-contain" />
                        </div>
                    )}
                    <InfoRow label="Name" value={c.name} />
                    <InfoRow label="Legal name" value={c.legal_name} />
                    <InfoRow label="Slug" value={c.slug} />
                    <InfoRow label="Status" value={c.status && <StatusBadge status={c.status} />} />
                    <InfoRow label="Primary colour" value={c.primary_color && <ColorValue color={c.primary_color} />} />
                    <InfoRow label="Secondary colour" value={c.secondary_color && <ColorValue color={c.secondary_color} />} />
                    <InfoRow label="Created" value={formatDate(c.created_at)} />
                    <InfoRow label="Notes" value={c.notes} />
                </Card>

                <div className="space-y-5">
                    <Card className="p-5">
                        <SectionHeader title="Owner" />
                        <InfoRow label="Name" value={c.owner_name} />
                        <InfoRow label="Email" value={c.owner_email} />
                        <InfoRow label="Phone" value={c.owner_phone} />
                        {!c.owner_name && !c.owner_email && !c.owner_phone && <p className="text-sm text-gray-400">No owner details recorded.</p>}
                    </Card>

                    <Card className="p-5">
                        <SectionHeader title="Address and contact" />
                        <InfoRow label="Address" value={address} />
                        <InfoRow label="Phone" value={c.phone} />
                        <InfoRow label="Email" value={c.email} />
                        {!address && !c.phone && !c.email && <p className="text-sm text-gray-400">No address or contact recorded.</p>}
                    </Card>
                </div>

                <Card className="p-5">
                    <SectionHeader title="Booking settings" />
                    {overview.settings ? (
                        <>
                            <InfoRow label="Online booking" value={yesNo(s.booking_enabled)} />
                            <InfoRow label="WhatsApp booking" value={yesNo(s.whatsapp_booking_enabled)} />
                            <InfoRow label="Walk-in" value={yesNo(s.walkin_enabled)} />
                            <InfoRow label="Token system" value={yesNo(s.token_system_enabled)} />
                            <InfoRow label="Auto-confirm" value={yesNo(s.auto_confirm_appointments)} />
                            <InfoRow label="Max advance booking" value={s.max_advance_booking_days != null && `${s.max_advance_booking_days} days`} />
                            <InfoRow label="Min booking notice" value={s.min_booking_notice_minutes != null && `${s.min_booking_notice_minutes} minutes`} />
                        </>
                    ) : (
                        <p className="text-sm text-gray-400">No booking settings saved yet.</p>
                    )}
                </Card>

                <Card className="p-5">
                    <SectionHeader title="Clinic admins" subtitle="Logins created for this clinic's administrators." />
                    {admins.length === 0 ? (
                        <p className="text-sm text-gray-400">No clinic admin yet. Add one from Staff Users.</p>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {admins.map((a) => (
                                <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                                    <div>
                                        <p className="text-sm font-medium text-gray-900">{a.full_name}</p>
                                        <p className="text-xs text-gray-500">{[a.email, a.phone].filter(Boolean).join(' · ')}</p>
                                    </div>
                                    {a.status && <StatusBadge status={a.status} />}
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>
        </div>
    );
}

// ── Doctors Tab ───────────────────────────────────────────────────────────────

function DoctorsTab({ clinicId }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [sheet, setSheet] = useState({ open: false, doctor: null });
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [photoFile, setPhotoFile] = useState(null);
    const [photoPreview, setPhotoPreview] = useState('');
    const photoInputRef = useRef(null);

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const docRes = await client.get('/super-admin/doctors', { params: { clinic_id: clinicId, per_page: 100 } });
            setItems(Array.isArray(docRes.data?.data) ? docRes.data.data : []);
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to load');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [clinicId]);

    const openAdd = () => {
        setForm({
            clinic_id: clinicId,
            title: 'Dr.',
            full_name: '',
            specialization: '',
            qualification: '',
            experience_years: '',
            gender: '',
            phone: '',
            email: '',
            photo_url: '',
            password: '',
            consultation_fee: '',
            followup_fee: '',
            slot_duration_minutes: '15',
            buffer_time_minutes: '5',
        });
        setPhotoFile(null);
        setPhotoPreview('');
        setSaveError('');
        setSheet({ open: true, doctor: null });
    };

    const openEdit = (doctor) => {
        setForm({ ...doctor, password: '' });
        setPhotoFile(null);
        setPhotoPreview(doctor.photo_url || '');
        setSaveError('');
        setSheet({ open: true, doctor });
    };

    const closeSheet = () => {
        setSheet({ open: false, doctor: null });
        setPhotoFile(null);
        setPhotoPreview('');
    };

    const handlePhotoChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPhotoFile(file);
        setPhotoPreview(URL.createObjectURL(file));
    };
    const f = (key) => ({ value: form[key], onChange: (v) => setForm((p) => ({ ...p, [key]: v })) });

    const handleSave = async () => {
        setSaving(true);
        setSaveError('');
        try {
            let photoUrl = form.photo_url || '';
            if (photoFile) {
                const fd = new FormData();
                fd.append('file', photoFile);
                fd.append('module', 'doctors');
                fd.append('clinic_id', String(clinicId));
                const upRes = await client.post('/super-admin/uploads/image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                photoUrl = upRes.data?.data?.url || photoUrl;
            }
            const payload = {
                ...form,
                photo_url: photoUrl || undefined,
                clinic_id: Number(form.clinic_id),
                experience_years: form.experience_years === '' ? null : Number(form.experience_years),
                consultation_fee: form.consultation_fee === '' ? null : Number(form.consultation_fee),
                followup_fee: form.followup_fee === '' ? null : Number(form.followup_fee),
                slot_duration_minutes: form.slot_duration_minutes === '' ? null : Number(form.slot_duration_minutes),
                buffer_time_minutes: form.buffer_time_minutes === '' ? null : Number(form.buffer_time_minutes),
            };
            // Only send password if the user explicitly entered one (blank = keep existing)
            if (!payload.password) delete payload.password;
            if (sheet.doctor) {
                await client.put(`/super-admin/doctors/${sheet.doctor.id}`, payload);
            } else {
                await client.post('/super-admin/doctors', payload);
            }
            closeSheet();
            load();
        } catch (e) {
            setSaveError(e?.response?.data?.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <LoadingState />;
    if (error) return <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>;

    return (
        <>
            <SectionHeader
                title="Doctors"
                subtitle="Doctors registered under this clinic."
                action={
                    <Btn variant="primary" onClick={openAdd}>
                        <AppIcon name="plus" className="h-3.5 w-3.5" /> Add Doctor
                    </Btn>
                }
            />

            {!items.length ? <EmptyState icon="stethoscope" text="No doctors yet." /> : (
                <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    {items.map((doc) => (
                        <div key={doc.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
                            <div className="flex items-center gap-3">
                                {doc.photo_url
                                    ? <img src={doc.photo_url} alt="" className="h-9 w-9 rounded-full object-cover border border-gray-200" />
                                    : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600 text-sm font-bold">{(doc.full_name || '?')[0]}</div>
                                }
                                <div>
                                    <p className="text-sm font-semibold text-gray-900">{doc.full_name}</p>
                                    <p className="text-xs text-gray-500">{[doc.specialization, doc.qualification].filter(Boolean).join(' · ')}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <StatusBadge status={doc.status} />
                                <Btn onClick={() => openEdit(doc)}>
                                    <AppIcon name="edit" className="h-3.5 w-3.5" /> Edit
                                </Btn>
                                <Link
                                    to={`/modules/doctors/${doc.id}`}
                                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    View
                                </Link>
                                <DeleteBtn endpoint={`/super-admin/doctors/${doc.id}`} onDeleted={load} label="doctor" />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Sheet
                open={sheet.open}
                title={sheet.doctor ? `Edit Doctor — ${sheet.doctor.full_name}` : 'Add Doctor'}
                subtitle="Doctor profile and clinic assignment."
                onClose={closeSheet}
                footer={
                    <div className="flex items-center justify-between gap-3">
                        {saveError && <p className="text-sm text-red-600">{saveError}</p>}
                        <div className="ml-auto flex gap-2">
                            <Btn onClick={closeSheet} disabled={saving}>Cancel</Btn>
                            <Btn variant="primary" onClick={handleSave} disabled={saving}>
                                {saving ? 'Saving…' : 'Save'}
                            </Btn>
                        </div>
                    </div>
                }
            >
                <div className="space-y-4">
                    {/* Photo upload */}
                    <Field label="Profile Photo">
                        <div className="flex items-center gap-4">
                            <div
                                className="relative h-24 w-20 flex-shrink-0 cursor-pointer overflow-hidden rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 hover:border-blue-400"
                                onClick={() => photoInputRef.current?.click()}
                            >
                                {photoPreview ? (
                                    <img src={photoPreview} alt="preview" className="h-full w-full object-cover" />
                                ) : (
                                    <div className="flex h-full w-full flex-col items-center justify-center gap-1">
                                        <AppIcon name="plus" className="h-5 w-5 text-gray-400" />
                                        <span className="text-xs text-gray-400">Photo</span>
                                    </div>
                                )}
                            </div>
                            <div className="text-xs text-gray-500">
                                <p>Click to upload a portrait photo.</p>
                                <p className="mt-1">JPG, PNG or WebP · max 2 MB</p>
                                {photoPreview && (
                                    <button
                                        type="button"
                                        className="mt-2 text-red-500 hover:underline"
                                        onClick={() => { setPhotoFile(null); setPhotoPreview(''); setForm((p) => ({ ...p, photo_url: '' })); }}
                                    >
                                        Remove photo
                                    </button>
                                )}
                            </div>
                        </div>
                        <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoChange} />
                    </Field>
                    <div className="grid grid-cols-4 gap-3">
                        <Field label="Title">
                            <SelectInput {...f('title')} options={[
                                { value: 'Dr.', label: 'Dr.' },
                                { value: 'Prof.', label: 'Prof.' },
                                { value: 'Mr.', label: 'Mr.' },
                                { value: 'Ms.', label: 'Ms.' },
                            ]} />
                        </Field>
                        <div className="col-span-3">
                            <Field label="Full Name" required>
                                <TextInput {...f('full_name')} placeholder="Doctor's full name" />
                            </Field>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Specialization">
                            <TextInput {...f('specialization')} placeholder="e.g. Cardiologist" />
                        </Field>
                        <Field label="Qualification">
                            <TextInput {...f('qualification')} placeholder="e.g. MBBS, MD" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Experience (Years)">
                            <TextInput type="number" {...f('experience_years')} placeholder="0" />
                        </Field>
                        <Field label="Gender">
                            <SelectInput {...f('gender')} options={[
                                { value: '', label: 'Select…' },
                                { value: 'male', label: 'Male' },
                                { value: 'female', label: 'Female' },
                                { value: 'other', label: 'Other' },
                            ]} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Phone">
                            <TextInput {...f('phone')} placeholder="+91 XXXXXXXXXX" />
                        </Field>
                        <Field label="Email">
                            <TextInput type="email" {...f('email')} placeholder="doctor@clinic.com" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Consultation Fee (₹)">
                            <TextInput type="number" {...f('consultation_fee')} placeholder="500" />
                        </Field>
                        <Field label="Follow-up Fee (₹)">
                            <TextInput type="number" {...f('followup_fee')} placeholder="300" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Slot Duration (min)">
                            <TextInput type="number" {...f('slot_duration_minutes')} placeholder="15" />
                        </Field>
                        <Field label="Buffer Time (min)">
                            <TextInput type="number" {...f('buffer_time_minutes')} placeholder="5" />
                        </Field>
                    </div>
                    <Field
                        label="Password (Login)"
                        hint={sheet.doctor ? 'Leave blank to keep the existing password.' : 'Set a password so the doctor can log in to the portal.'}
                    >
                        <TextInput type="password" {...f('password')} placeholder="••••••••" />
                    </Field>
                </div>
            </Sheet>
        </>
    );
}

// ── Staff Tab ─────────────────────────────────────────────────────────────────

function StaffTab({ clinicId }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [sheet, setSheet] = useState({ open: false, user: null });
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    // Roles assignable to a clinic's staff from this super admin screen:
    // staff/clinic_admin kinds only (never doctor or the hidden super_admin
    // role — spec §4/§5, `useAssignableRoles` already filters to those kinds
    // for the `/super-admin` base).
    const { roles } = useAssignableRoles('/super-admin');
    const roleOptions = useMemo(() => roles.map((r) => ({ value: r.name, label: r.label })), [roles]);
    const currentRoleMeta = useMemo(() => roles.find((r) => r.name === form.role) || null, [roles, form.role]);

    const [doctorOptions, setDoctorOptions] = useState({ loading: true, error: '', items: [] });

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const usrRes = await client.get('/super-admin/users', { params: { clinic_id: clinicId, per_page: 100 } });
            setItems(Array.isArray(usrRes.data?.data) ? usrRes.data.data : []);
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to load');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [clinicId]);

    useEffect(() => {
        let cancelled = false;
        setDoctorOptions((p) => ({ ...p, loading: true, error: '' }));
        client.get('/super-admin/doctors', { params: { clinic_id: clinicId, per_page: 200 } })
            .then((res) => {
                if (cancelled) return;
                setDoctorOptions({ loading: false, error: '', items: Array.isArray(res.data?.data) ? res.data.data : [] });
            })
            .catch((e) => {
                if (cancelled) return;
                setDoctorOptions({ loading: false, error: e?.response?.data?.message || 'Failed to load doctors', items: [] });
            });
        return () => { cancelled = true; };
    }, [clinicId]);

    const openAdd = () => {
        const fallback = roles.find((r) => r.name === 'receptionist') || roles[0];
        setForm({ clinic_id: clinicId, full_name: '', email: '', phone: '', password: '', role: fallback?.name || '', doctor_ids: [] });
        setSaveError('');
        setSheet({ open: true, user: null });
    };

    const openEdit = async (user) => {
        setSaveError('');
        setForm({ ...user, password: '', doctor_ids: [] });
        setSheet({ open: true, user });
        try {
            // The list row doesn't carry doctor_ids; fetch the full record so an
            // existing assignment isn't blanked out by an unseen empty picker.
            const { data } = await client.get(`/super-admin/users/${user.id}`);
            setForm({ ...data.data, password: '' });
        } catch {
            // Keep the list row's fields; doctor_ids stays empty if this fails.
        }
    };

    const closeSheet = () => setSheet({ open: false, user: null });
    const f = (key) => ({ value: form[key], onChange: (v) => setForm((p) => ({ ...p, [key]: v })) });

    const handleSave = async () => {
        setSaving(true);
        setSaveError('');
        try {
            const payload = { ...form };
            if (!payload.password) delete payload.password;
            if (!currentRoleMeta?.limit_to_assigned_doctors) delete payload.doctor_ids;
            if (sheet.user) {
                await client.put(`/super-admin/users/${sheet.user.id}`, payload);
            } else {
                await client.post('/super-admin/users', payload);
            }
            closeSheet();
            load();
        } catch (e) {
            setSaveError(e?.response?.data?.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <LoadingState />;
    if (error) return <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>;

    const roleLabel = (r) => String(r || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    return (
        <>
            <SectionHeader
                title="Staff Users"
                subtitle="All staff with access to this clinic."
                action={
                    <Btn variant="primary" onClick={openAdd}>
                        <AppIcon name="plus" className="h-3.5 w-3.5" /> Add Staff
                    </Btn>
                }
            />

            {!items.length ? <EmptyState icon="users" text="No staff users yet." /> : (
                <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    {items.map((user) => (
                        <div key={user.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
                            <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600 text-sm font-bold">
                                    {(user.full_name || user.email || '?')[0].toUpperCase()}
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-gray-900">{user.full_name}</p>
                                    <p className="text-xs text-gray-500">{user.email} · {roleLabel(user.role)}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <StatusBadge status={user.status} />
                                <Btn onClick={() => openEdit(user)}>
                                    <AppIcon name="edit" className="h-3.5 w-3.5" /> Edit
                                </Btn>
                                <DeleteBtn endpoint={`/super-admin/users/${user.id}`} onDeleted={load} label="staff user" />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Sheet
                open={sheet.open}
                title={sheet.user ? `Edit Staff — ${sheet.user.full_name}` : 'Add Staff User'}
                subtitle="Create login credentials and assign a role."
                onClose={closeSheet}
                footer={
                    <div className="flex items-center justify-between gap-3">
                        {saveError && <p className="text-sm text-red-600">{saveError}</p>}
                        <div className="ml-auto flex gap-2">
                            <Btn onClick={closeSheet} disabled={saving}>Cancel</Btn>
                            <Btn variant="primary" onClick={handleSave} disabled={saving}>
                                {saving ? 'Saving…' : 'Save'}
                            </Btn>
                        </div>
                    </div>
                }
            >
                <div className="space-y-4">
                    <Field label="Full Name" required>
                        <TextInput {...f('full_name')} placeholder="Staff Member Name" />
                    </Field>
                    <Field label="Email">
                        <TextInput type="email" {...f('email')} placeholder="staff@clinic.com" />
                    </Field>
                    <Field label="Phone">
                        <TextInput {...f('phone')} placeholder="+91 XXXXXXXXXX" />
                    </Field>
                    <Field label={sheet.user ? 'New Password (leave blank to keep)' : 'Password'} required={!sheet.user}>
                        <TextInput type="password" {...f('password')} placeholder="••••••••" />
                    </Field>
                    <Field label="Role" required>
                        <SelectInput {...f('role')} options={roleOptions} />
                    </Field>
                    {currentRoleMeta?.limit_to_assigned_doctors ? (
                        <Field label="Assigned Doctors" hint="Only see these doctors' patients and appointments.">
                            <DoctorMultiSelect
                                options={doctorOptions.items}
                                loading={doctorOptions.loading}
                                error={doctorOptions.error}
                                value={form.doctor_ids}
                                onChange={(next) => setForm((p) => ({ ...p, doctor_ids: next }))}
                            />
                        </Field>
                    ) : null}
                </div>
            </Sheet>
        </>
    );
}

// ── Clinic Settings Tab ───────────────────────────────────────────────────────

function SettingsTab({ clinicId }) {
    const [setting, setSetting] = useState(null);
    const [form, setForm] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        let cancelled = false;
        client.get('/super-admin/settings/clinic', { params: { clinic_id: clinicId, per_page: 1 } })
            .then((res) => {
                const item = Array.isArray(res.data?.data) ? res.data.data[0] : null;
                if (!cancelled) { setSetting(item); setForm(item || {}); }
            })
            .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || 'Failed to load'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [clinicId]);

    const save = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            if (setting?.id) {
                await client.put(`/super-admin/settings/clinic/${setting.id}`, form);
            } else {
                await client.post('/super-admin/settings/clinic', { ...form, clinic_id: clinicId });
            }
            setSuccess('Settings saved successfully.');
            setTimeout(() => setSuccess(''), 3000);
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <LoadingState />;

    const toggle = (key) => setForm((p) => ({ ...p, [key]: !p[key] }));

    return (
        <div className="max-w-xl space-y-5">
            {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
            {success && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{success}</p>}

            <form onSubmit={save} className="space-y-5">
                <Card className="p-5">
                    <h3 className="mb-4 text-sm font-semibold text-gray-900">Booking Controls</h3>
                    <div className="space-y-3">
                        {[
                            { key: 'booking_enabled', label: 'Online booking enabled' },
                            { key: 'whatsapp_booking_enabled', label: 'WhatsApp booking enabled' },
                            { key: 'walkin_enabled', label: 'Walk-in appointments' },
                            { key: 'token_system_enabled', label: 'Token system' },
                            { key: 'auto_confirm_appointments', label: 'Auto-confirm appointments' },
                            { key: 'allow_reschedule', label: 'Allow patient rescheduling' },
                            { key: 'allow_cancel', label: 'Allow patient cancellation' },
                        ].map(({ key, label }) => (
                            <Toggle key={key} checked={Boolean(form[key])} onChange={() => toggle(key)} label={label} />
                        ))}
                    </div>
                </Card>

                <Card className="p-5">
                    <h3 className="mb-4 text-sm font-semibold text-gray-900">Cutoff</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-gray-700">Reschedule Cutoff (hours before appointment)</label>
                            <input
                                type="number"
                                min={0}
                                max={8760}
                                value={form.reschedule_cutoff_hours ?? ''}
                                onChange={(e) => setForm((p) => ({ ...p, reschedule_cutoff_hours: e.target.value }))}
                                className="w-32 rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-gray-700">Cancel Cutoff (hours before appointment)</label>
                            <input
                                type="number"
                                min={0}
                                max={8760}
                                value={form.cancel_cutoff_hours ?? ''}
                                onChange={(e) => setForm((p) => ({ ...p, cancel_cutoff_hours: e.target.value }))}
                                className="w-32 rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                    </div>
                </Card>

                <Card className="p-5">
                    <h3 className="mb-4 text-sm font-semibold text-gray-900">Booking Window</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Max advance booking (days)">
                            <TextInput
                                type="number"
                                value={form.max_advance_booking_days ?? ''}
                                onChange={(v) => setForm((p) => ({ ...p, max_advance_booking_days: v }))}
                                placeholder="30"
                            />
                        </Field>
                        <Field label="Min booking notice (minutes)">
                            <TextInput
                                type="number"
                                value={form.min_booking_notice_minutes ?? ''}
                                onChange={(v) => setForm((p) => ({ ...p, min_booking_notice_minutes: v }))}
                                placeholder="30"
                            />
                        </Field>
                    </div>
                </Card>

                <Card className="p-5">
                    <h3 className="mb-4 text-sm font-semibold text-gray-900">Reminders</h3>
                    <Field label="Reminder hours before (0 = off)" hint="How many hours before the appointment a WhatsApp reminder is sent. 0 disables reminders.">
                        <TextInput
                            type="number"
                            value={form.reminder_hours_before ?? ''}
                            onChange={(v) => setForm((p) => ({ ...p, reminder_hours_before: v }))}
                            placeholder="24"
                        />
                    </Field>
                </Card>

                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={saving}
                        className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                        {saving ? 'Saving…' : 'Save Clinic Settings'}
                    </button>
                </div>
            </form>
        </div>
    );
}

// ── Edit Clinic Sheet ─────────────────────────────────────────────────────────

function EditClinicSheet({ open, clinic, onClose, onSaved }) {
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (open && clinic) {
            setForm({ ...clinic });
        }
    }, [open, clinic]);

    const f = (key) => ({ value: form[key] || '', onChange: (v) => setForm((p) => ({ ...p, [key]: v })) });

    const handleSave = async () => {
        setSaving(true);
        setError('');
        try {
            await client.put(`/super-admin/clinics/${clinic.id}`, form);
            onSaved();
            onClose();
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Sheet
            open={open}
            title="Edit Clinic"
            subtitle="Update clinic details and status."
            onClose={onClose}
            footer={
                <div className="flex items-center justify-between gap-3">
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <div className="ml-auto flex gap-2">
                        <Btn onClick={onClose} disabled={saving}>Cancel</Btn>
                        <Btn variant="primary" onClick={handleSave} disabled={saving}>
                            {saving ? 'Saving…' : 'Save'}
                        </Btn>
                    </div>
                </div>
            }
        >
            <div className="space-y-4">
                <Field label="Clinic Name" required>
                    <TextInput {...f('name')} placeholder="Clinic Name" />
                </Field>
                <Field label="Slug">
                    <TextInput {...f('slug')} placeholder="my-clinic" />
                </Field>
                <Field label="Legal Name">
                    <TextInput {...f('legal_name')} placeholder="Registered legal name" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Owner Name">
                        <TextInput {...f('owner_name')} placeholder="Owner" />
                    </Field>
                    <Field label="Owner Phone">
                        <TextInput {...f('owner_phone')} placeholder="+91 XXXXXXXXXX" />
                    </Field>
                </div>
                <Field label="Owner Email">
                    <TextInput type="email" {...f('owner_email')} placeholder="owner@clinic.com" />
                </Field>
                <Field label="Address Line 1">
                    <TextInput {...f('address_line_1')} placeholder="Street address" />
                </Field>
                <Field label="Address Line 2">
                    <TextInput {...f('address_line_2')} placeholder="Area, landmark (optional)" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="City">
                        <TextInput {...f('city')} placeholder="City" />
                    </Field>
                    <Field label="State">
                        <TextInput {...f('state')} placeholder="State" />
                    </Field>
                </div>
                <Field label="Pincode">
                    <TextInput {...f('pincode')} placeholder="560001" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Phone">
                        <TextInput {...f('phone')} placeholder="+91 XXXXXXXXXX" />
                    </Field>
                    <Field label="Email">
                        <TextInput type="email" {...f('email')} placeholder="clinic@clinic.com" />
                    </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Status">
                        <SelectInput {...f('status')} options={[
                            { value: 'active', label: 'Active' },
                            { value: 'suspended', label: 'Suspended' },
                        ]} />
                    </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Primary Color" hint="Default: #2563EB">
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={form.primary_color || '#2563EB'}
                                onChange={(e) => setForm((p) => ({ ...p, primary_color: e.target.value }))}
                                className="h-9 w-12 cursor-pointer rounded-lg border border-gray-300 p-0.5"
                            />
                            <TextInput value={form.primary_color || ''} onChange={(v) => setForm((p) => ({ ...p, primary_color: v }))} placeholder="#2563EB" />
                        </div>
                    </Field>
                    <Field label="Secondary Color" hint="Default: #64748B">
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={form.secondary_color || '#64748B'}
                                onChange={(e) => setForm((p) => ({ ...p, secondary_color: e.target.value }))}
                                className="h-9 w-12 cursor-pointer rounded-lg border border-gray-300 p-0.5"
                            />
                            <TextInput value={form.secondary_color || ''} onChange={(v) => setForm((p) => ({ ...p, secondary_color: v }))} placeholder="#64748B" />
                        </div>
                    </Field>
                </div>
            </div>
        </Sheet>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ClinicDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [clinic, setClinic] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('overview');
    const [editSheet, setEditSheet] = useState(false);
    // Subscription from the overview endpoint, for the header status badge.
    const [subscription, setSubscription] = useState(undefined);

    const loadClinic = () => {
        client.get(`/super-admin/clinics/${id}`)
            .then((res) => setClinic(res.data?.data || null))
            .catch((e) => setError(e?.response?.data?.message || 'Clinic not found'))
            .finally(() => setLoading(false));
    };

    useEffect(() => { loadClinic(); }, [id]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5">
                <p className="text-sm text-red-700">{error}</p>
                <button onClick={() => navigate('/workflows/clinics')} className="mt-3 text-sm font-semibold text-blue-600 hover:underline">
                    ← Back to Clinics
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {/* Breadcrumb + title */}
            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={() => navigate('/workflows/clinics')}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                    <AppIcon name="chevron-right" className="h-3.5 w-3.5 rotate-180" />
                    All Clinics
                </button>
                <AppIcon name="chevron-right" className="h-3.5 w-3.5 text-gray-300" />
                <h1 className="text-xl font-bold text-gray-900">{clinic?.name || `Clinic #${id}`}</h1>
                {clinic && subscription !== undefined && (
                    <ClinicStatusBadge clinicStatus={clinic.status} subscriptionStatus={subscription?.status} />
                )}
            </div>

            {/* Tab bar */}
            <div className="flex overflow-x-auto rounded-xl border border-gray-200 bg-gray-100 p-1 gap-1">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                            activeTab === tab.key
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <AppIcon name={tab.icon} className="h-4 w-4" />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div>
                {activeTab === 'overview' && (
                    <OverviewTab clinic={clinic} clinicId={id} onEditClinic={() => setEditSheet(true)} onSubscriptionLoaded={setSubscription} />
                )}
                {activeTab === 'doctors'   && <DoctorsTab clinicId={id} />}
                {activeTab === 'services'  && <ServicesTab clinicId={id} />}
                {activeTab === 'staff'     && <StaffTab clinicId={id} />}
                {activeTab === 'settings'  && <SettingsTab clinicId={id} />}
            </div>

            {/* Edit clinic sheet (from Overview tab) */}
            <EditClinicSheet
                open={editSheet}
                clinic={clinic}
                onClose={() => setEditSheet(false)}
                onSaved={loadClinic}
            />
        </div>
    );
}
