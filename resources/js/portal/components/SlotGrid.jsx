import React from 'react';
import { formatTime } from '../lib/format';
import { Card, ErrorText, Spinner } from './ui';

/**
 * The free-slots grid for a chosen date, shared by Book.jsx and
 * Reschedule.jsx. Purely presentational — loading/error/empty/list states
 * only; `useDoctorSlots` (../hooks/useDoctorSlots) owns fetching them.
 */
export default function SlotGrid({ loading, error, slots, selectedSlot, onSelect }) {
    return (
        <Card>
            {loading && (
                <div className="flex justify-center py-6">
                    <Spinner className="h-5 w-5 text-[var(--accent)]" />
                </div>
            )}
            {!loading && error && <ErrorText>{error}</ErrorText>}
            {!loading && !error && slots.length === 0 && (
                <p className="py-4 text-center text-sm text-slate-500">No times available on this date.</p>
            )}
            {!loading && !error && slots.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                    {slots.map((slot) => (
                        <button
                            key={slot.start_time}
                            type="button"
                            onClick={() => onSelect(slot)}
                            className={`rounded-xl px-2 py-2 text-sm font-medium ${
                                selectedSlot?.start_time === slot.start_time
                                    ? 'bg-[var(--accent)] text-white'
                                    : 'bg-slate-100 text-slate-700'
                            }`}
                        >
                            {formatTime(slot.start_time)}
                        </button>
                    ))}
                </div>
            )}
        </Card>
    );
}
