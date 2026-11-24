'use strict';
// Relay entitlement token of this PC (RELAY.md "Entitlement" in the SoftGlaze-Mobile repository;
// licensing server POST /v1/mobile/entitlement, which accepts the workspace's account session).
//
// The relay asks for it in `auth` once RELAY_ENTITLEMENT_PUBKEY is set there. While the relay runs in
// grace mode a missing token is only counted, so every failure here is soft: no token is sent and the
// connection goes ahead. A workspace that never signed in to a SoftGlaze account has no session and
// sends no token (the relay checks phones only until RELAY_ENTITLEMENT_ROLES says pc,phone).
//
// - fetchToken(mailbox) -> { token, exp (unix s) }; throws (err.status 401 / 403 / 503, or offline).
// - Cached in memory until 24 h before it runs out (tokens live up to 7 days); a fresh fetch at most
//   every 10 minutes unless the relay refused the token (invalidate()).
// - After a failed fetch the next try waits 5 minutes (30 minutes after 403 no_entitlement, 1 hour
//   when signed out); a cached token that is still valid keeps being used meanwhile.

const REFRESH_BEFORE_MS = 24 * 3_600_000;
const MIN_REFETCH_MS = 10 * 60_000;
const RETRY_AFTER_FAIL_MS = 5 * 60_000;
const RETRY_AFTER_DENIED_MS = 30 * 60_000;
const RETRY_AFTER_SIGNED_OUT_MS = 60 * 60_000;
const MIN_LEFT_MS = 60_000;

function createEntitlementSource({ fetchToken, now = Date.now }) {
  let cache = null; // { mailbox, token, expMs, fetchedAt }
  let retryAt = 0;
  let inflight = null;

  const usable = (mailbox, t) => (cache && cache.mailbox === mailbox && cache.expMs - t > MIN_LEFT_MS ? cache.token : undefined);

  async function refresh(mailbox) {
    const t = now();
    try {
      const r = await fetchToken(mailbox);
      if (!r || typeof r.token !== 'string' || typeof r.exp !== 'number') {
        retryAt = t + RETRY_AFTER_FAIL_MS;
        return usable(mailbox, now());
      }
      cache = { mailbox, token: r.token, expMs: r.exp * 1000, fetchedAt: t };
      retryAt = 0;
      return usable(mailbox, now());
    } catch (e) {
      const status = e && e.status;
      if (e && e.code === 'signed_out') retryAt = t + RETRY_AFTER_SIGNED_OUT_MS;
      else retryAt = t + (status === 403 ? RETRY_AFTER_DENIED_MS : RETRY_AFTER_FAIL_MS);
      if (status === 401 || status === 403 || (e && e.code === 'signed_out')) cache = null;
      return usable(mailbox, now());
    }
  }

  return {
    // -> the token for this mailbox, or undefined. Never throws.
    async get(mailbox) {
      const t = now();
      const c = cache && cache.mailbox === mailbox ? cache : null;
      if (c && c.expMs - t > REFRESH_BEFORE_MS) return c.token;
      if (c && t - c.fetchedAt < MIN_REFETCH_MS && c.expMs - t > MIN_LEFT_MS) return c.token;
      if (t < retryAt) return usable(mailbox, t);
      if (!inflight) inflight = refresh(mailbox).finally(() => { inflight = null; });
      return inflight;
    },
    // Forget the cached token (the relay refused it, or the account changed). The next get() fetches again.
    invalidate() {
      cache = null;
      retryAt = 0;
    }
  };
}

module.exports = { createEntitlementSource };
