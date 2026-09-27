import React from 'react';
import { formatDate, formatTime } from '../lib/format';

const STATUS_STYLES = {
    pending: 'bg-amber-100 text-amber-700',
    confirmed: 'bg-emerald-100 text-emerald-700',
    checked_in: 'bg-emerald-100 text-emerald-700',
    completed: 'bg-slate-100 text-slate-600',
    cancelled: 'bg-red-100 text-red-600',
    no_show: 'bg-red-100 text-red-600',
};

function StatusPill({ status }) {
    const style = STATUS_STYLES[status] || 'bg-slate-100 text-slate-600';
    return (
        <span className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${style}`}>
            {(status || '').replace(/_/g, ' ')}
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
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-base font-semibold text-slate-900">
                        {formatDate(appointment.date)} &middot; {formatTime(appointment.start_time)}
                    </p>
                    <p className="truncate text-sm text-slate-600">
                        {appointment.doctor?.name || 'Doctor'}
                        {appointment.doctor?.specialization ? ` · ${appointment.doctor.specialization}` : ''}
                    </p>
                </div>
                <StatusPill status={appointment.status} />
            </div>
            {awaitingPortalConfirmation && (
                <p className="mt-1 text-xs font-medium text-amber-600">Portal &middot; awaiting confirmation</p>
            )}
        </div>
    );
}
