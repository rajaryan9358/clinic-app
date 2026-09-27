import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import DateStrip from '../components/DateStrip';
import SlotGrid from '../components/SlotGrid';
import useDoctorSlots from '../hooks/useDoctorSlots';
import { addDays, isoDate } from '../lib/format';
import { Button, ErrorText, Spinner } from '../components/ui';

const STRIP_DAYS = 14;

/**
 * `/visits/:id/reschedule`: a 14-day date strip, the selected date's free
 * slots (DateStrip/SlotGrid/useDoctorSlots — shared with Book.jsx), and
 * submit. The strip always offers 14 candidate dates client-side — the
 * clinic's real `max_advance_booking_days` window is enforced by the slots
 * endpoint (a 422 "outside the booking window" for a date beyond it), so a
 * shorter window just means the later chips come back empty/blocked rather
 * than being hidden ahead of time.
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

    const { date, slots, loading: slotsLoading, error: slotsError, selectedSlot, setSelectedSlot, load: loadSlots } = useDoctorSlots();

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

    useEffect(() => {
        if (appointment?.doctor?.id && dates.length) {
            loadSlots(appointment.doctor.id, dates[0]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appointment?.doctor?.id]);

    async function submit() {
        if (!date || !selectedSlot) return;
        setSubmitting(true);
        setSubmitError('');
        try {
            await api.post(`/appointments/${id}/reschedule`, {
                appointment_date: date,
                start_time: selectedSlot.start_time,
            });
            navigate(`/visits/${id}`, { state: { message: 'Appointment rescheduled — the clinic will confirm.' } });
        } catch (err) {
            setSubmitError(err?.response?.data?.message || 'Could not reschedule this visit.');
            if (err?.response?.status === 409) {
                loadSlots(appointment.doctor.id, date);
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

            <DateStrip dates={dates} selectedDate={date} onSelect={(d) => loadSlots(appointment.doctor.id, d)} />

            <SlotGrid
                loading={slotsLoading}
                error={slotsError}
                slots={slots}
                selectedSlot={selectedSlot}
                onSelect={setSelectedSlot}
            />

            {submitError ? <ErrorText>{submitError}</ErrorText> : null}
            <Button onClick={submit} disabled={!selectedSlot} loading={submitting}>
                Confirm new time
            </Button>
        </div>
    );
}
