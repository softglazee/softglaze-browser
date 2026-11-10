// What the Quick generate modal shows for a progress frame from main (batchGenerateHandler):
//   { phase: 'check', checked, total, working, failed, needed }   live proxy check
//   { phase: 'create', done, created, toCreate, requested, failed } profile creation
//   { phase: 'done', created, requested, cancelled }                the run ended
// Pure and framework-free so node:test can exercise it.
//
// Returns { phase: 'start' | 'check' | 'create', checked, total, working, done, percent, shortfall }.
// shortfall is { requested, available } when fewer working proxies were found than profiles asked
// for (one unique proxy per profile), so the modal can say "80 requested, only 61 working proxies".
export function quickGenProgressView(frame, { requested = 0, uniqueProxies = false } = {}) {
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
  const base = { phase: 'start', checked: 0, total: num(requested), working: 0, done: 0, percent: 0, shortfall: null };
  if (!frame || typeof frame !== 'object') return base;

  if (frame.phase === 'check') {
    const checked = num(frame.checked);
    const total = num(frame.total);
    const working = num(frame.working);
    const needed = num(frame.needed);
    // The scan also ends early once enough proxies work, so whichever is further along counts.
    const percent = Math.max(pct(checked, total), pct(working, needed));
    return { ...base, phase: 'check', checked, total, working, percent };
  }

  if (frame.phase === 'create') {
    const toCreate = num(frame.toCreate);
    const asked = num(frame.requested) || num(requested);
    const done = num(frame.done);
    const shortfall = uniqueProxies && toCreate < asked ? { requested: asked, available: toCreate } : null;
    return { ...base, phase: 'create', total: toCreate, done, percent: pct(done, toCreate), shortfall };
  }

  if (frame.phase === 'done') {
    const created = num(frame.created);
    return { ...base, phase: 'create', total: num(frame.requested) || created, done: created, percent: 100 };
  }

  return base;
}

// The names Quick generate gives its profiles: `<base>-<number>`, numbered from `start` and padded with
// zeros to the width of the last number (3 profiles: -1 to -3; 12: -01 to -12; 100: -001 to -100).
// main names them with the same rule (ipcHandlers.js batchGenerateProfiles; test/permissionsRound5.test.js
// keeps the two equal), so the preview shows the names that will be created.
export function quickGenNumber(start, index, count) {
  const first = Number.isFinite(Number(start)) ? Math.max(0, Math.floor(Number(start))) : 1;
  const n = Number.isFinite(Number(count)) && Number(count) >= 1 ? Math.floor(Number(count)) : 1;
  const width = String(first + n - 1).length;
  return String(first + index).padStart(width, '0');
}

// ---- How many profiles a run will create (main: ipcHandlers.js batchGenerateProfiles) ----
// main pads the numbers to the count it actually creates, not the count asked for: 10 asked with 9 usable
// proxies gives -1 to -9. The preview therefore numbers with quickGenPlannedCount(), and
// test/permissionsRound7.test.js runs main's function to keep the two equal.

// The pasted proxy lines main can use (paste mode): distinct non-empty lines, without socks4:// and
// socks4a:// lines (Chromium cannot use SOCKS4 without a DNS leak; Quick generate sends no proxy type).
export function quickGenPastedLines(text) {
  const lines = [...new Set(String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
  return lines.filter((s) => !/^socks4a?:\/\//i.test(s));
}

const QUICK_GEN_PROXY_TYPES = new Set(['HTTP', 'SOCKS5']); // main's CHROMIUM_PROXY_TYPES
const QUICK_GEN_FAST_MAX_MS = 2000; // main's Fast / Slow line

// The proxies of the window's list that main can give a profile of its own (one proxy per profile):
// HTTP or SOCKS5, the chosen source ('' the paid pool, 'group:<id>', 'provider:<key>'; free proxies only
// when they passed their last check), the speed and blocklist filters on their stored results, and no
// profile using them as far as this member can see. main then checks the stale ones live, so it can end
// up with fewer; it reports the number before it creates the first profile (the 'create' frame).
export function quickGenUniqueCandidates(proxies, { source = '', speed = 'any', blacklist = 'any', free = false } = {}) {
  const src = String(source || '');
  return (Array.isArray(proxies) ? proxies : []).filter((p) => {
    if (!p || !QUICK_GEN_PROXY_TYPES.has(String(p.type || '').toUpperCase())) return false;
    if (Number(p.profileCount) > 0) return false;
    if (free) return p.lastStatus === 'ok';
    if (src.startsWith('group:') && String(p.proxyGroupId ?? '') !== src.slice(6)) return false;
    if (src.startsWith('provider:') && String(p.provider || '').toLowerCase() !== src.slice(9).toLowerCase()) return false;
    const ok = p.lastStatus === 'ok';
    const ms = typeof p.lastLatencyMs === 'number' ? p.lastLatencyMs : null;
    if (speed === 'fast' && !(ok && ms != null && ms <= QUICK_GEN_FAST_MAX_MS)) return false;
    if (speed === 'slow' && !(ok && ms != null && ms > QUICK_GEN_FAST_MAX_MS)) return false;
    if (blacklist === 'clean' && !(ok && p.lastBlacklisted === false)) return false;
    if (blacklist === 'blacklisted' && !(ok && p.lastBlacklisted === true)) return false;
    return true;
  });
}

// The number of profiles main will create, for the preview's names. `count` is the number asked for.
// `available` is how many proxies main can use when each profile needs its own (one per profile, or the
// pasted lines), null when that does not limit the run (no proxy, or pool proxies shared round-robin).
// `toCreate` is main's own number from its 'create' progress frame; once known it wins. With nothing
// available main creates nothing and says why, so the preview keeps the names asked for.
export function quickGenPlannedCount({ count, available = null, toCreate = null } = {}) {
  const asked = Number.isFinite(Number(count)) && Number(count) >= 1 ? Math.floor(Number(count)) : 1;
  if (toCreate != null && Number.isFinite(Number(toCreate)) && Number(toCreate) >= 1) return Math.floor(Number(toCreate));
  if (available == null || !Number.isFinite(Number(available)) || Number(available) < 1) return asked;
  return Math.min(asked, Math.floor(Number(available)));
}
