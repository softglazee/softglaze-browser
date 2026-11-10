'use strict';
// IPC gate for sign-in and vault lock in main; the renderer gate alone can be bypassed from DevTools.
// While the vault is locked, or nobody is signed in on a workspace with members, only the channels
// DbGate.jsx and Gate.jsx call before sign-in are served. With no members, a null member is the Owner.
const PRE_AUTH_CHANNELS = Object.freeze(new Set([
  // DbGate (encrypted-at-rest DB unlock) + "keep me signed in" status
  'db:encryption-status', 'db:unlock', 'auth:remember-status',
  // vault lock screen (lock is harmless while already locked; AppShell calls it)
  'vault:status', 'vault:unlock', 'vault:lock',
  // first-run registration (main-gated by assertFirstRunSetup)
  'account:get', 'account:send-otp', 'account:register',
  // one-click sign-in (1.0.26): a new workspace, or a one-click workspace after Sign out; oneClickSignIn.js
  // checks the purpose (assertFirstRunSetup, or a locked one-click workspace and its own account)
  'signin:info', 'signin:start', 'signin:cancel', 'signin:email-start', 'signin:email-verify',
  // member picker / logins / invite redemption / Super Admin access
  'member:current', 'member:list', 'member:switch', 'member:login', 'member:logout',
  'member:accept-invite', 'member:super-status', 'member:super-login', 'member:super-setup',
  // payment methods list the Gate fetches on mount (public: labels + pay links only)
  'payment:list-methods'
]));

function isPreAuthChannel(channel) { return PRE_AUTH_CHANNELS.has(String(channel)); }

// state: { vaultLocked, signedIn, memberCount }; signedIn means a real member or the Super Admin is
// active, memberCount is only consulted when signed out. Returns null to allow, or { code, message }.
function decide(channel, state) {
  if (isPreAuthChannel(channel)) return null;
  const s = state || {};
  if (s.vaultLocked) return { code: 'VAULT_LOCKED', message: 'The workspace is locked. Unlock it to continue.' };
  if (s.signedIn) return null;
  if (Number(s.memberCount) > 0) return { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' };
  return null; // single-user mode: no members, null member == the Owner
}

module.exports = { PRE_AUTH_CHANNELS, isPreAuthChannel, decide };
