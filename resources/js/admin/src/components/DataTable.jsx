import StatusBadge from './StatusBadge';
import AppIcon from './AppIcon';
import { formatDate, formatDateTime, formatTime, isDateKey, isDateTimeKey, isTimeKey } from '../utils/dateFormat';

function inferObjectLabel(value) {
    if (!value || typeof value !== 'object') return '';
    const candidates = [
        value.name, value.full_name, value.host, value.invoice_number,
        value.reference_number, value.phone_number, value.business_name,
        value.customer_phone, value.uuid, value.code, value.email, value.phone,
    ];
    const first = candidates.find((v) => typeof v === 'string' && v.trim().length);
    if (first) return first;
    if (value.id !== undefined && value.id !== null) return `#${value.id}`;
    return '';
}

function Btn({ onClick, variant = 'default', children, title }) {
    const variants = {
        default: 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300',
        blue:    'bg-blue-50 border border-blue-100 text-blue-700 hover:bg-blue-100',
        red:     'bg-red-50 border border-red-100 text-red-700 hover:bg-red-100',
        amber:   'bg-amber-50 border border-amber-100 text-amber-700 hover:bg-amber-100',
        green:   'bg-emerald-50 border border-emerald-100 text-emerald-700 hover:bg-emerald-100',
    };
    return (
        <button
            onClick={onClick}
            title={title}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${variants[variant]}`}
        >
            {children}
        </button>
    );
}

export default function DataTable({
    rows = [],
    onView,
    onEdit,
    onDelete,
    onRestore,
    onBlock,
    onUnblock,
    onExtraAction,
    blockActionStatuses = ['active'],
    unblockActionStatuses = ['blocked'],
    blockActionLabel = 'Block',
    unblockActionLabel = 'Unblock',
    actionMode = 'menu',
    buttonActions,
    extraActionsForRow,
    hiddenColumns = [],
    columnLabels = {},
    cellRenderers = {},
    priorityColumns = [],
}) {
    if (!rows.length) {
        return (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-14 text-center">
                <AppIcon name="module" className="mb-3 h-8 w-8 text-gray-300" />
                <p className="text-sm font-medium text-gray-500">No records found</p>
                <p className="mt-1 text-xs text-gray-400">Try adjusting your search or filters</p>
            </div>
        );
    }

    const first = rows[0] || {};
    const hidden = new Set(['password', 'remember_token', 'clinic_id', 'deleted_at', 'created_at', 'updated_at', ...hiddenColumns]);
    const baseKeys = Object.keys(first).filter((key) => !hidden.has(key));

    const pinKeys = [];
    if (baseKeys.includes('status')) pinKeys.push('status');
    if (baseKeys.includes('clinic')) pinKeys.push('clinic');

    const prioritySet = new Set(Array.isArray(priorityColumns) ? priorityColumns : []);
    const priorityBase = baseKeys.filter((k) => prioritySet.has(k) && !pinKeys.includes(k));
    const regularBase = baseKeys.filter((k) => !prioritySet.has(k) && !pinKeys.includes(k));
    const slotCount = Math.max(0, 8 - pinKeys.length - priorityBase.length);

    const keys = [
        ...priorityBase,
        ...regularBase.slice(0, slotCount),
        ...pinKeys,
    ];

    const formatValue = (value, key, row) => {
        const renderer = key ? cellRenderers?.[key] : null;
        if (typeof renderer === 'function') return renderer(value, row, key);

        if (key && String(key).includes('status')) return <StatusBadge status={value} />;

        // Auto-format date/time columns
        if (key && typeof value === 'string' && value) {
            if (isDateTimeKey(key)) return <span className="whitespace-nowrap text-gray-600">{formatDateTime(value)}</span>;
            if (isDateKey(key)) return <span className="whitespace-nowrap text-gray-600">{formatDate(value)}</span>;
            if (isTimeKey(key)) return <span className="whitespace-nowrap text-gray-600">{formatTime(value)}</span>;
        }

        if (typeof value === 'boolean') {
            return (
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${value ? 'text-emerald-600' : 'text-gray-400'}`}>
                    <AppIcon name={value ? 'check' : 'close'} className="h-3.5 w-3.5" />
                    {value ? 'Yes' : 'No'}
                </span>
            );
        }

        if (Array.isArray(value)) return value.length ? <span className="text-gray-500">{value.length} items</span> : <span className="text-gray-300">—</span>;

        if (value && typeof value === 'object') {
            const label = inferObjectLabel(value);
            return label ? <span>{label}</span> : <span className="text-gray-300">—</span>;
        }

        if (value === null || value === undefined || value === '') return <span className="text-gray-300">—</span>;

        // Truncate long strings
        const str = String(value);
        if (str.length > 60) return <span title={str}>{str.slice(0, 58)}…</span>;
        return str;
    };

    const getActionsForRow = (row) => {
        const isDeleted = Boolean(row?.deleted_at);
        const status = String(row?.status ?? '');
        const actions = [];

        if (onEdit && !isDeleted) actions.push({ value: 'edit', label: 'Edit' });
        if (onDelete && !isDeleted) actions.push({ value: 'delete', label: 'Delete' });
        if (onRestore && isDeleted) actions.push({ value: 'restore', label: 'Restore' });
        if (onBlock && blockActionStatuses.includes(status)) actions.push({ value: 'block', label: blockActionLabel });
        if (onUnblock && unblockActionStatuses.includes(status)) actions.push({ value: 'unblock', label: unblockActionLabel });

        const extras = typeof extraActionsForRow === 'function' ? extraActionsForRow(row) : [];
        (Array.isArray(extras) ? extras : []).forEach((a) => {
            if (a?.value) actions.push({ value: a.value, label: a.label || a.value });
        });

        return actions;
    };

    const buttonsForRow = (row) => {
        const allowed = new Set(Array.isArray(buttonActions) ? buttonActions : []);
        const out = [];
        if (allowed.has('view')) out.push({ value: 'view', label: 'View' });
        getActionsForRow(row).forEach((a) => { if (allowed.has(a.value)) out.push(a); });
        return out;
    };

    const renderAction = (a, row) => {
        if (!a?.value) return null;
        const handlers = {
            view:    () => onView?.(row),
            edit:    () => onEdit?.(row),
            delete:  () => onDelete?.(row),
            restore: () => onRestore?.(row),
            block:   () => onBlock?.(row),
            unblock: () => onUnblock?.(row),
        };
        const handler = handlers[a.value] ?? (() => onExtraAction?.(a.value, row));
        const variantMap = { view: 'blue', edit: 'default', delete: 'red', restore: 'default', block: 'amber', unblock: 'green' };
        const iconMap = { view: 'eye', edit: 'edit', delete: 'trash', restore: 'restore', block: 'close', unblock: 'check' };
        const variant = variantMap[a.value] || 'default';
        const icon = iconMap[a.value];

        return (
            <Btn key={a.value} onClick={handler} variant={variant}>
                {icon && <AppIcon name={icon} className="h-3 w-3" />}
                {a.label}
            </Btn>
        );
    };

    const colLabel = (key) => (columnLabels?.[key] || key).replaceAll('_', ' ');

    return (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-gray-200 bg-gray-50">
                            {keys.map((key) => (
                                <th key={key} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    {colLabel(key)}
                                </th>
                            ))}
                            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {rows.map((row) => (
                            <tr
                                key={row.id}
                                className={`transition-colors hover:bg-gray-50 ${row?.deleted_at ? 'opacity-60' : ''}`}
                            >
                                {keys.map((key) => (
                                    <td key={key} className="px-4 py-3.5 text-gray-700">
                                        {formatValue(row[key], key, row)}
                                    </td>
                                ))}
                                <td className="px-4 py-3.5">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {actionMode === 'buttons' && Array.isArray(buttonActions) && buttonActions.length
                                            ? buttonsForRow(row).map((a) => renderAction(a, row))
                                            : (
                                                <>
                                                    {onView && (
                                                        <Btn onClick={() => onView(row)} variant="blue">
                                                            <AppIcon name="eye" className="h-3 w-3" />
                                                            View
                                                        </Btn>
                                                    )}
                                                    {getActionsForRow(row).map((a) => renderAction(a, row))}
                                                </>
                                            )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
