'use strict';
// Profile secret redaction (audit T2-1, 11 Sep 2026).
//
// serializeProfile used to spread the whole Profile row to the renderer, so every member,
// including an operator with only use-level access, received cleartext platform account
// passwords, the raw proxyInfoString (host:port:user:pass) and the sealed 2FA seed.
//
// The rule now:
//  - The 2FA seed never leaves the main process. The renderer only needs to know one is
//    saved (the 2FA badge, the editor field) and codes are minted server-side, so it gets
//    the mask. That applies to owners too.
//  - Platform passwords and the proxy password are masked unless the viewer may reveal
//    credentials (owner, single-user mode, or a member with proxies.reveal).
//  - The profile editor echoes every field back on save, so a masked value must mean
//    "unchanged" on update. Without that, redacting would wipe the stored secrets the
//    first time a restricted member saved a profile. An emptied field still clears.

const SECRET_MASK = '••••••••';

// host:port:user:pass -> host:port:user:•••••••• (host:port with no credentials is unchanged).
// When the linked proxy row is available it is used, because a host may itself contain ':'.
function maskProxyInfoString(info, proxy) {
  if (proxy && proxy.host) {
    const user = proxy.username ? String(proxy.username) : '';
    const pass = proxy.password ? SECRET_MASK : '';
    return user || pass ? `${proxy.host}:${proxy.port}:${user}:${pass}` : `${proxy.host}:${proxy.port}`;
  }
  const s = info == null ? null : String(info);
  if (!s) return s;
  const parts = s.split(':');
  if (parts.length < 4) return s;
  const hasPassword = parts.slice(3).join(':') !== '';
  return `${parts[0]}:${parts[1]}:${parts[2]}:${hasPassword ? SECRET_MASK : ''}`;
}

function redactPlatformAccounts(accounts, reveal) {
  if (!Array.isArray(accounts)) return [];
  return accounts.map((a) => {
    if (!a || typeof a !== 'object') return a;
    if (reveal) return a;
    return { ...a, password: a.password ? SECRET_MASK : '' };
  });
}

// Remove what the renderer must not receive from a profile row (before serialization).
function redactProfileRow(profile, { reveal }) {
  const out = { ...profile };
  out.twoFactorSeed = profile.twoFactorSeed ? SECRET_MASK : null;
  if (!reveal) {
    out.proxyInfoString = maskProxyInfoString(profile.proxyInfoString, profile.proxy);
    if (out.proxy && typeof out.proxy === 'object') out.proxy = { ...out.proxy, password: out.proxy.password ? SECRET_MASK : '' };
    if (typeof out.platformAccounts === 'string') {
      let accs = [];
      try { accs = JSON.parse(out.platformAccounts); } catch (e) { accs = []; }
      out.platformAccounts = JSON.stringify(redactPlatformAccounts(accs, false));
    }
  }
  return out;
}

// On update: turn masked values in the incoming payload back into what is stored.
// `existing` is the current Profile row (with `proxy` included when linked).
function restoreMaskedSecrets(input, existing) {
  const out = { ...input };
  if (out.twoFactorSeed === SECRET_MASK) out.twoFactorSeed = undefined; // unchanged

  if (Array.isArray(out.platformAccounts)) {
    let stored = [];
    try { stored = existing && existing.platformAccounts ? JSON.parse(existing.platformAccounts) : []; } catch (e) { stored = []; }
    if (!Array.isArray(stored)) stored = [];
    const used = new Set();
    out.platformAccounts = out.platformAccounts.map((acc, idx) => {
      if (!acc || typeof acc !== 'object' || acc.password !== SECRET_MASK) return acc;
      // Prefer the same position with the same platform and username, then any unused match.
      const same = (s) => s && typeof s === 'object' && s.platform === acc.platform && s.username === acc.username;
      let hit = same(stored[idx]) && !used.has(idx) ? idx : -1;
      if (hit < 0) hit = stored.findIndex((s, i) => !used.has(i) && same(s));
      if (hit < 0) return { ...acc, password: '' };
      used.add(hit);
      return { ...acc, password: stored[hit].password || '' };
    });
  }

  if (typeof out.proxyRaw === 'string' && out.proxyRaw.includes(SECRET_MASK)) {
    const pass = existing && existing.proxy && existing.proxy.password ? String(existing.proxy.password) : '';
    out.proxyRaw = out.proxyRaw.split(SECRET_MASK).join(pass);
  }
  return out;
}

module.exports = { SECRET_MASK, maskProxyInfoString, redactPlatformAccounts, redactProfileRow, restoreMaskedSecrets };
