'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { ipcMain, dialog } = require('electron');

const { getPrisma, getRuntimeConfig, disconnectPrisma } = require('./database');
const {
  parseProxyInput,
  launchProfileSession,
  closeProfileSession,
  closeAllProfileSessions,
  listActiveSessions,
  exportSessionCookies,
  importSessionCookies,
  liveLeakTest
} = require('./browserEngine');
const { parseWorkbookFile, parseBooleanInt, parseSystemProxyBehavior } = require('./importParser');
const { generateFingerprint } = require('./fingerprintGenerator');

const CHANNELS = Object.freeze({
  SYSTEM_GET_INFO: 'system:get-info',

  DASHBOARD_GET_STATS: 'dashboard:get-stats',

  PROXY_LIST: 'proxy:list',
  PROXY_CREATE: 'proxy:create',
  PROXY_UPDATE: 'proxy:update',
  PROXY_DELETE: 'proxy:delete',
  PROXY_BATCH_ADD: 'proxy:batch-add',
  PROXY_CHECK: 'proxy:check',

  PROFILE_LIST: 'profile:list',
  PROFILE_CREATE: 'profile:create',
  PROFILE_UPDATE: 'profile:update',
  PROFILE_DELETE: 'profile:delete',
  PROFILE_LAUNCH: 'profile:launch',
  PROFILE_RESTORE: 'profile:restore',
  PROFILE_PURGE: 'profile:purge',
  PROFILE_LIST_TRASH: 'profile:list-trash',
  PROFILE_BULK_DELETE: 'profile:bulk-delete',
  PROFILE_BULK_RESTORE: 'profile:bulk-restore',
  PROFILE_BULK_PURGE: 'profile:bulk-purge',
  PROFILE_BULK_LAUNCH: 'profile:bulk-launch',
  PROFILE_BULK_CLOSE: 'profile:bulk-close',
  PROFILE_ANALYZE_LEAKS: 'profile:analyze-leaks',
  PROFILE_EXPORT_COOKIES: 'profile:export-cookies',
  PROFILE_IMPORT_COOKIES: 'profile:import-cookies',
  PROFILE_CLONE: 'profile:clone',
  TEMPLATE_LIST: 'template:list',
  TEMPLATE_SAVE: 'template:save',
  TEMPLATE_DELETE: 'template:delete',
  TEMPLATE_CREATE_PROFILE: 'template:create-profile',
  PROFILE_LIVE_LEAK: 'profile:live-leak',
  PROFILE_ACTIVITY: 'profile:activity',
  SETTINGS_GET_SCHEDULER: 'settings:get-proxy-scheduler',
  SETTINGS_SET_SCHEDULER: 'settings:set-proxy-scheduler',
  MEMBER_LIST: 'member:list',
  MEMBER_CREATE: 'member:create',
  MEMBER_UPDATE: 'member:update',
  MEMBER_DELETE: 'member:delete',
  MEMBER_SET_PIN: 'member:set-pin',
  MEMBER_CURRENT: 'member:current',
  MEMBER_SWITCH: 'member:switch',
  MEMBER_SET_INSTRUCTIONS: 'member:set-instructions',
  TEAM_ACTIVITY: 'team:activity',
  VAULT_STATUS: 'vault:status',
  VAULT_SET_PASSWORD: 'vault:set-password',
  VAULT_UNLOCK: 'vault:unlock',
  VAULT_LOCK: 'vault:lock',
  VAULT_DISABLE: 'vault:disable',
  VAULT_SET_AUTOLOCK: 'vault:set-autolock',
  ACCOUNT_GET: 'account:get',
  ACCOUNT_SAVE: 'account:save',
  ACCOUNT_SEND_OTP: 'account:send-otp',
  ACCOUNT_VERIFY_OTP: 'account:verify-otp',
  ACCOUNT_REGISTER: 'account:register',
  EMAIL_GET_CONFIG: 'email:get-config',
  EMAIL_SET_CONFIG: 'email:set-config',
  EMAIL_TEST: 'email:test',

  GROUP_LIST: 'group:list',
  GROUP_CREATE: 'group:create',
  GROUP_UPDATE: 'group:update',
  GROUP_DELETE: 'group:delete',
  GROUP_ASSIGN: 'group:assign',
  TAG_LIST: 'tag:list',

  SESSION_LIST: 'session:list',
  SESSION_CLOSE: 'session:close',

  BATCH_PREVIEW_PROFILES_DIALOG: 'batch:preview-profiles-dialog',
  BATCH_COMMIT_PROFILE_IMPORT: 'batch:commit-profile-import'
});

const VALID_PROXY_TYPES = new Set(['HTTP', 'SOCKS5']);
const VALID_SYSTEM_PROXY_BEHAVIORS = new Set(['DIRECT', 'PROFILE_PROXY', 'SYSTEM_PROXY']);

let registered = false;
let proxySchedulerTimer = null;
let currentMemberId = null;
let vaultLocked = false;
const importPreviewCache = new Map();

function toIpcError(error) {
  return {
    message: error instanceof Error ? error.message : 'Unknown IPC error',
    code: error && typeof error === 'object' && error.code ? String(error.code) : 'IPC_ERROR'
  };
}

function registerHandler(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      const data = await handler(payload, event);
      return { ok: true, data };
    } catch (error) {
      console.error(`[IPC:${channel}]`, error);
      return { ok: false, error: toIpcError(error) };
    }
  });
}

function requireObject(value, label = 'payload') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function optionalString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function requiredString(value, label) {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function parseId(value, label = 'id') {
  const id = Number.parseInt(String(value), 10);
  if (!Number.isInteger(id) || id < 1) throw new Error(`${label} must be a positive integer.`);
  return id;
}

function parseIdArray(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('ids must be a non-empty array.');
  return value.map((v) => parseId(v));
}

async function logActivity(db, profileId, action, detail = null) {
  try { await db.activityLog.create({ data: { profileId, action, detail, memberId: currentMemberId } }); } catch (e) { /* non-fatal */ }
}

function parsePort(value) {
  const port = Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Proxy port must be an integer between 1 and 65535.');
  }
  return port;
}

function parseProxyType(value) {
  const normalized = String(value || 'HTTP').trim().toUpperCase().replace(/^HTTPS$/, 'HTTP').replace(/^SOCKS$/, 'SOCKS5');
  if (!VALID_PROXY_TYPES.has(normalized)) throw new Error('Proxy type must be HTTP or SOCKS5.');
  return normalized;
}

function validateSystemProxyBehavior(value) {
  const normalized = String(value || 'PROFILE_PROXY').trim().toUpperCase();
  if (!VALID_SYSTEM_PROXY_BEHAVIORS.has(normalized)) throw new Error('Invalid system proxy behavior.');
  return normalized;
}

function sanitizeDataDirName(value) {
  const base = String(value || '').trim().replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^\.+/, '').slice(0, 96);
  return base || `profile-${crypto.randomUUID()}`;
}

function buildProxyInfoString(proxy) {
  if (!proxy) return null;
  const username = optionalString(proxy.username);
  const password = optionalString(proxy.password);
  if (username || password) return `${proxy.host}:${proxy.port}:${username || ''}:${password || ''}`;
  return `${proxy.host}:${proxy.port}`;
}

function serializeProxy(proxy) {
  if (!proxy) return null;
  return {
    id: proxy.id,
    name: proxy.name,
    type: proxy.type,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: proxy.password ? '••••••••' : '',
    hasPassword: Boolean(proxy.password),
    createdAt: proxy.createdAt instanceof Date ? proxy.createdAt.toISOString() : proxy.createdAt,
    profileCount: proxy._count?.profiles ?? undefined,
    lastStatus: proxy.lastStatus || null,
    lastLatencyMs: proxy.lastLatencyMs ?? null,
    lastCountry: proxy.lastCountry || null,
    lastCheckedAt: proxy.lastCheckedAt instanceof Date ? proxy.lastCheckedAt.toISOString() : (proxy.lastCheckedAt || null)
  };
}

function serializeProfile(profile) {
  // Safe JSON Parsing for React Arrays/Objects
  let platformAccounts = [];
  try { platformAccounts = profile.platformAccounts ? JSON.parse(profile.platformAccounts) : []; } catch (e) {}

  let syncItems = {};
  try { syncItems = profile.syncItemsJson ? JSON.parse(profile.syncItemsJson) : {}; } catch (e) {}

  let browserSettings = {};
  try { browserSettings = profile.browserSettingsJson ? JSON.parse(profile.browserSettingsJson) : {}; } catch (e) {}

  let tags = [];
  try { tags = profile.tags ? JSON.parse(profile.tags) : []; if (!Array.isArray(tags)) tags = []; } catch (e) { tags = []; }

  return {
    ...profile,
    platformAccounts,
    syncItems,
    browserSettings,
    tags,
    lastUsedAt: profile.lastUsedAt instanceof Date ? profile.lastUsedAt.toISOString() : (profile.lastUsedAt || null),
    launchCount: profile.launchCount ?? 0,
    group: profile.group
      ? {
          id: profile.group.id,
          name: profile.group.name,
          color: profile.group.color,
          createdAt: profile.group.createdAt instanceof Date ? profile.group.createdAt.toISOString() : profile.group.createdAt
        }
      : null,
    createdAt: profile.createdAt instanceof Date ? profile.createdAt.toISOString() : profile.createdAt,
    updatedAt: profile.updatedAt instanceof Date ? profile.updatedAt.toISOString() : profile.updatedAt,
    proxy: serializeProxy(profile.proxy)
  };
}

