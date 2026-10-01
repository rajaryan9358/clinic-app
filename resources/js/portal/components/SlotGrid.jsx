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
                <div className="flex justify-center py-6">
                    <Spinner className="h-5 w-5 text-[var(--accent)]" />
                </div>
            )}
            {!loading && error && <ErrorText>{error}</ErrorText>}
            {!loading && !error && items.length === 0 && !joinSlot && (
                <p className="py-4 text-center text-sm text-slate-500">No times available on this date.</p>
            )}
            {!loading && !error && items.length > 0 && (
                <>
                    {slots.length === 0 && (
                        <p className="mb-3 text-sm text-slate-500">
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
                                    className={`flex flex-col items-center rounded-xl px-2 py-1.5 text-sm ${
                                        joinSlot?.start_time === slot.start_time
                                            ? 'bg-slate-200 text-slate-700 ring-2 ring-slate-300'
                                            : 'bg-slate-50 text-slate-400 ring-1 ring-slate-200'
                                    }`}
                                >
                                    <span className="font-medium line-through">{formatTime(slot.start_time)}</span>
                                    <span className="text-[11px] font-medium text-[var(--accent)]">Join waitlist</span>
                                </button>
                            ) : (
                                <button
                                    key={slot.start_time}
                                    type="button"
                                    onClick={() => {
                                        setJoinSlot(null);
                                        onSelect(slot);
                                    }}
                                    className={`rounded-xl px-2 py-2 text-sm font-medium ${
                                        selectedSlot?.start_time === slot.start_time
                                            ? 'bg-[var(--accent)] text-white'
                                            : 'bg-slate-100 text-slate-700'
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
                <div className="mt-3">
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
