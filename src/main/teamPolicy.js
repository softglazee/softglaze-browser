'use strict';
// Pure team helpers (seats, audit-log CSV export, profile locks): no Electron, DB or globals.
// ipcHandlers.js injects the live members, license and session data.

// Seats derive from the license type; there is no DB column for them.
const SEATS_BY_TYPE = Object.freeze({ trial: 3, paid: 25 });
const DEFAULT_SEATS = 3;

function seatsForLicense(license) {
  if (!license) return DEFAULT_SEATS;
  const type = String(license.type || 'trial').toLowerCase();
  return SEATS_BY_TYPE[type] != null ? SEATS_BY_TYPE[type] : DEFAULT_SEATS;
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
    remaining: Math.max(0, total - used),
    full: used >= total
  };
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
  csvEscape,
  activityToCsv,
  lockBlocks,
  PENDING_LOCK,
  PENDING_LOCK_TTL_MS
};
