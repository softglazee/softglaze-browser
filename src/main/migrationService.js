'use strict';
// ---------------------------------------------------------------------------
// Profile Migration Service
// ---------------------------------------------------------------------------
// Pulls profiles from competitor anti-detect platforms via their APIs and
// normalizes them into Softglaze's Profile/Proxy shape. This module is
// DB-AGNOSTIC: it only fetches + normalizes. The IPC handler owns persistence,
// the role gate, transactions, and progress streaming.
//
// Cloud platforms (Dolphin{anty}, GoLogin, Multilogin) authenticate with a
// Bearer API token. Local platforms (AdsPower, ixBrowser) expose a loopback
// HTTP API on the user's machine; the "token" is that local API key.
//
// Each adapter is wired to the platform's documented endpoint. Response shapes
// vary by API version, so the normalizers read DEFENSIVELY (multiple field-name
// fallbacks) and anything missing falls back to a Softglaze-generated
// fingerprint default downstream. Validate each adapter against the live API
// before shipping a given platform as "stable".

const PLATFORMS = [
  {
    id: 'dolphin',
    label: 'Dolphin{anty}',
    kind: 'cloud',
    tokenPlaceholder: 'Dolphin_Token (Bearer API token)',
    instructionsUrl: 'https://dolphin-anty.com/docs/basic-templates-api/',
    warning: "Cookies won't be transferred if you're transferring from Dolphin's free plan."
  },
  {
    id: 'gologin',
    label: 'GoLogin',
    kind: 'cloud',
    tokenPlaceholder: 'GoLogin API token',
    instructionsUrl: 'https://gologin.com/docs/api-reference/quick-start'
  },
  {
    id: 'multilogin',
    label: 'Multilogin',
    kind: 'cloud',
    tokenPlaceholder: 'Multilogin automation token',
    instructionsUrl: 'https://documentation.multilogin.com/docs/quick-start-guide'
  },
  {
    id: 'adspower',
    label: 'AdsPower',
    kind: 'local',
    tokenPlaceholder: 'AdsPower Local API Key',
    instructionsUrl: 'https://localapi-doc-en.adspower.com/'
  },
  {
    id: 'ixbrowser',
    label: 'ixBrowser',
    kind: 'local',
    tokenPlaceholder: 'ixBrowser Local API Key',
    instructionsUrl: 'https://ixbrowser.com/'
  }
];

const PLATFORM_IDS = new Set(PLATFORMS.map((p) => p.id));
function isValidPlatform(id) { return PLATFORM_IDS.has(String(id)); }
function getPlatform(id) { return PLATFORMS.find((p) => p.id === String(id)) || null; }

const FETCH_TIMEOUT_MS = 30000;
const MAX_PAGES = 100; // hard cap so a paginated API can never loop forever

// Small fetch wrapper: JSON in/out, timeout, and a clean error message.
async function httpJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON body */ }
    if (!res.ok) {
      const msg = (json && (json.message || json.error || json.msg)) || `HTTP ${res.status}`;
      const err = new Error(String(msg));
      err.status = res.status;
      throw err;
    }
    return json;
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error('The request timed out. Check the token and connection (local platforms must be running with their Local API enabled).');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Platform adapters: each returns an array of RAW competitor profiles ----

