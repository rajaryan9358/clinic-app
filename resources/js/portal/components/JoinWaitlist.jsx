import React, { useEffect, useRef, useState } from 'react';
import { formatDate, formatTime } from '../lib/format';
import { Button, ErrorText } from './ui';

/**
 * Inline "join the waitlist for this taken time?" confirm, shared by the
 * slot grid (tapping a greyed-out taken time) and the Book/Reschedule 409
 * fallback ("Join waitlist for this time"). `onJoin(slot)` performs the
 * `POST waitlist` and resolves/rejects with the Axios result; this
 * component only owns the confirm → submitting → joined/error states.
 * `submitting` doubles as the double-submit guard (the button is disabled
 * while it's set, and the handler also bails out on it).
 */
export default function JoinWaitlist({ date, slot, onJoin, onClose }) {
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [joined, setJoined] = useState(false);
    const mounted = useRef(true);

    useEffect(
        () => () => {
            mounted.current = false;
        },
        [],
    );

    async function join() {
        if (submitting) return;
        setSubmitting(true);
        setError('');
        try {
            await onJoin(slot);
            if (mounted.current) setJoined(true);
        } catch (err) {
            if (mounted.current) setError(err?.response?.data?.message || 'Could not join the waitlist.');
        } finally {
            if (mounted.current) setSubmitting(false);
        }
    }

    if (joined) {
        return (
            <div className="space-y-2">
                <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    You're on the waitlist for {formatDate(date)} &middot; {formatTime(slot.start_time)}. We'll message you on
                    WhatsApp if it frees up.
                </div>
                <Button variant="ghost" onClick={onClose}>
                    Done
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <p className="text-sm text-slate-700">
                {formatDate(date)} &middot; {formatTime(slot.start_time)} is taken. Join the waitlist? If it frees up we'll hold
                it for you and message you on WhatsApp.
            </p>
            <ErrorText>{error}</ErrorText>
            <Button onClick={join} loading={submitting}>
                Join waitlist
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
                Not now
            </Button>
        </div>
    );
}
