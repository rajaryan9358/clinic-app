import { useEffect, useMemo, useState } from 'react';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import PermissionGrid from '../../components/roles/PermissionGrid';
import { Alert, Badge, btn, Card, EmptyState, input, PageHeader, Spinner } from '../../components/ui';

const emptyForm = () => ({
    label: '',
    kind: 'staff',
    limit_to_assigned_doctors: false,
    description: '',
    permissions: [],
});

const KIND_LABEL = { staff: 'Staff', doctor: 'Doctor', clinic_admin: 'Clinic Admin' };
const KIND_TONE = { staff: 'blue', doctor: 'violet', clinic_admin: 'amber' };

function KindBadge({ kind }) {
    return <Badge tone={KIND_TONE[kind] || 'slate'}>{KIND_LABEL[kind] || kind}</Badge>;
}

function Field({ id, label, required, hint, children }) {
    const LabelTag = id ? 'label' : 'p';
    return (
        <div>
            <LabelTag {...(id ? { htmlFor: id } : {})} className="mb-1 block text-xs font-medium text-slate-600">
                {label}{required && <span className="ml-0.5 text-rose-600" aria-hidden="true">*</span>}
            </LabelTag>
            {children}
            {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
    );
}

function Textarea({ id, value, onChange, placeholder }) {
    return (
        <textarea
            id={id}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={`${input} min-h-[80px] resize-y`}
        />
    );
}

function RadioOption({ checked, disabled, onSelect, label }) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={onSelect}
            className={`h-10 flex-1 rounded-xl border px-3 text-sm font-semibold transition-colors ${
                checked ? 'border-blue-600 bg-blue-50 text-blue-800 ring-1 ring-blue-600' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            } disabled:cursor-not-allowed disabled:opacity-60`}
        >
            {label}
        </button>
    );
}

/** Right-hand drawer used for the add / edit role form. */
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
            <div className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
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

