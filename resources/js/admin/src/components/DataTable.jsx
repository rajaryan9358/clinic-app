import StatusBadge from './StatusBadge';
import AppIcon from './AppIcon';
import { EmptyState } from './ui';
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
        default: 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
        blue:    'text-blue-700 hover:bg-blue-50 hover:text-blue-900',
        red:     'text-rose-700 hover:bg-rose-50 hover:text-rose-800',
        amber:   'text-amber-800 hover:bg-amber-50',
        green:   'text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800',
    };
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold transition-colors ${variants[variant]}`}
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
    framed = true,
}) {
    const frame = framed ? 'overflow-hidden rounded-2xl border border-slate-200 bg-white' : '';

    if (!rows.length) {
        return (
            <div className={frame}>
                <EmptyState title="No records found">Try adjusting your search or filters.</EmptyState>
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
            if (isDateTimeKey(key)) return <span className="whitespace-nowrap text-slate-600">{formatDateTime(value)}</span>;
            if (isDateKey(key)) return <span className="whitespace-nowrap text-slate-600">{formatDate(value)}</span>;
            if (isTimeKey(key)) return <span className="whitespace-nowrap text-slate-600">{formatTime(value)}</span>;
        }

        if (typeof value === 'boolean') {
            return (
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${value ? 'text-emerald-700' : 'text-slate-500'}`}>
                    <AppIcon name={value ? 'check' : 'close'} className="h-3.5 w-3.5" />
                    {value ? 'Yes' : 'No'}
                </span>
            );
        }

        if (Array.isArray(value)) return value.length ? <span className="text-slate-600">{value.length} items</span> : <span className="text-slate-400">—</span>;

        if (value && typeof value === 'object') {
            const label = inferObjectLabel(value);
            return label ? <span>{label}</span> : <span className="text-slate-400">—</span>;
        }

        if (value === null || value === undefined || value === '') return <span className="text-slate-400">—</span>;

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
                {icon && <AppIcon name={icon} className="h-3.5 w-3.5" />}
                {a.label}
            </Btn>
        );
    };

    const colLabel = (key) => {
        if (!columnLabels?.[key] && key === 'id') return 'ID';
        const text = String(columnLabels?.[key] || key).replaceAll('_', ' ');
        return text.charAt(0).toUpperCase() + text.slice(1);
    };

    return (
        <div className={frame}>
            <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                    <thead>
                        <tr className="bg-slate-50">
                            {keys.map((key) => (
                                <th key={key} scope="col" className="whitespace-nowrap px-4 py-3 text-xs font-medium text-slate-600">
                                    {colLabel(key)}
                                </th>
                            ))}
                            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-slate-600">
                                <span className="sr-only">Actions</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr
                                key={row.id}
                                className={`border-t border-slate-100 transition-colors hover:bg-slate-50 ${row?.deleted_at ? 'opacity-60' : ''}`}
                            >
                                {keys.map((key) => (
                                    <td key={key} className="px-4 py-3 text-slate-700">
                                        {formatValue(row[key], key, row)}
                                    </td>
                                ))}
                                <td className="px-4 py-2">
                                    <div className="flex items-center justify-end gap-0.5">
                                        {actionMode === 'buttons' && Array.isArray(buttonActions) && buttonActions.length
                                            ? buttonsForRow(row).map((a) => renderAction(a, row))
                                            : (
                                                <>
                                                    {onView && (
                                                        <Btn onClick={() => onView(row)} variant="blue">
                                                            <AppIcon name="eye" className="h-3.5 w-3.5" />
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
