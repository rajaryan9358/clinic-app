const STATUS_CONFIG = {
    // ── User / Clinic ─────────────────────────────────────────────────────────
    active:          { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200' },
    inactive:        { dot: 'bg-gray-400',    text: 'text-gray-600',   bg: 'bg-gray-50',     border: 'border-gray-200' },
    blocked:         { dot: 'bg-red-500',     text: 'text-red-700',    bg: 'bg-red-50',      border: 'border-red-200' },
    suspended:       { dot: 'bg-amber-500',   text: 'text-amber-700',  bg: 'bg-amber-50',    border: 'border-amber-200' },

    // ── Appointment ───────────────────────────────────────────────────────────
    pending:         { dot: 'bg-amber-400',   text: 'text-amber-700',  bg: 'bg-amber-50',    border: 'border-amber-200' },
    confirmed:       { dot: 'bg-blue-500',    text: 'text-blue-700',   bg: 'bg-blue-50',     border: 'border-blue-200' },
    checked_in:      { dot: 'bg-sky-500',     text: 'text-sky-700',    bg: 'bg-sky-50',      border: 'border-sky-200' },
    in_consultation: { dot: 'bg-violet-500',  text: 'text-violet-700', bg: 'bg-violet-50',   border: 'border-violet-200' },
    completed:       { dot: 'bg-emerald-500', text: 'text-emerald-700',bg: 'bg-emerald-50',  border: 'border-emerald-200' },
    cancelled:       { dot: 'bg-red-400',     text: 'text-red-600',    bg: 'bg-red-50',      border: 'border-red-200' },
    no_show:         { dot: 'bg-orange-500',  text: 'text-orange-700', bg: 'bg-orange-50',   border: 'border-orange-200' },
    rescheduled:     { dot: 'bg-indigo-400',  text: 'text-indigo-700', bg: 'bg-indigo-50',   border: 'border-indigo-200' },

    // ── Waitlist ──────────────────────────────────────────────────────────────
    waiting:         { dot: 'bg-amber-400',   text: 'text-amber-700',  bg: 'bg-amber-50',    border: 'border-amber-200' },
    offered:         { dot: 'bg-blue-500',    text: 'text-blue-700',   bg: 'bg-blue-50',     border: 'border-blue-200' },
    booked:          { dot: 'bg-emerald-500', text: 'text-emerald-700',bg: 'bg-emerald-50',  border: 'border-emerald-200' },
    declined:        { dot: 'bg-gray-400',    text: 'text-gray-600',   bg: 'bg-gray-50',     border: 'border-gray-200' },
    removed:         { dot: 'bg-gray-400',    text: 'text-gray-600',   bg: 'bg-gray-50',     border: 'border-gray-200' },

    // ── Invoice / Payment ─────────────────────────────────────────────────────
    draft:           { dot: 'bg-gray-400',    text: 'text-gray-600',   bg: 'bg-gray-50',     border: 'border-gray-200' },
    final:           { dot: 'bg-emerald-500', text: 'text-emerald-700',bg: 'bg-emerald-50',  border: 'border-emerald-200' },
    issued:          { dot: 'bg-blue-500',    text: 'text-blue-700',   bg: 'bg-blue-50',     border: 'border-blue-200' },
    paid:            { dot: 'bg-emerald-500', text: 'text-emerald-700',bg: 'bg-emerald-50',  border: 'border-emerald-200' },
    partial:         { dot: 'bg-amber-400',   text: 'text-amber-700',  bg: 'bg-amber-50',    border: 'border-amber-200' },
    refunded:        { dot: 'bg-violet-400',  text: 'text-violet-700', bg: 'bg-violet-50',   border: 'border-violet-200' },

    // ── Delivery / Reminder ───────────────────────────────────────────────────
    sent:            { dot: 'bg-sky-500',     text: 'text-sky-700',    bg: 'bg-sky-50',      border: 'border-sky-200' },
    delivered:       { dot: 'bg-emerald-500', text: 'text-emerald-700',bg: 'bg-emerald-50',  border: 'border-emerald-200' },
    read:            { dot: 'bg-purple-500',  text: 'text-purple-700', bg: 'bg-purple-50',   border: 'border-purple-200' },
    failed:          { dot: 'bg-red-500',     text: 'text-red-700',    bg: 'bg-red-50',      border: 'border-red-200' },

    // ── Review Sentiment ──────────────────────────────────────────────────────
    positive:        { dot: 'bg-emerald-500', text: 'text-emerald-700',bg: 'bg-emerald-50',  border: 'border-emerald-200' },
    neutral:         { dot: 'bg-amber-400',   text: 'text-amber-700',  bg: 'bg-amber-50',    border: 'border-amber-200' },
    negative:        { dot: 'bg-red-500',     text: 'text-red-700',    bg: 'bg-red-50',      border: 'border-red-200' },

    // ── WhatsApp Conversation ─────────────────────────────────────────────────
    open:            { dot: 'bg-blue-500',    text: 'text-blue-700',   bg: 'bg-blue-50',     border: 'border-blue-200' },
    closed:          { dot: 'bg-gray-400',    text: 'text-gray-600',   bg: 'bg-gray-50',     border: 'border-gray-200' },
    resolved:        { dot: 'bg-emerald-500', text: 'text-emerald-700',bg: 'bg-emerald-50',  border: 'border-emerald-200' },

    // ── Task / Followup ───────────────────────────────────────────────────────
    overdue:         { dot: 'bg-red-500',     text: 'text-red-700',    bg: 'bg-red-50',      border: 'border-red-200' },
    due_today:       { dot: 'bg-orange-500',  text: 'text-orange-700', bg: 'bg-orange-50',   border: 'border-orange-200' },
    done:            { dot: 'bg-emerald-500', text: 'text-emerald-700',bg: 'bg-emerald-50',  border: 'border-emerald-200' },
    in_progress:     { dot: 'bg-blue-500',    text: 'text-blue-700',   bg: 'bg-blue-50',     border: 'border-blue-200' },

    // ── SSL / Domain ──────────────────────────────────────────────────────────
    enabled:         { dot: 'bg-emerald-500', text: 'text-emerald-700',bg: 'bg-emerald-50',  border: 'border-emerald-200' },
    disabled:        { dot: 'bg-gray-400',    text: 'text-gray-600',   bg: 'bg-gray-50',     border: 'border-gray-200' },
    provisioning:    { dot: 'bg-amber-400',   text: 'text-amber-700',  bg: 'bg-amber-50',    border: 'border-amber-200' },
    error:           { dot: 'bg-red-500',     text: 'text-red-700',    bg: 'bg-red-50',      border: 'border-red-200' },
    yes:             { dot: 'bg-emerald-500', text: 'text-emerald-700',bg: 'bg-emerald-50',  border: 'border-emerald-200' },
    no:              { dot: 'bg-gray-400',    text: 'text-gray-600',   bg: 'bg-gray-50',     border: 'border-gray-200' },

    // ── Subscription ──────────────────────────────────────────────────────────
    trialing:        { dot: 'bg-blue-500',    text: 'text-blue-700',   bg: 'bg-blue-50',     border: 'border-blue-200' },
    pending_payment: { dot: 'bg-amber-500',   text: 'text-amber-700',  bg: 'bg-amber-50',    border: 'border-amber-200' },
    past_due:        { dot: 'bg-amber-500',   text: 'text-amber-700',  bg: 'bg-amber-50',    border: 'border-amber-200' },
    expired:         { dot: 'bg-red-500',     text: 'text-red-700',    bg: 'bg-red-50',      border: 'border-red-200' },
};

const FALLBACK = { dot: 'bg-gray-400', text: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200' };

function prettify(str) {
    return String(str || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function StatusBadge({ status }) {
    if (status === null || status === undefined || status === '') return null;
    const key = String(status).toLowerCase();
    const cfg = STATUS_CONFIG[key] ?? FALLBACK;

    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.border} ${cfg.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
            {prettify(status)}
        </span>
    );
}
