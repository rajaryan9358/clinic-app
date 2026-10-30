import { useEffect, useState } from 'react';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import { Alert, Badge, btn, Card, EmptyState, input, PageHeader, Spinner } from '../../components/ui';
import { formatINR, paiseToRupees, toPaise } from '../../utils/money';

const emptyForm = {
    name: '',
    description: '',
    monthly_price: '',
    yearly_price: '',
    max_doctors: '',
    max_staff: '',
    max_appointments_per_month: '',
    is_active: true,
    sort_order: '0',
};

function limitLabel(value) {
    return value == null || value === '' ? 'Unlimited' : String(value);
}

// Local form helpers in the shared look (label above, `input` class).
function Field({ id, label, required, hint, children }) {
    return (
        <div>
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
                {label}{required && <span className="ml-0.5 text-rose-600" aria-hidden="true">*</span>}
            </label>
            {children}
            {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
    );
}

function TextInput({ id, value, onChange, placeholder, type = 'text' }) {
    return (
        <input
            id={id}
            type={type}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={input}
        />
    );
}

function Switch({ id, checked, onChange, label }) {
    return (
        <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-3">
            <span className="relative inline-flex shrink-0">
                <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
                <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300" />
                <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
            </span>
            <span className="text-sm font-medium text-slate-900">{label}</span>
        </label>
    );
}

/** Right-hand drawer used for the add / edit plan form. */
function Sheet({ open, title, subtitle, onClose, children, footer }) {
    useEffect(() => {
        if (!open) return undefined;
        const handler = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-end" aria-modal="true" role="dialog" aria-label={title}>
            <div className="absolute inset-0 bg-slate-950/50" onClick={onClose} />
            <div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                        {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                        <AppIcon name="close" className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-5">{children}</div>
                {footer && <div className="border-t border-slate-100 px-5 py-4">{footer}</div>}
            </div>
        </div>
    );
}

function DeactivateBtn({ plan, onChanged }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const toggle = async () => {
        setBusy(true);
        setError('');
        try {
            await client.put(`/super-admin/plans/${plan.id}`, { is_active: !plan.is_active });
            onChanged();
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to update plan');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="inline-flex flex-col items-end gap-1">
            <button type="button" onClick={toggle} disabled={busy} className={`${btn.secondary} h-9`}>
                {busy ? '…' : plan.is_active ? 'Deactivate' : 'Activate'}
            </button>
            {error && <span className="text-xs text-rose-700">{error}</span>}
        </div>
    );
}

function DeleteBtn({ plan, onChanged }) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    if (plan.subscribers_count > 0) {
        return (
            <span className="inline-flex h-9 cursor-not-allowed items-center px-2.5 text-sm font-semibold text-slate-500" title="This plan has clinics on it. Deactivate it instead.">
                Delete
            </span>
        );
    }

    if (!confirming) {
        return (
            <button
                type="button"
                onClick={() => { setConfirming(true); setError(''); }}
                className={`${btn.danger} h-9`}
            >
                <AppIcon name="trash" className="h-3.5 w-3.5" />
                Delete
            </button>
        );
    }

    return (
        <div className="inline-flex flex-col items-end gap-1">
            <div className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-2.5">
                <span className="text-sm font-semibold text-rose-800">Delete plan?</span>
                <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                            await client.delete(`/super-admin/plans/${plan.id}`);
                            setConfirming(false);
                            onChanged();
                        } catch (e) {
                            setError(e?.response?.data?.message || 'Failed to delete plan');
                            setConfirming(false);
                        } finally {
                            setBusy(false);
                        }
                    }}
                    className="rounded-md px-2 py-1 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                >
                    {busy ? '…' : 'Yes'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-2 py-1 text-sm font-semibold text-slate-700 hover:bg-white">
                    No
                </button>
            </div>
            {error && <span className="text-xs text-rose-700">{error}</span>}
        </div>
    );
}

export default function PlansPage() {
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [sheet, setSheet] = useState({ open: false, plan: null });
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await client.get('/super-admin/plans');
            setPlans(Array.isArray(res.data?.data) ? res.data.data : []);
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to load plans');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const openAdd = () => {
        setForm(emptyForm);
        setSaveError('');
        setSheet({ open: true, plan: null });
    };

    const openEdit = (plan) => {
        setForm({
            name: plan.name || '',
            description: plan.description || '',
            monthly_price: paiseToRupees(plan.monthly_price),
            yearly_price: paiseToRupees(plan.yearly_price),
            max_doctors: plan.max_doctors ?? '',
            max_staff: plan.max_staff ?? '',
            max_appointments_per_month: plan.max_appointments_per_month ?? '',
            is_active: Boolean(plan.is_active),
            sort_order: plan.sort_order ?? '0',
        });
        setSaveError('');
        setSheet({ open: true, plan });
    };

    const closeSheet = () => setSheet({ open: false, plan: null });

    const save = async () => {
        setSaving(true);
        setSaveError('');
        try {
            const payload = {
                name: String(form.name || '').trim(),
                description: String(form.description || '').trim() || null,
                monthly_price: toPaise(form.monthly_price),
                yearly_price: form.yearly_price === '' ? null : toPaise(form.yearly_price),
                max_doctors: form.max_doctors === '' ? null : Number(form.max_doctors),
                max_staff: form.max_staff === '' ? null : Number(form.max_staff),
                max_appointments_per_month: form.max_appointments_per_month === '' ? null : Number(form.max_appointments_per_month),
                is_active: Boolean(form.is_active),
                sort_order: form.sort_order === '' ? 0 : Number(form.sort_order),
            };

            if (!payload.name) {
                setSaveError('Plan name is required.');
                setSaving(false);
                return;
            }
            if (payload.monthly_price == null) {
                setSaveError('Monthly price is required.');
                setSaving(false);
                return;
            }

            if (sheet.plan?.id) {
                await client.put(`/super-admin/plans/${sheet.plan.id}`, payload);
            } else {
                await client.post('/super-admin/plans', payload);
            }

            await load();
            closeSheet();
        } catch (e) {
            setSaveError(e?.response?.data?.message || 'Failed to save plan');
        } finally {
            setSaving(false);
        }
    };

    const f = (key) => ({ value: form[key], onChange: (v) => setForm((p) => ({ ...p, [key]: v })) });

    return (
        <div className="mx-auto max-w-[1400px] space-y-5">
            <PageHeader
                title="Plans"
                subtitle="Subscription plans offered to clinics."
                actions={(
                    <button type="button" className={btn.primary} onClick={openAdd}>
                        <AppIcon name="plus" className="h-4 w-4" /> New plan
                    </button>
                )}
            />

            {error && <Alert tone="error">{error}</Alert>}

            {loading ? (
                <Card><Spinner /></Card>
            ) : !plans.length ? (
                <Card bodyClassName=""><EmptyState icon="credit-card" title="No plans yet">Create one to get started.</EmptyState></Card>
            ) : (
                <Card bodyClassName="overflow-x-auto" className="overflow-hidden">
                    <table className="w-full min-w-[900px] text-sm">
                        <thead>
                            <tr className="bg-slate-50 text-left text-xs font-medium text-slate-600">
                                <th className="px-4 py-3 font-medium">Name</th>
                                <th className="px-4 py-3 font-medium">Monthly</th>
                                <th className="px-4 py-3 font-medium">Yearly</th>
                                <th className="px-4 py-3 font-medium">Doctors</th>
                                <th className="px-4 py-3 font-medium">Staff</th>
                                <th className="px-4 py-3 font-medium">Appointments/mo</th>
                                <th className="px-4 py-3 font-medium">Status</th>
                                <th className="px-4 py-3 font-medium">Clinics</th>
                                <th className="px-4 py-3 text-right font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {plans.map((plan) => (
                                <tr key={plan.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                                    <td className="px-4 py-3">
                                        <p className="font-semibold text-slate-900">{plan.name}</p>
                                        {plan.description && <p className="mt-0.5 max-w-xs text-xs text-slate-600">{plan.description}</p>}
                                    </td>
                                    <td className="px-4 py-3 tabular-nums text-slate-800">{formatINR(plan.monthly_price)}</td>
                                    <td className="px-4 py-3 tabular-nums text-slate-800">{formatINR(plan.yearly_price)}</td>
                                    <td className="px-4 py-3 text-slate-800">{limitLabel(plan.max_doctors)}</td>
                                    <td className="px-4 py-3 text-slate-800">{limitLabel(plan.max_staff)}</td>
                                    <td className="px-4 py-3 text-slate-800">{limitLabel(plan.max_appointments_per_month)}</td>
                                    <td className="px-4 py-3">
                                        <Badge tone={plan.is_active ? 'green' : 'slate'}>{plan.is_active ? 'Active' : 'Inactive'}</Badge>
                                    </td>
                                    <td className="px-4 py-3 tabular-nums text-slate-800">{plan.subscribers_count ?? 0}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-2">
                                            <button type="button" className={`${btn.secondary} h-9`} onClick={() => openEdit(plan)}>
                                                <AppIcon name="edit" className="h-4 w-4" /> Edit
                                            </button>
                                            <DeactivateBtn plan={plan} onChanged={load} />
                                            <DeleteBtn plan={plan} onChanged={load} />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            )}

            <Sheet
                open={sheet.open}
                title={sheet.plan ? `Edit plan — ${sheet.plan.name}` : 'New plan'}
                subtitle="Prices are billed in Indian Rupees."
                onClose={closeSheet}
                footer={
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        {saveError && <p role="alert" className="text-sm text-rose-700">{saveError}</p>}
                        <div className="ml-auto flex gap-2">
                            <button type="button" className={btn.secondary} onClick={closeSheet} disabled={saving}>Cancel</button>
                            <button type="button" className={`${btn.primary} min-w-[110px]`} onClick={save} disabled={saving}>
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </div>
                }
            >
                <div className="space-y-4">
                    <Field id="plan-name" label="Plan name" required>
                        <TextInput id="plan-name" {...f('name')} placeholder="e.g. Growth" />
                    </Field>
                    <Field id="plan-desc" label="Description">
                        <TextInput id="plan-desc" {...f('description')} placeholder="Short description shown to clinics" />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field id="plan-monthly" label="Monthly price (₹)" required>
                            <TextInput id="plan-monthly" type="number" {...f('monthly_price')} placeholder="999" />
                        </Field>
                        <Field id="plan-yearly" label="Yearly price (₹)" hint="Optional. Leave blank to disable yearly billing.">
                            <TextInput id="plan-yearly" type="number" {...f('yearly_price')} placeholder="9999" />
                        </Field>
                    </div>
                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Limits</p>
                        <div className="grid gap-3 sm:grid-cols-3">
                            <Field id="plan-doctors" label="Max doctors" hint="Blank = unlimited">
                                <TextInput id="plan-doctors" type="number" {...f('max_doctors')} placeholder="Unlimited" />
                            </Field>
                            <Field id="plan-staff" label="Max staff" hint="Blank = unlimited">
                                <TextInput id="plan-staff" type="number" {...f('max_staff')} placeholder="Unlimited" />
                            </Field>
                            <Field id="plan-appts" label="Max appointments/mo" hint="Blank = unlimited">
                                <TextInput id="plan-appts" type="number" {...f('max_appointments_per_month')} placeholder="Unlimited" />
                            </Field>
                        </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field id="plan-sort" label="Sort order">
                            <TextInput id="plan-sort" type="number" {...f('sort_order')} placeholder="0" />
                        </Field>
                        <div>
                            <p className="mb-1 block text-xs font-medium text-slate-600">Status</p>
                            <div className="pt-2">
                                <Switch id="plan-active" checked={form.is_active} onChange={(v) => setForm((p) => ({ ...p, is_active: v }))} label="Active" />
                            </div>
                        </div>
                    </div>
                </div>
            </Sheet>
        </div>
    );
}
