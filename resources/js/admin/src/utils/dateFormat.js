const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDate(value) {
    if (!value) return null;
    const str = String(value).trim();
    // Handle date-only strings (no timezone shift)
    const d = str.includes('T') || str.includes(' ')
        ? new Date(str)
        : new Date(`${str}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
}

function pad(n) { return String(n).padStart(2, '0'); }

function toTime12(h, m) {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${pad(m)} ${ampm}`;
}

/** "15 Jan 2024" */
export function formatDate(value) {
    const d = parseDate(value);
    if (!d) return '—';
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** "15 Jan 2024, 2:30 PM" */
export function formatDateTime(value) {
    const d = parseDate(value);
    if (!d) return '—';
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}, ${toTime12(d.getHours(), d.getMinutes())}`;
}

/**
 * Format a HH:MM[:SS] time string or a datetime value as "2:30 PM"
 */
export function formatTime(value) {
    if (!value) return '—';
    const str = String(value).trim();
    // HH:MM or HH:MM:SS
    if (/^\d{1,2}:\d{2}/.test(str)) {
        const [h, m] = str.split(':').map(Number);
        return toTime12(h, m);
    }
    const d = parseDate(str);
    if (!d) return '—';
    return toTime12(d.getHours(), d.getMinutes());
}

/** "just now" / "3m ago" / "2h ago" / "Yesterday" / "3d ago" / date */
export function formatRelative(value) {
    const d = parseDate(value);
    if (!d) return '—';
    const diff = Date.now() - d.getTime();
    const abs = Math.abs(diff);
    if (abs < 60_000) return 'just now';
    if (abs < 3_600_000) return `${Math.floor(abs / 60_000)}m ago`;
    if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)}h ago`;
    if (abs < 172_800_000) return 'Yesterday';
    if (abs < 604_800_000) return `${Math.floor(abs / 86_400_000)}d ago`;
    return formatDate(value);
}

/** Returns true if a table column key is a date/datetime column */
export function isDateTimeKey(key) {
    const k = String(key || '').toLowerCase();
    return k.endsWith('_at') || k === 'created_at' || k === 'updated_at' || k === 'paid_at'
        || k === 'verified_at' || k === 'expires_at' || k === 'last_login_at' || k === 'scheduled_for'
        || k === 'last_message_at' || k === 'sent_at' || k === 'read_at';
}

export function isDateKey(key) {
    const k = String(key || '').toLowerCase();
    return k === 'date' || k === 'appointment_date' || k === 'due_date' || k === 'dob'
        || k === 'invoice_date' || k === 'birth_date' || k.endsWith('_date') || k.endsWith('_on');
}

export function isTimeKey(key) {
    const k = String(key || '').toLowerCase();
    return k === 'time' || k === 'start_time' || k === 'end_time' || k.endsWith('_time');
}
