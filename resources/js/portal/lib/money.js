// Rupee formatting for invoices. Amounts arrive as plain numbers (rupees).
export function formatMoney(value) {
    const n = Number(value) || 0;
    return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// What the patient owes, said honestly. `balance` is never clamped
// server-side: negative means an online capture overshot and the clinic owes
// the patient a refund.
export function balanceLine(invoice) {
    const balance = Number(invoice.balance) || 0;
    if (balance > 0) return { tone: 'due', label: 'Balance due', text: formatMoney(balance) };
    if (balance < 0) return { tone: 'credit', label: 'Overpaid', text: formatMoney(Math.abs(balance)) };
    return { tone: 'settled', label: 'Balance', text: formatMoney(0) };
}

export function statusChip(invoice) {
    if (invoice.status === 'paid') {
        return { label: 'Paid', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
    }
    if (invoice.status === 'issued') {
        // An issued invoice that is already covered (or overpaid) is not unpaid.
        if (Number(invoice.balance) <= 0) {
            return { label: 'Settled', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
        }
        return { label: 'Unpaid', className: 'bg-amber-50 text-amber-700 ring-amber-200' };
    }
    return { label: invoice.status, className: 'bg-slate-50 text-slate-600 ring-slate-200' };
}
