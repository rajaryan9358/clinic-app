import { useMemo } from 'react';

const BAR_COLORS = [
    'bg-blue-600',
    'bg-emerald-500',
    'bg-violet-500',
    'bg-amber-500',
    'bg-sky-500',
    'bg-rose-500',
    'bg-indigo-500',
    'bg-orange-500',
];

export default function BarListChart({ title, subtitle, items = [], labelKey = 'label', valueKey = 'count', maxItems = 10 }) {
    const trimmed = (items || []).slice(0, maxItems);
    const max = useMemo(() => Math.max(1, ...trimmed.map((i) => Number(i?.[valueKey] ?? 0))), [trimmed, valueKey]);

    return (
        <section className="h-full rounded-2xl border border-slate-200 bg-white">
            {(title || subtitle) && (
                <div className="border-b border-slate-100 px-5 py-4">
                    {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
                    {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
                </div>
            )}

            <div className="p-5">
            {!trimmed.length ? (
                <div className="flex h-20 items-center justify-center text-sm text-slate-500">No data yet</div>
            ) : (
                <div className="space-y-3">
                    {trimmed.map((it, idx) => {
                        const label = String(it?.[labelKey] ?? `Item ${idx + 1}`);
                        const value = Number(it?.[valueKey] ?? 0);
                        const pct = Math.round((value / max) * 100);
                        // One series, one colour: bars are compared by length, not hue.
                        const barColor = BAR_COLORS[0];

                        return (
                            <div key={`${label}:${idx}`}>
                                <div className="mb-1 flex items-center justify-between gap-3">
                                    <span className="min-w-0 truncate text-sm capitalize text-slate-700">{label.replace(/_/g, ' ')}</span>
                                    <span className="flex-shrink-0 text-sm font-semibold text-slate-900 tabular-nums">{value}</span>
                                </div>
                                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                                    <div
                                        className={`h-full rounded-full transition-all ${barColor}`}
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            </div>
        </section>
    );
}
