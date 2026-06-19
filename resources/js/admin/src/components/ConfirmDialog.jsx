import AppIcon from './AppIcon';

export default function ConfirmDialog({
    open,
    title = 'Confirm',
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    danger = false,
    busy = false,
    confirmDisabled = false,
    forceText = 'Force Change',
    showForce = false,
    onForce,
    onConfirm,
    onClose,
}) {
    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            aria-modal="true"
            role="dialog"
        >
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Dialog */}
            <div
                className="relative w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start gap-4 px-5 py-5">
                    <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${danger ? 'bg-red-100' : 'bg-blue-100'}`}>
                        <AppIcon
                            name={danger ? 'alert-triangle' : 'info'}
                            className={`h-5 w-5 ${danger ? 'text-red-600' : 'text-blue-600'}`}
                        />
                    </div>
                    <div className="flex-1 pt-0.5">
                        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
                        {message ? <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">{message}</p> : null}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="flex-shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                    >
                        <AppIcon name="close" className="h-4 w-4" />
                    </button>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2.5 border-t border-gray-100 bg-gray-50 px-5 py-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                    >
                        {cancelText}
                    </button>

                    {showForce ? (
                        <button
                            type="button"
                            onClick={onForce}
                            disabled={busy}
                            className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:opacity-50"
                        >
                            {busy ? (
                                <span className="flex items-center gap-2">
                                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                                    Working…
                                </span>
                            ) : forceText}
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy || confirmDisabled}
                        className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${
                            danger
                                ? 'bg-red-600 hover:bg-red-700'
                                : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                    >
                        {busy ? (
                            <span className="flex items-center gap-2">
                                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                Working…
                            </span>
                        ) : confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
