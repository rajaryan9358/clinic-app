import { useEffect, useMemo, useState } from 'react';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import PermissionGrid from '../../components/roles/PermissionGrid';
import { Btn, Card, EmptyState, ErrorText, Field, LoadingState, Sheet, TextInput } from '../../components/billing/ui.jsx';

const emptyForm = () => ({
    label: '',
    kind: 'staff',
    limit_to_assigned_doctors: false,
    description: '',
    permissions: [],
});

const KIND_LABEL = { staff: 'Staff', doctor: 'Doctor', clinic_admin: 'Clinic Admin' };
const KIND_STYLE = {
    staff: 'border-blue-200 bg-blue-50 text-blue-700',
    doctor: 'border-purple-200 bg-purple-50 text-purple-700',
    clinic_admin: 'border-amber-200 bg-amber-50 text-amber-700',
};

function KindBadge({ kind }) {
    return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${KIND_STYLE[kind] || 'border-gray-200 bg-gray-50 text-gray-600'}`}>
            {KIND_LABEL[kind] || kind}
        </span>
    );
}

function Textarea({ value, onChange, placeholder }) {
    return (
        <textarea
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="min-h-[80px] w-full resize-y rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
    );
}

function RadioOption({ checked, disabled, onSelect, label }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onSelect}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                checked ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            } disabled:cursor-not-allowed disabled:opacity-60`}
        >
            {label}
        </button>
    );
}

function DeleteRoleBtn({ role, onDeleted }) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    if (role.is_system) {
        return (
            <span className="text-xs text-gray-400" title="Built-in roles can't be deleted.">
                Delete
            </span>
        );
    }

    if (!confirming) {
        return (
            <button
                type="button"
                onClick={() => { setConfirming(true); setError(''); }}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
            >
                <AppIcon name="trash" className="h-3.5 w-3.5" />
                Delete
            </button>
        );
    }

    return (
        <div className="inline-flex flex-col items-end gap-1">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5">
                <span className="text-xs font-semibold text-red-700">Delete role?</span>
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
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Roles</h1>
                    <p className="mt-0.5 text-sm text-gray-500">Define what staff, doctor and clinic admin roles can see and do.</p>
                </div>
                <Btn variant="primary" onClick={openAdd}>
                    <AppIcon name="plus" className="h-3.5 w-3.5" /> New Role
                </Btn>
            </div>

            {error && <ErrorText>{error}</ErrorText>}

            {loading ? (
                <LoadingState />
            ) : !roles.length ? (
                <Card><EmptyState icon="key" text="No roles yet." /></Card>
            ) : (
                <Card className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                        <thead>
                            <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                                <th className="px-4 py-3">Label</th>
                                <th className="px-4 py-3">Kind</th>
                                <th className="px-4 py-3">Users</th>
                                <th className="px-4 py-3">System</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {roles.map((role) => (
                                <tr key={role.id} className="align-top">
                                    <td className="px-4 py-3">
                                        <p className="font-semibold text-gray-900">{role.label}</p>
                                        {role.description && <p className="mt-0.5 max-w-sm text-xs text-gray-500">{role.description}</p>}
                                    </td>
                                    <td className="px-4 py-3"><KindBadge kind={role.kind} /></td>
                                    <td className="px-4 py-3 tabular-nums text-gray-800">{role.users_count ?? 0}</td>
                                    <td className="px-4 py-3">
                                        {role.is_system ? (
                                            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600">System</span>
                                        ) : (
                                            <span className="text-gray-300">—</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-2">
                                            <Btn onClick={() => openEdit(role)}>
                                                <AppIcon name="edit" className="h-3.5 w-3.5" /> Edit
                                            </Btn>
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
                title={sheet.role ? `Edit Role — ${sheet.role.label}` : 'New Role'}
                subtitle={isClinicAdmin ? 'Clinic Admin always has full access.' : 'Choose what this role can see and do.'}
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
                    <Field label="Label" required>
                        <TextInput value={form.label} onChange={(v) => setForm((p) => ({ ...p, label: v }))} placeholder="e.g. Front Desk" />
                    </Field>

                    {!isClinicAdmin && (
                        <Field label="Kind" required hint={sheet.role ? "A role's kind can't be changed after it's created." : ''}>
                            <div className="flex gap-2">
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
                        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                            <input
                                type="checkbox"
                                checked={Boolean(form.limit_to_assigned_doctors)}
                                onChange={(e) => setForm((p) => ({ ...p, limit_to_assigned_doctors: e.target.checked }))}
                                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">Only see assigned doctors&rsquo; patients and appointments</span>
                        </label>
                    )}

                    <Field label="Description">
                        <Textarea value={form.description} onChange={(v) => setForm((p) => ({ ...p, description: v }))} placeholder="Shown to super admins managing roles." />
                    </Field>

                    {isClinicAdmin ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            Clinic Admin always has full access.
                        </div>
                    ) : null}

                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Permissions</p>
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
