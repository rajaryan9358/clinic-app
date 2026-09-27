import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import DateStrip from '../components/DateStrip';
import SlotGrid from '../components/SlotGrid';
import useDoctorSlots from '../hooks/useDoctorSlots';
import { addDays, isoDate } from '../lib/format';
import { Button, Card, ErrorText, Spinner } from '../components/ui';

const STRIP_DAYS = 14;

const VISIT_TYPES = [
    { value: 'new', label: 'New visit' },
    { value: 'followup', label: 'Follow-up' },
];

const MODE_LABELS = {
    in_person: 'In person',
    video: 'Video call',
    phone: 'Phone call',
};

/**
 * `/book`: doctor -> date -> slot (DateStrip/SlotGrid/useDoctorSlots —
 * shared with Reschedule.jsx) -> visit type/mode -> reason -> submit.
 * Honours `?doctor_id=&visit_type=` presets (from "Book follow-up" links
 * on VisitDetail/PrescriptionDetail) by preselecting them; the rest of the
 * flow still has to be completed by the patient since neither a date nor a
 * slot can be assumed.
 */
export default function Book() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const presetDoctorId = searchParams.get('doctor_id');
    const presetVisitType = searchParams.get('visit_type');

    const [doctors, setDoctors] = useState([]);
    const [doctorsLoading, setDoctorsLoading] = useState(true);
    const [doctorsError, setDoctorsError] = useState('');

    const [doctorId, setDoctorId] = useState(presetDoctorId ? Number(presetDoctorId) : null);

    const dates = useMemo(() => {
        const today = new Date();
        return Array.from({ length: STRIP_DAYS }, (_, i) => isoDate(addDays(today, i)));
    }, []);

    const {
        date,
        slots,
        loading: slotsLoading,
        error: slotsError,
        selectedSlot: slot,
        setSelectedSlot: setSlot,
        load: loadSlots,
        reset: resetSlots,
    } = useDoctorSlots();

    const [visitType, setVisitType] = useState(presetVisitType === 'followup' ? 'followup' : 'new');
    const [mode, setMode] = useState(null);
    const [reason, setReason] = useState('');

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');

    useEffect(() => {
        let active = true;
        api.get('/doctors')
            .then(({ data }) => {
                if (active) setDoctors(data.data || []);
            })
            .catch((err) => {
                if (active) setDoctorsError(err?.response?.data?.message || 'Could not load doctors.');
            })
            .finally(() => {
                if (active) setDoctorsLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const doctor = doctors.find((d) => d.id === doctorId) || null;
    const modeOptions = doctor?.consultation_modes?.length ? doctor.consultation_modes : ['in_person'];

    useEffect(() => {
        if (doctor && !modeOptions.includes(mode)) {
            setMode(modeOptions[0]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [doctorId, doctors]);

    function selectDoctor(d) {
        setDoctorId(d.id);
        // A previously selected date/slot belonged to the old doctor's
        // availability — drop it (and invalidate any request still in
        // flight for it) rather than letting stale slots survive the
        // doctor switch.
        resetSlots();
    }

    async function submit() {
        if (!doctorId || !date || !slot) return;
        setSubmitting(true);
        setSubmitError('');
        try {
            const { data } = await api.post('/appointments', {
                doctor_id: doctorId,
                appointment_date: date,
                start_time: slot.start_time,
                visit_type: visitType,
                consultation_mode: mode,
                reason: reason.trim() || undefined,
            });
            navigate(`/visits/${data.data.id}`, { state: { message: 'Request sent — the clinic will confirm.' } });
        } catch (err) {
            setSubmitError(err?.response?.data?.message || 'Could not book this visit.');
            if (err?.response?.status === 409) {
                loadSlots(doctorId, date);
            }
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="space-y-4">
            <h1 className="text-xl font-semibold text-slate-900">Book a visit</h1>

            <div>
                <h2 className="mb-2 text-sm font-medium text-slate-500">Doctor</h2>
                {doctorsLoading && (
                    <div className="flex justify-center py-6">
                        <Spinner className="h-5 w-5 text-[var(--accent)]" />
                    </div>
                )}
                {!doctorsLoading && doctorsError && <ErrorText>{doctorsError}</ErrorText>}
                {!doctorsLoading && !doctorsError && doctors.length === 0 && (
                    <Card className="py-6 text-center text-sm text-slate-500">No doctors available.</Card>
                )}
                {!doctorsLoading && !doctorsError && doctors.length > 0 && (
                    <div className="space-y-2">
                        {doctors.map((d) => (
                            <button key={d.id} type="button" onClick={() => selectDoctor(d)} className="block w-full text-left">
                                <Card className={doctorId === d.id ? 'ring-2 ring-[var(--accent)]' : ''}>
                                    <p className="text-sm font-medium text-slate-900">{d.full_name}</p>
                                    {d.specialization && <p className="text-xs text-slate-500">{d.specialization}</p>}
                                </Card>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {doctorId && (
                <div>
                    <h2 className="mb-2 text-sm font-medium text-slate-500">Date</h2>
                    <DateStrip dates={dates} selectedDate={date} onSelect={(d) => loadSlots(doctorId, d)} />
                </div>
            )}

            {doctorId && date && (
                <div>
                    <h2 className="mb-2 text-sm font-medium text-slate-500">Time</h2>
                    <SlotGrid loading={slotsLoading} error={slotsError} slots={slots} selectedSlot={slot} onSelect={setSlot} />
                </div>
            )}

            {doctorId && date && slot && (
                <>
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
                    <Button onClick={submit} loading={submitting}>
                        Request this visit
                    </Button>
                </>
            )}
        </div>
    );
}
