import { useEffect, useState } from 'react';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import StatusBadge from '../../components/StatusBadge';
import { Btn, Card, EmptyState, ErrorText, LoadingState, SectionHeader, SuccessText } from '../../components/billing/ui.jsx';
import { useAuth } from '../../context/AuthContext';
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
    const barColor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-blue-500';
    return (
        <div>
            <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-gray-700">{label}</span>
                <span className="text-gray-500">{value} / {unlimited ? 'Unlimited' : limit}</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
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
    const { user } = useAuth();
    const scope = useScope();
    const isAdmin = user?.role === 'clinic_admin';

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

    if (loading) return <LoadingState />;

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-xl font-bold text-gray-900">Subscription</h1>
                <p className="mt-0.5 text-sm text-gray-500">Plan, usage and billing for your clinic.</p>
            </div>

            {error && <ErrorText>{error}</ErrorText>}
            {notice && <SuccessText>{notice}</SuccessText>}

            <Card className="p-5">
                {!subscription && !plan ? (
                    <EmptyState icon="credit-card" text="No plan assigned yet. Contact support." />
                ) : (
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <p className="text-lg font-bold text-gray-900">{plan?.name || '—'}</p>
                            <p className="mt-0.5 text-sm capitalize text-gray-500">{subscription?.billing_cycle || '—'} billing</p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                            <StatusBadge status={subscription?.status} />
                            {statusDateLine(subscription) && (
                                <p className="text-xs text-gray-500">{statusDateLine(subscription)}</p>
                            )}
                        </div>
                    </div>
                )}
            </Card>

            <Card className="p-5">
                <SectionHeader title="Usage" subtitle="Current usage against your plan limits." />
                <div className="space-y-4">
                    <UsageBar label="Doctors" used={usage.doctors} limit={limits.doctors} />
                    <UsageBar label="Staff users" used={usage.staff} limit={limits.staff} />
                    <UsageBar label="Appointments this month" used={usage.appointments} limit={limits.appointments} />
                </div>
            </Card>

            <Card className="p-5">
                <SectionHeader title="Choose plan" subtitle="Pick a plan and billing cycle." />

                {!plans.length ? (
                    <EmptyState icon="credit-card" text="No plans are available right now." />
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
                                        className={`rounded-xl border p-4 text-left transition-colors ${isSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                                            {isCurrent && (
                                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                                    Current plan
                                                </span>
                                            )}
                                        </div>
                                        {p.description && <p className="mt-1 text-xs text-gray-500">{p.description}</p>}
                                        <p className="mt-2 text-sm font-medium text-gray-800">
                                            {formatINR(p.monthly_price)}/mo
                                            {p.yearly_price != null && <> · {formatINR(p.yearly_price)}/yr</>}
                                        </p>
                                        <p className="mt-1 text-xs text-gray-400">
                                            {limitLabel(p.max_doctors)} doctors · {limitLabel(p.max_staff)} staff · {limitLabel(p.max_appointments_per_month)} appts/mo
                                        </p>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
                                <button
                                    type="button"
                                    onClick={() => setCycle('monthly')}
                                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${cycle === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                                >
                                    Monthly
                                </button>
                                <button
                                    type="button"
                                    disabled={!selectedPlan?.yearly_price}
                                    onClick={() => setCycle('yearly')}
                                    title={!selectedPlan?.yearly_price ? 'This plan has no yearly price' : undefined}
                                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:text-gray-300 ${cycle === 'yearly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                                >
                                    Yearly
                                </button>
                            </div>

                            {isAdmin && autopayLinked && (
                                <span className="text-xs text-gray-500">{statusDateLine(subscription)}</span>
                            )}
                            {isAdmin && !autopayLinked && (
                                <div className="flex flex-col items-end gap-1">
                                    <Btn variant="primary" onClick={pay} disabled={paying || !data?.payments_configured || !selectedPlanId}>
                                        <AppIcon name="credit-card" className="h-3.5 w-3.5" />
                                        {paying ? 'Processing…' : 'Pay with Razorpay'}
                                    </Btn>
                                    {!data?.payments_configured && (
                                        <span className="text-xs text-gray-400">Online payments are not configured yet. Contact support.</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </Card>

            <Card className="p-5">
                <SectionHeader title="Payment history" />
                {!transactions.length ? (
                    <EmptyState icon="file-text" text="No payments recorded yet." />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[700px] text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                                    <th className="px-4 py-3">Date</th>
                                    <th className="px-4 py-3">Plan</th>
                                    <th className="px-4 py-3">Amount</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Method</th>
                                    <th className="px-4 py-3">Invoice</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {transactions.map((t) => (
                                    <tr key={t.id}>
                                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDateTime(t.paid_at || t.created_at)}</td>
                                        <td className="px-4 py-3 text-gray-800">{t.plan?.name || '—'}</td>
                                        <td className="px-4 py-3 tabular-nums font-semibold text-gray-900">{formatINR(t.amount)}</td>
                                        <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                                        <td className="px-4 py-3 capitalize text-gray-600">{t.method || '—'}</td>
                                        <td className="px-4 py-3">
                                            {t.invoice_url ? (
                                                <a href={t.invoice_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">View</a>
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
