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
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    gray: 'border-gray-200 bg-gray-50 text-gray-600',
};

const DOTS = {
    blue: 'bg-blue-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    gray: 'bg-gray-400',
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
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${COLORS[color]}`}>
            <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${DOTS[color]}`} />
            {label}
        </span>
    );
}