// Maps incoming React Payload to Prisma Schema keys
function extractFingerprintData(input) {
  return {
    browserCore: input.browserCore,
    browserVersion: input.browserVersion,
    os: input.os,
    osVersion: input.osVersion,
    userAgent: input.userAgent || 'Auto',
    startupUrls: input.startupUrls,
    platformAccounts: input.platformAccounts ? JSON.stringify(input.platformAccounts) : null,
    
    webrtc: input.webrtc,
    timezoneType: input.timezoneType,
    timezoneCustom: input.timezoneCustom,
    locationType: input.locationType,
    locationPrompt: input.locationPrompt,
    locationLat: input.locationLat,
    locationLng: input.locationLng,
    locationAcc: input.locationAcc,
    
    languageType: input.languageType,
    languageCustom: input.languageCustom,
    displayLangType: input.displayLangType,
    displayLangCustom: input.displayLangCustom,
    resolutionType: input.resolutionType,
    resolutionW: input.resolutionW,
    resolutionH: input.resolutionH,
    fontsType: input.fontsType,
    
    canvasNoise: input.canvasNoise !== false,
    webglImageNoise: input.webglImageNoise !== false,
    audioContextNoise: input.audioContextNoise !== false,
    clientRectsNoise: input.clientRectsNoise !== false,
    speechVoicesNoise: input.speechVoicesNoise !== false,
    mediaDevice: input.mediaDevice,
    
    webglMetadata: input.webglMetadata,
    webglVendor: input.webglVendor,
    webglRenderer: input.webglRenderer,
    webgpu: input.webgpu,
    
    cpuType: input.cpuType,
    cpuCores: input.cpuCores,
    ramType: input.ramType,
    ramGb: input.ramGb,
    
    deviceNameType: input.deviceNameType,
    deviceName: input.deviceName,
    macAddressType: input.macAddressType,
    macAddress: input.macAddress,
    
    doNotTrack: input.doNotTrack,
    portScanProtection: input.portScanProtection,
    hardwareAcceleration: input.hardwareAcceleration,
    disableTls: input.disableTls,
    launchArgs: input.launchArgs,
    
    advancedExt: input.advancedExt,
    advancedSync: input.advancedSync,
    syncItemsJson: input.syncItems ? JSON.stringify(input.syncItems) : null,
    advancedBrowser: input.advancedBrowser,
    browserSettingsJson: input.browserSettings ? JSON.stringify(input.browserSettings) : null,
    randomFingerprint: input.randomFingerprint === true,
  };
}

// When randomFingerprint is set, a freshly generated fingerprint is the base and
// any explicit fields the caller sends still override it. Otherwise we just map
// the caller's payload as before.
function buildFingerprintFields(input) {
  const manual = extractFingerprintData(input);
  if (input.randomFingerprint !== true) return manual;
  const merged = { ...generateFingerprint() };
  for (const [key, value] of Object.entries(manual)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

async function ensureUniqueDataDirName(db, desiredName, excludeProfileId = null) {
  const base = sanitizeDataDirName(desiredName);
  let candidate = base;
  for (let i = 0; i < 25; i += 1) {
    const existing = await db.profile.findUnique({ where: { dataDirName: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeProfileId) return candidate;
    candidate = `${base}-${crypto.randomBytes(3).toString('hex')}`;
  }
  return `${base}-${crypto.randomUUID()}`;
}

function resolveProfileDataDir(dataDirName) {
  const { profileRoot } = getRuntimeConfig();
  const root = path.resolve(profileRoot);
  const target = path.resolve(root, sanitizeDataDirName(dataDirName));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Profile directory resolved outside the profile root.');
  }
  return target;
}

function parseColonProxyLine(rawLine, fallbackType = 'HTTP') {
  const raw = requiredString(rawLine, 'Proxy line');
  if (/^[a-zA-Z0-9]+:\/\//.test(raw) || raw.includes('@')) return parseProxyInput(raw);
  const parts = raw.split(/\s*:\s*/);
  if (parts.length < 2) throw new Error(`Invalid proxy line: ${raw}`);
  return parseProxyInput({
    type: fallbackType,
    host: parts[0],
    port: parts[1],
    username: parts[2] || null,
    password: parts.slice(3).join(':') || null
  });
}

async function findOrCreateProxy(db, proxyInput, nameFallback = null) {
  const parsed = parseProxyInput(proxyInput);
  if (!parsed) return null;

  const existing = await db.proxy.findFirst({
    where: { type: parsed.type, host: parsed.host, port: parsed.port, username: parsed.username }
  });

  if (existing) {
    if (parsed.password && existing.password !== parsed.password) {
      return db.proxy.update({ where: { id: existing.id }, data: { password: parsed.password } });
    }
    return existing;
  }

  return db.proxy.create({
    data: {
      name: nameFallback || `${parsed.type} ${parsed.host}:${parsed.port}`,
      type: parsed.type,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password
    }
  });
}

async function listProxies(payload = {}) {
  const db = getPrisma();
  const search = optionalString(payload.search);
  const where = search
    ? { OR: [{ name: { contains: search } }, { host: { contains: search } }, { username: { contains: search } }] }
    : undefined;

  const proxies = await db.proxy.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { profiles: true } } }
  });

  return proxies.map(serializeProxy);
}

async function createProxy(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const parsed = parseProxyInput({
    type: parseProxyType(input.type),
    host: requiredString(input.host, 'Proxy host'),
    port: parsePort(input.port),
    username: optionalString(input.username),
    password: optionalString(input.password)
  });

  const existing = await db.proxy.findFirst({
    where: { type: parsed.type, host: parsed.host, port: parsed.port, username: parsed.username },
    select: { id: true }
  });
  if (existing) throw new Error('A proxy with the same type, host, port, and username already exists.');

  const created = await db.proxy.create({
    data: {
      name: requiredString(input.name || `${parsed.type} ${parsed.host}:${parsed.port}`, 'Proxy name'),
      type: parsed.type,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password
    }
  });

  return serializeProxy(created);
}

async function updateProxy(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const data = {};

  if (input.name !== undefined) data.name = requiredString(input.name, 'Proxy name');
  if (input.type !== undefined) data.type = parseProxyType(input.type);
  if (input.host !== undefined) data.host = requiredString(input.host, 'Proxy host');
  if (input.port !== undefined) data.port = parsePort(input.port);
  if (input.username !== undefined) data.username = optionalString(input.username);
  if (input.password !== undefined && input.password !== '••••••••') data.password = optionalString(input.password);

  const updated = await db.proxy.update({ where: { id }, data });
  return serializeProxy(updated);
}

async function deleteProxy(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await db.proxy.delete({ where: { id } });
  return { deleted: true, id };
}

async function batchAddProxies(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const raw = requiredString(input.raw, 'Raw proxy batch');
  const fallbackType = parseProxyType(input.type || 'HTTP');
  const namePrefix = optionalString(input.namePrefix);
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result = { total: lines.length, created: [], skipped: [], errors: [] };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    try {
      const parsed = parseColonProxyLine(line, fallbackType);
      const existing = await db.proxy.findFirst({
        where: { type: parsed.type, host: parsed.host, port: parsed.port, username: parsed.username }
      });

      if (existing) {
        result.skipped.push({ line: index + 1, reason: 'DUPLICATE', proxy: serializeProxy(existing) });
        continue;
      }

      const created = await db.proxy.create({
        data: {
          name: namePrefix ? `${namePrefix} ${index + 1}` : `${parsed.type} ${parsed.host}:${parsed.port}`,
          type: parsed.type,
          host: parsed.host,
          port: parsed.port,
          username: parsed.username,
          password: parsed.password
        }
      });
      result.created.push(serializeProxy(created));
    } catch (error) {
      result.errors.push({ line: index + 1, raw: line, message: error instanceof Error ? error.message : 'Unknown parse error' });
    }
  }

  return result;
}

// Performs a real HTTP(S) GET through the supplied http.Agent and resolves the
// parsed JSON body. Enforces a hard timeout and a small response-size cap.
// Performs a real HTTP(S) GET through the supplied http.Agent and resolves the
// parsed JSON body. Enforces a hard timeout, response-size cap, and safe cleanup.
function httpGetJson(url, agent, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let lib;
    try {
      const parsed = new URL(url);
      lib = parsed.protocol === 'https:' ? require('node:https') : require('node:http');
    } catch (e) {
      return reject(new Error('Invalid IP-service URL.'));
    }

    let isDone = false;
    let timeoutId;

    const cleanup = () => {
      isDone = true;
      if (timeoutId) clearTimeout(timeoutId);
    };

    const req = lib.get(
      url,
      { agent, headers: { 'User-Agent': 'SoftGlaze-ProxyCheck/1.0', Accept: 'application/json' } },
      (res) => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          res.resume(); // Consume response data to free memory
          cleanup();
          return reject(new Error(`IP service returned HTTP ${status}.`));
        }

        let body = '';
        res.setEncoding('utf8');
        
        res.on('data', (chunk) => {
          if (isDone) return;
          body += chunk;
          if (body.length > 1_000_000) {
            cleanup();
            req.destroy();
            reject(new Error('IP service response too large.'));
          }
        });
        
        res.on('end', () => {
          if (isDone) return;
          cleanup();
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('Could not parse IP service response.')); }
        });
      }
    );

    timeoutId = setTimeout(() => {
      if (isDone) return;
      cleanup();
      req.destroy();
      reject(new Error('Proxy connection timed out.'));
    }, timeoutMs);

    req.on('error', (err) => {
      if (isDone) return;
      cleanup();
      reject(err);
    });
  });
}

// Routes a request to an IP/geo service THROUGH the given proxy and returns
// { success, ip, country, city, isp, latencyMs } (or { success:false, error }).
async function testProxyConnectivity(proxy) {
  let ProxyAgent;
  try {
    ({ ProxyAgent } = require('proxy-agent'));
  } catch (e) {
    return { success: false, error: 'Proxy agent module unavailable. Run "npm install" with the app closed.' };
  }

  const scheme = String(proxy.type).toLowerCase() === 'socks5' ? 'socks5' : 'http';
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
    : '';
  const proxyUrl = `${scheme}://${auth}${proxy.host}:${proxy.port}`;
  const agent = new ProxyAgent({ getProxyForUrl: () => proxyUrl });

  const started = Date.now();

  // Primary: HTTPS endpoint — works through both HTTP CONNECT tunnels and SOCKS5.
  try {
    const data = await httpGetJson('https://ipinfo.io/json', agent, 15000);
    return {
      success: true,
      ip: data.ip || null,
      country: data.country || null,
      city: data.city || null,
      isp: data.org || null,
      timezone: data.timezone || null,
      latencyMs: Date.now() - started
    };
  } catch (primaryError) {
    // Fallback: ip-api over plain HTTP (some proxies block 443 or SNI).
    try {
      const data = await httpGetJson(
        'http://ip-api.com/json/?fields=status,message,query,country,countryCode,city,isp,timezone',
        agent,
        15000
      );
      if (data.status && data.status !== 'success') {
        return { success: false, error: data.message || 'Proxy check failed.', latencyMs: Date.now() - started };
      }
      return {
        success: true,
        ip: data.query || null,
        country: data.countryCode || data.country || null,
        city: data.city || null,
        isp: data.isp || null,
        timezone: data.timezone || null,
        latencyMs: Date.now() - started
      };
    } catch (fallbackError) {
      const message = (fallbackError && fallbackError.message) || (primaryError && primaryError.message) || 'Proxy connection failed.';
      return { success: false, error: message, latencyMs: Date.now() - started };
    }
  }
}

