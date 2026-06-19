import AppIcon from './AppIcon';
import StatusBadge from './StatusBadge';

function prettyLabel(key) {
    return key.replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatValue(value, key) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'boolean') {
        return (
            <span className={`inline-flex items-center gap-1 text-xs font-medium ${value ? 'text-emerald-600' : 'text-gray-400'}`}>
                <AppIcon name={value ? 'check' : 'close'} className="h-3 w-3" />
                {value ? 'Yes' : 'No'}
            </span>
        );
    }
    if (typeof value === 'object') {
        if (Array.isArray(value)) return <span className="font-mono text-xs text-gray-500">{JSON.stringify(value, null, 2)}</span>;
        for (const k of ['name', 'full_name', 'fullName', 'title', 'label']) {
            if (value?.[k] !== undefined && value?.[k] !== null) return String(value[k]);
        }
        return <span className="font-mono text-xs text-gray-500">{JSON.stringify(value, null, 2)}</span>;
    }
    if (String(key).includes('status')) return <StatusBadge status={value} />;
    return String(value);
}

function Field({ label, value, fieldKey }) {
    const formatted = formatValue(value, fieldKey);
    if (formatted === null) return null;

    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                {label}
            </p>
            <div className="break-words text-sm text-gray-900 whitespace-pre-wrap">{formatted}</div>
        </div>
    );
}

export default function RecordDialog({ title, open, record, onClose, hiddenKeys = [], variant = 'dialog' }) {
    if (!open) return null;

    const hidden = new Set([
        'password', 'remember_token', 'clinic_id', 'branch_id',
        'deleted_at', 'created_at', 'updated_at', ...(hiddenKeys || []),
    ]);
    const entries = Object.entries(record || {}).filter(([key]) => !hidden.has(key));

    if (variant === 'sheet') {
        return (
            <div className="fixed inset-0 z-50 flex" aria-modal="true" role="dialog">
                <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />

                <div
                    className="relative ml-auto flex h-full w-full max-w-xl flex-col border-l border-gray-200 bg-white shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
                                <AppIcon name="eye" className="h-4 w-4 text-blue-600" />
                            </div>
                            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        >
                            <AppIcon name="close" className="h-4 w-4" />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto p-5">
                        <div className="grid gap-3">
                            {entries.map(([key, value]) => (
                                <Field key={key} label={prettyLabel(key)} value={value} fieldKey={key} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Default: centered modal
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            aria-modal="true"
            role="dialog"
            onClick={onClose}
        >
            <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm" />

            <div
                className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-5 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
                            <AppIcon name="eye" className="h-4 w-4 text-blue-600" />
                        </div>
                        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                        <AppIcon name="close" className="h-4 w-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="max-h-[calc(90vh-4rem)] overflow-y-auto p-5">
                    <div className="grid gap-3 md:grid-cols-2">
                        {entries.map(([key, value]) => (
                            <Field key={key} label={prettyLabel(key)} value={value} fieldKey={key} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
