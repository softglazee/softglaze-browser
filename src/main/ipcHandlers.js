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
  exportStoredCookies,
  importStoredCookies,
  liveLeakTest,
  listAvailableBrowsers,
  resolveBrowserExecutable,
  navigateSession,
  runCookieRobot,
  warmInteract,
  runMacro,
  startMacroRecording,
  stopMacroRecording,
  humanType,
  launchSynchronizedSessions
} = require('./browserEngine');
const browserDownloader = require('./browserDownloader');
const firefoxEngine = require('./firefoxEngine');
const localApi = require('./localApi');
const totp = require('./totp');
const permissions = require('./permissions');
const payments = require('./payments');
const { parseWorkbookFile, parseDataRows, parseBooleanInt, parseSystemProxyBehavior } = require('./importParser');
const { generateFingerprint, normalizeBrand, deviceGpuCoherence } = require('./fingerprintGenerator');
const migrationService = require('./migrationService');
const extensionManager = require('./extensionManager');
const profileArchive = require('./profileArchive');
const dbCrypto = require('./dbCrypto');
const database = require('./database');
const licensePolicy = require('./licensePolicy');
const { relay } = require('./remoteRelay');
const { runParallelMacro } = require('./parallelRunner');
const teamPolicy = require('./teamPolicy');
const { CloudSyncEngine } = require('./cloudSync');
const syncTransport = require('./syncTransport');
const syncPolicy = require('./syncPolicy');
const secretStore = require('./secretStore');

const CHANNELS = Object.freeze({
  SYSTEM_GET_INFO: 'system:get-info',
  SYSTEM_LIST_BROWSERS: 'system:list-browsers',
  BROWSER_LIST_AVAILABLE: 'browser:list-available',
  BROWSER_DOWNLOAD: 'browser:download',
  BROWSER_DOWNLOAD_STATUS: 'browser:download-status',
  BROWSER_DOWNLOAD_PAUSE: 'browser:download-pause',
  BROWSER_DOWNLOAD_RESUME: 'browser:download-resume',
  BROWSER_FIREFOX_STATUS: 'browser:firefox-status',
  BROWSER_FIREFOX_LIST: 'browser:firefox-list',
  BROWSER_FIREFOX_DOWNLOAD: 'browser:firefox-download',
  BROWSER_FIREFOX_DOWNLOAD_STATUS: 'browser:firefox-download-status',
  BROWSER_FIREFOX_DOWNLOAD_PAUSE: 'browser:firefox-download-pause',
  BROWSER_FIREFOX_DOWNLOAD_RESUME: 'browser:firefox-download-resume',

  DASHBOARD_GET_STATS: 'dashboard:get-stats',

  PROXY_LIST: 'proxy:list',
  PROXY_CREATE: 'proxy:create',
  PROXY_UPDATE: 'proxy:update',
  PROXY_DELETE: 'proxy:delete',
  PROXY_BATCH_ADD: 'proxy:batch-add',
  PROXY_CHECK: 'proxy:check',
  PROXY_BULK_DELETE: 'proxy:bulk-delete',
  PROXY_ROTATION_GET: 'proxy:rotation-get',
  PROXY_ROTATION_SET: 'proxy:rotation-set',
  PROXY_SYNC_VENDOR_POOL: 'proxy:sync-vendor-pool',
  PROXY_ROTATE_IP: 'proxy:rotate-ip',
  PROXY_TEST_ALL: 'proxy:test-all',

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
  PROFILE_IMPORT_COOKIES_BULK: 'profile:import-cookies-bulk',
  PROFILE_STORAGE_INFO: 'profile:storage-info',
  PROFILE_CLONE: 'profile:clone',
  TEMPLATE_LIST: 'template:list',
  TEMPLATE_SAVE: 'template:save',
  TEMPLATE_DELETE: 'template:delete',
  TEMPLATE_CREATE_PROFILE: 'template:create-profile',
  PROFILE_LIVE_LEAK: 'profile:live-leak',
  PROFILE_ACTIVITY: 'profile:activity',
  // Softglaze Premium
  PROFILE_GET_2FA_TOKEN: 'profile:get-2fa-token',
  PROFILE_BULK_SYNCHRONIZE: 'profile:bulk-synchronize',
  PROFILE_EXPORT_ARCHIVE: 'profile:export-archive',
  PROFILE_COOKIE_ROBOT: 'profile:cookie-robot',
  PROFILE_GET_LOCKS: 'profile:get-locks',
  SYSTEM_HUMAN_TYPE: 'system:human-type',
  SETTINGS_GET_SCHEDULER: 'settings:get-proxy-scheduler',
  SETTINGS_SET_SCHEDULER: 'settings:set-proxy-scheduler',
  SETTINGS_GET_GLOBAL: 'settings:get-global',
  SETTINGS_SET_GLOBAL: 'settings:set-global',
  SETTINGS_GET_PROXY_POLICY: 'settings:get-proxy-policy',
  SETTINGS_SET_PROXY_POLICY: 'settings:set-proxy-policy',
  MONETIZATION_GET_LINKS: 'monetization:get-links',
  MONETIZATION_SET_LINKS: 'monetization:set-links',
  EXTENSIONS_LIST: 'extensions:list',
  EXTENSIONS_INSTALL_FROM_ID: 'extensions:install-from-id',
  EXTENSIONS_DELETE: 'extensions:delete',
  EXTENSIONS_TOGGLE_GLOBAL: 'extensions:toggle-global',
  MEMBER_LIST: 'member:list',
  MEMBER_CREATE: 'member:create',
  MEMBER_UPDATE: 'member:update',
  MEMBER_DELETE: 'member:delete',
  MEMBER_SET_PIN: 'member:set-pin',
  MEMBER_CURRENT: 'member:current',
  MEMBER_SWITCH: 'member:switch',
  MEMBER_SUPER_LOGIN: 'member:super-login',
  MEMBER_ACCEPT_INVITE: 'member:accept-invite',
  MEMBER_LOGIN: 'member:login',
  MEMBER_LOGOUT: 'member:logout',
  MEMBER_UPDATE_SELF: 'member:update-self',
  MEMBER_REQUEST_CHANGE: 'member:request-change',
  MEMBER_COMMIT_CHANGE: 'member:commit-change',
  MEMBER_UPDATE_PERMISSIONS: 'member:update-permissions',
  MEMBER_SET_INSTRUCTIONS: 'member:set-instructions',
  MEMBER_SET_STATUS: 'member:set-status',

  LICENSE_GET: 'license:get',
  LICENSE_REDEEM: 'license:redeem',
  LICENSE_GRANT: 'license:grant',
  LICENSE_EXTEND: 'license:extend',
  LICENSE_RESET: 'license:reset',
  LICENSE_TRIAL_START: 'license:trial-start',
  LICENSE_EDIT: 'license:edit',
  LICENSE_TERMINATE: 'license:terminate',
  LICENSE_LIST_OWNERS: 'license:list-owners',
  PAYMENT_CONFIG_GET: 'payment:config-get',
  PAYMENT_CONFIG_SET: 'payment:config-set',
  PAYMENT_CONFIG_VALIDATE: 'payment:config-validate',
  PAYMENT_CHECKOUT_START: 'payment:checkout-start',
  PAYMENT_CHECKOUT_POLL: 'payment:checkout-poll',
  PAYMENT_LIST_METHODS: 'payment:list-methods',
  PAYMENT_SUBMIT_MANUAL: 'payment:submit-manual',
  PAYMENT_MANUAL_LIST: 'payment:manual-list',
  PAYMENT_MANUAL_RESOLVE: 'payment:manual-resolve',
  BILLING_GET_PLANS: 'billing:get-plans',
  BILLING_PLANS_ADMIN: 'billing:plans-admin',
  BILLING_PLAN_SAVE: 'billing:plan-save',
  BILLING_PLAN_DELETE: 'billing:plan-delete',
  BILLING_ASSIGN: 'billing:assign',
  BILLING_SUBSCRIBERS: 'billing:subscribers',
  INVOICE_LIST: 'invoice:list',
  INVOICE_CREATE: 'invoice:create',
  INVOICE_UPDATE: 'invoice:update',
  INVOICE_DELETE: 'invoice:delete',
  IP_PROVIDERS_GET_ALL: 'ip-providers:get-all',
  IP_PROVIDERS_UPDATE_CREDENTIALS: 'ip-providers:update-credentials',
  IP_PROVIDERS_TOGGLE_STATUS: 'ip-providers:toggle-status',
  TEAM_ACTIVITY: 'team:activity',
  TEAM_REASSIGN_PROFILES: 'team:reassign-profiles',
  TEAM_SEAT_USAGE: 'team:seat-usage',
  TEAM_EXPORT_ACTIVITY: 'team:export-activity',
  SYNC_STATUS: 'sync:status',
  SYNC_CONFIGURE: 'sync:configure',
  SYNC_RUN: 'sync:run',
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
  BATCH_COMMIT_PROFILE_IMPORT: 'batch:commit-profile-import',
  BATCH_IMPORT_PROGRESS: 'batch:import-progress', // main -> renderer stream
  BATCH_EXPORT_PROFILES: 'batch:export-profiles',
  BATCH_EXPORT_PROFILES_FILE: 'batch:export-profiles-file',

  // Profile migration — transfer from competitor platforms (Owner / Super Admin)
  MIGRATION_START_TRANSFER: 'migration:start-transfer',
  MIGRATION_PROGRESS: 'migration:progress', // main -> renderer stream

  // Softglaze Pro — automation (macros + AI cookie warmer)
  AUTOMATION_GET_MACROS: 'automation:get-macros',
  AUTOMATION_SAVE_MACRO: 'automation:save-macro',
  AUTOMATION_DELETE_MACRO: 'automation:delete-macro',
  AUTOMATION_START_WARMER: 'automation:start-warmer',
  AUTOMATION_STOP_WARMER: 'automation:stop-warmer',
  AUTOMATION_GET_HISTORY: 'automation:get-history',
  AUTOMATION_WARMER_PROGRESS: 'automation:warmer-progress', // main -> renderer stream
  AUTOMATION_RUN_MACRO: 'automation:run-macro',
  AUTOMATION_MACRO_PROGRESS: 'automation:macro-progress', // main -> renderer stream
  AUTOMATION_CONTROL_MACRO: 'automation:control-macro',
  AUTOMATION_START_RECORDING: 'automation:start-recording',
  AUTOMATION_STOP_RECORDING: 'automation:stop-recording',
  AUTOMATION_GET_SCHEDULE: 'automation:get-schedule',
  AUTOMATION_SET_SCHEDULE: 'automation:set-schedule',
  AUTOMATION_RUN_PARALLEL: 'automation:run-parallel',
  AUTOMATION_RUN_PROGRESS: 'automation:run-progress', // main -> renderer stream
  AUTOMATION_PICK_DATA_FILE: 'automation:pick-data-file',

  // Softglaze Pro — local developer API
  API_TOKEN_LIST: 'api:token-list',
  API_TOKEN_CREATE: 'api:token-create',
  API_TOKEN_REVOKE: 'api:token-revoke',
  API_SERVER_STATUS: 'api:server-status',
  API_SERVER_SET_ENABLED: 'api:server-set-enabled',

  // Softglaze Enterprise — at-rest DB encryption + workspace backup/restore (Phase 6)
  DB_ENCRYPTION_STATUS: 'db:encryption-status',
  DB_UNLOCK: 'db:unlock',
  DB_ENABLE_ENCRYPTION: 'db:enable-encryption',
  DB_DISABLE_ENCRYPTION: 'db:disable-encryption',
  WORKSPACE_BACKUP: 'workspace:backup',
  WORKSPACE_RESTORE: 'workspace:restore'
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
    rotationUrl: proxy.rotationUrl || null,
    hasRotationUrl: Boolean(proxy.rotationUrl),
    createdAt: proxy.createdAt instanceof Date ? proxy.createdAt.toISOString() : proxy.createdAt,
    profileCount: proxy._count?.profiles ?? undefined,
    lastStatus: proxy.lastStatus || null,
    lastLatencyMs: proxy.lastLatencyMs ?? null,
    lastCountry: proxy.lastCountry || null,
    lastCheckedAt: proxy.lastCheckedAt instanceof Date ? proxy.lastCheckedAt.toISOString() : (proxy.lastCheckedAt || null)
  };
}

// Pro — trigger a vendor-side IP rotation. Many mobile/residential plans expose a
// one-shot "change IP" link; we read it off the proxy (or accept+persist a fresh
// one) and fire a server-side GET to trigger the exit-node change. Defensive: a
// missing link, malformed URL, or network failure all return/throw cleanly and
// never touch the live proxy credentials.
async function rotateProxyIp(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id ?? input.proxyId);
  const db = getPrisma();
  const proxy = await db.proxy.findUnique({ where: { id } });
  if (!proxy) throw new Error('Proxy not found.');

  // Prefer a freshly-provided link (and persist it for next time), else the stored one.
  let rotationUrl = String(input.rotationUrl || '').trim();
  if (rotationUrl) {
    await db.proxy.update({ where: { id }, data: { rotationUrl } }).catch(() => {});
  } else {
    rotationUrl = String(proxy.rotationUrl || '').trim();
  }
  if (!rotationUrl) throw new Error('No IP rotation link is configured for this proxy.');
  if (!/^https?:\/\//i.test(rotationUrl)) throw new Error('The rotation link must be an http(s) URL.');

  const axios = require('axios');
  const startedAt = Date.now();
  let res;
  try {
    res = await axios.get(rotationUrl, {
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { 'User-Agent': 'Softglaze/RotationBot' }
    });
  } catch (e) {
    throw new Error(`Rotation request failed: ${(e && e.message) || 'network error'}.`);
  }
  const ok = res.status >= 200 && res.status < 400;
  return {
    ok,
    status: res.status,
    latencyMs: Date.now() - startedAt,
    // Many vendors echo the new IP / a status string — surface a short preview.
    response: typeof res.data === 'string' ? res.data.slice(0, 400) : undefined
  };
}

// Pro — export a profile's cache + config as a single AES-256-encrypted, portable
// `.sgz` file. Prompts for a destination, then streams the archive (see
// profileArchive.js). Defensive throughout: a missing profile, cancelled dialog,
// or stream failure surfaces a clean error rather than a half-written file.
async function exportProfileArchive(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id ?? input.profileId);
  await assertCanAccessProfile(id);
  const password = requiredString(input.password, 'Encryption password');
  const db = getPrisma();
  const profile = await db.profile.findUnique({ where: { id } });
  if (!profile) throw new Error('Profile not found.');

  const { profileRoot } = getRuntimeConfig();
  const userDataDir = path.join(profileRoot, profile.dataDirName);
  const safeName = (String(profile.title || 'profile').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60)) || 'profile';

  const save = await dialog.showSaveDialog({
    title: 'Export encrypted profile archive',
    defaultPath: `${safeName}.sgz`,
    filters: [{ name: 'Softglaze encrypted archive', extensions: ['sgz'] }]
  });
  if (save.canceled || !save.filePath) return { cancelled: true };

  const config = {
    profile: {
      title: profile.title,
      dataDirName: profile.dataDirName,
      os: profile.os || null,
      userAgent: profile.userAgent || null,
      proxyInfoString: profile.proxyInfoString || null
    }
  };
  const res = await profileArchive.exportProfileArchive({ userDataDir, config, password, outPath: save.filePath });
  return { ok: true, path: save.filePath, bytes: res.plainBytes };
}

// Pro — Cookie Robot: drive a profile through real sites to build organic cookies
// + history. Reuses an open session or launches one (so the profile's proxy +
// fingerprint apply), runs the engine's robot, and closes it again when it
// launched the session itself.
async function cookieRobot(payload) {
  const input = requireObject(payload);
  const profileId = parseId(input.profileId ?? input.id);
  await assertCanAccessProfile(profileId);
  const urls = Array.isArray(input.targetUrls) ? input.targetUrls.map((u) => String(u || '').trim()).filter(Boolean) : [];
  if (!urls.length) throw new Error('Provide at least one target URL for the cookie robot.');

  const profile = await getPrisma().profile.findUnique({ where: { id: profileId } });
  if (!profile) throw new Error('Profile not found.');

  let sessionId = String(profileId);
  const alreadyOpen = listActiveSessions().some((s) => String(s.sessionId) === sessionId);
  let launched = false;
  if (!alreadyOpen) {
    const res = await launchProfileById(profileId, 'about:blank');
    sessionId = res && res.sessionId ? String(res.sessionId) : sessionId;
    launched = true;
  }

  let result;
  try {
    result = await runCookieRobot(sessionId, urls, { perUrlMs: Number(input.perUrlMs) || 0 });
  } finally {
    if (launched && input.closeWhenDone !== false) await closeProfileSession(sessionId).catch(() => {});
  }
  return { ok: true, sessionId, visited: result.visited, errors: result.errors };
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
    browserBrand: input.browserBrand === undefined ? undefined : (normalizeBrand(input.browserBrand) || 'Chrome'),
    browserVersion: input.browserVersion,
    os: input.os,
    osVersion: input.osVersion,
    deviceClass: input.deviceClass === 'mobile' ? 'mobile' : (input.deviceClass === 'desktop' ? 'desktop' : undefined),
    userAgent: input.userAgent || 'Auto',
    startupUrls: input.startupUrls,
    platformAccounts: input.platformAccounts ? JSON.stringify(input.platformAccounts) : null,
    // Softglaze Premium 2FA vault. undefined => leave unchanged on update; an
    // empty string clears it; otherwise store the trimmed base32 secret, SEALED
    // at rest (decrypted only when minting a live token).
    twoFactorSeed: input.twoFactorSeed === undefined ? undefined : (String(input.twoFactorSeed).trim() ? secretStore.seal(String(input.twoFactorSeed).trim()) : null),

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
    // HTTP/3 (QUIC) opt-in — default false (max stealth). Explicit boolean so an
    // older payload without the field saves as disabled rather than null.
    enableQuic: input.enableQuic === true,
    
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
  // Generate the right device class so a "mobile" request produces a coherent
  // Android base (not a desktop one with a couple of fields overwritten).
  const merged = { ...generateFingerprint({ deviceClass: input.deviceClass }) };
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

// Recursively sum the on-disk size (bytes + file count) of a profile data dir,
// capped so a huge cache folder can't make the walk run unbounded.
async function directorySize(dir, cap = 200000) {
  let bytes = 0;
  let files = 0;
  async function walk(d) {
    if (files >= cap) return;
    let entries;
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      if (files >= cap) return;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(full);
      else {
        try { const st = await fs.stat(full); bytes += st.size; files += 1; } catch (e) { /* skip */ }
      }
    }
  }
  await walk(dir);
  return { bytes, files };
}

// On-disk storage info for a profile (cookies, cache, logins live here). Used by
// the delete dialog so the user can see what would be wiped before confirming.
async function getProfileStorageInfo(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
  const profile = await getPrisma().profile.findUnique({ where: { id } });
  if (!profile) throw new Error('Profile not found.');
  const dir = resolveProfileDataDir(profile.dataDirName);
  let exists = false;
  try { await fs.access(dir); exists = true; } catch (e) { exists = false; }
  const size = exists ? await directorySize(dir) : { bytes: 0, files: 0 };
  return { id, exists, path: dir, bytes: size.bytes, files: size.files };
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

async function findOrCreateProxy(db, proxyInput, nameFallback = null, typeHint = null) {
  const parsed = parseProxyInput(proxyInput);
  if (!parsed) return null;
  // An explicit "Proxy Type" column (HTTP/HTTPS/SOCKS5) overrides the default.
  if (typeHint) parsed.type = typeHint;

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
  await assertWithinLimit('proxies');
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
      password: parsed.password,
      ownerMemberId: ownerStampId()
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

// Bulk-delete by id list. Profiles referencing a deleted proxy have their
// proxyId nulled automatically (Profile.proxy relation uses onDelete: SetNull).
async function bulkDeleteProxies(payload) {
  const input = requireObject(payload);
  const ids = Array.isArray(input.ids) ? input.ids.map((value) => parseId(value)) : [];
  if (ids.length === 0) throw new Error('No proxies selected.');
  const result = await getPrisma().proxy.deleteMany({ where: { id: { in: ids } } });
  return { deleted: result.count, ids };
}

// ---------- Proxy rotation / sticky-session pools ----------
// Config is stored in the Settings table keyed by profile id (no schema change).
// A rotating profile keeps its own userDataDir — cookies/logins persist — while
// the EXIT IP rotates across the pool on each launch (round-robin or random).

async function getProxyRotation(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id);
  const all = (await readSetting('proxyRotation', {})) || {};
  const cfg = all[id] || { enabled: false, mode: 'round-robin', proxyIds: [] };
  const proxies = (await getPrisma().proxy.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { profiles: true } } }
  })).map(serializeProxy);
  return {
    profileId: id,
    enabled: Boolean(cfg.enabled),
    mode: cfg.mode === 'random' ? 'random' : 'round-robin',
    proxyIds: Array.isArray(cfg.proxyIds) ? cfg.proxyIds : [],
    proxies
  };
}

async function setProxyRotation(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id);
  const enabled = Boolean(input.enabled);
  const mode = input.mode === 'random' ? 'random' : 'round-robin';
  const proxyIds = Array.isArray(input.proxyIds) ? input.proxyIds.map((v) => parseId(v)) : [];
  if (enabled && proxyIds.length === 0) throw new Error('Select at least one proxy for the rotation pool.');
  const all = (await readSetting('proxyRotation', {})) || {};
  all[id] = { enabled, mode, proxyIds };
  await writeSetting('proxyRotation', all);
  return { profileId: id, enabled, mode, proxyIds };
}

// Returns the next pool proxy for a launching profile, or null when rotation is
// off / empty. Round-robin advances a persisted per-profile cursor.
// ---------------------------------------------------------------------------
// Proxy policy — HOW the rotation pool is applied to a launch (per profile, with
// a global default). Stored under the `proxyPolicy` Setting as
//   { default: 'each-launch' | 'sticky' | 'failover', byProfile: { [id]: mode } }
//   • each-launch → rotate to the next pool proxy on every launch (legacy default)
//   • sticky      → ignore the pool; keep the profile's own fixed proxy
//   • failover    → rotate, but skip proxies whose last health check failed
// This LAYERS on top of the existing rotation primitive (proxyRotation config);
// it does not replace it.
// ---------------------------------------------------------------------------
const PROXY_POLICY_MODES = new Set(['each-launch', 'sticky', 'failover']);

async function getProxyPolicy() {
  const cfg = (await readSetting('proxyPolicy', {})) || {};
  const def = PROXY_POLICY_MODES.has(cfg.default) ? cfg.default : 'each-launch';
  const byProfile = (cfg.byProfile && typeof cfg.byProfile === 'object' && !Array.isArray(cfg.byProfile)) ? cfg.byProfile : {};
  return { default: def, byProfile, modes: Array.from(PROXY_POLICY_MODES) };
}

async function setProxyPolicy(payload) {
  const input = requireObject(payload);
  const cur = await getProxyPolicy();
  const next = { default: cur.default, byProfile: { ...cur.byProfile } };
  if (input.default !== undefined) {
    if (!PROXY_POLICY_MODES.has(input.default)) throw new Error('Invalid proxy policy mode.');
    next.default = input.default;
  }
  // Optional per-profile override. mode === null/'' clears the override.
  if (input.profileId !== undefined && input.profileId !== null) {
    const pid = String(parseId(input.profileId));
    if (input.mode === null || input.mode === '' || input.mode === undefined) {
      delete next.byProfile[pid];
    } else {
      if (!PROXY_POLICY_MODES.has(input.mode)) throw new Error('Invalid proxy policy mode.');
      next.byProfile[pid] = input.mode;
    }
  }
  await writeSetting('proxyPolicy', next);
  return next;
}

// Resolve the effective policy mode for a profile (per-profile override wins).
async function resolveProxyPolicyMode(profileId) {
  const cfg = await getProxyPolicy();
  const byId = cfg.byProfile[profileId] ?? cfg.byProfile[String(profileId)];
  return PROXY_POLICY_MODES.has(byId) ? byId : cfg.default;
}

