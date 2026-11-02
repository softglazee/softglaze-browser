'use strict';
// Warm-up autopilot: which profiles to warm and when, from plain data so it can be unit-tested.
// A profile is due once its last warm-up is older than a day divided by the runs per day.
// ipcHandlers supplies the profile rows, the stats and the profiles other tasks are using, and runs
// each warm-up through the Cookie Warmer.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// A failed warm-up (dead proxy, launch error) waits this long before the next try, so one broken
// profile is not relaunched every tick.
const RETRY_MS = HOUR_MS;

const DEFAULTS = Object.freeze({
  enabled: false, target: 'all', groupId: null, runsPerDay: 2, sitesPerRun: 4,
  startHour: 9, endHour: 22, headless: true, maxConcurrent: 1, ownerMemberId: null
});

// [min, max]. The end hour is exclusive, so 24 means "until midnight".
const LIMITS = Object.freeze({
  runsPerDay: [1, 6], sitesPerRun: [2, 10], maxConcurrent: [1, 4], startHour: [0, 23], endHour: [1, 24]
});

function clampInt(value, [min, max], fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// A stored or submitted config with every field clamped; missing or invalid fields take the default.
function normalizeConfig(input) {
  const src = input && typeof input === 'object' ? input : {};
  const target = src.target === 'group' ? 'group' : 'all';
  const groupId = Number.parseInt(src.groupId, 10);
  const owner = Number.parseInt(src.ownerMemberId, 10);
  return {
    enabled: src.enabled === true,
    target,
    groupId: target === 'group' && Number.isInteger(groupId) && groupId > 0 ? groupId : null,
    runsPerDay: clampInt(src.runsPerDay, LIMITS.runsPerDay, DEFAULTS.runsPerDay),
    sitesPerRun: clampInt(src.sitesPerRun, LIMITS.sitesPerRun, DEFAULTS.sitesPerRun),
    startHour: clampInt(src.startHour, LIMITS.startHour, DEFAULTS.startHour),
    endHour: clampInt(src.endHour, LIMITS.endHour, DEFAULTS.endHour),
    headless: typeof src.headless === 'boolean' ? src.headless : DEFAULTS.headless,
    maxConcurrent: clampInt(src.maxConcurrent, LIMITS.maxConcurrent, DEFAULTS.maxConcurrent),
    ownerMemberId: Number.isInteger(owner) ? owner : null
  };
}

// What keeps a config from being saved, or null.
function configProblem(cfg) {
  if (cfg.target === 'group' && !cfg.groupId) return 'group-required';
  return null;
}

// Whether a local hour is inside the active hours. An end before the start wraps past midnight;
// equal hours mean all day.
function inWindow(hour, cfg) {
  const s = cfg.startHour;
  const e = cfg.endHour;
  if (s === e) return true;
  return s < e ? hour >= s && hour < e : hour >= s || hour < e;
}

// The first moment at or after `t` that is inside the active hours.
function nextInWindow(t, cfg) {
  if (inWindow(new Date(t).getHours(), cfg)) return t;
  const d = new Date(t);
  d.setMinutes(0, 0, 0);
  for (let i = 0; i < 25; i++) {
    d.setHours(d.getHours() + 1);
    if (inWindow(d.getHours(), cfg)) return d.getTime();
  }
  return null;
}

function intervalMs(runsPerDay) {
  return DAY_MS / Math.max(1, Number(runsPerDay) || 1);
}

function lastWarmAt(stat) {
  if (!stat || stat.lastAt == null) return null;
  const t = typeof stat.lastAt === 'number' ? stat.lastAt : Date.parse(stat.lastAt);
  return Number.isFinite(t) ? t : null;
}

// When a profile next needs a warm-up: at once if it was never warmed.
function dueAt(stat, runsPerDay, now) {
  const last = lastWarmAt(stat);
  return last == null ? now : last + intervalMs(runsPerDay);
}

// Rows the autopilot covers: not in the trash, and in the chosen group when it targets one.
function targetRows(rows, cfg) {
  return (rows || []).filter((r) => r && !r.deletedAt && (cfg.target !== 'group' || Number(r.groupId) === cfg.groupId));
}

// Profiles to warm now, least recently warmed first (never warmed counts as oldest), at most `slots`.
// busy: ids that are open, launching, locked or in another warm-up, macro or parallel run.
// retryAt: id -> time before which a failed profile is not tried again.
function pickDue(rows, { cfg, stats = {}, now, hour, busy = new Set(), retryAt = new Map(), slots = 1 }) {
  if (!cfg.enabled || slots <= 0) return [];
  const h = hour == null ? new Date(now).getHours() : hour;
  if (!inWindow(h, cfg)) return [];
  const due = [];
  for (const r of targetRows(rows, cfg)) {
    const id = Number(r.id);
    if (busy.has(id)) continue;
    if ((retryAt.get(id) || 0) > now) continue;
    const stat = stats[id];
    if (dueAt(stat, cfg.runsPerDay, now) > now) continue;
    const last = lastWarmAt(stat);
    due.push({ id, last: last == null ? -Infinity : last });
  }
  due.sort((a, b) => a.last - b.last || a.id - b.id);
  return due.slice(0, slots).map((d) => d.id);
}

// When the autopilot will next start a warm-up, or null when it is off or has no profiles.
function nextRunAt(rows, { cfg, stats = {}, now, retryAt = new Map() }) {
  if (!cfg.enabled) return null;
  let earliest = Infinity;
  for (const r of targetRows(rows, cfg)) {
    const id = Number(r.id);
    earliest = Math.min(earliest, Math.max(dueAt(stats[id], cfg.runsPerDay, now), retryAt.get(id) || 0));
  }
  if (!Number.isFinite(earliest)) return null;
  return nextInWindow(Math.max(earliest, now), cfg);
}

// Stats after one more successful warm-up of a profile.
function withWarmRun(stats, profileId, at) {
  const key = String(profileId);
  const base = stats && typeof stats === 'object' && !Array.isArray(stats) ? stats : {};
  const prev = base[key] || {};
  return { ...base, [key]: { runs: (Number(prev.runs) || 0) + 1, lastAt: new Date(at).toISOString() } };
}

// How many of these profiles had their last warm-up today (local time).
function warmedToday(stats, ids, now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  let n = 0;
  for (const id of ids || []) {
    const t = lastWarmAt(stats && stats[id]);
    if (t != null && t >= start.getTime()) n += 1;
  }
  return n;
}

// `count` random sites from `sites`, each with a varied dwell time so visits do not keep one rhythm.
function pickSites(sites, count, rng = Math.random) {
  const pool = [...(sites || [])];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, count)).map((s) => ({ ...s, seconds: 20 + Math.floor(rng() * 26) }));
}

module.exports = {
  DEFAULTS, LIMITS, RETRY_MS, DAY_MS,
  normalizeConfig, configProblem, inWindow, nextInWindow, intervalMs, dueAt, pickDue, nextRunAt,
  withWarmRun, warmedToday, pickSites
};
