import { useEffect, useMemo, useRef, useState } from 'react';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import { useScope } from '../../context/ScopeContext';

const DEFAULT_PRIMARY   = '#2563EB';
const DEFAULT_SECONDARY = '#64748B';
const HEX_RE = /^#[0-9a-f]{6}$/i;

const EDITABLE_FIELDS = [
    'logo_url', 'primary_color', 'secondary_color',
    'address_line_1', 'address_line_2', 'city', 'state', 'pincode', 'phone', 'email',
];

const STATUS_STYLES = {
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    trial: 'bg-sky-50 text-sky-700 ring-sky-200',
    suspended: 'bg-rose-50 text-rose-700 ring-rose-200',
    inactive: 'bg-slate-100 text-slate-600 ring-slate-200',
};

function formFrom(clinic) {
    return Object.fromEntries(EDITABLE_FIELDS.map((key) => [key, clinic?.[key] || '']));
}

function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function trialInfo(trialEndsAt) {
    if (!trialEndsAt) return null;
    const d = new Date(String(trialEndsAt));
    if (Number.isNaN(d.getTime())) return { label: String(trialEndsAt), tone: 'slate' };
    const daysLeft = Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24));
    let date;
    try {
        date = new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', year: 'numeric' }).format(d);
    } catch {
        date = d.toLocaleDateString();
    }
    if (daysLeft <= 0) return { label: `Trial expired ${date}`, date, tone: 'rose' };
    return {
        label: `Trial · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`,
        date,
        tone: daysLeft <= 3 ? 'amber' : 'sky',
    };
}

const TONES = {
    rose: 'bg-rose-50 text-rose-700 ring-rose-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    sky: 'bg-sky-50 text-sky-700 ring-sky-200',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
};

function Chip({ className = '', children }) {
    return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>
            {children}
        </span>
    );
}

function Card({ title, description, icon, children, className = '' }) {
    return (
        <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
            <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
                {icon && (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                        <AppIcon name={icon} className="h-4 w-4" />
                    </span>
                )}
                <div>
                    <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
                    {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
                </div>
            </header>
            <div className="p-5">{children}</div>
        </section>
    );
}

function Detail({ label, value, href }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs font-medium text-slate-500">{label}</dt>
            <dd className="mt-0.5 truncate text-sm text-slate-900">
                {value ? (href ? <a href={href} className="text-slate-900 hover:text-blue-600 hover:underline">{value}</a> : value) : <span className="text-slate-400">—</span>}
            </dd>
        </div>
    );
}

