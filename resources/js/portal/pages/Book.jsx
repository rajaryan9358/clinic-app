import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import DateStrip from '../components/DateStrip';
import JoinWaitlist from '../components/JoinWaitlist';
import SlotGrid from '../components/SlotGrid';
import useDoctorSlots from '../hooks/useDoctorSlots';
import { MODE_LABELS, VISIT_TYPES, modeOptionsFor } from '../lib/booking';
import { addDays, isoDate } from '../lib/format';
import { Button, Card, ChoiceGroup, EmptyState, ErrorText, Loading, PageHeader, SectionLabel, inputClass } from '../components/ui';
import { UsersIcon } from '../components/icons';

const STRIP_DAYS = 14;

/**
 * `/book`: doctor -> date -> slot (DateStrip/SlotGrid/useDoctorSlots —
 * shared with Reschedule.jsx) -> visit type/mode -> reason -> submit.
 * Honours `?doctor_id=&visit_type=` presets (from "Book follow-up" links
 * on VisitDetail/PrescriptionDetail) by preselecting them; the rest of the
 * flow still has to be completed by the patient since neither a date nor a
 * slot can be assumed. Taken times can be waitlisted from the grid, and a
 * 409 (the chosen time was just taken) offers "Join waitlist for this
 * time" for that slot.
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
        taken,
        loading: slotsLoading,
        error: slotsError,
        selectedSlot: slot,
        setSelectedSlot: setSlot,
        load: loadSlots,
        reset: resetSlots,
        joinWaitlist,
    } = useDoctorSlots();

    const [visitType, setVisitType] = useState(presetVisitType === 'followup' ? 'followup' : 'new');
    const [mode, setMode] = useState(null);
    const [reason, setReason] = useState('');

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    // The slot a booking attempt just lost with a 409, for the "Join
    // waitlist for this time" fallback. Only shown while that doctor/date
    // is still the one on screen.
    const [conflict, setConflict] = useState(null);
    const [conflictJoinOpen, setConflictJoinOpen] = useState(false);

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
    const modeOptions = modeOptionsFor(doctor);

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
        setConflict(null);
    }

    function selectDate(d) {
        loadSlots(doctorId, d);
        setConflict(null);
        setSubmitError('');
    }

    function selectSlot(s) {
        setSlot(s);
        setConflict(null);
        setSubmitError('');
    }

    async function submit() {
        if (submitting || !doctorId || !date || !slot) return;
        setSubmitting(true);
        setSubmitError('');
        setConflict(null);
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
                setConflict({ doctorId, date, slot });
                setConflictJoinOpen(false);
                loadSlots(doctorId, date);
            }
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader title="Book a visit" subtitle="Choose a doctor, then a day and time. The clinic will confirm your request." />

            <section>
                <SectionLabel>Doctor</SectionLabel>
                {doctorsLoading && <Loading className="py-8" />}
                {!doctorsLoading && doctorsError && <ErrorText>{doctorsError}</ErrorText>}
                {!doctorsLoading && !doctorsError && doctors.length === 0 && <EmptyState icon={UsersIcon} title="No doctors available." />}
                {!doctorsLoading && !doctorsError && doctors.length > 0 && (
                    <div className="space-y-2" role="radiogroup" aria-label="Doctor">
                        {doctors.map((d) => {
                            const selected = doctorId === d.id;
                            return (
                                <button
                                    key={d.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    onClick={() => selectDoctor(d)}
                                    className={`flex min-h-[64px] w-full items-center gap-3 rounded-2xl border bg-white p-4 text-left transition ${
                                        selected
                                            ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]'
                                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                    }`}
                                >
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-sm font-bold text-[var(--accent)]">
                                        {(d.full_name || '?').replace(/^dr\.?\s*/i, '').charAt(0).toUpperCase()}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-semibold text-slate-900">{d.full_name}</span>
                                        {d.specialization && <span className="block truncate text-sm text-slate-600">{d.specialization}</span>}
                                    </span>
                                    <span
                                        aria-hidden="true"
                                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                                            selected ? 'border-[var(--accent)]' : 'border-slate-300'
                                        }`}
                                    >
                                        {selected ? <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" /> : null}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </section>

            {doctorId && (
                <section>
                    <SectionLabel>Date</SectionLabel>
                    <DateStrip dates={dates} selectedDate={date} onSelect={selectDate} />
                </section>
            )}

            {doctorId && date && (
                <section>
                    <SectionLabel>Time</SectionLabel>
                    <SlotGrid
                        key={`${doctorId}:${date}`}
                        loading={slotsLoading}
                        error={slotsError}
                        slots={slots}
                        taken={taken}
                        date={date}
                        selectedSlot={slot}
                        onSelect={selectSlot}
                        onJoin={joinWaitlist}
                    />
                </section>
            )}

            {conflict && conflict.doctorId === doctorId && conflict.date === date && !slot && (
                <Card className="space-y-3">
                    <ErrorText>{submitError}</ErrorText>
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

            {doctorId && date && slot && (
                <>
                    <section>
                        <SectionLabel>Visit type</SectionLabel>
                        <ChoiceGroup label="Visit type" options={VISIT_TYPES} value={visitType} onChange={setVisitType} />
                    </section>

                    <section>
                        <SectionLabel>Mode</SectionLabel>
                        <ChoiceGroup
                            label="Mode"
                            options={modeOptions.map((m) => ({ value: m, label: MODE_LABELS[m] || m }))}
                            value={mode}
                            onChange={setMode}
                        />
                    </section>

                    <section>
                        <SectionLabel htmlFor="book-reason">Reason (optional)</SectionLabel>
                        <textarea
                            id="book-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            placeholder="Tell the clinic why you're booking"
                            className={inputClass}
                        />
                    </section>

                    {submitError ? <ErrorText>{submitError}</ErrorText> : null}
                    <Button onClick={submit} loading={submitting}>
                        Request this visit
                    </Button>
                </>
            )}
        </div>
    );
}
