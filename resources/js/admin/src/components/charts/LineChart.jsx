import { useMemo } from 'react';

export default function LineChart({ title, subtitle, data = [], xKey = 'date', yKey = 'count', height = 120 }) {
    const { points, polyline, area, last, max } = useMemo(() => {
        const w = 480;
        const h = height;
        const padX = 4;
        const padY = 8;
        const values = (data || []).map((d) => Number(d?.[yKey] ?? 0));
        const maxVal = Math.max(1, ...values);
        const n = Math.max(1, values.length);

        const pts = (data || []).map((d, idx) => {
            const x = padX + (idx * (w - padX * 2)) / (n - 1 || 1);
            const v = Number(d?.[yKey] ?? 0);
            const y = padY + (1 - v / maxVal) * (h - padY * 2);
            return { x, y, label: String(d?.[xKey] ?? idx), value: v };
        });

        const poly = pts.map((p) => `${p.x},${p.y}`).join(' ');

        // Build area path (closed polygon)
        let areaPath = '';
        if (pts.length > 1) {
            areaPath = `M${pts[0].x},${h} ` + pts.map((p) => `L${p.x},${p.y}`).join(' ') + ` L${pts[pts.length - 1].x},${h} Z`;
        }

        return { points: pts, polyline: poly, area: areaPath, last: pts[pts.length - 1], max: maxVal };
    }, [data, xKey, yKey, height]);

    if (!data?.length) {
        return (
            <section className="rounded-2xl border border-slate-200 bg-white">
                {title && (
                    <div className="border-b border-slate-100 px-5 py-4">
                        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                        {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
                    </div>
                )}
                <div className="flex h-[120px] items-center justify-center p-5 text-sm text-slate-500">No data yet</div>
            </section>
        );
    }

    return (
        <section className="rounded-2xl border border-slate-200 bg-white">
            {(title || last) && (
                <div className={`flex items-start justify-between gap-4 ${title ? 'border-b border-slate-100 px-5 py-4' : 'px-5 pt-5'}`}>
                    <div className="min-w-0">
                        {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
                        {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
                    </div>
                    {last && (
                        <div className="flex-shrink-0 text-right">
                            <p className="text-xs font-medium text-slate-600">Latest</p>
                            <p className="text-xl font-bold text-slate-900 tabular-nums">{last.value}</p>
                        </div>
                    )}
                </div>
            )}

            <div className="p-5">
            <svg viewBox={`0 0 480 ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" role="img" aria-label={title || 'Trend'}>
                <defs>
                    <linearGradient id="lineChartGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563EB" stopOpacity="0.12" />
                        <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
                    </linearGradient>
                </defs>

                {/* Grid lines */}
                {[0.25, 0.5, 0.75, 1].map((t) => {
                    const y = 8 + (1 - t) * (height - 16);
                    return <line key={t} x1="4" y1={y} x2="476" y2={y} stroke="#F1F5F9" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
                })}

                {/* Area fill */}
                {area && <path d={area} fill="url(#lineChartGrad)" />}

                {/* Line */}
                <polyline
                    points={polyline}
                    fill="none"
                    stroke="#2563EB"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />

                {/* Dots — show all for small datasets, just last for large */}
                {(data.length <= 15 ? points : points.slice(-1)).map((p) => (
                    <circle key={p.label} cx={p.x} cy={p.y} r="3.5" fill="#2563EB" stroke="#fff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                ))}
            </svg>
            </div>
        </section>
    );
}
