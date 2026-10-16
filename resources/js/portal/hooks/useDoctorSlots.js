import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api';

/**
 * Loads a doctor's free slots for a chosen date (`GET
 * doctors/{doctorId}/slots?date=`), shared by Book.jsx and Reschedule.jsx.
 * Also exposes that date's `taken` times (booked or held for someone else
 * and not already joined — empty when the clinic's waitlist is off) and
 * `joinWaitlist(slot)` (`POST waitlist` for the loaded doctor/date), which
 * drops the joined time from `taken` on success.
 *
 * Guarded against stale-response races with a monotonically increasing
 * request id: if the doctor/date selection changes again (or the
 * component unmounts) before an in-flight request resolves, that
 * response's `.then`/`.catch`/`.finally` all no-op instead of overwriting
 * newer state with older data — e.g. clicking date A then quickly date B
 * must not have A's slower response land last and silently replace B's
 * slots.
 */
export default function useDoctorSlots() {
    const [date, setDate] = useState(null);
    const [slots, setSlots] = useState([]);
    const [taken, setTaken] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedSlot, setSelectedSlot] = useState(null);
    const requestRef = useRef(0);
    // The doctor/date the current `slots`/`taken` belong to, read by
    // joinWaitlist so a join always targets what's on screen.
    const loadedRef = useRef({ doctorId: null, date: null });

    useEffect(
        () => () => {
            // Unmounting invalidates any in-flight request the same way a
            // newer selection would.
            requestRef.current += 1;
        },
        [],
    );

    const load = useCallback((doctorId, chosenDate) => {
        const requestId = ++requestRef.current;
        loadedRef.current = { doctorId, date: chosenDate };
        setDate(chosenDate);
        setSelectedSlot(null);
        setSlots([]);
        setTaken([]);
        setError('');
        setLoading(true);

        api.get(`/doctors/${doctorId}/slots`, { params: { date: chosenDate } })
            .then(({ data }) => {
                if (requestRef.current === requestId) {
                    setSlots(data.data?.slots || []);
                    setTaken(data.data?.taken || []);
                }
            })
            .catch((err) => {
                if (requestRef.current === requestId) {
                    setError(err?.response?.data?.message || 'Could not load available times.');
                }
            })
            .finally(() => {
                if (requestRef.current === requestId) setLoading(false);
            });
    }, []);

    // Clears the current date/slot selection (e.g. the doctor changed)
    // without issuing a request, and invalidates any request in flight so
    // it can't land afterwards.
    const reset = useCallback(() => {
        requestRef.current += 1;
        loadedRef.current = { doctorId: null, date: null };
        setDate(null);
        setSlots([]);
        setTaken([]);
        setLoading(false);
        setError('');
        setSelectedSlot(null);
    }, []);

    // Rejects with the Axios error (409 already joined, 422 limit/slot
    // free/unavailable) for the caller to show. The `taken` update is
    // skipped if the doctor/date moved on while the request was in flight.
    const joinWaitlist = useCallback(async (slot) => {
        const { doctorId, date: slotDate } = loadedRef.current;
        if (!doctorId || !slotDate) throw new Error('No date selected.');
        const requestId = requestRef.current;
        const response = await api.post('/waitlist', {
            doctor_id: doctorId,
            appointment_date: slotDate,
            start_time: slot.start_time,
        });
        if (requestRef.current === requestId) {
            setTaken((prev) => prev.filter((t) => t.start_time !== slot.start_time));
        }
        return response;
    }, []);

    return { date, slots, taken, loading, error, selectedSlot, setSelectedSlot, load, reset, joinWaitlist };
}
