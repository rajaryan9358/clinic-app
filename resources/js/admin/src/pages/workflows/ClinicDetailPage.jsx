import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import StatusBadge from '../../components/StatusBadge';
import ClinicStatusBadge from '../../components/billing/ClinicStatusBadge.jsx';
import SubscriptionCard from '../../components/billing/SubscriptionCard.jsx';
import { useAssignableRoles } from '../../hooks/useAssignableRoles';
import { formatDate } from '../../utils/dateFormat';
import { Alert, btn, Card as UiCard, EmptyState as UiEmptyState, input, PageHeader, Spinner, Tabs } from '../../components/ui';

const TABS = [
    { key: 'overview',  label: 'Overview',       icon: 'dashboard' },
    { key: 'doctors',   label: 'Doctors',         icon: 'stethoscope' },
    { key: 'services',  label: 'Services',        icon: 'clipboard-check' },
    { key: 'staff',     label: 'Staff users',     icon: 'users' },
    { key: 'settings',  label: 'Clinic settings', icon: 'settings' },
];

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function Card({ children, className = '' }) {
    return <div className={`rounded-2xl border border-slate-200 bg-white ${className}`}>{children}</div>;
}

/** A card with the standard header row (title, description, actions). */
function Panel({ title, subtitle, action, children, bodyClassName = 'px-5 py-2' }) {
    return <UiCard title={title} description={subtitle} actions={action} bodyClassName={bodyClassName}>{children}</UiCard>;
}

function InfoRow({ label, value }) {
    if (value == null || value === '') return null;
    return (
        <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2.5 last:border-0 sm:flex-row sm:items-start sm:gap-4">
            <span className="text-sm text-slate-600 sm:w-44 sm:shrink-0">{label}</span>
            <span className="min-w-0 break-words text-sm font-medium text-slate-900">{value}</span>
        </div>
    );
}

function EmptyNote({ children }) {
    return <p className="py-3 text-sm text-slate-600">{children}</p>;
}

function EmptyState({ icon, text }) {
    return <UiEmptyState icon={icon} title={text} />;
}

function LoadingState() {
    return <Spinner className="py-14" />;
}

function ErrorBox({ children }) {
    return <Alert tone="error">{children}</Alert>;
}

