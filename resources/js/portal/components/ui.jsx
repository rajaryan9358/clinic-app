import React from 'react';

// Small, reusable UI primitives shared by every portal screen. Kept
// deliberately plain (no variants beyond what's used) so later tasks
// (visits/booking/prescriptions/family) can lean on the same building
// blocks instead of re-styling from scratch.

export function Spinner({ className = 'h-5 w-5' }) {
    return (
        <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true" role="status">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
            />
        </svg>
    );
}

export function ErrorText({ children }) {
    if (!children) return null;
    return (
        <p role="alert" className="text-sm text-red-600">
            {children}
        </p>
    );
}

export function Card({ className = '', children, ...props }) {
    return (
        <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 ${className}`} {...props}>
            {children}
        </div>
    );
}

const BUTTON_VARIANTS = {
    primary: 'bg-[var(--accent)] text-white hover:brightness-95 focus-visible:ring-[var(--accent)]/40',
    secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200 focus-visible:ring-slate-300',
    ghost: 'bg-transparent text-[var(--accent)] hover:bg-slate-50 focus-visible:ring-[var(--accent)]/30',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100 focus-visible:ring-red-300',
};

export function Button({ variant = 'primary', className = '', loading = false, disabled, children, ...props }) {
    const styles = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary;

    return (
        <button
            className={`inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-medium transition focus-visible:outline-none focus-visible:ring-2 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 ${styles} ${className}`}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            {...props}
        >
            {loading ? <Spinner className="h-4 w-4" /> : null}
            {children}
        </button>
    );
}

// A bottom-anchored modal sheet (clinic switcher today; reusable for
// filters/pickers in later tasks). Renders nothing while closed so it
// never steals focus/tab order from the page behind it.
export function BottomSheet({ open, onClose, title, children }) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
            <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
            <div className="relative z-10 w-full max-w-md rounded-t-3xl bg-white p-4 shadow-xl" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
                <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
                {title ? <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2> : null}
                {children}
            </div>
        </div>
    );
}
