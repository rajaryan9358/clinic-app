import { useEffect, useState } from 'react';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import { Alert, btn, Card as UiCard, input, PageHeader, Spinner, Tabs } from '../../components/ui';

const TABS = [
    { key: 'openai',    label: 'AI / OpenAI',         icon: 'activity' },
    { key: 'whatsapp',  label: 'WhatsApp',            icon: 'settings' },
    { key: 'payments',  label: 'Payments',            icon: 'settings' },
    { key: 'trial',     label: 'Trial settings',      icon: 'settings' },
];

// Meta template category + body/button parameter order for each notification
// type (see .superpowers/sdd/2026-09-27-whatsapp-notifications/global-constraints.md).
// Categories aren't stored anywhere — booking/reminder/update/prescription
// notifications are transactional (Utility); the OTP template is the only
// one that carries a one-time code, which Meta requires as Authentication.
const TEMPLATE_INFO = {
    booking_confirmed: {
        label: 'Booking confirmed',
        category: 'Utility',
        params: 'Body: patient name, clinic name, doctor name, date (D, d M Y), time (g:i A).',
    },
    appointment_reminder: {
        label: 'Appointment reminder',
        category: 'Utility',
        params: 'Body: patient name, clinic name, doctor name, date (D, d M Y), time (g:i A).',
    },
    appointment_updated: {
        label: 'Appointment updated',
        category: 'Utility',
        params: 'Body: patient name, clinic name, status line ("has been rescheduled to" / "has been cancelled"), date, time.',
    },
    prescription_ready: {
        label: 'Prescription ready',
        category: 'Utility',
        params: 'Header: PDF document (prescription-<appointment id>.pdf). Body: patient name, clinic name, doctor name.',
    },
    login_otp: {
        label: 'Login OTP',
        category: 'Authentication',
        params: 'Body: OTP code. Button (Copy Code, sub_type "url", index 0): OTP code.',
    },
    portal_link: {
        label: 'Portal login link',
        category: 'Utility',
        params: 'Body: 1 patient name, 2 clinic name. URL button: {{1}} = link token; button URL https://<your domain>/portal/login/{{1}}.',
    },
    waitlist_slot_open: {
        label: 'Waitlist slot open',
        category: 'Utility',
        params: 'body: 1 patient, 2 clinic, 3 doctor, 4 date, 5 time, 6 hold minutes · URL button {{1}} = link token; button URL https://<your domain>/portal/login/{{1}}',
    },
    waitlist_slot_taken: {
        label: 'Waitlist held slot booked',
        category: 'Utility',
        params: 'Body: 1 patient, 2 clinic, 3 doctor, 4 date, 5 time. No button. Sent when the clinic books a slot held for a waitlisted patient; they stay on the waitlist.',
    },
};

function Card({ title, subtitle, children }) {
    return <UiCard title={title} description={subtitle}>{children}</UiCard>;
}

// Wrapping label so every field's text is tied to its control.
function Field({ label, hint, children }) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
            {children}
            {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
        </label>
    );
}

const inputCls = input;
const readOnlyCls = `${input} bg-slate-50 text-slate-700`;
const loadingEl = <UiCard><Spinner className="py-10" /></UiCard>;

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

    if (loading) return loadingEl;

    return (
        <Card title="OpenAI configuration" subtitle="Powers AI prescription generation and review reply suggestions.">
            {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
            {success && <div className="mb-4"><Alert tone="success">{success}</Alert></div>}
            <form onSubmit={save} className="max-w-xl space-y-4">
                <Field label="OpenAI API key" hint="Stored securely. Leave blank to keep existing.">
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
                <div className="flex justify-end border-t border-slate-100 pt-4">
                    <button type="submit" disabled={saving} className={btn.primary}>
                        {saving ? 'Saving…' : 'Save AI settings'}
                    </button>
                </div>
            </form>
        </Card>
    );
}

