import { useEffect, useRef, useState } from 'react';
import client from '../../api/client';
import { useScope } from '../../context/ScopeContext';

const DEFAULT_PRIMARY   = '#2563EB';
const DEFAULT_SECONDARY = '#64748B';

function InfoField({ label, value }) {
    return (
        <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
            <p className="text-sm text-gray-900">{value || '—'}</p>
        </div>
    );
}

function TrialBadge({ trialEndsAt }) {
    if (!trialEndsAt) return <span className="text-sm text-gray-900">—</span>;
    const d = new Date(String(trialEndsAt));
    if (Number.isNaN(d.getTime())) return <span className="text-sm text-gray-900">{trialEndsAt}</span>;
    const now = new Date();
    const expired = d <= now;
    const daysLeft = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    const dateLabel = (() => {
        try {
            return new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', year: 'numeric' }).format(d);
        } catch {
            return d.toLocaleDateString();
        }
    })();
    return (
        <span className={expired ? 'text-sm font-semibold text-red-600' : daysLeft <= 3 ? 'text-sm font-semibold text-amber-600' : 'text-sm text-gray-900'}>
            {dateLabel}{expired ? ' — Expired' : ` (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)`}
        </span>
    );
}

function ColorField({ label, hint, value, onChange }) {
    return (
        <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    value={value || hint}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-lg border border-gray-300 p-0.5"
                />
                <input
                    type="text"
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={hint}
                    className="w-32 rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                {value && value !== hint && (
                    <button
                        type="button"
                        onClick={() => onChange('')}
                        className="text-xs text-gray-400 hover:text-gray-600"
                    >
                        Reset
                    </button>
                )}
            </div>
            <p className="text-xs text-gray-400">Default: {hint}</p>
        </div>
    );
}

function TextField({ label, value, onChange, type = 'text' }) {
    return (
        <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
            <input
                type={type}
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
        </div>
    );
}