// Accepts { id } (a saved proxy), { raw, type }, or { host, port, username, password, type }.
async function checkProxy(payload) {
  const input = requireObject(payload);
  let proxy = null;
  let savedId = null;

  if (input.id !== undefined && input.id !== null) {
    const db = getPrisma();
    savedId = parseId(input.id);
    const found = await db.proxy.findUnique({ where: { id: savedId } });
    if (!found) throw new Error('Proxy not found.');
    proxy = { type: found.type, host: found.host, port: found.port, username: found.username, password: found.password };
  } else if (input.raw) {
    proxy = parseProxyInput(input.raw);
    if (proxy && input.type) proxy.type = parseProxyType(input.type);
  } else if (input.host) {
    proxy = parseProxyInput({
      type: input.type,
      host: input.host,
      port: input.port,
      username: optionalString(input.username),
      password: optionalString(input.password)
    });
  }

  if (!proxy || !proxy.host || !proxy.port) throw new Error('No valid proxy provided to check.');

  const result = await testProxyConnectivity(proxy);

  // Persist health for saved proxies so the pool shows durable status badges.
  if (savedId !== null) {
    await persistProxyHealth(getPrisma(), savedId, result);
  }

  return result;
}

// Cross-checks a profile's fingerprint configuration against its proxy's real
// exit geo and reports per-vector pass/warn/fail. Static analysis (no browser
// launch): WebRTC/timezone/language are evaluated from configuration + the live
// proxy lookup, which catches the common, high-signal leaks.
async function analyzeProfileLeaks(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const profile = await db.profile.findUnique({ where: { id }, include: { proxy: true } });
  if (!profile) throw new Error('Profile not found.');

  const usesProxy = profile.systemProxyBehavior === 'PROFILE_PROXY' && Boolean(profile.proxy);
  const checks = [];
  let geo = null;

  // 1) IP / proxy connectivity
  if (usesProxy) {
    geo = await testProxyConnectivity({
      type: profile.proxy.type,
      host: profile.proxy.host,
      port: profile.proxy.port,
      username: profile.proxy.username,
      password: profile.proxy.password
    });
    if (geo.success) {
      checks.push({
        key: 'ip', label: 'IP / Proxy', status: 'pass',
        detail: `Exit ${geo.ip || '?'}${geo.country ? ` · ${geo.country}` : ''}${geo.isp ? ` · ${geo.isp}` : ''} (${geo.latencyMs}ms)`
      });
    } else {
      checks.push({ key: 'ip', label: 'IP / Proxy', status: 'fail', detail: `Proxy failed: ${geo.error || 'no connection'}` });
    }
  } else {
    checks.push({ key: 'ip', label: 'IP / Proxy', status: 'warn', detail: 'No profile proxy in use — the machine\'s real IP is exposed.' });
  }

  // 2) WebRTC
  const webrtc = profile.webrtc || 'Forward';
  if (webrtc === 'Real') {
    checks.push({
      key: 'webrtc', label: 'WebRTC', status: usesProxy ? 'fail' : 'warn',
      detail: usesProxy
        ? 'Set to "Real" — WebRTC can expose the real IP behind the proxy.'
        : 'Set to "Real" (no proxy) — real IP visible via WebRTC.'
    });
  } else {
    checks.push({ key: 'webrtc', label: 'WebRTC', status: 'pass', detail: `Mode "${webrtc}" — real IP not leaked via WebRTC.` });
  }

  // 3) Timezone
  const tzType = profile.timezoneType || 'Based on IP';
  if (tzType === 'Based on IP') {
    checks.push({
      key: 'timezone', label: 'Timezone', status: usesProxy ? 'pass' : 'warn',
      detail: usesProxy ? `Auto from proxy${geo && geo.timezone ? ` (${geo.timezone})` : ''}.` : 'Based on IP, but no proxy is set.'
    });
  } else if (tzType === 'Real') {
    checks.push({ key: 'timezone', label: 'Timezone', status: 'warn', detail: 'Using the host timezone — may not match the proxy location.' });
  } else {
    const want = optionalString(profile.timezoneCustom);
    if (usesProxy && geo && geo.success && geo.timezone && want) {
      const match = geo.timezone === want;
      checks.push({
        key: 'timezone', label: 'Timezone', status: match ? 'pass' : 'fail',
        detail: match ? `Custom ${want} matches proxy.` : `Custom ${want} \u2260 proxy ${geo.timezone}.`
      });
    } else {
      checks.push({ key: 'timezone', label: 'Timezone', status: 'warn', detail: `Custom ${want || '(unset)'} — could not compare to proxy.` });
    }
  }

  // 4) Language
  const langType = profile.languageType || 'Based on IP';
  if (langType === 'Based on IP') {
    checks.push({ key: 'language', label: 'Language', status: 'pass', detail: usesProxy ? 'Auto from proxy country.' : 'Based on IP.' });
  } else {
    const lc = optionalString(profile.languageCustom) || '';
    const m = lc.match(/[a-z]{2}-([A-Z]{2})/);
    const region = m ? m[1] : null;
    if (usesProxy && geo && geo.success && geo.country && region) {
      const match = region === geo.country;
      checks.push({
        key: 'language', label: 'Language', status: match ? 'pass' : 'warn',
        detail: match ? `Locale region ${region} matches proxy.` : `Locale ${region} \u2260 proxy country ${geo.country}.`
      });
    } else {
      checks.push({ key: 'language', label: 'Language', status: 'warn', detail: `Custom (${lc || 'unset'}) — could not compare to proxy.` });
    }
  }

  // 5) Geolocation
  const locType = profile.locationType || 'Based on IP';
  if (locType === 'Based on IP') {
    checks.push({ key: 'geo', label: 'Geolocation', status: 'pass', detail: 'Auto from IP.' });
  } else if (locType === 'Block') {
    checks.push({ key: 'geo', label: 'Geolocation', status: 'pass', detail: 'Blocked — no location shared.' });
  } else {
    checks.push({
      key: 'geo', label: 'Geolocation', status: 'warn',
      detail: `Custom (${optionalString(profile.locationLat) || '?'}, ${optionalString(profile.locationLng) || '?'}) — verify it matches the proxy region.`
    });
  }

  // 6) Fingerprint noise protection
  const noiseOn = profile.canvasNoise && profile.webglImageNoise && profile.audioContextNoise;
  checks.push({
    key: 'fp', label: 'Fingerprint noise', status: noiseOn ? 'pass' : 'warn',
    detail: noiseOn ? 'Canvas / WebGL / Audio noise enabled.' : 'One or more fingerprint-noise toggles are off.'
  });

  const summary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length
  };

  return { profileId: id, title: profile.title, usesProxy, geo, checks, summary };
}

// ---------- Cookie import/export (per profile, via the live session) ----------

function cookiesToNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# Generated by SoftGlaze', ''];
  for (const c of cookies) {
    const domain = c.domain || '';
    const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const path = c.path || '/';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expiry = Math.floor(Number(c.expires) > 0 ? Number(c.expires) : 0);
    const prefix = c.httpOnly ? '#HttpOnly_' : '';
    lines.push(`${prefix}${domain}\t${includeSub}\t${path}\t${secure}\t${expiry}\t${c.name}\t${c.value}`);
  }
  return lines.join('\n');
}

function netscapeToCookies(text) {
  const out = [];
  for (let line of String(text).split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) { httpOnly = true; line = line.slice('#HttpOnly_'.length); }
    else if (line.startsWith('#')) continue;
    let parts = line.split('\t');
    if (parts.length < 7) parts = line.split(/\s+/);
    if (parts.length < 7) continue;
    const domain = parts[0];
    const path = parts[2] || '/';
    const secure = String(parts[3]).toUpperCase() === 'TRUE';
    const expires = Number(parts[4]) || 0;
    const name = parts[5];
    const value = parts.slice(6).join('\t');
    out.push({ domain, path, secure, expires, name, value, httpOnly });
  }
  return out;
}

function parseJsonCookies(text) {
  let data = JSON.parse(text);
  if (data && Array.isArray(data.cookies)) data = data.cookies;
  if (!Array.isArray(data)) throw new Error('JSON cookies must be an array, or an object with a "cookies" array.');
  return data;
}

// Maps a loose cookie object to a CDP Network.setCookies CookieParam.
function toSetCookieParam(c) {
  if (!c || !c.name) return null;
  const param = { name: String(c.name), value: c.value == null ? '' : String(c.value) };
  if (c.domain) param.domain = String(c.domain);
  if (c.url) param.url = String(c.url);
  if (!param.domain && !param.url) return null; // CDP needs domain or url
  param.path = c.path ? String(c.path) : '/';
  if (typeof c.secure === 'boolean') param.secure = c.secure;
  if (typeof c.httpOnly === 'boolean') param.httpOnly = c.httpOnly;
  if (c.sameSite && ['Strict', 'Lax', 'None'].includes(c.sameSite)) param.sameSite = c.sameSite;
  const exp = Number(c.expires);
  if (Number.isFinite(exp) && exp > 0) param.expires = exp;
  return param;
}

async function exportProfileCookies(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id);
  const format = (optionalString(input.format) || 'json').toLowerCase();
  const cookies = await exportSessionCookies(String(id));
  if (cookies === null) throw new Error('Profile is not running. Launch it first to export its cookies.');
  const content = format === 'netscape' ? cookiesToNetscape(cookies) : JSON.stringify(cookies, null, 2);
  return { format, count: cookies.length, content };
}

async function importProfileCookies(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id);
  const format = (optionalString(input.format) || 'json').toLowerCase();
  const data = requiredString(input.data, 'Cookie data');

  let parsed;
  try {
    parsed = format === 'netscape' ? netscapeToCookies(data) : parseJsonCookies(data);
  } catch (e) {
    throw new Error(`Could not parse ${format} cookies: ${e instanceof Error ? e.message : 'invalid format'}`);
  }

  const params = parsed.map(toSetCookieParam).filter(Boolean);
  if (params.length === 0) throw new Error('No valid cookies found to import.');

  const result = await importSessionCookies(String(id), params);
  if (result === null) throw new Error('Profile is not running. Launch it first to import cookies into its session.');
  return { imported: result.imported, parsed: parsed.length };
}