// ── WhatsApp Tab ────────────────────────────────────────────────────────────────
function WhatsAppTab() {
    const [form, setForm] = useState({
        whatsapp_phone_number_id: '',
        whatsapp_waba_id: '',
        whatsapp_graph_version: 'v21.0',
        whatsapp_access_token: '',
        whatsapp_app_secret: '',
        whatsapp_webhook_verify_token: '',
    });
    const [accessTokenSet, setAccessTokenSet] = useState(false);
    const [appSecretSet, setAppSecretSet] = useState(false);
    const [verifyTokenSet, setVerifyTokenSet] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState('');
    const [templates, setTemplates] = useState({});
    const [copyMsg, setCopyMsg] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(true);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);

    const load = () => {
        setLoading(true);
        client.get('/super-admin/settings/system')
            .then((res) => {
                const d = res.data?.data || {};
                setForm({
                    whatsapp_phone_number_id: d.whatsapp_phone_number_id || '',
                    whatsapp_waba_id: d.whatsapp_waba_id || '',
                    whatsapp_graph_version: d.whatsapp_graph_version || 'v21.0',
                    whatsapp_access_token: '',
                    whatsapp_app_secret: '',
                    whatsapp_webhook_verify_token: '',
                });
                setAccessTokenSet(Boolean(d.whatsapp_access_token_set));
                setAppSecretSet(Boolean(d.whatsapp_app_secret_set));
                setVerifyTokenSet(Boolean(d.whatsapp_webhook_verify_token_set));
                setWebhookUrl(d.whatsapp_webhook_url || `${window.location.origin}/api/webhooks/whatsapp`);
                setTemplates(d.whatsapp_templates || {});
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
                whatsapp_phone_number_id: form.whatsapp_phone_number_id,
                whatsapp_waba_id: form.whatsapp_waba_id,
                whatsapp_graph_version: form.whatsapp_graph_version,
                whatsapp_templates: templates,
            };
            if (String(form.whatsapp_access_token || '').trim()) {
                payload.whatsapp_access_token = form.whatsapp_access_token.trim();
            }
            if (String(form.whatsapp_app_secret || '').trim()) {
                payload.whatsapp_app_secret = form.whatsapp_app_secret.trim();
            }
            if (String(form.whatsapp_webhook_verify_token || '').trim()) {
                payload.whatsapp_webhook_verify_token = form.whatsapp_webhook_verify_token.trim();
            }
            await client.post('/super-admin/settings/system', payload);
            setSuccess('WhatsApp settings saved.');
            load();
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to save — endpoint may not be available yet.');
        } finally {
            setSaving(false);
        }
    };

    const testConnection = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await client.post('/super-admin/settings/whatsapp/test');
            setTestResult({ ok: Boolean(res.data?.data?.ok), message: res.data?.data?.message || '' });
        } catch (e) {
            setTestResult({ ok: false, message: e?.response?.data?.message || e?.message || 'Test failed.' });
        } finally {
            setTesting(false);
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

    const updateTemplate = (type, key, value) => {
        setTemplates((p) => ({
            ...p,
            [type]: { ...(p[type] || {}), [key]: value },
        }));
    };

    if (loading) return loadingEl;

    return (
        <div className="space-y-5">
            <Card title="WhatsApp Business API" subtitle="Meta Cloud API credentials used to send template messages and receive delivery webhooks.">
                {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
                {success && <div className="mb-4"><Alert tone="success">{success}</Alert></div>}
                <form onSubmit={save} className="max-w-xl space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Phone number ID">
                            <input
                                className={inputCls}
                                type="text"
                                value={form.whatsapp_phone_number_id}
                                onChange={(e) => setForm((p) => ({ ...p, whatsapp_phone_number_id: e.target.value }))}
                            />
                        </Field>
                        <Field label="WABA ID">
                            <input
                                className={inputCls}
                                type="text"
                                value={form.whatsapp_waba_id}
                                onChange={(e) => setForm((p) => ({ ...p, whatsapp_waba_id: e.target.value }))}
                            />
                        </Field>
                    </div>
                    <Field label="Graph API version">
                        <input
                            className={inputCls}
                            type="text"
                            placeholder="v21.0"
                            value={form.whatsapp_graph_version}
                            onChange={(e) => setForm((p) => ({ ...p, whatsapp_graph_version: e.target.value }))}
                        />
                    </Field>
                    <Field label="Access token" hint={accessTokenSet ? 'Saved — leave blank to keep.' : 'Not set yet.'}>
                        <input
                            className={inputCls}
                            type="password"
                            placeholder={accessTokenSet ? 'Saved — leave blank to keep' : 'Access token'}
                            value={form.whatsapp_access_token}
                            onChange={(e) => setForm((p) => ({ ...p, whatsapp_access_token: e.target.value }))}
                        />
                    </Field>
                    <Field label="App secret" hint={appSecretSet ? 'Saved — leave blank to keep.' : 'Not set yet.'}>
                        <input
                            className={inputCls}
                            type="password"
                            placeholder={appSecretSet ? 'Saved — leave blank to keep' : 'App secret'}
                            value={form.whatsapp_app_secret}
                            onChange={(e) => setForm((p) => ({ ...p, whatsapp_app_secret: e.target.value }))}
                        />
                    </Field>
                    <Field label="Webhook verify token" hint={verifyTokenSet ? 'Saved — leave blank to keep.' : 'Not set yet.'}>
                        <input
                            className={inputCls}
                            type="password"
                            placeholder={verifyTokenSet ? 'Saved — leave blank to keep' : 'Verify token'}
                            value={form.whatsapp_webhook_verify_token}
                            onChange={(e) => setForm((p) => ({ ...p, whatsapp_webhook_verify_token: e.target.value }))}
                        />
                    </Field>
                    <Field label="Webhook URL">
                        <div className="flex items-center gap-2">
                            <input className={readOnlyCls} type="text" value={webhookUrl} readOnly />
                            <button
                                type="button"
                                onClick={copyWebhookUrl}
                                className={`${btn.secondary} shrink-0`}
                            >
                                Copy
                            </button>
                        </div>
                        {copyMsg && <span role="status" className="mt-1 block text-xs text-slate-600">{copyMsg}</span>}
                        <span className="mt-2 block text-xs text-slate-500">
                            Add this URL as the Webhook callback URL for your WhatsApp Business App in Meta's App Dashboard, with the verify token above, and subscribe to the "messages" field.
                        </span>
                    </Field>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={testConnection}
                                disabled={testing}
                                className={btn.secondary}
                            >
                                {testing ? 'Testing…' : 'Test connection'}
                            </button>
                            {testResult && (
                                <span role="status" className={`inline-flex items-center gap-1.5 text-sm font-medium ${testResult.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                                    <AppIcon name={testResult.ok ? 'check' : 'x'} className="h-4 w-4" />{testResult.message}
                                </span>
                            )}
                        </div>
                        <button type="submit" disabled={saving} className={btn.primary}>
                            {saving ? 'Saving…' : 'Save WhatsApp settings'}
                        </button>
                    </div>
                </form>
            </Card>

            <Card title="Notification templates" subtitle="Map each notification type to an approved Meta template. Names must match exactly (lowercase, digits, underscores).">
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <div className="min-w-[860px]">
                    <div className="grid grid-cols-12 gap-3 bg-slate-50 px-4 py-2.5 text-xs font-medium text-slate-600">
                        <div className="col-span-3">Type</div>
                        <div className="col-span-3">Template name</div>
                        <div className="col-span-2">Language</div>
                        <div className="col-span-1">Enabled</div>
                        <div className="col-span-3">Reference</div>
                    </div>
                    {Object.keys(TEMPLATE_INFO).map((type) => {
                        const t = templates[type] || {};
                        const info = TEMPLATE_INFO[type];
                        return (
                            <div key={type} className="grid grid-cols-12 items-start gap-3 border-t border-slate-100 px-4 py-3 text-sm hover:bg-slate-50">
                                <div className="col-span-3 pt-2 font-medium text-slate-900">{info.label}</div>
                                <div className="col-span-3">
                                    <input
                                        className={inputCls}
                                        aria-label={`${info.label} template name`}
                                        type="text"
                                        value={t.name || ''}
                                        onChange={(e) => updateTemplate(type, 'name', e.target.value)}
                                    />
                                </div>
                                <div className="col-span-2">
                                    <input
                                        className={inputCls}
                                        aria-label={`${info.label} language`}
                                        type="text"
                                        value={t.language || ''}
                                        onChange={(e) => updateTemplate(type, 'language', e.target.value)}
                                    />
                                </div>
                                <div className="col-span-1 flex items-center pt-2.5">
                                    <input
                                        type="checkbox"
                                        aria-label={`${info.label} enabled`}
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        checked={Boolean(t.enabled)}
                                        onChange={(e) => updateTemplate(type, 'enabled', e.target.checked)}
                                    />
                                </div>
                                <div className="col-span-3 text-xs text-slate-600">
                                    <span className="font-semibold text-slate-800">{info.category}</span> — {info.params}
                                </div>
                            </div>
                        );
                    })}
                    </div>
                </div>
            </Card>
        </div>
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

    if (loading) return loadingEl;

    return (
        <Card title="Free trial settings" subtitle="Default trial configuration for newly onboarded clinics.">
            {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
            {success && <div className="mb-4"><Alert tone="success">{success}</Alert></div>}
            <form onSubmit={save} className="max-w-md space-y-4">
                <Field label="Default trial length (days)" hint="Number of days new clinics get on a free trial by default.">
                    <input
                        type="number"
                        min={1}
                        max={365}
                        className={`${inputCls} w-32`}
                        value={form.trial_days}
                        onChange={(e) => setForm((p) => ({ ...p, trial_days: Number(e.target.value) }))}
                    />
                </Field>
                <div className="flex justify-end border-t border-slate-100 pt-4">
                    <button type="submit" disabled={saving} className={btn.primary}>
                        {saving ? 'Saving…' : 'Save trial settings'}
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
            };
            // Blank grace days → leave the stored value alone (never send 0 for blank).
            if (String(form.subscription_grace_days ?? '').trim() !== '') {
                payload.subscription_grace_days = Number(form.subscription_grace_days);
            }
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

    if (loading) return loadingEl;

    return (
        <Card title="Razorpay configuration" subtitle="Credentials and behavior for subscription billing via Razorpay.">
            {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
            {success && <div className="mb-4"><Alert tone="success">{success}</Alert></div>}
            <form onSubmit={save} className="max-w-xl space-y-4">
                <Field label="Razorpay key ID">
                    <input
                        className={inputCls}
                        type="text"
                        placeholder="rzp_test_…"
                        value={form.razorpay_key_id}
                        onChange={(e) => setForm((p) => ({ ...p, razorpay_key_id: e.target.value }))}
                    />
                </Field>
                <Field label="Key secret" hint={keySecretSet ? 'Saved — leave blank to keep.' : 'Not set yet.'}>
                    <input
                        className={inputCls}
                        type="password"
                        placeholder={keySecretSet ? 'Saved — leave blank to keep' : 'Key secret'}
                        value={form.razorpay_key_secret}
                        onChange={(e) => setForm((p) => ({ ...p, razorpay_key_secret: e.target.value }))}
                    />
                </Field>
                <Field label="Webhook secret" hint={webhookSecretSet ? 'Saved — leave blank to keep.' : 'Not set yet.'}>
                    <input
                        className={inputCls}
                        type="password"
                        placeholder={webhookSecretSet ? 'Saved — leave blank to keep' : 'Webhook secret'}
                        value={form.razorpay_webhook_secret}
                        onChange={(e) => setForm((p) => ({ ...p, razorpay_webhook_secret: e.target.value }))}
                    />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
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
                        <input className={readOnlyCls} type="text" value={webhookUrl} readOnly />
                        <button
                            type="button"
                            onClick={copyWebhookUrl}
                            className={`${btn.secondary} shrink-0`}
                        >
                            Copy
                        </button>
                    </div>
                    {copyMsg && <span role="status" className="mt-1 block text-xs text-slate-600">{copyMsg}</span>}
                    <span className="mt-2 block text-xs text-slate-500">
                        In the Razorpay dashboard, add this URL as a webhook and enable: subscription.activated, subscription.charged, subscription.pending, subscription.halted, subscription.cancelled, subscription.completed, payment.failed.
                    </span>
                </Field>
                <div className="flex justify-end border-t border-slate-100 pt-4">
                    <button type="submit" disabled={saving} className={btn.primary}>
                        {saving ? 'Saving…' : 'Save payment settings'}
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
        <div className="mx-auto max-w-5xl space-y-5">
            <PageHeader title="System settings" subtitle="Global configuration for AI integrations and trial settings." />

            <Tabs
                label="Settings sections"
                tabs={TABS.map((tab) => ({ value: tab.key, label: tab.label }))}
                value={activeTab}
                onChange={setActiveTab}
            />

            <div>
                {activeTab === 'openai' && <OpenAITab />}
                {activeTab === 'whatsapp' && <WhatsAppTab />}
                {activeTab === 'payments' && <PaymentsTab />}
                {activeTab === 'trial' && <TrialTab />}
            </div>
        </div>
    );
}