export default function ClinicProfilePage() {
    const scope = useScope() || {};
    const { context } = scope;
    const readOnly = !scope.can?.('clinic_profile.edit');
    const trialEndsAt = context?.subscription?.trial_ends_at;

    const [clinic, setClinic] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [logoFile, setLogoFile] = useState(null);
    const [logoPreview, setLogoPreview] = useState('');
    const [primaryColor, setPrimaryColor] = useState('');
    const [secondaryColor, setSecondaryColor] = useState('');
    const [addressLine1, setAddressLine1] = useState('');
    const [addressLine2, setAddressLine2] = useState('');
    const [city, setCity] = useState('');
    const [state, setState] = useState('');
    const [pincode, setPincode] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const logoInputRef = useRef(null);

    useEffect(() => {
        client.get('/clinic/clinic/profile')
            .then((res) => {
                const c = res.data?.data || {};
                setClinic(c);
                setLogoPreview(c.logo_url || '');
                setPrimaryColor(c.primary_color || '');
                setSecondaryColor(c.secondary_color || '');
                setAddressLine1(c.address_line_1 || '');
                setAddressLine2(c.address_line_2 || '');
                setCity(c.city || '');
                setState(c.state || '');
                setPincode(c.pincode || '');
                setPhone(c.phone || '');
                setEmail(c.email || '');
            })
            .catch((e) => setError(e?.response?.data?.message || 'Failed to load clinic profile'))
            .finally(() => setLoading(false));
    }, []);

    const handleLogoChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLogoFile(file);
        setLogoPreview(URL.createObjectURL(file));
    };

    const handleSave = async () => {
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            let logoUrl = clinic?.logo_url || '';
            if (logoFile) {
                const fd = new FormData();
                fd.append('file', logoFile);
                fd.append('module', 'clinics');
                const upRes = await client.post('/clinic/uploads/image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                logoUrl = upRes.data?.data?.url || logoUrl;
            }
            const res = await client.put('/clinic/clinic/profile', {
                logo_url: logoUrl || null,
                primary_color: primaryColor || null,
                secondary_color: secondaryColor || null,
                address_line_1: addressLine1 || null,
                address_line_2: addressLine2 || null,
                city: city || null,
                state: state || null,
                pincode: pincode || null,
                phone: phone || null,
                email: email || null,
            });
            const updated = res.data?.data || clinic;
            setClinic(updated);
            setLogoFile(null);
            setSuccess('Clinic profile updated successfully.');
            setTimeout(() => setSuccess(''), 3000);
        } catch (e) {
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

    return (
        <div className="mx-auto max-w-2xl space-y-6">
            <div>
                <h1 className="text-xl font-bold text-gray-900">Clinic Profile</h1>
                <p className="mt-0.5 text-sm text-gray-500">Your clinic details as registered during onboarding.</p>
            </div>

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

            {/* Clinic Identity */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Clinic Identity</p>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <InfoField label="Clinic Name" value={clinic?.name} />
                    <InfoField label="Legal Name" value={clinic?.legal_name} />
                    <InfoField label="Slug" value={clinic?.slug} />
                    <div className="space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Status</p>
                        <span className="inline-block rounded-full bg-gray-100 px-3 py-0.5 text-sm capitalize text-gray-700">{clinic?.status || '—'}</span>
                    </div>
                </div>
            </div>

            {/* Owner Details */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Owner Details</p>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <InfoField label="Owner Name" value={clinic?.owner_name} />
                    <InfoField label="Owner Email" value={clinic?.owner_email} />
                    <InfoField label="Owner Phone" value={clinic?.owner_phone} />
                </div>
            </div>

            {/* Location & Contact */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Location &amp; Contact</p>
                {readOnly ? (
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        <InfoField label="Address Line 1" value={addressLine1} />
                        <InfoField label="Address Line 2" value={addressLine2} />
                        <InfoField label="City" value={city} />
                        <InfoField label="State" value={state} />
                        <InfoField label="Pincode" value={pincode} />
                        <InfoField label="Phone" value={phone} />
                        <InfoField label="Email" value={email} />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        <TextField label="Address Line 1" value={addressLine1} onChange={setAddressLine1} />
                        <TextField label="Address Line 2" value={addressLine2} onChange={setAddressLine2} />
                        <TextField label="City" value={city} onChange={setCity} />
                        <TextField label="State" value={state} onChange={setState} />
                        <TextField label="Pincode" value={pincode} onChange={setPincode} />
                        <TextField label="Phone" value={phone} onChange={setPhone} />
                        <TextField label="Email" value={email} onChange={setEmail} type="email" />
                    </div>
                )}
            </div>

            {/* Trial */}
            {trialEndsAt && (
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-2">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Trial Period</p>
                    <TrialBadge trialEndsAt={trialEndsAt} />
                </div>
            )}

            {/* Branding */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Branding</p>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    {readOnly ? (
                        <>
                            <div className="space-y-1.5">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Primary Color</p>
                                <div className="flex items-center gap-2">
                                    <span className="inline-block h-6 w-6 rounded border border-gray-200" style={{ backgroundColor: primaryColor || DEFAULT_PRIMARY }} />
                                    <span className="text-sm text-gray-900">{primaryColor || DEFAULT_PRIMARY}</span>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Secondary Color</p>
                                <div className="flex items-center gap-2">
                                    <span className="inline-block h-6 w-6 rounded border border-gray-200" style={{ backgroundColor: secondaryColor || DEFAULT_SECONDARY }} />
                                    <span className="text-sm text-gray-900">{secondaryColor || DEFAULT_SECONDARY}</span>
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <ColorField
                                label="Primary Color"
                                hint={DEFAULT_PRIMARY}
                                value={primaryColor}
                                onChange={setPrimaryColor}
                            />
                            <ColorField
                                label="Secondary Color"
                                hint={DEFAULT_SECONDARY}
                                value={secondaryColor}
                                onChange={setSecondaryColor}
                            />
                        </>
                    )}
                </div>

                <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Clinic Logo</p>
                    <div className="flex items-center gap-5">
                        {logoPreview ? (
                            <img src={logoPreview} alt="Clinic logo" className="h-20 w-20 rounded-xl border border-gray-200 object-contain bg-gray-50" />
                        ) : (
                            <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50">
                                <span className="text-xs text-gray-400">No logo</span>
                            </div>
                        )}
                        {!readOnly && (
                            <div className="flex flex-col gap-2">
                                <button type="button" onClick={() => logoInputRef.current?.click()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                    {logoPreview ? 'Change Logo' : 'Upload Logo'}
                                </button>
                                {logoPreview && (
                                    <button type="button" onClick={() => { setLogoFile(null); setLogoPreview(''); setClinic((c) => ({ ...c, logo_url: '' })); }} className="text-left text-sm text-red-500 hover:underline">
                                        Remove logo
                                    </button>
                                )}
                                <p className="text-xs text-gray-400">PNG, JPG, SVG up to 2 MB.</p>
                            </div>
                        )}
                    </div>
                    {!readOnly && <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />}
                </div>
            </div>

            {clinic?.notes && (
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-2">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Notes</p>
                    <p className="whitespace-pre-wrap text-sm text-gray-700">{clinic.notes}</p>
                </div>
            )}

            {!readOnly && (
                <div className="flex justify-end">
                    <button onClick={handleSave} disabled={saving} className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                        {saving ? 'Saving…' : 'Save Changes'}
                    </button>
                </div>
            )}
        </div>
    );
}
