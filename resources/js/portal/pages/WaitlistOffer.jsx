import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { useSession } from '../session';
import { MODE_LABELS, VISIT_TYPES, modeOptionsFor } from '../lib/booking';
import { formatCountdown, formatDate, formatInstantTime, formatTime } from '../lib/format';
import { Button, Card, ErrorText, Spinner } from '../components/ui';


const OFFER_EXPIRED = 'This offer has expired.';
/**
 * `/waitlist/:id` — where the WhatsApp "Book it" link lands (via the
 * magic-link redirect). `GET waitlist/{id}` returns the entry in any
 * status, so besides the live offer (slot details, countdown to
 * `hold_expires_at`, visit type + mode + reason, Book / Decline) this
 * page explains every other outcome: expired (including the countdown
 * reaching zero while open, or staff booking over the hold), already
 * booked (link to the visit), declined, removed, or still waiting.
 *
 * Fetches are guarded with a request id so a slower response for an
 * earlier id/profile (or a refetch after a failed book) never overwrites
 * newer state; `submitting` blocks double Book/Decline submits.
 */
export default function WaitlistOffer() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { activeProfileId } = useSession();

    const [entry, setEntry] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const requestRef = useRef(0);

    const [now, setNow] = useState(() => Date.now());

    const [visitType, setVisitType] = useState('new');
    const [mode, setMode] = useState(null);
    const [reason, setReason] = useState('');

    const [submitting, setSubmitting] = useState(null); // 'book' | 'decline' | null
    const [submitError, setSubmitError] = useState('');
    const [confirmDecline, setConfirmDecline] = useState(false);
    // The server said the offer expired even though this device's clock
    // still shows time left (clock skew): trust the server for that entry.
    const [serverExpiredId, setServerExpiredId] = useState(null);

    const fetchEntry = useCallback(
        ({ quiet = false } = {}) => {
            const requestId = ++requestRef.current;
            if (!quiet) {
                setLoading(true);
                setLoadError('');
            }
            return api
                .get(`/waitlist/${id}`)
                .then(({ data }) => {
                    if (requestRef.current === requestId) setEntry(data.data);
                })
                .catch((err) => {
                    if (requestRef.current !== requestId || quiet) return;
                    setEntry(null);
                    setLoadError(
                        err?.response?.status === 404
                            ? 'We couldn’t find this waitlist offer for the selected profile.'
                            : err?.response?.data?.message || 'Could not load this offer.',
                    );
                })
                .finally(() => {
                    if (requestRef.current === requestId && !quiet) setLoading(false);
                });
        },
        [id],
    );

    useEffect(() => {
        fetchEntry();
        return () => {
            requestRef.current += 1;
        };
    }, [fetchEntry, activeProfileId]);

    const holdEndsAt = entry?.hold_expires_at ? Date.parse(entry.hold_expires_at) : null;
    const isLiveOffer = entry?.status === 'offered' && holdEndsAt !== null && holdEndsAt > now && serverExpiredId !== entry?.id;

    // Tick once a second only while an offer is live; the interval is torn
    // down as soon as the countdown reaches zero (isLiveOffer flips false),
    // which also switches the page to the expired state.
    useEffect(() => {
        if (!isLiveOffer) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [isLiveOffer]);

    // A freshly loaded entry is judged against the current clock, not the
    // one from whenever the page was first rendered.
    useEffect(() => {
        setNow(Date.now());
    }, [entry]);

    const modeOptions = modeOptionsFor(entry?.doctor);
    useEffect(() => {
        if (entry && !modeOptions.includes(mode)) setMode(modeOptions[0]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entry?.id, entry?.doctor?.consultation_modes?.join(',')]);

    async function book() {
        if (submitting || !isLiveOffer) return;
        setSubmitting('book');
        setSubmitError('');
        try {
            const { data } = await api.post(`/waitlist/${id}/book`, {
                visit_type: visitType,
                consultation_mode: mode,
                reason: reason.trim() || undefined,
            });
            navigate(`/visits/${data.data.id}`, { state: { message: 'Request sent — the clinic will confirm.' } });
        } catch (err) {
            setSubmitError(err?.response?.data?.message || 'Could not book this time.');
            if (err?.response?.data?.message === OFFER_EXPIRED) setServerExpiredId(entry?.id);
            // 422 expired / 409 slot taken: the entry has moved on (or will
            // be shown as expired) — refresh it so the page reflects that.
            if ([409, 422].includes(err?.response?.status)) fetchEntry({ quiet: true });
        } finally {
            setSubmitting(null);
        }
    }

    async function decline() {
        if (submitting || !isLiveOffer) return;
        setSubmitting('decline');
        setSubmitError('');
        try {
            const { data } = await api.post(`/waitlist/${id}/decline`);
            setEntry((prev) => ({ ...prev, ...data.data }));
            setConfirmDecline(false);
        } catch (err) {
            setSubmitError(err?.response?.data?.message || 'Could not decline this offer.');
            if (err?.response?.data?.message === OFFER_EXPIRED) setServerExpiredId(entry?.id);
            if (err?.response?.status === 422) fetchEntry({ quiet: true });
        } finally {
            setSubmitting(null);
        }
    }

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Spinner className="h-6 w-6 text-[var(--accent)]" />
            </div>
        );
    }

    if (loadError || !entry) {
        return (
            <div className="space-y-4">
                <ErrorText>{loadError || 'Offer not found.'}</ErrorText>
                <Link to="/visits" className="text-sm font-medium text-[var(--accent)]">
                    Go to your visits
                </Link>
            </div>
        );
    }

    const doctorLine = `${entry.doctor?.name || 'Doctor'}${entry.doctor?.specialization ? ` · ${entry.doctor.specialization}` : ''}`;
    const slotLine = `${formatDate(entry.date)} · ${formatTime(entry.start_time)}`;
    const clinic = entry.clinic || {};
    const expired = entry.status === 'expired' || (entry.status === 'offered' && !isLiveOffer);
    const bookAnotherHref = `/book?doctor_id=${entry.doctor?.id ?? ''}`;

    const header = (
        <Card>
            <p className="text-base font-semibold text-slate-900">{slotLine}</p>
            <p className="text-sm text-slate-600">{doctorLine}</p>
            {clinic.name && <p className="mt-1 text-xs text-slate-500">{clinic.name}</p>}
        </Card>
    );

    const callClinic = clinic.phone ? (
        <p className="text-sm text-slate-600">
            Questions? Call {clinic.name || 'the clinic'} on{' '}
            <a href={`tel:${clinic.phone}`} className="font-medium text-[var(--accent)]">
                {clinic.phone}
            </a>
            .
        </p>
    ) : null;

    const outcomeProps = { header, submitError, callClinic };

    if (entry.status === 'booked') {
        return (
            <Outcome
                {...outcomeProps}
                tone="emerald"
                title="You booked this time."
                actions={
                    entry.booked_appointment_id ? (
                        <Button onClick={() => navigate(`/visits/${entry.booked_appointment_id}`)}>View your visit</Button>
                    ) : (
                        <Button variant="secondary" onClick={() => navigate('/visits')}>
                            Go to your visits
                        </Button>
                    )
                }
            />
        );
    }

    if (expired) {
        return (
            <Outcome
                {...outcomeProps}
                tone="amber"
                title="This offer has expired."
                actions={
                    <>
                        <Button onClick={() => navigate(bookAnotherHref)}>Pick another time</Button>
                        <Button variant="secondary" onClick={() => navigate('/visits')}>
                            Go to your visits
                        </Button>
                    </>
                }
            >
                {entry.hold_expires_at
                    ? `The time was held for you until ${formatInstantTime(entry.hold_expires_at)}, but it's no longer available.`
                    : 'This time is no longer available.'}
            </Outcome>
        );
    }

    if (entry.status === 'declined' || entry.status === 'removed') {
        return (
            <Outcome
                {...outcomeProps}
                title={entry.status === 'declined' ? 'You passed on this time.' : 'You left the waitlist for this time.'}
                actions={
                    <>
                        <Button onClick={() => navigate(bookAnotherHref)}>Book another time</Button>
                        <Button variant="secondary" onClick={() => navigate('/visits')}>
                            Go to your visits
                        </Button>
                    </>
                }
            >
                {entry.status === 'declined' ? "We've offered it to the next person in line." : null}
            </Outcome>
        );
    }

    if (entry.status === 'waiting') {
        return (
            <Outcome
                {...outcomeProps}
                title={entry.position ? `You're #${entry.position} in line for this time.` : "You're on the waitlist for this time."}
                actions={
                    <Button variant="secondary" onClick={() => navigate('/visits')}>
                        Go to your visits
                    </Button>
                }
            >
                If it frees up we'll hold it for you and message you on WhatsApp.
            </Outcome>
        );
    }

    // Live offer.
    return (
        <div className="space-y-4">
            <h1 className="text-xl font-semibold text-slate-900">A time opened up</h1>
            {header}

            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200" aria-live="polite">
                <p className="font-medium">
                    Held for you until {formatInstantTime(entry.hold_expires_at)}
                    <span className="ml-1 tabular-nums">({formatCountdown(holdEndsAt - now)} left)</span>
                </p>
                <p className="mt-1">Book it before then, or it goes to the next person in line.</p>
            </div>

            <div>
                <h2 className="mb-2 text-sm font-medium text-slate-500">Visit type</h2>
                <div className="flex gap-2">
                    {VISIT_TYPES.map((vt) => (
                        <button
                            key={vt.value}
                            type="button"
                            onClick={() => setVisitType(vt.value)}
                            className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium ${
                                visitType === vt.value ? 'bg-[var(--accent)] text-white' : 'bg-slate-100 text-slate-700'
                            }`}
                        >
                            {vt.label}
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <h2 className="mb-2 text-sm font-medium text-slate-500">Mode</h2>
                <div className="flex gap-2">
                    {modeOptions.map((m) => (
                        <button
                            key={m}
                            type="button"
                            onClick={() => setMode(m)}
                            className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium ${
                                mode === m ? 'bg-[var(--accent)] text-white' : 'bg-slate-100 text-slate-700'
                            }`}
                        >
                            {MODE_LABELS[m] || m}
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <h2 className="mb-2 text-sm font-medium text-slate-500">Reason (optional)</h2>
                <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder="Tell the clinic why you're booking"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                />
            </div>

            {submitError ? <ErrorText>{submitError}</ErrorText> : null}

            <div className="space-y-2">
                <Button onClick={book} loading={submitting === 'book'} disabled={Boolean(submitting) || !mode}>
                    Book it
                </Button>

                {confirmDecline ? (
                    <Card>
                        <p className="mb-2 text-sm text-slate-600">
                            Pass on this time? It will be offered to the next person and you'll leave the waitlist for it.
                        </p>
                        <div className="space-y-2">
                            <Button
                                variant="danger"
                                onClick={decline}
                                loading={submitting === 'decline'}
                                disabled={Boolean(submitting)}
                            >
                                Yes, decline
                            </Button>
                            <Button variant="secondary" onClick={() => setConfirmDecline(false)} disabled={Boolean(submitting)}>
                                Keep it
                            </Button>
                        </div>
                    </Card>
                ) : (
                    <Button variant="ghost" onClick={() => setConfirmDecline(true)} disabled={Boolean(submitting)}>
                        Decline
                    </Button>
                )}
            </div>

            {callClinic}
        </div>
    );
}

// Shared layout for every non-live state of an entry (booked, expired,
// declined, removed, waiting): slot header, a toned message, actions and
// the clinic's phone.
function Outcome({ tone = 'slate', title, children, actions, header, submitError, callClinic }) {
    const tones = {
        slate: 'bg-slate-50 text-slate-700 ring-slate-200',
        emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
        amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    };
    return (
        <div className="space-y-4">
            <h1 className="text-xl font-semibold text-slate-900">Waitlist</h1>
            {header}
            <div className={`rounded-xl px-4 py-3 text-sm ring-1 ${tones[tone]}`}>
                <p className="font-medium">{title}</p>
                {children ? <p className="mt-1">{children}</p> : null}
            </div>
            {submitError ? <ErrorText>{submitError}</ErrorText> : null}
            <div className="space-y-2">{actions}</div>
            {callClinic}
        </div>
    );
}
