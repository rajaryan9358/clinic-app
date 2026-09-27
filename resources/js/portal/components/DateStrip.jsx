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
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {dates.map((date) => {
                const parts = formatDateStrip(date);
                const active = date === selectedDate;
                return (
                    <button
                        key={date}
                        type="button"
                        onClick={() => onSelect(date)}
                        className={`flex min-w-[3.5rem] flex-col items-center rounded-xl px-2 py-2 text-xs font-medium ${
                            active ? 'bg-[var(--accent)] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-100'
                        }`}
                    >
                        <span>{parts.weekday}</span>
                        <span className="text-base">{parts.day}</span>
                    </button>
                );
            })}
        </div>
    );
}
