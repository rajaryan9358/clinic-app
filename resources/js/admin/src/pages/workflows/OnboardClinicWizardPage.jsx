import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import { useAuth } from '../../context/AuthContext';
import { formatINR, toPaise } from '../../utils/money';
import { offlineAmountForCycle, offlinePeriodMonthsForCycle } from '../../utils/planDefaults';

function Field({ label, required, children, hint }) {
    return (
        <div>
            <label className="mb-1 block text-xs font-semibold text-gray-700">
                {label}{required && <span className="ml-0.5 text-red-500">*</span>}
            </label>
            {children}
            {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
        </div>
    );
}

function TextInput({ value, onChange, placeholder, type = 'text', disabled }) {
    return (
        <input
            type={type}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-400"
        />
    );
}


function Toggle({ checked, onChange, label }) {
    return (
        <label className="flex cursor-pointer items-center gap-3">
            <div className="relative flex-shrink-0">
                <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
                <div className={`flex h-5 w-9 items-center rounded-full transition-colors ${Boolean(checked) ? 'bg-blue-600' : 'bg-gray-200'}`}>
                    <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${Boolean(checked) ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
            </div>
            <span className="text-sm text-gray-700">{label}</span>
        </label>
    );
}

function SectionCard({ title, subtitle, children }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-5 border-b border-gray-100 pb-4">
                <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
            </div>
            <div className="space-y-4">{children}</div>
        </div>
    );
}

const STEPS = [
    { num: 1, label: 'Clinic' },
    { num: 2, label: 'Plan' },
    { num: 3, label: 'Admin' },
];

function limitLabel(value) {
    return value == null || value === '' ? 'Unlimited' : String(value);
}

// ── Plan Step ─────────────────────────────────────────────────────────────────
function PlanStep({ plans, plansLoading, plansError, skipPlan, setSkipPlan, subscription, setSubscription, onBack, onContinue, continueError }) {
    const selectedPlan = plans.find((p) => p.id === subscription.plan_id) || null;

    const selectPlan = (plan) => {
        setSkipPlan(false);
        setSubscription((p) => {
            const billing_cycle = p.billing_cycle === 'yearly' && !plan.yearly_price ? 'monthly' : p.billing_cycle;
            return {
                ...p,
                plan_id: plan.id,
                billing_cycle,
                offline_amount: p.start_mode === 'paid_offline' ? offlineAmountForCycle(plan, billing_cycle) : p.offline_amount,
            };
        });
    };

    const setCycle = (cycle) => {
        setSubscription((p) => ({
            ...p,
            billing_cycle: cycle,
            offline_amount: p.start_mode === 'paid_offline' && selectedPlan ? offlineAmountForCycle(selectedPlan, cycle) : p.offline_amount,
            offline_period_months: p.start_mode === 'paid_offline' ? offlinePeriodMonthsForCycle(cycle) : p.offline_period_months,
        }));
    };

    const setStartMode = (mode) => {
        setSubscription((p) => {
            const next = { ...p, start_mode: mode };
            if (mode === 'paid_offline') {
                next.offline_period_months = offlinePeriodMonthsForCycle(next.billing_cycle);
                if (!next.offline_amount && selectedPlan) {
                    next.offline_amount = offlineAmountForCycle(selectedPlan, next.billing_cycle);
                }
            }
            return next;
        });
    };

    if (plansLoading) {
        return (
            <SectionCard title="Plan" subtitle="Choose a subscription plan for this clinic.">
                <div className="flex justify-center py-10">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                </div>
            </SectionCard>
        );
    }

    if (plansError) {
        return (
            <SectionCard title="Plan" subtitle="Choose a subscription plan for this clinic.">
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{plansError}</p>
                <div className="flex justify-between pt-2">
                    <button type="button" onClick={onBack} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">← Back</button>
                </div>
            </SectionCard>
        );
    }

    if (!plans.length) {
        return (
            <SectionCard title="Plan" subtitle="Choose a subscription plan for this clinic.">
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                    <p className="font-semibold">No active plans yet.</p>
                    <p className="mt-1">
                        Create a plan first, then come back here. Or continue without assigning a plan — you can attach one later from the clinic's subscription card.
                    </p>
                    <Link to="/billing/plans" className="mt-2 inline-block text-sm font-semibold text-blue-700 hover:underline">
                        Create a plan →
                    </Link>
                </div>
                {continueError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{continueError}</div>}
                <div className="flex justify-between pt-2">
                    <button type="button" onClick={onBack} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">← Back</button>
                    <button
                        type="button"
                        onClick={() => onContinue(true)}
                        className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                        Skip for now →
                    </button>
                </div>
            </SectionCard>
        );
    }

    return (
        <SectionCard title="Plan" subtitle="Choose a subscription plan and how billing should start.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {plans.map((plan) => {
                    const active = plan.id === subscription.plan_id;
                    return (
                        <button
                            type="button"
                            key={plan.id}
                            onClick={() => selectPlan(plan)}
                            className={`rounded-xl border p-4 text-left transition-colors ${active ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-gray-900">{plan.name}</p>
                                {active && <AppIcon name="check" className="h-4 w-4 text-blue-600" />}
                            </div>
                            {plan.description && <p className="mt-0.5 text-xs text-gray-500">{plan.description}</p>}
                            <p className="mt-2 text-sm text-gray-800">
                                {formatINR(plan.monthly_price)} <span className="text-xs text-gray-400">/ month</span>
                                {plan.yearly_price != null && (
                                    <span className="ml-2 text-gray-800">{formatINR(plan.yearly_price)} <span className="text-xs text-gray-400">/ year</span></span>
                                )}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                                {limitLabel(plan.max_doctors)} doctors · {limitLabel(plan.max_staff)} staff · {limitLabel(plan.max_appointments_per_month)} appts/mo
                            </p>
                        </button>
                    );
                })}
            </div>

            {selectedPlan && (
                <>
                    <div className="border-t border-gray-100 pt-4">
                        <h4 className="mb-3 text-sm font-semibold text-gray-900">Billing cycle</h4>
                        <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
                            <button
                                type="button"
                                onClick={() => setCycle('monthly')}
                                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${subscription.billing_cycle === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                            >
                                Monthly
                            </button>
                            <button
                                type="button"
                                disabled={!selectedPlan.yearly_price}
                                onClick={() => setCycle('yearly')}
                                title={!selectedPlan.yearly_price ? 'This plan has no yearly price' : undefined}
                                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:text-gray-300 ${subscription.billing_cycle === 'yearly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                            >
                                Yearly
                            </button>
                        </div>
                    </div>

                    <div className="border-t border-gray-100 pt-4">
                        <h4 className="mb-3 text-sm font-semibold text-gray-900">Start mode</h4>
                        <div className="space-y-3">
                            <label className="flex items-start gap-3 rounded-xl border border-gray-200 p-3 has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50">
                                <input type="radio" className="mt-1" checked={subscription.start_mode === 'trial'} onChange={() => setStartMode('trial')} />
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-gray-900">Start a free trial</p>
                                    {subscription.start_mode === 'trial' && (
                                        <div className="mt-2 max-w-[160px]">
                                            <Field label="Trial length (days)">
                                                <TextInput
                                                    type="number"
                                                    value={subscription.trial_days}
                                                    onChange={(v) => setSubscription((p) => ({ ...p, trial_days: v }))}
                                                />
                                            </Field>
                                        </div>
                                    )}
                                </div>
                            </label>

                            <label className="flex items-start gap-3 rounded-xl border border-gray-200 p-3 has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50">
                                <input type="radio" className="mt-1" checked={subscription.start_mode === 'pending_payment'} onChange={() => setStartMode('pending_payment')} />
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-gray-900">Payment pending</p>
                                    <p className="mt-0.5 text-xs text-gray-500">The clinic admin pays on first login.</p>
                                </div>
                            </label>

                            <label className="flex items-start gap-3 rounded-xl border border-gray-200 p-3 has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50">
                                <input type="radio" className="mt-1" checked={subscription.start_mode === 'paid_offline'} onChange={() => setStartMode('paid_offline')} />
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-gray-900">Paid offline</p>
                                    {subscription.start_mode === 'paid_offline' && (
                                        <div className="mt-2 grid grid-cols-2 gap-3">
                                            <Field label="Amount (₹)" required>
                                                <TextInput
                                                    type="number"
                                                    value={subscription.offline_amount}
                                                    onChange={(v) => setSubscription((p) => ({ ...p, offline_amount: v }))}
                                                />
                                            </Field>
                                            <Field label="Period (months)">
                                                <TextInput
                                                    type="number"
                                                    value={subscription.offline_period_months}
                                                    onChange={(v) => setSubscription((p) => ({ ...p, offline_period_months: v }))}
                                                />
                                            </Field>
                                            <div className="col-span-2">
                                                <Field label="Notes">
                                                    <TextInput
                                                        value={subscription.offline_notes}
                                                        onChange={(v) => setSubscription((p) => ({ ...p, offline_notes: v }))}
                                                        placeholder="Cheque number, reference, etc."
                                                    />
                                                </Field>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </label>
                        </div>
                    </div>
                </>
            )}

            {continueError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{continueError}</div>}

            <div className="flex justify-between pt-2">
                <button type="button" onClick={onBack} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                    ← Back
                </button>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => onContinue(true)}
                        className="text-sm font-medium text-gray-500 hover:text-gray-700"
                    >
                        Skip — assign a plan later
                    </button>
                    <button
                        type="button"
                        onClick={() => onContinue(false)}
                        className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                        Continue →
                    </button>
                </div>
            </div>
        </SectionCard>
    );
}

export default function OnboardClinicWizardPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const isSuperAdmin = user?.role === 'super_admin';
    const base = useMemo(() => (isSuperAdmin ? '/super-admin' : '/clinic'), [isSuperAdmin]);

    const [step, setStep] = useState(1);

    const [clinic, setClinic] = useState({
        name: '', slug: '', legal_name: '', owner_name: '', owner_email: '', owner_phone: '',
        status: 'active', primary_color: '', secondary_color: '',
        address_line_1: '', address_line_2: '', city: '', state: '', pincode: '', phone: '', email: '',
        walkin_enabled: true, token_system_enabled: false,
        max_advance_booking_days: 30, min_booking_notice_minutes: 30,
    });

    const [admin, setAdmin] = useState({
        full_name: '', email: '', phone: '', password: '',
    });

    const [plans, setPlans] = useState([]);
    const [plansLoading, setPlansLoading] = useState(true);
    const [plansError, setPlansError] = useState('');
    const [skipPlan, setSkipPlan] = useState(false);
    const [planError, setPlanError] = useState('');
    const [subscription, setSubscription] = useState({
        plan_id: null,
        billing_cycle: 'monthly',
        start_mode: 'trial',
        trial_days: 14,
        offline_amount: '',
        offline_period_months: '1',
        offline_notes: '',
    });

    const [createdClinicId, setCreatedClinicId] = useState(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [logoFile, setLogoFile] = useState(null);
    const [logoPreview, setLogoPreview] = useState('');
    const logoInputRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            client.get(`${base}/plans`, { params: { active: 1 } }),
            client.get(`${base}/settings/system`).catch(() => null),
        ])
            .then(([plansRes, settingsRes]) => {
                if (cancelled) return;
                setPlans(Array.isArray(plansRes.data?.data) ? plansRes.data.data : []);
                const defaultTrialDays = settingsRes?.data?.data?.trial_days;
                if (defaultTrialDays) {
                    setSubscription((p) => ({ ...p, trial_days: defaultTrialDays }));
                }
            })
            .catch((e) => {
                if (!cancelled) setPlansError(e?.response?.data?.message || 'Failed to load plans');
            })
            .finally(() => { if (!cancelled) setPlansLoading(false); });
        return () => { cancelled = true; };
    }, [base]);

    if (!isSuperAdmin) {
        return (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900">Not allowed</h2>
                <p className="mt-1 text-sm text-gray-500">This workflow is available only to Super Admin.</p>
                <Link to="/dashboard" className="mt-4 inline-block rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                    Go to Dashboard
                </Link>
            </div>
        );
    }

    // Auto-generate slug from name
    const handleClinicName = (v) => {
        setClinic((p) => ({
            ...p,
            name: v,
            slug: p.slug === '' || p.slug === toSlug(p.name) ? toSlug(v) : p.slug,
        }));
    };

    const toSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const handleLogoChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLogoFile(file);
        setLogoPreview(URL.createObjectURL(file));
    };

    const continueToPlan = async () => {
        if (!clinic.name) { setError('Clinic name is required.'); return; }
        setSaving(true);
        setError('');
        try {
            if (logoFile && !clinic.logo_url) {
                const fd = new FormData();
                fd.append('file', logoFile);
                fd.append('module', 'clinics');
                const upRes = await client.post(`${base}/uploads/image`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                const logoUrl = upRes.data?.data?.url || '';
                if (logoUrl) setClinic((p) => ({ ...p, logo_url: logoUrl }));
            }
            setStep(2);
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to upload logo');
        } finally {
            setSaving(false);
        }
    };

    const continueToAdminStep = (skip) => {
        setPlanError('');
        setSkipPlan(skip);
        if (!skip) {
            if (!subscription.plan_id) { setPlanError('Choose a plan, or skip assigning one for now.'); return; }
            if (subscription.start_mode === 'paid_offline' && !String(subscription.offline_amount ?? '').trim()) {
                setPlanError('Enter the amount paid offline.');
                return;
            }
        }
        setStep(3);
    };

    const buildSubscriptionPayload = () => {
        if (skipPlan || !subscription.plan_id) return null;

        const payload = {
            plan_id: subscription.plan_id,
            billing_cycle: subscription.billing_cycle,
            start_mode: subscription.start_mode,
        };

        if (subscription.start_mode === 'trial') {
            const days = Number(subscription.trial_days);
            if (Number.isFinite(days) && days > 0) payload.trial_days = days;
        }

        if (subscription.start_mode === 'paid_offline') {
            payload.offline_amount = toPaise(subscription.offline_amount);
            const months = Number(subscription.offline_period_months);
            payload.offline_period_months = Number.isFinite(months) && months > 0 ? months : 1;
            if (String(subscription.offline_notes || '').trim()) {
                payload.offline_notes = subscription.offline_notes.trim();
            }
        }

        return payload;
    };

    const createAdmin = async () => {
        if (!admin.full_name || !admin.password) { setError('Admin name and password are required.'); return; }
        setSaving(true);
        setError('');
        try {
            const {
                walkin_enabled, token_system_enabled, max_advance_booking_days, min_booking_notice_minutes,
                ...clinicFields
            } = clinic;
            const settings = { walkin_enabled, token_system_enabled };
            if (String(max_advance_booking_days ?? '').trim() !== '') {
                settings.max_advance_booking_days = Number(max_advance_booking_days);
            }
            if (String(min_booking_notice_minutes ?? '').trim() !== '') {
                settings.min_booking_notice_minutes = Number(min_booking_notice_minutes);
            }
            const subscriptionPayload = buildSubscriptionPayload();
            const payload = {
                ...clinicFields,
                primary_color: clinicFields.primary_color || null,
                secondary_color: clinicFields.secondary_color || null,
                settings,
                clinic_admin: {
                    full_name: admin.full_name,
                    email: admin.email || null,
                    phone: admin.phone || null,
                    password: admin.password,
                },
                ...(subscriptionPayload ? { subscription: subscriptionPayload } : {}),
            };
            const { data } = await client.post(`${base}/clinics`, payload);
            const id = data?.data?.id;
            if (!id) throw new Error('Clinic created but no id returned');
            setCreatedClinicId(id);
            navigate(`/workflows/clinics/${id}`);
        } catch (e) {
            setError(e?.response?.data?.message || e?.message || 'Failed to create clinic');
        } finally {
            setSaving(false);
        }
    };

    const c = (key) => ({ value: clinic[key], onChange: (v) => setClinic((p) => ({ ...p, [key]: v })) });
    const a = (key) => ({ value: admin[key], onChange: (v) => setAdmin((p) => ({ ...p, [key]: v })) });

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Onboard New Clinic</h2>
                    <p className="mt-0.5 text-sm text-gray-500">Create a clinic and its admin account.</p>
                </div>
                <Link to="/workflows/clinics" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
                    ← Back to Clinics
                </Link>
            </div>

            {/* Step indicators */}
            <div className="flex items-center gap-0 rounded-xl border border-gray-200 bg-white px-5 py-3 shadow-sm">
                {STEPS.map((s, i) => (
                    <React.Fragment key={s.num}>
                        <div className="flex items-center gap-2">
                            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                                step === s.num ? 'bg-blue-600 text-white'
                                : step > s.num ? 'bg-emerald-500 text-white'
                                : 'bg-gray-100 text-gray-400'
                            }`}>
                                {step > s.num ? <AppIcon name="check" className="h-3.5 w-3.5" /> : s.num}
                            </div>
                            <span className={`text-sm font-semibold ${step === s.num ? 'text-gray-900' : step > s.num ? 'text-emerald-600' : 'text-gray-400'}`}>
                                {s.label}
                            </span>
                        </div>
                        {i < STEPS.length - 1 && <div className="mx-3 h-px flex-1 bg-gray-200" />}
                    </React.Fragment>
                ))}
            </div>

            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            {/* Step 1 — Clinic */}
            {step === 1 && (
                <SectionCard title="Clinic Details" subtitle="Basic information about the clinic.">
                    <Field label="Clinic Name" required>
                        <TextInput value={clinic.name} onChange={handleClinicName} placeholder="e.g. Sunrise Healthcare" />
                    </Field>
                    <Field label="Slug" hint="Auto-generated from the name. Used in URLs.">
                        <TextInput {...c('slug')} placeholder="sunrise-healthcare" />
                    </Field>
                    <Field label="Legal Name">
                        <TextInput {...c('legal_name')} placeholder="Registered legal entity name" />
                    </Field>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <Field label="Owner Name">
                            <TextInput {...c('owner_name')} placeholder="Full name" />
                        </Field>
                        <Field label="Owner Email">
                            <TextInput type="email" {...c('owner_email')} placeholder="owner@clinic.com" />
                        </Field>
                        <Field label="Owner Phone">
                            <TextInput {...c('owner_phone')} placeholder="+91 XXXXXXXXXX" />
                        </Field>
                    </div>

                    <Field label="Clinic Logo" hint="Optional. PNG, JPG or SVG. Shown in the clinic header.">
                        <div className="flex items-center gap-4">
                            {logoPreview ? (
                                <img src={logoPreview} alt="Logo preview" className="h-14 w-14 rounded-xl border border-gray-200 object-contain bg-gray-50" />
                            ) : (
                                <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-xs text-gray-400">Logo</div>
                            )}
                            <div className="flex gap-2">
                                <button type="button" onClick={() => logoInputRef.current?.click()} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                                    {logoPreview ? 'Change' : 'Upload'}
                                </button>
                                {logoPreview && (
                                    <button type="button" onClick={() => { setLogoFile(null); setLogoPreview(''); }} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">
                                        Remove
                                    </button>
                                )}
                            </div>
                            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                        </div>
                    </Field>

                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Primary Color" hint="Optional. Default: #2563EB">
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={clinic.primary_color || '#2563EB'}
                                    onChange={(e) => setClinic((p) => ({ ...p, primary_color: e.target.value }))}
                                    className="h-9 w-12 cursor-pointer rounded-lg border border-gray-300 p-0.5"
                                />
                                <TextInput
                                    value={clinic.primary_color}
                                    onChange={(v) => setClinic((p) => ({ ...p, primary_color: v }))}
                                    placeholder="#2563EB"
                                />
                            </div>
                        </Field>
                        <Field label="Secondary Color" hint="Optional. Default: #64748B">
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={clinic.secondary_color || '#64748B'}
                                    onChange={(e) => setClinic((p) => ({ ...p, secondary_color: e.target.value }))}
                                    className="h-9 w-12 cursor-pointer rounded-lg border border-gray-300 p-0.5"
                                />
                                <TextInput
                                    value={clinic.secondary_color}
                                    onChange={(v) => setClinic((p) => ({ ...p, secondary_color: v }))}
                                    placeholder="#64748B"
                                />
                            </div>
                        </Field>
                    </div>

                    <div className="border-t border-gray-100 pt-4">
                        <h4 className="mb-3 text-sm font-semibold text-gray-900">Address and contact</h4>
                        <div className="space-y-4">
                            <Field label="Address Line 1">
                                <TextInput {...c('address_line_1')} placeholder="Street address" />
                            </Field>
                            <Field label="Address Line 2">
                                <TextInput {...c('address_line_2')} placeholder="Area, landmark (optional)" />
                            </Field>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                <Field label="City">
                                    <TextInput {...c('city')} placeholder="City" />
                                </Field>
                                <Field label="State">
                                    <TextInput {...c('state')} placeholder="State" />
                                </Field>
                                <Field label="Pincode">
                                    <TextInput {...c('pincode')} placeholder="560001" />
                                </Field>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <Field label="Phone">
                                    <TextInput {...c('phone')} placeholder="+91 XXXXXXXXXX" />
                                </Field>
                                <Field label="Email">
                                    <TextInput type="email" {...c('email')} placeholder="clinic@clinic.com" />
                                </Field>
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-gray-100 pt-4">
                        <h4 className="mb-3 text-sm font-semibold text-gray-900">Booking</h4>
                        <div className="space-y-4">
                            <Toggle checked={clinic.walkin_enabled} onChange={(v) => setClinic((p) => ({ ...p, walkin_enabled: v }))} label="Walk-in enabled" />
                            <Toggle checked={clinic.token_system_enabled} onChange={(v) => setClinic((p) => ({ ...p, token_system_enabled: v }))} label="Token system enabled" />
                            <div className="grid grid-cols-2 gap-4">
                                <Field label="Max advance booking days">
                                    <TextInput type="number" {...c('max_advance_booking_days')} placeholder="30" />
                                </Field>
                                <Field label="Min booking notice (minutes)">
                                    <TextInput type="number" {...c('min_booking_notice_minutes')} placeholder="30" />
                                </Field>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end pt-2">
                        <button
                            type="button"
                            onClick={continueToPlan}
                            disabled={saving}
                            className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                            {saving ? 'Continuing…' : 'Continue →'}
                        </button>
                    </div>
                </SectionCard>
            )}

            {/* Step 2 — Plan */}
            {step === 2 && (
                <PlanStep
                    plans={plans}
                    plansLoading={plansLoading}
                    plansError={plansError}
                    skipPlan={skipPlan}
                    setSkipPlan={setSkipPlan}
                    subscription={subscription}
                    setSubscription={setSubscription}
                    onBack={() => { setError(''); setPlanError(''); setStep(1); }}
                    onContinue={continueToAdminStep}
                    continueError={planError}
                />
            )}

            {/* Step 3 — Clinic Admin */}
            {step === 3 && (
                <SectionCard title="Clinic Admin Account" subtitle="This person will manage the clinic and have full access.">
                    <Field label="Full Name" required>
                        <TextInput {...a('full_name')} placeholder="Clinic Admin Name" />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Email">
                            <TextInput type="email" {...a('email')} placeholder="admin@clinic.com" />
                        </Field>
                        <Field label="Phone">
                            <TextInput {...a('phone')} placeholder="+91 XXXXXXXXXX" />
                        </Field>
                    </div>
                    <Field label="Password" required>
                        <TextInput type="password" {...a('password')} placeholder="••••••••" />
                    </Field>

                    <div className="flex justify-between pt-2">
                        <button type="button" onClick={() => { setError(''); setStep(2); }} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                            ← Back
                        </button>
                        <button
                            type="button"
                            onClick={createAdmin}
                            disabled={saving}
                            className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                            {saving ? 'Finishing…' : 'Finish Onboarding ✓'}
                        </button>
                    </div>
                </SectionCard>
            )}
        </div>
    );
}
