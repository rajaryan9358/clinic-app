import { useMemo } from 'react';

const ACTION_COLUMNS = [
    { key: 'view', label: 'View' },
    { key: 'create', label: 'Create' },
    { key: 'edit', label: 'Edit' },
    { key: 'delete', label: 'Delete' },
];

/**
 * Permission editor for the super admin role builder (spec §5): rows are the
 * permission catalogue's modules with a checkbox per action the module
 * actually has (e.g. `reports` only has `view`), plus a per-row "All" toggle,
 * and a trailing "Special" section for one-off permissions like
 * `appointments.check_in`.
 *
 * `value` is the flat list of permission names (`{module}.{action}` or a
 * special's own name). `readOnly` disables every checkbox — used for the
 * clinic_admin role, whose permissions the backend refuses to change.
 */
export default function PermissionGrid({ catalogue, value, onChange, readOnly = false }) {
    const modules = Array.isArray(catalogue?.modules) ? catalogue.modules : [];
    const specials = Array.isArray(catalogue?.specials) ? catalogue.specials : [];

    const selected = useMemo(() => new Set(Array.isArray(value) ? value : []), [value]);

    const emit = (next) => {
        if (readOnly || typeof onChange !== 'function') return;
        onChange(Array.from(next));
    };

    const toggle = (permission) => {
        const next = new Set(selected);
        if (next.has(permission)) next.delete(permission);
        else next.add(permission);
        emit(next);
    };

    const toggleRow = (module) => {
        const permissions = (module.actions || []).map((action) => `${module.key}.${action}`);
        const allChecked = permissions.every((p) => selected.has(p));
        const next = new Set(selected);
        permissions.forEach((p) => (allChecked ? next.delete(p) : next.add(p)));
        emit(next);
    };

    return (
        <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-gray-200">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                            <th className="px-4 py-2.5">Module</th>
                            {ACTION_COLUMNS.map((col) => (
                                <th key={col.key} className="px-3 py-2.5 text-center">{col.label}</th>
                            ))}
                            <th className="px-3 py-2.5 text-center">All</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {modules.map((module) => {
                            const actions = Array.isArray(module.actions) ? module.actions : [];
                            const permissions = actions.map((action) => `${module.key}.${action}`);
                            const allChecked = permissions.length > 0 && permissions.every((p) => selected.has(p));

                            return (
                                <tr key={module.key}>
                                    <td className="px-4 py-2.5 font-medium text-gray-800">{module.label}</td>
                                    {ACTION_COLUMNS.map((col) => {
                                        const hasAction = actions.includes(col.key);
                                        const permission = `${module.key}.${col.key}`;
                                        return (
                                            <td key={col.key} className="px-3 py-2.5 text-center">
                                                {hasAction ? (
                                                    <input
                                                        type="checkbox"
                                                        checked={selected.has(permission)}
                                                        disabled={readOnly}
                                                        onChange={() => toggle(permission)}
                                                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-60"
                                                    />
                                                ) : (
                                                    <span className="text-gray-300">—</span>
                                                )}
                                            </td>
                                        );
                                    })}
                                    <td className="px-3 py-2.5 text-center">
                                        <input
                                            type="checkbox"
                                            checked={allChecked}
                                            disabled={readOnly}
                                            onChange={() => toggleRow(module)}
                                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-60"
                                        />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {specials.length ? (
                <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Special</p>
                    <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
                        {specials.map((special) => (
                            <label
                                key={special.name}
                                className={`flex items-center gap-3 px-4 py-2.5 ${readOnly ? '' : 'cursor-pointer hover:bg-gray-50'}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={selected.has(special.name)}
                                    disabled={readOnly}
                                    onChange={() => toggle(special.name)}
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-60"
                                />
                                <span className="text-sm text-gray-700">{special.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
