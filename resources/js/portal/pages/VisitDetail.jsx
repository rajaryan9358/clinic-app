import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import AppointmentCard from '../components/AppointmentCard';
import { Button, Card, ErrorText, Spinner } from '../components/ui';

/**
 * `GET appointments/{id}` detail: clinic/maps link, cancel (with an inline
 * confirm + optional reason) and reschedule, gated by `can_cancel` /
 * `can_reschedule` / `change_blocked_reason` from AppointmentPresenter, plus
 * "View prescription" (resolved by scanning the prescriptions list for this
 * appointment — there's no by-appointment lookup endpoint) and "Book
 * follow-up".
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

    const load = useCallback(() => {
        setLoading(true);
        setLoadError('');
        return api
            .get(`/appointments/${id}`)
            .then(({ data }) => setAppointment(data.data))
            .catch((err) => setLoadError(err?.response?.data?.message || 'Could not load this visit.'))
            .finally(() => setLoading(false));
    }, [id]);

    useEffect(() => {
        load();
    }, [load]);

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
        return (
            <div className="flex justify-center py-12">
                <Spinner className="h-6 w-6 text-[var(--accent)]" />
            </div>
        );
    }

    if (loadError || !appointment) {
        return <ErrorText>{loadError || 'Visit not found.'}</ErrorText>;
    }

    const blocked = !appointment.can_cancel && !appointment.can_reschedule && appointment.change_blocked_reason;

    return (
        <div className="space-y-4">
            <button
                type="button"
                onClick={() => navigate('/visits')}
                className="text-sm font-medium text-[var(--accent)]"
            >
                &larr; Back to visits
            </button>

            {banner && <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{banner}</div>}

            <Card>
                <AppointmentCard appointment={appointment} />
                <dl className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-sm">
                    <div className="flex justify-between">
                        <dt className="text-slate-500">Visit type</dt>
                        <dd className="capitalize text-slate-900">{appointment.visit_type}</dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-slate-500">Mode</dt>
                        <dd className="capitalize text-slate-900">{(appointment.consultation_mode || '').replace(/_/g, ' ')}</dd>
                    </div>
                </dl>
            </Card>

            {appointment.clinic && (appointment.clinic.address || appointment.clinic.phone) && (
                <Card>
                    <h2 className="mb-2 text-sm font-medium text-slate-500">Clinic</h2>
                    <p className="text-sm font-medium text-slate-900">{appointment.clinic.name}</p>
                    {appointment.clinic.address && <p className="text-sm text-slate-600">{appointment.clinic.address}</p>}
                    {appointment.clinic.phone && <p className="text-sm text-slate-600">{appointment.clinic.phone}</p>}
                    {appointment.clinic.maps_url && (
                        <a
                            href={appointment.clinic.maps_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-sm font-medium text-[var(--accent)]"
                        >
                            View on map
                        </a>
                    )}
                </Card>
            )}

            {appointment.status === 'cancelled' && appointment.cancellation_reason && (
                <Card>
                    <h2 className="mb-1 text-sm font-medium text-slate-500">Cancellation reason</h2>
                    <p className="text-sm text-slate-700">{appointment.cancellation_reason}</p>
                </Card>
            )}

            {blocked ? <ErrorText>{appointment.change_blocked_reason}</ErrorText> : null}

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
                    <Card>
                        <p className="mb-2 text-sm text-slate-600">Cancel this visit?</p>
                        <textarea
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            placeholder="Reason (optional)"
                            rows={2}
                            className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                        />
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
