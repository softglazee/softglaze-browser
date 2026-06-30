'use strict';
// Role hierarchy + permission/limit model for the team system.
//
//   SUPER_ADMIN  (the source owner — one, hardcoded, no registration)
//     └─ OWNER   (buys a licence / runs a free trial; top of an org tree)
//          └─ ADMIN
//               └─ MANAGER
//                    └─ OPERATOR
//
// Each member carries a permission object (limits + feature flags) GRANTED by its
// parent. A parent can never grant more than it holds itself. Visibility is scoped
// to a member's own subtree (plus, for managers, their parent admin) so siblings
// never see each other.

const ROLE_RANK = { OPERATOR: 1, MANAGER: 2, ADMIN: 3, OWNER: 4, SUPER_ADMIN: 5 };
const VALID_MEMBER_ROLES = ['OPERATOR', 'MANAGER', 'ADMIN', 'OWNER']; // SUPER_ADMIN is virtual, never a DB row

// Which roles a given role is allowed to create beneath it (subject to per-member flags).
const ROLES_BELOW = {
  SUPER_ADMIN: ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR'],
  OWNER: ['ADMIN', 'MANAGER', 'OPERATOR'],
  ADMIN: ['MANAGER', 'OPERATOR'],
  MANAGER: ['OPERATOR'],
  OPERATOR: []
};

// Toggleable feature areas the parent can hide from a child (maps to nav routes).
const FEATURE_KEYS = [
  'dashboard', 'profiles', 'groups', 'proxies', 'extensions',
  'browsers', 'batchImport', 'members', 'trash', 'settings'
];

function allFeaturesOn() {
  const f = {};
  for (const k of FEATURE_KEYS) f[k] = true;
  return f;
}

function rankOf(role) { return ROLE_RANK[String(role || '').toUpperCase()] || 0; }

// Per-action capability catalog. Each action has a role-rank BASELINE — the rank at
// or above which the role may perform it by default. On top of the baseline a parent
// can REVOKE an action for an individual member (restrict-only: an override can never
// escalate above the role baseline). Baselines preserve existing behavior — actions
// that were previously ungated are rank 1 (everyone), so nothing changes until an
// admin explicitly revokes. `proxies.reveal` is MANAGER+ to match the raw-credential
// redaction policy (rbacPolicy.js). requirePermission() reads ACTION_MIN_RANK.
const ACTION_CATALOG = [
  { key: 'profiles.launch', label: 'Launch profiles', category: 'Profiles', minRank: 1 },
  { key: 'profiles.create', label: 'Create profiles', category: 'Profiles', minRank: 1 },
  { key: 'profiles.edit', label: 'Edit profiles', category: 'Profiles', minRank: 1 },
  { key: 'profiles.export', label: 'Export profiles', category: 'Profiles', minRank: 1 },
  { key: 'profiles.share', label: 'Share profiles with members', category: 'Profiles', minRank: 2 },
  { key: 'profiles.delete', label: 'Delete profiles (to trash)', category: 'Profiles', minRank: 3 },
  { key: 'profiles.purge', label: 'Permanently purge profiles', category: 'Profiles', minRank: 4 },
  { key: 'proxies.manage', label: 'Add / edit / delete proxies', category: 'Proxies', minRank: 1 },
  { key: 'proxies.reveal', label: 'Reveal raw proxy credentials', category: 'Proxies', minRank: 2 },
  { key: 'automation.run', label: 'Run automation / macros', category: 'Automation', minRank: 1 },
  { key: 'extensions.manage', label: 'Manage team extensions', category: 'Workspace', minRank: 3 },
  { key: 'vault.manage', label: 'Manage the Identity Vault', category: 'Workspace', minRank: 4 },
  { key: 'members.manage', label: 'Manage team members', category: 'Team', minRank: 3 },
  { key: 'members.delete', label: 'Delete members / change roles', category: 'Team', minRank: 4 }
];
const ACTION_MIN_RANK = ACTION_CATALOG.reduce((m, a) => { m[a.key] = a.minRank; return m; }, {});

// Default per-action allow map for a role: an action is on iff the role meets the
// baseline rank. Stored overrides may only turn within-rank actions OFF.
function defaultActionsFor(role) {
  const r = rankOf(role);
  const out = {};
  for (const a of ACTION_CATALOG) out[a.key] = r >= a.minRank;
  return out;
}

