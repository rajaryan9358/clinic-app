import { useEffect, useState } from 'react';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import { Btn, Card, EmptyState, ErrorText, Field, LoadingState, Sheet, TextInput, Toggle } from '../../components/billing/ui.jsx';
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
            <Btn onClick={toggle} disabled={busy}>
                {busy ? '…' : plan.is_active ? 'Deactivate' : 'Activate'}
            </Btn>
            {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
    );
}

function DeleteBtn({ plan, onChanged }) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    if (plan.subscribers_count > 0) {
        return (
            <span className="text-xs text-gray-400" title="This plan has clinics on it. Deactivate it instead.">
                Delete
            </span>
        );
    }

    if (!confirming) {
        return (
            <button
                type="button"
                onClick={() => { setConfirming(true); setError(''); }}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
            >
                <AppIcon name="trash" className="h-3.5 w-3.5" />
                Delete
            </button>
        );
    }

    return (
        <div className="inline-flex flex-col items-end gap-1">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5">
                <span className="text-xs font-semibold text-red-700">Delete plan?</span>
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
                    className="rounded px-1.5 py-0.5 text-xs font-bold text-red-700 hover:bg-red-200 disabled:opacity-50"
                >
                    {busy ? '…' : 'Yes'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded px-1.5 py-0.5 text-xs font-semibold text-gray-600 hover:bg-gray-200">
                    No
                </button>
            </div>
            {error && <span className="text-xs text-red-600">{error}</span>}
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
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Plans</h1>
                    <p className="mt-0.5 text-sm text-gray-500">Subscription plans offered to clinics.</p>
                </div>
                <Btn variant="primary" onClick={openAdd}>
                    <AppIcon name="plus" className="h-3.5 w-3.5" /> New Plan
                </Btn>
            </div>

            {error && <ErrorText>{error}</ErrorText>}

            {loading ? (
                <LoadingState />
            ) : !plans.length ? (
                <Card><EmptyState icon="credit-card" text="No plans yet. Create one to get started." /></Card>
            ) : (
                <Card className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-sm">
                        <thead>
                            <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                                <th className="px-4 py-3">Name</th>
                                <th className="px-4 py-3">Monthly</th>
                                <th className="px-4 py-3">Yearly</th>
                                <th className="px-4 py-3">Doctors</th>
                                <th className="px-4 py-3">Staff</th>
                                <th className="px-4 py-3">Appointments/mo</th>
                                <th className="px-4 py-3">Active</th>
                                <th className="px-4 py-3">Clinics</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {plans.map((plan) => (
                                <tr key={plan.id} className="align-top">
                                    <td className="px-4 py-3">
                                        <p className="font-semibold text-gray-900">{plan.name}</p>
                                        {plan.description && <p className="mt-0.5 max-w-xs text-xs text-gray-500">{plan.description}</p>}
                                    </td>
                                    <td className="px-4 py-3 tabular-nums text-gray-800">{formatINR(plan.monthly_price)}</td>
                                    <td className="px-4 py-3 tabular-nums text-gray-800">{formatINR(plan.yearly_price)}</td>
                                    <td className="px-4 py-3 text-gray-800">{limitLabel(plan.max_doctors)}</td>
                                    <td className="px-4 py-3 text-gray-800">{limitLabel(plan.max_staff)}</td>
                                    <td className="px-4 py-3 text-gray-800">{limitLabel(plan.max_appointments_per_month)}</td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${plan.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                                            <span className={`h-1.5 w-1.5 rounded-full ${plan.is_active ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                            {plan.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 tabular-nums text-gray-800">{plan.subscribers_count ?? 0}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-2">
                                            <Btn onClick={() => openEdit(plan)}>
                                                <AppIcon name="edit" className="h-3.5 w-3.5" /> Edit
                                            </Btn>
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
                title={sheet.plan ? `Edit Plan — ${sheet.plan.name}` : 'New Plan'}
                subtitle="Prices are billed in Indian Rupees."
                onClose={closeSheet}
                footer={
                    <div className="flex items-center justify-between gap-3">
                        {saveError && <p className="text-sm text-red-600">{saveError}</p>}
                        <div className="ml-auto flex gap-2">
                            <Btn onClick={closeSheet} disabled={saving}>Cancel</Btn>
                            <Btn variant="primary" onClick={save} disabled={saving} className="min-w-[110px]">
                                {saving ? 'Saving…' : 'Save'}
                            </Btn>
                        </div>
                    </div>
                }
            >
                <div className="space-y-4">
                    <Field label="Plan Name" required>
                        <TextInput {...f('name')} placeholder="e.g. Growth" />
                    </Field>
                    <Field label="Description">
                        <TextInput {...f('description')} placeholder="Short description shown to clinics" />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Monthly Price (₹)" required>
                            <TextInput type="number" {...f('monthly_price')} placeholder="999" />
                        </Field>
                        <Field label="Yearly Price (₹)" hint="Optional. Leave blank to disable yearly billing.">
                            <TextInput type="number" {...f('yearly_price')} placeholder="9999" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <Field label="Max Doctors" hint="Blank = unlimited">
                            <TextInput type="number" {...f('max_doctors')} placeholder="Unlimited" />
                        </Field>
                        <Field label="Max Staff" hint="Blank = unlimited">
                            <TextInput type="number" {...f('max_staff')} placeholder="Unlimited" />
                        </Field>
                        <Field label="Max Appointments/mo" hint="Blank = unlimited">
                            <TextInput type="number" {...f('max_appointments_per_month')} placeholder="Unlimited" />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Sort Order">
                            <TextInput type="number" {...f('sort_order')} placeholder="0" />
                        </Field>
                        <Field label="Status">
                            <div className="pt-2">
                                <Toggle checked={form.is_active} onChange={(v) => setForm((p) => ({ ...p, is_active: v }))} label="Active" />
                            </div>
                        </Field>
                    </div>
                </div>
            </Sheet>
        </div>
    );
}