// Dolphin{anty} — cloud. GET /browser_profiles (paginated), Bearer token.
async function fetchDolphinProfiles(token) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await httpJson(`https://anty-api.com/browser_profiles?limit=50&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    const batch = (json && (json.data || json.profiles)) || [];
    out.push(...batch);
    const lastPage = json && json.meta && (json.meta.last_page || json.meta.lastPage);
    if (batch.length === 0 || (lastPage && page >= lastPage)) break;
  }
  return out;
}

// GoLogin — cloud. GET /browser/v2, Bearer token.
async function fetchGoLoginProfiles(token) {
  const json = await httpJson('https://api.gologin.com/browser/v2', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  return (json && (json.profiles || json.data)) || (Array.isArray(json) ? json : []);
}

// Multilogin — cloud. Endpoint/shape vary by plan; read defensively and let a
// rejected token surface as a clear error.
async function fetchMultiloginProfiles(token) {
  const json = await httpJson('https://api.multilogin.com/profile/list', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  return (json && (json.data || json.profiles)) || (Array.isArray(json) ? json : []);
}

// AdsPower — LOCAL loopback API. The app must be running with the Local API on.
async function fetchAdsPowerProfiles(token) {
  const base = 'http://local.adspower.net:50325';
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await httpJson(`${base}/api/v1/user/list?page=${page}&page_size=100`, {
      headers: token ? { Authorization: token } : {}
    });
    if (json && json.code !== undefined && json.code !== 0) {
      throw new Error(json.msg || 'AdsPower rejected the request. Is the AdsPower app running with the Local API enabled?');
    }
    const list = (json && json.data && (json.data.list || json.data.data)) || [];
    out.push(...list);
    if (list.length < 100) break;
  }
  return out;
}

// ixBrowser — LOCAL loopback API. POST profile-list.
async function fetchIxBrowserProfiles(token) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await httpJson('http://127.0.0.1:53200/api/v2/profile-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Api-Key': token } : {}) },
      body: JSON.stringify({ page, limit: 100 })
    });
    if (json && json.error && json.error.code) {
      throw new Error(json.error.message || 'ixBrowser rejected the request. Is ixBrowser running with the Local API enabled?');
    }
    const data = (json && json.data) || {};
    const list = data.data || data.list || [];
    out.push(...list);
    const total = Number(data.total || 0);
    if (list.length === 0 || (total && out.length >= total)) break;
  }
  return out;
}

async function fetchProfiles(platform, token) {
  switch (platform) {
    case 'dolphin': return fetchDolphinProfiles(token);
    case 'gologin': return fetchGoLoginProfiles(token);
    case 'multilogin': return fetchMultiloginProfiles(token);
    case 'adspower': return fetchAdsPowerProfiles(token);
    case 'ixbrowser': return fetchIxBrowserProfiles(token);
    default: throw new Error(`Unsupported source platform: ${platform}`);
  }
}

// ---- Normalizer: RAW competitor profile -> Softglaze-shaped object ----------

// First defined/non-empty value across a list of dotted key paths.
function pick(obj, ...keys) {
  for (const key of keys) {
    const v = key.split('.').reduce((o, part) => (o == null ? undefined : o[part]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function normalizeOs(value) {
  const s = String(value || '').toLowerCase();
  if (/win/.test(s)) return 'Windows';
  if (/mac|osx|os x/.test(s)) return 'macOS';
  if (/android/.test(s)) return 'Android';
  if (/linux/.test(s)) return 'Linux';
  return undefined;
}

// Each platform nests proxy data differently. Returns the Softglaze raw-proxy
// string (host:port:user:pass) + a normalized type, or null when there's none.
function normalizeProxy(platform, raw) {
  let p = null;
  if (platform === 'adspower') {
    const c = raw.user_proxy_config || raw.proxy || {};
    if (c.proxy_host) p = { type: c.proxy_type, host: c.proxy_host, port: c.proxy_port, username: c.proxy_user, password: c.proxy_password };
  } else if (platform === 'ixbrowser') {
    if (raw.proxy_ip || raw.proxy_host) p = { type: raw.proxy_type, host: raw.proxy_ip || raw.proxy_host, port: raw.proxy_port, username: raw.proxy_user, password: raw.proxy_password };
  } else {
    const c = raw.proxy || {};
    if (c.host) p = { type: c.type || c.mode, host: c.host, port: c.port, username: c.username || c.login, password: c.password };
  }
  if (!p || !p.host || !p.port) return null;
  const t = String(p.type || 'http').toLowerCase();
  const proxyType = /socks/.test(t) ? 'SOCKS5' : 'HTTP';
  const proxyRaw = [p.host, p.port, p.username || '', p.password || ''].join(':');
  return { proxyRaw, proxyType };
}

function normalizeProfile(platform, raw) {
  const name = pick(raw, 'name', 'title', 'profile_name', 'profileName') || 'Imported Profile';
  const os = normalizeOs(pick(raw, 'os', 'platform', 'osName', 'fingerprint.os', 'browser_fingerprint.os'));
  const userAgent = pick(raw, 'useragent', 'userAgent', 'user_agent', 'fingerprint.userAgent', 'browser_fingerprint.ua', 'navigator.user_agent');
  const proxy = normalizeProxy(platform, raw);
  const notes = pick(raw, 'notes', 'note', 'remark') || `Migrated from ${(getPlatform(platform) || {}).label || platform}`;
  const tagsRaw = pick(raw, 'tags');
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((t) => (typeof t === 'string' ? t : (t && (t.name || t.title)))).filter(Boolean)
    : [];

  return {
    title: String(name).slice(0, 120),
    notes: String(notes).slice(0, 500),
    os: os || undefined,
    userAgent: userAgent ? String(userAgent).trim() : undefined,
    proxyRaw: proxy ? proxy.proxyRaw : null,
    proxyType: proxy ? proxy.proxyType : null,
    tags,
    sourceId: pick(raw, 'id', 'profile_id', 'uuid', '_id')
  };
}

module.exports = { PLATFORMS, isValidPlatform, getPlatform, fetchProfiles, normalizeProfile };
