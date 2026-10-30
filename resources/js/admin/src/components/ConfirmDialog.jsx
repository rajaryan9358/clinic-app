import AppIcon from './AppIcon';
import { btn } from './ui';

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

    const spinner = (tone) => (
        <span className="flex items-center gap-2">
            <span className={`h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent ${tone}`} />
            Working…
        </span>
    );

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
            aria-modal="true"
            role="dialog"
            aria-labelledby="confirm-dialog-title"
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start gap-4 px-5 py-5">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${danger ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>
                        <AppIcon name={danger ? 'alert-triangle' : 'info'} className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                        <h3 id="confirm-dialog-title" className="text-base font-semibold text-slate-900">{title}</h3>
                        {message ? <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{message}</p> : null}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        aria-label="Close"
                        className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                    >
                        <AppIcon name="close" className="h-4 w-4" />
                    </button>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
                    <button type="button" onClick={onClose} disabled={busy} className={btn.secondary}>
                        {cancelText}
                    </button>

                    {showForce ? (
                        <button type="button" onClick={onForce} disabled={busy} className={btn.secondary}>
                            {busy ? spinner('border-slate-400') : forceText}
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy || confirmDisabled}
                        className={danger
                            ? 'inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50'
                            : btn.primary}
                    >
                        {busy ? spinner('border-white') : confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
