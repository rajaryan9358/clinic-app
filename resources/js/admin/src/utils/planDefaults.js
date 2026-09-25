// Shared "paid offline" defaulting rules used by both the onboarding wizard's
// Plan step and the clinic Subscription card's "Assign plan" panel, so the two
// flows always agree on how the offline amount/period prefill.

/** Prefill the offline amount (in ₹, for a text input) from a plan's price for the given cycle. */
export function offlineAmountForCycle(plan, cycle) {
    if (!plan) return '';
    if (cycle === 'yearly' && plan.yearly_price) return String(plan.yearly_price / 100);
    return String(plan.monthly_price / 100);
}

/** Default offline payment period: a full year for yearly billing, a single month otherwise. */
export function offlinePeriodMonthsForCycle(cycle) {
    return cycle === 'yearly' ? '12' : '1';
}
