'use strict';
// Pure team helpers (seats, audit-log CSV export, profile locks): no Electron, DB or globals.
// ipcHandlers.js injects the live members, license and session data.

const tierPolicy = require('./tierPolicy');

// Seats derive from the licence type and tier (tierPolicy.js); there is no DB column for them.
// Trial 3, Pro 3, Enterprise 25; a missing or unknown licence gets 3.
function seatsForLicense(license) {
  return tierPolicy.limitsForLicense(license).seats;
}

function notSuspended(m) {
  return String((m && m.status) || 'active').toLowerCase() !== 'suspended';
}

// Ids of non-suspended members that use a seat in the owner's subtree (the owner is seat 1).
// ownerId == null counts every non-suspended member (single-owner install).
function activeSeatIds(members, ownerId) {
  const list = Array.isArray(members) ? members : [];
  if (ownerId == null) return new Set(list.filter(notSuspended).map((m) => m.id));

  // Build owner subtree (owner + all descendants).
  const childrenOf = new Map();
  for (const m of list) {
    const p = m.parentMemberId == null ? null : Number(m.parentMemberId);
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(m.id);
  }
  const inTree = new Set([Number(ownerId)]);
  const stack = [...(childrenOf.get(Number(ownerId)) || [])];
  while (stack.length) {
    const id = stack.pop();
    if (inTree.has(id)) continue;
    inTree.add(id);
    for (const c of (childrenOf.get(id) || [])) stack.push(c);
  }

  const byId = new Map(list.map((m) => [m.id, m]));
  const out = new Set();
  for (const id of inTree) {
    const m = byId.get(id);
    if (m && notSuspended(m)) out.add(id);
  }
  return out;
}

function seatUsage(members, ownerId, license) {
  const total = seatsForLicense(license);
  const used = activeSeatIds(members, ownerId).size;
  return {
    used,
    total,
    type: String((license && license.type) || 'trial').toLowerCase(),
    tier: tierPolicy.limitsForLicense(license).tier,
    remaining: Math.max(0, total - used),
    full: used >= total
  };
}

// Whether one more member may take a seat: a new member or invite, or (reactivateId) a suspended
// member being made active again. Nobody is ever removed or suspended for being over the limit:
// after a downgrade the team keeps everyone, and only new seats are refused until it is back under
// the limit. Returns { ok, usage }.
function canTakeSeat(members, ownerId, license, opts = {}) {
  const list = Array.isArray(members) ? members : [];
  const usage = seatUsage(list, ownerId, license);
  if (opts.reactivateId == null) return { ok: !usage.full, usage };
  const target = String(opts.reactivateId);
  const after = activeSeatIds(
    list.map((m) => (String(m.id) === target ? { ...m, status: 'active' } : m)),
    ownerId
  ).size;
  // Reactivating someone outside this owner's tree, or who already holds a seat, takes no new seat.
  if (after <= usage.used) return { ok: true, usage };
  return { ok: after <= usage.total, usage };
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  // RFC 4180: quote fields with a comma, quote, CR or LF, and double embedded quotes.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const ACTIVITY_CSV_COLUMNS = Object.freeze(['id', 'createdAt', 'memberName', 'action', 'profileTitle', 'detail']);

function activityToCsv(rows) {
  const header = ACTIVITY_CSV_COLUMNS.join(',');
  const lines = (Array.isArray(rows) ? rows : []).map((r) =>
    ACTIVITY_CSV_COLUMNS.map((c) => csvEscape(r[c])).join(',')
  );
  return [header, ...lines].join('\r\n');
}

// A launch in progress holds a pending reservation (no session id yet).
const PENDING_LOCK = '__pending__';
const PENDING_LOCK_TTL_MS = 120000;

// Blocks only when another member holds the lock and it is live: its session is in liveSessionIds,
// or it is a pending reservation within its TTL. Stale locks never block; reconciliation reaps them.
function lockBlocks(existing, requesterMemberId, liveSessionIds, now = Date.now()) {
  if (!existing) return false;
  if (String(existing.memberId) === String(requesterMemberId)) return false;
  if (existing.sessionId === PENDING_LOCK) return (now - (Number(existing.at) || 0)) <= PENDING_LOCK_TTL_MS;
  const live = liveSessionIds instanceof Set ? liveSessionIds : new Set(liveSessionIds || []);
  return live.has(String(existing.sessionId)); // stale → not blocking
}

module.exports = {
  seatsForLicense,
  activeSeatIds,
  seatUsage,
  canTakeSeat,
  csvEscape,
  activityToCsv,
  lockBlocks,
  PENDING_LOCK,
  PENDING_LOCK_TTL_MS
};
