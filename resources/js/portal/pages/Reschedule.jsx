import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { addDays, formatDateStrip, formatTime, isoDate } from '../lib/format';
import { Button, Card, ErrorText, Spinner } from '../components/ui';

const STRIP_DAYS = 14;

/**
 * `/visits/:id/reschedule`: a 14-day date strip, the selected date's free
 * slots, and submit. The strip always offers 14 candidate dates client-side
 * — the clinic's real `max_advance_booking_days` window is enforced by the
 * slots endpoint (a 422 "outside the booking window" for a date beyond it),
 * so a shorter window just means the later chips come back empty/blocked
 * rather than being hidden ahead of time.
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

    const [selectedDate, setSelectedDate] = useState(null);
    const [slots, setSlots] = useState([]);
    const [slotsLoading, setSlotsLoading] = useState(false);
    const [slotsError, setSlotsError] = useState('');
    const [selectedSlot, setSelectedSlot] = useState(null);

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');

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

    function loadSlots(date, doctorId) {
        setSelectedDate(date);
        setSelectedSlot(null);
        setSlots([]);
        setSlotsError('');
        setSlotsLoading(true);
        api.get(`/doctors/${doctorId}/slots`, { params: { date } })
            .then(({ data }) => setSlots(data.data?.slots || []))
            .catch((err) => setSlotsError(err?.response?.data?.message || 'Could not load available times.'))
            .finally(() => setSlotsLoading(false));
    }

    useEffect(() => {
        if (appointment?.doctor?.id && dates.length) {
            loadSlots(dates[0], appointment.doctor.id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appointment?.doctor?.id]);

    async function submit() {
        if (!selectedDate || !selectedSlot) return;
        setSubmitting(true);
        setSubmitError('');
        try {
            await api.post(`/appointments/${id}/reschedule`, {
                appointment_date: selectedDate,
                start_time: selectedSlot.start_time,
            });
            navigate(`/visits/${id}`, { state: { message: 'Appointment rescheduled — the clinic will confirm.' } });
        } catch (err) {
            setSubmitError(err?.response?.data?.message || 'Could not reschedule this visit.');
            if (err?.response?.status === 409) {
                loadSlots(selectedDate, appointment.doctor.id);
            }
        } finally {
            setSubmitting(false);
        }
    }

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Spinner className="h-6 w-6 text-[var(--accent)]" />
            </div>
        );
    }

    if (loadError || !appointment) {
        return <ErrorText>{loadError || 'Visit not found.'}</ErrorText>;
    }

    return (
        <div className="space-y-4">
            <button
                type="button"
                onClick={() => navigate(`/visits/${id}`)}
                className="text-sm font-medium text-[var(--accent)]"
            >
                &larr; Back
            </button>

            <div>
                <h1 className="text-xl font-semibold text-slate-900">Reschedule visit</h1>
                <p className="text-sm text-slate-600">
                    {appointment.doctor?.name}
                    {appointment.doctor?.specialization ? ` · ${appointment.doctor.specialization}` : ''}
                </p>
            </div>

            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {dates.map((date) => {
                    const parts = formatDateStrip(date);
                    const active = date === selectedDate;
                    return (
                        <button
                            key={date}
                            type="button"
                            onClick={() => loadSlots(date, appointment.doctor.id)}
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

            <Card>
                {slotsLoading && (
                    <div className="flex justify-center py-6">
                        <Spinner className="h-5 w-5 text-[var(--accent)]" />
                    </div>
                )}
                {!slotsLoading && slotsError && <ErrorText>{slotsError}</ErrorText>}
                {!slotsLoading && !slotsError && slots.length === 0 && (
                    <p className="py-4 text-center text-sm text-slate-500">No times available on this date.</p>
                )}
                {!slotsLoading && !slotsError && slots.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                        {slots.map((slot) => (
                            <button
                                key={slot.start_time}
                                type="button"
                                onClick={() => setSelectedSlot(slot)}
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

            {submitError ? <ErrorText>{submitError}</ErrorText> : null}
            <Button onClick={submit} disabled={!selectedSlot} loading={submitting}>
                Confirm new time
            </Button>
        </div>
    );
}
