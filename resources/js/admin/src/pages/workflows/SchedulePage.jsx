import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useScope } from '../../context/ScopeContext';
import AppointmentsFlowPage from './AppointmentsFlowPage';
import ScheduleDayView from './ScheduleDayView';

const VIEW_KEY = 'schedule_view';

/**
 * Schedule: a per-doctor day timeline (default) and the existing list view,
 * which keeps every filter, token and bulk tool it had. A deep link with
 * ?open=<id> lands on the list, whose drawer opens that appointment.
 */
export default function SchedulePage() {
    const scope = useScope() || {};
    const [searchParams] = useSearchParams();
    const [view, setView] = useState(() => {
        if (searchParams.get('open')) return 'list';
        try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'day'; } catch { return 'day'; }
    });

    const pick = (next) => {
        setView(next);
        try { localStorage.setItem(VIEW_KEY, next); } catch { /* storage unavailable */ }
    };

    const tab = (key, label) => (
        <button
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => pick(key)}
            className={`h-8 rounded-lg px-3 text-sm ${view === key ? 'bg-slate-900 font-semibold text-white' : 'text-slate-700 hover:bg-slate-100'}`}
        >
            {label}
        </button>
    );

    return (
        <div className="space-y-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">Schedule</h1>
                    <div role="tablist" aria-label="View" className="flex rounded-xl border border-slate-200 bg-white p-1">
                        {tab('day', 'Day')}
                        {tab('list', 'List')}
                        <Link to="/workflows/waitlist" className="flex h-8 items-center rounded-lg px-3 text-sm text-slate-700 hover:bg-slate-100">Waitlist</Link>
                    </div>
                </div>
                {scope.can?.('appointments.create') && (
                    <Link to="/workflows/appointments/new" className="flex h-10 items-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">
                        Book appointment
                    </Link>
                )}
            </header>

            {view === 'day' ? <ScheduleDayView /> : <AppointmentsFlowPage embedded />}
        </div>
    );
}
