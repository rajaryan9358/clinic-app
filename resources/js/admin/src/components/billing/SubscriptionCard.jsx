import { useEffect, useState } from 'react';
import client from '../../api/client';
import AppIcon from '../AppIcon';
import StatusBadge from '../StatusBadge';
import { formatDate } from '../../utils/dateFormat';
import { formatINR, toPaise } from '../../utils/money';
import { Btn, Card, ErrorText, Field, SectionHeader, TextInput } from './ui.jsx';

function limitLabel(value) {
    return value == null || value === '' ? 'Unlimited' : String(value);
}

// ── Plan picker used by both "Assign plan" (no subscription yet) and
// "Change plan" (existing subscription, no Razorpay link). ──────────────────
function PlanPicker({ plans, planId, billingCycle, onSelectPlan, onSelectCycle }) {
    const selected = plans.find((p) => p.id === planId) || null;
    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {plans.map((plan) => {
                    const active = plan.id === planId;
                    return (
                        <button
                            type="button"
                            key={plan.id}
                            onClick={() => onSelectPlan(plan)}
                            className={`rounded-xl border p-3 text-left transition-colors ${active ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-gray-900">{plan.name}</p>
                                {active && <AppIcon name="check" className="h-4 w-4 text-blue-600" />}
                            </div>
                            <p className="mt-1 text-xs text-gray-600">
                                {formatINR(plan.monthly_price)}/mo
                                {plan.yearly_price != null && <> · {formatINR(plan.yearly_price)}/yr</>}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                                {limitLabel(plan.max_doctors)} doctors · {limitLabel(plan.max_staff)} staff · {limitLabel(plan.max_appointments_per_month)} appts/mo
                            </p>
                        </button>
                    );
                })}
            </div>

            {selected && (
                <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
                    <button
                        type="button"
                        onClick={() => onSelectCycle('monthly')}
                        className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${billingCycle === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                    >
                        Monthly
                    </button>
                    <button
                        type="button"
                        disabled={!selected.yearly_price}
                        onClick={() => onSelectCycle('yearly')}
                        title={!selected.yearly_price ? 'This plan has no yearly price' : undefined}
                        className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:text-gray-300 ${billingCycle === 'yearly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                    >
                        Yearly
                    </button>
                </div>
            )}
        </div>
    );
}

// ── Assign plan (no subscription yet) ────────────────────────────────────────
function AssignPlanPanel({ clinicId, plans, onDone }) {
    const [form, setForm] = useState({
        plan_id: null,
        billing_cycle: 'monthly',
        start_mode: 'trial',
        trial_days: 14,
        offline_amount: '',
        offline_period_months: '1',
        offline_notes: '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const selectedPlan = plans.find((p) => p.id === form.plan_id) || null;

    const submit = async () => {
        if (!form.plan_id) { setError('Choose a plan.'); return; }
        if (form.start_mode === 'paid_offline' && !String(form.offline_amount ?? '').trim()) {
            setError('Enter the amount paid offline.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            const payload = {
                plan_id: form.plan_id,
                billing_cycle: form.billing_cycle,
                start_mode: form.start_mode,
            };
            if (form.start_mode === 'trial') {
                const days = Number(form.trial_days);
                if (Number.isFinite(days) && days > 0) payload.trial_days = days;
            }
            if (form.start_mode === 'paid_offline') {
                payload.offline_amount = toPaise(form.offline_amount);
                const months = Number(form.offline_period_months);
                payload.offline_period_months = Number.isFinite(months) && months > 0 ? months : 1;
                if (String(form.offline_notes || '').trim()) payload.offline_notes = form.offline_notes.trim();
            }
            await client.post(`/super-admin/clinics/${clinicId}/subscription`, payload);
            onDone();
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to assign plan');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <PlanPicker
                plans={plans}
                planId={form.plan_id}
                billingCycle={form.billing_cycle}
                onSelectPlan={(plan) => setForm((p) => ({
                    ...p,
                    plan_id: plan.id,
                    billing_cycle: p.billing_cycle === 'yearly' && !plan.yearly_price ? 'monthly' : p.billing_cycle,
                }))}
                onSelectCycle={(cycle) => setForm((p) => ({ ...p, billing_cycle: cycle }))}
            />

            {selectedPlan && (
                <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="radio" checked={form.start_mode === 'trial'} onChange={() => setForm((p) => ({ ...p, start_mode: 'trial' }))} />
                        Start a free trial
                    </label>
                    {form.start_mode === 'trial' && (
                        <div className="max-w-[160px] pl-6">
                            <Field label="Trial length (days)">
                                <TextInput type="number" value={form.trial_days} onChange={(v) => setForm((p) => ({ ...p, trial_days: v }))} />
                            </Field>
                        </div>
                    )}
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="radio" checked={form.start_mode === 'pending_payment'} onChange={() => setForm((p) => ({ ...p, start_mode: 'pending_payment' }))} />
                        Payment pending (clinic admin pays on first login)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="radio" checked={form.start_mode === 'paid_offline'} onChange={() => setForm((p) => ({ ...p, start_mode: 'paid_offline' }))} />
                        Paid offline
                    </label>
                    {form.start_mode === 'paid_offline' && (
                        <div className="grid grid-cols-2 gap-3 pl-6">
                            <Field label="Amount (₹)" required>
                                <TextInput type="number" value={form.offline_amount} onChange={(v) => setForm((p) => ({ ...p, offline_amount: v }))} />
                            </Field>
                            <Field label="Period (months)">
                                <TextInput type="number" value={form.offline_period_months} onChange={(v) => setForm((p) => ({ ...p, offline_period_months: v }))} />
                            </Field>
                            <div className="col-span-2">
                                <Field label="Notes">
                                    <TextInput value={form.offline_notes} onChange={(v) => setForm((p) => ({ ...p, offline_notes: v }))} placeholder="Cheque number, reference, etc." />
                                </Field>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <ErrorText>{error}</ErrorText>

            <Btn variant="primary" onClick={submit} disabled={saving}>
                {saving ? 'Assigning…' : 'Assign Plan'}
            </Btn>
        </div>
    );
}

// ── Change plan (existing subscription, no Razorpay link) ───────────────────
function ChangePlanPanel({ clinicId, plans, subscription, onDone, onCancel }) {
    const [planId, setPlanId] = useState(subscription.plan_id);
    const [cycle, setCycle] = useState(subscription.billing_cycle || 'monthly');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async () => {
        if (!planId) { setError('Choose a plan.'); return; }
        setSaving(true);
        setError('');
        try {
            await client.put(`/super-admin/clinics/${clinicId}/subscription`, { plan_id: planId, billing_cycle: cycle });
            onDone();
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to change plan');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            <PlanPicker
                plans={plans}
                planId={planId}
                billingCycle={cycle}
                onSelectPlan={(plan) => { setPlanId(plan.id); if (cycle === 'yearly' && !plan.yearly_price) setCycle('monthly'); }}
                onSelectCycle={setCycle}
            />
            <ErrorText>{error}</ErrorText>
            <div className="flex gap-2">
                <Btn variant="primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Change Plan'}</Btn>
                <Btn onClick={onCancel} disabled={saving}>Cancel</Btn>
            </div>
        </div>
    );
}

// ── Extend trial / grace (shared shape) ──────────────────────────────────────
function ExtendDaysPanel({ clinicId, endpoint, max, label, onDone, onCancel }) {
    const [days, setDays] = useState('7');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async () => {
        const n = Number(days);
        if (!Number.isFinite(n) || n < 1) { setError('Enter a number of days.'); return; }
        setSaving(true);
        setError('');
        try {
            await client.post(`/super-admin/clinics/${clinicId}/subscription/${endpoint}`, { days: n });
            onDone();
        } catch (e) {
            setError(e?.response?.data?.message || `Failed to ${label.toLowerCase()}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="max-w-[160px]">
                <Field label={`Days (max ${max})`}>
                    <TextInput type="number" value={days} onChange={setDays} />
                </Field>
            </div>
            <ErrorText>{error}</ErrorText>
            <div className="flex gap-2">
                <Btn variant="primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : label}</Btn>
                <Btn onClick={onCancel} disabled={saving}>Cancel</Btn>
            </div>
        </div>
    );
}

// ── Record offline payment ───────────────────────────────────────────────────
function OfflinePaymentPanel({ clinicId, onDone, onCancel }) {
    const [amount, setAmount] = useState('');
    const [months, setMonths] = useState('1');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async () => {
        const paise = toPaise(amount);
        if (!paise || paise < 1) { setError('Enter a valid amount.'); return; }
        const m = Number(months);
        if (!Number.isFinite(m) || m < 1) { setError('Enter a valid number of months.'); return; }
        setSaving(true);
        setError('');
        try {
            await client.post(`/super-admin/clinics/${clinicId}/subscription/offline-payment`, {
                amount: paise,
                period_months: m,
                notes: notes.trim() || undefined,
            });
            onDone();
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to record payment');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
                <Field label="Amount (₹)" required>
                    <TextInput type="number" value={amount} onChange={setAmount} />
                </Field>
                <Field label="Period (months)">
                    <TextInput type="number" value={months} onChange={setMonths} />
                </Field>
            </div>
            <Field label="Notes">
                <TextInput value={notes} onChange={setNotes} placeholder="Cheque number, reference, etc." />
            </Field>
            <ErrorText>{error}</ErrorText>
            <div className="flex gap-2">
                <Btn variant="primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Record Payment'}</Btn>
                <Btn onClick={onCancel} disabled={saving}>Cancel</Btn>
            </div>
        </div>
    );
}

// ── Cancel subscription (inline confirm — no window.confirm) ────────────────
function CancelPanel({ clinicId, onDone, onCancel }) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const confirmCancel = async () => {
        setSaving(true);
        setError('');
        try {
            await client.post(`/super-admin/clinics/${clinicId}/subscription/cancel`);
            onDone();
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to cancel subscription');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            <p className="text-sm text-gray-700">This cancels the clinic's subscription immediately. This cannot be undone.</p>
            <ErrorText>{error}</ErrorText>
            <div className="flex gap-2">
                <Btn variant="danger" onClick={confirmCancel} disabled={saving}>{saving ? 'Cancelling…' : 'Yes, cancel subscription'}</Btn>
                <Btn onClick={onCancel} disabled={saving}>Keep subscription</Btn>
            </div>
        </div>
    );
}

// ── Main card ─────────────────────────────────────────────────────────────────
export default function SubscriptionCard({ clinicId, subscription, onChanged }) {
    const [plans, setPlans] = useState([]);
    const [action, setAction] = useState(null); // null | 'assign' | 'change' | 'extend-trial' | 'extend-grace' | 'offline' | 'cancel'

    useEffect(() => {
        client.get('/super-admin/plans', { params: { active: 1 } })
            .then((res) => setPlans(Array.isArray(res.data?.data) ? res.data.data : []))
            .catch(() => { /* plan pickers show empty; actions requiring plans will surface their own error */ });
    }, []);

    const close = () => setAction(null);
    const done = () => { setAction(null); onChanged?.(); };

    const linkedToRazorpay = Boolean(subscription?.razorpay_subscription_id);

    return (
        <Card className="p-5">
            <SectionHeader
                title="Subscription"
                subtitle={subscription ? 'Plan, billing status and payment actions for this clinic.' : undefined}
            />

            {!subscription ? (
                <div className="space-y-4">
                    <p className="text-sm text-gray-400">No plan assigned.</p>
                    {action === 'assign' ? (
                        <AssignPlanPanel clinicId={clinicId} plans={plans} onDone={done} />
                    ) : (
                        <Btn variant="primary" onClick={() => setAction('assign')}>
                            <AppIcon name="plus" className="h-3.5 w-3.5" /> Assign plan
                        </Btn>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                        <div className="flex items-start gap-4 border-b border-gray-100 py-2 last:border-0">
                            <span className="w-32 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">Plan</span>
                            <span className="text-sm text-gray-800">{subscription.plan?.name || '—'}</span>
                        </div>
                        <div className="flex items-start gap-4 border-b border-gray-100 py-2 last:border-0">
                            <span className="w-32 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">Cycle</span>
                            <span className="text-sm capitalize text-gray-800">{subscription.billing_cycle || '—'}</span>
                        </div>
                        <div className="flex items-start gap-4 border-b border-gray-100 py-2 last:border-0">
                            <span className="w-32 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">Status</span>
                            <StatusBadge status={subscription.status} />
                        </div>
                        {subscription.trial_ends_at && (
                            <div className="flex items-start gap-4 border-b border-gray-100 py-2 last:border-0">
                                <span className="w-32 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">Trial ends</span>
                                <span className="text-sm text-gray-800">{formatDate(subscription.trial_ends_at)}</span>
                            </div>
                        )}
                        {subscription.current_period_end && (
                            <div className="flex items-start gap-4 border-b border-gray-100 py-2 last:border-0">
                                <span className="w-32 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">Period ends</span>
                                <span className="text-sm text-gray-800">{formatDate(subscription.current_period_end)}</span>
                            </div>
                        )}
                        {subscription.grace_ends_at && (
                            <div className="flex items-start gap-4 border-b border-gray-100 py-2 last:border-0">
                                <span className="w-32 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">Grace ends</span>
                                <span className="text-sm text-gray-800">{formatDate(subscription.grace_ends_at)}</span>
                            </div>
                        )}
                        {subscription.razorpay_subscription_id && (
                            <div className="flex items-start gap-4 border-b border-gray-100 py-2 last:border-0">
                                <span className="w-32 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">Razorpay ID</span>
                                <span className="font-mono text-xs text-gray-600">{subscription.razorpay_subscription_id}</span>
                            </div>
                        )}
                    </div>

                    {!action && (
                        <div className="flex flex-wrap gap-2 pt-1">
                            <span title={linkedToRazorpay ? 'This clinic pays through Razorpay. Cancel the subscription before changing plan.' : undefined}>
                                <Btn onClick={() => setAction('change')} disabled={linkedToRazorpay}>Change plan</Btn>
                            </span>
                            <Btn onClick={() => setAction('extend-trial')}>Extend trial</Btn>
                            <Btn onClick={() => setAction('extend-grace')}>Extend grace</Btn>
                            <Btn onClick={() => setAction('offline')}>Record offline payment</Btn>
                            <Btn variant="danger" onClick={() => setAction('cancel')}>Cancel subscription</Btn>
                        </div>
                    )}

                    {action === 'change' && (
                        <ChangePlanPanel clinicId={clinicId} plans={plans} subscription={subscription} onDone={done} onCancel={close} />
                    )}
                    {action === 'extend-trial' && (
                        <ExtendDaysPanel clinicId={clinicId} endpoint="extend-trial" max={365} label="Extend Trial" onDone={done} onCancel={close} />
                    )}
                    {action === 'extend-grace' && (
                        <ExtendDaysPanel clinicId={clinicId} endpoint="extend-grace" max={60} label="Extend Grace" onDone={done} onCancel={close} />
                    )}
                    {action === 'offline' && (
                        <OfflinePaymentPanel clinicId={clinicId} onDone={done} onCancel={close} />
                    )}
                    {action === 'cancel' && (
                        <CancelPanel clinicId={clinicId} onDone={done} onCancel={close} />
                    )}
                </div>
            )}
        </Card>
    );
}
