import { useMemo } from 'react';

const ACTION_COLUMNS = [
    { key: 'view', label: 'View' },
    { key: 'create', label: 'Create' },
    { key: 'edit', label: 'Edit' },
    { key: 'delete', label: 'Delete' },
];

// Modules the product does not use yet. They stay in the catalogue (and any
// permissions a role already holds for them are kept untouched in `value`),
// they are just not offered in the editor.
const HIDDEN_MODULES = new Set(['reviews', 'domains']);
const isHiddenPermission = (name) => HIDDEN_MODULES.has(String(name || '').split('.')[0]);

const CHECKBOX = 'h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-60';

/**
 * Permission editor for the super admin role builder (spec §5): rows are the
 * permission catalogue's modules with a checkbox per action the module
 * actually has (e.g. `reports` only has `view`), plus a per-row "All" toggle,
 * and trailing sections for one-off permissions like
 * `appointments.check_in` ("Special") or the role dashboards ("Dashboards").
 *
 * `value` is the flat list of permission names (`{module}.{action}` or a
 * special's own name). `readOnly` disables every checkbox — used for the
 * clinic_admin role, whose permissions the backend refuses to change.
 */
export default function PermissionGrid({ catalogue, value, onChange, readOnly = false }) {
    const modules = (Array.isArray(catalogue?.modules) ? catalogue.modules : []).filter((m) => !HIDDEN_MODULES.has(m.key));
    const specials = (Array.isArray(catalogue?.specials) ? catalogue.specials : []).filter((sp) => !isHiddenPermission(sp.name));

    const selected = useMemo(() => new Set(Array.isArray(value) ? value : []), [value]);

    // Specials render in titled groups: those carrying a catalogue `group`
    // (e.g. "Dashboards") get their own section, the rest go under "Special".
    const specialGroups = useMemo(() => {
        const groups = new Map();
        specials.forEach((special) => {
            const title = special.group || 'Special';
            if (!groups.has(title)) groups.set(title, []);
            groups.get(title).push(special);
        });
        return Array.from(groups.entries());
    }, [specials]);

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
            <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[460px] text-sm">
                    <thead>
                        <tr className="bg-slate-50 text-left text-xs font-medium text-slate-600">
                            <th scope="col" className="px-4 py-2.5 font-medium">Module</th>
                            {ACTION_COLUMNS.map((col) => (
                                <th key={col.key} scope="col" className="px-3 py-2.5 text-center font-medium">{col.label}</th>
                            ))}
                            <th scope="col" className="px-3 py-2.5 text-center font-medium">All</th>
                        </tr>
                    </thead>
                    <tbody>
                        {modules.map((module) => {
                            const actions = Array.isArray(module.actions) ? module.actions : [];
                            const permissions = actions.map((action) => `${module.key}.${action}`);
                            const allChecked = permissions.length > 0 && permissions.every((p) => selected.has(p));

                            return (
                                <tr key={module.key} className="border-t border-slate-100 hover:bg-slate-50">
                                    <th scope="row" className="px-4 py-2.5 text-left font-medium text-slate-900 first-letter:uppercase">{module.label}</th>
                                    {ACTION_COLUMNS.map((col) => {
                                        const hasAction = actions.includes(col.key);
                                        const permission = `${module.key}.${col.key}`;
                                        return (
                                            <td key={col.key} className="px-3 py-2.5 text-center">
                                                {hasAction ? (
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`${module.label}: ${col.label}`}
                                                        checked={selected.has(permission)}
                                                        disabled={readOnly}
                                                        onChange={() => toggle(permission)}
                                                        className={CHECKBOX}
                                                    />
                                                ) : (
                                                    <span className="text-slate-300" aria-hidden="true">—</span>
                                                )}
                                            </td>
                                        );
                                    })}
                                    <td className="px-3 py-2.5 text-center">
                                        <input
                                            type="checkbox"
                                            aria-label={`${module.label}: all`}
                                            checked={allChecked}
                                            disabled={readOnly}
                                            onChange={() => toggleRow(module)}
                                            className={CHECKBOX}
                                        />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {specialGroups.map(([title, items]) => (
                <div key={title}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
                    <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                        {items.map((special) => (
                            <label
                                key={special.name}
                                className={`flex items-center gap-3 px-4 py-2.5 ${readOnly ? '' : 'cursor-pointer hover:bg-slate-50'}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={selected.has(special.name)}
                                    disabled={readOnly}
                                    onChange={() => toggle(special.name)}
                                    className={CHECKBOX}
                                />
                                <span className="text-sm text-slate-800 first-letter:uppercase">{special.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