function Field({ label, value, onChange, error, readOnly, type = 'text', placeholder, className = '', inputMode, autoComplete }) {
    const id = `clinic-${label.toLowerCase().replace(/\W+/g, '-')}`;
    return (
        <div className={className}>
            <label htmlFor={id} className="text-xs font-medium text-slate-600">{label}</label>
            {readOnly ? (
                <p className="mt-1 text-sm text-slate-900">{value || <span className="text-slate-400">—</span>}</p>
            ) : (
                <input
                    id={id}
                    type={type}
                    value={value}
                    placeholder={placeholder}
                    inputMode={inputMode}
                    autoComplete={autoComplete}
                    onChange={(e) => onChange(e.target.value)}
                    aria-invalid={error ? 'true' : undefined}
                    className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 ${error ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100'}`}
                />
            )}
            {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        </div>
    );
}

function ColorField({ label, fallback, value, onChange, error, readOnly }) {
    const effective = HEX_RE.test(value) ? value : fallback;
    return (
        <div>
            <p className="text-xs font-medium text-slate-600">{label}</p>
            {readOnly ? (
                <div className="mt-1 flex items-center gap-2">
                    <span className="h-6 w-6 rounded-md ring-1 ring-inset ring-black/10" style={{ backgroundColor: effective }} />
                    <span className="font-mono text-sm text-slate-900">{value || fallback}</span>
                </div>
            ) : (
                <div className={`mt-1 flex items-center gap-2 rounded-xl border bg-white p-1.5 pr-3 focus-within:ring-2 ${error ? 'border-rose-300 focus-within:ring-rose-100' : 'border-slate-300 focus-within:border-blue-500 focus-within:ring-blue-100'}`}>
                    <label className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-lg ring-1 ring-inset ring-black/10" style={{ backgroundColor: effective }}>
                        <input
                            type="color"
                            value={effective}
                            onChange={(e) => onChange(e.target.value)}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            aria-label={`${label} picker`}
                        />
                    </label>
                    <input
                        type="text"
                        value={value}
                        onChange={(e) => onChange(e.target.value.trim())}
                        placeholder={fallback}
                        maxLength={7}
                        aria-label={`${label} hex value`}
                        className="min-w-0 flex-1 bg-transparent font-mono text-sm uppercase text-slate-900 outline-none placeholder:text-slate-400"
                    />
                    {value && value.toLowerCase() !== fallback.toLowerCase() && (
                        <button type="button" onClick={() => onChange('')} className="text-xs font-medium text-slate-500 hover:text-slate-800">
                            Reset
                        </button>
                    )}
                </div>
            )}
            {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        </div>
    );
}

function LogoMark({ src, name, color, className }) {
    return src ? (
        <img src={src} alt={`${name || 'Clinic'} logo`} className={`bg-white object-contain ${className}`} />
    ) : (
        <span className={`flex items-center justify-center font-semibold text-white ${className}`} style={{ backgroundColor: color }}>
            {initials(name)}
        </span>
    );
}

function BrandPreview({ name, logo, primary, secondary }) {
    return (
        <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="flex items-center gap-2.5 px-4 py-3" style={{ backgroundColor: primary }}>
                <LogoMark src={logo} name={name} color={secondary} className="h-8 w-8 rounded-lg text-xs" />
                <span className="truncate text-sm font-semibold text-white">{name || 'Your clinic'}</span>
            </div>
            <div className="space-y-3 bg-white p-4">
                <div>
                    <p className="text-sm font-semibold text-slate-900">Appointment confirmed</p>
                    <p className="text-xs" style={{ color: secondary }}>Tue, 10:30 AM · Dr. Sharma</p>
                </div>
                <div className="flex gap-2">
                    <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: primary }}>View details</span>
                    <span className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: secondary, color: secondary }}>Reschedule</span>
                </div>
            </div>
        </div>
    );
}

