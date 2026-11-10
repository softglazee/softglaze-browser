'use strict';
// Vendor scoreboard: how each proxy vendor's proxies really behave, from this workspace's own
// checks: the health events of the last 7 days, the last check stored on each proxy, and the
// sites that blocked a proxy. Pure, so the handler only loads rows and this module aggregates.

const { ipTypeOf } = require('./captchaScore');
const { medianMs } = require('./proxyVendorUtils');

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 7;
const WINDOW_MS = WINDOW_DAYS * DAY_MS;
// Below this many checks in the window a success rate says little, so the row is not scored.
const MIN_CHECKS = 10;
const TOP_SITES = 3;

// Group keys. Hand-added proxies have no vendor tag or a generic one.
const OWN_KEY = 'own';
const FREE_KEY = 'free';
const OWN_TAGS = new Set(['', 'own', 'custom', 'manual']);

// Score = 100 x sum(weight x part) / sum(weight), over the parts that have data:
//   success  checks passed / checks in the window
//   clean    1 - share of proxies on a DNS blocklist (proxies with a blocklist result only)
//   speed    1 at a median of FAST_MS or less, 0 at SLOW_MS or more, straight line between;
//            0 when checks ran and none passed
//   blocks   1 - blocks per proxy in the window, floored at 0
const WEIGHTS = Object.freeze({ success: 40, clean: 30, speed: 20, blocks: 10 });
const FAST_MS = 500;
const SLOW_MS = 3000;

function groupKeyOf(provider) {
  const tag = String(provider == null ? '' : provider).trim().toLowerCase();
  if (tag === FREE_KEY) return FREE_KEY;
  return OWN_TAGS.has(tag) ? OWN_KEY : tag;
}

function kindOf(key) {
  if (key === OWN_KEY) return 'own';
  if (key === FREE_KEY) return 'free';
  return 'vendor';
}

function toMs(value) {
  if (value == null || value === '') return NaN;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

// A 'proxy.blocked' activity row -> { proxyId, site, ts }, or null when it names no proxy.
function parseBlock(row) {
  if (!row) return null;
  let d = row.detail;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch (e) { return null; }
  }
  if (!d || typeof d !== 'object') return null;
  const proxyId = Number(d.proxyId);
  if (!Number.isInteger(proxyId) || proxyId <= 0) return null;
  const site = typeof d.site === 'string' ? d.site.trim().toLowerCase().slice(0, 120) : '';
  return { proxyId, site, ts: toMs(row.createdAt != null ? row.createdAt : row.ts) };
}

function speedPart(medianLatency) {
  if (medianLatency == null) return null;
  if (medianLatency <= FAST_MS) return 1;
  if (medianLatency >= SLOW_MS) return 0;
  return (SLOW_MS - medianLatency) / (SLOW_MS - FAST_MS);
}

function scoreOf(parts) {
  let got = 0;
  let max = 0;
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    if (parts[name] == null) continue;
    got += weight * parts[name];
    max += weight;
  }
  return max ? Math.round((got / max) * 100) : null;
}

function levelOf(score) {
  if (score == null) return null;
  if (score >= 80) return 'good';
  if (score >= 60) return 'fair';
  return 'poor';
}

// A connector names each pulled proxy "<Vendor> • <details>": the part before the first " • " names a
// tag no connector has any more (a removed provider), so its row does not show the bare tag.
function pulledVendorName(proxyName) {
  const s = String(proxyName == null ? '' : proxyName);
  const at = s.indexOf(' • ');
  return at > 0 ? s.slice(0, at).trim() : '';
}

function emptyGroup(key) {
  return {
    key, pulledName: '', proxies: 0, checked: 0, working: 0, dnsbl: 0, listed: 0, typed: 0, datacenter: 0,
    lastCheckedAt: -Infinity, checks: 0, passed: 0, latencies: [], blocks: 0, sites: new Map()
  };
}

