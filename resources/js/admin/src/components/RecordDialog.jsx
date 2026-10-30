import AppIcon from './AppIcon';
import StatusBadge from './StatusBadge';

function prettyLabel(key) {
    const text = key.replaceAll('_', ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatValue(value, key) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'boolean') {
        return (
            <span className={`inline-flex items-center gap-1 text-xs font-medium ${value ? 'text-emerald-700' : 'text-slate-500'}`}>
                <AppIcon name={value ? 'check' : 'close'} className="h-3 w-3" />
                {value ? 'Yes' : 'No'}
            </span>
        );
    }
    if (typeof value === 'object') {
        if (Array.isArray(value)) return <span className="font-mono text-xs text-slate-600">{JSON.stringify(value, null, 2)}</span>;
        for (const k of ['name', 'full_name', 'fullName', 'title', 'label']) {
            if (value?.[k] !== undefined && value?.[k] !== null) return String(value[k]);
        }
        return <span className="font-mono text-xs text-slate-600">{JSON.stringify(value, null, 2)}</span>;
    }
    if (String(key).includes('status')) return <StatusBadge status={value} />;
    return String(value);
}

function Field({ label, value, fieldKey }) {
    const formatted = formatValue(value, fieldKey);
    if (formatted === null) return null;

    return (
        <div className="min-w-0 py-3">
            <dt className="text-xs font-medium text-slate-600">{label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-900">{formatted}</dd>
        </div>
    );
}

function Header({ title, onClose }) {
    return (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <h3 className="min-w-0 truncate text-base font-semibold text-slate-900">{title}</h3>
            <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
                <AppIcon name="close" className="h-4 w-4" />
            </button>
        </div>
    );
}

export default function RecordDialog({ title, open, record, onClose, hiddenKeys = [], variant = 'dialog' }) {
    if (!open) return null;

    const hidden = new Set([
        'password', 'remember_token', 'clinic_id',
        'deleted_at', 'created_at', 'updated_at', ...(hiddenKeys || []),
    ]);
    const entries = Object.entries(record || {}).filter(([key]) => !hidden.has(key));

    if (variant === 'sheet') {
        return (
            <div className="fixed inset-0 z-50 flex bg-slate-950/50" aria-modal="true" role="dialog" onClick={onClose}>
                <div
                    className="relative ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                >
                    <Header title={title} onClose={onClose} />
                    <div className="flex-1 overflow-y-auto px-5 py-2">
                        <dl className="divide-y divide-slate-100">
                            {entries.map(([key, value]) => (
                                <Field key={key} label={prettyLabel(key)} value={value} fieldKey={key} />
                            ))}
                        </dl>
                    </div>
                </div>
            </div>
        );
    }

    // Default: centered modal
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
            aria-modal="true"
            role="dialog"
            onClick={onClose}
        >
            <div
                className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <Header title={title} onClose={onClose} />
                <div className="max-h-[calc(90vh-4rem)] overflow-y-auto px-5 py-2">
                    <dl className="grid gap-x-6 md:grid-cols-2 [&>div]:border-b [&>div]:border-slate-100">
                        {entries.map(([key, value]) => (
                            <Field key={key} label={prettyLabel(key)} value={value} fieldKey={key} />
                        ))}
                    </dl>
                </div>
            </div>
        </div>
    );
}
