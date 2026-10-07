'use strict';
// Main-process sign-in / vault-lock gate for IPC (audit S7). Sign-out and the vault
// lock used to be enforced only by the renderer (Gate.jsx): after member:logout
// currentMemberId is null and requirePermission treats null as the Owner, and
// vaultLocked was never checked in main - so any IPC call from DevTools ran as the
// Owner. Now, while the vault is locked, or while nobody is signed in on a workspace
// that has members, only the channels the DbGate / Gate (login, lock, first-run)
// screens need are served. A single-user install with no members keeps working
// exactly as before (null member == the Owner).
//
// The allowlist is traced from what DbGate.jsx and Gate.jsx call before a member is
// signed in (softglazeApi -> preload.js -> channel):
const PRE_AUTH_CHANNELS = Object.freeze(new Set([
  // DbGate (encrypted-at-rest DB unlock) + "keep me signed in" status
  'db:encryption-status', 'db:unlock', 'auth:remember-status',
  // vault lock screen (lock is harmless while already locked; AppShell calls it)
  'vault:status', 'vault:unlock', 'vault:lock',
  // first-run registration (main-gated by assertFirstRunSetup)
  'account:get', 'account:send-otp', 'account:register',
  // member picker / logins / invite redemption / Super Admin access
  'member:current', 'member:list', 'member:switch', 'member:login', 'member:logout',
  'member:accept-invite', 'member:super-status', 'member:super-login', 'member:super-setup',
  // payment methods list the Gate fetches on mount (public: labels + pay links only)
  'payment:list-methods'
]));

function isPreAuthChannel(channel) { return PRE_AUTH_CHANNELS.has(String(channel)); }

// state: { vaultLocked, signedIn, memberCount }
//   signedIn    - a real member (existing row) or the Super Admin is active
//   memberCount - number of Member rows (only consulted when not signed in)
// Returns null to allow, or { code, message } to deny.
function decide(channel, state) {
  if (isPreAuthChannel(channel)) return null;
  const s = state || {};
  if (s.vaultLocked) return { code: 'VAULT_LOCKED', message: 'The workspace is locked. Unlock it to continue.' };
  if (s.signedIn) return null;
  if (Number(s.memberCount) > 0) return { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' };
  return null; // single-user mode: no members, null member == the Owner
}

module.exports = { PRE_AUTH_CHANNELS, isPreAuthChannel, decide };
