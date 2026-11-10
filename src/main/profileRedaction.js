'use strict';
// The 2FA seed never leaves main (the renderer gets the mask, owners too). Account and proxy passwords
// are masked unless the viewer may reveal credentials. The editor echoes fields back on save, so a
// masked value means unchanged on update; an emptied field still clears.

const SECRET_MASK = '••••••••';

// host:port:user:pass -> host:port:user:•••••••• (host:port with no credentials is unchanged).
// When the linked proxy row is available it is used, because a host may itself contain ':'.
// `maskUsername`: the username is masked too (a proxy the viewer's own Proxy pool does not show).
function maskProxyInfoString(info, proxy, { maskUsername = false } = {}) {
  const userOf = (u) => (u ? (maskUsername ? SECRET_MASK : String(u)) : '');
  if (proxy && proxy.host) {
    const user = userOf(proxy.username);
    const pass = proxy.password ? SECRET_MASK : '';
    return user || pass ? `${proxy.host}:${proxy.port}:${user}:${pass}` : `${proxy.host}:${proxy.port}`;
  }
  const s = info == null ? null : String(info);
  if (!s) return s;
  const parts = s.split(':');
  if (parts.length < 3) return s;
  if (parts.length === 3) return maskUsername ? `${parts[0]}:${parts[1]}:${userOf(parts[2])}` : s;
  const hasPassword = parts.slice(3).join(':') !== '';
  return `${parts[0]}:${parts[1]}:${userOf(parts[2])}:${hasPassword ? SECRET_MASK : ''}`;
}

// A proxy the viewer's own Proxy pool does not list (one owned outside their visible subtree, for
// example on a profile shared with them): only what is not secret. The username and rotation link
// are masked, the password stays masked. `view` is serializeProxy's output; returns a copy.
function redactForeignProxy(view) {
  if (!view || typeof view !== 'object') return view;
  return {
    ...view,
    username: view.username ? SECRET_MASK : '',
    password: view.password ? SECRET_MASK : '',
    hasUsername: Boolean(view.username) || Boolean(view.hasUsername),
    rotationUrl: null
  };
}

// The proxy fields of a profile shared with the viewer "use only": the profile launches on its real
// proxy (launch reads the stored row), but the window never gets the proxy's password, whatever the
// role, nor its rotation link: the rule of the share's saved logins (PR #65). The username follows the
// Proxy pool: shown only when `showUsername` (the proxy is in the viewer's own pool and they may reveal
// credentials), masked otherwise. A proxy address saved on the profile without a pool proxy is the
// profile owner's, so its username is masked too. `profile` is the stored row (with `proxy`), `view`
// its serializeProfile output; returns { proxyInfoString, proxy } to put over the view.
function redactUseOnlyProxy(profile, view, { showUsername = false } = {}) {
  const linked = profile && profile.proxy && profile.proxy.host ? profile.proxy : null;
  const proxyInfoString = maskProxyInfoString(profile ? profile.proxyInfoString : null, linked, { maskUsername: !(showUsername && linked) });
  let proxy = view ? view.proxy : null;
  if (proxy && typeof proxy === 'object') {
    proxy = showUsername
      ? { ...proxy, password: proxy.password ? SECRET_MASK : '', rotationUrl: null }
      : redactForeignProxy(proxy);
  }
  return { proxyInfoString, proxy };
}

function redactPlatformAccounts(accounts, reveal) {
  if (!Array.isArray(accounts)) return [];
  return accounts.map((a) => {
    if (!a || typeof a !== 'object') return a;
    if (reveal) return a;
    // The per-account 2FA key (twoFa) is as sensitive as the password, so it is masked too.
    const out = { ...a, password: a.password ? SECRET_MASK : '' };
    if (a.twoFa !== undefined) out.twoFa = a.twoFa ? SECRET_MASK : '';
    return out;
  });
}

