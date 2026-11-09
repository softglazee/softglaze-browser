// One definition of a proxy's health, speed and blocklist state, used by every filter, count, badge
// and sort. A fresh check result wins over the stored snapshot. Plain module so tests can import it.

// Live residential proxies measured a median of 1499 ms, so a line at 1500 ms flipped 29 of 66 of them
// between checks. 2000 ms sits clear of that.
export const SPEED_FAST_MAX_MS = 2000;

export function proxyHealthOf(p, checkResults = {}) {
  const r = checkResults[p.id];
  if (r) return r.success ? 'verified' : 'failed';
  if (p.lastStatus === 'ok') return 'verified';
  if (p.lastStatus === 'fail') return 'failed';
  return 'unknown';
}

// The saved speed (the median of the proxy's recent passing checks), the same number every kind of
// check returns and stores, so a proxy shows the same value live and after a reload. A failed proxy
// has no speed: a server name that does not exist fails in 30 ms, which would read as fast.
export function measuredMs(p, checkResults = {}) {
  if (proxyHealthOf(p, checkResults) !== 'verified') return null;
  const r = checkResults[p.id];
  if (r && typeof r.latencyMs === 'number') return r.latencyMs;
  return typeof p.lastLatencyMs === 'number' ? p.lastLatencyMs : null;
}

export function speedOf(p, checkResults = {}) {
  const ms = measuredMs(p, checkResults);
  if (ms == null) return 'unknown';
  return ms <= SPEED_FAST_MAX_MS ? 'fast' : 'slow';
}

// A failed proxy is neither clean nor blacklisted right now: nothing could be checked through it.
export function blacklistOf(p, checkResults = {}) {
  if (proxyHealthOf(p, checkResults) === 'failed') return 'unknown';
  const r = checkResults[p.id];
  if (r && r.blacklist && r.blacklist.checked) return r.blacklist.listed ? 'blacklisted' : 'clean';
  if (typeof p.lastBlacklisted === 'boolean') return p.lastBlacklisted ? 'blacklisted' : 'clean';
  return 'unknown';
}

// True when this session's check found the exit IP only on Spamhaus's PBL: a residential or dynamic
// range, which is normal for residential proxies and not a spam listing. It counts as clean in every
// filter and count; the badge just says why. A real listing wins (worst result shown). Only a fresh
// check knows this: the saved snapshot keeps listed or not, nothing more.
export function residentialOf(p, checkResults = {}) {
  if (blacklistOf(p, checkResults) !== 'clean') return false;
  const r = checkResults[p.id];
  return !!(r && r.blacklist && r.blacklist.checked && r.blacklist.residential);
}

// Fastest or slowest first. Anything without a measured speed always goes last.
export function sortByLatency(list, checkResults = {}, slowestFirst = false) {
  const value = (p) => measuredMs(p, checkResults);
  return list.slice().sort((a, b) => {
    const la = value(a);
    const lb = value(b);
    if (la == null && lb == null) return 0;
    if (la == null) return 1;
    if (lb == null) return -1;
    return slowestFirst ? lb - la : la - lb;
  });
}

export function countBuckets(list, checkResults = {}) {
  const c = { verified: 0, failed: 0, unknown: 0, fast: 0, slow: 0, clean: 0, blacklisted: 0 };
  for (const p of list) {
    c[proxyHealthOf(p, checkResults)] += 1;
    const s = speedOf(p, checkResults);
    if (s !== 'unknown') c[s] += 1;
    const b = blacklistOf(p, checkResults);
    if (b !== 'unknown') c[b] += 1;
  }
  return c;
}
