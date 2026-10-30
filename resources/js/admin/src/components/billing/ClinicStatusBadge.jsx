// Status shown for a clinic in super admin screens: the subscription status,
// or "Suspended" when the clinic itself has been suspended.
const LABELS = {
    trialing: ['Trialing', 'blue'],
    active: ['Active', 'emerald'],
    pending_payment: ['Payment due', 'amber'],
    past_due: ['Payment due', 'amber'],
    expired: ['Expired', 'red'],
    cancelled: ['Cancelled', 'gray'],
};

const COLORS = {
    blue: 'bg-blue-100 text-blue-800',
    emerald: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-rose-100 text-rose-800',
    gray: 'bg-slate-100 text-slate-700',
};

const DOTS = {
    blue: 'bg-blue-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-rose-500',
    gray: 'bg-slate-400',
};

export default function ClinicStatusBadge({ clinicStatus, subscriptionStatus }) {
    let label;
    let color;
    if (clinicStatus === 'suspended') {
        [label, color] = ['Suspended', 'red'];
    } else if (subscriptionStatus && LABELS[subscriptionStatus]) {
        [label, color] = LABELS[subscriptionStatus];
    } else {
        [label, color] = ['No plan', 'gray'];
    }

    return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${COLORS[color]}`}>
            <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${DOTS[color]}`} />
            {label}
        </span>
    );
}
