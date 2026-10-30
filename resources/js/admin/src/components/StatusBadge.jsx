const STATUS_CONFIG = {
    // ── User / Clinic ─────────────────────────────────────────────────────────
    active:          { cls: 'bg-emerald-100 text-emerald-800' },
    inactive:        { cls: 'bg-slate-100 text-slate-700' },
    blocked:         { cls: 'bg-rose-100 text-rose-800' },
    suspended:       { cls: 'bg-amber-100 text-amber-800' },

    // ── Appointment ───────────────────────────────────────────────────────────
    pending:         { cls: 'bg-amber-100 text-amber-800' },
    confirmed:       { cls: 'bg-blue-100 text-blue-800' },
    checked_in:      { cls: 'bg-sky-100 text-sky-800' },
    in_consultation: { cls: 'bg-violet-100 text-violet-800' },
    completed:       { cls: 'bg-emerald-100 text-emerald-800' },
    cancelled:       { cls: 'bg-rose-100 text-rose-800' },
    no_show:         { cls: 'bg-orange-100 text-orange-800' },
    rescheduled:     { cls: 'bg-indigo-100 text-indigo-800' },

    // ── Waitlist ──────────────────────────────────────────────────────────────
    waiting:         { cls: 'bg-amber-100 text-amber-800' },
    offered:         { cls: 'bg-blue-100 text-blue-800' },
    booked:          { cls: 'bg-emerald-100 text-emerald-800' },
    declined:        { cls: 'bg-slate-100 text-slate-700' },
    removed:         { cls: 'bg-slate-100 text-slate-700' },

    // ── Invoice / Payment ─────────────────────────────────────────────────────
    draft:           { cls: 'bg-slate-100 text-slate-700' },
    final:           { cls: 'bg-emerald-100 text-emerald-800' },
    issued:          { cls: 'bg-blue-100 text-blue-800' },
    paid:            { cls: 'bg-emerald-100 text-emerald-800' },
    partial:         { cls: 'bg-amber-100 text-amber-800' },
    refunded:        { cls: 'bg-violet-100 text-violet-800' },

    // ── Delivery / Reminder ───────────────────────────────────────────────────
    sent:            { cls: 'bg-sky-100 text-sky-800' },
    delivered:       { cls: 'bg-emerald-100 text-emerald-800' },
    read:            { cls: 'bg-purple-100 text-purple-800' },
    failed:          { cls: 'bg-rose-100 text-rose-800' },

    // ── Review Sentiment ──────────────────────────────────────────────────────
    positive:        { cls: 'bg-emerald-100 text-emerald-800' },
    neutral:         { cls: 'bg-amber-100 text-amber-800' },
    negative:        { cls: 'bg-rose-100 text-rose-800' },

    // ── WhatsApp Conversation ─────────────────────────────────────────────────
    open:            { cls: 'bg-blue-100 text-blue-800' },
    closed:          { cls: 'bg-slate-100 text-slate-700' },
    resolved:        { cls: 'bg-emerald-100 text-emerald-800' },

    // ── Task / Followup ───────────────────────────────────────────────────────
    overdue:         { cls: 'bg-rose-100 text-rose-800' },
    due_today:       { cls: 'bg-orange-100 text-orange-800' },
    done:            { cls: 'bg-emerald-100 text-emerald-800' },
    in_progress:     { cls: 'bg-blue-100 text-blue-800' },

    // ── SSL / Domain ──────────────────────────────────────────────────────────
    enabled:         { cls: 'bg-emerald-100 text-emerald-800' },
    disabled:        { cls: 'bg-slate-100 text-slate-700' },
    provisioning:    { cls: 'bg-amber-100 text-amber-800' },
    error:           { cls: 'bg-rose-100 text-rose-800' },
    yes:             { cls: 'bg-emerald-100 text-emerald-800' },
    no:              { cls: 'bg-slate-100 text-slate-700' },

    // ── Subscription ──────────────────────────────────────────────────────────
    trialing:        { cls: 'bg-blue-100 text-blue-800' },
    pending_payment: { cls: 'bg-amber-100 text-amber-800' },
    past_due:        { cls: 'bg-amber-100 text-amber-800' },
    expired:         { cls: 'bg-rose-100 text-rose-800' },
};

const FALLBACK = { cls: 'bg-slate-100 text-slate-700' };

function prettify(str) {
    return String(str || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function StatusBadge({ status }) {
    if (status === null || status === undefined || status === '') return null;
    const key = String(status).toLowerCase();
    const cfg = STATUS_CONFIG[key] ?? FALLBACK;

    return (
        <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${cfg.cls}`}>
            {prettify(status)}
        </span>
    );
}
