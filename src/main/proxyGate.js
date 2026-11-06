'use strict';
// Live proxy check used by Quick generate (batchGenerateProfiles in ipcHandlers.js).
//
// A worker pool: the next proxy starts as soon as any check finishes, so one slow proxy never holds
// up a whole batch (the old lock-step batches of 8 waited for the slowest of each 8). The scan stops
// as soon as enough working proxies are found, or at once when the run is cancelled; checks still in
// flight then finish in the background and are ignored here.

// Up to this many proxies are checked at the same time.
const QUICK_CHECK_CONCURRENCY = 12;

// Per-proxy budget inside this gate only. The Proxy Pool page keeps the full check (15 s for the HTTPS
// IP services, then 15 s for the plain-HTTP fallback). A proxy that needs longer than this to answer
// an IP service is too slow to browse through anyway.
const QUICK_CHECK_TIMEOUTS = Object.freeze({ timeoutMs: 8000, fallbackTimeoutMs: 5000 });

// A proxy that passed a check in the last 30 minutes is trusted without a new one.
const FRESH_MS = 30 * 60 * 1000;

function isFreshlyVerified(proxy, now = Date.now()) {
  if (!proxy || proxy.lastStatus !== 'ok' || !proxy.lastCheckedAt) return false;
  const at = new Date(proxy.lastCheckedAt).getTime();
  return Number.isFinite(at) && now - at < FRESH_MS;
}

// Freshly verified proxies first, so they are used before any network check is needed. The order
// inside each part is kept (the caller shuffles first in unique mode).
function orderForCheck(pool, now = Date.now()) {
  const list = Array.isArray(pool) ? pool : [];
  const fresh = [];
  const stale = [];
  for (const p of list) (isFreshlyVerified(p, now) ? fresh : stale).push(p);
  return fresh.concat(stale);
}

// A check timed out inside the shortened gate budget. Such a result is not stored as the proxy's
// health: the full check on the Proxy Pool page might still pass it.
function isGateTimeout(result) {
  return Boolean(result) && !result.success && /timed out/i.test(String(result.error || ''));
}

// Checks `candidates` with `check(proxy) -> boolean | Promise<boolean>` until `limit` pass.
// Resolves { working, checked, failed, cancelled }:
//   working   - the proxies that passed, in the order they passed (at most `limit`)
//   checked   - how many checks finished before the scan stopped
//   failed    - how many of those did not pass (a check that throws counts as failed)
//   cancelled - the scan stopped because `signal` was aborted
// onProgress({ checked, total, working, failed }) is called after every finished check.
function collectWorkingProxies({ candidates, limit, check, concurrency = QUICK_CHECK_CONCURRENCY, signal = null, onProgress = null } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const want = Math.max(0, Number(limit) || 0);
  const width = Math.max(1, Number(concurrency) || 1);
  return new Promise((resolve) => {
    const working = [];
    let next = 0;
    let active = 0;
    let checked = 0;
    let failed = 0;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      if (signal) signal.removeEventListener('abort', finish);
      resolve({ working, checked, failed, cancelled: Boolean(signal && signal.aborted) });
    };
    if (signal) {
      if (signal.aborted) { finish(); return; }
      signal.addEventListener('abort', finish, { once: true });
    }

    const pump = () => {
      if (done) return;
      if (working.length >= want) { finish(); return; }
      while (active < width && next < list.length) {
        const proxy = list[next++];
        active += 1;
        Promise.resolve()
          .then(() => check(proxy))
          .then((ok) => Boolean(ok), () => false)
          .then((ok) => {
            active -= 1;
            if (done) return; // a late answer after the scan stopped
            checked += 1;
            if (ok && working.length < want) working.push(proxy);
            else if (!ok) failed += 1;
            if (onProgress) {
              try { onProgress({ checked, total: list.length, working: working.length, failed }); } catch (e) { /* a progress listener never breaks the scan */ }
            }
            pump();
          });
      }
      if (active === 0) finish(); // every candidate has been checked
    };
    pump();
  });
}

// Coalesces progress frames: at most one every `intervalMs`, except forced ones (phase changes and
// the last frame), so a large batch does not flood the renderer.
function createThrottledEmitter(send, intervalMs = 100, now = () => Date.now()) {
  let last = 0;
  return (frame, force = false) => {
    const t = now();
    if (!force && t - last < intervalMs) return;
    last = t;
    try { send(frame); } catch (e) { /* the window may be gone */ }
  };
}

module.exports = {
  QUICK_CHECK_CONCURRENCY,
  QUICK_CHECK_TIMEOUTS,
  FRESH_MS,
  isFreshlyVerified,
  orderForCheck,
  isGateTimeout,
  collectWorkingProxies,
  createThrottledEmitter
};