async function pickRotationProxy(db, profileId) {
  const policy = await resolveProxyPolicyMode(profileId);
  // Sticky: never rotate — the profile keeps its own fixed proxy.
  if (policy === 'sticky') return null;

  const all = (await readSetting('proxyRotation', {})) || {};
  const cfg = all[profileId];
  if (!cfg || !cfg.enabled || !Array.isArray(cfg.proxyIds) || cfg.proxyIds.length === 0) return null;

  const rows = await db.proxy.findMany({ where: { id: { in: cfg.proxyIds } } });
  // Preserve the configured order for stable round-robin; drop deleted ids.
  let ordered = cfg.proxyIds.map((pid) => rows.find((p) => p.id === pid)).filter(Boolean);
  if (ordered.length === 0) return null;

  // Failover: prefer proxies that passed their last health check. If every one is
  // failing (or none has been checked yet), fall back to the full list so a launch
  // is never blocked by a stale/empty health table.
  if (policy === 'failover') {
    const healthy = ordered.filter((p) => p.lastStatus !== 'fail');
    if (healthy.length > 0) ordered = healthy;
  }

  if (cfg.mode === 'random') return ordered[crypto.randomInt(ordered.length)];

  const state = (await readSetting('proxyRotationState', {})) || {};
  const next = (Number(state[profileId]) || 0) % ordered.length;
  state[profileId] = next + 1;
  await writeSetting('proxyRotationState', state);
  return ordered[next];
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

// ---------------------------------------------------------------------------
// Softglaze Provider Core — integrated proxy-vendor sync.
//
// Pulls a customer's purchased proxies from a partner vendor and maps the rows
// into our native Proxy schema. Bright Data, Oxylabs and Smartproxy are wired to
// REAL vendor calls (see REAL_VENDOR_ADAPTERS); every other provider still uses
// the deterministic SIMULATION stub until its endpoint is wired. The
// persistence/dedup path at the bottom is shared and production-ready.
// ---------------------------------------------------------------------------
const PROXY_VENDORS = Object.freeze({
  ipfoxy: 'IPFoxy', brightdata: 'Bright Data', oxylabs: 'Oxylabs', smartproxy: 'Smartproxy',
  lumiproxy: 'LumiProxy', proxy302: 'Proxy302', mangoproxy: 'MangoProxy', kookeey: 'kookeey',
  luna: 'Luna Proxy', ipburger: 'IP Burger', tisocks: 'TiSocks', shopsocks5: 'ShopSocks5'
});

// Plausible rotating gateways used to shape the simulated rows. Replace with the
// real per-vendor endpoints returned by their APIs during full integration.
const VENDOR_GATEWAYS = Object.freeze({
  ipfoxy: { host: 'gate.ipfoxy.io', port: 6200, type: 'HTTP' },
  brightdata: { host: 'brd.superproxy.io', port: 22225, type: 'HTTP' },
  oxylabs: { host: 'pr.oxylabs.io', port: 7777, type: 'HTTP' },
  smartproxy: { host: 'gate.smartproxy.com', port: 7000, type: 'HTTP' },
  lumiproxy: { host: 'gate.lumiproxy.com', port: 8000, type: 'HTTP' },
  proxy302: { host: 'gate.proxy302.com', port: 2000, type: 'HTTP' },
  mangoproxy: { host: 'gate.mangoproxy.com', port: 8000, type: 'HTTP' },
  kookeey: { host: 'gate.kookeey.com', port: 1000, type: 'HTTP' },
  luna: { host: 'gate.lunaproxy.com', port: 12233, type: 'HTTP' },
  ipburger: { host: 'gate.ipburger.com', port: 8080, type: 'HTTP' },
  tisocks: { host: 'gate.tisocks.net', port: 1080, type: 'SOCKS5' },
  shopsocks5: { host: 'gate.shopsocks5.com', port: 1080, type: 'SOCKS5' }
});

// SIMULATION STUB: stand-in for "call the vendor API with the customer token and
// receive their purchased endpoints". Deterministic so a repeat sync dedups
// cleanly instead of duplicating rows. Returns normalized proxy rows.
function simulateVendorProxies(vendorKey, token, opts = {}) {
  const gw = VENDOR_GATEWAYS[vendorKey];
  if (!gw) throw new Error('Unknown proxy provider.');
  const short = String(token).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'token';
  const rows = [];
  for (let i = 1; i <= 4; i += 1) {
    // Bright Data BDPM uses a distinct session-style username; reflect that here.
    const sessionTag = (vendorKey === 'brightdata' && opts.bdpm) ? `-bdpm-s${i}` : `-s${i}`;
    rows.push({
      type: gw.type,
      host: gw.host,
      port: gw.port + i,
      username: `${vendorKey}-${short}${sessionTag}`,
      password: `sg-${short}`,
      label: `${PROXY_VENDORS[vendorKey]} • Synced #${i}`
    });
  }
  return rows;
}

// Minimal native HTTPS text fetch with custom headers + a hard timeout/size cap.
// Used for direct vendor REST calls (e.g. Bright Data) where we need a Bearer
// header that the shared httpGetJson() helper doesn't expose. Rejects with a
// clean, status-bearing message so adapters can surface vendor errors verbatim.
function httpRequestText(url, options = {}) {
  return new Promise((resolve, reject) => {
    let lib;
    try {
      const parsed = new URL(url);
      lib = parsed.protocol === 'https:' ? require('node:https') : require('node:http');
    } catch (e) { return reject(new Error('Invalid request URL.')); }

    const timeoutMs = Number(options.timeoutMs) || 15000;
    let done = false; let timer;
    const finish = (fn, arg) => { if (done) return; done = true; if (timer) clearTimeout(timer); fn(arg); };

    const req = lib.request(url, {
      method: options.method || 'GET',
      headers: { 'User-Agent': 'Softglaze-ProviderCore/1.0', Accept: '*/*', ...(options.headers || {}) }
    }, (res) => {
      const status = res.statusCode || 0;
      let data = ''; let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2_000_000) { res.destroy(); finish(reject, new Error('Vendor response too large.')); return; }
        data += chunk;
      });
      res.on('end', () => {
        if (status < 200 || status >= 300) {
          return finish(reject, Object.assign(new Error(`HTTP ${status} ${String(data).slice(0, 200).trim() || res.statusMessage || ''}`.trim()), { status }));
        }
        finish(resolve, data);
      });
    });
    req.on('error', (e) => finish(reject, e));
    timer = setTimeout(() => { try { req.destroy(); } catch (e) {} finish(reject, new Error('Vendor request timed out.')); }, timeoutMs);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// --- Bright Data: REAL list extraction --------------------------------------
// GET /zone/route_ips returns a zone's routable exit IPs (one per line) for a
// Bearer API token. We pin each IP to the standard super-proxy gateway via the
// `-ip-<ip>` username suffix, producing rows usable straight away.
async function fetchBrightDataPool({ token, username, password, zone }) {
  const apiToken = String(token || '').trim();
  if (!apiToken) throw new Error('Bright Data API token is required to sync.');
  const baseUser = String(username || '').trim();
  const z = String(zone || '').trim() || (baseUser.match(/-zone-([^-\s]+)/) || [])[1] || '';
  if (!z) throw new Error('Bright Data zone is required (provide it, or use a username like brd-customer-<id>-zone-<zone>).');

  let text;
  try {
    text = await httpRequestText(`https://api.brightdata.com/zone/route_ips?zone=${encodeURIComponent(z)}`, {
      headers: { Authorization: `Bearer ${apiToken}` }
    });
  } catch (e) {
    throw new Error(`Bright Data API error: ${e.message}`);
  }

  const ips = String(text).split(/\r?\n/).map((s) => s.trim()).filter((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip));
  if (!ips.length) throw new Error('Bright Data returned no routable IPs for this zone (check the token has access to it).');

  const userBase = baseUser || `brd-customer-zone-${z}`;
  return ips.slice(0, 200).map((ip) => ({
    type: 'HTTP', host: 'brd.superproxy.io', port: 22225,
    username: `${userBase}-ip-${ip}`, password: String(password || ''),
    label: `Bright Data • ${z} • ${ip}`
  }));
}

// --- Oxylabs / Smartproxy: REAL credential-verified gateway sync -------------
// These are gateway-based rotating services, so there is no per-IP list to pull
// for residential. "Real sync" = make a live authenticated request THROUGH the
// vendor's own gateway with the supplied credentials; only persist the working
// endpoint. Bad credentials surface as a clean error, never a stored dead proxy.
async function fetchGatewayVerifiedPool(label, gateway, { username, password }) {
  const user = String(username || '').trim();
  if (!user) throw new Error(`${label}: a proxy username is required to sync.`);
  const probe = await testProxyConnectivity({ type: gateway.type, host: gateway.host, port: gateway.port, username: user, password: String(password || '') });
  if (!probe.success) throw new Error(`${label} credential check failed: ${probe.error || 'could not authenticate against the gateway.'}`);
  return [{
    type: gateway.type, host: gateway.host, port: gateway.port,
    username: user, password: String(password || ''),
    label: `${label} • ${gateway.host}${probe.ip ? ` • verified ${probe.ip}` : ' • verified'}`
  }];
}
function fetchOxylabsPool(creds) { return fetchGatewayVerifiedPool('Oxylabs', VENDOR_GATEWAYS.oxylabs, creds); }
function fetchSmartproxyPool(creds) { return fetchGatewayVerifiedPool('Smartproxy', VENDOR_GATEWAYS.smartproxy, creds); }

// Vendors wired to real calls. Everything else falls back to the simulation.
const REAL_VENDOR_ADAPTERS = Object.freeze({
  brightdata: fetchBrightDataPool,
  oxylabs: fetchOxylabsPool,
  smartproxy: fetchSmartproxyPool
});

async function syncVendorPool(payload) {
  const input = requireObject(payload);
  const vendorKey = requiredString(input.provider, 'Provider').toLowerCase();
  if (!PROXY_VENDORS[vendorKey]) throw new Error('Unknown proxy provider.');

  const db = getPrisma();
  const adapter = REAL_VENDOR_ADAPTERS[vendorKey];
  let rows;
  let simulated = false;

  if (adapter) {
    // REAL vendor path — adapters throw a clean message on auth/endpoint failure.
    rows = await adapter({
      token: optionalString(input.token) || '',
      username: optionalString(input.username),
      password: input.password != null ? String(input.password) : '',
      zone: optionalString(input.zone),
      bdpm: input.bdpm === true
    });
  } else {
    // SIMULATION fallback for not-yet-wired providers (token-driven).
    const token = requiredString(input.token, 'Proxy token').trim();
    if (token.length > 50) throw new Error('Proxy token must be 50 characters or fewer.');
    rows = simulateVendorProxies(vendorKey, token, { bdpm: input.bdpm === true });
    simulated = true;
  }

  const result = { provider: PROXY_VENDORS[vendorKey], simulated, total: rows.length, created: [], skipped: [] };
  for (const row of rows) {
    const existing = await db.proxy.findFirst({
      where: { type: row.type, host: row.host, port: row.port, username: row.username },
      select: { id: true }
    });
    if (existing) { result.skipped.push(row.label); continue; }
    const created = await db.proxy.create({
      data: {
        name: row.label, type: row.type, host: row.host, port: row.port,
        username: row.username, password: row.password, ownerMemberId: ownerStampId()
      }
    });
    result.created.push(serializeProxy(created));
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
// Reduce a list of pass/warn/fail checks to a single 0-100 trust score with a
// letter grade. Fails dominate — a single real leak (e.g. WebRTC exposing the
// real IP, or a timezone mismatch) should visibly tank the score; warns are
// lighter advisories. Returned by both the static and live leak analyses.
function computeTrustScore(checks) {
  const summary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length
  };
  let score = 100 - summary.fail * 28 - summary.warn * 9;
  score = Math.max(0, Math.min(100, score));
  let grade = 'F';
  let label = 'At risk';
  if (score >= 90) { grade = 'A'; label = 'Strong'; }
  else if (score >= 80) { grade = 'B'; label = 'Good'; }
  else if (score >= 65) { grade = 'C'; label = 'Fair'; }
  else if (score >= 50) { grade = 'D'; label = 'Weak'; }
  return { score, grade, label, summary };
}

async function analyzeProfileLeaks(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
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

  // 7) Device ↔ GPU coherence — a mobile UA with a desktop GPU (or vice versa) is
  // an easily-scored mismatch.
  const coh = deviceGpuCoherence({ deviceClass: profile.deviceClass, os: profile.os, webglRenderer: profile.webglRenderer });
  checks.push({ key: 'device', label: 'Device coherence', status: coh.status, detail: coh.detail });

  const score = computeTrustScore(checks);
  return { profileId: id, title: profile.title, usesProxy, geo, checks, summary: score.summary, score };
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

// Cookie health: expiry, scope and security stats for a cookie set. CDP/JSON
// expiries are unix seconds; <= 0 (or missing) means a session cookie.
function cookieHealth(cookies) {
  const now = Date.now() / 1000;
  const weekOut = now + 7 * 24 * 3600;
  const list = Array.isArray(cookies) ? cookies : [];
  const domains = new Set();
  let session = 0, expired = 0, expiringSoon = 0, secure = 0, httpOnly = 0;
  for (const c of list) {
    if (c.domain) domains.add(String(c.domain).replace(/^\./, ''));
    if (c.secure) secure += 1;
    if (c.httpOnly) httpOnly += 1;
    const exp = Number(c.expires);
    if (!Number.isFinite(exp) || exp <= 0) { session += 1; continue; }
    if (exp < now) expired += 1;
    else if (exp < weekOut) expiringSoon += 1;
  }
  return { total: list.length, domains: domains.size, session, expired, expiringSoon, secure, httpOnly };
}

// Build headless-read options (data dir + matching Chrome) for a profile that
// isn't currently running, so cookies can be exported/imported without launching.
async function offlineProfileOpts(id) {
  const db = getPrisma();
  const profile = await db.profile.findUnique({ where: { id } });
  if (!profile) throw new Error('Profile not found.');
  const userDataDir = resolveProfileDataDir(profile.dataDirName);
  const resolved = resolveBrowserExecutable(profile.browserVersion || profile.browserCore);
  return { userDataDir, executablePath: resolved && resolved.exePath ? resolved.exePath : undefined };
}

async function exportProfileCookies(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
  const format = (optionalString(input.format) || 'json').toLowerCase();
  let cookies = await exportSessionCookies(String(id));
  if (cookies === null) {
    // Profile not running — read its persisted cookies headlessly from disk.
    cookies = await exportStoredCookies(await offlineProfileOpts(id)).catch(() => null);
    if (cookies === null) throw new Error('Could not read this profile\'s stored cookies. Try launching it once.');
  }
  const content = format === 'netscape' ? cookiesToNetscape(cookies) : JSON.stringify(cookies, null, 2);
  return { format, count: cookies.length, content, health: cookieHealth(cookies) };
}

async function importProfileCookies(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
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

  let result = await importSessionCookies(String(id), params);
  if (result === null) {
    // Profile not running — write the cookies into its persisted store headlessly.
    result = await importStoredCookies(await offlineProfileOpts(id), params).catch(() => null);
    if (result === null) throw new Error('Could not write cookies to this profile\'s store. Try launching it once.');
  }
  return { imported: result.imported, parsed: parsed.length, health: cookieHealth(parsed) };
}

// Bulk import the same cookie set into every CURRENTLY RUNNING profile. Cookie
// injection is a live-session (CDP) operation, so this targets open sessions
// rather than launching profiles. Returns a per-session result breakdown.
async function importCookiesToRunning(payload) {
  const input = requireObject(payload);
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

  let sessions = listActiveSessions();
  // Scope to running sessions whose profile the active member may access.
  const accessCheck = await profileAccessChecker();
  if (accessCheck) {
    const sids = sessions.map((s) => Number(s.sessionId)).filter((n) => !Number.isNaN(n));
    const rows = sids.length ? await getPrisma().profile.findMany({ where: { id: { in: sids } }, select: { id: true, ownerMemberId: true, assignedMemberId: true } }) : [];
    const okIds = new Set(rows.filter(accessCheck).map((r) => r.id));
    sessions = sessions.filter((s) => okIds.has(Number(s.sessionId)));
  }
  if (sessions.length === 0) throw new Error('No profiles are running. Launch the target profiles first.');

  const results = [];
  for (const sess of sessions) {
    const r = await importSessionCookies(String(sess.sessionId), params).catch(() => null);
    results.push({ sessionId: sess.sessionId, profileName: sess.profileName, imported: r ? r.imported : 0, ok: Boolean(r) });
  }
  return { targets: sessions.length, parsed: parsed.length, health: cookieHealth(parsed), results };
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
  await assertCanAccessProfile(id);
  const reroll = Boolean(input.reroll);
  const src = await db.profile.findUnique({ where: { id } });
  if (!src) throw new Error('Profile not found.');

  const fields = await reconcileReferences(db, pickCloneableFields(src));
  const title = `${src.title} (copy)`;
  const dataDirName = await ensureUniqueDataDirName(db, title);

  // Reroll: replace the whole identity/environment fingerprint with a fresh,
  // internally-consistent one (OS↔GPU↔screen stay paired) — for safe account
  // farms where copies must NOT share a fingerprint. Otherwise just regenerate
  // the hardware identity so the copy is not a byte-identical twin.
  // Preserve the source's device class on reroll so a mobile profile stays mobile.
  const isMobile = src.deviceClass === 'mobile';
  const fingerprint = reroll ? generateFingerprint({ deviceClass: src.deviceClass }) : {};
  const data = { ...fields, ...fingerprint, title, dataDirName, macAddress: randomMac() };
  // Desktop machine names are randomized per copy; a mobile profile keeps its device
  // model (e.g. Pixel 7) so the UA / Client-Hints model stays coherent.
  if (!isMobile) data.deviceName = randomDeviceName();
  const created = await db.profile.create({ data, include: { proxy: true, group: true } });
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

  // A mobile template keeps its device model (e.g. Pixel 7) so the UA / Client-Hints
  // model stays coherent; desktop profiles get a randomized machine name per profile.
  const isMobile = fields.deviceClass === 'mobile';
  const data = { ...fields, title, dataDirName, macAddress: randomMac() };
  if (!isMobile) data.deviceName = randomDeviceName();
  const created = await db.profile.create({ data, include: { proxy: true, group: true } });
  return serializeProfile(created);
}

// ---- Profile access scoping (tenant isolation) ----------------------------
// A member may only see / act on profiles within their own visible subtree
// (assigned to, or owned by, themselves or a descendant). Single-user mode (no
// active member) and the Super Admin are unrestricted; OWNER-and-up also keep
// access to legacy/unstamped profiles (created before a team existed). Enforced
// in main — never trust the renderer to hide a profile.
async function profileAccessChecker() {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return null; // unrestricted
  const all = await getPrisma().member.findMany();
  const visible = permissions.visibleMemberIds(all, member);
  const ownerPlus = permissions.rankOf(member.role) >= permissions.rankOf('OWNER');
  return (p) => Boolean(p && (
    (p.assignedMemberId != null && visible.has(p.assignedMemberId))
    || (p.ownerMemberId != null && visible.has(p.ownerMemberId))
    || (p.ownerMemberId == null && p.assignedMemberId == null && ownerPlus)
  ));
}

async function assertCanAccessProfile(id) {
  const check = await profileAccessChecker();
  if (!check) return;
  const p = await getPrisma().profile.findUnique({ where: { id }, select: { id: true, ownerMemberId: true, assignedMemberId: true } });
  if (!p) throw new Error('Profile not found.');
  if (!check(p)) { const e = new Error('You do not have access to this profile.'); e.code = 'FORBIDDEN'; throw e; }
}

// Split a renderer-supplied id list into the ones the active member may touch and
// the ones they may not (the latter become per-id errors in bulk handlers).
async function partitionAccessibleProfileIds(ids) {
  const check = await profileAccessChecker();
  if (!check) return { allowed: ids, denied: [] };
  const rows = await getPrisma().profile.findMany({ where: { id: { in: ids } }, select: { id: true, ownerMemberId: true, assignedMemberId: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const allowed = []; const denied = [];
  for (const id of ids) { const r = byId.get(id); if (r && check(r)) allowed.push(id); else denied.push(id); }
  return { allowed, denied };
}

// Merge the active member's ownership filter into a profile list query.
async function scopedProfileWhere(baseWhere) {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return baseWhere;
  const all = await getPrisma().member.findMany();
  const visible = [...permissions.visibleMemberIds(all, member)];
  const or = [{ assignedMemberId: { in: visible } }, { ownerMemberId: { in: visible } }];
  if (permissions.rankOf(member.role) >= permissions.rankOf('OWNER')) {
    or.push({ ownerMemberId: null, assignedMemberId: null });
  }
  return { AND: [baseWhere, { OR: or }] };
}

async function listProfiles(payload = {}) {
  const db = getPrisma();
  const search = optionalString(payload.search);
  const where = { deletedAt: null };
  if (search) {
    where.OR = [{ title: { contains: search } }, { notes: { contains: search } }, { dataDirName: { contains: search } }, { proxyInfoString: { contains: search } }];
  }

  const profiles = await db.profile.findMany({ where: await scopedProfileWhere(where), orderBy: { createdAt: 'desc' }, include: { proxy: true, group: true } });
  return profiles.map(serializeProfile);
}

async function listTrash() {
  const db = getPrisma();
  const profiles = await db.profile.findMany({
    where: await scopedProfileWhere({ deletedAt: { not: null } }),
    orderBy: { deletedAt: 'desc' },
    include: { proxy: true, group: true }
  });
  return profiles.map(serializeProfile);
}

async function createProfile(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  await assertWithinLimit('profiles');
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
  const stampId = ownerStampId();

  const created = await db.profile.create({
    data: {
      title,
      proxyId,
      proxyInfoString: proxy ? buildProxyInfoString(proxy) : optionalString(input.proxyInfoString),
      notes: optionalString(input.notes),
      systemProxyBehavior: validateSystemProxyBehavior(input.systemProxyBehavior),
      dataDirName,
      ownerMemberId: stampId,
      assignedMemberId: stampId,
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
  await assertCanAccessProfile(id);
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
  await assertCanAccessProfile(id);
  const existing = await db.profile.findUnique({ where: { id } });
  if (!existing) throw new Error('Profile not found.');

  // Move to Trash (soft delete). Close any running session first. Local data
  // (cookies/cache) is KEPT by default so the profile can be restored, but the
  // user can opt to wipe it now via the delete dialog.
  const removeLocalData = Boolean(input.removeLocalData);
  await closeProfileSession(String(id)).catch(() => {});
  await db.profile.update({ where: { id }, data: { deletedAt: new Date() } });
  if (removeLocalData) {
    await fs.rm(resolveProfileDataDir(existing.dataDirName), { recursive: true, force: true }).catch(() => {});
  }

  await logActivity(db, id, 'delete', `moved "${existing.title}" to Trash${removeLocalData ? ' + wiped local data' : ''}`);
  return { trashed: true, id, removedLocalData: removeLocalData };
}

async function restoreProfile(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
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
  await assertCanAccessProfile(id);
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
  const { allowed, denied } = await partitionAccessibleProfileIds(ids);
  const result = { trashed: [], errors: denied.map((id) => ({ id, message: 'You do not have access to this profile.' })) };
  for (const id of allowed) {
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
  const { allowed, denied } = await partitionAccessibleProfileIds(ids);
  const result = { restored: [], errors: denied.map((id) => ({ id, message: 'You do not have access to this profile.' })) };
  for (const id of allowed) {
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
  const { allowed, denied } = await partitionAccessibleProfileIds(ids);
  const removeLocalData = Boolean(input.removeLocalData);
  const result = { purged: [], errors: denied.map((id) => ({ id, message: 'You do not have access to this profile.' })) };
  for (const id of allowed) {
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
  reconcileProfileLocks(); // release locks for the sessions just closed
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
  const { allowed } = await partitionAccessibleProfileIds(ids);
  const res = await db.profile.updateMany({ where: { id: { in: allowed } }, data: { groupId } });
  const label = groupId === null ? 'removed from group' : 'assigned to a group';
  for (const id of ids) { await logActivity(db, id, 'assign', label); }
  return { assigned: res.count, groupId };
}

async function listTags() {
  const db = getPrisma();
  const rows = await db.profile.findMany({ where: { deletedAt: null }, select: { tags: true } });
  return collectTags(rows).sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Softglaze Enterprise — Profile lock-when-in-use.
//
// A transient, in-memory registry of which member is currently running which
// profile. It blocks a SECOND concurrent launch of the same profile by a
// DIFFERENT member (a real constraint too — Chromium can't open two instances on
// one userDataDir). Locks are NOT persisted: they're reconciled against the live
// session set (`listAllSessions()` — the existing orphan-cleanup source of
// truth), so a close/crash/restart clears them automatically.
// ---------------------------------------------------------------------------
const profileLocks = new Map(); // profileId(Number) -> { memberId, memberName, sessionId, at }

function reconcileProfileLocks() {
  if (profileLocks.size === 0) return;
  const live = new Set(listAllSessions().map((s) => String(s.sessionId)));
  for (const [pid, lock] of profileLocks) {
    if (!live.has(String(lock.sessionId))) profileLocks.delete(pid);
  }
}

// Throw if `member` may not launch this profile because another member holds a
// live lock on it. (Same member re-launching is allowed.)
function assertProfileLaunchable(profileId, member) {
  reconcileProfileLocks();
  const existing = profileLocks.get(Number(profileId));
  const live = new Set(listAllSessions().map((s) => String(s.sessionId)));
  const requesterId = (member && member.id != null) ? member.id : currentMemberId;
  if (teamPolicy.lockBlocks(existing, requesterId, live)) {
    const when = existing.at ? new Date(existing.at).toLocaleString() : 'now';
    const e = new Error(`This profile is in use by ${existing.memberName || 'another member'} (since ${when}). Ask them to close it first.`);
    e.code = 'PROFILE_LOCKED';
    throw e;
  }
}

function acquireProfileLock(profileId, sessionId, member) {
  profileLocks.set(Number(profileId), {
    memberId: (member && member.id != null) ? member.id : currentMemberId,
    memberName: (member && member.name) || 'You',
    sessionId: String(sessionId),
    at: Date.now()
  });
}

async function getProfileLocks() {
  reconcileProfileLocks();
  const out = {};
  for (const [pid, lock] of profileLocks) {
    out[pid] = {
      memberId: lock.memberId,
      memberName: lock.memberName,
      mine: String(lock.memberId) === String(currentMemberId),
      at: lock.at
    };
  }
  return out;
}

async function launchProfile(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
  const profile = await db.profile.findUnique({ where: { id }, include: { proxy: true } });
  if (!profile) throw new Error('Profile not found.');

  // License gate — a banned owner tree cannot launch (enforced in main, not just
  // the renderer).
  await assertNotBanned();

  // Block a concurrent launch by a different member (lock-when-in-use).
  const launcher = await getActiveMember();
  assertProfileLaunchable(id, launcher);

  // FlowerBrowser = real Firefox. It's a different engine (no CDP/MV3), so route to
  // the Firefox launcher which configures a dedicated profile via user.js prefs
  // (proxy + auth relay, UA, locale, timezone, WebRTC off).
  const isFirefox = /flower|firefox/i.test(String(profile.browserCore || ''));
  if (isFirefox) {
    const { profileRoot: ffRoot } = getRuntimeConfig();
    const useFfProxy = profile.systemProxyBehavior === 'PROFILE_PROXY';
    const ffRotated = await pickRotationProxy(db, id);
    const ffProxy = ffRotated || (useFfProxy ? profile.proxy : null);
    const ffSession = await firefoxEngine.launchFirefoxProfile({
      profileId: profile.id,
      title: profile.title,
      dataDirName: profile.dataDirName,
      proxy: ffProxy,
      proxyInfoString: ffRotated ? null : (useFfProxy ? profile.proxyInfoString : null),
      startUrl: input.startUrl || 'about:blank',
      profileRoot: ffRoot,
      profile
    });
    acquireProfileLock(id, ffSession.sessionId, launcher);
    await db.profile.update({ where: { id }, data: { lastUsedAt: new Date(), launchCount: { increment: 1 } } }).catch(() => {});
    await logActivity(db, id, 'launch', `firefox session ${ffSession.sessionId}${ffRotated ? ` · rotated ${ffRotated.name}` : ''}`);
    return { ...ffSession, rotatedProxy: ffRotated ? serializeProxy(ffRotated) : null };
  }

  // A stored CUSTOM User-Agent that doesn't match the real binary would be a
  // detection tell — but the Chrome engine ALWAYS derives the UA from the real
  // launched binary and ignores profile.userAgent, so the safe thing is to launch
  // anyway with that auto-derived (matching) UA rather than block the user. We only
  // warn for legacy/mismatched values; we never reject the launch.
  const uaStr = String(profile.userAgent || '').trim();
  if (uaStr && uaStr.toLowerCase() !== 'auto') {
    const resolved = resolveBrowserExecutable(profile.browserVersion || profile.browserCore);
    const binaryMajor = resolved && resolved.major ? resolved.major : null;
    const uaChrome = uaStr.match(/Chrome\/(\d+)/i);
    if (!uaChrome || (binaryMajor && Number(uaChrome[1]) !== binaryMajor)) {
      console.warn(`[profile:launch] Profile "${profile.title}" has a custom UA that doesn't match the Chrome ${binaryMajor || '?'} engine — launching with the auto-derived (matching) UA instead.`);
    }
  }

  const { profileRoot } = getRuntimeConfig();
  const useProfileProxy = profile.systemProxyBehavior === 'PROFILE_PROXY';

  // Global browser / on-startup preferences honored at launch time.
  const globalSettings = await getGlobalSettings();
  // browser + onStartup drive launch flags; website rules drive request filtering.
  const browserSettings = { ...globalSettings.browser, ...globalSettings.onStartup, website: globalSettings.website };

  // Proxy rotation: if a pool is configured, the chosen pool proxy overrides the
  // profile's fixed proxy for this launch (sticky session — same userDataDir).
  const rotated = await pickRotationProxy(db, id);
  const launchProxy = rotated || (useProfileProxy ? profile.proxy : null);
  const launchProxyInfo = rotated ? null : (useProfileProxy ? profile.proxyInfoString : null);

  // Global team extensions to mount into this launch (merged into --load-extension
  // alongside the fingerprint extension inside launchProfileSession).
  const globalExtensionDirs = await extensionManager.resolveGlobalExtensionDirs();

  const session = await launchProfileSession({
    profileId: profile.id,
    title: profile.title,
    dataDirName: profile.dataDirName,
    proxy: launchProxy,
    proxyInfoString: launchProxyInfo,
    startUrl: input.startUrl || 'about:blank',
    profileRoot,
    headless: false,
    profile, // full fingerprint config applied at launch
    browserSettings,
    captcha: globalSettings.captcha,
    globalExtensionDirs,
    geoMatchEnabled: !(globalSettings.geoMatch && globalSettings.geoMatch.enabled === false)
  });

  acquireProfileLock(id, session.sessionId, launcher);
  await db.profile.update({ where: { id }, data: { lastUsedAt: new Date(), launchCount: { increment: 1 } } }).catch(() => {});
  await logActivity(db, id, 'launch', `session ${session.sessionId}${rotated ? ` · rotated proxy ${rotated.name}` : ''}`);
  return { ...session, rotatedProxy: rotated ? serializeProxy(rotated) : null };
}

async function closeSession(payload) {
  const input = requireObject(payload);
  const sessionId = requiredString(input.sessionId, 'sessionId');
  // Firefox sessions live in their own engine.
  const result = firefoxEngine.isFirefoxSession(sessionId)
    ? await firefoxEngine.closeFirefoxSession(sessionId)
    : await closeProfileSession(sessionId);
  reconcileProfileLocks(); // release any lock whose session just ended
  return result;
}

// Combined live sessions across both engines (Chrome + Firefox) for the UI.
function listAllSessions() {
  return [...listActiveSessions(), ...firefoxEngine.listFirefoxSessions()];
}

async function previewProfilesViaDialog() {
  const selection = await dialog.showOpenDialog({
    title: 'Select a Softglaze profile spreadsheet to import',
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

// Country/region aliasing so an import cell ("US", "United States", "usa") can
// be matched against a proxy's health-checked lastCountry ("United States").
const COUNTRY_CODE_NAMES = {
  US: 'united states', GB: 'united kingdom', CA: 'canada', AU: 'australia', DE: 'germany',
  FR: 'france', ES: 'spain', IT: 'italy', NL: 'netherlands', BR: 'brazil', RU: 'russia',
  PL: 'poland', SE: 'sweden', TR: 'turkey', IN: 'india', JP: 'japan', CN: 'china',
  KR: 'south korea', MX: 'mexico', IE: 'ireland', PT: 'portugal', SA: 'saudi arabia',
  AE: 'united arab emirates', EG: 'egypt', PK: 'pakistan', ID: 'indonesia', PH: 'philippines',
  VN: 'vietnam', TH: 'thailand', SG: 'singapore', HK: 'hong kong', ZA: 'south africa',
  NG: 'nigeria', AR: 'argentina', CL: 'chile', CO: 'colombia', UA: 'ukraine', RO: 'romania',
  CZ: 'czechia', CH: 'switzerland', AT: 'austria', BE: 'belgium', DK: 'denmark', NO: 'norway',
  FI: 'finland', GR: 'greece'
};

function toCountryCode(value) {
  const v = String(value || '').trim().toLowerCase().replace(/^usa$/, 'united states').replace(/^uk$/, 'united kingdom');
  if (!v) return '';
  if (v.length === 2 && COUNTRY_CODE_NAMES[v.toUpperCase()]) return v.toUpperCase();
  for (const [code, name] of Object.entries(COUNTRY_CODE_NAMES)) {
    if (name === v || v.includes(name) || name.includes(v)) return code;
  }
  return v.toUpperCase();
}

function countryMatches(want, proxyCountry) {
  const a = toCountryCode(want);
  const b = toCountryCode(proxyCountry);
  return Boolean(a && b && a === b);
}

async function commitProfileImport(payload, event) {
  const input = requireObject(payload);
  const token = requiredString(input.token, 'Import token');
  const autoBind = Boolean(input.autoBindByCountry);
  const cached = importPreviewCache.get(token);
  if (!cached) throw new Error('Import preview expired or was not found. Please preview the file again.');

  const db = getPrisma();
  // Live progress stream back to the renderer (terminal log + progress bar).
  const total = cached.parsed.items.length;
  const emit = (data) => { try { event && event.sender && event.sender.send(CHANNELS.BATCH_IMPORT_PROGRESS, data); } catch (e) { /* renderer may be gone */ } };
  emit({ phase: 'start', total, level: 'info', message: `[INFO] Softglaze import started — ${total} profile${total === 1 ? '' : 's'} from "${cached.parsed.fileName}".` });
  const result = {
    fileName: cached.parsed.fileName,
    sheetName: cached.parsed.sheetName,
    headerRow: cached.parsed.headerRow,
    totalRows: cached.parsed.totalRows,
    createdProfiles: [],
    createdProxies: [],
    autoBound: [],
    skippedRows: [],
    errors: [...cached.parsed.errors]
  };

  // For auto-bind: load the saved proxy pool once and round-robin matches per
  // country so the import spreads profiles evenly across same-country proxies.
  const pool = autoBind ? await db.proxy.findMany() : [];
  const rrIndex = {};
  const pickProxyForCountry = (country) => {
    const code = toCountryCode(country);
    if (!code) return null;
    const matches = pool.filter((p) => countryMatches(country, p.lastCountry));
    if (matches.length === 0) return null;
    const i = (rrIndex[code] || 0) % matches.length;
    rrIndex[code] = (rrIndex[code] || 0) + 1;
    return matches[i];
  };

  // Rotation URLs have no Profile column — round-trip them via a Setting map.
  const rotationUrls = (await readSetting('profileRotationUrls', {})) || {};
  let rotationDirty = false;
  // A log-only line (no progress-bar change); item/done lines move the bar.
  const log = (level, message) => emit({ phase: 'log', level, message });

  let processed = 0;
  for (const item of cached.parsed.items) {
    processed += 1;
    try {
      log('info', `[INFO] Parsing Row ${item.row}: Creating Profile "${item.title}"...`);
      if (item.proxyMethod === 'CUSTOM' && !item.rawProxy) {
        result.skippedRows.push({ row: item.row, reason: 'CUSTOM_PROXY_SELECTED_WITHOUT_PROXY_DATA' });
        emit({ phase: 'item', index: processed, total, title: item.title, ok: false, skipped: true, level: 'warn', message: `[WARN] Row ${item.row} skipped: Custom proxy selected but no proxy data.` });
        continue;
      }

      let proxy = null;
      let autoBoundProxy = false;
      if (item.proxyMethod === 'CUSTOM') {
        proxy = await findOrCreateProxy(db, item.rawProxy, `${item.title} Proxy`, item.proxyType || null);
        if (proxy) {
          result.createdProxies.push(serializeProxy(proxy));
          log('info', `[INFO] Binding ${proxy.type} Proxy ${proxy.host}:${proxy.port}...`);
        }
      } else if (autoBind && item.country) {
        // Row has no explicit proxy — bind a saved proxy whose country matches.
        proxy = pickProxyForCountry(item.country);
        if (proxy) { autoBoundProxy = true; log('info', `[INFO] Auto-binding ${proxy.type} proxy ${proxy.name} for ${item.country}...`); }
      }

      // Any assigned proxy implies the profile should route through it.
      const systemProxyBehavior = proxy ? 'PROFILE_PROXY' : parseSystemProxyBehavior(item.systemProxyBehavior, 'DIRECT');

      // Resolve the group by name (create it if new) so "Group Name" works.
      let groupId = null;
      if (item.group) {
        const groupName = String(item.group).trim();
        if (groupName && !/^\d+$/.test(groupName)) { // skip bare "0/1" tag flags
          const existingGroup = await db.group.findFirst({ where: { name: groupName } });
          const grp = existingGroup || await db.group.create({ data: { name: groupName } });
          groupId = grp.id;
          log('success', `[SUCCESS] Group "${groupName}" ${existingGroup ? 'verified' : 'created'}...`);
        }
      }

      // Platform account credentials + 2FA secret (from the template's columns).
      let platformAccounts = null;
      if (item.accountUsername || item.accountPassword || item.twoFa) {
        platformAccounts = JSON.stringify([{
          platform: 'Other',
          username: item.accountUsername || '',
          password: item.accountPassword || '',
          twoFa: item.twoFa || ''
        }]);
      }

      // Imported fingerprint / localization fields override the generated base.
      // Anything not present in the file keeps its sane generated default.
      const fp = {};
      if (item.os) fp.os = item.os;
      if (item.browserCore) fp.browserCore = item.browserCore;
      if (item.userAgent) fp.userAgent = String(item.userAgent).trim();
      if (item.resolutionW && item.resolutionH) { fp.resolutionType = 'Custom'; fp.resolutionW = String(item.resolutionW); fp.resolutionH = String(item.resolutionH); }
      if (item.webrtc) fp.webrtc = item.webrtc;
      if (item.canvasNoise !== undefined && item.canvasNoise !== null) fp.canvasNoise = item.canvasNoise;
      if (item.webglNoise !== undefined && item.webglNoise !== null) fp.webglImageNoise = item.webglNoise;
      if (item.audioNoise !== undefined && item.audioNoise !== null) fp.audioContextNoise = item.audioNoise;
      if (item.webglVendor) { fp.webglMetadata = 'Custom'; fp.webglVendor = item.webglVendor; }
      if (item.webglRenderer) { fp.webglMetadata = 'Custom'; fp.webglRenderer = item.webglRenderer; }
      if (item.cpuCores) { fp.cpuType = 'Custom'; fp.cpuCores = String(item.cpuCores); }
      if (item.ramGb) { fp.ramType = 'Custom'; fp.ramGb = String(item.ramGb); }
      if (item.doNotTrack !== undefined && item.doNotTrack !== null) fp.doNotTrack = item.doNotTrack;
      if (item.timezoneType) fp.timezoneType = item.timezoneType;
      if (item.timezoneCustom) fp.timezoneCustom = item.timezoneCustom;
      if (item.languageType) fp.languageType = item.languageType;
      if (item.languageCustom) fp.languageCustom = item.languageCustom;
      if (item.locationType) fp.locationType = item.locationType;
      if (item.locationLat) fp.locationLat = String(item.locationLat);
      if (item.locationLng) fp.locationLng = String(item.locationLng);

      const dataDirName = await ensureUniqueDataDirName(db, item.dataDirName || item.title);
      // Distinct fingerprint per imported profile FIRST, then the explicit
      // template values override (so imported settings aren't clobbered).
      const fpFields = generateFingerprint();
      const profile = await db.profile.create({
        data: {
          ...fpFields,
          ...fp,
          title: item.title,
          proxyId: proxy ? proxy.id : null,
          proxyInfoString: proxy ? buildProxyInfoString(proxy) : null,
          notes: optionalString(item.notes),
          systemProxyBehavior,
          dataDirName,
          groupId,
          ...(item.openUrl ? { startupUrls: String(item.openUrl).trim() } : {}),
          ...(platformAccounts ? { platformAccounts } : {})
        },
        include: { proxy: true, group: true }
      });

      if (item.proxyRotationUrl) { rotationUrls[profile.id] = String(item.proxyRotationUrl).trim(); rotationDirty = true; }

      result.createdProfiles.push(serializeProfile(profile));
      if (autoBoundProxy) result.autoBound.push({ row: item.row, title: item.title, country: item.country, proxy: serializeProxy(proxy) });
      await logActivity(db, profile.id, 'import', `imported "${profile.title}"${autoBoundProxy ? ` (auto-bound ${proxy.name})` : ''}`);
      emit({ phase: 'item', index: processed, total, title: profile.title, ok: true, level: 'success', message: `[SUCCESS] Profile "${profile.title}" created.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown import error';
      result.errors.push({ row: item.row, message });
      emit({ phase: 'item', index: processed, total, title: item.title, ok: false, level: 'error', message: `[ERROR] Row ${item.row} failed: ${message}` });
    }
  }

  if (rotationDirty) await writeSetting('profileRotationUrls', rotationUrls).catch(() => {});
  importPreviewCache.delete(token);
  emit({ phase: 'done', total, created: result.createdProfiles.length, proxies: result.createdProxies.length, autoBound: result.autoBound.length, errors: result.errors.length, level: 'info', message: `[INFO] Done — ${result.createdProfiles.length} created, ${result.createdProxies.length} new proxies, ${result.errors.length} error(s).` });
  return result;
}

// --- Profile Migration (transfer from competitor platforms) ----------------
// Fetches profiles from a competitor platform's API and imports them. Gated to
// Owner / Super Admin (enforced HERE in the main process — never trust the UI).
// Progress streams live to the renderer; each profile (+ its proxy) is inserted
// in its OWN transaction so a single malformed row can't corrupt the database
// or abort the whole transfer — failures are collected and reported.
async function migrateProfiles(payload, event) {
  await requireOwnerOrSuper('transfer profiles');
  const input = requireObject(payload);
  const platform = requiredString(input.platform, 'Source platform');
  const token = requiredString(input.token, 'API token');
  if (!migrationService.isValidPlatform(platform)) throw new Error('Unsupported source platform.');

  const db = getPrisma();
  const label = (migrationService.getPlatform(platform) || {}).label || platform;
  const emit = (data) => { try { event && event.sender && event.sender.send(CHANNELS.MIGRATION_PROGRESS, data); } catch (e) { /* renderer may be gone */ } };

  emit({ phase: 'start', level: 'info', message: `[INFO] Connecting to ${label}...` });

  let rawProfiles;
  try {
    rawProfiles = await migrationService.fetchProfiles(platform, token);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    emit({ phase: 'error', level: 'error', message: `[ERROR] Could not reach ${label}: ${message}` });
    throw e;
  }

  const total = Array.isArray(rawProfiles) ? rawProfiles.length : 0;
  emit({ phase: 'found', total, level: 'success', message: `[SUCCESS] Found ${total} profile${total === 1 ? '' : 's'} in ${label}.` });

  const stampId = ownerStampId();
  const result = { platform, label, total, createdProfiles: [], createdProxyIds: [], errors: [] };
  let processed = 0;

  for (const raw of rawProfiles) {
    processed += 1;
    let norm;
    try {
      norm = migrationService.normalizeProfile(platform, raw);
    } catch (e) {
      result.errors.push({ index: processed, message: `parse failed: ${e.message}` });
      emit({ phase: 'item', index: processed, total, ok: false, level: 'error', message: `[ERROR] Profile ${processed}/${total}: could not parse source data.` });
      continue;
    }

    emit({ phase: 'item', index: processed, total, title: norm.title, level: 'info', message: `[INFO] Migrating profile ${processed}/${total}: "${norm.title}"...` });
    try {
      const created = await db.$transaction(async (tx) => {
        let proxy = null;
        if (norm.proxyRaw) proxy = await findOrCreateProxy(tx, norm.proxyRaw, `${norm.title} Proxy`, norm.proxyType);
        const dataDirName = await ensureUniqueDataDirName(tx, norm.title);
        const overrides = {};
        if (norm.os) overrides.os = norm.os;
        if (norm.userAgent) overrides.userAgent = norm.userAgent;
        const profile = await tx.profile.create({
          data: {
            ...generateFingerprint(), // distinct Softglaze fingerprint base
            ...overrides,             // then the competitor's known values
            title: norm.title,
            notes: norm.notes,
            proxyId: proxy ? proxy.id : null,
            proxyInfoString: proxy ? buildProxyInfoString(proxy) : null,
            systemProxyBehavior: proxy ? 'PROFILE_PROXY' : 'DIRECT',
            dataDirName,
            ownerMemberId: stampId,
            assignedMemberId: stampId,
            tags: (norm.tags && norm.tags.length) ? JSON.stringify(norm.tags) : null
          },
          include: { proxy: true, group: true }
        });
        return { profile, proxy };
      });

      result.createdProfiles.push(serializeProfile(created.profile));
      if (created.proxy) result.createdProxyIds.push(created.proxy.id);
      await logActivity(db, created.profile.id, 'migrate', `migrated "${created.profile.title}" from ${label}`);
      emit({ phase: 'item', index: processed, total, title: created.profile.title, ok: true, level: 'success', message: `[SUCCESS] Imported "${created.profile.title}".` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push({ index: processed, title: norm.title, message });
      emit({ phase: 'item', index: processed, total, title: norm.title, ok: false, level: 'error', message: `[ERROR] "${norm.title}" failed: ${message}` });
    }
  }

  const uniqueProxies = new Set(result.createdProxyIds).size;
  emit({ phase: 'done', total, created: result.createdProfiles.length, proxies: uniqueProxies, errors: result.errors.length, level: 'info', message: `[INFO] Transfer complete — ${result.createdProfiles.length}/${total} imported, ${uniqueProxies} proxies, ${result.errors.length} error(s).` });
  return { total, created: result.createdProfiles.length, proxies: uniqueProxies, errors: result.errors, profiles: result.createdProfiles };
}

// First platform account creds (username/password/2FA) stored on a profile.
function firstAccount(p) {
  try {
    const arr = JSON.parse(p.platformAccounts || '[]');
    const f = (Array.isArray(arr) && arr[0]) ? arr[0] : {};
    return { username: f.username || '', password: f.password || '', twoFa: f.twoFa || '' };
  } catch (e) { return { username: '', password: '', twoFa: '' }; }
}

// The single source of truth for the EXPORT layout — kept symmetrical with the
// importer's column blueprint so an export re-imports cleanly. [header, getter].
const EXPORT_COLUMNS = [
  ['Profile Title', (p) => p.title || ''],
  ['Group Name', (p) => (p.group ? p.group.name : '')],
  ['Notes', (p) => p.notes || ''],
  ['Data Dir Name', (p) => p.dataDirName || ''],
  ['Operating System', (p) => p.os || ''],
  ['Browser Core', (p) => p.browserCore || ''],
  ['Browser Brand', (p) => p.browserBrand || ''],
  ['User-Agent', (p) => p.userAgent || ''],
  ['Screen Resolution', (p) => ((p.resolutionW && p.resolutionH) ? `${p.resolutionW}x${p.resolutionH}` : '')],
  ['Proxy Method', (p) => (p.systemProxyBehavior === 'PROFILE_PROXY' ? 'Custom' : p.systemProxyBehavior === 'SYSTEM_PROXY' ? 'System' : 'Direct')],
  ['Proxy Protocol', (p) => (p.proxy ? p.proxy.type : '')],
  ['Proxy Info', (p) => (p.proxy ? `${p.proxy.host}:${p.proxy.port}:${p.proxy.username || ''}:${p.proxy.password || ''}` : '')],
  ['Proxy Host', (p) => (p.proxy ? p.proxy.host : '')],
  ['Proxy Port', (p) => (p.proxy ? String(p.proxy.port) : '')],
  ['Proxy Username', (p) => (p.proxy ? (p.proxy.username || '') : '')],
  ['Proxy Password', (p) => (p.proxy ? (p.proxy.password || '') : '')],
  ['Proxy Rotation URL', (p, rot) => (rot[p.id] || '')],
  ['WebRTC', (p) => p.webrtc || ''],
  ['Canvas', (p) => (p.canvasNoise === false ? 'Real' : 'Noise')],
  ['WebGL', (p) => (p.webglImageNoise === false ? 'Real' : 'Noise')],
  ['WebGL Vendor', (p) => p.webglVendor || ''],
  ['WebGL Renderer', (p) => p.webglRenderer || ''],
  ['AudioContext', (p) => (p.audioContextNoise === false ? 'Real' : 'Noise')],
  ['CPU Cores', (p) => p.cpuCores || ''],
  ['Memory (GB)', (p) => p.ramGb || ''],
  ['Do Not Track', (p) => (p.doNotTrack === '1' ? '1' : '0')],
  ['Timezone Mode', (p) => (p.timezoneType === 'Custom' ? 'Manual' : 'Auto')],
  ['Timezone', (p) => p.timezoneCustom || ''],
  ['Locale Mode', (p) => (p.languageType === 'Custom' ? 'Manual' : 'Auto')],
  ['Locale', (p) => p.languageCustom || ''],
  ['Geolocation Mode', (p) => p.locationType || ''],
  ['Latitude', (p) => p.locationLat || ''],
  ['Longitude', (p) => p.locationLng || ''],
  ['Account Username', (p) => firstAccount(p).username],
  ['Account Password', (p) => firstAccount(p).password],
  ['2FA Key', (p) => firstAccount(p).twoFa],
  ['Open The Specified URL', (p) => p.startupUrls || ''],
  ['Created At', (p) => (p.createdAt instanceof Date ? p.createdAt.toISOString() : (p.createdAt || ''))]
];

async function gatherExport() {
  const db = getPrisma();
  const profiles = await db.profile.findMany({
    where: { deletedAt: null },
    include: { proxy: true, group: true },
    orderBy: { createdAt: 'asc' }
  });
  const rotationUrls = (await readSetting('profileRotationUrls', {})) || {};
  const headers = EXPORT_COLUMNS.map((c) => c[0]);
  const rows = profiles.map((p) => EXPORT_COLUMNS.map((c) => c[1](p, rotationUrls)));
  return { headers, rows, count: profiles.length };
}

// Data API (returns the full matrix for programmatic use).
async function exportProfiles() {
  return gatherExport();
}

// Native save-dialog export to a CSV or Excel workbook (default xlsx).
async function exportProfilesToFile(payload) {
  const input = (payload && typeof payload === 'object') ? payload : {};
  const format = input.format === 'csv' ? 'csv' : 'xlsx';
  const { headers, rows, count } = await gatherExport();
  if (count === 0) throw new Error('There are no profiles to export yet.');

  const stamp = new Date().toISOString().slice(0, 10);
  const res = await dialog.showSaveDialog({
    title: 'Export Softglaze profiles',
    defaultPath: `softglaze-profiles-export-${stamp}.${format}`,
    filters: format === 'csv'
      ? [{ name: 'CSV', extensions: ['csv'] }]
      : [{ name: 'Excel Workbook', extensions: ['xlsx'] }, { name: 'CSV', extensions: ['csv'] }]
  });
  if (res.canceled || !res.filePath) return { saved: false, cancelled: true };

  const XLSX = require('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Profiles');
  const bookType = /\.csv$/i.test(res.filePath) ? 'csv' : 'xlsx';
  XLSX.writeFile(wb, res.filePath, { bookType });
  return { saved: true, path: res.filePath, count };
}

// ---------- Activity / usage history ----------

async function listActivity(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
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
  await assertCanAccessProfile(id);
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

  const score = computeTrustScore(checks);
  return { profileId: id, running: true, env, webrtcIps, exit, checks, summary: score.summary, score };
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
  // Delegate to the concurrent sweeper (worker-capped) so the scheduled sweep and
  // the manual "Test all" share one code path.
  await runProxyHealthSweepConcurrent(8);
}

// Concurrent health sweep — runs up to `limit` checks at a time instead of one
// after another. Reuses the existing single-proxy checker + health persistence,
// so it does not reimplement connectivity logic. Returns { total, ok, fail }.
async function runProxyHealthSweepConcurrent(limit = 8) {
  const db = getPrisma();
  const proxies = await db.proxy.findMany();
  const summary = { total: proxies.length, ok: 0, fail: 0 };
  if (proxies.length === 0) return summary;

  const cap = Math.max(1, Math.min(16, Number(limit) || 8));
  let cursor = 0;
  async function worker() {
    while (cursor < proxies.length) {
      const proxy = proxies[cursor++];
      try {
        const result = await testProxyConnectivity({ type: proxy.type, host: proxy.host, port: proxy.port, username: proxy.username, password: proxy.password });
        await persistProxyHealth(db, proxy.id, result);
        if (result && result.success) summary.ok += 1; else summary.fail += 1;
      } catch (e) { summary.fail += 1; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(cap, proxies.length) }, () => worker()));
  return summary;
}

// "Test all" action — concurrent health check of every proxy. No secrets are
// returned (only a count summary), so it is safe for any role.
async function testAllProxies() {
  return runProxyHealthSweepConcurrent(8);
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

// ---------------------------------------------------------------------------
// Global application settings. Stored as a single merged JSON
// blob under the `globalSettings` key. Reads always return defaults merged with
// stored overrides so new fields appear automatically across upgrades. Writes
// deep-merge a partial patch so the renderer can save one toggle at a time.
//
// Enforcement note: the `browser` and `onStartup` groups are honored by the
// launch engine (see launchProfile). The `security`, `multiDevice`, `website`,
// `platform`, `ipSetting`, and `dataSync` groups are persisted preferences that
// the rest of the app reads; deep behavioral enforcement (e.g. real 2FA gating,
// cross-device sync) is layered on top of these flags, not implied by them.
// ---------------------------------------------------------------------------
const GLOBAL_SETTINGS_DEFAULTS = Object.freeze({
  security: {
    remoteLoginReminder: false,
    failedLoginAlert: true,
    loginIpAllowlist: { enabled: false, ips: [] },
    twoStep: { enabled: false, method: 'email', level: 'medium' } // method: app|email|sms ; level: low|medium|high
  },
  multiDevice: { mode: 'off', profileIds: [] }, // mode: off | full | specified
  website: {
    blockAccess: { enabled: false, mode: 'blocklist', list: [] }, // mode: blocklist | allowlist
    fbStaticLocal: false,
    localNetworkAccess: false
  },
  platform: { customIconEnabled: false, displayCustomNo: false, displayLast4: false },
  ipSetting: {
    autoConfig: { lastUsedIp: true, asn: false, city: true, region: true, country: true },
    ipChecker: 'ip-api'
  },
  dataSync: {
    cookie: true, passwords: false, bookmarks: true, localStorage: false,
    indexedDb: false, extensionData: false, history: false
  },
  browser: {
    matchTimezoneOnIpChange: true,
    allowChromeSignin: false,
    offerTranslate: false,
    disableDevtools: false,
    lockExtensions: false,
    enableVirtualCamera: false,
    mobileSimulation: false,
    secureAccess: false,
    disableVideos: false,
    disableImages: false,
    imageMinKb: 10
  },
  onStartup: {
    mode: 'detection', // detection | last | blank
    onlyOpenWithProxy: false,
    onlyOpenWhenExtensionLoaded: false,
    blockIfCountryChanged: false
  },
  captcha: {
    enabled: false,
    provider: '2captcha', // 2captcha | anticaptcha
    apiKey: '',
    solveRecaptchaV2: true,
    solveHcaptcha: true
  },
  // Geo auto-match: derive each profile's timezone / locale / WebRTC exit IP from
  // its proxy's geo at launch. ON by default; turning this off makes profiles use
  // only their manually-configured values (the per-field Real/Custom types still
  // apply). See browserEngine launchProfileSession({ geoMatchEnabled }).
  geoMatch: {
    enabled: true
  }
});

function deepMergeSettings(base, patch) {
  if (patch === undefined) return base;
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = Array.isArray(base) ? {} : { ...(base && typeof base === 'object' ? base : {}) };
  for (const key of Object.keys(patch)) {
    const b = base && typeof base === 'object' ? base[key] : undefined;
    const p = patch[key];
    out[key] = (b && typeof b === 'object' && !Array.isArray(b) && p && typeof p === 'object' && !Array.isArray(p))
      ? deepMergeSettings(b, p)
      : p;
  }
  return out;
}

async function getGlobalSettings() {
  const stored = await readSetting('globalSettings', {});
  return deepMergeSettings(GLOBAL_SETTINGS_DEFAULTS, stored && typeof stored === 'object' ? stored : {});
}

async function setGlobalSettings(payload) {
  const input = requireObject(payload);
  const current = await getGlobalSettings();
  const next = deepMergeSettings(current, input);
  await writeSetting('globalSettings', next);
  return next;
}

// ---------------------------------------------------------------------------
// Monetization — affiliate / referral links for the Proxy Provider marketplace.
// Owners and the Super Admin set the partner URLs that the "Purchase at X" /
// "Visit X Dashboard" buttons on the Proxy pool → Providers tab link out to.
// Stored as a single { providerKey: url } override map under the `affiliateLinks`
// setting key. Reads are open to every member (the URLs are public-facing and
// power buttons all members can click); writes are gated to Owner / Super Admin.
// A blank value clears the override so the button falls back to its built-in
// default — the override map only ever holds non-empty URLs.
// ---------------------------------------------------------------------------
function sanitizeAffiliateUrl(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return ''; // empty clears the override
  if (s.length > 500) throw new Error('That URL is too long.');
  let parsed;
  try { parsed = new URL(s); } catch (e) { throw new Error(`"${s.slice(0, 60)}" is not a valid URL.`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Affiliate links must start with http:// or https://');
  }
  return s;
}

async function getAffiliateLinks() {
  const stored = await readSetting('affiliateLinks', {});
  const links = {};
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [key, val] of Object.entries(stored)) {
      if (typeof val === 'string' && val) links[key] = val;
    }
  }
  return { links };
}

async function setAffiliateLinks(payload) {
  await requireOwnerOrSuper('manage monetization links');
  const input = requireObject(payload);
  const incoming = (input.links && typeof input.links === 'object' && !Array.isArray(input.links)) ? input.links : {};
  const next = {};
  for (const [rawKey, rawVal] of Object.entries(incoming)) {
    const key = String(rawKey).trim();
    if (!/^[a-z0-9]{1,40}$/.test(key)) continue; // only catalog-style provider keys
    const url = sanitizeAffiliateUrl(rawVal);
    if (url) next[key] = url; // omit blanks so they fall back to defaults
  }
  await writeSetting('affiliateLinks', next);
  return { links: next };
}

// ---------------------------------------------------------------------------
// Team Extensions — download Chrome Web Store extensions as raw .crx, unzip them
// locally (extensionManager), and persist a record. Globally-enabled extensions
// are merged into --load-extension at every profile launch. Installs/edits are
// gated to ADMIN+ since an extension injected into every profile is high-impact;
// listing is open so the page renders for everyone who can see it.
// ---------------------------------------------------------------------------
function serializeExtension(e) {
  return {
    id: e.id,
    name: e.name,
    chromeId: e.chromeId,
    version: e.version || null,
    localPath: e.localPath,
    isGlobal: Boolean(e.isGlobal),
    storeUrl: `https://chromewebstore.google.com/detail/${e.chromeId}`,
    createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : (e.createdAt || null)
  };
}

async function listExtensions() {
  const rows = await getPrisma().extension.findMany({ orderBy: { createdAt: 'desc' } });
  return { extensions: rows.map(serializeExtension) };
}

async function installExtensionFromId(payload) {
  await requirePermission('extensions.manage');
  const input = requireObject(payload);
  const chromeId = extensionManager.parseChromeId(input.idOrUrl ?? input.id ?? input.url);
  if (!chromeId) throw new Error('Enter a valid 32-character Chrome Web Store ID or store URL.');

  const db = getPrisma();
  const existing = await db.extension.findUnique({ where: { chromeId } });
  if (existing) throw new Error('That extension is already in your Team Repository.');

  // Download + unzip the .crx and persist the record (throws a friendly message
  // on any failure). New manual installs default to enabled.
  const created = await extensionManager.installById(chromeId, { isGlobal: true });
  return serializeExtension(created);
}

async function deleteExtension(payload) {
  await requirePermission('extensions.manage');
  const id = requiredString(requireObject(payload).id, 'Extension id');
  const db = getPrisma();
  const ext = await db.extension.findUnique({ where: { id } });
  if (ext) {
    await extensionManager.removeExtensionFiles(ext.localPath);
    await db.extension.delete({ where: { id } }).catch(() => {});
  }
  return { deleted: true };
}

async function toggleExtensionGlobal(payload) {
  await requirePermission('extensions.manage');
  const input = requireObject(payload);
  const id = requiredString(input.id, 'Extension id');
  const db = getPrisma();
  const ext = await db.extension.findUnique({ where: { id } });
  if (!ext) throw new Error('Extension not found.');
  const isGlobal = input.isGlobal !== undefined ? Boolean(input.isGlobal) : !ext.isGlobal;
  const updated = await db.extension.update({ where: { id }, data: { isGlobal } });
  return serializeExtension(updated);
}

async function getSystemInfo() {
  const os = require('node:os');
  const { dbPath, profileRoot } = getRuntimeConfig();
  const cpus = os.cpus() || [];
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    dbPath,
    profileRoot,
    databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
    // Real OS metrics for the dashboard System Resources card.
    memTotal: totalMem,
    memFree: freeMem,
    memUsed: totalMem - freeMem,
    cpuCount: cpus.length,
    cpuModel: cpus[0] ? cpus[0].model : 'Unknown CPU',
    loadAvg: os.loadavg ? os.loadavg() : [0, 0, 0],
    platform: os.platform(),
    arch: os.arch(),
    osUptime: os.uptime(),
    hostname: os.hostname()
  };
}

// Real Chrome builds available on disk (for the profile editor's version picker).
async function listBrowsers() {
  const browsers = listAvailableBrowsers();
  return {
    count: browsers.length,
    browsers: browsers.map((b) => ({ major: b.major, version: b.version }))
  };
}

// Remote Chrome-for-Testing catalog merged with on-disk install status, so the UI
// can show "Installed" vs a "Download" button per version.
async function listAvailableBrowsers_(payload) {
  const installed = listAvailableBrowsers();
  const installedByMajor = new Map(installed.map((b) => [b.major, b.version]));
  const remote = await browserDownloader.listDownloadableVersions();
  const status = browserDownloader.getDownloadStatus();
  const statusByMajor = new Map(status.map((s) => [s.major, s]));
  return {
    items: remote.map((r) => ({
      major: r.major,
      version: r.version,
      installed: browserDownloader.isInstalled(r.version) || installedByMajor.has(r.major),
      installedVersion: installedByMajor.get(r.major) || null,
      download: statusByMajor.get(r.major) || null
    }))
  };
}

async function downloadBrowser(payload) {
  const input = requireObject(payload);
  const version = requiredString(input.version, 'version');
  const entry = browserDownloader.startDownload(version);
  return { started: true, version: entry.version, state: entry.state };
}

async function browserDownloadStatus() {
  return { downloads: browserDownloader.getDownloadStatus() };
}

async function pauseBrowserDownload(payload) {
  const input = requireObject(payload);
  const version = requiredString(input.version, 'version');
  return browserDownloader.pauseDownload(version);
}

async function resumeBrowserDownload(payload) {
  const input = requireObject(payload);
  const version = requiredString(input.version, 'version');
  const entry = browserDownloader.resumeDownload(version);
  return { started: true, version: entry.version, state: entry.state };
}

async function firefoxStatus() {
  const binary = firefoxEngine.findFirefoxBinary();
  return { installed: Boolean(binary), path: binary || null };
}

async function firefoxListDownloadable() {
  return firefoxEngine.listFirefoxDownloadable();
}

async function downloadFirefox(payload) {
  const input = requireObject(payload);
  const version = requiredString(input.version, 'version');
  const entry = firefoxEngine.startFirefoxDownload(version);
  return { started: true, version: entry.version, state: entry.state };
}

async function firefoxDownloadStatus() {
  return { downloads: firefoxEngine.getFirefoxDownloadStatus() };
}

async function pauseFirefoxDownload(payload) {
  const input = requireObject(payload);
  const version = requiredString(input.version, 'version');
  return firefoxEngine.pauseFirefoxDownload(version);
}

async function resumeFirefoxDownload(payload) {
  const input = requireObject(payload);
  const version = requiredString(input.version, 'version');
  const entry = firefoxEngine.resumeFirefoxDownload(version);
  return { started: true, version: entry.version, state: entry.state };
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
    activeSessions: listActiveSessions().length + firefoxEngine.listFirefoxSessions().length,
    totalProxies,
    totalGroups
  };
}

// ===================== Members, roles & vault (app lock) =====================
const ROLE_RANK = { OPERATOR: 1, MANAGER: 2, ADMIN: 3, OWNER: 4, SUPER_ADMIN: 5 };
const VALID_ROLES = ['OPERATOR', 'MANAGER', 'ADMIN', 'OWNER']; // SUPER_ADMIN is virtual, never a DB row

// Minimum role rank required for each gated action.
const PERMISSIONS = {
  'members.manage': 3, // ADMIN+
  'members.delete': 4, // OWNER
  'profiles.delete': 3,
  'profiles.purge': 4,
  'vault.manage': 4,
  'extensions.manage': 3 // ADMIN+ — team extensions inject into every profile
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
    username: m.username || null,
    role: m.role,
    color: m.color || '#3DC6DA',
    initials: m.initials || initialsFrom(m.name),
    avatarUrl: m.avatarUrl || null,
    hasPin: Boolean(m.pinHash),
    hasPassword: Boolean(m.passwordHash),
    parentMemberId: m.parentMemberId == null ? null : Number(m.parentMemberId),
    inviteStatus: m.inviteStatus || 'active',
    permissions: permissions.effectivePermissions(m),
    status: m.status || 'active',
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : (m.createdAt || null),
    lastActiveAt: m.lastActiveAt instanceof Date ? m.lastActiveAt.toISOString() : (m.lastActiveAt || null),
    ...extra
  };
}

// Human-friendly invite code (no ambiguous characters): SG-XXXX-XXXX.
function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = (n) => Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `SG-${pick(4)}-${pick(4)}`;
}

// A parent may never grant a child more than it holds itself. Clamp every numeric
// limit and AND every feature flag against the granter's effective permissions.
function clampPermissions(requested, granterPerms, childRole) {
  const def = permissions.defaultPermissionsFor(childRole);
  const out = { ...def, ...(requested && typeof requested === 'object' ? requested : {}) };
  const clampNum = (key) => {
    const g = granterPerms[key];
    if (g === -1 || g == null) return; // granter unlimited -> keep child's value
    const v = Number(out[key]);
    out[key] = Number.isFinite(v) ? Math.max(0, Math.min(v, g)) : 0;
  };
  ['maxProfiles', 'maxProxies', 'maxBrowsers', 'maxAdmins', 'maxManagers', 'maxOperators'].forEach(clampNum);
  // A child can never create a role its granter cannot.
  out.canCreateAdmins = Boolean(out.canCreateAdmins) && Boolean(granterPerms.canCreateAdmins);
  out.canCreateManagers = Boolean(out.canCreateManagers) && Boolean(granterPerms.canCreateManagers);
  out.canCreateOperators = Boolean(out.canCreateOperators) && Boolean(granterPerms.canCreateOperators);
  // Features: only those the granter can see can be granted.
  const gf = granterPerms.features || {};
  const rf = (requested && requested.features) || def.features;
  const features = {};
  for (const k of permissions.FEATURE_KEYS) features[k] = Boolean(rf[k]) && (gf[k] !== false);
  out.features = features;
  return out;
}

function limitError(kind, max) {
  const e = new Error(`You've reached your ${kind} limit (${max}). Ask whoever invited you to raise it.`);
  e.code = 'LIMIT_REACHED';
  return e;
}

// Block a create when the active member is at their granted quota. No active
// member (single-user mode) or SUPER_ADMIN => unrestricted. -1 => unlimited.
async function assertWithinLimit(kind) {
  const m = await getActiveMember();
  if (!m || m.role === 'SUPER_ADMIN') return;
  const perms = permissions.effectivePermissions(m);
  const db = getPrisma();
  if (kind === 'profiles') {
    const max = perms.maxProfiles;
    if (max == null || max < 0) return;
    const used = await db.profile.count({ where: { deletedAt: null, ownerMemberId: m.id } });
    if (used >= max) throw limitError('profile', max);
  } else if (kind === 'proxies') {
    const max = perms.maxProxies;
    if (max == null || max < 0) return;
    const used = await db.proxy.count({ where: { ownerMemberId: m.id } });
    if (used >= max) throw limitError('proxy', max);
  }
}

// The id to stamp onto member-owned resources (null for super admin / no member).
function ownerStampId() {
  return (currentMemberId != null && currentMemberId >= 0) ? currentMemberId : null;
}

async function getActiveMember() {
  if (currentMemberId == null) return null;
  if (permissions.isSuperAdminId(currentMemberId)) return { ...permissions.SUPER_ADMIN };
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
  if (member.status === 'suspended' || member.status === 'banned') {
    throw new Error(member.status === 'banned' ? 'This account is banned.' : 'This member is suspended.');
  }
  if (rankOf(member.role) < need) {
    const err = new Error('Your role does not permit this action.');
    err.code = 'FORBIDDEN';
    throw err;
  }
}

// Owner / Super Admin only. Single-user mode (no active member) is treated as
// the owner, consistent with the rest of the app's gating (e.g. the developer
// API and IP-provider settings).
async function requireOwnerOrSuper(action = 'perform this action') {
  const member = await getActiveMember();
  if (!member) return; // single-user mode == owner
  if (member.status === 'suspended' || member.status === 'banned') {
    const err = new Error(member.status === 'banned' ? 'This account is banned.' : 'This member is suspended.'); err.code = 'FORBIDDEN'; throw err;
  }
  if (member.role !== 'OWNER' && member.role !== 'SUPER_ADMIN') {
    const err = new Error(`Only the Owner or Super Admin can ${action}.`);
    err.code = 'FORBIDDEN';
    throw err;
  }
}

// Gate for buying / renewing a subscription. Owner-or-Super (or single-user),
// but — unlike requireOwnerOrSuper — a BANNED owner is allowed through so they
// can pay to restore their own access. Sub-members can never drive checkout.
async function requirePurchaser(action = 'purchase a subscription') {
  const member = await getActiveMember();
  if (!member) return; // single-user mode == owner
  if (member.role !== 'OWNER' && member.role !== 'SUPER_ADMIN') {
    const err = new Error(`Only the Owner or Super Admin can ${action}.`);
    err.code = 'FORBIDDEN';
    throw err;
  }
}

async function listMembers() {
  const db = getPrisma();
  const allMembers = await db.member.findMany({ orderBy: [{ createdAt: 'asc' }] });

  // Visibility scoping: each viewer only sees their own subtree (siblings never
  // see each other). No active member (single-user mode) => see everyone.
  const viewer = await getActiveMember();
  let members = allMembers;
  if (viewer && viewer.role !== 'SUPER_ADMIN') {
    const visible = permissions.visibleMemberIds(allMembers, viewer);
    members = allMembers.filter((m) => visible.has(m.id));
  }

  // Direct-child counts per role, so the UI can show "3 / 10 admins" etc.
  const childCounts = {};
  for (const m of allMembers) {
    if (m.parentMemberId == null) continue;
    const p = Number(m.parentMemberId);
    const bucket = (childCounts[p] = childCounts[p] || { ADMIN: 0, MANAGER: 0, OPERATOR: 0, total: 0 });
    if (bucket[m.role] !== undefined) bucket[m.role] += 1;
    bucket.total += 1;
  }

  // Per-member owned resource counts (for quota display).
  const ownedProfiles = {};
  const ownedProxies = {};
  try {
    const op = await db.profile.groupBy({ by: ['ownerMemberId'], where: { deletedAt: null, ownerMemberId: { not: null } }, _count: { _all: true } });
    for (const g of op) ownedProfiles[g.ownerMemberId] = g._count._all;
    const ox = await db.proxy.groupBy({ by: ['ownerMemberId'], where: { ownerMemberId: { not: null } }, _count: { _all: true } });
    for (const g of ox) ownedProxies[g.ownerMemberId] = g._count._all;
  } catch (e) { /* best-effort */ }

  const counts = {};
  try {
    const grouped = await db.profile.groupBy({
      by: ['assignedMemberId'],
      where: { deletedAt: null, assignedMemberId: { not: null } },
      _count: { _all: true }
    });
    for (const g of grouped) counts[g.assignedMemberId] = g._count._all;
  } catch (e) { /* ignore grouping edge cases */ }

  // Distinct proxies in use by each member's assigned profiles, plus workspace
  // totals so the UI can show real numbers even before profiles are assigned.
  const proxyCounts = {};
  let totalProfiles = 0;
  let totalProxies = 0;
  try {
    const assigned = await db.profile.findMany({
      where: { deletedAt: null, assignedMemberId: { not: null } },
      select: { assignedMemberId: true, proxyId: true }
    });
    const perMember = {};
    for (const p of assigned) {
      if (p.proxyId == null) continue;
      (perMember[p.assignedMemberId] = perMember[p.assignedMemberId] || new Set()).add(p.proxyId);
    }
    for (const [mid, set] of Object.entries(perMember)) proxyCounts[mid] = set.size;
    totalProfiles = await db.profile.count({ where: { deletedAt: null } });
    totalProxies = await db.proxy.count();
  } catch (e) { /* counts are best-effort */ }

  // Allocation rollup: how much of each member's quota has been handed to direct
  // children (so an owner distributing e.g. 20 profiles sees what's left).
  const childrenByParent = {};
  for (const m of allMembers) {
    if (m.parentMemberId == null) continue;
    (childrenByParent[Number(m.parentMemberId)] = childrenByParent[Number(m.parentMemberId)] || []).push(m);
  }
  const allocationFor = (member) => {
    const kids = childrenByParent[member.id] || [];
    const own = permissions.effectivePermissions(member);
    const roll = (key) => {
      let allocated = 0; let unlimitedKids = 0;
      for (const k of kids) {
        const v = permissions.effectivePermissions(k)[key];
        if (v === -1 || v == null) unlimitedKids += 1;
        else allocated += Math.max(0, Number(v) || 0);
      }
      const cap = own[key];
      return { cap: (cap == null ? -1 : cap), allocated, unlimitedKids };
    };
    return { childCount: kids.length, profiles: roll('maxProfiles'), proxies: roll('maxProxies') };
  };

  const instr = (await readSetting('memberInstructions', {})) || {};
  return members.map((m) => serializeMember(m, {
    assignedProfiles: counts[m.id] || 0,
    assignedProxies: proxyCounts[m.id] || 0,
    ownedProfiles: ownedProfiles[m.id] || 0,
    ownedProxies: ownedProxies[m.id] || 0,
    childCounts: childCounts[m.id] || { ADMIN: 0, MANAGER: 0, OPERATOR: 0, total: 0 },
    allocation: allocationFor(m),
    inviteCode: m.inviteStatus === 'pending' ? m.inviteCode : null,
    workspaceProfiles: totalProfiles,
    workspaceProxies: totalProxies,
    isCurrent: m.id === currentMemberId,
    instructions: instr[m.id] || ''
  }));
}

async function createMember(payload) {
  await requirePermission('members.manage');
  const input = requireObject(payload);
  const name = requiredString(input.name, 'Member name');
  const db = getPrisma();
  const existingOwners = await db.member.count({ where: { role: 'OWNER' } });

  let role = String(input.role || 'OPERATOR').toUpperCase();
  if (!VALID_ROLES.includes(role)) role = 'OPERATOR';

  // First-ever member bootstraps as OWNER (no creator yet).
  if (existingOwners === 0) role = 'OWNER';

  const creator = await getActiveMember();
  const isBootstrap = existingOwners === 0;

  // Hierarchy + capacity checks (skipped only for the very first owner bootstrap).
  let parentMemberId = null;
  let permsJson = null;
  if (!isBootstrap) {
    if (!creator) throw new Error('Sign in before adding team members.');
    if (!permissions.canCreateRole(creator, role)) {
      const err = new Error(`Your role can't create a ${role.toLowerCase()}.`);
      err.code = 'FORBIDDEN'; throw err;
    }
    const creatorPerms = permissions.effectivePermissions(creator);
    // Capacity: how many children of this role the creator already has vs their cap.
    if (creator.role !== 'SUPER_ADMIN') {
      const cap = permissions.childCapFor(creatorPerms, role);
      if (cap !== -1) {
        const have = await db.member.count({ where: { parentMemberId: creator.id, role } });
        if (have >= cap) {
          const err = new Error(`You can only add ${cap} ${role.toLowerCase()}(s).`);
          err.code = 'LIMIT_REACHED'; throw err;
        }
      }
    }
    // Seat cap: the owner-tree's licence implies a number of seats; block new
    // members (incl. pending invites) once they're all taken.
    await assertSeatAvailable();
    parentMemberId = creator.id >= 0 ? creator.id : null; // super admin (id -1) is not a DB row
    permsJson = JSON.stringify(clampPermissions(input.permissions, creatorPerms, role));
  } else {
    permsJson = JSON.stringify(permissions.defaultPermissionsFor('OWNER'));
  }

  // Invited members register/sign in later with the code; created as PENDING unless
  // a PIN/password is supplied inline (e.g. the owner makes a local-pick member).
  const inline = Boolean(input.pin || input.password);
  const data = {
    name,
    email: optionalString(input.email),
    role,
    color: optionalString(input.color) || '#3DC6DA',
    initials: optionalString(input.initials) || initialsFrom(name),
    status: 'active',
    parentMemberId,
    permissionsJson: permsJson,
    inviteStatus: inline || isBootstrap ? 'active' : 'pending',
    inviteCode: inline || isBootstrap ? null : generateInviteCode()
  };
  if (input.pin) { const { salt, hash } = hashSecret(String(input.pin)); data.pinSalt = salt; data.pinHash = hash; }
  if (input.password) { const { salt, hash } = hashSecret(String(input.password)); data.passwordSalt = salt; data.passwordHash = hash; }

  const m = await db.member.create({ data });
  const out = serializeMember(m, { assignedProfiles: 0 });
  if (m.inviteCode) {
    out.inviteCode = m.inviteCode;
    out.inviteLink = `softglaze://invite/${m.inviteCode}`;
    // Best-effort email (offline-safe: surfaces the code in-app if SMTP isn't set).
    if (m.email) { try { out.emailed = await deliverInvite(m.email, m.name, role, m.inviteCode); } catch (e) { out.emailed = false; } }
  }
  return out;
}

// Redeem an invite code: the invited member sets their own login password and
// becomes active, linked to whoever created them.
async function acceptInvite(payload) {
  const input = requireObject(payload);
  const code = requiredString(input.code, 'Invite code').trim().toUpperCase();
  const password = requiredString(input.password, 'Password');
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');
  const db = getPrisma();
  const member = await db.member.findFirst({ where: { inviteCode: code } });
  if (!member) throw new Error('That invite code is not valid.');
  if (member.inviteStatus === 'active') throw new Error('This invite has already been used.');
  if (member.status === 'banned' || member.status === 'suspended') throw new Error('This account is not active — contact your administrator.');
  const { salt, hash } = hashSecret(password);
  const data = { passwordSalt: salt, passwordHash: hash, inviteStatus: 'active', inviteCode: null };
  if (input.name) data.name = requiredString(input.name, 'Name');
  if (input.email) data.email = optionalString(input.email);
  if (data.name) data.initials = initialsFrom(data.name);
  const updated = await db.member.update({ where: { id: member.id }, data });
  // Sign the new member in immediately (their own password is their auth, so they
  // also clear the workspace vault gate).
  currentMemberId = updated.id;
  await writeSetting('currentMemberId', updated.id).catch(() => {});
  vaultLocked = false;
  await db.member.update({ where: { id: updated.id }, data: { lastActiveAt: new Date() } }).catch(() => {});
  return serializeMember(updated, { isCurrent: true });
}

// Per-member login (sub-members sign in independently with email/username + password).
async function memberLogin(payload) {
  const input = requireObject(payload);
  const identifier = requiredString(input.identifier || input.email, 'Email or name').trim().toLowerCase();
  const password = requiredString(input.password, 'Password');
  const db = getPrisma();
  const all = await db.member.findMany();
  const member = all.find((m) => (m.email && m.email.toLowerCase() === identifier) || (m.name && m.name.toLowerCase() === identifier));
  if (!member || !member.passwordHash) {
    const err = new Error('No member found with those credentials.'); err.code = 'BAD_CREDS'; throw err;
  }
  if (member.inviteStatus === 'pending') throw new Error('Redeem your invite code first to set a password.');
  if (member.status === 'suspended') throw new Error('This member is suspended.');
  if (member.status === 'banned') throw new Error('This account is banned.');
  if (!verifySecret(password, member.passwordSalt, member.passwordHash)) {
    const err = new Error('Incorrect password.'); err.code = 'BAD_CREDS'; throw err;
  }
  currentMemberId = member.id;
  await writeSetting('currentMemberId', member.id).catch(() => {});
  vaultLocked = false; // member's own password is their auth
  await db.member.update({ where: { id: member.id }, data: { lastActiveAt: new Date() } }).catch(() => {});
  return serializeMember(member, { isCurrent: true });
}

// Sign the active member out: drop the in-memory id AND clear the persisted
// pointer so a reload lands on the member-picker / login screen (Gate.jsx) rather
// than silently re-activating the last member. The vault state is left untouched
// (logging out is not the same as locking the workspace).
async function memberLogout() {
  currentMemberId = null;
  await writeSetting('currentMemberId', null).catch(() => {});
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Self-service account settings (the active member editing their OWN profile).
// Non-sensitive fields (name / avatar / color) save directly; sensitive fields
// (email / password) go through an OTP confirmed against the member's CURRENT
// verified email — see requestMemberChange / commitMemberChange.
// ---------------------------------------------------------------------------
const ACCOUNT_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// The active, real (DB-backed) member, or a thrown FORBIDDEN for single-user /
// Super-Admin sessions that have no editable row.
async function requireSelfEditableMember() {
  const member = await getActiveMember();
  if (!member || member.id == null || member.id < 0) {
    const e = new Error('No editable account is active in this session.');
    e.code = 'FORBIDDEN';
    throw e;
  }
  return member;
}

async function updateOwnProfile(payload) {
  const input = requireObject(payload);
  const member = await requireSelfEditableMember();

  const data = {};
  if (input.name !== undefined) {
    const name = requiredString(input.name, 'Name').slice(0, 120);
    data.name = name;
    data.initials = initialsFrom(name);
  }
  if (input.color !== undefined && input.color) data.color = String(input.color).slice(0, 32);
  if (input.avatarUrl !== undefined) {
    // null / '' clears it; otherwise accept a data URI or a local path, capped so
    // an oversized base64 blob can't bloat the row.
    const v = input.avatarUrl == null ? null : String(input.avatarUrl);
    if (v && v.length > 3000000) throw new Error('That image is too large. Use an image under ~2 MB.');
    data.avatarUrl = v || null;
  }
  if (Object.keys(data).length === 0) return serializeMember(member, { isCurrent: true });

  const updated = await getPrisma().member.update({ where: { id: member.id }, data });
  return serializeMember(updated, { isCurrent: true });
}

// Step 1 of a SENSITIVE change: validate + stash the requested change and email a
// 6-digit code to the member's CURRENT verified email (proving ownership before
// anything is committed). The change lives only in the scoped OTP record.
async function requestMemberChange(payload) {
  const input = requireObject(payload);
  const member = await requireSelfEditableMember();
  if (!member.email) throw new Error('Your account has no verified email to send a code to.');

  const changes = requireObject(input.changes, 'changes');
  const pending = {};

  if (changes.email !== undefined && changes.email !== null && String(changes.email).trim() !== '') {
    const email = String(changes.email).trim().toLowerCase();
    if (!ACCOUNT_EMAIL_RE.test(email)) throw new Error('Enter a valid email address.');
    if (email !== member.email.toLowerCase()) {
      const clash = await getPrisma().member.findFirst({ where: { email, id: { not: member.id } } });
      if (clash) throw new Error('That email is already used by another member.');
      pending.email = email;
    }
  }
  if (changes.password !== undefined && changes.password !== null && String(changes.password) !== '') {
    const password = String(changes.password);
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');
    const { salt, hash } = hashSecret(password);
    pending.passwordSalt = salt;
    pending.passwordHash = hash;
  }
  if (Object.keys(pending).length === 0) throw new Error('No sensitive changes were provided.');

  const code = String(crypto.randomInt(100000, 1000000));
  const { salt, hash } = hashSecret(code);
  await writeSetting(otpKey(`change:${member.id}`), {
    salt, hash, pending, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0
  });
  const res = await deliverOtp(member.email, code);
  return { sent: true, sentTo: member.email, devMode: Boolean(res.devMode), devCode: res.devMode ? code : undefined };
}

// Step 2: verify the code against the scoped record and COMMIT the stashed change
// to the member row. The code is consumed only on success.
async function commitMemberChange(payload) {
  const input = requireObject(payload);
  const member = await requireSelfEditableMember();
  const code = String(input.code || '').trim();
  const key = otpKey(`change:${member.id}`);

  const rec = await readSetting(key, null);
  if (!rec || !rec.hash) throw new Error('No verification code was requested.');
  if (Date.now() > Number(rec.expiresAt || 0)) { await writeSetting(key, null); throw new Error('Verification code expired. Request a new one.'); }
  if (Number(rec.attempts || 0) >= 6) { await writeSetting(key, null); throw new Error('Too many attempts. Request a new code.'); }
  if (!verifySecret(code, rec.salt, rec.hash)) {
    await writeSetting(key, { ...rec, attempts: Number(rec.attempts || 0) + 1 });
    throw new Error('Incorrect code.');
  }

  const pending = rec.pending || {};
  const data = {};
  if (pending.email) data.email = pending.email;
  if (pending.passwordHash && pending.passwordSalt) { data.passwordHash = pending.passwordHash; data.passwordSalt = pending.passwordSalt; }
  if (Object.keys(data).length === 0) { await writeSetting(key, null); throw new Error('Nothing to apply.'); }

  const updated = await getPrisma().member.update({ where: { id: member.id }, data });

  // Keep the OWNER's account-profile email in sync so the login greeting/lookup
  // (which reads the 'account' setting) stays correct after an email change.
  if (data.email && member.role === 'OWNER') {
    const acct = (await readSetting('account', {})) || {};
    await writeSetting('account', { ...acct, email: data.email });
  }

  await writeSetting(key, null);
  return { ok: true, member: serializeMember(updated, { isCurrent: true }) };
}

// Update a member's granted permissions/limits. Only an ancestor (or super admin)
// may do this, and the grant is clamped to the granter's own permissions.
async function updateMemberPermissions(payload) {
  await requirePermission('members.manage');
  const input = requireObject(payload);
  const id = parseId(input.id);
  const db = getPrisma();
  const target = await db.member.findUnique({ where: { id } });
  if (!target) throw new Error('Member not found.');
  const granter = await getActiveMember();
  if (!granter) throw new Error('Sign in to manage permissions.');
  // The granter must be able to see (own) this member's subtree.
  if (granter.role !== 'SUPER_ADMIN') {
    const all = await db.member.findMany();
    const visible = permissions.visibleMemberIds(all, granter);
    if (!visible.has(id) || id === granter.id) throw new Error('You can only manage members you created.');
  }
  // Revert to role defaults: clear the stored overrides so effectivePermissions
  // falls back to the role's built-in defaults.
  if (input.reset) {
    const reverted = await db.member.update({ where: { id }, data: { permissionsJson: null } });
    return serializeMember(reverted);
  }
  const granterPerms = permissions.effectivePermissions(granter);
  const next = clampPermissions(input.permissions, granterPerms, target.role);
  const updated = await db.member.update({ where: { id }, data: { permissionsJson: JSON.stringify(next) } });
  return serializeMember(updated);
}

// Invite email (mirrors the OTP transport: real send when SMTP is configured,
// otherwise offline mode and the code is shown in-app).
function buildInviteEmail(cfg, email, name, role, code) {
  return {
    from: `"${cfg.fromName}" <${cfg.user}>`,
    to: email,
    subject: 'You have been invited to SoftGlaze Browser',
    text: `Hi ${name}, you have been added as a ${role.toLowerCase()}. Your invite code is: ${code}. Open SoftGlaze Browser, choose "Have an invite code?", enter it and set your password.`,
    html: `
      <div style="font-family: sans-serif; max-width: 28rem; margin: 0 auto;">
        <h2>SoftGlaze Browser invitation</h2>
        <p>Hi ${name}, you have been added as a <b>${role.toLowerCase()}</b>.</p>
        <p>Your invite code is:</p>
        <h1 style="background:#f4f4f5;padding:10px;text-align:center;letter-spacing:3px;">${code}</h1>
        <p style="font-size:12px;color:#666;">Open SoftGlaze Browser, choose "Have an invite code?", enter the code and set your password.</p>
      </div>`
  };
}

async function deliverInvite(email, name, role, code) {
  const cfg = await resolveSmtpConfig();
  if (!cfg.configured) return false; // offline: caller surfaces the code in-app
  const transporter = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass } });
  try { await transporter.sendMail(buildInviteEmail(cfg, email, name, role, code)); return true; }
  catch (e) { console.error('[Invite Delivery Error]', e); return false; }
}

async function updateMember(payload) {
  await requirePermission('members.manage');
  const input = requireObject(payload);
  const id = parseId(input.id);
  const db = getPrisma();
  const target = await db.member.findUnique({ where: { id } });
  if (!target) throw new Error('Member not found.');
  await assertCanManageMember(id);
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
  await assertCanManageMember(id);
  const db = getPrisma();
  if (input.pin) {
    const { salt, hash } = hashSecret(requiredString(input.pin, 'PIN'));
    await db.member.update({ where: { id }, data: { pinSalt: salt, pinHash: hash } });
  } else {
    await db.member.update({ where: { id }, data: { pinSalt: null, pinHash: null } });
  }
  return { ok: true };
}

// Subtree + rank guard for acting ON another member's record (edit / pin /
// instructions). Single-user mode and the Super Admin are unrestricted. You may
// act on yourself (when allowSelf), or on a STRICTLY lower-ranked member inside
// your visible subtree — mirrors deleteMember's scoping.
async function assertCanManageMember(id, { allowSelf = true } = {}) {
  const actor = await getActiveMember();
  if (!actor || actor.role === 'SUPER_ADMIN') return;
  if (Number(id) === Number(actor.id)) {
    if (allowSelf) return;
    const e = new Error('You cannot do this to your own account here.'); e.code = 'FORBIDDEN'; throw e;
  }
  const db = getPrisma();
  const target = await db.member.findUnique({ where: { id } });
  if (!target) throw new Error('Member not found.');
  if (permissions.rankOf(actor.role) <= permissions.rankOf(target.role)) {
    const e = new Error('You can only manage members below your role.'); e.code = 'FORBIDDEN'; throw e;
  }
  const all = await db.member.findMany();
  if (!permissions.visibleMemberIds(all, actor).has(Number(id))) {
    const e = new Error('You can only manage members you created.'); e.code = 'FORBIDDEN'; throw e;
  }
}

async function deleteMember(payload) {
  await requirePermission('members.manage');
  const input = requireObject(payload);
  const id = parseId(input.id);
  const db = getPrisma();
  const target = await db.member.findUnique({ where: { id } });
  if (!target) throw new Error('Member not found.');

  // Subtree scoping: you may only remove members beneath you, never yourself,
  // never an equal/higher role. (OWNER removal also keeps the last-owner guard.)
  const actor = await getActiveMember();
  if (actor && actor.role !== 'SUPER_ADMIN') {
    if (id === actor.id) throw new Error('You cannot remove yourself.');
    if (rankOf(actor.role) <= rankOf(target.role)) throw new Error('You cannot remove a member at your level or above.');
    const all = await db.member.findMany();
    const visible = permissions.visibleMemberIds(all, actor);
    if (!visible.has(id)) throw new Error('You can only remove members you created.');
  }
  if (target.role === 'OWNER') {
    const owners = await db.member.count({ where: { role: 'OWNER' } });
    if (owners <= 1) throw new Error('You cannot remove the last owner.');
  }

  // Re-parent the removed member's direct children up to its own parent so no
  // subtree is orphaned (keeps everyone reachable by the owner).
  await db.member.updateMany({ where: { parentMemberId: id }, data: { parentMemberId: target.parentMemberId ?? null } }).catch(() => {});
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
  if (m.status === 'banned') throw new Error('This member is blocked.');

  // Authorization. The quick-switcher is a convenience WITHIN an authenticated
  // workspace, not a login. When a real member is already active they may only
  // switch to members they manage, and may NEVER assume a higher- or equal-rank
  // identity without that member's own password (prevents an OPERATOR from
  // becoming the OWNER via DevTools). The boot path (no active actor yet — the
  // workspace vault was just unlocked) and the Super Admin are unrestricted.
  const actor = await getActiveMember();
  const switchingToSelf = actor && Number(actor.id) === Number(id);
  if (actor && actor.role !== 'SUPER_ADMIN' && !switchingToSelf) {
    const all = await db.member.findMany();
    if (!permissions.visibleMemberIds(all, actor).has(id)) {
      const err = new Error('You can only switch to members you manage.'); err.code = 'FORBIDDEN'; throw err;
    }
    if (permissions.rankOf(m.role) >= permissions.rankOf(actor.role)) {
      const pw = String(input.password || '');
      if (!m.passwordHash || !verifySecret(pw, m.passwordSalt, m.passwordHash)) {
        const err = new Error('Enter this member’s password to switch into their account.'); err.code = 'NEED_PASSWORD'; throw err;
      }
    }
  }

  // Per-member PIN (a secondary lock) is still honored for everyone.
  if (m.pinHash && !verifySecret(String(input.pin || ''), m.pinSalt, m.pinHash)) {
    const err = new Error('Incorrect PIN.'); err.code = 'BAD_PIN'; throw err;
  }
  currentMemberId = id;
  await writeSetting('currentMemberId', id).catch(() => {});
  await db.member.update({ where: { id }, data: { lastActiveAt: new Date() } }).catch(() => {});
  return serializeMember(m, { isCurrent: true });
}

// Super Admin — hardcoded source-owner login. Bypasses registration AND the vault,
// and is granted every permission. There is exactly one, never stored in the DB.
async function superLogin(payload) {
  const input = requireObject(payload);
  const identifier = String(input.identifier || input.email || input.username || '');
  const password = String(input.password || '');
  if (!permissions.isSuperAdminLogin(identifier, password)) {
    const err = new Error('Invalid Super Admin credentials.'); err.code = 'BAD_CREDS'; throw err;
  }
  currentMemberId = permissions.SUPER_ADMIN_ID;
  await writeSetting('currentMemberId', currentMemberId).catch(() => {});
  vaultLocked = false; // source owner is never gated by the workspace vault
  return serializeMember({ ...permissions.SUPER_ADMIN }, { isCurrent: true });
}

// ---------------------------------------------------------------------------
// Softglaze Enterprise — at-rest database encryption + workspace backup/restore
// (Phase 6). Encrypts the whole SQLite file when the app is closed/locked (Option
// A envelope-at-rest), keyed by the vault password. Backup-first, reversible, OFF
// by default. Honest scope: a plaintext working file exists while the app is
// running + unlocked (Prisma's requirement) — see DbEncryptionSettings.jsx.
// ---------------------------------------------------------------------------

// Run once the DB is readable (normal boot when unencrypted, or after a successful
// db:unlock / workspace restore): restore the saved member session + vault lock
// state and start the local API if the user enabled it. This is the logic that
// used to run inline at the end of registerIpcHandlers — extracted so the unlock
// path can reuse it.
// ---------------------------------------------------------------------------
// Starter content — seeded ONCE on first DB-ready so a new workspace isn't empty.
// A few ready-to-edit automation macros (real runner step shapes) and coherent
// profile templates (built from the real fingerprint generator). Guarded by a
// Setting flag: never duplicates, never touches user-created rows.
// ---------------------------------------------------------------------------
const STARTER_MACROS = [
  {
    name: 'Warm & scroll',
    description: 'Visit two popular sites and scroll like a reader — quick organic activity. Runs as-is.',
    steps: [
      { type: 'goto', url: 'https://www.google.com/' },
      { type: 'wait', ms: 2000 },
      { type: 'scroll', steps: 4 },
      { type: 'goto', url: 'https://www.youtube.com/' },
      { type: 'wait', ms: 2000 },
      { type: 'scroll', steps: 5 }
    ]
  },
  {
    name: 'Account sign-up filler',
    description: 'Template for a registration form — edit the URL, selectors and values for your target site.',
    steps: [
      { type: 'goto', url: 'https://example.com/signup' },
      { type: 'wait', ms: 1500 },
      { type: 'type', selector: '#email', value: 'you@example.com' },
      { type: 'type', selector: '#password', value: 'ChangeMe123!' },
      { type: 'type', selector: '#confirm-password', value: 'ChangeMe123!' },
      { type: 'click', selector: 'button[type="submit"]' },
      { type: 'wait', ms: 3000 }
    ]
  },
  {
    name: 'Login & wait',
    description: 'Template for a login form — replace the selectors and credentials for your site.',
    steps: [
      { type: 'goto', url: 'https://example.com/login' },
      { type: 'wait', ms: 1500 },
      { type: 'type', selector: 'input[name="email"]', value: 'you@example.com' },
      { type: 'type', selector: 'input[name="password"]', value: 'your-password' },
      { type: 'click', selector: 'button[type="submit"]' },
      { type: 'wait', ms: 3000 }
    ]
  },
  {
    name: 'Search & open result',
    description: 'Search Google for a query and open the first result. Edit the query in the "type" step.',
    steps: [
      { type: 'goto', url: 'https://www.google.com/' },
      { type: 'wait', ms: 1500 },
      { type: 'type', selector: 'textarea[name="q"]', value: 'softglaze browser' },
      { type: 'keypress', key: 'Enter' },
      { type: 'wait', ms: 2500 },
      { type: 'click', selector: 'h3' }
    ]
  },
  {
    name: 'Read & dwell',
    description: 'Open an article and scroll/pause like a real reader — good for low-key warming. Runs as-is.',
    steps: [
      { type: 'goto', url: 'https://en.wikipedia.org/wiki/Web_browser' },
      { type: 'wait', ms: 2000 },
      { type: 'scroll', steps: 5 },
      { type: 'wait', ms: 3000 },
      { type: 'scroll', steps: 4 },
      { type: 'wait', ms: 3000 }
    ]
  }
];

// Generate a coherent desktop fingerprint for a specific OS (the generator weights
// OS randomly, so retry until it matches; fall back to any OS after a bounded loop).
function starterDesktopFingerprint(targetOs) {
  for (let i = 0; i < 80; i += 1) {
    const fp = generateFingerprint();
    if (fp.os === targetOs) return fp;
  }
  return generateFingerprint();
}

function buildStarterTemplates() {
  return [
    { name: 'Windows · Chrome (desktop)', data: starterDesktopFingerprint('Windows') },
    { name: 'macOS · Chrome (desktop)', data: starterDesktopFingerprint('macOS') },
    { name: 'Android · Chrome (mobile)', data: generateFingerprint({ deviceClass: 'mobile' }) },
    { name: 'Linux · Chrome (desktop)', data: starterDesktopFingerprint('Linux') },
    { name: 'EU privacy · WebRTC off', data: { ...starterDesktopFingerprint('Windows'), webrtc: 'Disabled', portScanProtection: 'Enable' } }
  ];
}

async function seedStarters() {
  try {
    if (await readSetting('startersSeeded', false)) return;
    const db = getPrisma();
    for (const m of STARTER_MACROS) {
      await db.macro.create({ data: { name: m.name, description: m.description, stepsJson: JSON.stringify(m.steps) } }).catch(() => {});
    }
    for (const t of buildStarterTemplates()) {
      await db.template.create({ data: { name: t.name, dataJson: JSON.stringify(t.data) } }).catch(() => {});
    }
    await writeSetting('startersSeeded', true);
  } catch (e) { /* best-effort — never block startup */ }
}

async function afterDbReady() {
  try {
    const savedMember = await readSetting('currentMemberId', null);
    if (savedMember != null) currentMemberId = Number(savedMember) || null;
    const v = await readSetting('vault', null);
    if (v && v.enabled) vaultLocked = true; // require unlock at startup
  } catch (e) { /* ignore — fall back to a fresh session */ }
  try { await seedStarters(); } catch (e) { /* best-effort */ }
  try { await localApi.startIfEnabled(); } catch (e) { /* off by default */ }
}

async function dbEncryptionStatus() {
  const info = database.getDbEncryptionInfo();
  let lastBackupAt = null;
  if (info.unlocked) {
    try { lastBackupAt = await readSetting('workspaceLastBackupAt', null); } catch (e) { /* unavailable */ }
  }
  return { ...info, lastBackupAt };
}

// Pre-Gate unlock. No permission gate (the workspace is not open yet); the .enc's
// GCM tag is the authenticator. On success the DB is opened + migrated and the
// saved session restored.
async function dbUnlock(payload) {
  const input = requireObject(payload);
  const password = String(input.password || '');
  if (!password) throw new Error('Enter your password to unlock the database.');
  if (!database.isDbEncryptionEnabled()) return dbEncryptionStatus();
  await database.unlockEncryptedDb(password); // throws DB_UNLOCK_FAILED / DB_MISSING
  await database.bootstrapDatabase();
  await afterDbReady();
  // The DB key IS the vault password, and it just decrypted the database, so it is
  // by definition correct — unlock the workspace vault too, so the user isn't asked
  // for the same password again at the Gate.
  try {
    const v = await readVault();
    if (v.enabled && v.hash && verifySecret(password, v.salt, v.hash)) vaultLocked = false;
  } catch (e) { /* leave vault locked — the Gate will ask */ }
  return dbEncryptionStatus();
}

async function dbEnableEncryption(payload) {
  await requirePermission('vault.manage');
  const input = requireObject(payload);
  if (!input.confirm) throw new Error('Please confirm you understand that a lost password makes the data unrecoverable.');
  const password = String(input.password || '');
  // The DB key IS the vault password — require an enabled vault and verify it, so
  // the same password that unlocks the workspace also unlocks the database.
  const v = await readVault();
  if (!v.enabled || !v.hash) {
    const e = new Error('Set a workspace password (vault) first — database encryption uses it as the key.');
    e.code = 'NO_VAULT';
    throw e;
  }
  if (!verifySecret(password, v.salt, v.hash)) {
    const e = new Error('Incorrect workspace password.'); e.code = 'BAD_PASSWORD'; throw e;
  }
  const info = await database.enableDbEncryption(password);
  let lastBackupAt = null;
  try { lastBackupAt = await readSetting('workspaceLastBackupAt', null); } catch (e) { /* noop */ }
  return { ...info, lastBackupAt };
}

async function dbDisableEncryption(payload) {
  await requirePermission('vault.manage');
  const input = requireObject(payload);
  const password = String(input.password || '');
  if (!password) throw new Error('Enter your workspace password to disable encryption.');
  const info = await database.disableDbEncryption(password); // verifies password internally
  let lastBackupAt = null;
  try { lastBackupAt = await readSetting('workspaceLastBackupAt', null); } catch (e) { /* noop */ }
  return { ...info, lastBackupAt };
}

async function workspaceBackup(payload) {
  await requireOwnerOrSuper('back up the workspace');
  const input = requireObject(payload);
  const password = String(input.password || '');
  if (password.length < 6) throw new Error('Choose a backup password of at least 6 characters.');
  const { dbPath } = getRuntimeConfig();
  // Fold the WAL into the main file so the snapshot is internally consistent.
  try { await getPrisma().$executeRawUnsafe('PRAGMA wal_checkpoint(FULL);'); } catch (e) { /* not WAL */ }
  let settings = [];
  try {
    const rows = await getPrisma().setting.findMany();
    settings = rows.map((r) => ({ key: r.key, value: r.value }));
  } catch (e) { settings = []; }
  const stamp = new Date().toISOString().slice(0, 10);
  const save = await dialog.showSaveDialog({
    title: 'Back up workspace',
    defaultPath: `softglaze-workspace-${stamp}.sgzw`,
    filters: [{ name: 'Softglaze Workspace Backup', extensions: ['sgzw'] }]
  });
  if (save.canceled || !save.filePath) return { cancelled: true };
  const res = await profileArchive.exportWorkspaceArchive({ dbPath, settings, password, outPath: save.filePath });
  await writeSetting('workspaceLastBackupAt', new Date().toISOString()).catch(() => {});
  return { ok: true, path: save.filePath, dbBytes: res.dbBytes, settingsCount: res.settingsCount };
}

async function workspaceRestore(payload) {
  await requireOwnerOrSuper('restore the workspace');
  const input = requireObject(payload);
  const password = String(input.password || '');
  if (!password) throw new Error('Enter the password for this backup.');
  const selection = await dialog.showOpenDialog({
    title: 'Restore workspace backup',
    properties: ['openFile'],
    filters: [{ name: 'Softglaze Workspace Backup', extensions: ['sgzw'] }]
  });
  if (selection.canceled || !selection.filePaths || !selection.filePaths.length) return { cancelled: true };
  const filePath = selection.filePaths[0];

  // GCM-verified decrypt happens BEFORE we touch any live file — a wrong password
  // or tampered backup throws here and the working DB is never changed.
  const restored = await profileArchive.restoreWorkspaceArchive(filePath, password);

  const { dbPath } = getRuntimeConfig();
  const tmp = `${dbPath}.restore-tmp`;
  await fs.writeFile(tmp, restored.db);
  if (!dbCrypto.looksLikeSqlite(tmp)) {
    await fs.unlink(tmp).catch(() => {});
    throw new Error('This backup does not contain a valid database.');
  }

  // Swap with rollback: copy the current DB aside, then on any error put it back.
  await database.disconnectPrisma();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safety = `${dbPath}.pre-restore-${stamp}`;
  let hadCurrent = false;
  try { await fs.copyFile(dbPath, safety); hadCurrent = true; } catch (e) { /* no current DB */ }
  try {
    await fs.rename(tmp, dbPath);
    for (const suffix of ['-wal', '-shm']) { await fs.unlink(dbPath + suffix).catch(() => {}); }
    await database.bootstrapDatabase();
  } catch (e) {
    try { if (hadCurrent) await fs.copyFile(safety, dbPath); } catch (_) { /* noop */ }
    await database.bootstrapDatabase().catch(() => {});
    await dbCrypto.secureUnlink(safety);
    await fs.unlink(tmp).catch(() => {});
    throw new Error('Restore failed — the previous database has been put back.');
  }
  // Success — remove the (plaintext) safety copy so it can't linger on disk.
  await dbCrypto.secureUnlink(safety);
  await afterDbReady();
  return { ok: true, exportedAt: restored.exportedAt };
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
  // If the DB is encrypted with the (old) vault password, re-key the at-rest copy
  // to the new one so "the workspace password unlocks the database" stays true.
  if (database.isDbEncryptionEnabled()) {
    try { await database.rekeyEncryptedDb(next); } catch (e) { console.error('[vault] DB re-key after password change failed', e); }
  }
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
  // Database encryption is keyed by the vault password — removing the vault would
  // strand the encrypted DB with no key. Force the user to turn off DB encryption
  // first (which decrypts back to plaintext).
  if (database.isDbEncryptionEnabled()) {
    const e = new Error('Turn off database encryption first — it uses your workspace password as its key.');
    e.code = 'DB_ENCRYPTION_ON';
    throw e;
  }
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
  // Stored password is sealed at rest; open() is fail-safe for legacy plaintext.
  const pass = (s.pass ? secretStore.open(s.pass) : '') || process.env.SMTP_PASS || '';
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
    // Keep the existing (already-sealed) password if the renderer sends a blank
    // (it never receives it back); a new password is sealed before storage.
    pass: (input.pass !== undefined && input.pass !== '') ? secretStore.seal(String(input.pass)) : (prev.pass || ''),
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

// OTP records are scoped by purpose + identity so concurrent flows can never
// clobber one another. The old single global 'otp' key meant a second request
// (a different email registering, or an in-app email/password change) silently
// overwrote the first — a race and a cross-flow security collision. Registration
// has no member yet, so it is keyed by the email being verified; in-app account
// changes (see requestMemberChange) are keyed by the active member id.
function otpKey(scope) {
  return `otp:${String(scope || '').toLowerCase()}`;
}

async function accountSendOtp(payload) {
  const input = requireObject(payload);
  const email = requiredString(input.email, 'Email').toLowerCase();
  const code = String(crypto.randomInt(100000, 1000000));
  const { salt, hash } = hashSecret(code);
  await writeSetting(otpKey(`reg:${email}`), { email, salt, hash, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 });
  const res = await deliverOtp(email, code);
  return { sent: true, devMode: Boolean(res.devMode), devCode: res.devMode ? code : undefined };
}

async function accountVerifyOtp(payload) {
  const input = requireObject(payload);
  const email = String(input.email || '').toLowerCase();
  const code = String(input.code || '').trim();
  const key = otpKey(`reg:${email}`);
  const rec = await readSetting(key, null);
  if (!rec || !rec.hash) throw new Error('No verification code was requested.');
  if (rec.email !== email) throw new Error('Email does not match the requested code.');
  if (Date.now() > Number(rec.expiresAt || 0)) { await writeSetting(key, null); throw new Error('Verification code expired. Request a new one.'); }
  if (Number(rec.attempts || 0) >= 6) { await writeSetting(key, null); throw new Error('Too many attempts. Request a new code.'); }
  if (!verifySecret(code, rec.salt, rec.hash)) {
    await writeSetting(key, { ...rec, attempts: Number(rec.attempts || 0) + 1 });
    throw new Error('Incorrect code.');
  }
  await writeSetting(key, null);
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
  const key = otpKey(`reg:${email}`);
  const rec = await readSetting(key, null);
  if (!rec || !rec.hash) throw new Error('No verification code was requested.');
  if (rec.email !== email) throw new Error('Email does not match the requested code.');
  if (Date.now() > Number(rec.expiresAt || 0)) { await writeSetting(key, null); throw new Error('Verification code expired. Request a new one.'); }
  if (Number(rec.attempts || 0) >= 6) { await writeSetting(key, null); throw new Error('Too many attempts. Request a new code.'); }
  if (!verifySecret(code, rec.salt, rec.hash)) {
    await writeSetting(key, { ...rec, attempts: Number(rec.attempts || 0) + 1 });
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
  await writeSetting(key, null);

  return { ok: true, member: serializeMember(owner, { isCurrent: true }) };
}

// ---- Team oversight (local-first admin dashboard) ----
// Per-member instructions are stored in Setting (no schema migration needed).
async function setMemberInstructions(payload) {
  await requirePermission('members.manage');
  const input = requireObject(payload);
  const id = parseId(input.id);
  await assertCanManageMember(id);
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

// Handoff: reassign one or more profiles to a member (null = unassign) and write
// a per-profile audit row. Gated to ADMIN+ and scoped to members the actor can see.
async function reassignProfiles(payload) {
  await requirePermission('members.manage');
  const input = requireObject(payload);
  const profileIds = parseIdArray(input.profileIds);
  if (profileIds.length === 0) throw new Error('Select at least one profile to reassign.');
  const db = getPrisma();

  let targetId = null;
  let targetName = 'Unassigned';
  const actor = await getActiveMember();
  const actorName = actor ? actor.name : 'Owner';

  if (input.memberId != null && input.memberId !== '') {
    targetId = parseId(input.memberId);
    const target = await db.member.findUnique({ where: { id: targetId } });
    if (!target) throw new Error('Target member not found.');
    if (actor && actor.role !== 'SUPER_ADMIN') {
      const all = await db.member.findMany();
      const visible = permissions.visibleMemberIds(all, actor);
      if (!visible.has(targetId)) throw new Error('You can only assign profiles to members you manage.');
    }
    targetName = target.name;
  }

  // Source scoping: you can only move profiles you actually have access to.
  const { allowed } = await partitionAccessibleProfileIds(profileIds);
  const res = await db.profile.updateMany({
    where: { id: { in: allowed }, deletedAt: null },
    data: { assignedMemberId: targetId }
  });
  for (const pid of allowed) {
    await logActivity(db, pid, 'reassign', `${actorName} → ${targetName}`).catch(() => {});
  }
  return { reassigned: res.count, memberId: targetId, memberName: targetName };
}

// Seat accounting: seats are derived from the owner-tree's license type. The
// Super Admin (source owner) is exempt; single-user mode is unrestricted.
async function getSeatUsage() {
  const m = await getActiveMember();
  if (m && m.role === 'SUPER_ADMIN') {
    return { used: 0, total: -1, type: 'source-owner', remaining: -1, full: false, exempt: true };
  }
  const db = getPrisma();
  const ownerId = await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  const members = await db.member.findMany({ select: { id: true, status: true, parentMemberId: true } });
  return teamPolicy.seatUsage(members, ownerId, lic);
}

// Throw when the owner-tree has no free seats. Called from createMember (never on
// the very first OWNER bootstrap). Super Admin / single-user mode are unrestricted.
async function assertSeatAvailable() {
  const m = await getActiveMember();
  if (!m || m.role === 'SUPER_ADMIN') return;
  const db = getPrisma();
  const ownerId = await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  const members = await db.member.findMany({ select: { id: true, status: true, parentMemberId: true } });
  const usage = teamPolicy.seatUsage(members, ownerId, lic);
  if (usage.full) {
    const e = new Error(`Your plan includes ${usage.total} seat(s) and all are in use. Upgrade your subscription to add more team members.`);
    e.code = 'SEAT_LIMIT';
    throw e;
  }
}

// CSV/JSON export of the activity feed, filterable by member/action/date range.
async function exportTeamActivity(payload) {
  await requirePermission('members.manage');
  const input = (payload && typeof payload === 'object') ? payload : {};
  const isJson = String(input.format || 'csv').toLowerCase() === 'json';
  const db = getPrisma();

  const where = {};
  if (input.memberId != null && input.memberId !== '') where.memberId = parseId(input.memberId);
  if (input.action) where.action = String(input.action);
  const createdAt = {};
  if (input.from) { const d = new Date(input.from); if (!Number.isNaN(d.getTime())) createdAt.gte = d; }
  if (input.to) { const d = new Date(input.to); if (!Number.isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); createdAt.lte = d; } }
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

  const take = Math.min(Math.max(parseInt(input.limit, 10) || 5000, 1), 50000);
  const logs = await db.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, take });

  const memberIds = [...new Set(logs.map((l) => l.memberId).filter(Boolean))];
  const profileIds = [...new Set(logs.map((l) => l.profileId).filter(Boolean))];
  const [members, profiles] = await Promise.all([
    memberIds.length ? db.member.findMany({ where: { id: { in: memberIds } } }) : [],
    profileIds.length ? db.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, title: true } }) : []
  ]);
  const mMap = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const pMap = Object.fromEntries(profiles.map((p) => [p.id, p.title]));

  const rows = logs.map((l) => ({
    id: l.id,
    createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
    memberName: l.memberId ? (mMap[l.memberId] || 'Unknown member') : 'System',
    action: l.action,
    profileTitle: l.profileId ? (pMap[l.profileId] || `#${l.profileId}`) : '',
    detail: l.detail || ''
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  const save = await dialog.showSaveDialog({
    title: 'Export activity log',
    defaultPath: `softglaze-activity-${stamp}.${isJson ? 'json' : 'csv'}`,
    filters: [isJson ? { name: 'JSON', extensions: ['json'] } : { name: 'CSV', extensions: ['csv'] }]
  });
  if (save.canceled || !save.filePath) return { cancelled: true };

  const content = isJson ? JSON.stringify(rows, null, 2) : teamPolicy.activityToCsv(rows);
  await fs.writeFile(save.filePath, content, 'utf8');
  return { ok: true, path: save.filePath, count: rows.length, format: isJson ? 'json' : 'csv' };
}

// ---------------------------------------------------------------------------
// Softglaze Enterprise — End-to-End encrypted cloud sync  [needs backend]
//
// Wires the existing CloudSyncEngine (tested crypto envelope) to a concrete REST
// object-store transport (src/main/syncTransport.js — an EXTERNAL service you
// host). Everything is encrypted LOCALLY before upload (zero-knowledge): the
// bucket only ever stores opaque envelopes. The sync passphrase is held in memory
// for the session only and never persisted in plaintext (the vault keeps only a
// hash, so we can't reuse it). With no endpoint configured, status reports
// disabled and nothing pretends to sync.
// ---------------------------------------------------------------------------

// Profile fields that define identity/fingerprint and are safe to sync. NOT
// synced: id/dataDirName/ownership/assignment/proxy bindings (all install-local).
const SYNC_SCALAR_FIELDS = [
  'browserCore', 'browserBrand', 'browserVersion', 'os', 'osVersion', 'userAgent', 'startupUrls',
  'webrtc', 'timezoneType', 'timezoneCustom', 'locationType', 'locationLat', 'locationLng', 'locationAcc',
  'languageType', 'languageCustom', 'displayLangType', 'displayLangCustom',
  'resolutionType', 'resolutionW', 'resolutionH', 'fontsType',
  'canvasNoise', 'webglImageNoise', 'audioContextNoise', 'clientRectsNoise', 'speechVoicesNoise', 'mediaDevice',
  'webglMetadata', 'webglVendor', 'webglRenderer', 'webgpu',
  'cpuType', 'cpuCores', 'ramType', 'ramGb', 'twoFactorSeed', 'notes'
];

// Session-scoped sync state. The passphrase-derived key lives ONLY here.
let cloudSyncEngine = null;     // CloudSyncEngine (transport + derived key) when unlocked
let cloudSyncUnlocked = false;
let cloudSyncLastError = null;

async function readCloudSyncConfig() {
  const c = (await readSetting('cloudSync', null)) || {};
  return {
    enabled: Boolean(c.enabled),
    baseUrl: c.baseUrl || '',
    namespace: c.namespace || 'softglaze',
    sealedToken: c.sealedToken || '',
    passphraseSalt: c.passphraseSalt || null,
    passphraseVerifier: c.passphraseVerifier || null
  };
}

function cloudSyncConfigured(c) { return Boolean(c.baseUrl && c.passphraseVerifier); }

function syncHostOf(url) { try { return new URL(url).host; } catch (e) { return String(url || ''); } }

// Verify the passphrase against the stored verifier, then build the engine with a
// concrete transport and derive the session key. Throws on a wrong passphrase.
async function unlockCloudSync(passphrase) {
  const c = await readCloudSyncConfig();
  if (!cloudSyncConfigured(c)) { const e = new Error('Cloud sync is not configured.'); e.code = 'SYNC_NOT_CONFIGURED'; throw e; }
  if (!verifySecret(String(passphrase || ''), c.passphraseSalt, c.passphraseVerifier)) {
    const e = new Error('Incorrect sync passphrase.'); e.code = 'BAD_PASSPHRASE'; throw e;
  }
  const token = secretStore.open(c.sealedToken);
  const transport = syncTransport.createTransport({ baseUrl: c.baseUrl, token });
  const engine = new CloudSyncEngine({ transport, namespace: c.namespace });
  // The key-derivation salt is the shared namespace, so two installs that agree on
  // (passphrase, namespace) derive the SAME key and converge.
  await engine.deriveMasterKey(String(passphrase), c.namespace);
  cloudSyncEngine = engine;
  cloudSyncUnlocked = true;
  cloudSyncLastError = null;
  return engine;
}

async function syncConfigure(payload) {
  await requireOwnerOrSuper('configure cloud sync');
  const input = requireObject(payload);
  const prev = await readCloudSyncConfig();

  const baseUrl = input.baseUrl !== undefined ? String(input.baseUrl || '').trim().replace(/\/+$/, '') : prev.baseUrl;
  const namespace = (input.namespace !== undefined ? String(input.namespace || '').trim() : prev.namespace) || 'softglaze';
  let sealedToken = prev.sealedToken;
  if (input.token !== undefined && input.token !== '') sealedToken = secretStore.seal(String(input.token).trim());

  let passphraseSalt = prev.passphraseSalt;
  let passphraseVerifier = prev.passphraseVerifier;
  const passphrase = (input.passphrase !== undefined && input.passphrase !== '') ? String(input.passphrase) : null;
  if (passphrase) {
    // First-time set or an intentional re-key only when it differs from the stored
    // one; entering the SAME passphrase just unlocks (verifier preserved).
    if (!passphraseVerifier || !verifySecret(passphrase, passphraseSalt, passphraseVerifier)) {
      const h = hashSecret(passphrase); passphraseSalt = h.salt; passphraseVerifier = h.hash;
    }
  }

  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : prev.enabled;
  if (enabled && !baseUrl) throw new Error('Enter the sync endpoint URL before enabling sync.');
  if (enabled && !passphraseVerifier) throw new Error('Set a sync passphrase before enabling sync.');

  await writeSetting('cloudSync', { enabled, baseUrl, namespace, sealedToken, passphraseSalt, passphraseVerifier });

  // Re-key invalidates a previously-derived session key.
  cloudSyncEngine = null;
  cloudSyncUnlocked = false;
  if (passphrase && baseUrl) { try { await unlockCloudSync(passphrase); } catch (e) { /* surfaced via status */ } }
  return syncStatus();
}

async function syncStatus() {
  const c = await readCloudSyncConfig();
  const configured = cloudSyncConfigured(c);
  let pendingCount = 0;
  try {
    if (configured) {
      const ids = (await readSetting('cloudSyncIds', {})) || {};
      const state = (await readSetting('cloudSyncState', {})) || {};
      const profiles = await getPrisma().profile.findMany({ where: { deletedAt: null }, select: { id: true, updatedAt: true } });
      for (const p of profiles) {
        const sid = ids[p.id];
        const ls = sid ? state[sid] : null;
        if (!ls || syncPolicy.toMs(p.updatedAt) > syncPolicy.toMs(ls.syncedAt)) pendingCount += 1;
      }
    }
  } catch (e) { /* best-effort */ }
  return {
    enabled: c.enabled,
    configured,
    unlocked: cloudSyncUnlocked && Boolean(cloudSyncEngine),
    endpointHost: configured ? syncHostOf(c.baseUrl) : '',
    namespace: c.namespace,
    hasToken: Boolean(c.sealedToken),
    lastSyncedAt: (await readSetting('cloudSyncLastRun', null)) || null,
    pendingCount,
    lastError: cloudSyncLastError
  };
}

// --- transport envelope helpers (encrypt locally, store opaque) -------------
async function syncPut(engine, key, obj) {
  const env = engine.encryptPayload(obj);
  await engine.transport.put(`${engine.namespace}/${key}`, Buffer.from(JSON.stringify(env)));
}
async function syncGet(engine, key) {
  const raw = await engine.transport.get(`${engine.namespace}/${key}`);
  if (!raw) return null;
  let env;
  try { env = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); }
  catch (e) { throw new Error('A remote sync object is corrupt.'); }
  return engine.decryptPayload(env); // throws on wrong key — caller surfaces it
}

async function pullSyncIndex(engine) {
  const raw = await engine.transport.get(`${engine.namespace}/index.sgz-env`);
  if (!raw) return {};
  let env;
  try { env = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); }
  catch (e) { throw new Error('The remote sync index is corrupt.'); }
  let payload;
  try { payload = engine.decryptPayload(env); }
  catch (e) {
    const err = new Error('Remote sync data was encrypted with a different passphrase. Use the original passphrase, or reset sync.');
    err.code = 'SYNC_KEY_MISMATCH'; throw err;
  }
  return (payload && payload.profiles && typeof payload.profiles === 'object') ? payload.profiles : {};
}

// --- profile <-> sync state mapping -----------------------------------------
function pickSyncFingerprint(profile) {
  const fp = { title: profile.title };
  for (const k of SYNC_SCALAR_FIELDS) fp[k] = profile[k];
  try { fp.platformAccounts = profile.platformAccounts ? JSON.parse(profile.platformAccounts) : []; } catch (e) { fp.platformAccounts = []; }
  try { fp.tags = profile.tags ? JSON.parse(profile.tags) : []; } catch (e) { fp.tags = []; }
  if (!Array.isArray(fp.tags)) fp.tags = [];
  return fp;
}

async function gatherProfileSyncState(profile) {
  let cookies = [];
  try { cookies = (await exportStoredCookies(await offlineProfileOpts(profile.id))) || []; } catch (e) { cookies = []; }
  return { cookies, localStorage: {}, fingerprint: pickSyncFingerprint(profile) };
}

// Apply a pulled remote state onto an EXISTING local profile (build the update
// data explicitly so we never clobber install-local fields with defaults).
async function applyRemoteToProfile(db, profile, remoteState) {
  const fp = (remoteState && remoteState.fingerprint) || {};
  const data = {};
  for (const k of SYNC_SCALAR_FIELDS) if (fp[k] !== undefined) data[k] = fp[k];
  if (typeof fp.title === 'string' && fp.title) data.title = fp.title;
  if (Array.isArray(fp.platformAccounts)) data.platformAccounts = JSON.stringify(fp.platformAccounts);
  if (Array.isArray(fp.tags)) data.tags = JSON.stringify(fp.tags);
  await db.profile.update({ where: { id: profile.id }, data });
  const cookies = Array.isArray(remoteState.cookies) ? remoteState.cookies : [];
  if (cookies.length) {
    const params = cookies.map(toSetCookieParam).filter(Boolean);
    if (params.length) await importStoredCookies(await offlineProfileOpts(profile.id), params).catch(() => {});
  }
  await logActivity(db, profile.id, 'sync', 'pulled from cloud').catch(() => {});
}

// Create a brand-new local profile from a pulled remote state (convergence: the
// second install gains profiles the first one had).
async function createProfileFromRemote(remoteState) {
  const fp = (remoteState && remoteState.fingerprint) || {};
  const payload = {};
  for (const k of SYNC_SCALAR_FIELDS) if (fp[k] !== undefined) payload[k] = fp[k];
  payload.title = (typeof fp.title === 'string' && fp.title) ? fp.title : 'Synced profile';
  if (Array.isArray(fp.platformAccounts)) payload.platformAccounts = fp.platformAccounts;
  if (Array.isArray(fp.tags)) payload.tags = fp.tags;
  const created = await createProfile(payload); // serialized, includes id
  const cookies = Array.isArray(remoteState.cookies) ? remoteState.cookies : [];
  if (cookies.length) {
    const params = cookies.map(toSetCookieParam).filter(Boolean);
    if (params.length) await importStoredCookies(await offlineProfileOpts(created.id), params).catch(() => {});
  }
  await logActivity(getPrisma(), created.id, 'sync', 'created from cloud').catch(() => {});
  return created.id;
}

async function syncRun(payload) {
  await requireOwnerOrSuper('run cloud sync');
  const c = await readCloudSyncConfig();
  if (!cloudSyncConfigured(c)) return { ok: false, skipped: true, reason: 'Cloud sync is not configured.' };
  if (!c.enabled) return { ok: false, skipped: true, reason: 'Cloud sync is disabled.' };
  if (!cloudSyncEngine || !cloudSyncUnlocked) return { ok: false, locked: true, reason: 'Enter your sync passphrase to unlock sync this session.' };

  const input = (payload && typeof payload === 'object') ? payload : {};
  const onlyIds = Array.isArray(input.profileIds) && input.profileIds.length ? new Set(input.profileIds.map(Number)) : null;
  const db = getPrisma();
  const engine = cloudSyncEngine;
  const ids = (await readSetting('cloudSyncIds', {})) || {};
  const state = (await readSetting('cloudSyncState', {})) || {};
  const results = [];
  let pushed = 0, pulled = 0, created = 0, conflicts = 0, failed = 0;

  try {
    const index = await pullSyncIndex(engine); // throws SYNC_KEY_MISMATCH on a wrong-key remote

    const profiles = await db.profile.findMany({ where: { deletedAt: null } });
    const localSyncIds = new Map();
    for (const p of profiles) {
      if (onlyIds && !onlyIds.has(p.id)) continue;
      let sid = ids[p.id];
      if (!sid) { sid = crypto.randomUUID(); ids[p.id] = sid; }
      localSyncIds.set(sid, p);
    }

    // Reconcile each local profile against the remote index.
    for (const [sid, p] of localSyncIds) {
      try {
        const remoteMeta = index[sid] || null;
        const lastSync = state[sid] || null;
        const decision = syncPolicy.decideProfileSync({ localUpdatedAt: p.updatedAt, remoteMeta, lastSync });
        if (decision.action === 'noop') { results.push({ profileId: p.id, action: 'noop' }); continue; }
        const isConflict = decision.action === 'conflict';
        if (isConflict) conflicts += 1;

        if (decision.resolution === 'push') {
          const nowIso = new Date().toISOString();
          const rev = ((remoteMeta && remoteMeta.rev) || (lastSync && lastSync.rev) || 0) + 1;
          await syncPut(engine, `${sid}.sgz-env`, { v: 1, meta: { updatedAt: nowIso, rev }, state: await gatherProfileSyncState(p) });
          index[sid] = { updatedAt: nowIso, rev };
          state[sid] = { syncedAt: nowIso, rev };
          pushed += 1;
          results.push({ profileId: p.id, action: 'push', conflict: isConflict });
        } else {
          const payloadObj = await syncGet(engine, `${sid}.sgz-env`);
          if (payloadObj && payloadObj.state) {
            await applyRemoteToProfile(db, p, payloadObj.state);
            state[sid] = { syncedAt: new Date().toISOString(), rev: (remoteMeta && remoteMeta.rev) || 0 };
            pulled += 1;
            results.push({ profileId: p.id, action: 'pull', conflict: isConflict });
          }
        }
      } catch (e) { failed += 1; results.push({ profileId: p.id, action: 'error', error: (e && e.message) || 'failed' }); }
    }

    // Remote profiles not present locally -> create them (full-run only).
    if (!onlyIds) {
      const known = new Set(Object.values(ids));
      for (const sid of Object.keys(index)) {
        if (known.has(sid)) continue;
        try {
          const payloadObj = await syncGet(engine, `${sid}.sgz-env`);
          if (!payloadObj || !payloadObj.state) continue;
          const newId = await createProfileFromRemote(payloadObj.state);
          ids[newId] = sid;
          state[sid] = { syncedAt: new Date().toISOString(), rev: (index[sid] && index[sid].rev) || 0 };
          created += 1;
          results.push({ profileId: newId, action: 'create' });
        } catch (e) { failed += 1; results.push({ syncId: sid, action: 'error', error: (e && e.message) || 'failed' }); }
      }
    }

    await pushSyncIndex(engine, index);
    await writeSetting('cloudSyncIds', ids);
    await writeSetting('cloudSyncState', state);
    await writeSetting('cloudSyncLastRun', new Date().toISOString());
    cloudSyncLastError = null;
    return { ok: true, pushed, pulled, created, conflicts, failed, results };
  } catch (e) {
    cloudSyncLastError = (e && e.message) || 'Sync failed.';
    return { ok: false, error: cloudSyncLastError, code: e && e.code, results };
  }
}

async function pushSyncIndex(engine, profiles) {
  await syncPut(engine, 'index.sgz-env', { v: 1, profiles });
}

// ---------------------------------------------------------------------------
// Licensing / billing (local-first). Each OWNER tree has a licence: a 7-day free
// trial that, when it lapses, WARNS but does not block (per product choice).
// Payment is via Cryptomus using the SUPER ADMIN's merchant credentials; a paid
// invoice extends the licence 30 days and issues a self-verifying purchase code.
// ---------------------------------------------------------------------------
const TRIAL_DAYS = 7;
const GRACE_DAYS = 3; // after the trial/paid term lapses: app still works but nags, then bans
const PLAN = Object.freeze({ id: 'monthly', amount: '5', currency: 'USD', months: 1, days: 30, label: '$5 / month' });

// Purchasable plans catalog — the BUILT-IN DEFAULTS. The live catalog is persisted
// in Setting['billingPlans'] and fully editable by the Super Admin (price, name,
// tagline, features, highlight, active) plus brand-new packages. `pro` mirrors PLAN
// (the app's historical $5/month price). When no override is saved, these defaults
// are used verbatim; both are billed monthly via the same checkout.
const DEFAULT_BILLING_PLANS = Object.freeze([
  Object.freeze({
    id: 'free-trial',
    kind: 'trial',
    trialDays: TRIAL_DAYS,
    tier: 'enterprise', // full access during the trial so everything can be tested
    name: 'Free Trial',
    amount: '0',
    currency: PLAN.currency,
    months: 1,
    period: `${TRIAL_DAYS} days`,
    tagline: 'Test every feature free — full access, no card required.',
    highlight: false,
    features: Object.freeze([
      'Full access to every feature',
      'All fingerprint, proxy & leak tools',
      'Macros, AI cookie warmer & mobile profiles',
      'Encrypted backup & team seats',
      'No credit card required',
      'Upgrade to a paid plan anytime'
    ])
  }),
  Object.freeze({
    id: 'pro',
    tier: 'pro',
    name: 'Pro',
    amount: PLAN.amount,
    currency: PLAN.currency,
    months: PLAN.months,
    period: 'month',
    tagline: 'Everything a solo operator needs to run profiles at scale.',
    highlight: false,
    features: Object.freeze([
      'Unlimited local browser profiles',
      'Full fingerprint engine + leak checks',
      'Proxy pool, rotation policy & geo auto-match',
      'Macro recorder, scheduler & data-driven runs',
      'AI cookie warmer',
      'Mobile / Android device profiles',
      'Encrypted workspace backup & restore',
      'Command palette + onboarding'
    ])
  }),
  Object.freeze({
    id: 'enterprise',
    tier: 'enterprise',
    name: 'Enterprise',
    amount: '15',
    currency: PLAN.currency,
    months: 1,
    period: 'month',
    tagline: 'For teams — sync, full-disk encryption, seats & audit.',
    highlight: true,
    features: Object.freeze([
      'Everything in Pro, plus:',
      'Unlimited parallel runner + live run console',
      'Team seats, profile lock & handoff',
      'Audit-log export (CSV / JSON)',
      'End-to-end encrypted cloud sync',
      'Full at-rest database encryption',
      'Priority support'
    ])
  })
]);

// Coerce any raw plan record (a saved override or a default) into the canonical
// shape the renderer + checkout expect. Tolerant of partial/edited input.
function normalizePlan(raw, idx) {
  const p = (raw && typeof raw === 'object') ? raw : {};
  let id = String(p.id || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) id = `plan-${idx == null ? 0 : idx}`;
  const tier = String(p.tier || 'pro').toLowerCase() === 'enterprise' ? 'enterprise' : 'pro';
  const kind = String(p.kind || 'paid').toLowerCase() === 'trial' ? 'trial' : 'paid';
  const features = Array.isArray(p.features) ? p.features.map((f) => String(f)).filter((f) => f.trim() !== '').slice(0, 30) : [];
  return {
    id,
    tier,
    kind,
    trialDays: Math.max(1, Number.parseInt(p.trialDays, 10) || TRIAL_DAYS),
    name: String(p.name || 'Plan').slice(0, 60),
    amount: kind === 'trial' ? '0' : String(p.amount == null ? '0' : p.amount).slice(0, 20),
    currency: String(p.currency || PLAN.currency).toUpperCase().slice(0, 6),
    months: Math.max(1, Number.parseInt(p.months, 10) || 1),
    period: String(p.period || 'month').slice(0, 16),
    tagline: String(p.tagline || '').slice(0, 200),
    highlight: Boolean(p.highlight),
    active: p.active === undefined ? true : Boolean(p.active),
    features
  };
}

// The LIVE plans catalog: the Super Admin's saved overrides if present, else the
// built-in defaults. Includes inactive plans (callers filter as needed).
async function readBillingPlans() {
  const stored = await readSetting('billingPlans', null);
  const list = Array.isArray(stored) && stored.length ? stored : DEFAULT_BILLING_PLANS;
  return list.map((p, i) => normalizePlan(p, i));
}

// Resolve a plan by id from the live catalog (async — the catalog is persisted).
// Falls back to the first active plan, then the first plan, so checkout never
// dereferences undefined even if an id was deleted between page-load and pay.
async function findPlan(planId) {
  const id = String(planId || '').toLowerCase();
  const plans = await readBillingPlans();
  return plans.find((p) => p.id === id) || plans.find((p) => p.active) || plans[0] || normalizePlan(DEFAULT_BILLING_PLANS[0], 0);
}

// Renderer-facing plans catalog + the viewer's current tier/state, so the Billing
// page can highlight the active plan and decide which CTA to show. Reuses
// getLicense (which already handles the Super-Admin exempt path). `canManage` lets
// the page reveal the plan-editor / subscribers / assign controls.
async function getBillingPlans() {
  const lic = await getLicense();
  const me = await getActiveMember();
  const all = await readBillingPlans();
  return {
    plans: all.filter((p) => p.active),
    currency: PLAN.currency,
    currentTier: lic.tier || 'pro',
    state: lic.state,
    isPaid: Boolean(lic.isPaid),
    isExempt: Boolean(lic.isExempt),
    isTrial: Boolean(lic.isTrial),
    daysLeftTrial: lic.daysLeftTrial ?? null,
    // Who may start the free trial from the Billing page: anyone not exempt and not
    // already on a paid plan (best-effort, local — see the Licenses panel note).
    canStartTrial: !lic.isExempt && !lic.isPaid,
    canManage: Boolean(me && me.role === 'SUPER_ADMIN')
  };
}

// ---- Super-Admin plan management (edit prices/details, add packages) ----------
// All plans incl. inactive — for the editor grid.
async function listBillingPlansAdmin() {
  await requireSuperAdmin();
  return { plans: await readBillingPlans(), currency: PLAN.currency };
}

// Create (no/blank id) or update (matching id) a plan. New ids are slugged from
// the name and de-duplicated. Returns the full refreshed catalog.
async function saveBillingPlan(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const plans = await readBillingPlans();
  let id = String(input.id || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) {
    const base = String(input.name || 'plan').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'plan';
    id = base; let n = 2;
    while (plans.some((p) => p.id === id)) id = `${base}-${n++}`;
  }
  const incoming = normalizePlan({ ...input, id }, plans.length);
  const idx = plans.findIndex((p) => p.id === id);
  if (idx >= 0) plans[idx] = incoming; else plans.push(incoming);
  await writeSetting('billingPlans', plans);
  return { plan: incoming, plans };
}

// Delete a plan by id (at least one must remain so checkout always has a target).
async function deleteBillingPlan(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const id = String(input.id || '').toLowerCase();
  const plans = (await readBillingPlans()).filter((p) => p.id !== id);
  if (!plans.length) throw new Error('At least one plan must remain.');
  await writeSetting('billingPlans', plans);
  return { plans };
}

// Assign / grant a plan to an owner tree directly (the Super Admin "self-assign"
// and gift flow). Advances the paid term, clears any ban, and records a `grant`
// invoice so it shows in the subscribers + invoices lists. `charge:true` records
// the plan price (a sale logged after the fact); otherwise the invoice is $0.
async function assignPlan(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const ownerId = (input.ownerId != null && input.ownerId !== '') ? parseId(input.ownerId) : await resolveLicenseOwnerId();
  const plan = await findPlan(input.planId);
  const months = Math.max(1, Number.parseInt(input.months, 10) || plan.months || 1);
  const lic = await ensureLicense(ownerId);
  const code = optionalString(input.code) || payments.generatePurchaseCode(months);
  const updated = await applyPaidMonths(lic, months, code, plan.tier);
  await recordInvoice({
    ownerId: ownerId ?? null,
    provider: 'grant',
    amount: input.charge ? plan.amount : '0',
    currency: plan.currency,
    tier: plan.tier,
    months,
    reference: code,
    note: optionalString(input.note) || `Assigned ${plan.name} by Super Admin`,
    status: 'paid',
    source: 'grant'
  });
  return { ok: true, ownerId, plan: { id: plan.id, name: plan.name, tier: plan.tier, amount: plan.amount, currency: plan.currency }, months, code, license: await licenseView(updated) };
}

// Subscribers overview for the Super Admin Billing console: every owner tree with
// join date, plan/tier, expiry, days left, team size and last payment.
async function listSubscribers() {
  await requireSuperAdmin();
  const db = getPrisma();
  const owners = await db.member.findMany({ where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' } });
  const plans = await readBillingPlans();
  const planNameForTier = (t) => { const p = plans.find((x) => x.tier === t && x.active) || plans.find((x) => x.tier === t); return p ? p.name : (t || 'pro'); };
  const out = [];
  for (const o of owners) {
    const lic = await ensureLicense(o.id);
    const view = await licenseView(lic);
    let lastInvoice = null;
    try {
      const inv = await db.invoice.findFirst({ where: { ownerMemberId: o.id }, orderBy: { createdAt: 'desc' } });
      if (inv) lastInvoice = { amount: inv.amount, currency: inv.currency, provider: inv.provider, source: inv.source, createdAt: inv.createdAt instanceof Date ? inv.createdAt.toISOString() : inv.createdAt };
    } catch (_) { /* best-effort */ }
    let teamSize = 0;
    try { teamSize = await db.member.count({ where: { parentMemberId: o.id } }); } catch (_) { /* best-effort */ }
    out.push({
      ownerId: o.id,
      ownerName: o.name,
      ownerEmail: o.email || null,
      status: o.status,
      banReason: o.banReason || null,
      joinedAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : o.createdAt,
      tier: view.tier,
      planName: planNameForTier(view.tier),
      type: view.type,
      state: view.state,
      endsAt: view.endsAt,
      daysLeft: view.daysLeft,
      isPaid: view.isPaid,
      isTrial: view.isTrial,
      isGrace: view.isGrace,
      isBanned: view.isBanned,
      teamSize,
      lastInvoice
    });
  }
  return { subscribers: out };
}

async function primaryOwnerId() {
  const owner = await getPrisma().member.findFirst({ where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' } });
  return owner ? owner.id : null;
}

// The OWNER at the top of the active member's tree (licences are per-owner).
async function resolveLicenseOwnerId() {
  const m = await getActiveMember();
  if (m && m.role === 'OWNER') return m.id;
  if (m && m.role !== 'SUPER_ADMIN' && m.id >= 0) {
    const all = await getPrisma().member.findMany({ select: { id: true, role: true, parentMemberId: true } });
    const byId = new Map(all.map((x) => [x.id, x]));
    let cur = byId.get(m.id);
    let guard = 0;
    while (cur && cur.role !== 'OWNER' && cur.parentMemberId != null && guard++ < 25) cur = byId.get(Number(cur.parentMemberId));
    if (cur && cur.role === 'OWNER') return cur.id;
  }
  return primaryOwnerId();
}

async function ensureLicense(ownerId) {
  const db = getPrisma();
  let lic = await db.license.findFirst({ where: { ownerMemberId: ownerId ?? null }, orderBy: { createdAt: 'desc' } });
  if (!lic) {
    // New workspaces start on the full-access free trial so every feature can be
    // tested out of the box. Tier 'enterprise' for the trial term.
    lic = await db.license.create({
      data: { ownerMemberId: ownerId ?? null, type: 'trial', tier: 'enterprise', status: 'active', trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400000) }
    });
  }
  return lic;
}

// Best-effort clock-tamper clamp persisted in Setting. A rolled-back system clock
// must not silently buy back an expired trial — see licensePolicy.clampNow.
async function clampLicenseNow() {
  const stored = await readSetting('licenseClock', null);
  const r = licensePolicy.clampNow({ now: Date.now(), lastSeenAt: stored && stored.lastSeenAt });
  if (!stored || stored.lastSeenAt !== r.lastSeenAt) {
    await writeSetting('licenseClock', { lastSeenAt: r.lastSeenAt }).catch(() => {});
  }
  return { effectiveNow: r.effectiveNow, tampered: r.tampered };
}

// Marker that distinguishes an automatic license-lapse ban from a deliberate
// Super-Admin block. Only license-caused bans are auto-cleared when the licence
// becomes valid again — an admin block stays until the admin lifts it.
const LICENSE_BAN_REASON = 'Trial and grace period ended.';

// Reconcile the owner's Member.status with the license state, and report the
// owner's resulting status. License-lapse bans are applied/cleared automatically;
// an admin block (different banReason) is never touched here. Returns the status
// string (so callers can fold an admin block into the effective ban).
async function syncOwnerBanState(ownerId, licenseBanned) {
  if (ownerId == null) return null;
  try {
    const db = getPrisma();
    const owner = await db.member.findUnique({ where: { id: ownerId } });
    if (!owner) return null;
    if (licenseBanned && owner.status !== 'banned') {
      const u = await db.member.update({ where: { id: ownerId }, data: { status: 'banned', banReason: LICENSE_BAN_REASON } });
      return u.status;
    }
    if (!licenseBanned && owner.status === 'banned' && owner.banReason === LICENSE_BAN_REASON) {
      const u = await db.member.update({ where: { id: ownerId }, data: { status: 'active', banReason: null } });
      return u.status;
    }
    return owner.status;
  } catch (e) { return null; }
}

// Evaluate + format a licence: runs the state machine (with the tamper-clamped
// clock), reconciles the owner ban flag, and returns the renderer-facing view. The
// effective ban is license-lapse OR a Super-Admin block on the owner.
async function licenseView(lic) {
  const { effectiveNow, tampered } = await clampLicenseNow();
  const st = licensePolicy.computeLicenseState({ type: lic.type, trialEndsAt: lic.trialEndsAt, now: effectiveNow, graceDays: GRACE_DAYS });
  const ownerStatus = await syncOwnerBanState(lic.ownerMemberId ?? null, st.isBanned);
  const banned = st.isBanned || ownerStatus === 'banned';
  return {
    type: lic.type,
    tier: lic.tier || 'pro',
    state: banned ? 'banned' : st.state,
    status: banned ? 'banned' : (st.isGrace ? 'grace' : 'active'),
    endsAt: st.endsAt,
    graceEndsAt: st.graceEndsAt,
    daysLeft: st.isTrial && !banned ? st.daysLeftTrial : (st.isGrace && !banned ? st.daysLeftGrace : null),
    daysLeftTrial: st.daysLeftTrial,
    daysLeftGrace: st.daysLeftGrace,
    isExpired: st.isGrace || banned,
    isTrial: st.isTrial && !banned,
    isPaid: st.isPaid && !banned,
    isGrace: st.isGrace && !banned,
    isBanned: banned,
    adminBlocked: banned && !st.isBanned, // banned by an admin, not by license lapse
    clockTamper: tampered,
    purchaseCode: lic.purchaseCode || null,
    plan: PLAN
  };
}

// Shared "grant paid" used by redeem AND checkout-poll: advances the paid term,
// optionally records the tier, AND clears any ban (restoring the owner to active).
async function applyPaidMonths(lic, months, code, tier) {
  const base = Math.max(Date.now(), lic.trialEndsAt ? new Date(lic.trialEndsAt).getTime() : Date.now());
  const until = new Date(base + months * PLAN.days * 86400000);
  const updated = await getPrisma().license.update({
    where: { id: lic.id },
    data: {
      type: 'paid',
      status: 'active',
      tier: tier || lic.tier || 'pro',
      purchaseCode: code || lic.purchaseCode || null,
      trialEndsAt: until
    }
  });
  await syncOwnerBanState(lic.ownerMemberId ?? null, false);
  return updated;
}

async function getLicense() {
  // The Super Admin is the source owner — exempt from the trial/subscription
  // system entirely. Never create or report a trial license for them.
  const m = await getActiveMember();
  if (m && m.role === 'SUPER_ADMIN') {
    return {
      type: 'source-owner',
      tier: 'enterprise',
      state: 'paid',
      status: 'active',
      endsAt: null,
      daysLeft: null,
      daysLeftTrial: null,
      daysLeftGrace: null,
      isExpired: false,
      isTrial: false,
      isPaid: true,
      isGrace: false,
      isBanned: false,
      isExempt: true,
      clockTamper: false,
      purchaseCode: null,
      plan: PLAN
    };
  }
  const ownerId = await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  return licenseView(lic);
}

// Main-side license gate. Refuse a profile launch when the owner tree is banned —
// never trust the renderer's gate alone. Super Admin is exempt.
async function assertNotBanned() {
  const m = await getActiveMember();
  if (m && m.role === 'SUPER_ADMIN') return;
  const ownerId = await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  const view = await licenseView(lic);
  if (view.isBanned) {
    const e = new Error('Your subscription has ended — renew it to launch profiles.');
    e.code = 'LICENSE_BANNED';
    throw e;
  }
}

async function redeemPurchaseCode(payload) {
  await requirePurchaser('redeem a purchase code');
  const input = requireObject(payload);
  const code = requiredString(input.code, 'Purchase code');
  const v = payments.verifyPurchaseCode(code);
  if (!v.valid) throw new Error('That purchase code is not valid.');
  const ownerId = await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  const updated = await applyPaidMonths(lic, v.months, code.trim().toUpperCase());
  return licenseView(updated);
}

// ---- Super-Admin lifecycle controls (enforced in main, never UI-trusted) ----

// Block / unblock / suspend a member. Owners manage only their own tree; the Super
// Admin manages anyone (and is the only one who can block an OWNER).
async function setMemberStatus(payload) {
  await requireOwnerOrSuper('change a member\'s status');
  const input = requireObject(payload);
  const id = parseId(input.id);
  const status = String(input.status || '').toLowerCase();
  if (!['active', 'suspended', 'banned'].includes(status)) throw new Error('Status must be active, suspended or banned.');
  const db = getPrisma();
  const actor = await getActiveMember();
  const target = await db.member.findUnique({ where: { id } });
  if (!target) throw new Error('Member not found.');
  if (actor && actor.role !== 'SUPER_ADMIN') {
    const all = await db.member.findMany();
    if (!permissions.visibleMemberIds(all, actor).has(id)) throw new Error('You can only manage members you created.');
  }
  if (target.role === 'OWNER' && status !== 'active' && (!actor || actor.role !== 'SUPER_ADMIN')) {
    throw new Error('Only the Super Admin can block or suspend an owner.');
  }
  const data = { status };
  data.banReason = status === 'banned' ? (optionalString(input.reason) || 'Blocked by administrator.') : null;
  const updated = await db.member.update({ where: { id }, data });
  await logActivity(db, null, status === 'active' ? 'unban' : status, `${target.name} → ${status}`);
  return serializeMember(updated);
}

// Grant a paid term to an owner tree (also clears any ban via applyPaidMonths).
async function grantLicense(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const ownerId = input.ownerId != null ? parseId(input.ownerId) : await resolveLicenseOwnerId();
  const months = Math.max(1, Number.parseInt(input.months, 10) || 1);
  const tier = input.tier === 'enterprise' ? 'enterprise' : 'pro';
  const lic = await ensureLicense(ownerId);
  const updated = await applyPaidMonths(lic, months, lic.purchaseCode || null, tier);
  return licenseView(updated);
}

// Extend the current term by N days (keeps trial/paid type); clears a ban.
async function extendLicense(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const ownerId = input.ownerId != null ? parseId(input.ownerId) : await resolveLicenseOwnerId();
  const days = Math.max(1, Number.parseInt(input.days, 10) || 7);
  const lic = await ensureLicense(ownerId);
  const base = Math.max(Date.now(), lic.trialEndsAt ? new Date(lic.trialEndsAt).getTime() : Date.now());
  const updated = await getPrisma().license.update({ where: { id: lic.id }, data: { trialEndsAt: new Date(base + days * 86400000) } });
  await syncOwnerBanState(ownerId, false);
  return licenseView(updated);
}

// Reset an owner tree to a fresh 7-day trial; clears a ban.
async function resetLicense(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const ownerId = input.ownerId != null ? parseId(input.ownerId) : await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  const updated = await getPrisma().license.update({
    where: { id: lic.id },
    data: { type: 'trial', status: 'active', purchaseCode: null, trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400000) }
  });
  await syncOwnerBanState(ownerId, false);
  return licenseView(updated);
}

// Start (or restart) the full-access free trial for an owner workspace. The owner
// can call this for themselves; the Super Admin may target any owner. Best-effort
// and local — a normal owner who has never paid can re-enter the trial (the system
// is explicitly local-first; durable enforcement needs the backend). Tier + length
// come from the catalog's trial plan (defaults: enterprise, 7 days).
async function startTrial(payload) {
  const input = (payload && typeof payload === 'object') ? payload : {};
  const me = await getActiveMember();
  const isSuper = Boolean(me && me.role === 'SUPER_ADMIN');
  if (isSuper && (input.ownerId == null || input.ownerId === '')) {
    throw new Error('Choose which owner workspace to start the trial for.');
  }
  if (!isSuper && me && me.role === 'SUPER_ADMIN') throw new Error('The source owner is exempt from the trial system.');
  const ownerId = (isSuper && input.ownerId != null && input.ownerId !== '') ? parseId(input.ownerId) : await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  const view = await licenseView(lic);
  if (!isSuper && view.isPaid) throw new Error('You are on a paid plan — the free trial does not apply.');
  const trialPlan = (await readBillingPlans()).find((p) => p.kind === 'trial' && p.active) || (await readBillingPlans()).find((p) => p.kind === 'trial');
  const days = trialPlan && trialPlan.trialDays ? trialPlan.trialDays : TRIAL_DAYS;
  const tier = trialPlan ? trialPlan.tier : 'enterprise';
  const updated = await getPrisma().license.update({
    where: { id: lic.id },
    data: { type: 'trial', status: 'active', tier, purchaseCode: null, trialEndsAt: new Date(Date.now() + days * 86400000) }
  });
  await syncOwnerBanState(ownerId, false);
  try { await logActivity(getPrisma(), null, 'trial-start', `Free trial started (${days}d)`); } catch (_) { /* best-effort */ }
  return licenseView(updated);
}

// Super-Admin: set a license's exact state — type (trial/paid), tier (pro/enterprise),
// expiry date and active flag — for precise edits beyond the quick actions.
async function editLicense(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const ownerId = parseId(input.ownerId);
  const lic = await ensureLicense(ownerId);
  const data = {};
  if (input.type !== undefined) { const t = String(input.type).toLowerCase(); if (t === 'trial' || t === 'paid') data.type = t; }
  if (input.tier !== undefined) data.tier = String(input.tier).toLowerCase() === 'enterprise' ? 'enterprise' : 'pro';
  if (input.endsAt !== undefined && input.endsAt !== null && input.endsAt !== '') {
    const d = new Date(input.endsAt);
    if (!Number.isNaN(d.getTime())) data.trialEndsAt = d;
  }
  if (input.status !== undefined) { const s = String(input.status).toLowerCase(); if (s === 'active' || s === 'expired') data.status = s; }
  if (Object.keys(data).length === 0) return licenseView(lic);
  const updated = await getPrisma().license.update({ where: { id: lic.id }, data });
  // licenseView reconciles the owner ban flag against the new expiry.
  return licenseView(updated);
}

// Super-Admin: terminate a subscription now — push the term past grace so the
// state machine reports it ended (profile launch locks). Reversible by a later
// grant. Clears any paid code. This is a clean lapse, not a sticky admin block.
async function terminateLicense(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const ownerId = parseId(input.ownerId);
  const lic = await ensureLicense(ownerId);
  const past = new Date(Date.now() - (GRACE_DAYS + 1) * 86400000);
  const updated = await getPrisma().license.update({ where: { id: lic.id }, data: { status: 'expired', trialEndsAt: past, purchaseCode: null } });
  try { await logActivity(getPrisma(), null, 'terminate', `Subscription terminated for owner #${ownerId}`); } catch (_) { /* best-effort */ }
  return licenseView(updated);
}

// Per-owner-tree license overview for the Super Admin console.
async function listOwnerLicenses() {
  await requireSuperAdmin();
  const db = getPrisma();
  const owners = await db.member.findMany({ where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' } });
  const out = [];
  for (const o of owners) {
    const lic = await ensureLicense(o.id);
    const view = await licenseView(lic);
    out.push({ ownerId: o.id, ownerName: o.name, ownerEmail: o.email || null, ownerStatus: o.status, banReason: o.banReason || null, joinedAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : o.createdAt, license: view });
  }
  return out;
}

// ---- Payment gateway (Cryptomus) — config is SUPER ADMIN only ----
async function requireSuperAdmin() {
  const m = await getActiveMember();
  if (!m || m.role !== 'SUPER_ADMIN') { const e = new Error('Only the Super Admin can manage payment settings.'); e.code = 'FORBIDDEN'; throw e; }
}

// (The Owner-or-above gate `requireOwnerOrSuper(action)` is defined once, earlier
// in this file, and reused by the developer-API, IP-provider, and monetization
// handlers below.)

// One-time, in-memory migration of the legacy single-Cryptomus config
// ({ provider, cryptomus:{...} }) into the per-provider map shape. The legacy
// plaintext API key is sealed on the way in (secretStore.open is fail-safe).
function migrateLegacyPayments(cfg, providers) {
  if (!cfg.providers && cfg.cryptomus && !providers.cryptomus) {
    providers.cryptomus = {
      enabled: Boolean(cfg.cryptomus.enabled),
      merchantId: cfg.cryptomus.merchantId || '',
      apiKey: secretStore.seal(cfg.cryptomus.apiKey || '')
    };
  }
}

// All saved provider configs (secrets stay sealed). Internal use only.
async function readPaymentStore() {
  const cfg = (await readSetting('payments', {})) || {};
  const providers = (cfg.providers && typeof cfg.providers === 'object') ? { ...cfg.providers } : {};
  migrateLegacyPayments(cfg, providers);
  return providers;
}

// A single provider's config with secrets DECRYPTED — for outbound API calls only.
async function openProviderConfig(id) {
  const def = payments.getProviderDef(id);
  if (!def) throw new Error('Unknown payment provider.');
  const store = await readPaymentStore();
  const saved = store[id] || {};
  const out = { enabled: Boolean(saved.enabled) };
  for (const f of def.fields) {
    const v = saved[f.key];
    out[f.key] = f.secret ? secretStore.open(v || '') : (v != null ? String(v) : (f.default || ''));
  }
  return out;
}

// True when every field a provider needs is present (env has a default).
function providerConfigured(def, saved) {
  return def.fields.every((f) => f.key === 'env' || Boolean(saved[f.key]));
}

async function getPaymentConfig() {
  await requireSuperAdmin();
  const store = await readPaymentStore();
  const providers = payments.PROVIDER_DEFS.map((def) => {
    const saved = store[def.id] || {};
    const fields = def.fields.map((f) => ({
      key: f.key,
      label: f.label,
      secret: Boolean(f.secret),
      type: f.type || 'text',
      options: f.options || null,
      placeholder: f.placeholder || '',
      // Secret values are NEVER returned — only whether one is stored.
      value: f.secret ? '' : (saved[f.key] != null ? String(saved[f.key]) : (f.default || '')),
      has: Boolean(saved[f.key])
    }));
    return { id: def.id, label: def.label, kind: def.kind, docsUrl: def.docsUrl || null, enabled: Boolean(saved.enabled), fields };
  });
  return { providers };
}

async function setPaymentConfig(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const def = payments.getProviderDef(String(input.id || '').trim());
  if (!def) throw new Error('Unknown payment provider.');
  const cfg = (await readSetting('payments', {})) || {};
  const providers = (cfg.providers && typeof cfg.providers === 'object') ? { ...cfg.providers } : {};
  migrateLegacyPayments(cfg, providers);
  const prev = providers[def.id] || {};
  const values = (input.values && typeof input.values === 'object') ? input.values : {};
  const next = { enabled: input.enabled !== undefined ? Boolean(input.enabled) : Boolean(prev.enabled) };
  for (const f of def.fields) {
    const incoming = values[f.key];
    if (f.secret) {
      // Blank → keep the stored sealed secret; non-blank → seal the new value.
      if (incoming !== undefined && incoming !== '') next[f.key] = secretStore.seal(String(incoming).trim());
      else if (prev[f.key]) next[f.key] = prev[f.key];
    } else {
      next[f.key] = incoming !== undefined ? String(incoming).trim() : (prev[f.key] != null ? prev[f.key] : (f.default || ''));
    }
  }
  providers[def.id] = next;
  // Fully migrated to the providers map — drop the legacy keys.
  const saved = { providers };
  await writeSetting('payments', saved);
  return getPaymentConfig();
}

async function validatePaymentConfig(payload) {
  await requireSuperAdmin();
  const id = String((payload && payload.id) || '').trim();
  const def = payments.getProviderDef(id);
  if (!def) throw new Error('Unknown payment provider.');
  if (def.kind === 'manual') return { ok: true, manual: true };
  const provider = payments.getProvider(id);
  if (!provider || !provider.validate) throw new Error('This provider cannot be validated.');
  const cfg = await openProviderConfig(id);
  return provider.validate(cfg);
}

// Enabled methods the buyer can choose at checkout (no secrets). Automated
// methods only appear once fully configured; manual ones carry their public
// instructions / pay link.
async function listPaymentMethods() {
  const store = await readPaymentStore();
  const methods = [];
  for (const def of payments.PROVIDER_DEFS) {
    const saved = store[def.id] || {};
    if (!saved.enabled) continue;
    if (def.kind === 'automated' && !providerConfigured(def, saved)) continue;
    const method = { id: def.id, label: def.label, kind: def.kind };
    if (def.kind === 'manual') {
      method.payLink = saved.payLink || '';
      method.instructions = saved.instructions || '';
    }
    methods.push(method);
  }
  return { methods };
}

// Resolve the automated provider for a checkout: the one requested, else the
// first enabled+configured automated provider. Secrets are decrypted here.
async function loadCheckoutProvider(id) {
  const store = await readPaymentStore();
  let chosenId = String(id || '').trim();
  if (!chosenId) {
    const firstAuto = payments.PROVIDER_DEFS.find((d) => d.kind === 'automated' && store[d.id] && store[d.id].enabled && providerConfigured(d, store[d.id]));
    chosenId = firstAuto ? firstAuto.id : '';
  }
  const def = payments.getProviderDef(chosenId);
  const saved = store[chosenId] || {};
  if (!def || !saved.enabled) throw new Error('That payment method is not available — the administrator has not enabled it.');
  if (def.kind !== 'automated') return { provider: null, cfg: null, def };
  if (!providerConfigured(def, saved)) throw new Error(`${def.label} is enabled but not fully configured.`);
  return { provider: payments.getProvider(chosenId), cfg: await openProviderConfig(chosenId), def };
}

async function startCheckout(payload) {
  await requirePurchaser('purchase a subscription');
  const input = (payload && typeof payload === 'object') ? payload : {};
  const plan = await findPlan(input.planId);
  const { provider, def } = await loadCheckoutProvider(input.provider);
  if (def.kind !== 'automated') throw new Error('That payment method is processed manually — submit your payment for approval instead.');
  const cfg = await openProviderConfig(def.id);
  const ownerId = await resolveLicenseOwnerId();
  const orderId = `sg-${ownerId || 'wks'}-${Date.now()}`;
  const invoice = await provider.createInvoice(cfg, { amount: plan.amount, currency: plan.currency, orderId, lifetime: 3600, productName: `SoftGlaze Browser — ${plan.name}` });
  // Stash the chosen plan + provider so pollCheckout grants the right term/tier.
  await writeSetting('pendingCheckout', { ownerId: ownerId ?? null, provider: def.id, orderId: invoice.orderId, uuid: invoice.uuid, planId: plan.id, tier: plan.tier, months: plan.months, createdAt: Date.now() });
  return { url: invoice.url, uuid: invoice.uuid, orderId: invoice.orderId, amount: invoice.amount, currency: invoice.currency, provider: def.id, planId: plan.id, planName: plan.name };
}

async function pollCheckout(payload) {
  await requirePurchaser('purchase a subscription');
  const input = requireObject(payload || {});
  const pending = (await readSetting('pendingCheckout', null)) || {};
  const { provider, def } = await loadCheckoutProvider(input.provider || pending.provider);
  if (def.kind !== 'automated' || !provider) return { status: 'manual', paid: false };
  const cfg = await openProviderConfig(def.id);
  const ref = input.uuid ? { uuid: input.uuid } : { orderId: requiredString(input.orderId, 'orderId') };
  const st = await provider.getStatus(cfg, ref);
  if (!st.paid) return { status: st.status, paid: false };

  // Recover the plan chosen at startCheckout (falls back to Pro for legacy orders).
  const plan = await findPlan(pending.planId);
  const months = Math.max(1, Number(pending.months) || plan.months || PLAN.months);
  const tier = pending.tier || plan.tier || 'pro';

  const ownerId = await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  const code = payments.generatePurchaseCode(months);
  const updated = await applyPaidMonths(lic, months, code, tier);
  await writeSetting('pendingCheckout', null).catch(() => {});
  await recordInvoice({ ownerId, provider: def.id, amount: plan.amount, currency: plan.currency, tier, months, reference: code, status: 'paid', source: 'auto' });
  try {
    const db = getPrisma();
    const owner = ownerId ? await db.member.findUnique({ where: { id: ownerId } }) : null;
    if (owner && owner.email) await deliverPurchaseCode(owner.email, owner.name, code);
  } catch (e) { /* email is best-effort */ }
  return { status: st.status, paid: true, license: await licenseView(updated), purchaseCode: code };
}

// ---- Manual payments (Wise / bank transfer / custom) ----------------------
// The buyer pays out-of-band and submits a reference; a Super Admin approves it
// in-app, which grants the term. Nothing is auto-trusted from the renderer.
async function submitManualPayment(payload) {
  const input = requireObject(payload);
  const def = payments.getProviderDef(String(input.provider || 'manual').trim());
  if (!def || def.kind !== 'manual') throw new Error('That is not a manual payment method.');
  const store = await readPaymentStore();
  if (!store[def.id] || !store[def.id].enabled) throw new Error('That manual payment method is not enabled.');
  const plan = await findPlan(input.planId);
  const ownerId = await resolveLicenseOwnerId();
  const entry = {
    id: `mp-${Date.now()}-${Math.floor(ownerId || 0)}`,
    ownerId: ownerId ?? null,
    provider: def.id,
    providerLabel: def.label,
    planId: plan.id,
    tier: plan.tier,
    months: plan.months,
    amount: plan.amount,
    currency: plan.currency,
    reference: optionalString(input.reference) || '',
    note: optionalString(input.note) || '',
    status: 'pending',
    at: new Date().toISOString()
  };
  const list = (await readSetting('manualPayments', [])) || [];
  await writeSetting('manualPayments', [entry, ...(Array.isArray(list) ? list : [])].slice(0, 200));
  return { submitted: true, id: entry.id };
}

async function listManualPayments() {
  await requireSuperAdmin();
  const list = (await readSetting('manualPayments', [])) || [];
  const db = getPrisma();
  const out = [];
  for (const e of (Array.isArray(list) ? list : [])) {
    let ownerName = null;
    try { const o = e.ownerId != null ? await db.member.findUnique({ where: { id: e.ownerId } }) : null; ownerName = o ? o.name : null; }
    catch (_) { /* owner may have been removed */ }
    out.push({ ...e, ownerName });
  }
  return out;
}

async function resolveManualPayment(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const id = requiredString(input.id, 'id');
  const action = String(input.action || '').toLowerCase();
  const list = (await readSetting('manualPayments', [])) || [];
  const arr = Array.isArray(list) ? [...list] : [];
  const idx = arr.findIndex((e) => e && e.id === id);
  if (idx < 0) throw new Error('Manual payment not found.');
  const entry = { ...arr[idx] };
  if (action === 'approve') {
    const lic = await ensureLicense(entry.ownerId ?? null);
    const months = Math.max(1, Number(entry.months) || 1);
    const code = payments.generatePurchaseCode(months);
    await applyPaidMonths(lic, months, code, entry.tier || 'pro');
    await recordInvoice({ ownerId: entry.ownerId ?? null, provider: entry.provider, amount: entry.amount, currency: entry.currency, tier: entry.tier || 'pro', months, reference: code, note: entry.reference || null, status: 'paid', source: 'auto' });
    entry.status = 'approved';
    entry.purchaseCode = code;
    entry.resolvedAt = new Date().toISOString();
    try {
      const db = getPrisma();
      const owner = entry.ownerId != null ? await db.member.findUnique({ where: { id: entry.ownerId } }) : null;
      if (owner && owner.email) await deliverPurchaseCode(owner.email, owner.name, code);
    } catch (_) { /* email is best-effort */ }
  } else if (action === 'reject') {
    entry.status = 'rejected';
    entry.resolvedAt = new Date().toISOString();
  } else {
    throw new Error('Action must be approve or reject.');
  }
  arr[idx] = entry;
  await writeSetting('manualPayments', arr);
  return { ok: true, status: entry.status };
}

// ---- Invoices ----------------------------------------------------------------
// Receipts for subscription payments: auto-captured on a successful checkout /
// manual approval, plus manual entries by the Super Admin. Owners see their own
// tree's invoices read-only; the Super Admin manages all.
function serializeInvoice(inv) {
  return {
    id: inv.id,
    ownerMemberId: inv.ownerMemberId ?? null,
    memberId: inv.memberId ?? null,
    amount: inv.amount || '0',
    currency: inv.currency || 'USD',
    provider: inv.provider || null,
    status: inv.status || 'paid',
    reference: inv.reference || null,
    tier: inv.tier || null,
    months: inv.months ?? null,
    note: inv.note || null,
    source: inv.source || 'manual',
    issuedAt: inv.issuedAt instanceof Date ? inv.issuedAt.toISOString() : (inv.issuedAt || null),
    paidAt: inv.paidAt instanceof Date ? inv.paidAt.toISOString() : (inv.paidAt || null),
    createdAt: inv.createdAt instanceof Date ? inv.createdAt.toISOString() : (inv.createdAt || null)
  };
}

// Auto-capture — best-effort; never blocks or fails a payment.
async function recordInvoice(data) {
  try {
    const status = data.status || 'paid';
    await getPrisma().invoice.create({
      data: {
        ownerMemberId: data.ownerId ?? null,
        memberId: data.memberId ?? null,
        amount: String(data.amount ?? '0'),
        currency: data.currency || 'USD',
        provider: data.provider || null,
        status,
        reference: data.reference || null,
        tier: data.tier || null,
        months: data.months != null ? Number(data.months) : null,
        note: data.note || null,
        source: data.source || 'auto',
        paidAt: status === 'paid' ? new Date() : null
      }
    });
  } catch (e) { /* invoice is best-effort */ }
}

async function listInvoices(payload) {
  const input = (payload && typeof payload === 'object') ? payload : {};
  const db = getPrisma();
  const me = await getActiveMember();
  const isSuper = Boolean(me && me.role === 'SUPER_ADMIN');
  let where = {};
  if (isSuper) {
    if (input.ownerId != null && input.ownerId !== '') where = { ownerMemberId: parseId(input.ownerId) };
  } else {
    const ownerId = await resolveLicenseOwnerId();
    where = { ownerMemberId: ownerId == null ? -1 : ownerId };
  }
  const rows = await db.invoice.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 });

  // Decorate with the owner's name (super-admin view spans owners).
  let owners = {};
  try {
    const ids = [...new Set(rows.map((r) => r.ownerMemberId).filter((x) => x != null))];
    if (ids.length) {
      const members = await db.member.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      owners = Object.fromEntries(members.map((m) => [m.id, m.name]));
    }
  } catch (e) { /* best-effort */ }

  return {
    invoices: rows.map((r) => ({ ...serializeInvoice(r), ownerName: r.ownerMemberId != null ? (owners[r.ownerMemberId] || null) : null })),
    canEdit: isSuper
  };
}

const INVOICE_STATUSES = new Set(['paid', 'pending', 'refunded']);

async function createInvoice(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const status = INVOICE_STATUSES.has(String(input.status)) ? String(input.status) : 'paid';
  const created = await getPrisma().invoice.create({
    data: {
      ownerMemberId: (input.ownerId != null && input.ownerId !== '') ? parseId(input.ownerId) : null,
      amount: String(input.amount ?? '0'),
      currency: optionalString(input.currency) || 'USD',
      provider: optionalString(input.provider) || 'manual',
      status,
      reference: optionalString(input.reference) || null,
      tier: optionalString(input.tier) || null,
      months: input.months != null && input.months !== '' ? Math.max(1, Number(input.months) || 1) : null,
      note: optionalString(input.note) || null,
      source: 'manual',
      paidAt: status === 'paid' ? new Date() : null
    }
  });
  return serializeInvoice(created);
}

async function updateInvoice(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const id = parseId(input.id);
  const data = {};
  if (input.ownerId !== undefined) data.ownerMemberId = (input.ownerId != null && input.ownerId !== '') ? parseId(input.ownerId) : null;
  if (input.amount !== undefined) data.amount = String(input.amount);
  if (input.currency !== undefined) data.currency = optionalString(input.currency) || 'USD';
  if (input.provider !== undefined) data.provider = optionalString(input.provider);
  if (input.reference !== undefined) data.reference = optionalString(input.reference);
  if (input.tier !== undefined) data.tier = optionalString(input.tier);
  if (input.note !== undefined) data.note = optionalString(input.note);
  if (input.months !== undefined) data.months = (input.months != null && input.months !== '') ? Math.max(1, Number(input.months) || 1) : null;
  if (input.status !== undefined && INVOICE_STATUSES.has(String(input.status))) {
    data.status = String(input.status);
    data.paidAt = data.status === 'paid' ? new Date() : null;
  }
  const updated = await getPrisma().invoice.update({ where: { id }, data });
  return serializeInvoice(updated);
}

async function deleteInvoice(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const id = parseId(input.id);
  await getPrisma().invoice.delete({ where: { id } });
  return { deleted: true, id };
}

async function deliverPurchaseCode(email, name, code) {
  const cfg = await resolveSmtpConfig();
  if (!cfg.configured) return false;
  const transporter = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass } });
  try {
    await transporter.sendMail({
      from: `"${cfg.fromName}" <${cfg.user}>`,
      to: email,
      subject: 'Your SoftGlaze Browser purchase code',
      text: `Hi ${name}, thanks for your payment. Your purchase code is: ${code}. It activates 1 month — enter it under Settings -> Subscription.`,
      html: `<div style="font-family:sans-serif;max-width:28rem;margin:0 auto;"><h2>Payment received</h2><p>Hi ${name}, thanks for your payment.</p><p>Your purchase code:</p><h1 style="background:#f4f4f5;padding:10px;text-align:center;letter-spacing:3px;">${code}</h1><p style="font-size:12px;color:#666;">Activates 1 month. Enter it under Settings &rarr; Subscription.</p></div>`
    });
    return true;
  } catch (e) { console.error('[Purchase code email]', e); return false; }
}

// ---------------------------------------------------------------------------
// IP provider integrations (Super Admin only). Master credentials for the proxy
// vendors we resell. Keys are stored locally and NEVER returned to the renderer
// in full — only a masked preview.
// ---------------------------------------------------------------------------
const DEFAULT_IP_PROVIDERS = [
  { name: 'Bright Data', referralLink: 'https://brightdata.com/cp/api_example' },
  { name: 'Oxylabs', referralLink: 'https://dashboard.oxylabs.io/' },
  { name: 'Smartproxy', referralLink: 'https://dashboard.smartproxy.com/' },
  { name: 'IPRoyal', referralLink: 'https://dashboard.iproyal.com/' },
  { name: 'Webshare', referralLink: 'https://dashboard.webshare.io/userapi/keys' },
  { name: 'Asocks', referralLink: 'https://asocks.com/' }
];

// Seed the 6 default providers (idempotent). Existing rows keep their creds/
// status; only a missing referralLink is backfilled.
async function ensureIpProviders(db) {
  for (const def of DEFAULT_IP_PROVIDERS) {
    const existing = await db.ipProvider.findUnique({ where: { name: def.name } });
    if (!existing) {
      await db.ipProvider.create({ data: { name: def.name, referralLink: def.referralLink, status: 'DISABLED' } });
    } else if (!existing.referralLink && def.referralLink) {
      await db.ipProvider.update({ where: { id: existing.id }, data: { referralLink: def.referralLink } }).catch(() => {});
    }
  }
}

// Partial mask: keep a short prefix, hide the rest (e.g. "sk-••••••••").
function maskSecret(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 4) return '••••';
  return `${s.slice(0, 3)}••••••••${s.slice(-2)}`;
}

function serializeIpProvider(p) {
  return {
    id: p.id,
    name: p.name,
    status: p.status === 'ENABLED' ? 'ENABLED' : 'DISABLED',
    referralLink: p.referralLink || null,
    hasApiKey: Boolean(p.apiKey),
    apiKeyMasked: maskSecret(p.apiKey),
    hasSecretKey: Boolean(p.secretKey),
    secretKeyMasked: maskSecret(p.secretKey),
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : (p.updatedAt || null)
  };
}

async function getIpProviders() {
  await requireSuperAdmin();
  const db = getPrisma();
  await ensureIpProviders(db);
  const rows = await db.ipProvider.findMany({ orderBy: { id: 'asc' } });
  return { providers: rows.map(serializeIpProvider) };
}

async function updateIpProviderCredentials(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const id = parseId(input.id);
  const db = getPrisma();
  const provider = await db.ipProvider.findUnique({ where: { id } });
  if (!provider) throw new Error('Provider not found.');
  const data = {};
  // Blank/undefined keeps the stored value (the renderer only ever sees a mask).
  if (input.apiKey !== undefined && String(input.apiKey).trim() !== '') data.apiKey = String(input.apiKey).trim();
  if (input.secretKey !== undefined && String(input.secretKey).trim() !== '') data.secretKey = String(input.secretKey).trim();
  // Allow explicit clearing.
  if (input.apiKey === null || input.apiKey === '') data.apiKey = null;
  if (input.secretKey === null || input.secretKey === '') data.secretKey = null;
  const updated = await db.ipProvider.update({ where: { id }, data });
  return serializeIpProvider(updated);
}

async function toggleIpProviderStatus(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const id = parseId(input.id);
  const db = getPrisma();
  const provider = await db.ipProvider.findUnique({ where: { id } });
  if (!provider) throw new Error('Provider not found.');
  let status;
  if (input.status !== undefined) status = String(input.status).toUpperCase() === 'ENABLED' ? 'ENABLED' : 'DISABLED';
  else status = provider.status === 'ENABLED' ? 'DISABLED' : 'ENABLED';
  const updated = await db.ipProvider.update({ where: { id }, data: { status } });
  return serializeIpProvider(updated);
}

// ---------------------------------------------------------------------------
// Softglaze Pro — No-Code Macro Automation
// ---------------------------------------------------------------------------
function serializeMacro(m) {
  let steps = [];
  try { steps = JSON.parse(m.stepsJson || '[]'); } catch (e) { steps = []; }
  return {
    id: m.id,
    name: m.name,
    description: m.description || '',
    steps: Array.isArray(steps) ? steps : [],
    stepCount: Array.isArray(steps) ? steps.length : 0,
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : (m.createdAt || null),
    updatedAt: m.updatedAt instanceof Date ? m.updatedAt.toISOString() : (m.updatedAt || null)
  };
}

async function getMacros() {
  const db = getPrisma();
  const rows = await db.macro.findMany({ orderBy: { updatedAt: 'desc' } });
  return rows.map(serializeMacro);
}

async function saveMacro(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const name = requiredString(input.name, 'Macro name');
  const description = optionalString(input.description);
  let steps = input.steps !== undefined ? input.steps : [];
  if (typeof steps === 'string') { try { steps = JSON.parse(steps); } catch (e) { steps = []; } }
  const stepsJson = JSON.stringify(Array.isArray(steps) ? steps : []);
  if (input.id) {
    const id = parseId(input.id);
    const updated = await db.macro.update({ where: { id }, data: { name, description, stepsJson } });
    return serializeMacro(updated);
  }
  const created = await db.macro.create({ data: { name, description, stepsJson } });
  return serializeMacro(created);
}

async function deleteMacro(payload) {
  const id = parseId(requireObject(payload).id);
  await getPrisma().macro.delete({ where: { id } }).catch(() => {});
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Softglaze Pro — AI Cookie Warmer
//
// Genuinely warms a profile by launching it and visiting a rotation of popular
// sites for the requested duration, so real cookies/history accumulate. Runs in
// the background (the IPC call returns immediately) and streams per-profile
// progress to the renderer. Never blocks or crashes the main process.
// ---------------------------------------------------------------------------
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const WARM_SITES = [
  { label: 'google.com', url: 'https://www.google.com/' },
  { label: 'youtube.com', url: 'https://www.youtube.com/' },
  { label: 'amazon.com', url: 'https://www.amazon.com/' },
  { label: 'wikipedia.org', url: 'https://www.wikipedia.org/' },
  { label: 'reddit.com', url: 'https://www.reddit.com/' },
  { label: 'bing.com', url: 'https://www.bing.com/' },
  { label: 'cnn.com', url: 'https://www.cnn.com/' },
  { label: 'ebay.com', url: 'https://www.ebay.com/' },
  { label: 'linkedin.com', url: 'https://www.linkedin.com/' },
  { label: 'weather.com', url: 'https://weather.com/' }
];

async function appendWarmerHistory(entry) {
  const list = (await readSetting('automationHistory', [])) || [];
  const arr = Array.isArray(list) ? list : [];
  // Upsert by runId. A run records once on start (status 'running') and again on
  // finish (status 'completed'/'stopped'); merge those into ONE row (moved to the
  // top) instead of appending a duplicate — which also produced duplicate React
  // keys in the history table.
  if (entry && entry.runId) {
    const idx = arr.findIndex((e) => e && e.runId === entry.runId);
    if (idx >= 0) {
      const merged = { ...arr[idx], ...entry };
      const next = [merged, ...arr.slice(0, idx), ...arr.slice(idx + 1)].slice(0, 50);
      await writeSetting('automationHistory', next).catch(() => {});
      return;
    }
  }
  const next = [entry, ...arr].slice(0, 50);
  await writeSetting('automationHistory', next).catch(() => {});
}

async function getAutomationHistory() {
  const list = (await readSetting('automationHistory', [])) || [];
  return Array.isArray(list) ? list : [];
}

// Wrapper that runs the full launch pipeline (Firefox routing, proxy rotation,
// global settings) for a given profile id. Shared by the local REST API and the
// warmer so neither duplicates launch logic.
async function launchProfileById(id, startUrl) {
  return launchProfile({ id: parseId(id), startUrl: startUrl || 'about:blank' });
}

// ---------------------------------------------------------------------------
// Softglaze Pro — Macro runner, visual recorder & scheduler.
//
// The execution + capture primitives live in browserEngine (runMacro /
// startMacroRecording / stopMacroRecording) because they need the live session
// page. These handlers add session management, persistence (reusing the Macro
// model + automationHistory) and a setInterval scheduler mirroring the proxy
// health-sweep timer pattern.
// ---------------------------------------------------------------------------

// Return the sessionId for a profile, launching it first if it isn't open.
async function ensureProfileSession(profileId) {
  const pid = String(profileId);
  const open = listActiveSessions().find((s) => String(s.sessionId) === pid);
  if (open) return String(open.sessionId);
  const res = await launchProfileById(profileId, 'about:blank');
  return res && res.sessionId ? String(res.sessionId) : pid;
}

// Active macro runs, keyed by runId, so a run can be paused / resumed / stopped.
const macroRuns = new Map();

async function runMacroOnProfile(payload, event) {
  const input = requireObject(payload);
  const macroId = parseId(input.macroId);
  const profileId = parseId(input.profileId);
  const db = getPrisma();
  const macro = await db.macro.findUnique({ where: { id: macroId } });
  if (!macro) throw new Error('Macro not found.');
  let steps = [];
  try { steps = JSON.parse(macro.stepsJson || '[]'); } catch (e) { steps = []; }
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('This macro has no steps to run yet.');

  const sessionId = await ensureProfileSession(profileId);
  const runId = `macro-${Date.now()}`;
  const control = { paused: false, aborted: false };
  macroRuns.set(runId, control);

  // Live progress stream (mirrors the warmer-progress pattern). The scheduler runs
  // without an event, so streaming is a no-op there.
  const sender = event && event.sender ? event.sender : null;
  const send = (data) => { if (sender) { try { sender.send(CHANNELS.AUTOMATION_MACRO_PROGRESS, data); } catch (e) { /* renderer gone */ } } };
  send({ runId, kind: 'start', macroId, profileId, name: macro.name, total: steps.length, ts: Date.now() });
  const onStep = (ev) => send({ runId, kind: 'step', ...ev, ts: Date.now() });

  let result;
  try {
    result = await runMacro(sessionId, steps, { continueOnError: Boolean(input.continueOnError), control, onStep });
  } finally {
    macroRuns.delete(runId);
  }

  send({ runId, kind: 'done', ok: result.ok, ran: result.ran, total: result.total, aborted: result.aborted, ts: Date.now() });
  const level = result.aborted ? 'WARN' : (result.ok ? 'SUCCESS' : 'WARN');
  const tail = result.aborted ? ' · stopped' : (result.ok ? '' : ' · stopped on error');
  await appendWarmerHistory({
    type: 'macro', label: macro.name, profileId, at: new Date().toISOString(),
    level, detail: `${macro.name}: ran ${result.ran}/${result.total} steps${tail}`
  }).catch(() => {});
  await logActivity(db, profileId, 'macro-run', `${macro.name} (${result.ran}/${result.total})`).catch(() => {});
  return { ...result, sessionId, runId };
}

// Pause / resume / stop a running macro by runId.
async function controlMacro(payload) {
  const input = requireObject(payload);
  const runId = String(input.runId || '');
  const action = String(input.action || '').toLowerCase();
  const control = macroRuns.get(runId);
  if (!control) return { ok: false, reason: 'not-running' };
  if (action === 'pause') control.paused = true;
  else if (action === 'resume') control.paused = false;
  else if (action === 'stop') { control.aborted = true; control.paused = false; }
  else throw new Error('Action must be pause, resume or stop.');
  return { ok: true, action };
}

async function startMacroRecordingOnProfile(payload) {
  const input = requireObject(payload);
  const profileId = parseId(input.profileId);
  const sessionId = await ensureProfileSession(profileId);
  const res = await startMacroRecording(sessionId);
  return { ...res, sessionId, profileId };
}

async function stopMacroRecordingOnProfile(payload) {
  const input = requireObject(payload);
  const profileId = parseId(input.profileId);
  const sessionId = String(input.sessionId || profileId);
  const res = await stopMacroRecording(sessionId);
  const steps = Array.isArray(res.steps) ? res.steps : [];
  // Optionally persist the captured steps straight into a new macro.
  const name = optionalString(input.saveAs);
  let saved = null;
  if (name) {
    const created = await getPrisma().macro.create({
      data: { name, description: optionalString(input.description) || 'Recorded macro', stepsJson: JSON.stringify(steps) }
    });
    saved = serializeMacro(created);
  }
  return { steps, count: steps.length, saved };
}

// --- Macro scheduler (mirrors the proxy health-sweep timer) ----------------
let macroSchedulerTimer = null;

async function runDueMacroSchedule() {
  const cfg = await readSetting('macroSchedule', null);
  if (!cfg || !cfg.enabled || !cfg.macroId || !Array.isArray(cfg.profileIds) || cfg.profileIds.length === 0) return;
  for (const pid of cfg.profileIds) {
    try {
      await runMacroOnProfile({ macroId: cfg.macroId, profileId: pid, continueOnError: true });
    } catch (e) {
      await appendWarmerHistory({
        type: 'macro', profileId: pid, at: new Date().toISOString(),
        level: 'ERROR', detail: `Scheduled macro failed: ${(e && e.message) || 'error'}`
      }).catch(() => {});
    }
  }
}

function stopMacroScheduler() {
  if (macroSchedulerTimer) { clearInterval(macroSchedulerTimer); macroSchedulerTimer = null; }
}

function startMacroScheduler(minutes) {
  stopMacroScheduler();
  const ms = Math.max(1, Number(minutes) || 60) * 60000;
  macroSchedulerTimer = setInterval(() => { runDueMacroSchedule().catch(() => {}); }, ms);
  if (macroSchedulerTimer.unref) macroSchedulerTimer.unref();
}

async function getMacroSchedule() {
  const cfg = (await readSetting('macroSchedule', null)) || {};
  return {
    enabled: Boolean(cfg.enabled),
    macroId: cfg.macroId || null,
    everyMinutes: Number(cfg.everyMinutes) || 60,
    profileIds: Array.isArray(cfg.profileIds) ? cfg.profileIds : [],
    running: Boolean(macroSchedulerTimer)
  };
}

async function setMacroSchedule(payload) {
  const input = requireObject(payload);
  const enabled = Boolean(input.enabled);
  const everyMinutes = Math.max(1, Number.parseInt(input.everyMinutes, 10) || 60);
  const macroId = input.macroId != null && input.macroId !== '' ? parseId(input.macroId) : null;
  const profileIds = Array.isArray(input.profileIds)
    ? input.profileIds.map((x) => parseId(x)).filter((n) => Number.isInteger(n))
    : [];
  if (enabled && (!macroId || profileIds.length === 0)) {
    throw new Error('Choose a macro and at least one profile before enabling the schedule.');
  }
  const cfg = { enabled, macroId, everyMinutes, profileIds };
  await writeSetting('macroSchedule', cfg);
  if (enabled) startMacroScheduler(everyMinutes); else stopMacroScheduler();
  return { ...cfg, running: Boolean(macroSchedulerTimer) };
}

// ---------------------------------------------------------------------------
// Softglaze Enterprise — Parallel macro runner + live (redacted) run console.
//
// Runs one macro across many profiles with a concurrency cap and streams a live,
// per-profile status to the renderer. The orchestration + redaction live in the
// pure `parallelRunner` module; here we inject the real launch / run / close
// primitives and bridge the relay's sanitized frames to a progress channel
// (mirroring the AI-warmer's warmer-progress stream). Optionally each profile is
// bound to one spreadsheet row (data-driven) via {{Header}} placeholders.
// ---------------------------------------------------------------------------

// Parsed data-binding sheets, keyed by an opaque token (mirrors importPreviewCache).
const dataRowsCache = new Map();

async function pickDataFile() {
  const selection = await dialog.showOpenDialog({
    title: 'Select a spreadsheet to bind to this parallel run',
    properties: ['openFile'],
    filters: [{ name: 'Spreadsheet files', extensions: ['xlsx', 'xls', 'csv'] }]
  });
  if (selection.canceled || selection.filePaths.length === 0) return { cancelled: true };

  const filePath = selection.filePaths[0];
  const extension = path.extname(filePath).toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(extension)) throw new Error('Unsupported data file type.');

  const parsed = parseDataRows(filePath);
  const token = crypto.randomUUID();
  dataRowsCache.set(token, { createdAt: Date.now(), rows: parsed.rows });
  // Keep the cache small — drop the oldest entry once we exceed a handful.
  if (dataRowsCache.size > 20) {
    let oldestKey = null; let oldestAt = Infinity;
    for (const [k, v] of dataRowsCache) { if (v.createdAt < oldestAt) { oldestAt = v.createdAt; oldestKey = k; } }
    if (oldestKey) dataRowsCache.delete(oldestKey);
  }

  // Return only structure (headers + count) to the renderer — never the cell
  // values, so a bound sheet of credentials isn't surfaced unnecessarily.
  return { cancelled: false, token, fileName: parsed.fileName, headers: parsed.headers, rowCount: parsed.rows.length };
}

async function runParallelMacroHandler(payload, event) {
  const input = requireObject(payload);
  const macroId = parseId(input.macroId);
  const profileIds = parseIdArray(input.profileIds);
  if (profileIds.length === 0) throw new Error('Select at least one profile for the parallel run.');
  const concurrency = Math.max(1, Math.min(10, Number.parseInt(input.concurrency, 10) || 3));
  const continueOnError = input.continueOnError !== false;
  const closeWhenDone = input.closeWhenDone !== false;

  const db = getPrisma();
  const macro = await db.macro.findUnique({ where: { id: macroId } });
  if (!macro) throw new Error('Macro not found.');
  let steps = [];
  try { steps = JSON.parse(macro.stepsJson || '[]'); } catch (e) { steps = []; }
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('This macro has no steps to run yet.');

  // Optional data binding: row i -> the i-th selected profile (order-based).
  let rows = [];
  if (input.dataToken) {
    const cached = dataRowsCache.get(String(input.dataToken));
    if (cached && Array.isArray(cached.rows)) rows = cached.rows;
  }

  const profiles = await db.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, title: true } });
  const nameById = new Map(profiles.map((p) => [p.id, p.title || `Profile ${p.id}`]));
  const items = profileIds.map((pid, i) => ({
    profileId: pid,
    profileName: nameById.get(pid) || `Profile ${pid}`,
    vars: rows[i] || null
  }));

  const runId = `par-${Date.now()}`;

  // Bridge sanitized relay frames for THIS run to the renderer. One global
  // listener, filtered by runId, that removes itself on the run-level 'done'
  // frame (with a finally backstop below). relay.emitFrame already routes every
  // payload through sanitizeFrame before it reaches us.
  relay.setMaxListeners(0);
  const onFrame = (frame) => {
    if (!frame || !frame.payload || frame.payload.runId !== runId) return;
    try { event.sender.send(CHANNELS.AUTOMATION_RUN_PROGRESS, frame); } catch (e) { /* renderer gone */ }
    if (frame.payload.state === 'done') { try { relay.off('frame', onFrame); } catch (e) { /* ignore */ } }
  };
  relay.on('frame', onFrame);

  const deps = {
    isOpen: (pid) => listActiveSessions().some((s) => String(s.sessionId) === String(pid)),
    launch: (pid) => launchProfileById(pid, 'about:blank'),
    runMacro: (sid, s, opts) => runMacro(sid, s, opts),
    close: (sid) => closeProfileSession(String(sid)),
    emit: (key, type, p) => relay.emitFrame(key, type, p)
  };

  // Fire-and-forget — the handler returns immediately; progress arrives via the
  // stream above (the warmer pattern).
  (async () => {
    let summary = null;
    try {
      summary = await runParallelMacro({ runId, items, steps, concurrency, continueOnError, closeWhenDone }, deps);
    } catch (e) {
      // Guarantee a terminator so the renderer never hangs on "running".
      try {
        relay.emitFrame(runId, 'status', {
          runId, state: 'done', total: items.length, passed: 0, failed: items.length,
          error: (e && e.message) ? e.message : 'Parallel run failed.'
        });
      } catch (_) { /* ignore */ }
    } finally {
      try { relay.off('frame', onFrame); } catch (_) { /* ignore */ }
    }
    const s = summary || { total: items.length, passed: 0, failed: items.length };
    const level = s.failed === 0 ? 'SUCCESS' : (s.passed === 0 ? 'ERROR' : 'WARN');
    await appendWarmerHistory({
      type: 'parallel',
      label: macro.name,
      runId,
      profileIds,
      at: new Date().toISOString(),
      level,
      detail: `${macro.name}: ${s.passed}/${s.total} profile(s) passed${rows.length ? ` · data-bound (${rows.length} row${rows.length === 1 ? '' : 's'})` : ''}`
    }).catch(() => {});
    await logActivity(db, profileIds[0], 'parallel-run', `${macro.name} (${s.passed}/${s.total})`).catch(() => {});
  })();

  return { started: true, runId, profileIds, concurrency, dataRows: rows.length };
}

// Active warm-up runs, keyed by runId, so a run can be stopped or force-stopped
// mid-flight. Each run tracks the sessions it launched (closed on force-stop).
const warmerRuns = new Map();
const WARM_CLICK_MODES = new Set(['none', 'random', 'links']);

// Validate + normalise a user-supplied site list. Each entry → { url, label,
// seconds, clickMode, scroll, clicks }. Invalid rows are dropped.
function normalizeWarmSites(value) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  for (const raw of arr) {
    if (!raw) continue;
    const url = String(raw.url || '').trim();
    if (!url) continue;
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    let label = String(raw.label || '').trim();
    if (!label) { try { label = new URL(full).hostname.replace(/^www\./, ''); } catch (e) { label = full; } }
    out.push({
      url: full,
      label,
      seconds: Math.max(3, Math.min(600, Number.parseInt(raw.seconds, 10) || 30)),
      clickMode: WARM_CLICK_MODES.has(String(raw.clickMode)) ? String(raw.clickMode) : 'none',
      scroll: raw.scroll !== false,
      clicks: Math.max(1, Math.min(6, Number.parseInt(raw.clicks, 10) || 2))
    });
  }
  return out;
}

function defaultWarmSites() {
  return WARM_SITES.map((s) => ({ url: s.url, label: s.label, seconds: 30, clickMode: 'none', scroll: true, clicks: 2 }));
}

// Sleep that returns early (true) when shouldAbort() flips — lets a long dwell be
// interrupted promptly by Stop / Force-stop.
async function interruptibleSleep(ms, shouldAbort) {
  let elapsed = 0;
  while (elapsed < ms) {
    if (shouldAbort && shouldAbort()) return true;
    const chunk = Math.min(500, ms - elapsed);
    await sleepMs(chunk);
    elapsed += chunk;
  }
  return Boolean(shouldAbort && shouldAbort());
}

async function warmOneProfile(profileId, sites, opts, emit, run) {
  // Reuse an already-open session if the profile is running; otherwise launch.
  let sessionId = String(profileId);
  const alreadyOpen = listActiveSessions().some((s) => String(s.sessionId) === sessionId);
  if (alreadyOpen) {
    emit(profileId, 'INFO', 'Using the already-open session.');
  } else {
    emit(profileId, 'INFO', 'Launching profile for warm-up…');
    const res = await launchProfileById(profileId, 'about:blank');
    sessionId = res && res.sessionId ? String(res.sessionId) : sessionId;
    if (run) run.launched.add(sessionId);
    emit(profileId, 'SUCCESS', `Session ${sessionId} started.`);
  }
  if (run) run.sessions.add(sessionId);

  const aborted = () => Boolean(run && run.aborted);
  const rounds = opts.loop ? 1000 : 1; // "loop" repeats until stopped (safety cap)
  outer:
  for (let r = 0; r < rounds; r++) {
    for (const site of sites) {
      if (aborted()) break outer;
      const tag = site.clickMode === 'random' ? ' · random clicks' : site.clickMode === 'links' ? ' · browse links' : '';
      emit(profileId, 'INFO', `Visiting ${site.label} (${site.seconds}s${tag})…`);
      const ok = await navigateSession(sessionId, site.url, { timeout: 30000 });
      if (!ok) { emit(profileId, 'WARN', `Could not load ${site.label} (skipped)`); continue; }
      emit(profileId, 'SUCCESS', `Loaded ${site.label}`);
      try {
        const inter = await warmInteract(sessionId, { clickMode: site.clickMode, clicks: site.clicks, scroll: site.scroll });
        if (inter && inter.clicked) emit(profileId, 'INFO', `Interacted — ${inter.clicked} click(s) on ${site.label}`);
      } catch (e) { /* best-effort */ }
      if (await interruptibleSleep(site.seconds * 1000, aborted)) break outer;
    }
    if (opts.loop && !aborted()) emit(profileId, 'INFO', 'Looping the site list again…');
  }

  // Cookie report — cookies + cache persist in the profile's data dir regardless.
  let cookieCount = null;
  try { const cookies = await exportSessionCookies(sessionId); cookieCount = Array.isArray(cookies) ? cookies.length : null; }
  catch (e) { /* ignore */ }
  const tail = cookieCount != null ? ` · ${cookieCount} cookies saved` : '';
  emit(profileId, aborted() ? 'WARN' : 'SUCCESS', `${aborted() ? 'Warm-up stopped' : 'Warm-up complete'}${tail}.`);

  // Close only sessions we launched, unless the user chose to keep them open.
  if (!opts.keepOpen && run && run.launched.has(sessionId)) {
    await closeProfileSession(sessionId).catch(() => {});
  }
  return { sessionId, cookieCount };
}

async function startWarmer(payload, event) {
  const input = requireObject(payload);
  const ids = parseIdArray(input.profileIds);
  if (!ids.length) throw new Error('Select at least one profile to warm up.');
  let sites = normalizeWarmSites(input.sites);
  if (!sites.length) sites = defaultWarmSites();
  const opts = { loop: Boolean(input.loop), keepOpen: Boolean(input.keepOpen) };
  const runId = `warm-${Date.now()}`;
  const run = { id: runId, aborted: false, launched: new Set(), sessions: new Set(), send: null };
  warmerRuns.set(runId, run);

  const send = (data) => { try { event.sender.send(CHANNELS.AUTOMATION_WARMER_PROGRESS, data); } catch (e) { /* renderer gone */ } };
  run.send = send;
  const emit = (profileId, level, message) => send({ runId, profileId, level, message, ts: Date.now() });

  send({ runId, level: 'INFO', message: `Starting warm-up · ${ids.length} profile(s) · ${sites.length} site(s)${opts.loop ? ' · looping until stopped' : ''}.`, ts: Date.now() });
  await appendWarmerHistory({ type: 'warmer', runId, profileIds: ids, sites: sites.length, status: 'running', startedAt: Date.now() }).catch(() => {});

  // Fire-and-forget: warm every selected profile concurrently. The handler
  // returns immediately; progress arrives via the stream above.
  (async () => {
    await Promise.allSettled(ids.map((id) =>
      warmOneProfile(id, sites, opts, emit, run).catch((e) => emit(id, 'ERROR', e && e.message ? e.message : 'Warm-up failed.'))
    ));
    const stopped = run.aborted;
    send({ runId, level: stopped ? 'WARN' : 'SUCCESS', message: stopped ? 'Warm-up stopped.' : 'All warm-up tasks finished.', done: true, ts: Date.now() });
    await appendWarmerHistory({ type: 'warmer', runId, profileIds: ids, sites: sites.length, status: stopped ? 'stopped' : 'completed', finishedAt: Date.now() }).catch(() => {});
    warmerRuns.delete(runId);
  })();

  return { started: true, runId, profileIds: ids, sites: sites.length, loop: opts.loop };
}

// Stop a running warm-up. `force` also closes the sessions this run launched.
// With no runId, stops every active run.
async function stopWarmer(payload) {
  const input = (payload && typeof payload === 'object') ? payload : {};
  const force = Boolean(input.force);
  const runId = input.runId ? String(input.runId) : null;
  const targets = runId ? (warmerRuns.has(runId) ? [warmerRuns.get(runId)] : []) : [...warmerRuns.values()];
  if (!targets.length) return { stopped: false };
  for (const run of targets) {
    run.aborted = true;
    if (run.send) { try { run.send({ runId: run.id, level: 'WARN', message: force ? 'Force-stopping — closing sessions…' : 'Stopping after the current step…', ts: Date.now() }); } catch (e) { /* renderer gone */ } }
    if (force) {
      for (const sid of run.launched) await closeProfileSession(sid).catch(() => {});
    }
  }
  return { stopped: true, force, runs: targets.length };
}

// ---------------------------------------------------------------------------
// Softglaze Pro — Local Developer API tokens + server toggle
// ---------------------------------------------------------------------------
function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function serializeApiToken(t) {
  return {
    id: t.id,
    name: t.name,
    // The plaintext token is shown only at creation; later we can only show a
    // generic mask since just the hash is stored.
    preview: 'sg_••••••••••••',
    lastUsedAt: t.lastUsedAt instanceof Date ? t.lastUsedAt.toISOString() : (t.lastUsedAt || null),
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : (t.createdAt || null)
  };
}

async function listApiTokens() {
  await requireOwnerOrSuper();
  const rows = await getPrisma().apiToken.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map(serializeApiToken);
}

async function createApiToken(payload) {
  await requireOwnerOrSuper();
  const input = requireObject(payload);
  const name = requiredString(input.name, 'Token name');
  // High-entropy, URL-safe token. Only its hash is persisted.
  const token = `sg_${crypto.randomBytes(24).toString('base64url')}`;
  const tokenHash = sha256Hex(token);
  const created = await getPrisma().apiToken.create({ data: { name, tokenHash } });
  // `token` is returned exactly once — the renderer must show it now or never.
  return { ...serializeApiToken(created), token };
}

async function revokeApiToken(payload) {
  await requireOwnerOrSuper();
  const id = parseId(requireObject(payload).id);
  await getPrisma().apiToken.delete({ where: { id } }).catch(() => {});
  return { revoked: true };
}

async function getApiServerStatus() {
  await requireOwnerOrSuper();
  return localApi.getStatus();
}

async function setApiServerEnabled(payload) {
  await requireOwnerOrSuper();
  const enabled = Boolean(requireObject(payload).enabled);
  try {
    return await localApi.setEnabled(enabled);
  } catch (e) {
    // Most common cause: the port is already in use by another process.
    const msg = e && e.code === 'EADDRINUSE'
      ? `Port ${localApi.DEFAULT_PORT} is already in use. Close whatever is using it and try again.`
      : (e && e.message ? e.message : 'Could not change the local API server state.');
    throw new Error(msg);
  }
}

// ---------------------------------------------------------------------------
// Softglaze Premium — 2FA vault, Human-Type, Synchronizer handlers
// ---------------------------------------------------------------------------
async function getProfile2faToken(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
  const profile = await getPrisma().profile.findUnique({ where: { id }, select: { twoFactorSeed: true } });
  if (!profile) throw new Error('Profile not found.');
  if (!profile.twoFactorSeed) throw new Error('This profile has no 2FA secret saved.');
  try {
    return totp.totpToken(secretStore.open(profile.twoFactorSeed)); // open() is fail-safe for legacy plaintext seeds
  } catch (e) {
    throw new Error('The saved 2FA secret is not valid base32.');
  }
}

async function systemHumanType(payload) {
  const input = requireObject(payload);
  const sessionId = requiredString(input.sessionId, 'sessionId');
  const text = String(input.text == null ? '' : input.text);
  return humanType(sessionId, text, { minDelay: input.minDelay, maxDelay: input.maxDelay });
}

async function bulkSynchronize(payload) {
  const input = requireObject(payload);
  const ids = parseIdArray(input.ids);
  const { denied } = await partitionAccessibleProfileIds(ids);
  if (denied.length) throw new Error('You do not have access to one or more of the selected profiles.');
  if (ids.length < 2) throw new Error('Select at least two profiles to synchronize (one Master + one or more Slaves).');
  const result = await launchSynchronizedSessions(ids, launchProfileById);
  await logActivity(getPrisma(), ids[0], 'synchronize', `master + ${ids.length - 1} slave(s)`).catch(() => {});
  return result;
}

function registerIpcHandlers() {
  if (registered) return;

  registerHandler(CHANNELS.SYSTEM_GET_INFO, getSystemInfo);
  registerHandler(CHANNELS.SYSTEM_LIST_BROWSERS, listBrowsers);
  registerHandler(CHANNELS.BROWSER_LIST_AVAILABLE, listAvailableBrowsers_);
  registerHandler(CHANNELS.BROWSER_DOWNLOAD, downloadBrowser);
  registerHandler(CHANNELS.BROWSER_DOWNLOAD_STATUS, browserDownloadStatus);
  registerHandler(CHANNELS.BROWSER_DOWNLOAD_PAUSE, pauseBrowserDownload);
  registerHandler(CHANNELS.BROWSER_DOWNLOAD_RESUME, resumeBrowserDownload);
  registerHandler(CHANNELS.BROWSER_FIREFOX_STATUS, firefoxStatus);
  registerHandler(CHANNELS.BROWSER_FIREFOX_LIST, firefoxListDownloadable);
  registerHandler(CHANNELS.BROWSER_FIREFOX_DOWNLOAD, downloadFirefox);
  registerHandler(CHANNELS.BROWSER_FIREFOX_DOWNLOAD_STATUS, firefoxDownloadStatus);
  registerHandler(CHANNELS.BROWSER_FIREFOX_DOWNLOAD_PAUSE, pauseFirefoxDownload);
  registerHandler(CHANNELS.BROWSER_FIREFOX_DOWNLOAD_RESUME, resumeFirefoxDownload);
  // Extract any leftover browser .zip (e.g. a half-finished manual download) so it
  // becomes a usable install on next launch. Then re-surface any download that was
  // interrupted by a crash / power loss so the UI can offer Resume.
  browserDownloader.reconcileStrayZips().catch(() => {});
  browserDownloader.initResumableState().catch(() => {});
  firefoxEngine.initFirefoxResumableState().catch(() => {});
  registerHandler(CHANNELS.DASHBOARD_GET_STATS, getDashboardStats);

  registerHandler(CHANNELS.PROXY_LIST, listProxies);
  registerHandler(CHANNELS.PROXY_CREATE, createProxy);
  registerHandler(CHANNELS.PROXY_UPDATE, updateProxy);
  registerHandler(CHANNELS.PROXY_DELETE, deleteProxy);
  registerHandler(CHANNELS.PROXY_BATCH_ADD, batchAddProxies);
  registerHandler(CHANNELS.PROXY_CHECK, checkProxy);
  registerHandler(CHANNELS.PROXY_BULK_DELETE, bulkDeleteProxies);
  registerHandler(CHANNELS.PROXY_ROTATION_GET, getProxyRotation);
  registerHandler(CHANNELS.PROXY_ROTATION_SET, setProxyRotation);
  registerHandler(CHANNELS.PROXY_SYNC_VENDOR_POOL, syncVendorPool);
  registerHandler(CHANNELS.PROXY_ROTATE_IP, rotateProxyIp);
  registerHandler(CHANNELS.PROXY_TEST_ALL, testAllProxies);

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
  registerHandler(CHANNELS.PROFILE_IMPORT_COOKIES_BULK, importCookiesToRunning);
  registerHandler(CHANNELS.PROFILE_STORAGE_INFO, getProfileStorageInfo);
  registerHandler(CHANNELS.PROFILE_CLONE, cloneProfile);
  registerHandler(CHANNELS.TEMPLATE_LIST, listTemplates);
  registerHandler(CHANNELS.TEMPLATE_SAVE, saveProfileAsTemplate);
  registerHandler(CHANNELS.TEMPLATE_DELETE, deleteTemplate);
  registerHandler(CHANNELS.TEMPLATE_CREATE_PROFILE, createProfileFromTemplate);
  registerHandler(CHANNELS.PROFILE_LIVE_LEAK, liveProfileLeak);
  registerHandler(CHANNELS.PROFILE_ACTIVITY, listActivity);
  registerHandler(CHANNELS.PROFILE_GET_2FA_TOKEN, getProfile2faToken);
  registerHandler(CHANNELS.PROFILE_BULK_SYNCHRONIZE, bulkSynchronize);
  registerHandler(CHANNELS.PROFILE_EXPORT_ARCHIVE, exportProfileArchive);
  registerHandler(CHANNELS.PROFILE_COOKIE_ROBOT, cookieRobot);
  registerHandler(CHANNELS.PROFILE_GET_LOCKS, getProfileLocks);
  registerHandler(CHANNELS.SYSTEM_HUMAN_TYPE, systemHumanType);
  registerHandler(CHANNELS.SETTINGS_GET_SCHEDULER, getProxyScheduler);
  registerHandler(CHANNELS.SETTINGS_SET_SCHEDULER, setProxyScheduler);
  registerHandler(CHANNELS.SETTINGS_GET_GLOBAL, getGlobalSettings);
  registerHandler(CHANNELS.SETTINGS_SET_GLOBAL, setGlobalSettings);
  registerHandler(CHANNELS.SETTINGS_GET_PROXY_POLICY, getProxyPolicy);
  registerHandler(CHANNELS.SETTINGS_SET_PROXY_POLICY, setProxyPolicy);

  // Monetization — affiliate links for the Proxy Provider marketplace
  registerHandler(CHANNELS.MONETIZATION_GET_LINKS, getAffiliateLinks);
  registerHandler(CHANNELS.MONETIZATION_SET_LINKS, setAffiliateLinks);

  // Team Extensions — download/unzip Chrome extensions and inject into profiles
  registerHandler(CHANNELS.EXTENSIONS_LIST, listExtensions);
  registerHandler(CHANNELS.EXTENSIONS_INSTALL_FROM_ID, installExtensionFromId);
  registerHandler(CHANNELS.EXTENSIONS_DELETE, deleteExtension);
  registerHandler(CHANNELS.EXTENSIONS_TOGGLE_GLOBAL, toggleExtensionGlobal);

  // Resume the background proxy scheduler if it was enabled previously.
  (async () => {
    try {
      const cfg = await readSetting('proxyScheduler', null);
      if (cfg && cfg.enabled) startProxyScheduler(cfg.minutes);
    } catch (e) { /* ignore */ }
    try {
      const mcfg = await readSetting('macroSchedule', null);
      if (mcfg && mcfg.enabled) startMacroScheduler(mcfg.everyMinutes);
    } catch (e) { /* ignore */ }
  })();

  // Reap stale profile locks (crash/orphan) by reconciling against live sessions.
  const lockSweep = setInterval(() => { try { reconcileProfileLocks(); } catch (e) { /* ignore */ } }, 60000);
  if (lockSweep.unref) lockSweep.unref();

  registerHandler(CHANNELS.GROUP_LIST, listGroups);
  registerHandler(CHANNELS.GROUP_CREATE, createGroup);
  registerHandler(CHANNELS.GROUP_UPDATE, updateGroup);
  registerHandler(CHANNELS.GROUP_DELETE, deleteGroup);
  registerHandler(CHANNELS.GROUP_ASSIGN, assignProfilesToGroup);
  registerHandler(CHANNELS.TAG_LIST, listTags);

  registerHandler(CHANNELS.SESSION_LIST, () => listAllSessions());
  registerHandler(CHANNELS.SESSION_CLOSE, closeSession);

  registerHandler(CHANNELS.BATCH_PREVIEW_PROFILES_DIALOG, previewProfilesViaDialog);
  registerHandler(CHANNELS.BATCH_COMMIT_PROFILE_IMPORT, commitProfileImport);
  registerHandler(CHANNELS.BATCH_EXPORT_PROFILES, exportProfiles);
  registerHandler(CHANNELS.BATCH_EXPORT_PROFILES_FILE, exportProfilesToFile);

  // Profile migration — transfer from competitor platforms (Owner / Super Admin)
  registerHandler(CHANNELS.MIGRATION_START_TRANSFER, migrateProfiles);

  // Softglaze Pro — automation
  registerHandler(CHANNELS.AUTOMATION_GET_MACROS, getMacros);
  registerHandler(CHANNELS.AUTOMATION_SAVE_MACRO, saveMacro);
  registerHandler(CHANNELS.AUTOMATION_DELETE_MACRO, deleteMacro);
  registerHandler(CHANNELS.AUTOMATION_START_WARMER, startWarmer);
  registerHandler(CHANNELS.AUTOMATION_STOP_WARMER, stopWarmer);
  registerHandler(CHANNELS.AUTOMATION_GET_HISTORY, getAutomationHistory);
  registerHandler(CHANNELS.AUTOMATION_RUN_MACRO, runMacroOnProfile);
  registerHandler(CHANNELS.AUTOMATION_CONTROL_MACRO, controlMacro);
  registerHandler(CHANNELS.AUTOMATION_START_RECORDING, startMacroRecordingOnProfile);
  registerHandler(CHANNELS.AUTOMATION_STOP_RECORDING, stopMacroRecordingOnProfile);
  registerHandler(CHANNELS.AUTOMATION_GET_SCHEDULE, getMacroSchedule);
  registerHandler(CHANNELS.AUTOMATION_SET_SCHEDULE, setMacroSchedule);
  registerHandler(CHANNELS.AUTOMATION_RUN_PARALLEL, runParallelMacroHandler);
  registerHandler(CHANNELS.AUTOMATION_PICK_DATA_FILE, pickDataFile);

  // Softglaze Pro — local developer API
  registerHandler(CHANNELS.API_TOKEN_LIST, listApiTokens);
  registerHandler(CHANNELS.API_TOKEN_CREATE, createApiToken);
  registerHandler(CHANNELS.API_TOKEN_REVOKE, revokeApiToken);
  registerHandler(CHANNELS.API_SERVER_STATUS, getApiServerStatus);
  registerHandler(CHANNELS.API_SERVER_SET_ENABLED, setApiServerEnabled);

  registerHandler(CHANNELS.MEMBER_LIST, listMembers);
  registerHandler(CHANNELS.MEMBER_CREATE, createMember);
  registerHandler(CHANNELS.MEMBER_UPDATE, updateMember);
  registerHandler(CHANNELS.MEMBER_DELETE, deleteMember);
  registerHandler(CHANNELS.MEMBER_SET_PIN, setMemberPin);
  registerHandler(CHANNELS.MEMBER_CURRENT, getCurrentMember);
  registerHandler(CHANNELS.MEMBER_SWITCH, switchMember);
  registerHandler(CHANNELS.MEMBER_SUPER_LOGIN, superLogin);
  registerHandler(CHANNELS.MEMBER_ACCEPT_INVITE, acceptInvite);
  registerHandler(CHANNELS.MEMBER_LOGIN, memberLogin);
  registerHandler(CHANNELS.MEMBER_LOGOUT, memberLogout);
  registerHandler(CHANNELS.MEMBER_UPDATE_SELF, updateOwnProfile);
  registerHandler(CHANNELS.MEMBER_REQUEST_CHANGE, requestMemberChange);
  registerHandler(CHANNELS.MEMBER_COMMIT_CHANGE, commitMemberChange);
  registerHandler(CHANNELS.MEMBER_UPDATE_PERMISSIONS, updateMemberPermissions);
  registerHandler(CHANNELS.MEMBER_SET_INSTRUCTIONS, setMemberInstructions);
  registerHandler(CHANNELS.MEMBER_SET_STATUS, setMemberStatus);

  registerHandler(CHANNELS.LICENSE_GET, getLicense);
  registerHandler(CHANNELS.LICENSE_REDEEM, redeemPurchaseCode);
  registerHandler(CHANNELS.LICENSE_GRANT, grantLicense);
  registerHandler(CHANNELS.LICENSE_EXTEND, extendLicense);
  registerHandler(CHANNELS.LICENSE_RESET, resetLicense);
  registerHandler(CHANNELS.LICENSE_TRIAL_START, startTrial);
  registerHandler(CHANNELS.LICENSE_EDIT, editLicense);
  registerHandler(CHANNELS.LICENSE_TERMINATE, terminateLicense);
  registerHandler(CHANNELS.LICENSE_LIST_OWNERS, listOwnerLicenses);
  registerHandler(CHANNELS.PAYMENT_CONFIG_GET, getPaymentConfig);
  registerHandler(CHANNELS.PAYMENT_CONFIG_SET, setPaymentConfig);
  registerHandler(CHANNELS.PAYMENT_CONFIG_VALIDATE, validatePaymentConfig);
  registerHandler(CHANNELS.PAYMENT_CHECKOUT_START, startCheckout);
  registerHandler(CHANNELS.PAYMENT_CHECKOUT_POLL, pollCheckout);
  registerHandler(CHANNELS.PAYMENT_LIST_METHODS, listPaymentMethods);
  registerHandler(CHANNELS.PAYMENT_SUBMIT_MANUAL, submitManualPayment);
  registerHandler(CHANNELS.PAYMENT_MANUAL_LIST, listManualPayments);
  registerHandler(CHANNELS.PAYMENT_MANUAL_RESOLVE, resolveManualPayment);
  registerHandler(CHANNELS.BILLING_GET_PLANS, getBillingPlans);
  registerHandler(CHANNELS.BILLING_PLANS_ADMIN, listBillingPlansAdmin);
  registerHandler(CHANNELS.BILLING_PLAN_SAVE, saveBillingPlan);
  registerHandler(CHANNELS.BILLING_PLAN_DELETE, deleteBillingPlan);
  registerHandler(CHANNELS.BILLING_ASSIGN, assignPlan);
  registerHandler(CHANNELS.BILLING_SUBSCRIBERS, listSubscribers);
  registerHandler(CHANNELS.INVOICE_LIST, listInvoices);
  registerHandler(CHANNELS.INVOICE_CREATE, createInvoice);
  registerHandler(CHANNELS.INVOICE_UPDATE, updateInvoice);
  registerHandler(CHANNELS.INVOICE_DELETE, deleteInvoice);
  registerHandler(CHANNELS.IP_PROVIDERS_GET_ALL, getIpProviders);
  registerHandler(CHANNELS.IP_PROVIDERS_UPDATE_CREDENTIALS, updateIpProviderCredentials);
  registerHandler(CHANNELS.IP_PROVIDERS_TOGGLE_STATUS, toggleIpProviderStatus);
  registerHandler(CHANNELS.TEAM_ACTIVITY, getTeamActivity);
  registerHandler(CHANNELS.TEAM_REASSIGN_PROFILES, reassignProfiles);
  registerHandler(CHANNELS.TEAM_SEAT_USAGE, getSeatUsage);
  registerHandler(CHANNELS.TEAM_EXPORT_ACTIVITY, exportTeamActivity);
  registerHandler(CHANNELS.SYNC_STATUS, syncStatus);
  registerHandler(CHANNELS.SYNC_CONFIGURE, syncConfigure);
  registerHandler(CHANNELS.SYNC_RUN, syncRun);
  registerHandler(CHANNELS.DB_ENCRYPTION_STATUS, dbEncryptionStatus);
  registerHandler(CHANNELS.DB_UNLOCK, dbUnlock);
  registerHandler(CHANNELS.DB_ENABLE_ENCRYPTION, dbEnableEncryption);
  registerHandler(CHANNELS.DB_DISABLE_ENCRYPTION, dbDisableEncryption);
  registerHandler(CHANNELS.WORKSPACE_BACKUP, workspaceBackup);
  registerHandler(CHANNELS.WORKSPACE_RESTORE, workspaceRestore);
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

  // Softglaze Pro — wire the local REST API to the launch pipeline + settings,
  // then start it if the user has it enabled. Loopback-only; off by default.
  localApi.configure({
    launchProfileById,
    // Slim, non-secret profile list for GET /api/v1/profiles (no proxy passwords).
    readProfiles: async () => {
      const rows = await getPrisma().profile.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' } });
      return rows.map((p) => ({
        id: p.id,
        title: p.title,
        os: p.os || null,
        browserVersion: p.browserVersion || null,
        userAgent: p.userAgent || null,
        proxy: p.proxyInfoString ? String(p.proxyInfoString).replace(/:[^:@]*@/, ':••••@') : null,
        groupId: p.groupId || null,
        lastUsedAt: p.lastUsedAt instanceof Date ? p.lastUsedAt.toISOString() : (p.lastUsedAt || null)
      }));
    },
    readConfig: () => readSetting('localApi', { enabled: false, port: localApi.DEFAULT_PORT }),
    writeConfig: (cfg) => writeSetting('localApi', cfg)
  });
  // Bring the session online (member + vault state + local API) only when the DB
  // is actually readable. When at-rest encryption is on, the DB starts locked and
  // this is deferred until the db:unlock handler runs afterDbReady() itself.
  if (database.isDbUnlocked()) {
    afterDbReady();
  }

  registered = true;
}

async function shutdownIpcHandlers() {
  stopProxyScheduler();
  stopMacroScheduler();
  await localApi.stop().catch(() => {});
  await closeAllProfileSessions();
  await firefoxEngine.closeAllFirefoxSessions().catch(() => {});
  await disconnectPrisma();
}

module.exports = {
  CHANNELS,
  registerIpcHandlers,
  shutdownIpcHandlers
};