// -1 means "unlimited" for any numeric limit.
function defaultPermissionsFor(role) {
  const r = String(role || '').toUpperCase();
  const base = {
    maxProfiles: 0, maxProxies: 0, maxBrowsers: 0,
    maxAdmins: 0, maxManagers: 0, maxOperators: 0,
    canCreateAdmins: false, canCreateManagers: false, canCreateOperators: false,
    features: allFeaturesOn()
  };
  switch (r) {
    case 'SUPER_ADMIN':
    case 'OWNER':
      return {
        ...base,
        maxProfiles: -1, maxProxies: -1, maxBrowsers: -1,
        maxAdmins: 10, maxManagers: 10, maxOperators: 5,
        canCreateAdmins: true, canCreateManagers: true, canCreateOperators: true
      };
    case 'ADMIN':
      return {
        ...base,
        maxProfiles: 200, maxProxies: 200, maxBrowsers: 10,
        maxAdmins: 0, maxManagers: 5, maxOperators: 5,
        canCreateAdmins: false, canCreateManagers: true, canCreateOperators: true
      };
    case 'MANAGER':
      return {
        ...base,
        maxProfiles: 50, maxProxies: 50, maxBrowsers: 5,
        maxOperators: 3, canCreateOperators: true
      };
    case 'OPERATOR':
      return {
        ...base,
        maxProfiles: 10, maxProxies: 10, maxBrowsers: 2,
        features: allFeaturesOn()
      };
    default:
      return base;
  }
}

// Merge a stored (possibly partial) permission patch over the role default so old
// rows and new fields both resolve to a complete object.
function effectivePermissions(member) {
  const role = member && member.role;
  const def = defaultPermissionsFor(role);
  let stored = null;
  if (member && member.permissionsJson) {
    try { stored = JSON.parse(member.permissionsJson); } catch (e) { stored = null; }
  }
  // Effective per-action map: role baseline, minus any stored within-rank revokes.
  // A stored value can never enable an action above the role's baseline rank.
  const storedActions = (stored && stored.actions && typeof stored.actions === 'object') ? stored.actions : {};
  const actions = {};
  for (const a of ACTION_CATALOG) {
    const rankAllows = rankOf(role) >= a.minRank;
    actions[a.key] = (a.key in storedActions) ? (Boolean(storedActions[a.key]) && rankAllows) : rankAllows;
  }
  if (!stored || typeof stored !== 'object') return { ...def, actions };
  return {
    ...def,
    ...stored,
    features: { ...def.features, ...(stored.features || {}) },
    actions
  };
}

// The flag that gates creating a particular child role.
function createFlagFor(targetRole) {
  const r = String(targetRole || '').toUpperCase();
  if (r === 'ADMIN') return 'canCreateAdmins';
  if (r === 'MANAGER') return 'canCreateManagers';
  if (r === 'OPERATOR') return 'canCreateOperators';
  return null;
}

// Can `creator` (a member object or {role,permissionsJson}) create `targetRole`?
function canCreateRole(creator, targetRole) {
  const creatorRole = String(creator && creator.role || '').toUpperCase();
  const target = String(targetRole || '').toUpperCase();
  if (!ROLES_BELOW[creatorRole] || !ROLES_BELOW[creatorRole].includes(target)) return false;
  if (creatorRole === 'SUPER_ADMIN') return true; // source owner creates anything
  if (creatorRole === 'OWNER') return true;        // owner creates all sub-roles
  const flag = createFlagFor(target);
  if (!flag) return false;
  return Boolean(effectivePermissions(creator)[flag]);
}

// The numeric child cap for a role on the parent's permissions.
function childCapFor(parentPerms, targetRole) {
  const r = String(targetRole || '').toUpperCase();
  if (r === 'ADMIN') return parentPerms.maxAdmins;
  if (r === 'MANAGER') return parentPerms.maxManagers;
  if (r === 'OPERATOR') return parentPerms.maxOperators;
  return 0;
}

