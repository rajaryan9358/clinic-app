import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import AppointmentCard from '../components/AppointmentCard';
import { Alert, Button, Card, CardTitle, ErrorText, Loading, PageHeader, inputClass, labelClass } from '../components/ui';
import { MapPinIcon, PhoneIcon } from '../components/icons';

/**
 * `GET appointments/{id}` detail: clinic/maps link, cancel (with an inline
 * confirm + optional reason) and reschedule, each independently gated by
 * `can_cancel`/`cancel_blocked_reason` and `can_reschedule`/
 * `reschedule_blocked_reason` from AppointmentPresenter (cancel and
 * reschedule have their own clinic settings/cutoffs, so one can be blocked
 * while the other isn't), plus "View prescription" (resolved by scanning
 * the prescriptions list for this appointment — there's no by-appointment
 * lookup endpoint) and "Book follow-up".
 */
export default function VisitDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const [appointment, setAppointment] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [banner, setBanner] = useState(location.state?.message || '');

    const [cancelling, setCancelling] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    const [cancelError, setCancelError] = useState('');
    const [cancelSubmitting, setCancelSubmitting] = useState(false);

    const [rxLoading, setRxLoading] = useState(false);
    const [rxError, setRxError] = useState('');

    // Guarded with `active` (not just a plain fetch) so a slow response for
    // an earlier `id` can never clobber state after the user has already
    // navigated to a different visit's detail page.
    useEffect(() => {
        let active = true;
        setLoading(true);
        setLoadError('');
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

    async function submitCancel() {
        setCancelSubmitting(true);
        setCancelError('');
        try {
            const { data } = await api.post(`/appointments/${id}/cancel`, {
                reason: cancelReason.trim() || undefined,
            });
            setAppointment(data.data);
            setCancelling(false);
            setCancelReason('');
            setBanner('Appointment cancelled.');
        } catch (err) {
            setCancelError(err?.response?.data?.message || 'Could not cancel this visit.');
        } finally {
            setCancelSubmitting(false);
        }
    }

    async function viewPrescription() {
        setRxLoading(true);
        setRxError('');
        try {
            const { data } = await api.get('/prescriptions');
            const match = (data.data || []).find((rx) => rx.appointment_id === appointment.id);
            if (match) {
                navigate(`/prescriptions/${match.id}`);
            } else {
                setRxError('Could not find the prescription for this visit.');
            }
        } catch (err) {
            setRxError(err?.response?.data?.message || 'Could not open the prescription.');
        } finally {
            setRxLoading(false);
        }
    }

    if (loading) {
        return <Loading />;
    }

    if (loadError || !appointment) {
        return <ErrorText>{loadError || 'Visit not found.'}</ErrorText>;
    }

    // Cancel and reschedule are blocked independently (separate clinic
    // settings/cutoffs), so each gets its own reason rather than a single
    // combined message that would hide, say, "you can still reschedule"
    // behind "changes are closed". When both happen to share the exact
    // same reason (e.g. the visit is already completed), show it once.
    const cancelBlockedReason = !appointment.can_cancel ? appointment.cancel_blocked_reason : null;
    const rescheduleBlockedReason = !appointment.can_reschedule ? appointment.reschedule_blocked_reason : null;
    const sharedBlockedReason =
        cancelBlockedReason && rescheduleBlockedReason && cancelBlockedReason === rescheduleBlockedReason
            ? cancelBlockedReason
            : null;

    return (
        <div className="space-y-5">
            <PageHeader title="Visit details" back={{ label: 'Back to visits', onClick: () => navigate('/visits') }} />

            {banner && <Alert tone="success">{banner}</Alert>}

            <Card>
                <AppointmentCard appointment={appointment} />
                <dl className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-sm">
                    <div className="flex justify-between gap-4 py-2.5">
                        <dt className="text-slate-600">Visit type</dt>
                        <dd className="font-medium capitalize text-slate-900">{appointment.visit_type}</dd>
                    </div>
                    <div className="flex justify-between gap-4 pt-2.5">
                        <dt className="text-slate-600">Mode</dt>
                        <dd className="font-medium capitalize text-slate-900">{(appointment.consultation_mode || '').replace(/_/g, ' ')}</dd>
                    </div>
                </dl>
            </Card>

            {appointment.clinic && (appointment.clinic.address || appointment.clinic.phone) && (
                <Card>
                    <CardTitle>Clinic</CardTitle>
                    <p className="text-sm font-semibold text-slate-900">{appointment.clinic.name}</p>
                    {appointment.clinic.address && (
                        <p className="mt-1 flex items-start gap-2 text-sm text-slate-600">
                            <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                            <span>{appointment.clinic.address}</span>
                        </p>
                    )}
                    {appointment.clinic.phone && (
                        <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
                            <PhoneIcon className="h-4 w-4 shrink-0 text-slate-500" />
                            <span>{appointment.clinic.phone}</span>
                        </p>
                    )}
                    {appointment.clinic.maps_url && (
                        <a
                            href={appointment.clinic.maps_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                        >
                            <MapPinIcon className="h-4 w-4 text-[var(--accent)]" />
                            View on map
                        </a>
                    )}
                </Card>
            )}

            {appointment.status === 'cancelled' && appointment.cancellation_reason && (
                <Card>
                    <CardTitle className="mb-1">Cancellation reason</CardTitle>
                    <p className="text-sm text-slate-700">{appointment.cancellation_reason}</p>
                </Card>
            )}

            {sharedBlockedReason ? (
                <Alert tone="warn">{sharedBlockedReason}</Alert>
            ) : (
                <>
                    {cancelBlockedReason ? <Alert tone="warn">Cancel: {cancelBlockedReason}</Alert> : null}
                    {rescheduleBlockedReason ? <Alert tone="warn">Reschedule: {rescheduleBlockedReason}</Alert> : null}
                </>
            )}

            <div className="space-y-2">
                {appointment.can_reschedule && !cancelling && (
                    <Button variant="secondary" onClick={() => navigate(`/visits/${appointment.id}/reschedule`)}>
                        Reschedule
                    </Button>
                )}

                {appointment.can_cancel && !cancelling && (
                    <Button variant="danger" onClick={() => setCancelling(true)}>
                        Cancel visit
                    </Button>
                )}

                {cancelling && (
                    <Card className="space-y-3 border-rose-200">
                        <p className="text-base font-semibold text-slate-900">Cancel this visit?</p>
                        <div>
                            <label htmlFor="cancel-reason" className={labelClass}>
                                Reason (optional)
                            </label>
                            <textarea
                                id="cancel-reason"
                                value={cancelReason}
                                onChange={(e) => setCancelReason(e.target.value)}
                                placeholder="Reason (optional)"
                                rows={2}
                                className={inputClass}
                            />
                        </div>
                        <ErrorText>{cancelError}</ErrorText>
                        <div className="space-y-2">
                            <Button variant="danger" onClick={submitCancel} loading={cancelSubmitting}>
                                Confirm cancel
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setCancelling(false);
                                    setCancelError('');
                                    setCancelReason('');
                                }}
                            >
                                Keep visit
                            </Button>
                        </div>
                    </Card>
                )}

                {appointment.has_final_prescription && (
                    <Button variant="secondary" onClick={viewPrescription} loading={rxLoading}>
                        View prescription
                    </Button>
                )}
                {rxError ? <ErrorText>{rxError}</ErrorText> : null}

                <Button
                    variant="ghost"
                    onClick={() => navigate(`/book?doctor_id=${appointment.doctor?.id ?? ''}&visit_type=followup`)}
                >
                    Book follow-up
                </Button>
            </div>
        </div>
    );
}
