import { useEffect, useState } from 'react';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import StatusBadge from '../../components/StatusBadge';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, btn } from '../../components/ui';
import { useScope } from '../../context/ScopeContext';
import { formatDate, formatDateTime } from '../../utils/dateFormat';
import { formatINR } from '../../utils/money';

function limitLabel(value) {
    return value == null ? 'Unlimited' : String(value);
}

function statusDateLine(subscription) {
    if (!subscription) return null;
    const { status, trial_ends_at, current_period_end, grace_ends_at, razorpay_subscription_id } = subscription;
    switch (status) {
        case 'trialing':
            if (razorpay_subscription_id) return `Autopay set up — first charge on ${trial_ends_at ? formatDate(trial_ends_at) : 'trial end'}`;
            return trial_ends_at ? `Trial ends ${formatDate(trial_ends_at)}` : 'Trial active';
        case 'active':
            if (razorpay_subscription_id) return current_period_end ? `Autopay active — renews ${formatDate(current_period_end)}` : 'Autopay active';
            return current_period_end ? `Renews ${formatDate(current_period_end)}` : null;
        case 'pending_payment':
        case 'past_due':
            return grace_ends_at ? `Payment due — access ends ${formatDate(grace_ends_at)}` : 'Payment due';
        case 'expired':
            return 'Expired';
        case 'cancelled':
            return current_period_end ? `Cancelled — access until ${formatDate(current_period_end)}` : 'Cancelled';
        default:
            return null;
    }
}

function UsageBar({ label, used, limit }) {
    const value = Number(used) || 0;
    const unlimited = limit == null;
    const pct = unlimited || !limit ? 0 : Math.min(100, Math.round((value / limit) * 100));
    const barColor = pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-blue-600';
    return (
        <div>
            <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-slate-900">{label}</span>
                <span className="tabular-nums text-slate-600">{value} / {unlimited ? 'Unlimited' : limit}</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                {!unlimited && <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />}
            </div>
        </div>
    );
}

const loadCheckoutScript = () => new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Razorpay Checkout.'));
    document.body.appendChild(s);
});