function Avatar({ src, text, tone = 'blue' }) {
    if (src) return <img src={src} alt="" className="h-10 w-10 shrink-0 rounded-full border border-slate-200 object-cover" />;
    const cls = tone === 'blue' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700';
    return <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${cls}`}>{text}</span>;
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

    if (loading) return <Card><LoadingState /></Card>;
    if (error) return <ErrorBox>{error}</ErrorBox>;

    return (
        <>
            <Panel
                title="Services"
                subtitle="Create services for this clinic."
                bodyClassName=""
                action={
                    <Btn variant="primary" onClick={openAdd}>
                        <AppIcon name="plus" className="h-4 w-4" /> Add service
                    </Btn>
                }
            >
            {!services.length ? (
                <EmptyState icon="clipboard-check" text="No services yet." />
            ) : (
                <div className="divide-y divide-slate-100">
                    {services.map((svc) => {
                        return (
                            <div key={svc.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-900">{svc.name}</p>
                                    <p className="mt-0.5 text-sm text-slate-600">
                                        {svc.code ? `${svc.code} · ` : ''}
                                        {svc.duration_minutes ? `${svc.duration_minutes} min · ` : ''}
                                        {svc.fee != null && svc.fee !== '' ? `₹${svc.fee}` : ''}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Btn className="h-9" onClick={() => openEdit(svc)}><AppIcon name="edit" className="h-4 w-4" /> Edit</Btn>
                                    <DeleteBtn endpoint={`/super-admin/services/${svc.id}`} onDeleted={load} label="service" />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            </Panel>

            <Sheet
                open={sheet.open}
                title={sheet.mode === 'edit' ? `Edit service — ${sheet.service?.name}` : 'Add service'}
                subtitle="Configure the service details."
                onClose={() => setSheet({ open: false, mode: 'add', service: null })}
                footer={
                    <SheetFooter error={saveError}>
                        <Btn onClick={() => setSheet({ open: false, mode: 'add', service: null })} disabled={saving}>Cancel</Btn>
                        {/* The footer renders outside the form, so tie the button to it by id. */}
                        <Btn variant="primary" type="submit" form="service-sheet-form" disabled={saving} className="min-w-[110px]">
                            {saving ? 'Saving…' : 'Save'}
                        </Btn>
                    </SheetFooter>
                }
            >
                <form id="service-sheet-form" onSubmit={save} className="space-y-4">
                    <Field label="Service name" required>
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
                className={`${btn.danger} h-9`}
            >
                <AppIcon name="trash" className="h-4 w-4" />
                Delete
            </button>
        );
    }

    return (
        <div className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-2.5">
            <span className="text-sm font-semibold text-rose-800">Delete {label}?</span>
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
                className="rounded-md px-2 py-1 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
            >
                {busy ? '…' : 'Yes'}
            </button>
            <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-md px-2 py-1 text-sm font-semibold text-slate-700 hover:bg-white"
            >
                No
            </button>
        </div>
    );
}

function Btn({ onClick, children, variant = 'secondary', disabled, type = 'button', className = '', form }) {
    const styles = {
        primary: btn.primary,
        secondary: btn.secondary,
        danger: btn.danger,
        ghost: btn.link,
    };
    return (
        <button type={type} form={form} onClick={onClick} disabled={disabled} className={`${styles[variant]} ${className}`}>
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
        <div className="fixed inset-0 z-50 flex justify-end" aria-modal="true" role="dialog" aria-label={title}>
            <div
                ref={overlayRef}
                className="absolute inset-0 bg-slate-950/50"
                onClick={onClose}
            />
            <div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                        {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    >
                        <AppIcon name="close" className="h-4 w-4" />
                    </button>
                </div>
                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5">{children}</div>
                {/* Footer */}
                {footer && <div className="border-t border-slate-100 px-5 py-4">{footer}</div>}
            </div>
        </div>
    );
}

function SheetFooter({ error, children }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
            <div className="ml-auto flex gap-2">{children}</div>
        </div>
    );
}

// ── Small form helpers ────────────────────────────────────────────────────────

// The label wraps the control so text and input stay tied together. Pass
// `group` when the body holds buttons or several controls.
function Field({ label, required, error, hint, children, group = false }) {
    const Tag = group ? 'div' : 'label';
    return (
        <Tag className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
                {label}{required && <span className="ml-0.5 text-rose-600" aria-hidden="true">*</span>}
            </span>
            {children}
            {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
            {error && <span className="mt-1 block text-xs text-rose-700">{error}</span>}
        </Tag>
    );
}

function TextInput({ value, onChange, placeholder, type = 'text', disabled = false, readOnly = false, className = '' }) {
    return (
        <input
            type={type}
            value={value || ''}
            disabled={disabled}
            readOnly={readOnly}
            onChange={(e) => (onChange ? onChange(e.target.value) : undefined)}
            placeholder={placeholder}
            className={`${input} ${className}`}
        />
    );
}

function SelectInput({ value, onChange, options, disabled = false }) {
    return (
        <select
            value={value || ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={input}
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

    if (loading) return <p className="text-sm text-slate-600">Loading doctors…</p>;
    if (error) return <p className="text-sm text-rose-700">{error}</p>;
    if (!options.length) return <p className="text-sm text-slate-600">No doctors yet.</p>;

    return (
        <div className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
            {options.map((doc) => {
                const checked = selected.includes(String(doc.id));
                const name = [doc.title, doc.full_name].filter(Boolean).join(' ').trim() || `Doctor #${doc.id}`;
                return (
                    <label
                        key={doc.id}
                        className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors ${checked ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    >
                        <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(doc.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-slate-800">{name}</span>
                    </label>
                );
            })}
        </div>
    );
}

