import React from 'react';
import { formatDateStrip } from '../lib/format';

/**
 * The horizontally-scrolling day picker shared by Book.jsx and
 * Reschedule.jsx. Purely presentational: `dates` is the candidate list
 * (client-generated, see lib/format.js), the caller owns which one is
 * selected and what happens on a pick (usually loading that date's slots).
 */
export default function DateStrip({ dates, selectedDate, onSelect }) {
    return (
        <div className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {dates.map((date) => {
                const parts = formatDateStrip(date);
                const active = date === selectedDate;
                return (
                    <button
                        key={date}
                        type="button"
                        onClick={() => onSelect(date)}
                        aria-pressed={active}
                        className={`flex min-h-[64px] min-w-[3.75rem] shrink-0 snap-start flex-col items-center justify-center rounded-xl border px-2 py-2 text-xs font-medium transition ${
                            active
                                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                    >
                        <span>{parts.weekday}</span>
                        <span className={`text-lg font-bold tabular-nums ${active ? 'text-white' : 'text-slate-900'}`}>{parts.day}</span>
                    </button>
                );
            })}
        </div>
    );
}