export default function ClinicSubscriptionPage() {
    const scope = useScope();
    const isAdmin = Boolean(scope?.can?.('subscription.manage'));

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const [selectedPlanId, setSelectedPlanId] = useState(null);
    const [cycle, setCycle] = useState('monthly');
    const [paying, setPaying] = useState(false);

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await client.get('/clinic/subscription');
            const d = res.data?.data || null;
            setData(d);
            setSelectedPlanId(d?.plan?.id ?? d?.plans?.[0]?.id ?? null);
            setCycle(d?.subscription?.billing_cycle || 'monthly');
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to load subscription');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const subscription = data?.subscription || null;
    const plan = data?.plan || null;
    const usage = data?.usage || {};
    const limits = data?.limits || {};
    const plans = Array.isArray(data?.plans) ? data.plans : [];
    const transactions = Array.isArray(data?.transactions) ? data.transactions : [];
    const selectedPlan = plans.find((p) => p.id === selectedPlanId) || null;
    // Autopay already set up through Razorpay: no second checkout.
    const autopayLinked = Boolean(subscription?.razorpay_subscription_id)
        && ['trialing', 'active'].includes(subscription?.status);

    const selectPlan = (p) => {
        setSelectedPlanId(p.id);
        if (cycle === 'yearly' && !p.yearly_price) setCycle('monthly');
    };

    const pay = async () => {
        setError('');
        setNotice('');
        if (!selectedPlanId) {
            setError('Choose a plan first.');
            return;
        }
        setPaying(true);
        try {
            await loadCheckoutScript();
            const { data: checkoutRes } = await client.post('/clinic/subscription/checkout', {
                plan_id: selectedPlanId,
                billing_cycle: cycle,
            });
            const c = checkoutRes.data;
            const rzp = new window.Razorpay({
                key: c.key_id,
                subscription_id: c.subscription_id,
                name: c.name,
                description: 'Clinic subscription',
                prefill: { email: c.email || '', contact: c.phone || '' },
                handler: async (resp) => {
                    try {
                        const { data: verifyRes } = await client.post('/clinic/subscription/verify', resp);
                        const verified = verifyRes?.data || null;
                        await Promise.all([load(), scope?.refresh?.()]);
                        setNotice(verified?.status === 'trialing'
                            ? `Autopay set up. First charge on ${formatDate(verified.trial_ends_at)}.`
                            : 'Payment received. Your subscription is active.');
                    } catch (e) {
                        // Payment may still have been captured even though verification
                        // failed (422 or a network blip) — reload the subscription data
                        // and scope context so the admin doesn't act on stale state, then
                        // surface the error last since load() clears it on entry. Use
                        // allSettled (not all) so a reload failure can never swallow the
                        // verify error — setError(message) below always runs regardless
                        // of whether load()/refresh() themselves succeed or reject, and it
                        // runs after load()'s own error handling so this message wins.
                        const message = e?.response?.data?.message || 'Payment could not be verified. If money was deducted, it will be confirmed shortly.';
                        await Promise.allSettled([load(), scope?.refresh?.()]);
                        setError(message);
                    }
                },
                modal: { ondismiss: () => setPaying(false) },
            });
            rzp.on('payment.failed', (r) => setError(r?.error?.description || 'Payment failed.'));
            rzp.open();
        } catch (e) {
            setError(e?.response?.data?.message || e.message || 'Could not start payment.');
        } finally {
            setPaying(false);
        }
    };

    if (loading) return <Spinner />;

    return (
        <div className="mx-auto max-w-5xl space-y-5">
            <PageHeader title="Subscription" subtitle="Plan, usage and billing for your clinic." />

            {error && <Alert>{error}</Alert>}
            {notice && <Alert tone="success">{notice}</Alert>}

            <Card title="Current plan" bodyClassName={!subscription && !plan ? '' : 'p-5'}>
                {!subscription && !plan ? (
                    <EmptyState icon="credit-card" title="No plan assigned yet">Contact support.</EmptyState>
                ) : (
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <p className="text-lg font-bold text-slate-900">{plan?.name || '—'}</p>
                            <p className="mt-0.5 text-sm text-slate-600 first-letter:uppercase">{subscription?.billing_cycle || '—'} billing</p>
                        </div>
                        <div className="flex flex-col items-start gap-1.5 sm:items-end">
                            <StatusBadge status={subscription?.status} />
                            {statusDateLine(subscription) && (
                                <p className="text-sm text-slate-600">{statusDateLine(subscription)}</p>
                            )}
                        </div>
                    </div>
                )}
            </Card>

            <Card title="Usage" description="Current usage against your plan limits." bodyClassName="space-y-4 p-5">
                <UsageBar label="Doctors" used={usage.doctors} limit={limits.doctors} />
                <UsageBar label="Staff users" used={usage.staff} limit={limits.staff} />
                <UsageBar label="Appointments this month" used={usage.appointments} limit={limits.appointments} />
            </Card>

            <Card title="Choose plan" description="Pick a plan and billing cycle." bodyClassName={plans.length ? 'p-5' : ''}>
                {!plans.length ? (
                    <EmptyState icon="credit-card" title="No plans are available right now" />
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {plans.map((p) => {
                                const isSelected = p.id === selectedPlanId;
                                const isCurrent = Boolean(plan && p.id === plan.id);
                                return (
                                    <button
                                        type="button"
                                        key={p.id}
                                        onClick={() => selectPlan(p)}
                                        aria-pressed={isSelected}
                                        className={`rounded-xl border p-4 text-left transition-colors ${isSelected ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                                            {isCurrent && <Badge tone="green">Current plan</Badge>}
                                        </div>
                                        {p.description && <p className="mt-1 text-sm text-slate-600">{p.description}</p>}
                                        <p className="mt-2 text-sm font-semibold text-slate-900">
                                            {formatINR(p.monthly_price)}/mo
                                            {p.yearly_price != null && <span className="font-normal text-slate-700"> · {formatINR(p.yearly_price)}/yr</span>}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-600">
                                            {limitLabel(p.max_doctors)} doctors · {limitLabel(p.max_staff)} staff · {limitLabel(p.max_appointments_per_month)} appts/mo
                                        </p>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                            <div role="group" aria-label="Billing cycle" className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                                <button
                                    type="button"
                                    aria-pressed={cycle === 'monthly'}
                                    onClick={() => setCycle('monthly')}
                                    className={`h-8 rounded-lg px-3 text-sm ${cycle === 'monthly' ? 'bg-slate-900 font-semibold text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                                >
                                    Monthly
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={cycle === 'yearly'}
                                    disabled={!selectedPlan?.yearly_price}
                                    onClick={() => setCycle('yearly')}
                                    title={!selectedPlan?.yearly_price ? 'This plan has no yearly price' : undefined}
                                    className={`h-8 rounded-lg px-3 text-sm disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent ${cycle === 'yearly' ? 'bg-slate-900 font-semibold text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                                >
                                    Yearly
                                </button>
                            </div>

                            {isAdmin && autopayLinked && (
                                <span className="text-sm text-slate-600">{statusDateLine(subscription)}</span>
                            )}
                            {isAdmin && !autopayLinked && (
                                <div className="flex flex-col items-start gap-1 sm:items-end">
                                    <button type="button" className={btn.primary} onClick={pay} disabled={paying || !data?.payments_configured || !selectedPlanId}>
                                        <AppIcon name="credit-card" className="h-4 w-4" />
                                        {paying ? 'Processing…' : 'Pay with Razorpay'}
                                    </button>
                                    {!data?.payments_configured && (
                                        <span className="text-xs text-slate-600">Online payments are not configured yet. Contact support.</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </Card>

            <Card title="Payment history" bodyClassName="">
                {!transactions.length ? (
                    <EmptyState icon="file-text" title="No payments recorded yet" />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[700px] text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-left text-xs font-medium text-slate-600">
                                    <th className="px-4 py-3">Date</th>
                                    <th className="px-4 py-3">Plan</th>
                                    <th className="px-4 py-3">Amount</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Method</th>
                                    <th className="px-4 py-3">Invoice</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transactions.map((t) => (
                                    <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(t.paid_at || t.created_at)}</td>
                                        <td className="px-4 py-3 text-slate-900">{t.plan?.name || '—'}</td>
                                        <td className="px-4 py-3 font-semibold tabular-nums text-slate-900">{formatINR(t.amount)}</td>
                                        <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                                        <td className="px-4 py-3 capitalize text-slate-700">{t.method || '—'}</td>
                                        <td className="px-4 py-3">
                                            {t.invoice_url ? (
                                                <a href={t.invoice_url} target="_blank" rel="noreferrer" className={btn.link}>View</a>
                                            ) : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}
