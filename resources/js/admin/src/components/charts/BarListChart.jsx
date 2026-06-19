import { useMemo } from 'react';

const BAR_COLORS = [
    'bg-blue-500',
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
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            {(title || subtitle) && (
                <div className="mb-4">
                    {title && <h3 className="text-sm font-semibold text-gray-900">{title}</h3>}
                    {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
                </div>
            )}

            {!trimmed.length ? (
                <div className="flex h-20 items-center justify-center text-sm text-gray-400">No data</div>
            ) : (
                <div className="space-y-3">
                    {trimmed.map((it, idx) => {
                        const label = String(it?.[labelKey] ?? `Item ${idx + 1}`);
                        const value = Number(it?.[valueKey] ?? 0);
                        const pct = Math.round((value / max) * 100);
                        const barColor = BAR_COLORS[idx % BAR_COLORS.length];

                        return (
                            <div key={`${label}:${idx}`}>
                                <div className="flex items-center justify-between gap-3 mb-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${barColor}`} />
                                        <span className="truncate text-xs font-medium text-gray-700">{label}</span>
                                    </div>
                                    <span className="flex-shrink-0 text-xs font-bold text-gray-900">{value}</span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
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
    );
}