// ---------------------------------------------------------------------------
// Super Admin — the source-owner account. Logs in WITHOUT registration and
// always bypasses role/limit/trial gating. The credential is per-install: it is
// set on first run and stored hashed in Setting['superAdminAuth'] (see
// ipcHandlers superLogin / superAdminSetup) — there is NO shared/hardcoded
// password in the shipped binary.
// ---------------------------------------------------------------------------
const SUPER_ADMIN_ID = -1;
const DEFAULT_SUPER_ADMIN_IDENTIFIER = 'superadmin';
const SUPER_ADMIN = Object.freeze({
  id: SUPER_ADMIN_ID,
  name: 'Super Admin',
  username: 'superadmin',
  email: 'admin@softglaze.com',
  role: 'SUPER_ADMIN',
  color: '#f59e0b',
  initials: 'SA',
  status: 'active'
});

function isSuperAdminId(id) { return Number(id) === SUPER_ADMIN_ID; }

// ---------------------------------------------------------------------------
// Visibility — the set of member ids a viewer is allowed to see.
//   SUPER_ADMIN / OWNER : their whole subtree (everyone under them).
//   ADMIN               : self + own descendants.
//   MANAGER             : self + own descendants + parent admin.
//   OPERATOR            : self only.
// `members` is the full member list; `viewer` is a member object (or SUPER_ADMIN).
// ---------------------------------------------------------------------------
function descendantIds(members, rootId) {
  const childrenOf = new Map();
  for (const m of members) {
    const p = m.parentMemberId == null ? null : Number(m.parentMemberId);
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(m.id);
  }
  const out = new Set();
  const stack = [...(childrenOf.get(Number(rootId)) || [])];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    for (const c of (childrenOf.get(id) || [])) stack.push(c);
  }
  return out;
}

function visibleMemberIds(members, viewer) {
  const role = String(viewer && viewer.role || '').toUpperCase();
  if (role === 'SUPER_ADMIN') return new Set(members.map((m) => m.id)); // sees everyone

  const ids = new Set();
  if (viewer && viewer.id != null && viewer.id >= 0) ids.add(viewer.id); // self
  if (viewer && viewer.id != null) {
    for (const d of descendantIds(members, viewer.id)) ids.add(d);
  }
  if (role === 'OWNER') {
    // Owner already covered by descendants (whole org under them).
    return ids;
  }
  if (role === 'MANAGER' && viewer.parentMemberId != null) {
    ids.add(Number(viewer.parentMemberId)); // their parent admin only
  }
  return ids;
}

// --- Phase F2: shared-profile (ProfileAccess) ACL resolution ----------------
// Pure, DB-free so it is unit-testable. `row` is a profile selected with
// { ownerMemberId, assignedMemberId, accesses:[{memberId, level}] }; `visibleSet`
// is the viewer's visibleMemberIds(). Owner/assignee always get full (edit) access;
// a ProfileAccess grant to a visible member adds access at its level.
const ACCESS_LEVEL_RANK = { use: 1, edit: 2 };
function accessLevelRank(level) { return ACCESS_LEVEL_RANK[String(level)] || 1; }

function profileRowAccessible(visibleSet, row, requireEdit = false) {
  if (!row || !visibleSet) return false;
  const ownerOrAssignee = (row.assignedMemberId != null && visibleSet.has(row.assignedMemberId))
    || (row.ownerMemberId != null && visibleSet.has(row.ownerMemberId));
  if (ownerOrAssignee) return true; // owner/assignee are edit-capable
  const acc = Array.isArray(row.accesses) ? row.accesses : [];
  for (const a of acc) {
    if (a && visibleSet.has(a.memberId) && (!requireEdit || accessLevelRank(a.level) >= 2)) return true;
  }
  return false;
}

module.exports = {
  ROLE_RANK,
  VALID_MEMBER_ROLES,
  ROLES_BELOW,
  FEATURE_KEYS,
  ACTION_CATALOG,
  ACTION_MIN_RANK,
  defaultActionsFor,
  rankOf,
  allFeaturesOn,
  defaultPermissionsFor,
  effectivePermissions,
  canCreateRole,
  createFlagFor,
  childCapFor,
  descendantIds,
  visibleMemberIds,
  accessLevelRank,
  profileRowAccessible,
  SUPER_ADMIN,
  SUPER_ADMIN_ID,
  DEFAULT_SUPER_ADMIN_IDENTIFIER,
  isSuperAdminId
};
