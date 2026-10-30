import React from 'react';
import { ChevronLeftIcon } from './icons';

// Small, reusable UI primitives shared by every portal screen. They follow
// the staff admin's visual language (white rounded-2xl cards with a
// slate-200 border, slate text, tinted badges, rose/emerald/amber alerts)
// but are sized for phones: 48px buttons, 44px+ touch targets, 16px input
// text (no iOS zoom). The primary colour is `--accent`: the clinic's brand
// colour when it has one (set by Shell.jsx), otherwise blue-600 (App.jsx).

/** The default accent when a clinic has no brand colour (Tailwind blue-600). */
export const DEFAULT_ACCENT = '#2563eb';

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

/** Centered page/section loading indicator in the accent colour. */
export function Loading({ className = 'py-16', label = 'Loading' }) {
    return (
        <div className={`flex justify-center ${className}`} aria-label={label}>
            <Spinner className="h-7 w-7 text-[var(--accent)]" />
        </div>
    );
}

const ALERT_TONES = {
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-slate-200 bg-slate-50 text-slate-700',
};

export function Alert({ tone = 'error', className = '', children, ...props }) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${ALERT_TONES[tone] || ALERT_TONES.error} ${className}`}
            {...props}
        >
            {children}
        </div>
    );
}

export function ErrorText({ children }) {
    if (!children) return null;
    return <Alert tone="error">{children}</Alert>;
}

export function Card({ className = '', children, ...props }) {
    return (
        <div className={`rounded-2xl border border-slate-200 bg-white p-4 ${className}`} {...props}>
            {children}
        </div>
    );
}

/** Small heading inside a card ("Next appointment", "Medicines"…). */
export function CardTitle({ children, className = '' }) {
    return <h2 className={`mb-2 text-sm font-semibold text-slate-900 ${className}`}>{children}</h2>;
}

/** Field/section label above a group of choices or an input. */
export function SectionLabel({ children, htmlFor, as: As = htmlFor ? 'label' : 'h2' }) {
    return (
        <As htmlFor={htmlFor} className="mb-2 block text-sm font-semibold text-slate-900">
            {children}
        </As>
    );
}

export const inputClass =
    'w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 disabled:bg-slate-50 disabled:text-slate-500';

export const labelClass = 'mb-1.5 block text-sm font-medium text-slate-700';

const BADGE_TONES = {
    slate: 'bg-slate-100 text-slate-700',
    accent: 'bg-[var(--accent)]/10 text-[var(--accent)]',
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-rose-100 text-rose-800',
    blue: 'bg-blue-100 text-blue-800',
};

export function Badge({ tone = 'slate', className = '', children }) {
    return (
        <span
            className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE_TONES[tone] || BADGE_TONES.slate} ${className}`}
        >
            {children}
        </span>
    );
}

/** Page title block: optional back link, h1 and a short subtitle. */
export function PageHeader({ title, subtitle, back, eyebrow }) {
    return (
        <header className="space-y-1">
            {back ? (
                <button
                    type="button"
                    onClick={back.onClick}
                    className="-ml-2 mb-1 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-sm font-semibold text-[var(--accent)] hover:bg-slate-100"
                >
                    <ChevronLeftIcon className="h-4 w-4" />
                    {back.label}
                </button>
            ) : null}
            {eyebrow ? <p className="text-sm text-slate-600">{eyebrow}</p> : null}
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
            {subtitle ? <p className="text-sm text-slate-600">{subtitle}</p> : null}
        </header>
    );
}

export function EmptyState({ icon: IconComponent, title, children }) {
    return (
        <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
            {IconComponent ? (
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <IconComponent className="h-5 w-5" />
                </span>
            ) : null}
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            {children ? <div className="mt-1 text-sm text-slate-600">{children}</div> : null}
        </div>
    );
}

/**
 * A row of large, equal-width choice buttons (visit type, mode). Selected
 * option takes the accent; the rest are white bordered.
 */
export function ChoiceGroup({ label, options, value, onChange }) {
    return (
        <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-2">
            {options.map((opt) => {
                const selected = value === opt.value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onChange(opt.value)}
                        className={`min-h-[48px] rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                            selected
                                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                        }`}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}

const BUTTON_VARIANTS = {
    primary: 'border border-transparent bg-[var(--accent)] text-white hover:brightness-95 focus-visible:ring-[var(--accent)]/40',
    secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:ring-slate-300',
    ghost: 'border border-transparent bg-transparent text-[var(--accent)] hover:bg-slate-100 focus-visible:ring-[var(--accent)]/30',
    danger: 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-300',
};

export function Button({ variant = 'primary', className = '', loading = false, disabled, children, ...props }) {
    const styles = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary;

    return (
        <button
            className={`inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-semibold transition focus-visible:outline-none focus-visible:ring-2 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 ${styles} ${className}`}
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
            <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-950/50" />
            <div
                className="relative z-10 w-full max-w-md rounded-t-2xl bg-white shadow-2xl"
                style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            >
                <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-200" aria-hidden="true" />
                {title ? (
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2">
                        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close"
                            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                            <span aria-hidden="true" className="text-2xl leading-none">&times;</span>
                        </button>
                    </div>
                ) : null}
                <div className="space-y-3 p-4">{children}</div>
            </div>
        </div>
    );
}
