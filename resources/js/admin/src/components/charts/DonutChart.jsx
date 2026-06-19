import { useMemo } from 'react';

const PALETTE = [
    { stroke: '#2563EB', bg: 'bg-blue-500' },
    { stroke: '#10B981', bg: 'bg-emerald-500' },
    { stroke: '#F59E0B', bg: 'bg-amber-500' },
    { stroke: '#8B5CF6', bg: 'bg-violet-500' },
    { stroke: '#F43F5E', bg: 'bg-rose-500' },
    { stroke: '#0EA5E9', bg: 'bg-sky-500' },
    { stroke: '#F97316', bg: 'bg-orange-500' },
    { stroke: '#6366F1', bg: 'bg-indigo-500' },
];

export default function DonutChart({ title, subtitle, items = [], valueKey = 'count' }) {
    const total = useMemo(() => (items || []).reduce((s, it) => s + Number(it?.[valueKey] ?? 0), 0), [items, valueKey]);

    const segments = useMemo(() => {
        if (!total) return [];
        const r = 18;
        const c = 2 * Math.PI * r;
        let offset = 0;
        return (items || []).map((it, idx) => {
            const val = Number(it?.[valueKey] ?? 0);
            const frac = val / total;
            const len = frac * c;
            const color = PALETTE[idx % PALETTE.length];
            const seg = {
                key: it?.label ?? it?.status ?? it?.source ?? String(idx),
                label: it?.label ?? it?.status ?? it?.source ?? `Item ${idx + 1}`,
                value: val,
                stroke: color.stroke,
                bg: color.bg,
                dasharray: `${len} ${c - len}`,
                dashoffset: -offset,
            };
            offset += len;
            return seg;
        });
    }, [items, total, valueKey]);

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            {(title || subtitle) && (
                <div className="mb-5">
                    {title && <h3 className="text-sm font-semibold text-gray-900">{title}</h3>}
                    {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
                </div>
            )}

            {!items?.length || !total ? (
                <div className="flex h-32 items-center justify-center text-sm text-gray-400">No data</div>
            ) : (
                <div className="flex flex-col items-center gap-5 sm:flex-row">
                    {/* Donut */}
                    <div className="flex-shrink-0">
                        <svg viewBox="0 0 48 48" className="h-32 w-32">
                            <circle cx="24" cy="24" r="18" stroke="#F3F4F6" strokeWidth="7" fill="none" />
                            {segments.map((s) => (
                                <circle
                                    key={s.key}
                                    cx="24" cy="24" r="18"
                                    stroke={s.stroke}
                                    strokeWidth="7"
                                    fill="none"
                                    strokeDasharray={s.dasharray}
                                    strokeDashoffset={s.dashoffset}
                                    transform="rotate(-90 24 24)"
                                    strokeLinecap="butt"
                                />
                            ))}
                            <text x="24" y="22" textAnchor="middle" dominantBaseline="middle" fill="#111827" fontSize="7" fontWeight="700">
                                {total}
                            </text>
                            <text x="24" y="29" textAnchor="middle" dominantBaseline="middle" fill="#9CA3AF" fontSize="4.5">
                                total
                            </text>
                        </svg>
                    </div>

                    {/* Legend */}
                    <div className="flex-1 min-w-0 space-y-2 w-full">
                        {segments.map((s) => {
                            const pct = total ? Math.round((s.value / total) * 100) : 0;
                            return (
                                <div key={s.key} className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${s.bg}`} />
                                        <span className="truncate text-xs font-medium text-gray-700">{s.label}</span>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <span className="text-xs font-bold text-gray-900">{s.value}</span>
                                        <span className="text-[10px] text-gray-400 w-7 text-right">{pct}%</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
