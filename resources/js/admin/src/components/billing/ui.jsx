import { useEffect, useRef } from 'react';
import AppIcon from '../AppIcon';

// ── Shared small UI helpers for the billing pages (Plans, Subscription
// Transactions, Payments settings, Subscription card) — copied from
// ClinicDetailPage's local helpers so this module has no cross-page import. ──

export function Card({ children, className = '' }) {
    return <div className={`rounded-2xl border border-slate-200 bg-white ${className}`}>{children}</div>;
}

export function SectionHeader({ title, subtitle, action }) {
    return (
        <div className="flex items-center justify-between gap-4 pb-4">
            <div>
                <h3 className="text-base font-semibold text-slate-900">{title}</h3>
                {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
            </div>
            {action}
        </div>
    );
}

export function EmptyState({ icon, text }) {
    return (
        <div className="flex flex-col items-center justify-center py-14 text-center">
            <AppIcon name={icon} className="mb-3 h-8 w-8 text-slate-200" />
            <p className="text-sm text-slate-500">{text}</p>
        </div>
    );
}

export function LoadingState() {
    return (
        <div className="flex items-center justify-center py-14">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
    );
}

export function Btn({ onClick, children, variant = 'secondary', disabled, type = 'button', className = '' }) {
    const base = 'inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold transition-colors disabled:opacity-50';
    const styles = {
        primary: 'bg-blue-600 text-white hover:bg-blue-700',
        secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
        danger: 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50',
        ghost: 'text-blue-600 hover:underline text-xs font-medium',
    };
    return (
        <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]} ${className}`}>
            {children}
        </button>
    );
}

export function Sheet({ open, title, subtitle, onClose, children, footer }) {
    const overlayRef = useRef(null);
    useEffect(() => {
        if (!open) return;
        const handler = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-end" aria-modal="true" role="dialog">
            <div ref={overlayRef} className="absolute inset-0 bg-slate-950/50" onClick={onClose} />
            <div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
                    <div>
                        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
                    </div>
                    <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-600">
                        <AppIcon name="close" className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
                {footer && <div className="border-t border-slate-200 px-6 py-4">{footer}</div>}
            </div>
        </div>
    );
}

export function Field({ label, required, error, hint, children }) {
    return (
        <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
                {label}{required && <span className="ml-0.5 text-rose-500">*</span>}
            </label>
            {children}
            {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
            {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        </div>
    );
}

export function TextInput({ value, onChange, placeholder, type = 'text', disabled = false, readOnly = false, min, max }) {
    return (
        <input
            type={type}
            value={value ?? ''}
            disabled={disabled}
            readOnly={readOnly}
            min={min}
            max={max}
            onChange={(e) => (onChange ? onChange(e.target.value) : undefined)}
            placeholder={placeholder}
            className={`w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${disabled ? 'bg-slate-50 text-slate-500' : ''}`}
        />
    );
}

export function SelectInput({ value, onChange, options, disabled = false }) {
    return (
        <select
            value={value || ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={`w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${disabled ? 'bg-slate-50 text-slate-500' : ''}`}
        >
            {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
            ))}
        </select>
    );
}

export function Toggle({ checked, onChange, label }) {
    return (
        <label className="flex cursor-pointer items-center gap-3">
            <div className="relative flex-shrink-0">
                <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
                <div className={`flex h-5 w-9 items-center rounded-full transition-colors ${Boolean(checked) ? 'bg-blue-600' : 'bg-slate-200'}`}>
                    <div className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${Boolean(checked) ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
            </div>
            <span className="text-sm text-slate-700">{label}</span>
        </label>
    );
}

export function ErrorText({ children }) {
    if (!children) return null;
    return <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{children}</p>;
}

export function SuccessText({ children }) {
    if (!children) return null;
    return <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{children}</p>;
}