function finishGroup(g, vendors) {
  const median = medianMs(g.latencies);
  const blocksPerProxy = g.proxies ? g.blocks / g.proxies : 0;
  const enoughData = g.checks >= MIN_CHECKS;
  const parts = {
    success: g.checks ? g.passed / g.checks : null,
    clean: g.dnsbl ? 1 - g.listed / g.dnsbl : null,
    speed: g.passed ? speedPart(median) : (g.checks ? 0 : null),
    blocks: 1 - Math.min(1, blocksPerProxy)
  };
  const score = enoughData ? scoreOf(parts) : null;
  const topSites = [...g.sites.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_SITES)
    .map(([site, count]) => ({ site, count }));
  const kind = kindOf(g.key);
  return {
    key: g.key,
    kind,
    name: kind === 'vendor' ? (vendors[g.key] || g.pulledName || g.key) : null,
    proxies: g.proxies,
    checked: g.checked,
    workingPct: pct(g.working, g.checked),
    checks: g.checks,
    successPct: pct(g.passed, g.checks),
    medianMs: median,
    blocklistedPct: pct(g.listed, g.dnsbl),
    datacenterPct: pct(g.datacenter, g.typed),
    blocks: g.blocks,
    blocksPerProxy: Math.round(blocksPerProxy * 100) / 100,
    topSites,
    lastCheckedAt: Number.isFinite(g.lastCheckedAt) ? new Date(g.lastCheckedAt).toISOString() : null,
    enoughData,
    score,
    level: levelOf(score)
  };
}

// Scored rows first, best score first; then rows without enough data, most checks first.
function compareRows(a, b) {
  if ((a.score == null) !== (b.score == null)) return a.score == null ? 1 : -1;
  if (a.score != null && a.score !== b.score) return b.score - a.score;
  return b.checks - a.checks || b.proxies - a.proxies || String(a.name || a.key).localeCompare(String(b.name || b.key));
}

// proxies: Proxy rows; events: ProxyHealthEvent rows; blocks: 'proxy.blocked' ActivityLog rows;
// vendors: { key: display name }. Events and blocks of proxies not in `proxies` are ignored, so
// passing a member's scoped proxy list scopes the whole board.
function buildScoreboard({ proxies = [], events = [], blocks = [], now = Date.now(), vendors = {} } = {}) {
  const since = now - WINDOW_MS;
  const groups = new Map();
  const groupOf = new Map();

  for (const p of proxies) {
    if (!p || p.id == null) continue;
    const key = groupKeyOf(p.provider);
    let g = groups.get(key);
    if (!g) { g = emptyGroup(key); groups.set(key, g); }
    groupOf.set(p.id, g);
    g.proxies += 1;
    if (!g.pulledName) g.pulledName = pulledVendorName(p.name);
    if (p.lastStatus === 'ok' || p.lastStatus === 'fail') {
      g.checked += 1;
      if (p.lastStatus === 'ok') g.working += 1;
    }
    if (p.lastBlacklisted === true || p.lastBlacklisted === false) {
      g.dnsbl += 1;
      if (p.lastBlacklisted) g.listed += 1;
    }
    const type = ipTypeOf(p);
    if (type) {
      g.typed += 1;
      if (type === 'datacenter') g.datacenter += 1;
    }
    const at = toMs(p.lastCheckedAt);
    if (Number.isFinite(at) && at > g.lastCheckedAt) g.lastCheckedAt = at;
  }

  for (const e of events) {
    const g = e ? groupOf.get(e.proxyId) : null;
    if (!g || !(toMs(e.ts) >= since)) continue;
    g.checks += 1;
    if (e.status !== 'ok') continue;
    g.passed += 1;
    if (typeof e.latencyMs === 'number' && Number.isFinite(e.latencyMs)) g.latencies.push(e.latencyMs);
  }

  for (const row of blocks) {
    const b = parseBlock(row);
    const g = b ? groupOf.get(b.proxyId) : null;
    if (!g || !(b.ts >= since)) continue;
    g.blocks += 1;
    if (b.site) g.sites.set(b.site, (g.sites.get(b.site) || 0) + 1);
  }

  const rows = [...groups.values()].map((g) => finishGroup(g, vendors || {}));
  rows.sort(compareRows);
  return { windowDays: WINDOW_DAYS, minChecks: MIN_CHECKS, generatedAt: new Date(now).toISOString(), rows };
}

module.exports = {
  buildScoreboard, groupKeyOf, parseBlock, scoreOf, speedPart, levelOf,
  WINDOW_DAYS, WINDOW_MS, MIN_CHECKS, WEIGHTS, FAST_MS, SLOW_MS, OWN_KEY, FREE_KEY
};
