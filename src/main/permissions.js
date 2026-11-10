'use strict';
// Role hierarchy: SUPER_ADMIN > OWNER > ADMIN > MANAGER > OPERATOR. A parent grants each child its
// limits and feature flags, never more than it holds. Members see only their own subtree (managers
// also see their parent admin), so siblings never see each other.

const ROLE_RANK = { OPERATOR: 1, MANAGER: 2, ADMIN: 3, OWNER: 4, SUPER_ADMIN: 5 };

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

// Each action has a minimum role rank. A parent may revoke an action per member but never grant one
// above the role baseline. `proxies.reveal` is MANAGER+ to match the credential redaction in
// rbacPolicy.js. requirePermission() reads ACTION_MIN_RANK.
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
  // Workspace settings (the Settings page, start-page links) hold one value for every member, and most
  // of them change how everybody's profiles open, so Admin and up, like the workspace rotation policy.
  { key: 'settings.manage', label: 'Change workspace settings', category: 'Workspace', minRank: 3 },
  { key: 'vault.manage', label: 'Manage the Identity Vault', category: 'Workspace', minRank: 4 },
  { key: 'members.manage', label: 'Manage team members', category: 'Team', minRank: 3 },
  { key: 'members.delete', label: 'Delete members / change roles', category: 'Team', minRank: 4 }
];
const ACTION_MIN_RANK = ACTION_CATALOG.reduce((m, a) => { m[a.key] = a.minRank; return m; }, {});

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
  const merged = {
    ...def,
    ...stored,
    features: { ...def.features, ...(stored.features || {}) },
    actions
  };
  // Stored permissionsJson may restrict within the role but never escalate: limits are capped to the
  // role default and create flags are ANDed with it, so a tampered row cannot grant quota or roles.
  for (const k of ['maxProfiles', 'maxProxies', 'maxBrowsers', 'maxAdmins', 'maxManagers', 'maxOperators']) {
    merged[k] = clampLimit(merged[k], def[k]);
  }
  for (const k of ['canCreateAdmins', 'canCreateManagers', 'canCreateOperators']) {
    merged[k] = Boolean(def[k]) && Boolean(merged[k]);
  }
  return merged;
}

// An unlimited (-1) default honors a lower stored limit; a finite default is a hard ceiling that no
// stored value, -1 included, can exceed.
function clampLimit(storedVal, defVal) {
  const s = Number(storedVal);
  const hasStored = Number.isFinite(s);
  if (defVal === -1) return (hasStored && s >= 0) ? s : -1;
  if (!hasStored || s < 0) return defVal;
  return Math.min(s, defVal);
}

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

function childCapFor(parentPerms, targetRole) {
  const r = String(targetRole || '').toUpperCase();
  if (r === 'ADMIN') return parentPerms.maxAdmins;
  if (r === 'MANAGER') return parentPerms.maxManagers;
  if (r === 'OPERATOR') return parentPerms.maxOperators;
  return 0;
}

// Super Admin (source owner): logs in without registration and bypasses role, limit and trial gates.
// Its credential is set per install on first run and stored hashed in Setting['superAdminAuth'].
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

// Visibility: SUPER_ADMIN and OWNER see their whole subtree, ADMIN self + descendants,
// MANAGER self + descendants + parent admin, OPERATOR self only.
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
  if (role === 'SUPER_ADMIN') return new Set(members.map((m) => m.id));

  const ids = new Set();
  if (viewer && viewer.id != null && viewer.id >= 0) ids.add(viewer.id);
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

// Shared-profile ACL, DB-free for unit tests. Owner and assignee always get edit access;
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
  ROLES_BELOW,
  FEATURE_KEYS,
  ACTION_CATALOG,
  ACTION_MIN_RANK,
  rankOf,
  defaultPermissionsFor,
  effectivePermissions,
  canCreateRole,
  childCapFor,
  visibleMemberIds,
  accessLevelRank,
  profileRowAccessible,
  SUPER_ADMIN,
  SUPER_ADMIN_ID,
  DEFAULT_SUPER_ADMIN_IDENTIFIER,
  isSuperAdminId
};
