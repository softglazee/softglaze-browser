// What the current member may do, for disabling buttons before the click. Main enforces every rule
// on its own (requirePermission and the access checks in ipcHandlers.js); this only lets the page
// agree with it. The member comes from softglazeApi.members.current(): its `permissions.actions` is
// main's effectivePermissions (role baseline minus anything revoked for that member).
//
// `me`: undefined = not loaded yet (nothing is allowed, so nothing flashes enabled), null = no
// member (single-user mode, which main treats as the Owner).

// The same ranks and per-action minimum roles as src/main/permissions.js (test/permissionsFollowup
// keeps them equal).
export const ROLE_RANK = Object.freeze({ OPERATOR: 1, MANAGER: 2, ADMIN: 3, OWNER: 4, SUPER_ADMIN: 5 });
export const ACTION_MIN_RANK = Object.freeze({
  'profiles.launch': 1,
  'profiles.create': 1,
  'profiles.edit': 1,
  'profiles.export': 1,
  'profiles.share': 2,
  'profiles.delete': 3,
  'profiles.purge': 4,
  'proxies.manage': 1,
  'proxies.reveal': 2,
  'automation.run': 1,
  'extensions.manage': 3,
  'settings.manage': 3,
  'vault.manage': 4,
  'members.manage': 3,
  'members.delete': 4
});
const ROLE_OF_RANK = Object.freeze({ 1: 'OPERATOR', 2: 'MANAGER', 3: 'ADMIN', 4: 'OWNER' });

export function rankOf(role) {
  return ROLE_RANK[String(role || '').toUpperCase()] || 0;
}

function inactive(me) {
  return Boolean(me) && (me.status === 'suspended' || me.status === 'banned');
}

export function can(me, action) {
  if (me === undefined) return false;
  if (me === null || me.role === 'SUPER_ADMIN') return true;
  if (inactive(me)) return false;
  const actions = me.permissions && me.permissions.actions;
  if (actions && Object.prototype.hasOwnProperty.call(actions, action)) return actions[action] === true;
  return rankOf(me.role) >= (ACTION_MIN_RANK[action] || 0);
}

// The Owner or an Admin (single-user mode counts as the Owner).
export function isOwnerOrAdmin(me) {
  if (me === undefined) return false;
  if (me === null) return true;
  return rankOf(me.role) >= ROLE_RANK.ADMIN && !inactive(me);
}

// Why `action` is off for this member, or null when it is allowed:
//   { kind: 'loading' } | { kind: 'inactive' } | { kind: 'role', role: 'MANAGER' | 'ADMIN' | 'OWNER' } | { kind: 'revoked' }
export function denial(me, action) {
  if (can(me, action)) return null;
  if (me === undefined) return { kind: 'loading' };
  if (inactive(me)) return { kind: 'inactive' };
  const need = ACTION_MIN_RANK[action] || 0;
  if (rankOf(me.role) < need) return { kind: 'role', role: ROLE_OF_RANK[need] || 'OWNER' };
  return { kind: 'revoked' };
}

// The workspace-wide proxy settings (default rotation policy, check schedule): proxies.manage and
// the Owner or an Admin, as main's requireWorkspaceProxySettings.
export function workspaceProxyDenial(me) {
  const d = denial(me, 'proxies.manage');
  if (d) return d;
  if (!isOwnerOrAdmin(me)) return { kind: 'role', role: 'ADMIN' };
  return null;
}

// Data Vault (the page and its sidebar entry): main's vault.manage, Owner by default.
export function canManageVault(me) {
  return can(me, 'vault.manage');
}

// Exporting a profile's cookies (or its full archive): profiles.export and, as main's
// assertCanRevealKind('cookieDump') (rbacPolicy.js), the Manager role or higher. Edit access to the
// profile is checked per row (row.canEdit).
export function cookieExportDenial(me) {
  const d = denial(me, 'profiles.export');
  if (d) return d;
  if (me && me.role !== 'SUPER_ADMIN' && rankOf(me.role) < ROLE_RANK.MANAGER) return { kind: 'role', role: 'MANAGER' };
  return null;
}

// A page under "Visible features" (Members > permissions) that was turned off for this member. Main
// refuses that page's actions too (src/main/featureGate.js). Not loaded yet: not shown.
export function featureVisible(me, key) {
  if (me === undefined) return false;
  if (me === null || me.role === 'SUPER_ADMIN' || !key) return true;
  const f = me.permissions && me.permissions.features;
  return !f || f[key] !== false;
}

// The first-run wizard's steps and what main checks for each:
//   smtp    email:set-config, the Owner only (requireOwnerOrSuper);
//   proxy   proxies.manage, and the Proxies page not turned off (featureGate, proxy:create);
//   profile profiles.create, and the Profiles page not turned off (featureGate, profile:create).
// Returns { smtp, proxy, profile }: null when the member may do the step, else why not
// ({ kind: 'role' | 'revoked' | 'inactive' | 'loading' } as denial(), or { kind: 'feature', feature }).
export const ONBOARDING_STEPS = Object.freeze(['smtp', 'proxy', 'profile']);
export function onboardingStepDenials(me) {
  const ownerOnly = () => {
    if (me === undefined) return { kind: 'loading' };
    if (me === null || me.role === 'SUPER_ADMIN') return null;
    if (inactive(me)) return { kind: 'inactive' };
    return me.role === 'OWNER' ? null : { kind: 'role', role: 'OWNER' };
  };
  const withPage = (action, feature) => denial(me, action) || (featureVisible(me, feature) ? null : { kind: 'feature', feature });
  return {
    smtp: ownerOnly(),
    proxy: withPage('proxies.manage', 'proxies'),
    profile: withPage('profiles.create', 'profiles')
  };
}
