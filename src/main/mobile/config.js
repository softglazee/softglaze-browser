'use strict';
// Settings of the phone companion. Stored in the Setting table under SETTINGS_KEY (plain JSON: no
// secrets here; the PC keys live under IDENTITY_KEY, sealed with safeStorage).
const DEFAULT_RELAY_URL = 'wss://relay.softglaze.com/v1';
const SETTINGS_KEY = 'mobileCompanion';
const IDENTITY_KEY = 'mobileIdentity';
const SYNC_KEYRING_KEY = 'mobileSyncKeyring';
const SYNC_STATE_KEY = 'mobileSyncState';

function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: s.enabled === true,
    relayUrl: typeof s.relayUrl === 'string' && s.relayUrl.trim() ? s.relayUrl.trim() : null,
    pcName: typeof s.pcName === 'string' && s.pcName.trim() ? s.pcName.trim().slice(0, 60) : null,
    // Profile ids (numbers) with "Sync with my phone" on.
    syncProfiles: Array.isArray(s.syncProfiles) ? [...new Set(s.syncProfiles.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [],
    // Profile ids whose proxy password may sync.
    syncProxyPassword: Array.isArray(s.syncProxyPassword) ? [...new Set(s.syncProxyPassword.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []
  };
}

// The relay this PC uses. SG_RELAY_URL wins (local tests), then the stored setting, then the default.
function relayUrlOf(settings, env = process.env) {
  const fromEnv = env && typeof env.SG_RELAY_URL === 'string' && env.SG_RELAY_URL.trim();
  if (fromEnv) return fromEnv;
  return (settings && settings.relayUrl) || DEFAULT_RELAY_URL;
}

// The host name signed into relay auth and sync requests: it must equal the relay's
// RELAY_PUBLIC_HOST. SG_RELAY_HOST overrides it for a relay behind another name.
function relayHostOf(url, env = process.env) {
  const fromEnv = env && typeof env.SG_RELAY_HOST === 'string' && env.SG_RELAY_HOST.trim();
  if (fromEnv) return fromEnv;
  const m = /^(?:wss?|https?):\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(String(url || ''));
  if (!m) throw new Error('Bad relay address.');
  return m[1].replace(/^\[|\]$/g, '');
}

// Plain wss:// only, except ws:// on this computer (tests with a local relay). The phone applies
// the same rule when it reads the QR (decodePairingPayload).
function validateRelayUrl(url) {
  const u = String(url || '').trim();
  if (/^wss:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/.test(u)) return u;
  if (/^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/.test(u)) return u;
  throw new Error('The relay address must start with wss:// (ws:// only for this computer).');
}

module.exports = {
  DEFAULT_RELAY_URL,
  SETTINGS_KEY,
  IDENTITY_KEY,
  SYNC_KEYRING_KEY,
  SYNC_STATE_KEY,
  normalizeSettings,
  relayUrlOf,
  relayHostOf,
  validateRelayUrl
};