export default function ClinicProfilePage() {
    const scope = useScope() || {};
    const readOnly = !scope.can?.('clinic_profile.edit');
    const trial = trialInfo(scope.context?.subscription?.trial_ends_at);

    const [clinic, setClinic] = useState(null);
    const [form, setForm] = useState(formFrom(null));
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState({});
    const [success, setSuccess] = useState('');
    const [logoFile, setLogoFile] = useState(null);
    const [logoPreview, setLogoPreview] = useState('');
    const logoInputRef = useRef(null);

    useEffect(() => {
        client.get('/clinic/clinic/profile')
            .then((res) => {
                const c = res.data?.data || {};
                setClinic(c);
                setForm(formFrom(c));
            })
            .catch((e) => setError(e?.response?.data?.message || 'Failed to load clinic profile'))
            .finally(() => setLoading(false));
    }, []);

    // Release the blob URL of a picked-but-unsaved logo when it is replaced.
    useEffect(() => () => { if (logoPreview) URL.revokeObjectURL(logoPreview); }, [logoPreview]);

    const saved = useMemo(() => formFrom(clinic), [clinic]);
    const dirty = !!logoFile || EDITABLE_FIELDS.some((key) => form[key] !== saved[key]);

    const set = (key) => (value) => {
        setForm((f) => ({ ...f, [key]: value }));
        setFieldErrors((errs) => (errs[key] ? { ...errs, [key]: undefined } : errs));
    };

    const pickLogo = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            setFieldErrors((errs) => ({ ...errs, logo_url: 'Logo must be 2 MB or smaller.' }));
            return;
        }
        setFieldErrors((errs) => ({ ...errs, logo_url: undefined }));
        setLogoFile(file);
        setLogoPreview(URL.createObjectURL(file));
    };

    const removeLogo = () => {
        setLogoFile(null);
        setLogoPreview('');
        set('logo_url')('');
    };

    const discard = () => {
        setForm(saved);
        setLogoFile(null);
        setLogoPreview('');
        setFieldErrors({});
        setError('');
    };

    const handleSave = async () => {
        const colorErrors = {};
        if (form.primary_color && !HEX_RE.test(form.primary_color)) colorErrors.primary_color = 'Use a hex colour like #2563EB.';
        if (form.secondary_color && !HEX_RE.test(form.secondary_color)) colorErrors.secondary_color = 'Use a hex colour like #64748B.';
        if (Object.keys(colorErrors).length) {
            setFieldErrors(colorErrors);
            return;
        }

        setSaving(true);
        setError('');
        setSuccess('');
        setFieldErrors({});
        try {
            let logoUrl = form.logo_url;
            if (logoFile) {
                const fd = new FormData();
                fd.append('file', logoFile);
                fd.append('module', 'clinics');
                const upRes = await client.post('/clinic/uploads/image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                logoUrl = upRes.data?.data?.url || logoUrl;
            }
            const payload = Object.fromEntries(EDITABLE_FIELDS.map((key) => [key, (key === 'logo_url' ? logoUrl : form[key]) || null]));
            const res = await client.put('/clinic/clinic/profile', payload);
            const updated = res.data?.data || { ...clinic, ...payload };
            setClinic(updated);
            setForm(formFrom(updated));
            setLogoFile(null);
            setLogoPreview('');
            setSuccess('Clinic profile saved.');
            setTimeout(() => setSuccess(''), 3000);
        } catch (e) {
            const errs = e?.response?.data?.errors;
            if (errs && typeof errs === 'object') {
                setFieldErrors(Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)])));
            }
            setError(e?.response?.data?.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
        );
    }

    const primary = HEX_RE.test(form.primary_color) ? form.primary_color : DEFAULT_PRIMARY;
    const secondary = HEX_RE.test(form.secondary_color) ? form.secondary_color : DEFAULT_SECONDARY;
    const logo = logoPreview || form.logo_url;
    const address = [form.address_line_1, form.address_line_2, [form.city, form.state].filter(Boolean).join(', '), form.pincode]
        .filter(Boolean).join(' · ');
    const status = String(clinic?.status || '').toLowerCase();

    return (
        <div className={`mx-auto max-w-6xl space-y-5 ${dirty && !readOnly ? 'pb-24' : ''}`}>
            {/* Identity header */}
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="h-24 sm:h-28" style={{ background: `linear-gradient(120deg, ${primary}, ${secondary})` }} />
                <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:justify-between">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="relative -mt-10 w-fit sm:-mt-12">
                            <LogoMark src={logo} name={clinic?.name} color={primary} className="h-20 w-20 rounded-2xl text-2xl shadow-md ring-4 ring-white sm:h-24 sm:w-24" />
                            {!readOnly && (
                                <button
                                    type="button"
                                    onClick={() => logoInputRef.current?.click()}
                                    className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:text-slate-900"
                                    aria-label={logo ? 'Change logo' : 'Upload logo'}
                                >
                                    <AppIcon name="edit" className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                        <div className="min-w-0 sm:pb-1">
                            <h1 className="truncate text-xl font-semibold text-slate-900">{clinic?.name || 'Clinic profile'}</h1>
                            {clinic?.legal_name && clinic.legal_name !== clinic.name && (
                                <p className="truncate text-sm text-slate-500">{clinic.legal_name}</p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {status && <Chip className={`capitalize ${STATUS_STYLES[status] || TONES.slate}`}>{status}</Chip>}
                                {trial && <Chip className={TONES[trial.tone]}>{trial.label}</Chip>}
                                {clinic?.slug && <Chip className={`font-mono ${TONES.slate}`}>{clinic.slug}</Chip>}
                            </div>
                        </div>
                    </div>
                    {address && (
                        <p className="flex max-w-sm items-start gap-1.5 text-sm text-slate-500 sm:pb-1 sm:text-right">
                            <AppIcon name="building" className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{address}</span>
                        </p>
                    )}
                </div>
            </section>

            {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
            {success && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                <div className="space-y-5 lg:col-span-2">
                    <Card
                        title="Location & contact"
                        description="Shown to patients on prescriptions, invoices and booking messages."
                        icon="globe"
                    >
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
                            <Field className="sm:col-span-6" label="Address line 1" value={form.address_line_1} onChange={set('address_line_1')} error={fieldErrors.address_line_1} readOnly={readOnly} autoComplete="address-line1" />
                            <Field className="sm:col-span-6" label="Address line 2" value={form.address_line_2} onChange={set('address_line_2')} error={fieldErrors.address_line_2} readOnly={readOnly} autoComplete="address-line2" />
                            <Field className="sm:col-span-2" label="City" value={form.city} onChange={set('city')} error={fieldErrors.city} readOnly={readOnly} autoComplete="address-level2" />
                            <Field className="sm:col-span-2" label="State" value={form.state} onChange={set('state')} error={fieldErrors.state} readOnly={readOnly} autoComplete="address-level1" />
                            <Field className="sm:col-span-2" label="Pincode" value={form.pincode} onChange={set('pincode')} error={fieldErrors.pincode} readOnly={readOnly} inputMode="numeric" autoComplete="postal-code" />
                            <div className="border-t border-slate-100 sm:col-span-6" />
                            <Field className="sm:col-span-3" label="Phone" type="tel" value={form.phone} onChange={set('phone')} error={fieldErrors.phone} readOnly={readOnly} autoComplete="tel" />
                            <Field className="sm:col-span-3" label="Email" type="email" value={form.email} onChange={set('email')} error={fieldErrors.email} readOnly={readOnly} autoComplete="email" />
                        </div>
                    </Card>

                    <Card title="Branding" description="Your logo and colours on the patient portal, PDFs and messages." icon="star">
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                            <div className="space-y-4">
                                <div>
                                    <p className="text-xs font-medium text-slate-600">Logo</p>
                                    <div className="mt-1 flex items-center gap-4">
                                        <LogoMark src={logo} name={clinic?.name} color={primary} className="h-16 w-16 rounded-xl text-lg ring-1 ring-inset ring-slate-200" />
                                        {readOnly ? (
                                            !logo && <p className="text-sm text-slate-400">No logo uploaded</p>
                                        ) : (
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-3">
                                                    <button type="button" onClick={() => logoInputRef.current?.click()} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                                                        {logo ? 'Replace' : 'Upload'}
                                                    </button>
                                                    {logo && (
                                                        <button type="button" onClick={removeLogo} className="text-sm font-medium text-rose-600 hover:text-rose-700">
                                                            Remove
                                                        </button>
                                                    )}
                                                </div>
                                                <p className="text-xs text-slate-400">PNG, JPG or SVG, up to 2 MB. Square works best.</p>
                                            </div>
                                        )}
                                    </div>
                                    {fieldErrors.logo_url && <p className="mt-1 text-xs text-rose-600">{fieldErrors.logo_url}</p>}
                                </div>
                                <ColorField label="Primary colour" fallback={DEFAULT_PRIMARY} value={form.primary_color} onChange={set('primary_color')} error={fieldErrors.primary_color} readOnly={readOnly} />
                                <ColorField label="Secondary colour" fallback={DEFAULT_SECONDARY} value={form.secondary_color} onChange={set('secondary_color')} error={fieldErrors.secondary_color} readOnly={readOnly} />
                            </div>
                            <div>
                                <p className="mb-1 text-xs font-medium text-slate-600">Preview</p>
                                <BrandPreview name={clinic?.name} logo={logo} primary={primary} secondary={secondary} />
                            </div>
                        </div>
                        {!readOnly && <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={pickLogo} />}
                    </Card>
                </div>

                <div className="space-y-5">
                    <Card title="Owner" description="Registered at onboarding." icon="user">
                        <dl className="space-y-3">
                            <Detail label="Name" value={clinic?.owner_name} />
                            <Detail label="Email" value={clinic?.owner_email} href={clinic?.owner_email ? `mailto:${clinic.owner_email}` : undefined} />
                            <Detail label="Phone" value={clinic?.owner_phone} href={clinic?.owner_phone ? `tel:${clinic.owner_phone}` : undefined} />
                        </dl>
                    </Card>

                    <Card title="Account" icon="shield">
                        <dl className="space-y-3">
                            <Detail label="Clinic name" value={clinic?.name} />
                            <Detail label="Legal name" value={clinic?.legal_name} />
                            <Detail label="Slug" value={clinic?.slug} />
                            {trial && <Detail label="Trial ends" value={trial.date || trial.label} />}
                        </dl>
                        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                            To change these details, contact support.
                        </p>
                    </Card>

                    {clinic?.notes && (
                        <Card title="Notes" icon="info">
                            <p className="whitespace-pre-wrap text-sm text-slate-700">{clinic.notes}</p>
                        </Card>
                    )}
                </div>
            </div>

            {!readOnly && dirty && (
                <div className="fixed bottom-0 left-0 right-0 z-30 lg:left-64 border-t border-slate-200 bg-white/95 backdrop-blur">
                    <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
                        <p className="text-sm text-slate-600">You have unsaved changes.</p>
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={discard} disabled={saving} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                                Discard
                            </button>
                            <button type="button" onClick={handleSave} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                                {saving ? 'Saving…' : 'Save changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
