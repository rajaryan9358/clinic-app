import React, { useState } from 'react';
import { formatTime } from '../lib/format';
import JoinWaitlist from './JoinWaitlist';
import { Card, ErrorText, Spinner } from './ui';

/**
 * The slots grid for a chosen date, shared by Book.jsx and Reschedule.jsx.
 * `useDoctorSlots` (../hooks/useDoctorSlots) owns fetching them; this
 * renders loading/error/empty/list states. Free `slots` are selectable;
 * when `onJoin` is given, `taken` times (booked, or held for someone
 * else) are merged in greyed out with "Join waitlist", and tapping one
 * opens an inline confirm (JoinWaitlist) that calls `onJoin(slot)`.
 * Callers key this by doctor+date so a pending confirm never survives a
 * change of date/doctor.
 */
export default function SlotGrid({ loading, error, slots, taken = [], date, selectedSlot, onSelect, onJoin }) {
    const [joinSlot, setJoinSlot] = useState(null);
    const showTaken = Boolean(onJoin);
    const items = [
        ...slots.map((slot) => ({ slot, taken: false })),
        ...(showTaken ? taken.map((slot) => ({ slot, taken: true })) : []),
    ].sort((a, b) => a.slot.start_time.localeCompare(b.slot.start_time));

    return (
        <Card>
            {loading && (
                <div className="flex justify-center py-8">
                    <Spinner className="h-6 w-6 text-[var(--accent)]" />
                </div>
            )}
            {!loading && error && <ErrorText>{error}</ErrorText>}
            {!loading && !error && items.length === 0 && !joinSlot && (
                <p className="py-6 text-center text-sm text-slate-600">No times available on this date. Try another day.</p>
            )}
            {!loading && !error && items.length > 0 && (
                <>
                    {slots.length === 0 && (
                        <p className="mb-3 text-sm text-slate-600">
                            Every time is taken on this date — you can join the waitlist for one.
                        </p>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                        {items.map(({ slot, taken: isTaken }) =>
                            isTaken ? (
                                <button
                                    key={`taken-${slot.start_time}`}
                                    type="button"
                                    onClick={() => setJoinSlot(slot)}
                                    aria-label={`${formatTime(slot.start_time)} taken — join waitlist`}
                                    className={`flex min-h-[52px] flex-col items-center justify-center rounded-xl border border-dashed px-2 py-1.5 text-sm ${
                                        joinSlot?.start_time === slot.start_time
                                            ? 'border-slate-400 bg-slate-100 text-slate-700'
                                            : 'border-slate-300 bg-slate-50 text-slate-500 hover:bg-slate-100'
                                    }`}
                                >
                                    <span className="font-medium tabular-nums line-through">{formatTime(slot.start_time)}</span>
                                    <span className="text-[11px] font-semibold text-[var(--accent)]">Join waitlist</span>
                                </button>
                            ) : (
                                <button
                                    key={slot.start_time}
                                    type="button"
                                    onClick={() => {
                                        setJoinSlot(null);
                                        onSelect(slot);
                                    }}
                                    aria-pressed={selectedSlot?.start_time === slot.start_time}
                                    className={`min-h-[52px] rounded-xl border px-2 py-2 text-sm font-semibold tabular-nums transition ${
                                        selectedSlot?.start_time === slot.start_time
                                            ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                                            : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                                    }`}
                                >
                                    {formatTime(slot.start_time)}
                                </button>
                            ),
                        )}
                    </div>
                </>
            )}
            {!loading && !error && joinSlot && (
                <div className="mt-4">
                    <JoinWaitlist
                        key={joinSlot.start_time}
                        date={date}
                        slot={joinSlot}
                        onJoin={onJoin}
                        onClose={() => setJoinSlot(null)}
                    />
                </div>
            )}
        </Card>
    );
}