function Toggle({ checked, onChange, label }) {
    return (
        <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
            <span className="text-sm font-medium text-slate-900">{label}</span>
            <span className="relative inline-flex shrink-0">
                <input type="checkbox" role="switch" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
                <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300" />
                <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
            </span>
        </label>
    );
}

// ── Theme / branding helpers ──────────────────────────────────────────────────

const DEFAULT_PRIMARY = '#2563EB';
const DEFAULT_SECONDARY = '#64748B';
const HEX_RE = /^#[0-9a-f]{6}$/i;
const safeHex = (value, fallback) => (HEX_RE.test(String(value || '')) ? value : fallback);

/** Colour swatch (opens the native picker) + hex text input. */
function ColorField({ label, value, fallback, onChange, hint }) {
    const swatch = safeHex(value, fallback);
    return (
        <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
            <div className="flex items-center gap-2">
                <label className="relative h-10 w-12 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-slate-300 focus-within:ring-2 focus-within:ring-blue-300" style={{ backgroundColor: swatch }}>
                    <span className="sr-only">Pick {label.toLowerCase()}</span>
                    <input
                        type="color"
                        value={swatch}
                        onChange={(e) => onChange(e.target.value)}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                </label>
                <input
                    type="text"
                    aria-label={`${label} hex code`}
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={fallback}
                    className={`${input} font-mono uppercase`}
                />
            </div>
            {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
        </div>
    );
}

/** Small mock of the clinic's patient-facing header in its theme colours. */
function ThemePreview({ name, logoUrl, primary, secondary }) {
    const p = safeHex(primary, DEFAULT_PRIMARY);
    const s = safeHex(secondary, DEFAULT_SECONDARY);
    return (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50" aria-label="Theme preview">
            <div className="flex items-center gap-2.5 px-4 py-3" style={{ backgroundColor: p }}>
                {logoUrl
                    ? <img src={logoUrl} alt="" className="h-7 w-7 rounded-md bg-white object-contain p-0.5" />
                    : <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/20 text-xs font-bold text-white">{(name || 'C')[0]}</span>}
                <span className="truncate text-sm font-semibold text-white">{name || 'Clinic'}</span>
            </div>
            <div className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200">
                    <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900">Book an appointment</span>
                        <span className="block text-xs" style={{ color: s }}>Next: today, 4:30 pm</span>
                    </span>
                    <span className="shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold text-white" style={{ backgroundColor: p }}>Book</span>
                </div>
                <div className="flex flex-wrap gap-2">
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: s }}>Secondary</span>
                    <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: p, color: p }}>Outline</span>
                </div>
            </div>
        </div>
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
            <span className="h-5 w-5 rounded-md border border-slate-200" style={{ backgroundColor: color }} />
            <span className="font-mono text-xs uppercase">{color}</span>
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

    if (error) return <ErrorBox>{error}</ErrorBox>;
    if (!overview) return <Card><LoadingState /></Card>;

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
                    <Card key={label} className="px-4 py-3">
                        <p className="text-xs font-medium text-slate-600">{label}</p>
                        <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{value ?? 0}</p>
                    </Card>
                ))}
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
                <Panel
                    title="Clinic"
                    action={<Btn className="h-9" onClick={onEditClinic}><AppIcon name="edit" className="h-4 w-4" /> Edit</Btn>}
                >
                    {c.logo_url && (
                        <div className="pt-2">
                            <img src={c.logo_url} alt={`${c.name} logo`} className="h-14 w-14 rounded-xl border border-slate-200 object-contain" />
                        </div>
                    )}
                    <InfoRow label="Name" value={c.name} />
                    <InfoRow label="Legal name" value={c.legal_name} />
                    <InfoRow label="Slug" value={c.slug} />
                    <InfoRow label="Status" value={c.status && <StatusBadge status={c.status} />} />
                    <InfoRow label="Created" value={formatDate(c.created_at)} />
                    <InfoRow label="Notes" value={c.notes} />
                </Panel>

                <Panel
                    title="Theme and branding"
                    subtitle="Colours used on this clinic's patient portal, bills and messages."
                    action={<Btn className="h-9" onClick={onEditClinic}><AppIcon name="edit" className="h-4 w-4" /> Edit theme</Btn>}
                    bodyClassName="p-5"
                >
                    <div className="grid gap-5 sm:grid-cols-2">
                        <div className="space-y-3">
                            <div>
                                <p className="text-sm text-slate-600">Primary colour</p>
                                <p className="mt-1 text-sm font-medium text-slate-900">
                                    {c.primary_color ? <ColorValue color={c.primary_color} /> : <span className="text-slate-600">Default ({DEFAULT_PRIMARY})</span>}
                                </p>
                            </div>
                            <div>
                                <p className="text-sm text-slate-600">Secondary colour</p>
                                <p className="mt-1 text-sm font-medium text-slate-900">
                                    {c.secondary_color ? <ColorValue color={c.secondary_color} /> : <span className="text-slate-600">Default ({DEFAULT_SECONDARY})</span>}
                                </p>
                            </div>
                        </div>
                        <ThemePreview name={c.name} logoUrl={c.logo_url} primary={c.primary_color} secondary={c.secondary_color} />
                    </div>
                </Panel>

                <Panel title="Owner">
                    <InfoRow label="Name" value={c.owner_name} />
                    <InfoRow label="Email" value={c.owner_email} />
                    <InfoRow label="Phone" value={c.owner_phone} />
                    {!c.owner_name && !c.owner_email && !c.owner_phone && <EmptyNote>No owner details recorded.</EmptyNote>}
                </Panel>

                <Panel title="Address and contact">
                    <InfoRow label="Address" value={address} />
                    <InfoRow label="Phone" value={c.phone} />
                    <InfoRow label="Email" value={c.email} />
                    {!address && !c.phone && !c.email && <EmptyNote>No address or contact recorded.</EmptyNote>}
                </Panel>

                <Panel title="Booking settings">
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
                        <EmptyNote>No booking settings saved yet.</EmptyNote>
                    )}
                </Panel>

                <Panel title="Clinic admins" subtitle="Logins created for this clinic's administrators.">
                    {admins.length === 0 ? (
                        <EmptyNote>No clinic admin yet. Add one from Staff users.</EmptyNote>
                    ) : (
                        <ul className="divide-y divide-slate-100">
                            {admins.map((a) => (
                                <li key={a.id} className="flex items-start justify-between gap-3 py-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-slate-900">{a.full_name}</p>
                                        <p className="truncate text-sm text-slate-600">{[a.email, a.phone].filter(Boolean).join(' · ')}</p>
                                    </div>
                                    {a.status && <StatusBadge status={a.status} />}
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
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

    if (loading) return <Card><LoadingState /></Card>;
    if (error) return <ErrorBox>{error}</ErrorBox>;

    return (
        <>
            <Panel
                title="Doctors"
                subtitle="Doctors registered under this clinic."
                bodyClassName=""
                action={
                    <Btn variant="primary" onClick={openAdd}>
                        <AppIcon name="plus" className="h-4 w-4" /> Add doctor
                    </Btn>
                }
            >
            {!items.length ? <EmptyState icon="stethoscope" text="No doctors yet." /> : (
                <div className="divide-y divide-slate-100">
                    {items.map((doc) => (
                        <div key={doc.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                            <div className="flex min-w-0 items-center gap-3">
                                <Avatar src={doc.photo_url} text={(doc.full_name || '?')[0]} />
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-slate-900">{doc.full_name}</p>
                                    <p className="truncate text-sm text-slate-600">{[doc.specialization, doc.qualification].filter(Boolean).join(' · ')}</p>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <StatusBadge status={doc.status} />
                                <Btn className="h-9" onClick={() => openEdit(doc)}>
                                    <AppIcon name="edit" className="h-4 w-4" /> Edit
                                </Btn>
                                <Link
                                    to={`/modules/doctors/${doc.id}`}
                                    className={`${btn.secondary} h-9`}
                                >
                                    View
                                </Link>
                                <DeleteBtn endpoint={`/super-admin/doctors/${doc.id}`} onDeleted={load} label="doctor" />
                            </div>
                        </div>
                    ))}
                </div>
            )}
            </Panel>

            <Sheet
                open={sheet.open}
                title={sheet.doctor ? `Edit doctor — ${sheet.doctor.full_name}` : 'Add doctor'}
                subtitle="Doctor profile and clinic assignment."
                onClose={closeSheet}
                footer={
                    <SheetFooter error={saveError}>
                        <Btn onClick={closeSheet} disabled={saving}>Cancel</Btn>
                        <Btn variant="primary" onClick={handleSave} disabled={saving}>
                            {saving ? 'Saving…' : 'Save'}
                        </Btn>
                    </SheetFooter>
                }
            >
                <div className="space-y-4">
                    {/* Photo upload */}
                    <Field group label="Profile photo">
                        <div className="flex items-center gap-4">
                            <div
                                role="button"
                                tabIndex={0}
                                aria-label="Upload profile photo"
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); photoInputRef.current?.click(); } }}
                                className="relative h-24 w-20 flex-shrink-0 cursor-pointer overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                                onClick={() => photoInputRef.current?.click()}
                            >
                                {photoPreview ? (
                                    <img src={photoPreview} alt="preview" className="h-full w-full object-cover" />
                                ) : (
                                    <div className="flex h-full w-full flex-col items-center justify-center gap-1">
                                        <AppIcon name="plus" className="h-5 w-5 text-slate-500" />
                                        <span className="text-xs text-slate-500">Photo</span>
                                    </div>
                                )}
                            </div>
                            <div className="text-sm text-slate-600">
                                <p>Click to upload a portrait photo.</p>
                                <p className="mt-1">JPG, PNG or WebP · max 2 MB</p>
                                {photoPreview && (
                                    <button
                                        type="button"
                                        className="mt-2 text-sm font-semibold text-rose-700 hover:text-rose-900"
                                        onClick={() => { setPhotoFile(null); setPhotoPreview(''); setForm((p) => ({ ...p, photo_url: '' })); }}
                                    >
                                        Remove photo
                                    </button>
                                )}
                            </div>
                        </div>
                        <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoChange} />
                    </Field>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                        <Field label="Title">
                            <SelectInput {...f('title')} options={[
                                { value: 'Dr.', label: 'Dr.' },
                                { value: 'Prof.', label: 'Prof.' },
                                { value: 'Mr.', label: 'Mr.' },
                                { value: 'Ms.', label: 'Ms.' },
                            ]} />
                        </Field>
                        <div className="sm:col-span-3">
                            <Field label="Full name" required>
                                <TextInput {...f('full_name')} placeholder="Doctor's full name" />
                            </Field>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Specialization">
                            <TextInput {...f('specialization')} placeholder="e.g. Cardiologist" />
                        </Field>
                        <Field label="Qualification">
                            <TextInput {...f('qualification')} placeholder="e.g. MBBS, MD" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Experience (years)">
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Phone">
                            <TextInput {...f('phone')} placeholder="+91 XXXXXXXXXX" />
                        </Field>
                        <Field label="Email">
                            <TextInput type="email" {...f('email')} placeholder="doctor@clinic.com" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Consultation fee (₹)">
                            <TextInput type="number" {...f('consultation_fee')} placeholder="500" />
                        </Field>
                        <Field label="Follow-up fee (₹)">
                            <TextInput type="number" {...f('followup_fee')} placeholder="300" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Slot duration (min)">
                            <TextInput type="number" {...f('slot_duration_minutes')} placeholder="15" />
                        </Field>
                        <Field label="Buffer time (min)">
                            <TextInput type="number" {...f('buffer_time_minutes')} placeholder="5" />
                        </Field>
                    </div>
                    <Field
                        label="Password (login)"
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

    if (loading) return <Card><LoadingState /></Card>;
    if (error) return <ErrorBox>{error}</ErrorBox>;

    const roleLabel = (r) => String(r || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    return (
        <>
            <Panel
                title="Staff users"
                subtitle="All staff with access to this clinic."
                bodyClassName=""
                action={
                    <Btn variant="primary" onClick={openAdd}>
                        <AppIcon name="plus" className="h-4 w-4" /> Add staff
                    </Btn>
                }
            >
            {!items.length ? <EmptyState icon="users" text="No staff users yet." /> : (
                <div className="divide-y divide-slate-100">
                    {items.map((user) => (
                        <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                            <div className="flex min-w-0 items-center gap-3">
                                <Avatar tone="slate" text={(user.full_name || user.email || '?')[0].toUpperCase()} />
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-slate-900">{user.full_name}</p>
                                    <p className="truncate text-sm text-slate-600">{user.email} · {roleLabel(user.role)}</p>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <StatusBadge status={user.status} />
                                <Btn className="h-9" onClick={() => openEdit(user)}>
                                    <AppIcon name="edit" className="h-4 w-4" /> Edit
                                </Btn>
                                <DeleteBtn endpoint={`/super-admin/users/${user.id}`} onDeleted={load} label="staff user" />
                            </div>
                        </div>
                    ))}
                </div>
            )}
            </Panel>

            <Sheet
                open={sheet.open}
                title={sheet.user ? `Edit staff — ${sheet.user.full_name}` : 'Add staff user'}
                subtitle="Create login credentials and assign a role."
                onClose={closeSheet}
                footer={
                    <SheetFooter error={saveError}>
                        <Btn onClick={closeSheet} disabled={saving}>Cancel</Btn>
                        <Btn variant="primary" onClick={handleSave} disabled={saving}>
                            {saving ? 'Saving…' : 'Save'}
                        </Btn>
                    </SheetFooter>
                }
            >
                <div className="space-y-4">
                    <Field label="Full name" required>
                        <TextInput {...f('full_name')} placeholder="Staff Member Name" />
                    </Field>
                    <Field label="Email">
                        <TextInput type="email" {...f('email')} placeholder="staff@clinic.com" />
                    </Field>
                    <Field label="Phone">
                        <TextInput {...f('phone')} placeholder="+91 XXXXXXXXXX" />
                    </Field>
                    <Field label={sheet.user ? 'New password (leave blank to keep)' : 'Password'} required={!sheet.user}>
                        <TextInput type="password" {...f('password')} placeholder="••••••••" />
                    </Field>
                    <Field label="Role" required>
                        <SelectInput {...f('role')} options={roleOptions} />
                    </Field>
                    {currentRoleMeta?.limit_to_assigned_doctors ? (
                        <Field group label="Assigned doctors" hint="Only see these doctors' patients and appointments.">
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

    if (loading) return <Card><LoadingState /></Card>;

    const toggle = (key) => setForm((p) => ({ ...p, [key]: !p[key] }));

    return (
        <div className="max-w-3xl space-y-5">
            {error && <ErrorBox>{error}</ErrorBox>}
            {success && <Alert tone="success">{success}</Alert>}

            <form onSubmit={save} className="space-y-5">
                <Panel title="Booking controls" bodyClassName="px-5 py-1">
                    <div className="divide-y divide-slate-100">
                        {[
                            { key: 'booking_enabled', label: 'Online booking enabled' },
                            { key: 'whatsapp_booking_enabled', label: 'WhatsApp booking enabled' },
                            { key: 'walkin_enabled', label: 'Walk-in appointments' },
                            { key: 'token_system_enabled', label: 'Token system' },
                            { key: 'auto_confirm_appointments', label: 'Auto-confirm appointments' },
                            { key: 'allow_reschedule', label: 'Allow patient rescheduling' },
                            { key: 'allow_cancel', label: 'Allow patient cancellation' },
                            { key: 'portal_enabled', label: 'Patient portal enabled' },
                        ].map(({ key, label }) => (
                            <Toggle key={key} checked={Boolean(form[key])} onChange={() => toggle(key)} label={label} />
                        ))}
                    </div>
                </Panel>

                <Panel title="Cutoff" bodyClassName="p-5">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Reschedule cutoff (hours before appointment)">
                            <input
                                type="number"
                                min={0}
                                max={8760}
                                value={form.reschedule_cutoff_hours ?? ''}
                                onChange={(e) => setForm((p) => ({ ...p, reschedule_cutoff_hours: e.target.value }))}
                                className={`${input} w-32`}
                            />
                        </Field>
                        <Field label="Cancel cutoff (hours before appointment)">
                            <input
                                type="number"
                                min={0}
                                max={8760}
                                value={form.cancel_cutoff_hours ?? ''}
                                onChange={(e) => setForm((p) => ({ ...p, cancel_cutoff_hours: e.target.value }))}
                                className={`${input} w-32`}
                            />
                        </Field>
                    </div>
                </Panel>

                <Panel title="Booking window" bodyClassName="p-5">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                </Panel>

                <Panel title="Reminders" bodyClassName="p-5">
                    <Field label="Reminder hours before (0 = off)" hint="How many hours before the appointment a WhatsApp reminder is sent. 0 disables reminders.">
                        <TextInput
                            type="number"
                            value={form.reminder_hours_before ?? ''}
                            onChange={(v) => setForm((p) => ({ ...p, reminder_hours_before: v }))}
                            placeholder="24"
                            className="max-w-[10rem]"
                        />
                    </Field>
                </Panel>

                <Panel title="Waitlist" bodyClassName="px-5 pb-5">
                    <div className="space-y-3">
                        <Toggle checked={form.waitlist_enabled ?? true} onChange={() => setForm((p) => ({ ...p, waitlist_enabled: !(p.waitlist_enabled ?? true) }))} label="Waitlist enabled" />
                        <Field label="Waitlist hold (minutes)" hint="How long a freed slot is held for the next patient in line (5–240).">
                            <input
                                type="number"
                                min={5}
                                max={240}
                                value={form.waitlist_hold_minutes ?? ''}
                                onChange={(e) => setForm((p) => ({ ...p, waitlist_hold_minutes: e.target.value }))}
                                placeholder="30"
                                className={`${input} w-32`}
                            />
                        </Field>
                    </div>
                </Panel>

                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={saving}
                        className={btn.primary}
                    >
                        {saving ? 'Saving…' : 'Save clinic settings'}
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
            title="Edit clinic"
            subtitle="Update clinic details, status and theme."
            onClose={onClose}
            footer={
                <SheetFooter error={error}>
                    <Btn onClick={onClose} disabled={saving}>Cancel</Btn>
                    <Btn variant="primary" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving…' : 'Save'}
                    </Btn>
                </SheetFooter>
            }
        >
            <div className="space-y-6">
                <section className="space-y-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Clinic</h3>
                    <Field label="Clinic name" required>
                        <TextInput {...f('name')} placeholder="Clinic Name" />
                    </Field>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Slug">
                            <TextInput {...f('slug')} placeholder="my-clinic" />
                        </Field>
                        <Field label="Status">
                            <SelectInput {...f('status')} options={[
                                { value: 'active', label: 'Active' },
                                { value: 'suspended', label: 'Suspended' },
                            ]} />
                        </Field>
                    </div>
                    <Field label="Legal name">
                        <TextInput {...f('legal_name')} placeholder="Registered legal name" />
                    </Field>
                </section>

                <section className="space-y-4 border-t border-slate-100 pt-5">
                    <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Theme and branding</h3>
                        <p className="mt-1 text-sm text-slate-600">Clinics can&rsquo;t change these themselves. Leave blank to use the default.</p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <ColorField
                            label="Primary colour"
                            value={form.primary_color}
                            fallback={DEFAULT_PRIMARY}
                            onChange={(v) => setForm((p) => ({ ...p, primary_color: v }))}
                            hint={`Default: ${DEFAULT_PRIMARY}`}
                        />
                        <ColorField
                            label="Secondary colour"
                            value={form.secondary_color}
                            fallback={DEFAULT_SECONDARY}
                            onChange={(v) => setForm((p) => ({ ...p, secondary_color: v }))}
                            hint={`Default: ${DEFAULT_SECONDARY}`}
                        />
                    </div>
                    <div>
                        <p className="mb-1 text-xs font-medium text-slate-600">Live preview</p>
                        <ThemePreview name={form.name} logoUrl={form.logo_url} primary={form.primary_color} secondary={form.secondary_color} />
                    </div>
                </section>

                <section className="space-y-4 border-t border-slate-100 pt-5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Owner</h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Owner name">
                            <TextInput {...f('owner_name')} placeholder="Owner" />
                        </Field>
                        <Field label="Owner phone">
                            <TextInput {...f('owner_phone')} placeholder="+91 XXXXXXXXXX" />
                        </Field>
                    </div>
                    <Field label="Owner email">
                        <TextInput type="email" {...f('owner_email')} placeholder="owner@clinic.com" />
                    </Field>
                </section>

                <section className="space-y-4 border-t border-slate-100 pt-5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Address and contact</h3>
                    <Field label="Address line 1">
                        <TextInput {...f('address_line_1')} placeholder="Street address" />
                    </Field>
                    <Field label="Address line 2">
                        <TextInput {...f('address_line_2')} placeholder="Area, landmark (optional)" />
                    </Field>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Field label="City">
                            <TextInput {...f('city')} placeholder="City" />
                        </Field>
                        <Field label="State">
                            <TextInput {...f('state')} placeholder="State" />
                        </Field>
                        <Field label="Pincode">
                            <TextInput {...f('pincode')} placeholder="560001" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Phone">
                            <TextInput {...f('phone')} placeholder="+91 XXXXXXXXXX" />
                        </Field>
                        <Field label="Email">
                            <TextInput type="email" {...f('email')} placeholder="clinic@clinic.com" />
                        </Field>
                    </div>
                </section>
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
        return <Spinner className="py-20" />;
    }

    if (error) {
        return (
            <div className="mx-auto max-w-[1400px] space-y-3">
                <Alert tone="error">{error}</Alert>
                <button type="button" onClick={() => navigate('/workflows/clinics')} className={btn.secondary}>
                    ‹ Back to clinics
                </button>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-[1400px] space-y-5">
            <PageHeader
                back={{ to: '/workflows/clinics', label: 'All clinics' }}
                title={(
                    <span className="flex flex-wrap items-center gap-3">
                        <span>{clinic?.name || `Clinic #${id}`}</span>
                        {clinic && subscription !== undefined && (
                            <ClinicStatusBadge clinicStatus={clinic.status} subscriptionStatus={subscription?.status} />
                        )}
                    </span>
                )}
                subtitle={[clinic?.slug, clinic?.city].filter(Boolean).join(' · ') || null}
            />

            <div className="overflow-x-auto">
                <Tabs
                    label="Clinic sections"
                    tabs={TABS.map((tab) => ({ value: tab.key, label: tab.label }))}
                    value={activeTab}
                    onChange={setActiveTab}
                />
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