// ---------- Clone & Templates ----------

// Columns that are identity/bookkeeping and must NOT be carried into a copy.
const CLONE_EXCLUDE = new Set(['id', 'dataDirName', 'title', 'createdAt', 'updatedAt', 'deletedAt']);

function pickCloneableFields(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (CLONE_EXCLUDE.has(k)) continue;
    if (k === 'proxy' || k === 'group') continue; // relation objects, never present on a scalar row
    out[k] = v;
  }
  return out;
}

function randomMac() {
  const h = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
  return [h(), h(), h(), h(), h(), h()].join(':');
}

function randomDeviceName() {
  const prefixes = ['DESKTOP', 'LAPTOP', 'PC', 'WORKSTATION'];
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefixes[Math.floor(Math.random() * prefixes.length)]}-${suffix}`;
}

function serializeTemplate(t) {
  let summary = {};
  try {
    const d = JSON.parse(t.dataJson || '{}');
    summary = {
      os: d.os || null,
      browserCore: d.browserCore || null,
      resolution: d.resolutionW && d.resolutionH ? `${d.resolutionW}x${d.resolutionH}` : null,
      hasProxy: Boolean(d.proxyId)
    };
  } catch (e) { /* ignore */ }
  return {
    id: t.id,
    name: t.name,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
    summary
  };
}

// Resolve proxy/group references in a field set, nulling any that no longer exist.
async function reconcileReferences(db, fields) {
  if (fields.proxyId) {
    const proxy = await db.proxy.findUnique({ where: { id: fields.proxyId } });
    if (!proxy) { fields.proxyId = null; fields.proxyInfoString = null; }
  }
  if (fields.groupId) {
    const group = await db.group.findUnique({ where: { id: fields.groupId } });
    if (!group) fields.groupId = null;
  }
  return fields;
}

async function cloneProfile(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const src = await db.profile.findUnique({ where: { id } });
  if (!src) throw new Error('Profile not found.');

  const fields = await reconcileReferences(db, pickCloneableFields(src));
  const title = `${src.title} (copy)`;
  const dataDirName = await ensureUniqueDataDirName(db, title);

  // Regenerate hardware identity so the copy is not a byte-identical twin.
  const created = await db.profile.create({
    data: { ...fields, title, dataDirName, macAddress: randomMac(), deviceName: randomDeviceName() },
    include: { proxy: true, group: true }
  });
  return serializeProfile(created);
}

async function saveProfileAsTemplate(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const name = requiredString(input.name, 'Template name');
  const src = await db.profile.findUnique({ where: { id } });
  if (!src) throw new Error('Profile not found.');
  const fields = pickCloneableFields(src);
  const created = await db.template.create({ data: { name, dataJson: JSON.stringify(fields) } });
  return serializeTemplate(created);
}

async function listTemplates() {
  const db = getPrisma();
  const rows = await db.template.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map(serializeTemplate);
}

async function deleteTemplate(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await db.template.delete({ where: { id } });
  return { deleted: true, id };
}

async function createProfileFromTemplate(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const templateId = parseId(input.templateId, 'templateId');
  const tpl = await db.template.findUnique({ where: { id: templateId } });
  if (!tpl) throw new Error('Template not found.');

  let fields;
  try { fields = JSON.parse(tpl.dataJson || '{}'); }
  catch (e) { throw new Error('Template data is corrupted.'); }
  if (!fields || typeof fields !== 'object') throw new Error('Template data is invalid.');

  const title = requiredString(input.title || tpl.name, 'Profile title');
  await reconcileReferences(db, fields);
  const dataDirName = await ensureUniqueDataDirName(db, title);

  const created = await db.profile.create({
    data: { ...fields, title, dataDirName, macAddress: randomMac(), deviceName: randomDeviceName() },
    include: { proxy: true, group: true }
  });
  return serializeProfile(created);
}

async function listProfiles(payload = {}) {
  const db = getPrisma();
  const search = optionalString(payload.search);
  const where = { deletedAt: null };
  if (search) {
    where.OR = [{ title: { contains: search } }, { notes: { contains: search } }, { dataDirName: { contains: search } }, { proxyInfoString: { contains: search } }];
  }

  const profiles = await db.profile.findMany({ where, orderBy: { createdAt: 'desc' }, include: { proxy: true, group: true } });
  return profiles.map(serializeProfile);
}

async function listTrash() {
  const db = getPrisma();
  const profiles = await db.profile.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    include: { proxy: true, group: true }
  });
  return profiles.map(serializeProfile);
}

async function createProfile(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const title = requiredString(input.title, 'Profile title');
  let proxy = null;
  let proxyId = input.proxyId ? parseId(input.proxyId, 'proxyId') : null;

  if (input.proxyRaw) {
    proxy = await findOrCreateProxy(db, input.proxyRaw, `${title} Proxy`);
    proxyId = proxy.id;
  } else if (proxyId) {
    proxy = await db.proxy.findUnique({ where: { id: proxyId } });
    if (!proxy) throw new Error('Selected proxy does not exist.');
  }

  const dataDirName = await ensureUniqueDataDirName(db, input.dataDirName || title);
  
  const created = await db.profile.create({
    data: {
      title,
      proxyId,
      proxyInfoString: proxy ? buildProxyInfoString(proxy) : optionalString(input.proxyInfoString),
      notes: optionalString(input.notes),
      systemProxyBehavior: validateSystemProxyBehavior(input.systemProxyBehavior),
      dataDirName,
      groupId: input.groupId ? parseId(input.groupId, 'groupId') : null,
      tags: Array.isArray(input.tags) ? JSON.stringify(input.tags) : null,
      ...buildFingerprintFields(input) // generator-aware fingerprint injection
    },
    include: { proxy: true, group: true }
  });

  await logActivity(db, created.id, 'create', `created "${created.title}"`);
  return serializeProfile(created);
}

async function updateProfile(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const existing = await db.profile.findUnique({ where: { id }, include: { proxy: true } });
  if (!existing) throw new Error('Profile not found.');

  const data = { ...extractFingerprintData(input) }; // Inject all React payload fields
  if (input.title !== undefined) data.title = requiredString(input.title, 'Profile title');
  if (input.notes !== undefined) data.notes = optionalString(input.notes);
  if (input.systemProxyBehavior !== undefined) data.systemProxyBehavior = validateSystemProxyBehavior(input.systemProxyBehavior);

  if (input.groupId !== undefined) {
    data.groupId = (input.groupId === null || input.groupId === '') ? null : parseId(input.groupId, 'groupId');
  }
  if (Array.isArray(input.tags)) {
    data.tags = JSON.stringify(input.tags);
  }

  if (input.proxyId !== undefined) {
    if (input.proxyId === null || input.proxyId === '') {
      data.proxyId = null;
      data.proxyInfoString = null;
    } else {
      const proxyId = parseId(input.proxyId, 'proxyId');
      const proxy = await db.proxy.findUnique({ where: { id: proxyId } });
      if (!proxy) throw new Error('Selected proxy does not exist.');
      data.proxyId = proxyId;
      data.proxyInfoString = buildProxyInfoString(proxy);
    }
  }

  if (input.proxyRaw) {
    const proxy = await findOrCreateProxy(db, input.proxyRaw, `${existing.title} Proxy`);
    data.proxyId = proxy.id;
    data.proxyInfoString = buildProxyInfoString(proxy);
  }

  if (input.dataDirName !== undefined) {
    const requestedDir = sanitizeDataDirName(input.dataDirName);
    if (requestedDir !== existing.dataDirName) data.dataDirName = await ensureUniqueDataDirName(db, requestedDir, id);
  }

  // Undefined properties from extractFingerprintData will be ignored by Prisma
  Object.keys(data).forEach(key => data[key] === undefined && delete data[key]);

  const updated = await db.profile.update({ where: { id }, data, include: { proxy: true, group: true } });
  await logActivity(db, updated.id, 'update', `edited "${updated.title}"`);
  return serializeProfile(updated);
}

async function deleteProfile(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const existing = await db.profile.findUnique({ where: { id } });
  if (!existing) throw new Error('Profile not found.');

  // Move to Trash (soft delete). Close any running session first. Local data is
  // KEPT so the profile can be restored; it is only wiped on permanent purge.
  await closeProfileSession(String(id)).catch(() => {});
  await db.profile.update({ where: { id }, data: { deletedAt: new Date() } });

  await logActivity(db, id, 'delete', `moved "${existing.title}" to Trash`);
  return { trashed: true, id };
}

async function restoreProfile(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const existing = await db.profile.findUnique({ where: { id } });
  if (!existing) throw new Error('Profile not found.');
  await db.profile.update({ where: { id }, data: { deletedAt: null } });
  await logActivity(db, id, 'restore', `restored "${existing.title}"`);
  return { restored: true, id };
}

async function purgeProfile(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const removeLocalData = Boolean(input.removeLocalData);
  const existing = await db.profile.findUnique({ where: { id } });
  if (!existing) throw new Error('Profile not found.');

  await closeProfileSession(String(id)).catch(() => {});
  await db.profile.delete({ where: { id } });

  if (removeLocalData) {
    const dataDir = resolveProfileDataDir(existing.dataDirName);
    await fs.rm(dataDir, { recursive: true, force: true });
  }

  return { purged: true, id, removedLocalData: removeLocalData };
}

async function bulkDeleteProfiles(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const result = { trashed: [], errors: [] };
  for (const id of ids) {
    try {
      await closeProfileSession(String(id)).catch(() => {});
      await db.profile.update({ where: { id }, data: { deletedAt: new Date() } });
      await logActivity(db, id, 'delete', 'moved to Trash (bulk)');
      result.trashed.push(id);
    } catch (error) {
      result.errors.push({ id, message: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
  return result;
}

async function bulkRestoreProfiles(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const result = { restored: [], errors: [] };
  for (const id of ids) {
    try {
      await db.profile.update({ where: { id }, data: { deletedAt: null } });
      result.restored.push(id);
    } catch (error) {
      result.errors.push({ id, message: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
  return result;
}

async function bulkPurgeProfiles(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const removeLocalData = Boolean(input.removeLocalData);
  const result = { purged: [], errors: [] };
  for (const id of ids) {
    try {
      const existing = await db.profile.findUnique({ where: { id } });
      if (!existing) { result.errors.push({ id, message: 'Profile not found.' }); continue; }
      await closeProfileSession(String(id)).catch(() => {});
      await db.profile.delete({ where: { id } });
      if (removeLocalData) {
        await fs.rm(resolveProfileDataDir(existing.dataDirName), { recursive: true, force: true });
      }
      result.purged.push(id);
    } catch (error) {
      result.errors.push({ id, message: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
  return result;
}

async function bulkLaunchProfiles(payload) {
  const input = requireObject(payload);
  const ids = parseIdArray(input.ids);
  const result = { launched: [], errors: [] };
  for (const id of ids) {
    try {
      const session = await launchProfile({ id });
      result.launched.push({ id, sessionId: session.sessionId });
    } catch (error) {
      result.errors.push({ id, message: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
  return result;
}

async function bulkCloseSessions(payload) {
  const input = requireObject(payload);
  const ids = parseIdArray(input.ids);
  const result = { closed: [], errors: [] };
  for (const id of ids) {
    try {
      const r = await closeProfileSession(String(id));
      if (r.closed) result.closed.push(id);
    } catch (error) {
      result.errors.push({ id, message: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
  return result;
}

function collectTags(rows) {
  const tagSet = new Set();
  for (const r of rows) {
    try {
      const arr = r.tags ? JSON.parse(r.tags) : [];
      if (Array.isArray(arr)) arr.forEach((t) => { if (t) tagSet.add(String(t)); });
    } catch (e) { /* ignore malformed tag JSON */ }
  }
  return [...tagSet];
}

async function listGroups() {
  const db = getPrisma();
  const groups = await db.group.findMany({
    orderBy: { createdAt: 'desc' },
    include: { profiles: { where: { deletedAt: null }, select: { tags: true } } }
  });
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : g.createdAt,
    profileCount: g.profiles.length,
    tags: collectTags(g.profiles)
  }));
}

async function createGroup(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const name = requiredString(input.name, 'Group name');
  const color = optionalString(input.color) || '#3b82f6';
  const created = await db.group.create({ data: { name, color } });
  return {
    id: created.id,
    name: created.name,
    color: created.color,
    createdAt: created.createdAt instanceof Date ? created.createdAt.toISOString() : created.createdAt,
    profileCount: 0,
    tags: []
  };
}

async function updateGroup(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const data = {};
  if (input.name !== undefined) data.name = requiredString(input.name, 'Group name');
  if (input.color !== undefined) data.color = optionalString(input.color) || '#3b82f6';
  const updated = await db.group.update({ where: { id }, data });
  return { id: updated.id, name: updated.name, color: updated.color };
}

async function deleteGroup(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  // The runtime SQLite Profile table has no DB-level FK for groupId, so detach
  // member profiles explicitly before removing the group (no dangling refs).
  await db.profile.updateMany({ where: { groupId: id }, data: { groupId: null } });
  await db.group.delete({ where: { id } });
  return { deleted: true, id };
}

async function assignProfilesToGroup(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const groupId = (input.groupId === null || input.groupId === undefined || input.groupId === '')
    ? null
    : parseId(input.groupId, 'groupId');
  if (groupId !== null) {
    const group = await db.group.findUnique({ where: { id: groupId } });
    if (!group) throw new Error('Selected group does not exist.');
  }
  const res = await db.profile.updateMany({ where: { id: { in: ids } }, data: { groupId } });
  const label = groupId === null ? 'removed from group' : 'assigned to a group';
  for (const id of ids) { await logActivity(db, id, 'assign', label); }
  return { assigned: res.count, groupId };
}

async function listTags() {
  const db = getPrisma();
  const rows = await db.profile.findMany({ where: { deletedAt: null }, select: { tags: true } });
  return collectTags(rows).sort((a, b) => a.localeCompare(b));
}

async function launchProfile(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const profile = await db.profile.findUnique({ where: { id }, include: { proxy: true } });
  if (!profile) throw new Error('Profile not found.');

  const { profileRoot } = getRuntimeConfig();
  const useProfileProxy = profile.systemProxyBehavior === 'PROFILE_PROXY';

  const session = await launchProfileSession({
    profileId: profile.id,
    title: profile.title,
    dataDirName: profile.dataDirName,
    proxy: useProfileProxy ? profile.proxy : null,
    proxyInfoString: useProfileProxy ? profile.proxyInfoString : null,
    startUrl: input.startUrl || 'about:blank',
    profileRoot,
    headless: false,
    profile // full fingerprint config applied at launch
  });

  await db.profile.update({ where: { id }, data: { lastUsedAt: new Date(), launchCount: { increment: 1 } } }).catch(() => {});
  await logActivity(db, id, 'launch', `session ${session.sessionId}`);
  return session;
}

async function closeSession(payload) {
  const input = requireObject(payload);
  return closeProfileSession(requiredString(input.sessionId, 'sessionId'));
}

async function previewProfilesViaDialog() {
  const selection = await dialog.showOpenDialog({
    title: 'Preview ixBrowser-style profile spreadsheet',
    properties: ['openFile'],
    filters: [{ name: 'Spreadsheet files', extensions: ['xlsx', 'xls', 'csv'] }]
  });

  if (selection.canceled || selection.filePaths.length === 0) return { cancelled: true };

  const filePath = selection.filePaths[0];
  const extension = path.extname(filePath).toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(extension)) throw new Error('Unsupported import file type.');

  const parsed = parseWorkbookFile(filePath);
  const token = crypto.randomUUID();
  importPreviewCache.set(token, { createdAt: Date.now(), parsed });

  return {
    cancelled: false,
    token,
    fileName: parsed.fileName,
    sheetName: parsed.sheetName,
    headerRow: parsed.headerRow,
    totalRows: parsed.totalRows,
    items: parsed.items.slice(0, 500),
    errors: parsed.errors
  };
}

async function commitProfileImport(payload) {
  const input = requireObject(payload);
  const token = requiredString(input.token, 'Import token');
  const cached = importPreviewCache.get(token);
  if (!cached) throw new Error('Import preview expired or was not found. Please preview the file again.');

  const db = getPrisma();
  const result = {
    fileName: cached.parsed.fileName,
    sheetName: cached.parsed.sheetName,
    headerRow: cached.parsed.headerRow,
    totalRows: cached.parsed.totalRows,
    createdProfiles: [],
    createdProxies: [],
    skippedRows: [],
    errors: [...cached.parsed.errors]
  };

  for (const item of cached.parsed.items) {
    try {
      if (item.proxyMethod === 'CUSTOM' && !item.rawProxy) {
        result.skippedRows.push({ row: item.row, reason: 'CUSTOM_PROXY_SELECTED_WITHOUT_PROXY_DATA' });
        continue;
      }

      let proxy = null;
      if (item.proxyMethod === 'CUSTOM') {
        proxy = await findOrCreateProxy(db, item.rawProxy, `${item.title} Proxy`);
        result.createdProxies.push(serializeProxy(proxy));
      }

      const dataDirName = await ensureUniqueDataDirName(db, item.dataDirName || item.title);
      const profile = await db.profile.create({
        data: {
          title: item.title,
          proxyId: proxy ? proxy.id : null,
          proxyInfoString: proxy ? buildProxyInfoString(proxy) : null,
          notes: optionalString(item.notes),
          systemProxyBehavior: parseSystemProxyBehavior(item.systemProxyBehavior, 'DIRECT'),
          dataDirName,
          ...generateFingerprint() // distinct, complete fingerprint per imported profile
        },
        include: { proxy: true }
      });

      result.createdProfiles.push(serializeProfile(profile));
      await logActivity(db, profile.id, 'import', `imported "${profile.title}"`);
    } catch (error) {
      result.errors.push({ row: item.row, message: error instanceof Error ? error.message : 'Unknown import error' });
    }
  }

  importPreviewCache.delete(token);
  return result;
}

// ---------- Activity / usage history ----------

async function listActivity(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const profile = await db.profile.findUnique({ where: { id }, select: { title: true, lastUsedAt: true, launchCount: true } });
  if (!profile) throw new Error('Profile not found.');
  const logs = await db.activityLog.findMany({ where: { profileId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
  return {
    profileId: id,
    title: profile.title,
    lastUsedAt: profile.lastUsedAt instanceof Date ? profile.lastUsedAt.toISOString() : (profile.lastUsedAt || null),
    launchCount: profile.launchCount || 0,
    logs: logs.map((l) => ({
      id: l.id,
      memberId: l.memberId ?? null,
      action: l.action,
      detail: l.detail || null,
      createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt
    }))
  };
}

// ---------- Live leak test (reads real values from the running browser) ----------

function isPrivateIp(ip) {
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/i.test(ip) || /\.local$/i.test(ip);
}

async function liveProfileLeak(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const data = await liveLeakTest(String(id));
  if (data === null) throw new Error('Profile is not running. Launch it first to run a live leak test.');

  const env = data.env || {};
  const webrtcIps = Array.isArray(data.webrtcIps) ? data.webrtcIps : [];
  const exit = data.exit || null;
  const exitIp = exit && exit.ip ? exit.ip : null;

  const checks = [];

  checks.push({
    key: 'ip', label: 'Exit IP', status: exitIp ? 'pass' : 'warn',
    detail: exitIp ? `${exitIp}${exit.country ? ` · ${exit.country}` : ''}` : 'Could not read the exit IP from the page.'
  });

  const publicIps = webrtcIps.filter((ip) => !isPrivateIp(ip));
  const leaking = publicIps.filter((ip) => exitIp && ip !== exitIp);
  if (webrtcIps.length === 0) {
    checks.push({ key: 'webrtc', label: 'WebRTC', status: 'pass', detail: 'No WebRTC candidates were exposed.' });
  } else if (leaking.length > 0) {
    checks.push({ key: 'webrtc', label: 'WebRTC', status: 'fail', detail: `Public IP exposed via WebRTC differs from exit IP: ${leaking.join(', ')}` });
  } else {
    checks.push({ key: 'webrtc', label: 'WebRTC', status: 'pass', detail: `Candidates: ${webrtcIps.join(', ')} — no public IP leak vs exit.` });
  }

  if (exit && exit.timezone && env.timezone) {
    const match = exit.timezone === env.timezone;
    checks.push({ key: 'timezone', label: 'Timezone', status: match ? 'pass' : 'fail', detail: match ? `Browser ${env.timezone} matches exit.` : `Browser ${env.timezone} \u2260 exit ${exit.timezone}.` });
  } else if (env.timezone) {
    checks.push({ key: 'timezone', label: 'Timezone', status: 'warn', detail: `Browser timezone ${env.timezone}; exit timezone unknown.` });
  }

  const summary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length
  };

  return { profileId: id, running: true, env, webrtcIps, exit, checks, summary };
}

// ---------- Proxy health: persistence + background scheduler ----------

async function persistProxyHealth(db, id, result) {
  await db.proxy.update({
    where: { id },
    data: {
      lastStatus: result.success ? 'ok' : 'fail',
      lastLatencyMs: typeof result.latencyMs === 'number' ? result.latencyMs : null,
      lastCountry: result.country || null,
      lastCheckedAt: new Date()
    }
  }).catch(() => {});
}

async function readSetting(key, fallback) {
  try {
    const row = await getPrisma().setting.findUnique({ where: { key } });
    if (!row) return fallback;
    return JSON.parse(row.value);
  } catch (e) {
    return fallback;
  }
}

async function writeSetting(key, value) {
  const serialized = JSON.stringify(value);
  await getPrisma().setting.upsert({ where: { key }, update: { value: serialized }, create: { key, value: serialized } });
}

async function runProxyHealthSweep() {
  const db = getPrisma();
  const proxies = await db.proxy.findMany();
  for (const proxy of proxies) {
    try {
      const result = await testProxyConnectivity({ type: proxy.type, host: proxy.host, port: proxy.port, username: proxy.username, password: proxy.password });
      await persistProxyHealth(db, proxy.id, result);
    } catch (e) { /* keep sweeping */ }
  }
}

function stopProxyScheduler() {
  if (proxySchedulerTimer) { clearInterval(proxySchedulerTimer); proxySchedulerTimer = null; }
}

function startProxyScheduler(minutes) {
  stopProxyScheduler();
  const ms = Math.max(1, Number(minutes) || 30) * 60000;
  proxySchedulerTimer = setInterval(() => { runProxyHealthSweep().catch(() => {}); }, ms);
  if (proxySchedulerTimer.unref) proxySchedulerTimer.unref();
}

async function getProxyScheduler() {
  const cfg = await readSetting('proxyScheduler', { enabled: false, minutes: 30 });
  return { enabled: Boolean(cfg.enabled), minutes: Number(cfg.minutes) || 30, running: Boolean(proxySchedulerTimer) };
}

async function setProxyScheduler(payload) {
  const input = requireObject(payload);
  const enabled = Boolean(input.enabled);
  const minutes = Math.max(1, Number.parseInt(input.minutes, 10) || 30);
  await writeSetting('proxyScheduler', { enabled, minutes });
  if (enabled) startProxyScheduler(minutes); else stopProxyScheduler();
  return { enabled, minutes, running: Boolean(proxySchedulerTimer) };
}

async function getSystemInfo() {
  const { dbPath, profileRoot } = getRuntimeConfig();
  return { dbPath, profileRoot, databaseUrlConfigured: Boolean(process.env.DATABASE_URL) };
}

async function getDashboardStats() {
  const db = getPrisma();

  const [totalProfiles, totalProxies, totalGroups] = await Promise.all([
    db.profile.count({ where: { deletedAt: null } }),
    db.proxy.count(),
    db.group.count()
  ]);

  return {
    totalProfiles,
    activeSessions: listActiveSessions().length,
    totalProxies,
    totalGroups
  };
}

// ===================== Members, roles & vault (app lock) =====================
const ROLE_RANK = { OPERATOR: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 };
const VALID_ROLES = Object.keys(ROLE_RANK);

// Minimum role rank required for each gated action.
const PERMISSIONS = {
  'members.manage': 3, // ADMIN+
  'members.delete': 4, // OWNER
  'profiles.delete': 3,
  'profiles.purge': 4,
  'vault.manage': 4
};

function rankOf(role) { return ROLE_RANK[String(role || '').toUpperCase()] || 0; }

function initialsFrom(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(secret), salt, 64).toString('hex');
  return { salt, hash };
}

function verifySecret(secret, salt, hash) {
  if (!salt || !hash) return false;
  let candidate;
  try { candidate = crypto.scryptSync(String(secret), salt, 64).toString('hex'); }
  catch (e) { return false; }
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function serializeMember(m, extra = {}) {
  if (!m) return null;
  return {
    id: m.id,
    name: m.name,
    email: m.email || null,
    role: m.role,
    color: m.color || '#3DC6DA',
    initials: m.initials || initialsFrom(m.name),
    hasPin: Boolean(m.pinHash),
    status: m.status || 'active',
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
    lastActiveAt: m.lastActiveAt instanceof Date ? m.lastActiveAt.toISOString() : (m.lastActiveAt || null),
    ...extra
  };
}

async function getActiveMember() {
  if (currentMemberId == null) return null;
  try { return await getPrisma().member.findUnique({ where: { id: currentMemberId } }); }
  catch (e) { return null; }
}

// In single-user mode (no active member) everything is allowed so the app keeps working
// until a team is configured. Once a member is active, gated actions require a sufficient role.
async function requirePermission(action) {
  const need = PERMISSIONS[action];
  if (!need) return;
  const member = await getActiveMember();
  if (!member) return;
  if (member.status === 'suspended') throw new Error('This member is suspended.');
  if (rankOf(member.role) < need) {
    const err = new Error('Your role does not permit this action.');
    err.code = 'FORBIDDEN';
    throw err;
  }
}

async function listMembers() {
  const db = getPrisma();
  const members = await db.member.findMany({ orderBy: [{ createdAt: 'asc' }] });
  const counts = {};
  try {
    const grouped = await db.profile.groupBy({
      by: ['assignedMemberId'],
      where: { deletedAt: null, assignedMemberId: { not: null } },
      _count: { _all: true }
    });
    for (const g of grouped) counts[g.assignedMemberId] = g._count._all;
  } catch (e) { /* ignore grouping edge cases */ }
  const instr = (await readSetting('memberInstructions', {})) || {};
  return members.map((m) => serializeMember(m, { assignedProfiles: counts[m.id] || 0, isCurrent: m.id === currentMemberId, instructions: instr[m.id] || '' }));
}

async function createMember(payload) {
  await requirePermission('members.manage');
  const input = requireObject(payload);
  const name = requiredString(input.name, 'Member name');
  const db = getPrisma();
  const existingOwners = await db.member.count({ where: { role: 'OWNER' } });
  let role = String(input.role || 'OPERATOR').toUpperCase();
  if (!VALID_ROLES.includes(role)) role = 'OPERATOR';
  if (existingOwners === 0) role = 'OWNER'; // first owner bootstrap (robust to leftover non-owner members)
  const data = {
    name,
    email: optionalString(input.email),
    role,
    color: optionalString(input.color) || '#3DC6DA',
    initials: optionalString(input.initials) || initialsFrom(name),
    status: 'active'
  };
  if (input.pin) { const { salt, hash } = hashSecret(String(input.pin)); data.pinSalt = salt; data.pinHash = hash; }
  const m = await db.member.create({ data });
  return serializeMember(m, { assignedProfiles: 0 });
}

async function updateMember(payload) {
  await requirePermission('members.manage');
  const input = requireObject(payload);
  const id = parseId(input.id);
  const db = getPrisma();
  const target = await db.member.findUnique({ where: { id } });
  if (!target) throw new Error('Member not found.');
  const data = {};
  if (input.name !== undefined) data.name = requiredString(input.name, 'Member name');
  if (input.email !== undefined) data.email = optionalString(input.email);
  if (input.color !== undefined) data.color = optionalString(input.color) || '#3DC6DA';
  if (input.initials !== undefined) data.initials = optionalString(input.initials) || initialsFrom(input.name || target.name);
  if (input.status !== undefined) data.status = String(input.status).toLowerCase() === 'suspended' ? 'suspended' : 'active';
  if (input.role !== undefined) {
    const role = String(input.role).toUpperCase();
    if (!VALID_ROLES.includes(role)) throw new Error('Invalid role.');
    await requirePermission('members.delete'); // role changes require OWNER
    if (target.role === 'OWNER' && role !== 'OWNER') {
      const owners = await db.member.count({ where: { role: 'OWNER' } });
      if (owners <= 1) throw new Error('There must be at least one owner.');
    }
    data.role = role;
  }
  const m = await db.member.update({ where: { id }, data });
  return serializeMember(m);
}

async function setMemberPin(payload) {
  await requirePermission('members.manage');
  const input = requireObject(payload);
  const id = parseId(input.id);
  const db = getPrisma();
  if (input.pin) {
    const { salt, hash } = hashSecret(requiredString(input.pin, 'PIN'));
    await db.member.update({ where: { id }, data: { pinSalt: salt, pinHash: hash } });
  } else {
    await db.member.update({ where: { id }, data: { pinSalt: null, pinHash: null } });
  }
  return { ok: true };
}

async function deleteMember(payload) {
  await requirePermission('members.delete');
  const input = requireObject(payload);
  const id = parseId(input.id);
  const db = getPrisma();
  const target = await db.member.findUnique({ where: { id } });
  if (!target) throw new Error('Member not found.');
  if (target.role === 'OWNER') {
    const owners = await db.member.count({ where: { role: 'OWNER' } });
    if (owners <= 1) throw new Error('You cannot remove the last owner.');
  }
  await db.profile.updateMany({ where: { assignedMemberId: id }, data: { assignedMemberId: null } }).catch(() => {});
  await db.profile.updateMany({ where: { ownerMemberId: id }, data: { ownerMemberId: null } }).catch(() => {});
  await db.member.delete({ where: { id } });
  if (currentMemberId === id) { currentMemberId = null; await writeSetting('currentMemberId', null).catch(() => {}); }
  return { deleted: true };
}

async function getCurrentMember() {
  const m = await getActiveMember();
  return m ? serializeMember(m, { isCurrent: true }) : null;
}

async function switchMember(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id);
  const db = getPrisma();
  const m = await db.member.findUnique({ where: { id } });
  if (!m) throw new Error('Member not found.');
  if (m.status === 'suspended') throw new Error('This member is suspended.');
  if (m.pinHash && !verifySecret(String(input.pin || ''), m.pinSalt, m.pinHash)) {
    const err = new Error('Incorrect PIN.'); err.code = 'BAD_PIN'; throw err;
  }
  currentMemberId = id;
  await writeSetting('currentMemberId', id).catch(() => {});
  await db.member.update({ where: { id }, data: { lastActiveAt: new Date() } }).catch(() => {});
  return serializeMember(m, { isCurrent: true });
}

async function readVault() {
  return readSetting('vault', { enabled: false, hash: null, salt: null, autoLockMinutes: 0 });
}

async function vaultStatus() {
  const v = await readVault();
  return {
    enabled: Boolean(v.enabled),
    hasPassword: Boolean(v.hash),
    locked: Boolean(v.enabled) && vaultLocked,
    autoLockMinutes: Number(v.autoLockMinutes) || 0
  };
}

async function vaultSetPassword(payload) {
  await requirePermission('vault.manage');
  const input = requireObject(payload);
  const v = await readVault();
  if (v.enabled && v.hash && !verifySecret(String(input.current || ''), v.salt, v.hash)) {
    throw new Error('Current password is incorrect.');
  }
  const next = requiredString(input.password, 'Password');
  if (next.length < 4) throw new Error('Password must be at least 4 characters.');
  const { salt, hash } = hashSecret(next);
  await writeSetting('vault', { enabled: true, hash, salt, autoLockMinutes: Number(input.autoLockMinutes ?? v.autoLockMinutes) || 0 });
  vaultLocked = false;
  return vaultStatus();
}

async function vaultUnlock(payload) {
  const input = requireObject(payload);
  const v = await readVault();
  if (!v.enabled || !v.hash) { vaultLocked = false; return vaultStatus(); }
  if (!verifySecret(String(input.password || ''), v.salt, v.hash)) {
    const err = new Error('Incorrect password.'); err.code = 'BAD_PASSWORD'; throw err;
  }
  vaultLocked = false;
  return vaultStatus();
}

async function vaultLock() {
  const v = await readVault();
  if (v.enabled) vaultLocked = true;
  return vaultStatus();
}

async function vaultDisable(payload) {
  await requirePermission('vault.manage');
  const input = requireObject(payload);
  const v = await readVault();
  if (v.enabled && v.hash && !verifySecret(String(input.password || ''), v.salt, v.hash)) {
    throw new Error('Incorrect password.');
  }
  await writeSetting('vault', { enabled: false, hash: null, salt: null, autoLockMinutes: 0 });
  vaultLocked = false;
  return vaultStatus();
}

async function vaultSetAutoLock(payload) {
  await requirePermission('vault.manage');
  const input = requireObject(payload);
  const v = await readVault();
  const minutes = Math.max(0, Number.parseInt(input.minutes, 10) || 0);
  await writeSetting('vault', { ...v, autoLockMinutes: minutes });
  return vaultStatus();
}

// ---- Master account (local, settings-backed; no DB migration) ----
async function accountGet() {
  const a = await readSetting('account', null);
  if (!a) return null;
  return {
    firstName: a.firstName || '',
    lastName: a.lastName || '',
    email: a.email || '',
    phone: a.phone || '',
    verified: Boolean(a.verified),
    createdAt: a.createdAt || null
  };
}

async function accountSave(payload) {
  const input = requireObject(payload);
  const prev = (await readSetting('account', {})) || {};
  const next = {
    firstName: requiredString(input.firstName, 'First name'),
    lastName: requiredString(input.lastName, 'Last name'),
    email: requiredString(input.email, 'Email').toLowerCase(),
    phone: String(input.phone || '').trim(),
    verified: Boolean(input.verified ?? prev.verified),
    createdAt: prev.createdAt || new Date().toISOString()
  };
  await writeSetting('account', next);
  return accountGet();
}

// OTP delivery seam. A local-first app has no mail transport, so until a real
// provider (SMTP / Resend / a backend endpoint) is wired in here, we run in
// dev mode and return the code to the caller so the flow stays testable.
const nodemailer = require('nodemailer');

// Resolve SMTP settings from the DB first (configurable in Settings → Email),
// falling back to environment variables. Email is OPTIONAL: if nothing is
// configured we run in offline mode and surface the code in-app so that
// registration is never blocked on a fresh install.
async function resolveSmtpConfig() {
  const s = (await readSetting('smtp', null)) || {};
  const host = s.host || process.env.SMTP_HOST || '';
  const user = s.user || process.env.SMTP_USER || '';
  const pass = s.pass || process.env.SMTP_PASS || '';
  const port = Number(s.port || process.env.SMTP_PORT || 465);
  const secure = (s.secure !== undefined && s.secure !== null) ? Boolean(s.secure) : (port === 465);
  const fromName = s.fromName || process.env.SMTP_FROM_NAME || 'SoftGlaze Security';
  const configured = Boolean(host && user && pass);
  return { configured, host, user, pass, port, secure, fromName };
}

function buildOtpEmail(cfg, email, code) {
  return {
    from: `"${cfg.fromName}" <${cfg.user}>`,
    to: email,
    subject: 'Your SoftGlaze Verification Code',
    text: `Your verification code is: ${code}. It will expire in 10 minutes.`,
    html: `
      <div style="font-family: sans-serif; max-width: 28rem; margin: 0 auto;">
        <h2>SoftGlaze Verification</h2>
        <p>Your verification code is:</p>
        <h1 style="background: #f4f4f5; padding: 10px; text-align: center; letter-spacing: 5px;">${code}</h1>
        <p style="font-size: 12px; color: #666;">This code will expire in 10 minutes. If you didn't request this, please ignore this email.</p>
      </div>`
  };
}

async function deliverOtp(email, code) {
  const cfg = await resolveSmtpConfig();
  if (!cfg.configured) {
    // Offline mode: no transport configured. Registration still works — the
    // renderer surfaces the code to the operator who is at this machine.
    console.warn('[OTP] No SMTP configured — offline mode, code returned in-app.');
    return { devMode: true };
  }
  const transporter = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass }
  });
  try {
    await transporter.sendMail(buildOtpEmail(cfg, email, code));
    return { devMode: false };
  } catch (error) {
    console.error('[OTP Delivery Error]', error);
    throw new Error('Failed to send verification email. Check Settings → Email.');
  }
}

// Returns config WITHOUT the password (never sent to the renderer).
async function getEmailConfig() {
  const cfg = await resolveSmtpConfig();
  return {
    configured: cfg.configured,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    fromName: cfg.fromName,
    hasPassword: Boolean(cfg.pass)
  };
}

async function setEmailConfig(payload) {
  await requirePermission('members.manage');
  const input = requireObject(payload);
  const prev = (await readSetting('smtp', {})) || {};
  const next = {
    host: String(input.host ?? prev.host ?? '').trim(),
    port: Number(input.port ?? prev.port ?? 465),
    secure: input.secure !== undefined ? Boolean(input.secure) : (prev.secure ?? true),
    user: String(input.user ?? prev.user ?? '').trim(),
    // Keep the existing password if the renderer sends a blank (it never receives it back).
    pass: (input.pass !== undefined && input.pass !== '') ? String(input.pass) : (prev.pass || ''),
    fromName: String(input.fromName ?? prev.fromName ?? 'SoftGlaze Security').trim()
  };
  await writeSetting('smtp', next);
  return getEmailConfig();
}

// Sends a real test email to the given address using the saved/env config.
async function testEmail(payload) {
  await requirePermission('members.manage');
  const input = requireObject(payload);
  const to = requiredString(input.email, 'Email').toLowerCase();
  const cfg = await resolveSmtpConfig();
  if (!cfg.configured) return { sent: false, devMode: true };
  const transporter = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass }
  });
  await transporter.sendMail({
    from: `"${cfg.fromName}" <${cfg.user}>`,
    to,
    subject: 'SoftGlaze test email',
    text: 'This is a test email from SoftGlaze. Your email settings are working.'
  });
  return { sent: true, devMode: false };
}

async function accountSendOtp(payload) {
  const input = requireObject(payload);
  const email = requiredString(input.email, 'Email').toLowerCase();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const { salt, hash } = hashSecret(code);
  await writeSetting('otp', { email, salt, hash, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 });
  const res = await deliverOtp(email, code);
  return { sent: true, devMode: Boolean(res.devMode), devCode: res.devMode ? code : undefined };
}

async function accountVerifyOtp(payload) {
  const input = requireObject(payload);
  const email = String(input.email || '').toLowerCase();
  const code = String(input.code || '').trim();
  const rec = await readSetting('otp', null);
  if (!rec || !rec.hash) throw new Error('No verification code was requested.');
  if (rec.email !== email) throw new Error('Email does not match the requested code.');
  if (Date.now() > Number(rec.expiresAt || 0)) { await writeSetting('otp', null); throw new Error('Verification code expired. Request a new one.'); }
  if (Number(rec.attempts || 0) >= 6) { await writeSetting('otp', null); throw new Error('Too many attempts. Request a new code.'); }
  if (!verifySecret(code, rec.salt, rec.hash)) {
    await writeSetting('otp', { ...rec, attempts: Number(rec.attempts || 0) + 1 });
    throw new Error('Incorrect code.');
  }
  await writeSetting('otp', null);
  return { verified: true };
}

// Atomic master-account registration. Verifies the OTP, creates the OWNER member,
// sets the vault password and saves the account profile in one privileged step,
// and only consumes the OTP once everything has succeeded. This removes the
// fragile multi-call sequence in the renderer that could leave the flow
// half-finished (OTP already spent, vault not set, member created as OPERATOR).
async function accountRegister(payload) {
  const input = requireObject(payload);
  const firstName = requiredString(input.firstName, 'First name');
  const lastName = requiredString(input.lastName, 'Last name');
  const email = requiredString(input.email, 'Email').toLowerCase();
  const phone = String(input.phone || '').trim();
  const password = requiredString(input.password, 'Password');
  const code = String(input.code || '').trim();
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');

  // 1) Verify the OTP WITHOUT clearing it yet.
  const rec = await readSetting('otp', null);
  if (!rec || !rec.hash) throw new Error('No verification code was requested.');
  if (rec.email !== email) throw new Error('Email does not match the requested code.');
  if (Date.now() > Number(rec.expiresAt || 0)) { await writeSetting('otp', null); throw new Error('Verification code expired. Request a new one.'); }
  if (Number(rec.attempts || 0) >= 6) { await writeSetting('otp', null); throw new Error('Too many attempts. Request a new code.'); }
  if (!verifySecret(code, rec.salt, rec.hash)) {
    await writeSetting('otp', { ...rec, attempts: Number(rec.attempts || 0) + 1 });
    throw new Error('Incorrect code.');
  }

  // 2) Create the master account as OWNER (always — this is the workspace owner).
  const db = getPrisma();
  const name = `${firstName} ${lastName}`.trim();
  const owner = await db.member.create({
    data: {
      name,
      email,
      role: 'OWNER',
      color: '#3DC6DA',
      initials: initialsFrom(name),
      status: 'active'
    }
  });

  // 3) Activate the owner so the vault write below passes the permission gate.
  currentMemberId = owner.id;
  await writeSetting('currentMemberId', owner.id).catch(() => {});

  // 4) Set the vault password (we are now OWNER, so vault.manage is allowed).
  const { salt, hash } = hashSecret(password);
  await writeSetting('vault', { enabled: true, hash, salt, autoLockMinutes: Number(input.autoLockMinutes) || 0 });
  vaultLocked = false;

  // 5) Save the account profile.
  await writeSetting('account', {
    firstName, lastName, email, phone, verified: true, createdAt: new Date().toISOString()
  });

  // 6) Everything succeeded — now it is safe to consume the OTP.
  await writeSetting('otp', null);

  return { ok: true, member: serializeMember(owner, { isCurrent: true }) };
}

// ---- Team oversight (local-first admin dashboard) ----
// Per-member instructions are stored in Setting (no schema migration needed).
async function setMemberInstructions(payload) {
  await requirePermission('members.manage');
  const input = requireObject(payload);
  const id = parseId(input.id);
  const text = String(input.instructions || '').slice(0, 4000);
  const map = (await readSetting('memberInstructions', {})) || {};
  if (text) map[id] = text; else delete map[id];
  await writeSetting('memberInstructions', map);
  return { id, instructions: text };
}

// Workspace-wide activity feed: the honest local answer to "what is happening /
// who is doing what". Joins ActivityLog with member names and profile titles.
// Note: this is per-install only. Cross-machine metrics (e.g. total downloads
// across all users) are impossible without a central backend.
async function getTeamActivity(payload) {
  await requirePermission('members.manage');
  const input = (payload && typeof payload === 'object') ? payload : {};
  const take = Math.min(Math.max(parseInt(input.limit, 10) || 50, 1), 200);
  const db = getPrisma();
  const logs = await db.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take });
  const memberIds = [...new Set(logs.map((l) => l.memberId).filter(Boolean))];
  const profileIds = [...new Set(logs.map((l) => l.profileId).filter(Boolean))];
  const [members, profiles] = await Promise.all([
    memberIds.length ? db.member.findMany({ where: { id: { in: memberIds } } }) : [],
    profileIds.length ? db.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, title: true } }) : []
  ]);
  const mMap = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const pMap = Object.fromEntries(profiles.map((p) => [p.id, p.title]));
  return logs.map((l) => ({
    id: l.id,
    action: l.action,
    detail: l.detail || null,
    memberId: l.memberId || null,
    memberName: l.memberId ? (mMap[l.memberId] || 'Unknown member') : 'System',
    profileId: l.profileId || null,
    profileTitle: l.profileId ? (pMap[l.profileId] || `#${l.profileId}`) : null,
    createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt
  }));
}

