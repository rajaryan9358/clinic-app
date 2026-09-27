import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import { addDays, formatDateStrip, formatTime, isoDate } from '../lib/format';
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
 * `/book`: doctor -> date -> slot -> visit type/mode -> reason -> submit.
 * Honours `?doctor_id=&visit_type=` presets (from "Book follow-up" links on
 * VisitDetail/PrescriptionDetail) by preselecting them; the rest of the flow
 * still has to be completed by the patient since neither a date nor a slot
 * can be assumed.
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
    const [date, setDate] = useState(null);

    const [slots, setSlots] = useState([]);
    const [slotsLoading, setSlotsLoading] = useState(false);
    const [slotsError, setSlotsError] = useState('');
    const [slot, setSlot] = useState(null);

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
        setDate(null);
        setSlots([]);
        setSlot(null);
        setSlotsError('');
    }

    function loadSlots(chosenDate, dId) {
        setDate(chosenDate);
        setSlot(null);
        setSlots([]);
        setSlotsError('');
        setSlotsLoading(true);
        api.get(`/doctors/${dId}/slots`, { params: { date: chosenDate } })
            .then(({ data }) => setSlots(data.data?.slots || []))
            .catch((err) => setSlotsError(err?.response?.data?.message || 'Could not load available times.'))
            .finally(() => setSlotsLoading(false));
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
                loadSlots(date, doctorId);
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
                    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                        {dates.map((d) => {
                            const parts = formatDateStrip(d);
                            const active = d === date;
                            return (
                                <button
                                    key={d}
                                    type="button"
                                    onClick={() => loadSlots(d, doctorId)}
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
                </div>
            )}

            {doctorId && date && (
                <div>
                    <h2 className="mb-2 text-sm font-medium text-slate-500">Time</h2>
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
                                {slots.map((s) => (
                                    <button
                                        key={s.start_time}
                                        type="button"
                                        onClick={() => setSlot(s)}
                                        className={`rounded-xl px-2 py-2 text-sm font-medium ${
                                            slot?.start_time === s.start_time
                                                ? 'bg-[var(--accent)] text-white'
                                                : 'bg-slate-100 text-slate-700'
                                        }`}
                                    >
                                        {formatTime(s.start_time)}
                                    </button>
                                ))}
                            </div>
                        )}
                    </Card>
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
