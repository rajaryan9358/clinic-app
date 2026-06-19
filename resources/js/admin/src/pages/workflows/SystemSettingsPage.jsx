import { useEffect, useState } from 'react';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';

const TABS = [
    { key: 'openai',    label: 'AI / OpenAI',         icon: 'activity' },
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
    const [form, setForm] = useState({ trial_days: 14, trial_enabled: true });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        client.get('/super-admin/settings/system')
            .then((res) => {
                const d = res.data?.data || {};
                setForm({ trial_days: d.trial_days ?? 14, trial_enabled: d.trial_enabled ?? true });
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

    const toggle = () => setForm((p) => ({ ...p, trial_enabled: !p.trial_enabled }));

    return (
        <Card>
            <SectionTitle title="Free Trial Settings" subtitle="Default trial configuration for newly onboarded clinics." />
            {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {success && <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p>}
            <form onSubmit={save} className="space-y-4 max-w-md">
                <label className="flex cursor-pointer items-center gap-3">
                    <div className="relative">
                        <input type="checkbox" checked={Boolean(form.trial_enabled)} onChange={toggle} className="sr-only" />
                        <div className={`flex h-5 w-9 items-center rounded-full transition-colors ${form.trial_enabled ? 'bg-blue-600' : 'bg-gray-200'}`}>
                            <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${form.trial_enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </div>
                    </div>
                    <span className="text-sm font-semibold text-gray-700">Enable free trial for new clinics</span>
                </label>
                <Field label="Trial Duration (days)" hint="Number of days new clinics get before requiring a subscription.">
                    <input
                        type="number"
                        min={1}
                        max={365}
                        className="w-32 rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        value={form.trial_days}
                        onChange={(e) => setForm((p) => ({ ...p, trial_days: Number(e.target.value) }))}
                        disabled={!form.trial_enabled}
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
                {activeTab === 'trial' && <TrialTab />}
            </div>
        </div>
    );
}
