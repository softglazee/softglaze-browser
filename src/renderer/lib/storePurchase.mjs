// Microsoft Store purchases in the Store build: what the Billing page and the sign-in gate say and do
// with a result from store:purchase / store:restore (src/main/storeCommerce.js). Pure, so it is tested
// without a window. Prices always come from the Store product (store:status), never from this file.
import { billingPeriodOf } from './planPeriods.mjs';

export const STORE_METHOD_ID = 'microsoft_store';
// Where a customer manages or cancels a Microsoft subscription.
export const MANAGE_SUBSCRIPTIONS_URL = 'https://account.microsoft.com/services';
// "Waiting for confirmation" re-checks every 5 seconds for at most 2 minutes.
export const STORE_POLL = Object.freeze({ everyMs: 5000, maxTries: 24 });

export function isStoreMethod(method) {
  return Boolean(method && method.kind === 'store');
}

// The Store add-on for a plan card (a plan object; a plan id looks up the add-on mapped to that key, as
// before): the add-on mapped to the plan's key and billed the same way, else one of the same tier billed
// the same way, else null. A yearly card never gets the monthly add-on (main picks the same way:
// storeCommerce.offerFor).
export function storeOffer(storeInfo, plan) {
  if (!storeInfo || !storeInfo.available || !plan) return null;
  if (typeof plan !== 'object') return storeInfo.plans ? storeInfo.plans[plan] || null : null;
  const period = billingPeriodOf(plan) || 'month';
  const key = String(plan.id || '').toLowerCase();
  const offers = Array.isArray(storeInfo.offers) ? storeInfo.offers : [];
  if (!offers.length) {
    const direct = storeInfo.plans ? storeInfo.plans[plan.id] : null;
    return direct && (!direct.period || direct.period === period) ? direct : null;
  }
  return offers.find((o) => o && o.plan === key && o.period === period)
    || offers.find((o) => o && o.tier === plan.tier && o.period === period)
    || null;
}

// The Store's own price text for a plan ("$4.99", "PKR 1,399.00"), or null when the Store has none.
export function storePrice(storeInfo, plan) {
  const p = storeOffer(storeInfo, plan);
  return p && p.available && p.price && p.price.formatted ? p.price.formatted : null;
}

// True when the Store offers both a monthly and a yearly add-on (switching starts a second subscription).
export function storeHasBothPeriods(storeInfo) {
  const offers = storeInfo && storeInfo.available && Array.isArray(storeInfo.offers) ? storeInfo.offers : [];
  const p = new Set(offers.filter((o) => o && o.available).map((o) => o.period));
  return p.has('month') && p.has('year');
}

// Whether the Microsoft Store sells this plan: an add-on for its tier and billing period that the Store
// lists (the server maps each add-on to a plan key, settings.store.productPlans). A yearly plan with no
// yearly add-on in the Store is not sold there, so the Store build falls back to monthly. Unknown Store
// status (sales off, older status): not filtered.
export function storeSellsPlan(storeInfo, plan) {
  if (!storeInfo || !storeInfo.available || !storeInfo.plans) return true;
  const o = storeOffer(storeInfo, plan);
  return Boolean(o && o.available !== false);
}

// The payment methods for one plan (a plan object or id): the Store only for plans it sells.
export function methodsForPlan(methods, storeInfo, plan) {
  const list = Array.isArray(methods) ? methods : [];
  return list.filter((m) => !isStoreMethod(m) || storeSellsPlan(storeInfo, plan));
}

// The plans to offer: when the Store is the only way to pay, only the plans it sells (the trial stays;
// if it sells none, everything stays and buying explains the missing add-on, as before).
export function sellablePlans(plans, { storeOnly, storeInfo }) {
  const list = Array.isArray(plans) ? plans : [];
  if (!storeOnly) return list;
  const kept = list.filter((p) => p && (p.kind === 'trial' || storeSellsPlan(storeInfo, p)));
  return kept.some((p) => p.kind !== 'trial') ? kept : list;
}

// result.status -> { tone: 'success' | 'info' | 'error', key (billing namespace), params?, done?, poll?, canMove? }
//   done:    the licence changed, reload it
//   poll:    Microsoft took the payment, our server has not confirmed it yet: re-check (STORE_POLL)
//   canMove: the subscription is in use on another computer; offer "move it here"
export function storeOutcome(result) {
  const r = result && typeof result === 'object' ? result : {};
  switch (r.status) {
    case 'active':
      return { tone: 'success', key: 'store.result.active', params: { plan: r.tier === 'enterprise' ? 'Enterprise' : 'Pro' }, done: true };
    case 'cancelled':
      return { tone: 'info', key: 'store.result.cancelled' };
    case 'pending':
      return { tone: 'info', key: 'store.result.pending', poll: true };
    case 'pending_offline':
      return { tone: 'info', key: 'store.result.pendingOffline' };
    case 'pending_review':
      return { tone: 'info', key: 'store.result.pendingReview' };
    case 'none':
      return { tone: 'info', key: 'store.result.none' };
    case 'in_use':
      return { tone: 'error', key: 'store.result.inUse', canMove: true };
    case 'move_limit':
      return { tone: 'error', key: 'store.result.moveLimit' };
    case 'unavailable':
      return { tone: 'error', key: r.code === 'store_product_missing' ? 'store.result.productMissing' : 'store.result.unavailable' };
    default:
      if (r.code === 'store_network') return { tone: 'error', key: 'store.result.network' };
      return { tone: 'error', key: 'store.result.error', params: { message: String(r.message || r.code || '').slice(0, 200) } };
  }
}

// Moving between Pro and Enterprise in the Store means a second subscription: Microsoft does not
// switch plans. Buying Enterprise while Pro is paid is allowed (the customer then cancels Pro);
// "downgrading" would leave Enterprise renewing, so it is not offered from the app.
export function storeDowngradeBlocked({ storeOnly, isPaid, currentTier, planTier }) {
  return Boolean(storeOnly && isPaid && currentTier === 'enterprise' && planTier === 'pro');
}
