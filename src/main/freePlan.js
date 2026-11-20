'use strict';
// The Free forever plan (1.0.27). Pure: no Electron, database or globals, so node:test covers it; ipcHandlers.js
// reads the settings, calls these and enforces the result.
//
//                         Free        Pro        Enterprise
//   profiles saved          25        unlimited  unlimited
//   profiles running         1        (no app cap; parallel runs 3 / 10)
//   seats (team members)     1        3          25
//   PCs per account          1        3          10   (the licensing server binds; shown here only)
//   AI / MCP actions        25 a day  unlimited  unlimited
//   cloud sync              no        yes        yes
//   phone / web             view + approve AI requests (no open or stop)
//   partner deals card      shown     hidden     hidden
//
// Nobody is locked out when a trial or a paid term ends: the workspace drops to Free. Only a licence the
// server says was revoked or refunded, or one bound to another computer, still locks.

const FREE_LIMITS = Object.freeze({
  tier: 'free',
  seats: 1,
  maxParallel: 1,
  auditExport: false,
  profiles: 25,
  devices: 1,
  aiActionsPerDay: 25,
  sync: false,
  phoneControl: false,
  partnerDeals: true
});

const PLAN_LIMIT_CODE = 'PLAN_LIMIT';

// Server limits (POST /v1/license `limits`, GET /v1/plans/public) over the built-in Free limits. Only known keys
// with a sane value are taken, so a broken answer can never loosen Free beyond what the server says.
function normalizeFreeLimits(raw) {
  const out = { ...FREE_LIMITS };
  if (!raw || typeof raw !== 'object') return out;
  const int = (v, min, max) => (Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : null);
  const seats = int(raw.seats, 1, 10000); if (seats != null) out.seats = seats;
  const maxParallel = int(raw.maxParallel, 1, 100); if (maxParallel != null) out.maxParallel = maxParallel;
  const profiles = int(raw.profiles, 0, 1000000); if (profiles != null) out.profiles = profiles;
  const devices = int(raw.devices, 1, 1000); if (devices != null) out.devices = devices;
  const ai = int(raw.aiActionsPerDay, 0, 1000000); if (ai != null) out.aiActionsPerDay = ai;
  for (const k of ['sync', 'phoneControl', 'partnerDeals', 'auditExport']) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  return out;
}

// The licence view for Free (the same fields every other view has, so the renderer needs no special case to
// read it). endedFrom: 'trial' | 'paid' | null says what the workspace came down from (the day 8 screen).
function freeView({ limits = null, endedFrom = null, endedAt = null, clockTamper = false, plan = null, trialUsed = true } = {}) {
  return {
    type: 'free',
    tier: 'free',
    state: 'free',
    status: 'active',
    endsAt: null,
    graceEndsAt: null,
    daysLeft: null,
    daysLeftTrial: null,
    daysLeftGrace: null,
    isExpired: false,
    isTrial: false,
    isPaid: false,
    isGrace: false,
    isBanned: false,
    isFree: true,
    isExempt: false,
    adminBlocked: false,
    needsPlan: false,
    clockTamper: Boolean(clockTamper),
    purchaseCode: null,
    trialUsed: Boolean(trialUsed),
    endedFrom: endedFrom === 'trial' || endedFrom === 'paid' ? endedFrom : null,
    endedAt: endedAt || null,
    freeLimits: normalizeFreeLimits(limits),
    plan
  };
}

// A licence that the server says was revoked or refunded stays locked (no Free).
function lockedView({ lockReason, clockTamper = false, plan = null } = {}) {
  return {
    type: 'none',
    tier: 'pro',
    state: 'banned',
    status: 'banned',
    endsAt: null,
    graceEndsAt: null,
    daysLeft: null,
    daysLeftTrial: null,
    daysLeftGrace: null,
    isExpired: true,
    isTrial: false,
    isPaid: false,
    isGrace: false,
    isBanned: true,
    isFree: false,
    adminBlocked: false,
    needsPlan: false,
    lockReason: lockReason === 'refunded' ? 'refunded' : 'revoked',
    clockTamper: Boolean(clockTamper),
    purchaseCode: null,
    trialUsed: true,
    plan
  };
}

// What the server last said about Free for this install (stored in Setting 'freePlanState'):
// { free, lockReason, limits, at }. Returns the lock reason to honour, or null.
function lockReasonOf(state) {
  if (!state || typeof state !== 'object') return null;
  return state.lockReason === 'revoked' || state.lockReason === 'refunded' ? state.lockReason : null;
}

