import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import { Alert, btn, Card, input, PageHeader, Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { formatINR, toPaise } from '../../utils/money';
import { offlineAmountForCycle, offlinePeriodMonthsForCycle } from '../../utils/planDefaults';

// Label wraps its control so text and input stay tied together. Pass
// `group` for fields whose body holds buttons (logo picker).
function Field({ label, required, children, hint, group = false }) {
    const Tag = group ? 'div' : 'label';
    return (
        <Tag className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
                {label}{required && <span className="ml-0.5 text-rose-600" aria-hidden="true">*</span>}
            </span>
            {children}
            {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
        </Tag>
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
            className={input}
        />
    );
}

function Toggle({ checked, onChange, label }) {
    return (
        <label className="flex cursor-pointer items-center justify-between gap-4 py-1">
            <span className="text-sm font-medium text-slate-900">{label}</span>
            <span className="relative inline-flex shrink-0">
                <input type="checkbox" role="switch" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
                <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300" />
                <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
            </span>
        </label>
    );
}

function SectionCard({ title, subtitle, children }) {
    return (
        <Card title={title} description={subtitle}>
            <div className="space-y-4">{children}</div>
        </Card>
    );
}

function SubHeading({ children }) {
    return <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{children}</h3>;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Colour swatch + hex input. Empty value means "use the default". */
function ColorField({ label, value, fallback, onChange, hint }) {
    const swatch = HEX_RE.test(value || '') ? value : fallback;
    return (
        <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
            <div className="flex items-center gap-2">
                <label className="relative h-10 w-12 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-slate-300" style={{ backgroundColor: swatch }}>
                    <span className="sr-only">{label} picker</span>
                    <input
                        type="color"
                        value={swatch}
                        onChange={(e) => onChange(e.target.value)}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                </label>
                <input
                    type="text"
                    aria-label={`${label} hex`}
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={fallback}
                    className={`${input} font-mono uppercase`}
                />
            </div>
            {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
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
                <Spinner className="py-10" />
            </SectionCard>
        );
    }

    if (plansError) {
        return (
            <SectionCard title="Plan" subtitle="Choose a subscription plan for this clinic.">
                <Alert tone="error">{plansError}</Alert>
                <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-4">
                    <button type="button" onClick={onBack} className={btn.secondary}>‹ Back</button>
                </div>
            </SectionCard>
        );
    }

    if (!plans.length) {
        return (
            <SectionCard title="Plan" subtitle="Choose a subscription plan for this clinic.">
                <Alert tone="warn">
                    <p className="font-semibold">No active plans yet.</p>
                    <p className="mt-1">
                        Create a plan first, then come back here. Or continue without assigning a plan — you can attach one later from the clinic's subscription card.
                    </p>
                    <Link to="/billing/plans" className={`${btn.link} mt-2 inline-block`}>
                        Create a plan ›
                    </Link>
                </Alert>
                {continueError && <Alert tone="error">{continueError}</Alert>}
                <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-4">
                    <button type="button" onClick={onBack} className={btn.secondary}>‹ Back</button>
                    <button
                        type="button"
                        onClick={() => onContinue(true)}
                        className={btn.primary}
                    >
                        Skip for now ›
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
                            aria-pressed={active}
                            className={`rounded-2xl border p-4 text-left transition-colors ${active ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[15px] font-semibold text-slate-900">{plan.name}</p>
                                {active && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white"><AppIcon name="check" className="h-3 w-3" /></span>}
                            </div>
                            {plan.description && <p className="mt-0.5 text-sm text-slate-600">{plan.description}</p>}
                            <p className="mt-2 text-sm font-semibold text-slate-900 tabular-nums">
                                {formatINR(plan.monthly_price)} <span className="text-xs font-normal text-slate-500">/ month</span>
                                {plan.yearly_price != null && (
                                    <span className="ml-2">{formatINR(plan.yearly_price)} <span className="text-xs font-normal text-slate-500">/ year</span></span>
                                )}
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                                {limitLabel(plan.max_doctors)} doctors · {limitLabel(plan.max_staff)} staff · {limitLabel(plan.max_appointments_per_month)} appts/mo
                            </p>
                        </button>
                    );
                })}
            </div>

            {selectedPlan && (
                <>
                    <div className="border-t border-slate-100 pt-4">
                        <SubHeading>Billing cycle</SubHeading>
                        <div role="tablist" aria-label="Billing cycle" className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                            <button
                                type="button"
                                onClick={() => setCycle('monthly')}
                                role="tab"
                                aria-selected={subscription.billing_cycle === 'monthly'}
                                className={`h-8 rounded-lg px-4 text-sm ${subscription.billing_cycle === 'monthly' ? 'bg-slate-900 font-semibold text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                            >
                                Monthly
                            </button>
                            <button
                                type="button"
                                disabled={!selectedPlan.yearly_price}
                                onClick={() => setCycle('yearly')}
                                title={!selectedPlan.yearly_price ? 'This plan has no yearly price' : undefined}
                                role="tab"
                                aria-selected={subscription.billing_cycle === 'yearly'}
                                className={`h-8 rounded-lg px-4 text-sm disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent ${subscription.billing_cycle === 'yearly' ? 'bg-slate-900 font-semibold text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                            >
                                Yearly
                            </button>
                        </div>
                    </div>

                    <div className="border-t border-slate-100 pt-4">
                        <SubHeading>Start mode</SubHeading>
                        <div className="space-y-3">
                            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:checked]:ring-1 has-[:checked]:ring-blue-600">
                                <input type="radio" name="start_mode" className="mt-1 h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-500" checked={subscription.start_mode === 'trial'} onChange={() => setStartMode('trial')} />
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-slate-900">Start a free trial</p>
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

                            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:checked]:ring-1 has-[:checked]:ring-blue-600">
                                <input type="radio" name="start_mode" className="mt-1 h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-500" checked={subscription.start_mode === 'pending_payment'} onChange={() => setStartMode('pending_payment')} />
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-slate-900">Payment pending</p>
                                    <p className="mt-0.5 text-sm text-slate-600">The clinic admin pays on first login.</p>
                                </div>
                            </label>

                            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:checked]:ring-1 has-[:checked]:ring-blue-600">
                                <input type="radio" name="start_mode" className="mt-1 h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-500" checked={subscription.start_mode === 'paid_offline'} onChange={() => setStartMode('paid_offline')} />
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-slate-900">Paid offline</p>
                                    {subscription.start_mode === 'paid_offline' && (
                                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
                                            <div className="sm:col-span-2">
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

            {continueError && <Alert tone="error">{continueError}</Alert>}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <button type="button" onClick={onBack} className={btn.secondary}>
                    ‹ Back
                </button>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => onContinue(true)}
                        className={btn.ghost}
                    >
                        Skip — assign a plan later
                    </button>
                    <button
                        type="button"
                        onClick={() => onContinue(false)}
                        className={btn.primary}
                    >
                        Continue ›
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
            <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-slate-900">Not allowed</h2>
                <p className="mt-1 text-sm text-slate-600">This workflow is available only to Super Admin.</p>
                <Link to="/dashboard" className={`${btn.primary} mt-4`}>
                    Go to dashboard
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
        <div className="mx-auto max-w-3xl space-y-5">
            <PageHeader
                title="Onboard new clinic"
                subtitle="Create a clinic and its admin account."
                back={{ to: '/workflows/clinics', label: 'Clinics' }}
            />

            {/* Step indicators */}
            <ol aria-label="Steps" className="flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:px-5">
                {STEPS.map((s, i) => (
                    <React.Fragment key={s.num}>
                        <li className="flex items-center gap-2" aria-current={step === s.num ? 'step' : undefined}>
                            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                                step === s.num ? 'bg-blue-600 text-white'
                                : step > s.num ? 'bg-emerald-600 text-white'
                                : 'bg-slate-100 text-slate-500'
                            }`}>
                                {step > s.num ? <AppIcon name="check" className="h-3.5 w-3.5" /> : s.num}
                            </span>
                            <span className={`text-sm font-semibold ${step === s.num ? 'text-slate-900' : step > s.num ? 'text-emerald-700' : 'text-slate-500'}`}>
                                {s.label}
                            </span>
                        </li>
                        {i < STEPS.length - 1 && <li aria-hidden="true" className="mx-3 h-px flex-1 bg-slate-200" />}
                    </React.Fragment>
                ))}
            </ol>

            {error && <Alert tone="error">{error}</Alert>}

            {/* Step 1 — Clinic */}
            {step === 1 && (
                <SectionCard title="Clinic details" subtitle="Basic information about the clinic.">
                    <Field label="Clinic name" required>
                        <TextInput value={clinic.name} onChange={handleClinicName} placeholder="e.g. Sunrise Healthcare" />
                    </Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Slug" hint="Auto-generated from the name. Used in URLs.">
                            <TextInput {...c('slug')} placeholder="sunrise-healthcare" />
                        </Field>
                        <Field label="Legal name">
                            <TextInput {...c('legal_name')} placeholder="Registered legal entity name" />
                        </Field>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <Field label="Owner name">
                            <TextInput {...c('owner_name')} placeholder="Full name" />
                        </Field>
                        <Field label="Owner email">
                            <TextInput type="email" {...c('owner_email')} placeholder="owner@clinic.com" />
                        </Field>
                        <Field label="Owner phone">
                            <TextInput {...c('owner_phone')} placeholder="+91 XXXXXXXXXX" />
                        </Field>
                    </div>

                    <div className="border-t border-slate-100 pt-4">
                        <SubHeading>Branding</SubHeading>
                        <div className="space-y-4">
                            <Field group label="Clinic logo" hint="Optional. PNG, JPG or SVG. Shown in the clinic header.">
                                <div className="flex flex-wrap items-center gap-4">
                                    {logoPreview ? (
                                        <img src={logoPreview} alt="Logo preview" className="h-14 w-14 rounded-xl border border-slate-200 bg-slate-50 object-contain" />
                                    ) : (
                                        <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">Logo</div>
                                    )}
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => logoInputRef.current?.click()} className={`${btn.secondary} h-9`}>
                                            {logoPreview ? 'Change' : 'Upload'}
                                        </button>
                                        {logoPreview && (
                                            <button type="button" onClick={() => { setLogoFile(null); setLogoPreview(''); }} className={`${btn.danger} h-9`}>
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                    <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                                </div>
                            </Field>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <ColorField
                                    label="Primary colour"
                                    value={clinic.primary_color}
                                    fallback="#2563EB"
                                    onChange={(v) => setClinic((p) => ({ ...p, primary_color: v }))}
                                    hint="Optional. Default: #2563EB"
                                />
                                <ColorField
                                    label="Secondary colour"
                                    value={clinic.secondary_color}
                                    fallback="#64748B"
                                    onChange={(v) => setClinic((p) => ({ ...p, secondary_color: v }))}
                                    hint="Optional. Default: #64748B"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-slate-100 pt-4">
                        <SubHeading>Address and contact</SubHeading>
                        <div className="space-y-4">
                            <Field label="Address line 1">
                                <TextInput {...c('address_line_1')} placeholder="Street address" />
                            </Field>
                            <Field label="Address line 2">
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
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field label="Phone">
                                    <TextInput {...c('phone')} placeholder="+91 XXXXXXXXXX" />
                                </Field>
                                <Field label="Email">
                                    <TextInput type="email" {...c('email')} placeholder="clinic@clinic.com" />
                                </Field>
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-slate-100 pt-4">
                        <SubHeading>Booking</SubHeading>
                        <div className="space-y-3">
                            <div className="divide-y divide-slate-100">
                                <Toggle checked={clinic.walkin_enabled} onChange={(v) => setClinic((p) => ({ ...p, walkin_enabled: v }))} label="Walk-in enabled" />
                                <Toggle checked={clinic.token_system_enabled} onChange={(v) => setClinic((p) => ({ ...p, token_system_enabled: v }))} label="Token system enabled" />
                            </div>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field label="Max advance booking days">
                                    <TextInput type="number" {...c('max_advance_booking_days')} placeholder="30" />
                                </Field>
                                <Field label="Min booking notice (minutes)">
                                    <TextInput type="number" {...c('min_booking_notice_minutes')} placeholder="30" />
                                </Field>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end border-t border-slate-100 pt-4">
                        <button
                            type="button"
                            onClick={continueToPlan}
                            disabled={saving}
                            className={btn.primary}
                        >
                            {saving ? 'Continuing…' : 'Continue ›'}
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
                <SectionCard title="Clinic admin account" subtitle="This person will manage the clinic and have full access.">
                    <Field label="Full name" required>
                        <TextInput {...a('full_name')} placeholder="Clinic Admin Name" />
                    </Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

                    <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-4">
                        <button type="button" onClick={() => { setError(''); setStep(2); }} className={btn.secondary}>
                            ‹ Back
                        </button>
                        <button
                            type="button"
                            onClick={createAdmin}
                            disabled={saving}
                            className={btn.primary}
                        >
                            {saving ? 'Finishing…' : 'Finish onboarding'}
                        </button>
                    </div>
                </SectionCard>
            )}
        </div>
    );
}
