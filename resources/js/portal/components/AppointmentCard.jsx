import React from 'react';
import { formatDate, formatTime } from '../lib/format';

const STATUS_STYLES = {
    pending: 'bg-amber-100 text-amber-800',
    confirmed: 'bg-emerald-100 text-emerald-800',
    checked_in: 'bg-blue-100 text-blue-800',
    completed: 'bg-slate-100 text-slate-700',
    cancelled: 'bg-rose-100 text-rose-800',
    no_show: 'bg-rose-100 text-rose-800',
};

function StatusPill({ status }) {
    const style = STATUS_STYLES[status] || 'bg-slate-100 text-slate-700';
    const text = (status || '').replace(/_/g, ' ');
    return (
        <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${style}`}>
            {text.charAt(0).toUpperCase() + text.slice(1)}
        </span>
    );
}

/**
 * The doctor/date/time/status summary shared by the dashboard's "next
 * appointment" card and the visits list/detail pages, so the three places
 * that render an appointment stay visually and behaviourally in sync
 * instead of drifting apart.
 */
export default function AppointmentCard({ appointment }) {
    const awaitingPortalConfirmation = appointment.status === 'pending' && appointment.booking_channel === 'portal';

    return (
        <div>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-base font-semibold text-slate-900">
                        {formatDate(appointment.date)} &middot; <span className="tabular-nums">{formatTime(appointment.start_time)}</span>
                    </p>
                    <p className="mt-0.5 truncate text-sm text-slate-600">
                        {appointment.doctor?.name || 'Doctor'}
                        {appointment.doctor?.specialization ? ` · ${appointment.doctor.specialization}` : ''}
                    </p>
                </div>
                <StatusPill status={appointment.status} />
            </div>
            {awaitingPortalConfirmation && (
                <p className="mt-2 text-sm font-medium text-amber-800">Portal &middot; awaiting confirmation</p>
            )}
        </div>
    );
}