// The stored server answer from a POST /v1/license response without a lease.
function stateFromServer(res, nowMs = Date.now()) {
  const r = res && typeof res === 'object' ? res : {};
  const lockReason = r.lockReason === 'revoked' || r.lockReason === 'refunded' ? r.lockReason : null;
  return {
    free: lockReason ? false : r.free !== false,
    lockReason,
    limits: r.limits && typeof r.limits === 'object' ? normalizeFreeLimits(r.limits) : null,
    usageFlags: Array.isArray(r.usageFlags) ? r.usageFlags.filter((f) => typeof f === 'string').slice(0, 10) : [],
    at: nowMs
  };
}

// The refusal for a limit, with what the upgrade prompt needs. kind: profiles | running | seats | ai | sync | phone
// | import.
function planLimitError(kind, { limit = null, used = null } = {}) {
  const TEXT = {
    profiles: `The Free plan keeps up to ${limit} profiles. Upgrade to Pro for unlimited profiles.`,
    running: `The Free plan runs ${limit} profile at a time. Close the open profile or upgrade to Pro to run more at once.`,
    openable: `On the Free plan you can open ${limit} of your profiles. Choose which ones, or upgrade to Pro to open them all.`,
    seats: 'The Free plan is for one person. Upgrade to Pro to add team members.',
    ai: `The Free plan includes ${limit} AI actions a day, and today's are used. They reset tomorrow, or upgrade to Pro for unlimited AI actions.`,
    sync: 'Cloud sync is part of Pro. Upgrade to sync your profiles between computers.',
    phone: 'Opening and stopping profiles from your phone or the web app is part of Pro. On Free you can view profiles and approve AI requests.'
  };
  const e = new Error(TEXT[kind] || 'This is part of Pro. Upgrade to use it.');
  e.code = PLAN_LIMIT_CODE;
  e.planLimit = { kind, limit, used };
  return e;
}

// Can `want` more profiles be saved? -> { allowed, remaining }. limit null = unlimited.
function profileCapacity({ limit, used, want = 1 }) {
  if (limit == null) return { allowed: true, remaining: null };
  const remaining = Math.max(0, Number(limit) - Math.max(0, Number(used) || 0));
  return { allowed: remaining >= Math.max(1, Number(want) || 1), remaining };
}

// The local day an AI action counts against ("YYYY-MM-DD" in the computer's own time zone).
function dayKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The AI action counter. state: { day, count } (Setting 'aiActionsToday'). -> { allowed, next, used, limit }.
// limit null = unlimited (still counted, so the server's daily check sees real use).
function takeAiAction(state, { limit, nowMs = Date.now() } = {}) {
  const day = dayKey(nowMs);
  const cur = state && state.day === day ? Math.max(0, Number(state.count) || 0) : 0;
  if (limit != null && cur >= Number(limit)) return { allowed: false, next: { day, count: cur }, used: cur, limit: Number(limit) };
  return { allowed: true, next: { day, count: cur + 1 }, used: cur + 1, limit: limit == null ? null : Number(limit) };
}

function aiActionsUsed(state, nowMs = Date.now()) {
  return state && state.day === dayKey(nowMs) ? Math.max(0, Number(state.count) || 0) : 0;
}

// Coming down from Pro with more profiles than Free keeps: every profile stays, but only `limit` of them open,
// and the user chooses which (Setting 'freeOpenableProfiles'). With no more profiles than the limit, all open.
// -> { allowed, needsChoice }.
function canOpenProfile({ profileId, profileIds, chosen, limit }) {
  const ids = Array.isArray(profileIds) ? profileIds.map(Number) : [];
  if (limit == null || ids.length <= Number(limit)) return { allowed: true, needsChoice: false };
  const picked = chosenOpenable(chosen, ids, limit);
  if (!picked.length) return { allowed: false, needsChoice: true };
  return { allowed: picked.includes(Number(profileId)), needsChoice: false };
}

// The saved choice, cleaned: only profiles that still exist, at most `limit`.
function chosenOpenable(chosen, profileIds, limit) {
  const exists = new Set((Array.isArray(profileIds) ? profileIds : []).map(Number));
  const out = [];
  for (const v of Array.isArray(chosen) ? chosen : []) {
    const n = Number(v);
    if (Number.isInteger(n) && exists.has(n) && !out.includes(n)) out.push(n);
    if (limit != null && out.length >= Number(limit)) break;
  }
  return out;
}

// The day 8 screen ("You are on Free now"): once, after a trial (or a paid term) ended into Free.
function shouldShowFreeWelcome(view, seen) {
  return Boolean(view && view.type === 'free' && view.endedFrom && !seen);
}

module.exports = {
  FREE_LIMITS,
  PLAN_LIMIT_CODE,
  normalizeFreeLimits,
  freeView,
  lockedView,
  lockReasonOf,
  stateFromServer,
  planLimitError,
  profileCapacity,
  dayKey,
  takeAiAction,
  aiActionsUsed,
  canOpenProfile,
  chosenOpenable,
  shouldShowFreeWelcome
};