function registerIpcHandlers() {
  if (registered) return;

  registerHandler(CHANNELS.SYSTEM_GET_INFO, getSystemInfo);
  registerHandler(CHANNELS.DASHBOARD_GET_STATS, getDashboardStats);

  registerHandler(CHANNELS.PROXY_LIST, listProxies);
  registerHandler(CHANNELS.PROXY_CREATE, createProxy);
  registerHandler(CHANNELS.PROXY_UPDATE, updateProxy);
  registerHandler(CHANNELS.PROXY_DELETE, deleteProxy);
  registerHandler(CHANNELS.PROXY_BATCH_ADD, batchAddProxies);
  registerHandler(CHANNELS.PROXY_CHECK, checkProxy);

  registerHandler(CHANNELS.PROFILE_LIST, listProfiles);
  registerHandler(CHANNELS.PROFILE_CREATE, createProfile);
  registerHandler(CHANNELS.PROFILE_UPDATE, updateProfile);
  registerHandler(CHANNELS.PROFILE_DELETE, deleteProfile);
  registerHandler(CHANNELS.PROFILE_LAUNCH, launchProfile);
  registerHandler(CHANNELS.PROFILE_RESTORE, restoreProfile);
  registerHandler(CHANNELS.PROFILE_PURGE, purgeProfile);
  registerHandler(CHANNELS.PROFILE_LIST_TRASH, listTrash);
  registerHandler(CHANNELS.PROFILE_BULK_DELETE, bulkDeleteProfiles);
  registerHandler(CHANNELS.PROFILE_BULK_RESTORE, bulkRestoreProfiles);
  registerHandler(CHANNELS.PROFILE_BULK_PURGE, bulkPurgeProfiles);
  registerHandler(CHANNELS.PROFILE_BULK_LAUNCH, bulkLaunchProfiles);
  registerHandler(CHANNELS.PROFILE_BULK_CLOSE, bulkCloseSessions);
  registerHandler(CHANNELS.PROFILE_ANALYZE_LEAKS, analyzeProfileLeaks);
  registerHandler(CHANNELS.PROFILE_EXPORT_COOKIES, exportProfileCookies);
  registerHandler(CHANNELS.PROFILE_IMPORT_COOKIES, importProfileCookies);
  registerHandler(CHANNELS.PROFILE_CLONE, cloneProfile);
  registerHandler(CHANNELS.TEMPLATE_LIST, listTemplates);
  registerHandler(CHANNELS.TEMPLATE_SAVE, saveProfileAsTemplate);
  registerHandler(CHANNELS.TEMPLATE_DELETE, deleteTemplate);
  registerHandler(CHANNELS.TEMPLATE_CREATE_PROFILE, createProfileFromTemplate);
  registerHandler(CHANNELS.PROFILE_LIVE_LEAK, liveProfileLeak);
  registerHandler(CHANNELS.PROFILE_ACTIVITY, listActivity);
  registerHandler(CHANNELS.SETTINGS_GET_SCHEDULER, getProxyScheduler);
  registerHandler(CHANNELS.SETTINGS_SET_SCHEDULER, setProxyScheduler);

  // Resume the background proxy scheduler if it was enabled previously.
  (async () => {
    try {
      const cfg = await readSetting('proxyScheduler', null);
      if (cfg && cfg.enabled) startProxyScheduler(cfg.minutes);
    } catch (e) { /* ignore */ }
  })();

  registerHandler(CHANNELS.GROUP_LIST, listGroups);
  registerHandler(CHANNELS.GROUP_CREATE, createGroup);
  registerHandler(CHANNELS.GROUP_UPDATE, updateGroup);
  registerHandler(CHANNELS.GROUP_DELETE, deleteGroup);
  registerHandler(CHANNELS.GROUP_ASSIGN, assignProfilesToGroup);
  registerHandler(CHANNELS.TAG_LIST, listTags);

  registerHandler(CHANNELS.SESSION_LIST, () => listActiveSessions());
  registerHandler(CHANNELS.SESSION_CLOSE, closeSession);

  registerHandler(CHANNELS.BATCH_PREVIEW_PROFILES_DIALOG, previewProfilesViaDialog);
  registerHandler(CHANNELS.BATCH_COMMIT_PROFILE_IMPORT, commitProfileImport);

  registerHandler(CHANNELS.MEMBER_LIST, listMembers);
  registerHandler(CHANNELS.MEMBER_CREATE, createMember);
  registerHandler(CHANNELS.MEMBER_UPDATE, updateMember);
  registerHandler(CHANNELS.MEMBER_DELETE, deleteMember);
  registerHandler(CHANNELS.MEMBER_SET_PIN, setMemberPin);
  registerHandler(CHANNELS.MEMBER_CURRENT, getCurrentMember);
  registerHandler(CHANNELS.MEMBER_SWITCH, switchMember);
  registerHandler(CHANNELS.MEMBER_SET_INSTRUCTIONS, setMemberInstructions);
  registerHandler(CHANNELS.TEAM_ACTIVITY, getTeamActivity);
  registerHandler(CHANNELS.VAULT_STATUS, vaultStatus);
  registerHandler(CHANNELS.VAULT_SET_PASSWORD, vaultSetPassword);
  registerHandler(CHANNELS.VAULT_UNLOCK, vaultUnlock);
  registerHandler(CHANNELS.VAULT_LOCK, vaultLock);
  registerHandler(CHANNELS.VAULT_DISABLE, vaultDisable);
  registerHandler(CHANNELS.VAULT_SET_AUTOLOCK, vaultSetAutoLock);
  registerHandler(CHANNELS.ACCOUNT_GET, accountGet);
  registerHandler(CHANNELS.ACCOUNT_SAVE, accountSave);
  registerHandler(CHANNELS.ACCOUNT_SEND_OTP, accountSendOtp);
  registerHandler(CHANNELS.ACCOUNT_VERIFY_OTP, accountVerifyOtp);
  registerHandler(CHANNELS.ACCOUNT_REGISTER, accountRegister);
  registerHandler(CHANNELS.EMAIL_GET_CONFIG, getEmailConfig);
  registerHandler(CHANNELS.EMAIL_SET_CONFIG, setEmailConfig);
  registerHandler(CHANNELS.EMAIL_TEST, testEmail);

  // Restore member session + vault lock state on boot.
  (async () => {
    try {
      const savedMember = await readSetting('currentMemberId', null);
      if (savedMember != null) currentMemberId = Number(savedMember) || null;
      const v = await readSetting('vault', null);
      if (v && v.enabled) vaultLocked = true; // require unlock at startup
    } catch (e) { /* ignore */ }
  })();

  registered = true;
}

async function shutdownIpcHandlers() {
  stopProxyScheduler();
  await closeAllProfileSessions();
  await disconnectPrisma();
}

module.exports = {
  CHANNELS,
  registerIpcHandlers,
  shutdownIpcHandlers
};