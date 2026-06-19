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
            <div className="rounded-xl border border-gray-200 bg-white p-5">
                {title && <h3 className="text-sm font-semibold text-gray-900">{title}</h3>}
                <div className="mt-4 flex h-[120px] items-center justify-center text-sm text-gray-400">No data</div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            {(title || last) && (
                <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                        {title && <h3 className="text-sm font-semibold text-gray-900">{title}</h3>}
                        {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
                    </div>
                    {last && (
                        <div className="text-right flex-shrink-0">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Latest</p>
                            <p className="text-xl font-bold text-blue-600">{last.value}</p>
                        </div>
                    )}
                </div>
            )}

            <svg viewBox={`0 0 480 ${height}`} className="w-full" style={{ height }}>
                <defs>
                    <linearGradient id="lineChartGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563EB" stopOpacity="0.12" />
                        <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
                    </linearGradient>
                </defs>

                {/* Grid lines */}
                {[0.25, 0.5, 0.75, 1].map((t) => {
                    const y = 8 + (1 - t) * (height - 16);
                    return <line key={t} x1="4" y1={y} x2="476" y2={y} stroke="#F3F4F6" strokeWidth="1" />;
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
                />

                {/* Dots — show all for small datasets, just last for large */}
                {(data.length <= 15 ? points : points.slice(-1)).map((p) => (
                    <circle key={p.label} cx={p.x} cy={p.y} r="3.5" fill="#2563EB" stroke="#fff" strokeWidth="1.5" />
                ))}
            </svg>
        </div>
    );
}