// Remove what the renderer must not receive from a profile row (before serialization). Without
// `reveal` (proxies.reveal) the proxy address loses its username as well as its password, as the
// Proxy pool shows it, and the linked proxy's rotation link (it often holds the vendor's API key).
function redactProfileRow(profile, { reveal }) {
  const out = { ...profile };
  out.twoFactorSeed = profile.twoFactorSeed ? SECRET_MASK : null;
  if (!reveal) {
    out.proxyInfoString = maskProxyInfoString(profile.proxyInfoString, profile.proxy, { maskUsername: true });
    if (out.proxy && typeof out.proxy === 'object') {
      out.proxy = {
        ...out.proxy,
        username: out.proxy.username ? SECRET_MASK : out.proxy.username,
        password: out.proxy.password ? SECRET_MASK : '',
        rotationUrl: out.proxy.rotationUrl ? SECRET_MASK : (out.proxy.rotationUrl ?? null)
      };
    }
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
      if (!acc || typeof acc !== 'object') return acc;
      const maskedPass = acc.password === SECRET_MASK;
      const maskedTwoFa = acc.twoFa === SECRET_MASK;
      if (!maskedPass && !maskedTwoFa) return acc;
      // Prefer the same position with the same platform and username, then any unused match.
      const same = (s) => s && typeof s === 'object' && s.platform === acc.platform && s.username === acc.username;
      let hit = same(stored[idx]) && !used.has(idx) ? idx : -1;
      if (hit < 0) hit = stored.findIndex((s, i) => !used.has(i) && same(s));
      const out = { ...acc };
      if (hit < 0) {
        if (maskedPass) out.password = '';
        if (maskedTwoFa) out.twoFa = '';
        return out;
      }
      used.add(hit);
      if (maskedPass) out.password = stored[hit].password || '';
      if (maskedTwoFa) out.twoFa = stored[hit].twoFa || '';
      return out;
    });
  }

  if (typeof out.proxyRaw === 'string' && out.proxyRaw.includes(SECRET_MASK)) {
    out.proxyRaw = restoreMaskedProxyRaw(out.proxyRaw, storedProxyCredentials(existing));
  }
  return out;
}

// The proxy credentials a profile has stored: its linked proxy's, else the ones in a proxy address
// saved without a pool proxy (host:port:user:pass, read as maskProxyInfoString writes it). Null when
// it has none.
function storedProxyCredentials(profile) {
  if (!profile) return null;
  const p = profile.proxy;
  if (p && p.host) return { host: String(p.host), port: p.port, username: p.username || '', password: p.password || '' };
  const s = profile.proxyInfoString == null ? '' : String(profile.proxyInfoString);
  const parts = s.split(':');
  if (parts.length < 3 || !parts[0]) return null;
  return { host: parts[0], port: parts[1], username: parts[2] || '', password: parts.slice(3).join(':') };
}

// The editor builds host:port:user:pass from its fields (ProfilesPage constructProxyString); a member
// without proxies.reveal gets the username and password as masks, so a save or "Check network" sends
// them back masked. Each masked part is put back from what is stored, the username from the stored
// username and the password from the stored password (before 1.0.26 every mask became the password).
// The hidden values stay with the host they belong to: with a different host the call is refused,
// otherwise a member could send credentials they may not see to a server of their own. Nothing stored
// (a new profile): masks become empty, never dots.
function restoreMaskedProxyRaw(raw, stored) {
  const s = String(raw);
  if (!s.includes(SECRET_MASK)) return s;
  const parts = s.split(':');
  if (parts.length < 3) return s.split(SECRET_MASK).join('');
  const host = parts[0];
  const port = parts[1];
  const user = parts[2];
  const pass = parts.slice(3).join(':');
  const userMasked = user === SECRET_MASK;
  const passMasked = pass === SECRET_MASK;
  if (!stored) {
    const u = userMasked ? '' : user;
    return parts.length > 3 ? `${host}:${port}:${u}:${passMasked ? '' : pass}` : `${host}:${port}:${u}`;
  }
  if ((userMasked || passMasked) && String(host).trim().toLowerCase() !== String(stored.host).trim().toLowerCase()) {
    const e = new Error('The proxy username and password are hidden for your account, so they stay with their host. To use another host, type the username and password again.');
    e.code = 'FORBIDDEN';
    throw e;
  }
  const u = userMasked ? String(stored.username || '') : user;
  if (parts.length === 3) return `${host}:${port}:${u}`;
  return `${host}:${port}:${u}:${passMasked ? String(stored.password || '') : pass}`;
}

module.exports = {
  SECRET_MASK, maskProxyInfoString, redactForeignProxy, redactUseOnlyProxy, redactPlatformAccounts, redactProfileRow,
  restoreMaskedSecrets, restoreMaskedProxyRaw, storedProxyCredentials
};