function DeleteRoleBtn({ role, onDeleted }) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    if (role.is_system) {
        return (
            <span className="inline-flex h-9 cursor-not-allowed items-center px-2.5 text-sm font-semibold text-slate-500" title="Built-in roles can't be deleted.">
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
                <AppIcon name="trash" className="h-4 w-4" />
                Delete
            </button>
        );
    }

    return (
        <div className="inline-flex flex-col items-end gap-1">
            <div className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-2.5">
                <span className="text-sm font-semibold text-rose-800">Delete role?</span>
                <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                            await client.delete(`/super-admin/roles/${role.id}`);
                            setConfirming(false);
                            onDeleted();
                        } catch (e) {
                            setError(e?.response?.data?.message || 'Failed to delete role');
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

export default function RolesPage() {
    const [roles, setRoles] = useState([]);
    const [catalogue, setCatalogue] = useState({ modules: [], specials: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [sheet, setSheet] = useState({ open: false, role: null });
    const [form, setForm] = useState(emptyForm());
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const [rolesRes, catalogueRes] = await Promise.all([
                client.get('/super-admin/roles'),
                client.get('/super-admin/permission-catalogue'),
            ]);
            setRoles(Array.isArray(rolesRes.data?.data) ? rolesRes.data.data : []);
            setCatalogue(catalogueRes.data?.data || { modules: [], specials: [] });
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to load roles');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const isClinicAdmin = sheet.role?.kind === 'clinic_admin';

    const openAdd = () => {
        setForm(emptyForm());
        setSaveError('');
        setSheet({ open: true, role: null });
    };

    const openEdit = (role) => {
        setForm({
            label: role.label || '',
            kind: role.kind,
            limit_to_assigned_doctors: Boolean(role.limit_to_assigned_doctors),
            description: role.description || '',
            permissions: Array.isArray(role.permissions) ? role.permissions : [],
        });
        setSaveError('');
        setSheet({ open: true, role });
    };

    const closeSheet = () => setSheet({ open: false, role: null });

    const save = async () => {
        const label = String(form.label || '').trim();
        if (!label) {
            setSaveError('Label is required.');
            return;
        }

        setSaving(true);
        setSaveError('');
        try {
            if (sheet.role) {
                const payload = {
                    label,
                    description: String(form.description || '').trim() || null,
                };
                if (sheet.role.kind === 'staff') {
                    payload.limit_to_assigned_doctors = Boolean(form.limit_to_assigned_doctors);
                }
                if (!isClinicAdmin) {
                    payload.permissions = form.permissions;
                }
                await client.put(`/super-admin/roles/${sheet.role.id}`, payload);
            } else {
                const payload = {
                    label,
                    kind: form.kind,
                    description: String(form.description || '').trim() || null,
                    permissions: form.permissions,
                };
                if (form.kind === 'staff') {
                    payload.limit_to_assigned_doctors = Boolean(form.limit_to_assigned_doctors);
                }
                await client.post('/super-admin/roles', payload);
            }

            await load();
            closeSheet();
        } catch (e) {
            setSaveError(e?.response?.data?.message || 'Failed to save role');
        } finally {
            setSaving(false);
        }
    };

    const gridValue = isClinicAdmin ? (sheet.role?.permissions || []) : form.permissions;
    const showLimitToggle = sheet.role ? sheet.role.kind === 'staff' : form.kind === 'staff';

    return (
        <div className="mx-auto max-w-[1400px] space-y-5">
            <PageHeader
                title="Roles"
                subtitle="Define what staff, doctor and clinic admin roles can see and do."
                actions={(
                    <button type="button" className={btn.primary} onClick={openAdd}>
                        <AppIcon name="plus" className="h-4 w-4" /> New role
                    </button>
                )}
            />

            {error && <Alert tone="error">{error}</Alert>}

            {loading ? (
                <Card><Spinner /></Card>
            ) : !roles.length ? (
                <Card bodyClassName=""><EmptyState icon="key" title="No roles yet" /></Card>
            ) : (
                <Card bodyClassName="overflow-x-auto" className="overflow-hidden">
                    <table className="w-full min-w-[720px] text-sm">
                        <thead>
                            <tr className="bg-slate-50 text-left text-xs font-medium text-slate-600">
                                <th className="px-4 py-3 font-medium">Role</th>
                                <th className="px-4 py-3 font-medium">Kind</th>
                                <th className="px-4 py-3 font-medium">Users</th>
                                <th className="px-4 py-3 font-medium">System</th>
                                <th className="px-4 py-3 text-right font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {roles.map((role) => (
                                <tr key={role.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                                    <td className="px-4 py-3">
                                        <p className="font-semibold text-slate-900">{role.label}</p>
                                        {role.description && <p className="mt-0.5 max-w-sm text-xs text-slate-600">{role.description}</p>}
                                    </td>
                                    <td className="px-4 py-3"><KindBadge kind={role.kind} /></td>
                                    <td className="px-4 py-3 tabular-nums text-slate-800">{role.users_count ?? 0}</td>
                                    <td className="px-4 py-3">
                                        {role.is_system ? <Badge tone="slate">System</Badge> : <span className="text-slate-400">—</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-2">
                                            <button type="button" className={`${btn.secondary} h-9`} onClick={() => openEdit(role)}>
                                                <AppIcon name="edit" className="h-4 w-4" /> Edit
                                            </button>
                                            <DeleteRoleBtn role={role} onDeleted={load} />
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
                title={sheet.role ? `Edit role — ${sheet.role.label}` : 'New role'}
                subtitle={isClinicAdmin ? 'Clinic admin always has full access.' : 'Choose what this role can see and do.'}
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
                    <Field id="role-label" label="Label" required>
                        <input id="role-label" className={input} value={form.label ?? ''} onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))} placeholder="e.g. Front Desk" />
                    </Field>

                    {!isClinicAdmin && (
                        <Field label="Kind" required hint={sheet.role ? "A role's kind can't be changed after it's created." : ''}>
                            <div role="radiogroup" aria-label="Kind" className="flex gap-2">
                                <RadioOption
                                    label="Staff"
                                    checked={form.kind === 'staff'}
                                    disabled={Boolean(sheet.role)}
                                    onSelect={() => setForm((p) => ({ ...p, kind: 'staff' }))}
                                />
                                <RadioOption
                                    label="Doctor"
                                    checked={form.kind === 'doctor'}
                                    disabled={Boolean(sheet.role)}
                                    onSelect={() => setForm((p) => ({ ...p, kind: 'doctor' }))}
                                />
                            </div>
                        </Field>
                    )}

                    {showLimitToggle && (
                        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <input
                                type="checkbox"
                                checked={Boolean(form.limit_to_assigned_doctors)}
                                onChange={(e) => setForm((p) => ({ ...p, limit_to_assigned_doctors: e.target.checked }))}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-slate-800">Only see assigned doctors&rsquo; patients and appointments</span>
                        </label>
                    )}

                    <Field id="role-desc" label="Description">
                        <Textarea id="role-desc" value={form.description} onChange={(v) => setForm((p) => ({ ...p, description: v }))} placeholder="Shown to super admins managing roles." />
                    </Field>

                    {isClinicAdmin ? <Alert tone="warn">Clinic admin always has full access.</Alert> : null}

                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Permissions</p>
                        <PermissionGrid
                            catalogue={catalogue}
                            value={gridValue}
                            onChange={(next) => setForm((p) => ({ ...p, permissions: next }))}
                            readOnly={isClinicAdmin}
                        />
                    </div>
                </div>
            </Sheet>
        </div>
    );
}
