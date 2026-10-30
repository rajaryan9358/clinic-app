import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import DateStrip from '../components/DateStrip';
import JoinWaitlist from '../components/JoinWaitlist';
import SlotGrid from '../components/SlotGrid';
import useDoctorSlots from '../hooks/useDoctorSlots';
import { addDays, isoDate } from '../lib/format';
import { Button, Card, ErrorText, Loading, PageHeader, SectionLabel } from '../components/ui';

const STRIP_DAYS = 14;

/**
 * `/visits/:id/reschedule`: a 14-day date strip, the selected date's free
 * slots (DateStrip/SlotGrid/useDoctorSlots — shared with Book.jsx), and
 * submit. The strip always offers 14 candidate dates client-side — the
 * clinic's real `max_advance_booking_days` window is enforced by the slots
 * endpoint (a 422 "outside the booking window" for a date beyond it), so a
 * shorter window just means the later chips come back empty/blocked rather
 * than being hidden ahead of time. Taken times can be waitlisted from the
 * grid, and a 409 (the chosen time was just taken) offers "Join waitlist
 * for this time" for that slot.
 */
export default function Reschedule() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [appointment, setAppointment] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');

    const dates = useMemo(() => {
        const today = new Date();
        return Array.from({ length: STRIP_DAYS }, (_, i) => isoDate(addDays(today, i)));
    }, []);

    const {
        date,
        slots,
        taken,
        loading: slotsLoading,
        error: slotsError,
        selectedSlot,
        setSelectedSlot,
        load: loadSlots,
        joinWaitlist,
    } = useDoctorSlots();

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    // The slot the last attempt lost with a 409, for the "Join waitlist for
    // this time" fallback; only shown while that date is still selected.
    const [conflict, setConflict] = useState(null);
    const [conflictJoinOpen, setConflictJoinOpen] = useState(false);

    useEffect(() => {
        let active = true;
        api.get(`/appointments/${id}`)
            .then(({ data }) => {
                if (active) setAppointment(data.data);
            })
            .catch((err) => {
                if (active) setLoadError(err?.response?.data?.message || 'Could not load this visit.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [id]);

    useEffect(() => {
        if (appointment?.doctor?.id && dates.length) {
            loadSlots(appointment.doctor.id, dates[0]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appointment?.doctor?.id]);

    async function submit() {
        if (submitting || !date || !selectedSlot) return;
        setSubmitting(true);
        setSubmitError('');
        setConflict(null);
        try {
            await api.post(`/appointments/${id}/reschedule`, {
                appointment_date: date,
                start_time: selectedSlot.start_time,
            });
            navigate(`/visits/${id}`, { state: { message: 'Appointment rescheduled — the clinic will confirm.' } });
        } catch (err) {
            setSubmitError(err?.response?.data?.message || 'Could not reschedule this visit.');
            if (err?.response?.status === 409) {
                setConflict({ date, slot: selectedSlot });
                setConflictJoinOpen(false);
                loadSlots(appointment.doctor.id, date);
            }
        } finally {
            setSubmitting(false);
        }
    }

    if (loading) {
        return <Loading />;
    }

    if (loadError || !appointment) {
        return <ErrorText>{loadError || 'Visit not found.'}</ErrorText>;
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Reschedule visit"
                subtitle={`${appointment.doctor?.name || ''}${appointment.doctor?.specialization ? ` · ${appointment.doctor.specialization}` : ''}`}
                back={{ label: 'Back', onClick: () => navigate(`/visits/${id}`) }}
            />

            <section>
                <SectionLabel>New date</SectionLabel>
                <DateStrip
                    dates={dates}
                    selectedDate={date}
                    onSelect={(d) => {
                        loadSlots(appointment.doctor.id, d);
                        setConflict(null);
                        setSubmitError('');
                    }}
                />
            </section>

            <section>
                <SectionLabel>New time</SectionLabel>
                <SlotGrid
                    key={date || ''}
                    loading={slotsLoading}
                    error={slotsError}
                    slots={slots}
                    taken={taken}
                    date={date}
                    selectedSlot={selectedSlot}
                    onSelect={(s) => {
                        setSelectedSlot(s);
                        setConflict(null);
                        setSubmitError('');
                    }}
                    onJoin={joinWaitlist}
                />
            </section>

            {submitError ? <ErrorText>{submitError}</ErrorText> : null}
            {conflict && conflict.date === date && !selectedSlot && (
                <Card>
                    {conflictJoinOpen ? (
                        <JoinWaitlist
                            date={conflict.date}
                            slot={conflict.slot}
                            onJoin={joinWaitlist}
                            onClose={() => setConflict(null)}
                        />
                    ) : (
                        <Button variant="secondary" onClick={() => setConflictJoinOpen(true)}>
                            Join waitlist for this time
                        </Button>
                    )}
                </Card>
            )}
            <Button onClick={submit} disabled={!selectedSlot} loading={submitting}>
                Confirm new time
            </Button>
        </div>
    );
}
