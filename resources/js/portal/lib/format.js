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
