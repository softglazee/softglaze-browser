// Monthly and yearly plans on the Billing page and the sign-in gate's plan step. A yearly plan is a
// licensing-server plan with interval 'year' and months 12 (src/main/planCatalog.js keeps `interval`;
// the built-in catalog has only `period`). Pure, so it is tested without a window.

export const BILLING_PERIODS = Object.freeze(['month', 'year']);

// 'month' or 'year' for a paid plan, null for the trial. Anything not billed by the year (a month, or
// a rare 3-month plan) is in the monthly group.
export function billingPeriodOf(plan) {
  if (!plan || typeof plan !== 'object' || plan.kind === 'trial') return null;
  const i = String(plan.interval || plan.period || '').toLowerCase();
  if (/^(year|annual)/.test(i) || Number(plan.months) === 12) return 'year';
  return 'month';
}

// True when both a monthly and a yearly paid plan are for sale: only then is there a Monthly / Yearly switch.
export function hasBothPeriods(plans) {
  const set = new Set((Array.isArray(plans) ? plans : []).map(billingPeriodOf).filter(Boolean));
  return set.has('month') && set.has('year');
}

// The cards to show for one period: the trial card, then the paid plans billed that way. With only one
// period for sale, every plan is shown (no switch).
export function plansForPeriod(plans, period) {
  const list = Array.isArray(plans) ? plans : [];
  if (!hasBothPeriods(list)) return list;
  return list.filter((p) => p && (p.kind === 'trial' || billingPeriodOf(p) === period));
}

// The same tier and currency in the other period (switching Monthly / Yearly keeps the chosen tier).
export function counterpartPlan(plan, plans, period) {
  if (!plan || plan.kind === 'trial') return null;
  return (Array.isArray(plans) ? plans : []).find((p) => p && p.kind !== 'trial'
    && billingPeriodOf(p) === period && p.tier === plan.tier && p.currency === plan.currency) || null;
}

const toCents = (amount) => {
  const n = Math.round(Number.parseFloat(amount) * 100);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
// Cents as the app writes amounts: "10", "4.17".
const major = (c) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));

// A yearly plan next to the monthly plan of the same tier and currency:
//   { perMonth: '4.17', saving: '10' | null, monthsFree: 2 | null }
// perMonth is the yearly price spread over its months; saving is 12 monthly payments minus the yearly
// price (null when the year saves nothing or there is no monthly plan to compare with); monthsFree is
// set only when the saving is a whole number of monthly payments. Null for anything not yearly.
export function yearlyDeal(plan, plans) {
  if (billingPeriodOf(plan) !== 'year') return null;
  const yearCents = toCents(plan.amount);
  if (!yearCents) return null;
  const months = Number(plan.months) >= 12 ? Math.floor(Number(plan.months)) : 12;
  const perMonth = major(Math.round(yearCents / months));
  const monthly = counterpartPlan(plan, plans, 'month');
  const monthCents = monthly && Math.max(1, Number.parseInt(monthly.months, 10) || 1) === 1 ? toCents(monthly.amount) : null;
  if (!monthCents) return { perMonth, saving: null, monthsFree: null };
  const savingCents = monthCents * months - yearCents;
  if (savingCents <= 0) return { perMonth, saving: null, monthsFree: null };
  return {
    perMonth,
    saving: major(savingCents),
    monthsFree: savingCents % monthCents === 0 ? savingCents / monthCents : null
  };
}

// Whether a card is the plan the workspace pays for. The licence's plan key (from the signed lease)
// decides when it names a plan on the page; licences without one (purchase codes, manual grants) match
// on the tier, as before yearly plans existed.
export function isCurrentPlan(plan, { isPaid, currentTier, currentPlanKey, plans } = {}) {
  if (!isPaid || !plan || plan.kind === 'trial') return false;
  const key = String(currentPlanKey || '').toLowerCase();
  const known = key && (Array.isArray(plans) ? plans : []).some((p) => p && String(p.id).toLowerCase() === key);
  if (known) return String(plan.id).toLowerCase() === key;
  return plan.tier === currentTier;
}

// The period the page opens on: the current plan's when it is known to be yearly, else monthly.
export function initialPeriod(plans, current) {
  if (!hasBothPeriods(plans)) return 'month';
  const cur = (Array.isArray(plans) ? plans : []).find((p) => p && p.kind !== 'trial' && isCurrentPlan(p, { ...current, plans }));
  return cur && billingPeriodOf(cur) === 'year' && current && current.currentPlanKey ? 'year' : 'month';
}
