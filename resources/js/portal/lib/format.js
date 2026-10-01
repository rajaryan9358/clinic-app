// Shared date/time formatting for the portal SPA. Appointment/prescription
// dates and times are clinic-local strings (YYYY-MM-DD / HH:MM) — we only
// ever *format* them for display, never re-parse them as UTC/local instants,
// so a patient in a different timezone from the clinic still sees the time
// the clinic actually meant.

export function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatTime(timeStr) {
    if (!timeStr) return '';
    const [hoursStr, minutesStr] = timeStr.split(':');
    const hours = Number(hoursStr);
    if (Number.isNaN(hours)) return timeStr;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = ((hours + 11) % 12) + 1;
    return `${displayHours}:${minutesStr} ${period}`;
}

// { weekday, day, month } for a compact date-strip chip (booking/reschedule).
export function formatDateStrip(dateStr) {
    const date = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
        return { weekday: '', day: dateStr, month: '' };
    }
    return {
        weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
        day: date.getDate(),
        month: date.toLocaleDateString(undefined, { month: 'short' }),
    };
}

// Client-local calendar date as YYYY-MM-DD. Only used to build the set of
// candidate dates offered in the booking/reschedule date strip (the clinic
// itself enforces the real booking window server-side via the slots 422) —
// never used to interpret a clinic-local value from the API.
export function isoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

// The clinic's timezone, mirroring the server's `config('app.clinic_timezone')`
// default. The portal API doesn't expose it, and every clinic-local value it
// returns is already a plain string (see above) — this is only needed for
// the few ISO-8601 *instants* (e.g. a waitlist hold's `hold_expires_at`)
// so "held until 10:45 AM" reads in the same clock as the slot times.
export const CLINIC_TIME_ZONE = 'Asia/Kolkata';

// Clock time (e.g. "10:45 AM") of an ISO-8601 instant, in clinic time.
export function formatInstantTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    try {
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: CLINIC_TIME_ZONE });
    } catch {
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
}

// "12:05" / "1:02:09" for a non-negative millisecond duration (countdowns).
export function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
