'use strict';
// Block and challenge pages a site shows instead of the real page, and what to do about them. Pure
// (no browser, DB or IPC) so every rule is unit-tested. Only the main document of a tab counts: a
// CAPTCHA widget inside a normal page (a login form with reCAPTCHA) is not a block.

// A challenge that can clear by itself (Cloudflare, DataDome) gets this long before it counts.
const GRACE_MS = 20 * 1000;
// After a vendor IP change, the time the new exit needs before the page is reloaded.
const ROTATE_SETTLE_MS = 5 * 1000;
// Loop guard: at most this many automatic proxy changes per profile per window.
const SWITCH_LIMIT = 2;
const SWITCH_WINDOW_MS = 60 * 60 * 1000;

const NOT_BLOCKED = Object.freeze({ blocked: false, kind: null, hard: false });

const GOOGLE_HOST = /(^|\.)google\.(com?\.)?[a-z]{2,3}$/;

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const want = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === want) return String(headers[key] == null ? '' : headers[key]);
  }
  return '';
}

function parseHttpUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u : null;
  } catch (e) {
    return null;
  }
}

// input: { url, status, headers, title } of a tab's main document. `hard` means the page will not
// clear by itself, so there is no grace period.
function classifyBlock(input = {}) {
  const u = parseHttpUrl(input.url);
  if (!u) return NOT_BLOCKED;
  const host = u.hostname.toLowerCase();
  const title = String(input.title || '').trim();
  const status = Number(input.status) || 0;

  if (GOOGLE_HOST.test(host) && /^\/sorry(\/|$)/i.test(u.pathname)) return { blocked: true, kind: 'googleSorry', hard: true };
  if (/\bchallenge\b/i.test(headerValue(input.headers, 'cf-mitigated'))
    || /^just a moment(\.\.\.|…)?$/i.test(title)
    || /^attention required! \| cloudflare$/i.test(title)) {
    return { blocked: true, kind: 'cloudflare', hard: false };
  }
  if (status === 403 && (headerValue(input.headers, 'x-datadome') || headerValue(input.headers, 'x-dd-b'))) {
    return { blocked: true, kind: 'datadome', hard: false };
  }
  if (/px-captcha/i.test(`${u.pathname}${u.search}`) || /^access to this page has been denied\.?$/i.test(title)) {
    return { blocked: true, kind: 'perimeterx', hard: false };
  }
  if (status === 403 && /^access denied$/i.test(title)) return { blocked: true, kind: 'accessDenied', hard: false };
  if (status === 429) return { blocked: true, kind: 'rateLimit', hard: false };
  return NOT_BLOCKED;
}

// The page to open again after a change: Google's /sorry/ page carries the search it interrupted
// in `continue`; reloading /sorry/ itself would only show the challenge again.
function retryUrlFor(url) {
  const u = parseHttpUrl(url);
  if (!u) return null;
  if (GOOGLE_HOST.test(u.hostname.toLowerCase()) && /^\/sorry(\/|$)/i.test(u.pathname)) {
    const next = parseHttpUrl(u.searchParams.get('continue'));
    if (next && GOOGLE_HOST.test(next.hostname.toLowerCase())) return next.toString();
    return `${u.protocol}//${u.host}/`;
  }
  return u.toString();
}

function siteOf(url) {
  const u = parseHttpUrl(url);
  return u ? u.hostname.toLowerCase().replace(/^www\./, '') : '';
}

// Loop guard over the times of earlier automatic changes; the caller keeps the list.
function recentSwitches(times, now, windowMs = SWITCH_WINDOW_MS) {
  return (Array.isArray(times) ? times : []).filter((t) => Number.isFinite(t) && now - t < windowMs);
}

function withinSwitchBudget(times, now, { limit = SWITCH_LIMIT, windowMs = SWITCH_WINDOW_MS } = {}) {
  return recentSwitches(times, now, windowMs).length < limit;
}

// What to try after a confirmed block, in order: 'rotate' (new IP from the vendor, same proxy) and
// 'swap' (a better spare proxy). An empty list comes with the reason nothing is tried.
// poolInUse: the session runs on a rotation-pool proxy, so changing the profile's own proxy would
// not change the next launch.
function planBlockResponse({ enabled, hasProxy, busy, withinBudget, canRotate, poolInUse } = {}) {
  if (!enabled) return { steps: [], reason: 'disabled' };
  if (!hasProxy) return { steps: [], reason: 'noProxy' };
  if (busy) return { steps: [], reason: 'busy' };
  if (!withinBudget) return { steps: [], reason: 'limit' };
  const steps = [];
  if (canRotate) steps.push('rotate');
  if (!poolInUse) steps.push('swap');
  return { steps, reason: steps.length ? null : 'proxyPool' };
}

// Scores the blocked proxy as failing: its stored health says nothing about the site that just
// refused it, and a profile that already scores 100 could otherwise never be moved.
function blockedProxyContext(ctx) {
  const c = ctx || {};
  if (!c.proxy) return c;
  return { ...c, proxy: { ...c.proxy, lastStatus: 'fail', lastError: c.proxy.lastError || 'Blocked by a site' } };
}

module.exports = {
  GRACE_MS,
  ROTATE_SETTLE_MS,
  SWITCH_LIMIT,
  SWITCH_WINDOW_MS,
  classifyBlock,
  retryUrlFor,
  siteOf,
  recentSwitches,
  withinSwitchBudget,
  planBlockResponse,
  blockedProxyContext
};
