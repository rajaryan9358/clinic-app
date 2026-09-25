import { useEffect, useState } from 'react';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';

const TABS = [
    { key: 'openai',    label: 'AI / OpenAI',         icon: 'activity' },
    { key: 'payments',  label: 'Payments',            icon: 'settings' },
    { key: 'trial',     label: 'Trial Settings',      icon: 'settings' },
];

function Card({ children, className = '' }) {
    return <div className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

function SectionTitle({ title, subtitle }) {
    return (
        <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
        </div>
    );
}

function Field({ label, hint, children }) {
    return (
        <div>
            <label className="mb-1.5 block text-sm font-semibold text-gray-700">{label}</label>
            {children}
            {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
        </div>
    );
}

const inputCls = 'w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

// ── OpenAI / AI Tab ────────────────────────────────────────────────────────────
function OpenAITab() {
    const [form, setForm] = useState({ openai_api_key: '', openai_model: 'gpt-4o-mini' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        client.get('/super-admin/settings/system')
            .then((res) => {
                const d = res.data?.data || {};
                setForm({ openai_api_key: d.openai_api_key || '', openai_model: d.openai_model || 'gpt-4o-mini' });
            })
            .catch(() => { /* endpoint may not exist yet */ })
            .finally(() => setLoading(false));
    }, []);

    const save = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            await client.post('/super-admin/settings/system', form);
            setSuccess('AI settings saved.');
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to save — endpoint may not be available yet.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="flex justify-center py-10"><span className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>;

    return (
        <Card>
            <SectionTitle title="OpenAI Configuration" subtitle="Powers AI prescription generation and review reply suggestions." />
            {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {success && <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p>}
            <form onSubmit={save} className="space-y-4 max-w-lg">
                <Field label="OpenAI API Key" hint="Stored securely. Leave blank to keep existing.">
                    <input
                        className={inputCls}
                        type="password"
                        placeholder="sk-proj-…"
                        value={form.openai_api_key}
                        onChange={(e) => setForm((p) => ({ ...p, openai_api_key: e.target.value }))}
                    />
                </Field>
                <Field label="Model">
                    <select className={inputCls} value={form.openai_model} onChange={(e) => setForm((p) => ({ ...p, openai_model: e.target.value }))}>
                        {['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'].map((m) => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>
                </Field>
                <div className="flex justify-end pt-2">
                    <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                        {saving ? 'Saving…' : 'Save AI Settings'}
                    </button>
                </div>
            </form>
        </Card>
    );
}

// ── Trial Settings Tab ─────────────────────────────────────────────────────────
function TrialTab() {
    const [form, setForm] = useState({ trial_days: 14 });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        client.get('/super-admin/settings/system')
            .then((res) => {
                const d = res.data?.data || {};
                setForm({ trial_days: d.trial_days ?? 14 });
            })
            .catch(() => { /* endpoint may not exist yet */ })
            .finally(() => setLoading(false));
    }, []);

    const save = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            await client.post('/super-admin/settings/system', form);
            setSuccess('Trial settings saved.');
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to save — endpoint may not be available yet.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="flex justify-center py-10"><span className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>;

    return (
        <Card>
            <SectionTitle title="Free Trial Settings" subtitle="Default trial configuration for newly onboarded clinics." />
            {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {success && <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p>}
            <form onSubmit={save} className="space-y-4 max-w-md">
                <Field label="Default trial length (days)" hint="Number of days new clinics get on a free trial by default.">
                    <input
                        type="number"
                        min={1}
                        max={365}
                        className="w-32 rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        value={form.trial_days}
                        onChange={(e) => setForm((p) => ({ ...p, trial_days: Number(e.target.value) }))}
                    />
                </Field>
                <div className="flex justify-end pt-2">
                    <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                        {saving ? 'Saving…' : 'Save Trial Settings'}
                    </button>
                </div>
            </form>
        </Card>
    );
}

// ── Payments Tab ──────────────────────────────────────────────────────────────
function PaymentsTab() {
    const [form, setForm] = useState({
        razorpay_key_id: '',
        razorpay_key_secret: '',
        razorpay_webhook_secret: '',
        razorpay_mode: 'test',
        subscription_grace_days: 3,
    });
    const [keySecretSet, setKeySecretSet] = useState(false);
    const [webhookSecretSet, setWebhookSecretSet] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState('');
    const [copyMsg, setCopyMsg] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(true);

    const load = () => {
        setLoading(true);
        client.get('/super-admin/settings/system')
            .then((res) => {
                const d = res.data?.data || {};
                setForm({
                    razorpay_key_id: d.razorpay_key_id || '',
                    razorpay_key_secret: '',
                    razorpay_webhook_secret: '',
                    razorpay_mode: d.razorpay_mode || 'test',
                    subscription_grace_days: d.subscription_grace_days ?? 3,
                });
                setKeySecretSet(Boolean(d.razorpay_key_secret_set));
                setWebhookSecretSet(Boolean(d.razorpay_webhook_secret_set));
                setWebhookUrl(d.webhook_url || '');
            })
            .catch(() => { /* endpoint may not exist yet */ })
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    const save = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            const payload = {
                razorpay_key_id: form.razorpay_key_id,
                razorpay_mode: form.razorpay_mode,
                subscription_grace_days: Number(form.subscription_grace_days),
            };
            if (String(form.razorpay_key_secret || '').trim()) {
                payload.razorpay_key_secret = form.razorpay_key_secret.trim();
            }
            if (String(form.razorpay_webhook_secret || '').trim()) {
                payload.razorpay_webhook_secret = form.razorpay_webhook_secret.trim();
            }
            await client.post('/super-admin/settings/system', payload);
            setSuccess('Payment settings saved.');
            load();
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to save — endpoint may not be available yet.');
        } finally {
            setSaving(false);
        }
    };

    const copyWebhookUrl = async () => {
        try {
            await navigator.clipboard.writeText(webhookUrl);
            setCopyMsg('Copied!');
            setTimeout(() => setCopyMsg(''), 2000);
        } catch {
            setCopyMsg('Could not copy — copy it manually.');
            setTimeout(() => setCopyMsg(''), 3000);
        }
    };

    if (loading) return <div className="flex justify-center py-10"><span className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>;

    return (
        <Card>
            <SectionTitle title="Razorpay Configuration" subtitle="Credentials and behavior for subscription billing via Razorpay." />
            {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {success && <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p>}
            <form onSubmit={save} className="space-y-4 max-w-lg">
                <Field label="Razorpay Key ID">
                    <input
                        className={inputCls}
                        type="text"
                        placeholder="rzp_test_…"
                        value={form.razorpay_key_id}
                        onChange={(e) => setForm((p) => ({ ...p, razorpay_key_id: e.target.value }))}
                    />
                </Field>
                <Field label="Key Secret" hint={keySecretSet ? 'Saved — leave blank to keep.' : 'Not set yet.'}>
                    <input
                        className={inputCls}
                        type="password"
                        placeholder={keySecretSet ? 'Saved — leave blank to keep' : 'Key secret'}
                        value={form.razorpay_key_secret}
                        onChange={(e) => setForm((p) => ({ ...p, razorpay_key_secret: e.target.value }))}
                    />
                </Field>
                <Field label="Webhook Secret" hint={webhookSecretSet ? 'Saved — leave blank to keep.' : 'Not set yet.'}>
                    <input
                        className={inputCls}
                        type="password"
                        placeholder={webhookSecretSet ? 'Saved — leave blank to keep' : 'Webhook secret'}
                        value={form.razorpay_webhook_secret}
                        onChange={(e) => setForm((p) => ({ ...p, razorpay_webhook_secret: e.target.value }))}
                    />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Mode">
                        <select
                            className={inputCls}
                            value={form.razorpay_mode}
                            onChange={(e) => setForm((p) => ({ ...p, razorpay_mode: e.target.value }))}
                        >
                            <option value="test">Test</option>
                            <option value="live">Live</option>
                        </select>
                    </Field>
                    <Field label="Grace period (days)" hint="Days after a failed charge before access is blocked.">
                        <input
                            type="number"
                            min={0}
                            max={30}
                            className={inputCls}
                            value={form.subscription_grace_days}
                            onChange={(e) => setForm((p) => ({ ...p, subscription_grace_days: e.target.value }))}
                        />
                    </Field>
                </div>
                <Field label="Webhook URL">
                    <div className="flex items-center gap-2">
                        <input className={`${inputCls} bg-gray-50 text-gray-600`} type="text" value={webhookUrl} readOnly />
                        <button
                            type="button"
                            onClick={copyWebhookUrl}
                            className="whitespace-nowrap rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                            Copy
                        </button>
                    </div>
                    {copyMsg && <p className="mt-1 text-xs text-gray-500">{copyMsg}</p>}
                    <p className="mt-2 text-xs text-gray-400">
                        In the Razorpay dashboard, add this URL as a webhook and enable: subscription.activated, subscription.charged, subscription.pending, subscription.halted, subscription.cancelled, subscription.completed, payment.failed.
                    </p>
                </Field>
                <div className="flex justify-end pt-2">
                    <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                        {saving ? 'Saving…' : 'Save Payment Settings'}
                    </button>
                </div>
            </form>
        </Card>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SystemSettingsPage() {
    const [activeTab, setActiveTab] = useState('openai');

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-xl font-bold text-gray-900">System Settings</h1>
                <p className="mt-0.5 text-sm text-gray-500">Global configuration for AI integrations and trial settings.</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-gray-200">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                            activeTab === tab.key
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-900'
                        }`}
                    >
                        <AppIcon name={tab.icon} className="h-4 w-4" />
                        {tab.label}
                    </button>
                ))}
            </div>

            <div>
                {activeTab === 'openai' && <OpenAITab />}
                {activeTab === 'payments' && <PaymentsTab />}
                {activeTab === 'trial' && <TrialTab />}
            </div>
        </div>
    );
}
