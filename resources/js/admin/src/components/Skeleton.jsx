import { useEffect, useState } from 'react';

// Page-level loading placeholders. They echo the shape of the content that is
// about to appear (table rows, label/value fields) so the page does not jump.
//
// Appearance is delayed by `delay` ms so a fast response never flashes a
// skeleton. During the delay the screen is not silent: the status region is
// mounted immediately with screen-reader text, and the delay is short enough
// (150ms by default) that sighted users see the skeleton before it feels blank.

function useDelayedVisible(delay) {
    const [visible, setVisible] = useState(delay <= 0);
    useEffect(() => {
        if (delay <= 0) return undefined;
        const t = setTimeout(() => setVisible(true), delay);
        return () => clearTimeout(t);
    }, [delay]);
    return visible;
}

const bar = 'animate-pulse rounded bg-slate-200';
const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-1/3'];

function TableBody({ rows, cols }) {
    return (
        <div className="divide-y divide-slate-100">
            {Array.from({ length: rows }).map((_, r) => (
                <div key={r} className="flex items-center gap-4 px-4 py-3.5">
                    {Array.from({ length: cols }).map((__, c) => (
                        <div key={c} className="flex-1">
                            <div className={`h-3.5 ${bar} ${widths[(r + c) % widths.length]}`} />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

function FieldsBody({ rows, cols }) {
    return (
        <dl className={`grid gap-x-6 gap-y-5 ${cols > 1 ? 'sm:grid-cols-2' : ''}`}>
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i}>
                    <div className={`h-3 w-24 ${bar}`} />
                    <div className={`mt-2 h-4 ${bar} ${widths[i % widths.length]}`} />
                </div>
            ))}
        </dl>
    );
}

/**
 * variant="table"  -> header bar + `rows` rows of `cols` cells, in a card
 * variant="fields" -> `rows` label/value pairs in a card (2 columns by default)
 * card={false} drops the surrounding card (use inside an existing one).
 */
export default function Skeleton({ variant = 'table', rows, cols, delay = 150, card = true, className = '' }) {
    const visible = useDelayedVisible(delay);
    const r = rows ?? (variant === 'table' ? 6 : 6);
    const c = cols ?? (variant === 'table' ? 5 : 2);

    const body = variant === 'fields' ? <FieldsBody rows={r} cols={c} /> : (
        <>
            <div className="flex gap-4 border-b border-slate-100 bg-slate-50 px-4 py-3">
                {Array.from({ length: c }).map((_, i) => (
                    <div key={i} className="flex-1"><div className={`h-3 w-1/2 ${bar}`} /></div>
                ))}
            </div>
            <TableBody rows={r} cols={c} />
        </>
    );

    const wrapper = card
        ? `overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${variant === 'fields' ? 'p-5' : ''}`
        : '';

    return (
        <div role="status" aria-busy="true" className={`${wrapper} ${className}`}>
            <span className="sr-only">Loading…</span>
            {visible ? <div aria-hidden="true">{body}</div> : null}
        </div>
    );
}

// For use inside an existing <tbody>: table rows of pulsing cells.
export function SkeletonTableRows({ rows = 5, cols = 5, delay = 150 }) {
    const visible = useDelayedVisible(delay);
    if (!visible) return null;
    return Array.from({ length: rows }).map((_, r) => (
        <tr key={r} aria-hidden="true">
            {Array.from({ length: cols }).map((__, c) => (
                <td key={c} className="px-4 py-3.5">
                    <div className={`h-3.5 ${bar} ${widths[(r + c) % widths.length]}`} />
                </td>
            ))}
        </tr>
    ));
}
