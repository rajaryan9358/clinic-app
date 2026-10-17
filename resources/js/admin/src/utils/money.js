export const toPaise = (rupees) => {
    if (rupees === '' || rupees == null) return null;
    const n = Number(rupees);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export const formatINR = (paise) => {
    if (paise == null) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(paise / 100);
};

/** Convert paise back to a rupee value suitable for a number input (e.g. 150000 -> 1500). */
export const paiseToRupees = (paise) => {
    if (paise == null) return '';
    return String(paise / 100);
};

/** Format a rupee amount (invoice amounts are rupees as floats, not paise). Negative values keep their sign. */
export const formatRupees = (rupees) => {
    if (rupees === null || rupees === undefined || rupees === '') return '—';
    const n = Number(rupees);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(n);
};
