// Shared building blocks for the redesigned admin. Pages should reach for
// these (and the class strings below) instead of restyling from scratch, so
// every screen keeps the same look: slate text, white rounded-2xl cards with
// a slate-200 border, blue-600 primary actions, slate-900 selected tabs.
import { Link } from 'react-router-dom';
import AppIcon from './AppIcon';

export const btn = {
    primary: 'inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50',
    secondary: 'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50',
    ghost: 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50',
    danger: 'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-3.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50',
    link: 'text-sm font-semibold text-blue-700 hover:text-blue-900',
};

export const input = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500';
export const label = 'mb-1 block text-xs font-medium text-slate-600';

export function PageHeader({ title, subtitle, back, actions, children }) {
    return (
        <header className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
                {back ? (
                    <Link to={back.to} className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-900">
                        <span aria-hidden="true">‹</span> {back.label}
                    </Link>
                ) : null}
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
                {subtitle ? <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p> : null}
                {children}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
    );
}

export function Card({ title, description, actions, children, className = '', bodyClassName = 'p-5' }) {
    return (
        <section className={`rounded-2xl border border-slate-200 bg-white ${className}`}>
            {title ? (
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                        {description ? <p className="mt-0.5 text-sm text-slate-600">{description}</p> : null}
                    </div>
                    {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
                </div>
            ) : null}
            <div className={bodyClassName}>{children}</div>
        </section>
    );
}

export function Tabs({ tabs, value, onChange, label: ariaLabel = 'Views' }) {
    return (
        <div role="tablist" aria-label={ariaLabel} className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1">
            {tabs.map((t) => (
                <button
                    key={t.value}
                    type="button"
                    role="tab"
                    aria-selected={value === t.value}
                    onClick={() => onChange(t.value)}
                    className={`h-8 rounded-lg px-3 text-sm ${value === t.value ? 'bg-slate-900 font-semibold text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                    {t.label}
                </button>
            ))}
        </div>
    );
}

const BADGE_TONES = {
    slate: 'bg-slate-100 text-slate-700',
    blue: 'bg-blue-100 text-blue-800',
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-rose-100 text-rose-800',
    violet: 'bg-violet-100 text-violet-800',
    teal: 'bg-teal-100 text-teal-800',
};

export function Badge({ tone = 'slate', children }) {
    return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_TONES[tone] || BADGE_TONES.slate}`}>{children}</span>;
}

export function Alert({ tone = 'error', children, onDismiss }) {
    const cls = {
        error: 'border-rose-200 bg-rose-50 text-rose-800',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        warn: 'border-amber-200 bg-amber-50 text-amber-900',
        info: 'border-blue-200 bg-blue-50 text-blue-900',
    }[tone];
    return (
        <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${cls}`}>
            <div className="min-w-0">{children}</div>
            {onDismiss ? <button type="button" onClick={onDismiss} className="shrink-0 font-semibold">Dismiss</button> : null}
        </div>
    );
}

export function Spinner({ className = 'py-16' }) {
    return (
        <div className={`flex justify-center ${className}`}>
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" aria-label="Loading" />
        </div>
    );
}

export function EmptyState({ icon = 'module', title, children }) {
    return (
        <div className="flex flex-col items-center px-6 py-14 text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500"><AppIcon name={icon} className="h-5 w-5" /></span>
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            {children ? <div className="mt-1 text-sm text-slate-600">{children}</div> : null}
        </div>
    );
}

/** An on/off switch with a label and optional hint, as one clickable row. */
export function Toggle({ id, checked, onChange, title, hint, disabled }) {
    return (
        <label htmlFor={id} className={`flex items-start justify-between gap-4 py-3 ${disabled ? 'cursor-default' : 'cursor-pointer'}`}>
            <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{title}</span>
                {hint ? <span className="mt-0.5 block text-sm text-slate-600">{hint}</span> : null}
            </span>
            <span className="relative mt-0.5 inline-flex shrink-0">
                <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
                <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300 peer-disabled:opacity-50" />
                <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
            </span>
        </label>
    );
}

/** A labelled number input with a unit suffix, laid out as a settings row. */
export function NumberRow({ id, value, onChange, title, hint, unit, min, max, disabled }) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-4 py-3">
            <label htmlFor={id} className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900">{title}</span>
                {hint ? <span className="mt-0.5 block text-sm text-slate-600">{hint}</span> : null}
            </label>
            <span className="flex items-center gap-2">
                <input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={min}
                    max={max}
                    value={value ?? ''}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
                    className="h-10 w-24 rounded-xl border border-slate-300 bg-white px-3 text-right text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500"
                />
                {unit ? <span className="w-16 text-sm text-slate-600">{unit}</span> : null}
            </span>
        </div>
    );
}

/** Sticky bar shown only while a form has unsaved changes. */
export function SaveBar({ visible, saving, onSave, onDiscard, message = 'You have unsaved changes.' }) {
    if (!visible) return null;
    return (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur lg:left-64">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
                <p className="text-sm text-slate-700">{message}</p>
                <div className="flex gap-2">
                    <button type="button" onClick={onDiscard} disabled={saving} className={btn.secondary}>Discard</button>
                    <button type="button" onClick={onSave} disabled={saving} className={btn.primary}>{saving ? 'Saving…' : 'Save changes'}</button>
                </div>
            </div>
        </div>
    );
}
