import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api';

/**
 * Loads a doctor's free slots for a chosen date (`GET
 * doctors/{doctorId}/slots?date=`), shared by Book.jsx and Reschedule.jsx.
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
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedSlot, setSelectedSlot] = useState(null);
    const requestRef = useRef(0);

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
        setDate(chosenDate);
        setSelectedSlot(null);
        setSlots([]);
        setError('');
        setLoading(true);

        api.get(`/doctors/${doctorId}/slots`, { params: { date: chosenDate } })
            .then(({ data }) => {
                if (requestRef.current === requestId) setSlots(data.data?.slots || []);
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
        setDate(null);
        setSlots([]);
        setLoading(false);
        setError('');
        setSelectedSlot(null);
    }, []);

    return { date, slots, loading, error, selectedSlot, setSelectedSlot, load, reset };
}
