import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { can, denial, workspaceProxyDenial, canManageVault, cookieExportDenial, featureVisible } from '@/lib/memberPermissions.mjs';

// The signed-in member, read once per window: switching member, signing out and locking the
// workspace all reload the window. undefined until known; null in single-user mode (the Owner).
let cachedMember;
let pendingMember = null;

export function loadCurrentMember() {
  if (!pendingMember) {
    pendingMember = softglazeApi.members.current()
      .catch(() => null)
      .then((m) => { cachedMember = m || null; return cachedMember; });
  }
  return pendingMember;
}

export function useCurrentMember() {
  const [me, setMe] = useState(cachedMember);
  useEffect(() => {
    let live = true;
    loadCurrentMember().then((m) => { if (live) setMe(m); });
    return () => { live = false; };
  }, []);
  return me;
}

// Role-aware controls. Each deny* returns the tooltip for a control the member may not use (which
// role it needs, or that it was turned off for them), or null when it is allowed. The rules are
// main's (lib/memberPermissions.mjs); main still refuses on its own.
export function usePermissions() {
  const me = useCurrentMember();
  const { t } = useTranslation('common');
  const text = (d) => {
    if (!d) return null;
    if (d.kind === 'loading') return t('perm.checking');
    if (d.kind === 'inactive') return t('perm.inactive');
    if (d.kind === 'revoked') return t('perm.turnedOff');
    if (d.role === 'OWNER') return t('perm.ownerOnly');
    return t('perm.needsRole', { role: t(`roles.${d.role}`) });
  };
  return {
    me,
    can: (action) => can(me, action),
    deny: (action) => text(denial(me, action)),
    // An action on one profile row (from listProfiles / listTrash): also off for a profile shared
    // with the member "use only" (row.canEdit === false).
    denyRow: (action, row) => text(denial(me, action)) || (row && row.canEdit === false ? t('perm.useOnly') : null),
    // Rename or delete a profile group or proxy group listed with canManage === false.
    denyGroup: (action, group) => text(denial(me, action)) || (group && group.canManage === false ? t('perm.notYourGroup') : null),
    // Workspace-wide proxy settings (default rotation policy, check schedule).
    denyWorkspaceProxy: () => text(workspaceProxyDenial(me)),
    // Owner-only actions outside the action list (ban or unban a member: main's requireOwnerOrSuper).
    denyOwner: () => text(me === undefined ? { kind: 'loading' }
      : (me === null || me.role === 'OWNER' || me.role === 'SUPER_ADMIN') ? null : { kind: 'role', role: 'OWNER' }),
    // A profile's cookies: export needs profiles.export and the Manager role (cookie dumps are raw
    // session values), import needs profiles.edit; both need edit access to the profile, so a profile
    // shared "use only" can do neither.
    denyCookieExport: (row) => text(cookieExportDenial(me)) || (row && row.canEdit === false ? t('perm.useOnly') : null),
    denyCookieImport: (row) => text(denial(me, 'profiles.edit')) || (row && row.canEdit === false ? t('perm.useOnly') : null),
    // A page turned off for this member under "Visible features".
    featureOn: (key) => featureVisible(me, key),
    canManageVault: canManageVault(me)
  };
}
