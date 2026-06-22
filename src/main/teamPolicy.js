'use strict';
// ---------------------------------------------------------------------------
// Softglaze Enterprise — Team-at-scale policy helpers (PURE).
//
// Seat math, audit-log CSV serialization, and the profile-lock conflict rule.
// No Electron, no DB, no globals — every input is passed in — so this is
// unit-testable in isolation (same seam pattern as parallelRunner/importParser).
// ipcHandlers.js injects the live members/license/session data.
// ---------------------------------------------------------------------------

// --- Seats -----------------------------------------------------------------
// Seats are derived from the license type (no DB column), so the rule stays
// reversible and Phase 8 can later promote it to an explicit, Super-Admin-
// editable field on the License.
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

// The set of non-suspended member ids that consume a seat within an owner's
// subtree (the owner counts as seat #1). `members` is the full list of
// { id, status, parentMemberId }. ownerId == null => count every non-suspended
// member (single-owner install).
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

// --- Audit-log CSV ---------------------------------------------------------
function csvEscape(value) {
  const s = value == null ? '' : String(value);
  // Quote when the field contains a comma, double-quote, CR or LF; escape
  // embedded quotes by doubling them (RFC 4180).
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

// --- Profile locks ---------------------------------------------------------
// Does an existing lock block `requesterMemberId` from launching? It blocks only
// when the lock is (a) held by a DIFFERENT member AND (b) still live (its session
// is in `liveSessionIds`). A stale lock — whose browser session has gone away —
// never blocks (it'll be reaped by reconciliation).
function lockBlocks(existing, requesterMemberId, liveSessionIds) {
  if (!existing) return false;
  const live = liveSessionIds instanceof Set ? liveSessionIds : new Set(liveSessionIds || []);
  if (!live.has(String(existing.sessionId))) return false; // stale → not blocking
  return String(existing.memberId) !== String(requesterMemberId);
}

module.exports = {
  SEATS_BY_TYPE,
  DEFAULT_SEATS,
  seatsForLicense,
  activeSeatIds,
  seatUsage,
  csvEscape,
  ACTIVITY_CSV_COLUMNS,
  activityToCsv,
  lockBlocks
};
