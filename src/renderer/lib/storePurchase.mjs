// Microsoft Store purchases in the Store build: what the Billing page and the sign-in gate say and do
// with a result from store:purchase / store:restore (src/main/storeCommerce.js). Pure, so it is tested
// without a window. Prices always come from the Store product (store:status), never from this file.

export const STORE_METHOD_ID = 'microsoft_store';
// Where a customer manages or cancels a Microsoft subscription.
export const MANAGE_SUBSCRIPTIONS_URL = 'https://account.microsoft.com/services';
// "Waiting for confirmation" re-checks every 5 seconds for at most 2 minutes.
export const STORE_POLL = Object.freeze({ everyMs: 5000, maxTries: 24 });

export function isStoreMethod(method) {
  return Boolean(method && method.kind === 'store');
}

// The Store's own price text for a plan ("$4.99", "PKR 1,399.00"), or null when the Store has none.
export function storePrice(storeInfo, planId) {
  const p = storeInfo && storeInfo.available && storeInfo.plans ? storeInfo.plans[planId] : null;
  return p && p.available && p.price && p.price.formatted ? p.price.formatted : null;
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
