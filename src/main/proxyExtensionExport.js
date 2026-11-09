'use strict';
// "Copy for SoftGlaze Proxy": turns saved proxies into lines that the SoftGlaze Proxy browser
// extension's Bulk import reads correctly, and clears the clipboard afterwards. Pure apart from the
// clipboard and timers passed in, so it is tested without Electron.
//
// Line format: scheme://user:pass@host:port. The extension's parser (src/lib/parse.js,
// parseProxyLine) documents it as unambiguous:
// - The scheme is always written. A line without one goes through the extension's SOCKS guess, and
//   host:port:user:pass cannot say SOCKS5 at all; a SOCKS5 proxy saved as HTTP fails every check.
// - The username and password are percent-encoded (encodeURIComponent). The extension splits the
//   login at the last '@' and the first ':', then decodes a field that holds %XX, so @ : / # % and
//   spaces come back exactly as typed.
// - IPv6 hosts go in brackets.
// Limits of the extension, not of the format:
// - SOCKS4 has no password, and the extension refuses a SOCKS4 line with a login, so a SOCKS4 line
//   never carries one.
// - Chrome and Edge cannot sign in to SOCKS5 proxies; the extension says so for each such line.
//   Firefox can.
// - It trims spaces at the end of a password and around a username.

const crypto = require('node:crypto');

// How long a copied list stays on the clipboard if nothing else replaces it.
const CLEAR_AFTER_MS = 2 * 60 * 1000;

// App proxy type -> extension scheme; null for a type the extension does not have.
function extensionScheme(type) {
  const t = String(type || '').trim().toUpperCase();
  if (t === 'HTTP') return 'http';
  if (t === 'HTTPS') return 'https';
  if (t === 'SOCKS5' || t === 'SOCKS5H' || t === 'SOCKS') return 'socks5';
  if (t === 'SOCKS4' || t === 'SOCKS4A') return 'socks4';
  return null;
}

function hostForUrl(host) {
  const h = String(host || '').trim().replace(/^\[/, '').replace(/\]$/, '');
  return h.includes(':') ? `[${h}]` : h;
}

function hasLogin(proxy) {
  return Boolean(proxy && ((proxy.username != null && String(proxy.username) !== '') || (proxy.password != null && String(proxy.password) !== '')));
}

// One proxy -> one line, or null when it cannot be written (unknown type, no host, bad port).
// includeCredentials: add the username and password (never for SOCKS4).
function formatExtensionLine(proxy, { includeCredentials = false } = {}) {
  if (!proxy) return null;
  const scheme = extensionScheme(proxy.type);
  if (!scheme) return null;
  const host = hostForUrl(proxy.host);
  const port = Number(proxy.port);
  if (!host || /[\s/@]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  let auth = '';
  if (includeCredentials && scheme !== 'socks4' && hasLogin(proxy)) {
    const user = proxy.username == null ? '' : String(proxy.username);
    const pass = proxy.password == null ? '' : String(proxy.password);
    try {
      auth = `${encodeURIComponent(user)}${pass ? `:${encodeURIComponent(pass)}` : ''}@`;
    } catch (e) {
      return null; // a broken character (lone surrogate) cannot be encoded
    }
  }
  return `${scheme}://${auth}${host}:${port}`;
}

// Counts for the dialog. No hosts, usernames or passwords.
function summarize(proxies) {
  const list = Array.isArray(proxies) ? proxies : [];
  const out = { count: 0, skipped: 0, withLogin: 0, socks5WithLogin: 0, socks4WithLogin: 0 };
  for (const p of list) {
    if (!formatExtensionLine(p)) { out.skipped += 1; continue; }
    out.count += 1;
    if (!hasLogin(p)) continue;
    out.withLogin += 1;
    const scheme = extensionScheme(p.type);
    if (scheme === 'socks5') out.socks5WithLogin += 1;
    if (scheme === 'socks4') out.socks4WithLogin += 1;
  }
  return out;
}

// Proxies -> { text, count, skipped, socks4LoginLeftOut }: one line each, in the order given.
function buildExtensionExport(proxies, { includeCredentials = false } = {}) {
  const lines = [];
  let skipped = 0;
  let socks4LoginLeftOut = 0;
  for (const p of (Array.isArray(proxies) ? proxies : [])) {
    const line = formatExtensionLine(p, { includeCredentials });
    if (!line) { skipped += 1; continue; }
    if (includeCredentials && extensionScheme(p.type) === 'socks4' && hasLogin(p)) socks4LoginLeftOut += 1;
    lines.push(line);
  }
  return { text: lines.join('\n'), count: lines.length, skipped, socks4LoginLeftOut };
}

// Writes text to the clipboard and clears it after delayMs, but only if the clipboard still holds
// that text: anything the user copied since is left alone. A new write replaces the pending clear.
// clipboard: { writeText, readText, clear } (Electron's clipboard module in the main process).
function createClipboardGuard({ clipboard, setTimer = setTimeout, clearTimer = clearTimeout, delayMs = CLEAR_AFTER_MS } = {}) {
  if (!clipboard || typeof clipboard.writeText !== 'function') throw new Error('No clipboard.');
  // Only a hash of the list is kept while waiting, not the passwords. Windows may hand the text
  // back with CRLF line ends, so those count as the same text.
  const digest = (s) => crypto.createHash('sha256').update(String(s == null ? '' : s).replace(/\r\n/g, '\n'), 'utf8').digest('hex');
  let pending = null;
  return {
    write(text) {
      const value = String(text);
      clipboard.writeText(value);
      if (pending) clearTimer(pending.timer);
      const entry = { hash: value ? digest(value) : null, timer: null };
      entry.timer = setTimer(() => {
        if (pending === entry) pending = null;
        let current;
        try { current = clipboard.readText(); } catch (e) { return; }
        if (entry.hash && digest(current) === entry.hash) {
          try { clipboard.clear(); } catch (e) { /* nothing more to do */ }
        }
      }, delayMs);
      if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
      pending = entry;
      return { clearAfterMs: delayMs };
    },
    // For tests: whether a clear is still waiting.
    hasPending() { return pending != null; }
  };
}

module.exports = {
  CLEAR_AFTER_MS,
  extensionScheme,
  formatExtensionLine,
  summarize,
  buildExtensionExport,
  createClipboardGuard
};
