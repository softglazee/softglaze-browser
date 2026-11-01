// One definition of a proxy's health, speed and blocklist state, used by every filter, count, badge
// and sort. A fresh check result wins over the stored snapshot. Plain module so tests can import it.

export const SPEED_FAST_MAX_MS = 1500;

export function proxyHealthOf(p, checkResults = {}) {
  const r = checkResults[p.id];
  if (r) return r.success ? 'verified' : 'failed';
  if (p.lastStatus === 'ok') return 'verified';
  if (p.lastStatus === 'fail') return 'failed';
  return 'unknown';
}

// The measured time of the IP check, the same number every kind of check records and saves, so a
// proxy shows the same value live and after a reload. A failed proxy has no speed: the time it took
// to fail says nothing (a server name that does not exist fails in 30 ms, which would read as fast).
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
