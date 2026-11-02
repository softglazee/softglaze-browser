'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { ipcMain, dialog, BrowserWindow } = require('electron');
const os = require('node:os');
const { execFile } = require('node:child_process');

const { getPrisma, getRuntimeConfig, disconnectPrisma } = require('./database');
const {
  parseProxyInput,
  formatProxyHost,
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
  normalizeMacroSteps,
  startMacroRecording,
  stopMacroRecording,
  humanType,
  launchSynchronizedSessions,
  configurePersonaBridge,
  pruneDeadSessions,
  listSessionPids,
  setSessionEventSink,
  retryBlockedPage,
  isRecordingMacro
} = require('./browserEngine');
const blockDetect = require('./blockDetect');
const browserDownloader = require('./browserDownloader');
const firefoxEngine = require('./firefoxEngine');
const localApi = require('./localApi');
const autofillBridge = require('./autofillBridge');
const { siteKeyOf } = require('./siteKey');
const updater = require('./updater');
const totp = require('./totp');
const permissions = require('./permissions');
const rbacPolicy = require('./rbacPolicy');
const payments = require('./payments');
const { parseWorkbookFile, parseDataRows, parseSystemProxyBehavior, BROWSER_CORE, normalizeBrowserCore, toStoredBrowserCore } = require('./importParser');
const { generateFingerprint, normalizeBrand, deviceGpuCoherence, fingerprintSignature, CHROME_VERSIONS } = require('./fingerprintGenerator');
const migrationService = require('./migrationService');
const extensionManager = require('./extensionManager');
const profileArchive = require('./profileArchive');
const profileData = require('./profileData');
const captchaScore = require('./captchaScore');
const launchCheck = require('./launchCheck');
const vendorScoreboard = require('./vendorScoreboard');
const warmAutopilot = require('./warmAutopilot');
const providerAccount = require('./providerAccount');
const dbCrypto = require('./dbCrypto');
const database = require('./database');
const licensePolicy = require('./licensePolicy');
const { relay } = require('./remoteRelay');
const { runParallelMacro } = require('./parallelRunner');
const teamPolicy = require('./teamPolicy');
const { CloudSyncEngine, resolveWorkspaceSalt } = require('./cloudSync');
const syncTransport = require('./syncTransport');
const syncPolicy = require('./syncPolicy');
const secretStore = require('./secretStore');
const proxySecrets = require('./proxySecrets');
const rememberStore = require('./rememberStore');
const { tenantConfig } = require('./tenantConfig');
const licenseClient = require('./licenseClient');
const ownerCert = require('./ownerCert');
const authGate = require('./authGate');
const { maskProxyInfoString, redactPlatformAccounts, redactProfileRow, restoreMaskedSecrets } = require('./profileRedaction');
const {
  parseLoginList, csvFilter, asnList, FILTER_PATTERNS, proxySellerRotation, unwrapProxySeller, maskProxySellerKey, proxySellerListItems, proxySellerListGeo, proxySellerGeoView,
  GEOJS_URL, normalizeGeoJs, PROXY_SELLER_ORDER_TYPES, proxySellerOrderRows, summarizeProxySellerOrders,
  parseIpRoyalLine, ipRoyalLifetime, ipRoyalLocation, pickIpRoyalPort, ipRoyalCountriesView, ipRoyalErrorMessage,
  marsProxiesLocation, parseMarsProxiesList, nodeMavenUsername, nodeMavenTtl, froxyPassword, froxyBasePassword,
  packetStreamPassword, packetStreamCountry, airproxyRows,
  proxmintUsername, proxmintPickProduct, databayUsername,
  ipfoxyUsername, mangoProxyPlace, mangoProxyAsn, mangoProxyCollect,
  catProxiesResiUsername, catProxiesMobileUsername, catProxiesCreds,
  rapidProxyUsername, NOVADA_ZONES, novadaUsername,
  PROXIESSX_POOLS, proxiesSxSid, proxiesSxUsername, proxiesSxProxyCreds,
  mobileProxySpaceRows, proxySolutionsPage,
  parseProxidizePerProxy, proxidizePerGbUsername,
  liveProxiesListUrl, liveProxiesRows, liveProxiesPlanLabel,
  LIVEPROXIES_GATEWAY, liveProxiesBaseUser, liveProxiesUsername, liveProxiesStickyHost,
  ipBurgerUsername, proxy302Token, proxy302CountryId, proxy302Row,
  medianMs,
  twoExtractBaseUser, twoExtractUsername,
  gonzoProxyBaseLogin, gonzoProxyUsername,
  SIMPLYPROXIES_NETWORKS, simplyProxiesUsername,
  coroniumRows,
  singaporeMobileProxyRows,
  gsocksProxyIds, gsocksListRows,
  proxyBonanzaRows,
  proxy6Page,
  catProxiesIspRows, catProxiesDatacenterRows
} = require('./proxyVendorUtils');

const CHANNELS = Object.freeze({
  SYSTEM_GET_INFO: 'system:get-info',
  SYSTEM_LIST_BROWSERS: 'system:list-browsers',
  BROWSER_LIST_AVAILABLE: 'browser:list-available',
  BROWSER_DOWNLOAD: 'browser:download',
  BROWSER_DOWNLOAD_STATUS: 'browser:download-status',
  BROWSER_DOWNLOAD_PAUSE: 'browser:download-pause',
  BROWSER_DOWNLOAD_RESUME: 'browser:download-resume',
  ANTIDETECT_ENGINE_STATUS: 'browser:antidetect-status',
  ANTIDETECT_ENGINE_DOWNLOAD: 'browser:antidetect-download',
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
  PROXY_VENDOR_LOOKUP: 'proxy:vendor-lookup',
  PROXY_PROVIDER_CREDS_GET: 'proxy-provider:creds-get',
  PROXY_PROVIDER_CREDS_SET: 'proxy-provider:creds-set',
  PROXY_PROVIDER_ACCOUNT: 'proxy:provider-account',
  PROXY_ROTATE_IP: 'proxy:rotate-ip',
  PROXY_TEST_ALL: 'proxy:test-all',
  PROXY_CHECK_STREAM: 'proxy:check-stream',
  PROXY_CHECK_STOP: 'proxy:check-stop',
  PROXY_CHECK_PROGRESS: 'proxy:check-progress', // main → renderer stream
  PROXY_FREE_HARVEST: 'proxy:free-harvest', // find + test free public proxies, add the good ones
  PROXY_FREE_CANCEL: 'proxy:free-cancel',
  PROXY_FREE_PROGRESS: 'proxy:free-progress', // main → renderer stream
  PROXY_GROUP_LIST: 'proxy-group:list',
  PROXY_GROUP_CREATE: 'proxy-group:create',
  PROXY_GROUP_UPDATE: 'proxy-group:update',
  PROXY_GROUP_DELETE: 'proxy-group:delete',
  PROXY_GROUP_ASSIGN: 'proxy-group:assign',
  PROXY_AUTO_GROUP: 'proxy:auto-group',
  PROXY_HEALTH_HISTORY: 'proxy:health-history',
  PROXY_RECENT_HEALTH: 'proxy:recent-health',
  PROXY_VENDOR_SCOREBOARD: 'proxy:vendor-scoreboard',

  PROFILE_LIST: 'profile:list',
  PROFILE_CREATE: 'profile:create',
  PROFILE_BATCH_GENERATE: 'profile:batch-generate',
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
  PROFILE_BULK_ASSIGN_PROXY: 'profile:bulk-assign-proxy',
  PROFILE_ACCESS_GRANT: 'profile:access-grant',
  PROFILE_ACCESS_REVOKE: 'profile:access-revoke',
  PROFILE_ACCESS_LIST: 'profile:access-list',
  PROFILE_BULK_LAUNCH_PROGRESS: 'profile:bulk-launch-progress', // main -> renderer stream
  PROFILE_BULK_LAUNCH_CONTROL: 'profile:bulk-launch-control', // renderer -> main (pause/resume/stop the queue)
  PROFILE_BULK_LAUNCH_STATUS: 'profile:bulk-launch-status', // renderer -> main (re-attach to a queue already running)
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
  PROFILE_CAPTCHA_SCORES: 'profile:captcha-scores',
  PROFILE_CAPTCHA_FIX: 'profile:captcha-fix',
  PROFILE_CAPTCHA_FIX_BULK: 'profile:captcha-fix-bulk',
  PROFILE_PRELAUNCH_CHECK: 'profile:prelaunch-check',
  PROFILE_WARM_STATS: 'profile:warm-stats',
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

  // Identity Data Vault - personas for the Smart Autofill engine
  PERSONA_IMPORT_BATCH: 'personas:import-batch',
  PERSONA_CREATE_MANUAL: 'personas:create-manual',
  PERSONA_GET_ALL: 'personas:get-all',
  PERSONA_GET_AVAILABLE_FOR_URL: 'personas:get-available-for-url',
  PERSONA_MARK_USED: 'personas:mark-used',
  PERSONA_CLEAR_USED: 'personas:clear-used',
  PERSONA_DELETE: 'personas:delete',
  PERSONA_UPDATE: 'personas:update',
  PERSONA_PREVIEW_FILE: 'personas:preview-file',

  MEMBER_LIST: 'member:list',
  MEMBER_CREATE: 'member:create',
  MEMBER_UPDATE: 'member:update',
  MEMBER_DELETE: 'member:delete',
  MEMBER_SET_PIN: 'member:set-pin',
  MEMBER_CURRENT: 'member:current',
  MEMBER_SWITCH: 'member:switch',
  MEMBER_SUPER_LOGIN: 'member:super-login',
  MEMBER_SUPER_STATUS: 'member:super-status',
  MEMBER_SUPER_SETUP: 'member:super-setup',
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
  LICENSE_BACKEND_INFO: 'license:backend-info',
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
  TEAM_PERMISSION_CATALOG: 'team:permission-catalog',
  SYNC_STATUS: 'sync:status',
  SYNC_CONFIGURE: 'sync:configure',
  SYNC_RUN: 'sync:run',
  VAULT_STATUS: 'vault:status',
  VAULT_SET_PASSWORD: 'vault:set-password',
  VAULT_UNLOCK: 'vault:unlock',
  VAULT_LOCK: 'vault:lock',
  VAULT_DISABLE: 'vault:disable',
  VAULT_SET_AUTOLOCK: 'vault:set-autolock',
  AUTH_REMEMBER_STATUS: 'auth:remember-status',
  AUTH_FORGET: 'auth:forget',
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
  PROFILE_TAG_ASSIGN: 'profile:tag-assign',
  PROFILE_BULK_RENAME: 'profile:bulk-rename',

  SESSION_LIST: 'session:list',
  SESSION_CLOSE: 'session:close',
  SESSION_RESTORE_GET: 'session:restore-get',
  SESSION_RESTORE_RUN: 'session:restore-run',
  SESSION_RESOURCE_USAGE: 'session:resource-usage',
  SESSION_CRASH: 'session:crash', // main -> renderer push
  SESSION_BLOCKED: 'session:blocked', // main -> renderer push
  MEMORY_PRESSURE: 'system:memory-pressure', // main -> renderer push

  BATCH_PREVIEW_PROFILES_DIALOG: 'batch:preview-profiles-dialog',
  BATCH_COMMIT_PROFILE_IMPORT: 'batch:commit-profile-import',
  BATCH_IMPORT_PROGRESS: 'batch:import-progress', // main -> renderer stream
  BATCH_EXPORT_PROFILES: 'batch:export-profiles',
  BATCH_EXPORT_PROFILES_FILE: 'batch:export-profiles-file',

  // Profile migration - transfer from competitor platforms (Owner / Super Admin)
  MIGRATION_START_TRANSFER: 'migration:start-transfer',
  MIGRATION_PROGRESS: 'migration:progress', // main -> renderer stream

  // Softglaze Pro - automation (macros + cookie warmer)
  AUTOMATION_GET_MACROS: 'automation:get-macros',
  AUTOMATION_SAVE_MACRO: 'automation:save-macro',
  AUTOMATION_DELETE_MACRO: 'automation:delete-macro',
  AUTOMATION_START_WARMER: 'automation:start-warmer',
  AUTOMATION_STOP_WARMER: 'automation:stop-warmer',
  AUTOMATION_LIST_WARMERS: 'automation:list-warmers', // re-attach to a running warm-up
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
  AUTOMATION_PARALLEL_STATUS: 'automation:parallel-status', // is a parallel run still going (backstop for a lost 'done' frame)
  AUTOMATION_RUN_PROGRESS: 'automation:run-progress', // main -> renderer stream
  AUTOMATION_PICK_DATA_FILE: 'automation:pick-data-file',
  AUTOMATION_WARM_AUTOPILOT_GET: 'automation:warm-autopilot-get',
  AUTOMATION_WARM_AUTOPILOT_SET: 'automation:warm-autopilot-set',

  // Softglaze Pro - local developer API
  API_TOKEN_LIST: 'api:token-list',
  API_TOKEN_CREATE: 'api:token-create',
  API_TOKEN_REVOKE: 'api:token-revoke',
  API_SERVER_STATUS: 'api:server-status',
  API_SERVER_SET_ENABLED: 'api:server-set-enabled',

  // Softglaze Enterprise - at-rest DB encryption + workspace backup/restore
  DB_ENCRYPTION_STATUS: 'db:encryption-status',
  DB_UNLOCK: 'db:unlock',
  DB_ENABLE_ENCRYPTION: 'db:enable-encryption',
  DB_DISABLE_ENCRYPTION: 'db:disable-encryption',
  WORKSPACE_BACKUP: 'workspace:backup',
  WORKSPACE_RESTORE: 'workspace:restore',

  // In-app OTA updates (electron-updater). UPDATER_EVENT is a main→renderer push.
  UPDATER_EVENT: 'updater:event',
  UPDATER_GET_STATE: 'updater:get-state',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_CHECK: 'updater:check'
});

const VALID_PROXY_TYPES = new Set(['HTTP', 'SOCKS5', 'SOCKS4']);
const VALID_SYSTEM_PROXY_BEHAVIORS = new Set(['DIRECT', 'PROFILE_PROXY', 'SYSTEM_PROXY']);

let registered = false;
let proxySchedulerTimer = null;
let memoryGuardTimer = null;
let currentMemberId = null;
// Cached by getActiveMember() so the synchronous proxy serializer can decide redaction.
// Single-user mode (no member) counts as owner, so full reveal.
let currentMemberCanRevealProxy = true;
let vaultLocked = false;
// How the workspace was last unlocked: 'vault' (Owner password), 'member', 'super', 'none' (no vault)
// or null (locked). Only 'vault' or 'none' lets the member picker open a password-less identity such
// as the registered Owner; see switchMember.
let vaultUnlockSource = null;
const importPreviewCache = new Map();

function toIpcError(error) {
  return {
    message: error instanceof Error ? error.message : 'Unknown IPC error',
    code: error && typeof error === 'object' && error.code ? String(error.code) : 'IPC_ERROR'
  };
}

// Sign-in and vault-lock state for authGate.decide(). A stale currentMemberId counts as signed out;
// a DB error fails closed (memberCount Infinity serves only pre-auth channels).
async function ipcAuthState() {
  const state = { vaultLocked: Boolean(vaultLocked), signedIn: false, memberCount: 0 };
  if (state.vaultLocked) return state;
  try {
    if (currentMemberId != null) {
      if (permissions.isSuperAdminId(currentMemberId)) { state.signedIn = true; return state; }
      const row = await getPrisma().member.findUnique({ where: { id: currentMemberId }, select: { id: true } });
      if (row) { state.signedIn = true; return state; }
    }
    state.memberCount = await getPrisma().member.count();
  } catch (_) { state.memberCount = Infinity; }
  return state;
}

function registerHandler(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      // Sign-out and vault lock are enforced in main for every channel outside authGate's pre-auth allowlist.
      if (!authGate.isPreAuthChannel(channel)) {
        const denied = authGate.decide(channel, await ipcAuthState());
        if (denied) return { ok: false, error: { message: denied.message, code: denied.code } };
      }
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

// Audit-log entry for security/team events with no profile, stored under profileId 0 (shown as
// System). Object details are stored as compact JSON. Never throws, so logging cannot break the action.
async function logAudit(action, opts = {}) {
  try {
    const raw = opts && opts.detail;
    const detail = (raw && typeof raw === 'object') ? JSON.stringify(raw) : (raw || null);
    await getPrisma().activityLog.create({
      data: { profileId: (opts && opts.profileId) || 0, action, detail, memberId: currentMemberId }
    });
  } catch (e) { /* non-fatal */ }
}

function parsePort(value) {
  const port = Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Proxy port must be an integer between 1 and 65535.');
  }
  return port;
}

function parseProxyType(value) {
  const normalized = String(value || 'HTTP').trim().toUpperCase()
    .replace(/^HTTPS$/, 'HTTP')
    .replace(/^SOCKS4A$/, 'SOCKS4')
    .replace(/^SOCKS$/, 'SOCKS5');
  if (!VALID_PROXY_TYPES.has(normalized)) throw new Error('Proxy type must be HTTP, SOCKS5, or SOCKS4.');
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

// Rejects internal, loopback and link-local targets for renderer-supplied URLs (SSRF). Names are
// resolved and every address checked; publicOnlyLookup repeats the check at connect time against
// DNS rebinding.
function ipv6Hextets(ip) {
  let s = String(ip).toLowerCase().replace(/%.*$/, '');
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const n = v4.slice(1).map(Number);
    s = s.slice(0, v4.index) + ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const parts = head.concat(new Array(fill).fill('0'), tail).map((h) => parseInt(h || '0', 16));
  return parts.length === 8 && parts.every((h) => h >= 0 && h <= 0xffff) ? parts : null;
}

function isInternalIp(ip) {
  const net = require('node:net');
  const s = String(ip || '').trim().replace(/^\[|\]$/g, '');
  if (net.isIPv4(s)) {
    const [a, b] = s.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127); // CGNAT 100.64/10
  }
  if (!net.isIPv6(s)) return false;
  const h = ipv6Hextets(s);
  if (!h) return true; // unparseable - fail closed
  if (h.every((x) => x === 0)) return true; // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1
  const v4of = (hi, lo) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  // IPv4-mapped ::ffff:a.b.c.d (dotted or hex), IPv4-compatible ::a.b.c.d, NAT64 64:ff9b::/96.
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) return isInternalIp(v4of(h[6], h[7]));
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return isInternalIp(v4of(h[6], h[7]));
  if ((h[0] & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((h[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((h[0] & 0xffc0) === 0xfec0) return true; // deprecated site-local
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

// Synchronous part: URL shape, internal names and IP literals. Used directly where a
// callback cannot wait (axios beforeRedirect); the connect-time lookup covers names.
function assertPublicHttpUrlSync(rawUrl, label = 'URL') {
  let u;
  try { u = new URL(String(rawUrl)); } catch (e) { throw new Error(`The ${label} is not a valid URL.`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`The ${label} must be an http(s) URL.`);
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const isPrivate = host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost') ||
    host.endsWith('.internal') || isInternalIp(host);
  if (isPrivate) throw new Error(`The ${label} may not point at an internal or loopback address.`);
  return host;
}

// Full check: also resolves a host name and rejects it if ANY address is internal.
async function assertPublicHttpUrl(rawUrl, label = 'URL') {
  const host = assertPublicHttpUrlSync(rawUrl, label);
  if (require('node:net').isIP(host)) return;
  let addrs;
  try { addrs = await require('node:dns').promises.lookup(host, { all: true, verbatim: true }); }
  catch (e) { throw new Error(`The ${label} host could not be resolved.`); }
  if (!addrs.length || addrs.some((a) => isInternalIp(a.address))) {
    throw new Error(`The ${label} may not point at an internal or loopback address.`);
  }
}

// dns.lookup drop-in for outbound requests (axios `lookup`): refuses to connect to an
// internal address, on the first request and on every redirect hop.
function publicOnlyLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  require('node:dns').lookup(hostname, { ...(options || {}), all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isInternalIp(a.address))) {
      const e = new Error(`Refusing to connect to an internal address for ${hostname}.`);
      e.code = 'ESSRF';
      return cb(e);
    }
    if (options && options.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

function buildProxyInfoString(proxy) {
  if (!proxy) return null;
  const username = optionalString(proxy.username);
  const password = optionalString(proxy.password);
  if (username || password) return `${proxy.host}:${proxy.port}:${username || ''}:${password || ''}`;
  return `${proxy.host}:${proxy.port}`;
}

// Best-effort provider tag for "auto group by provider". Prefers the stored column;
// falls back to parsing the vendor label prefix on proxies created before the column.
function deriveProvider(proxy) {
  if (proxy.provider) return String(proxy.provider).toLowerCase();
  const n = String(proxy.name || '').toLowerCase();
  if (n.startsWith('apify')) return 'apify';
  if (n.startsWith('anyip')) return 'anyip';
  if (n.startsWith('shopsocks5')) return 'shopsocks5';
  if (n.startsWith('bright')) return 'brightdata';
  if (n.startsWith('oxylabs')) return 'oxylabs';
  if (n.startsWith('smartproxy')) return 'smartproxy';
  return null;
}

function serializeProxy(proxy) {
  if (!proxy) return null;
  const out = {
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
    // The pool shows a Rotate IP action only where a rotation can actually happen.
    canRotate: Boolean(proxy.rotationUrl) || isDataImpulseSticky(proxy),
    provider: deriveProvider(proxy),
    proxyGroupId: proxy.proxyGroupId ?? null,
    groupName: proxy.proxyGroup ? proxy.proxyGroup.name : null,
    groupColor: proxy.proxyGroup ? proxy.proxyGroup.color : null,
    createdAt: proxy.createdAt instanceof Date ? proxy.createdAt.toISOString() : proxy.createdAt,
    profileCount: proxy._count?.profiles ?? undefined,
    profileNames: Array.isArray(proxy.profiles) ? proxy.profiles.map((p) => p.title).filter(Boolean) : undefined,
    lastStatus: proxy.lastStatus || null,
    lastError: proxy.lastError || null,
    lastLatencyMs: proxy.lastLatencyMs ?? null,
    lastBlacklisted: typeof proxy.lastBlacklisted === 'boolean' ? proxy.lastBlacklisted : null,
    lastCountry: proxy.lastCountry || null,
    lastCheckedAt: proxy.lastCheckedAt instanceof Date ? proxy.lastCheckedAt.toISOString() : (proxy.lastCheckedAt || null)
  };
  // Passwords are masked for everyone; usernames too without `proxies.reveal`. Launches read the raw
  // DB row, never this view, so connectivity is unaffected.
  return currentMemberCanRevealProxy ? out : rbacPolicy.redactForRole('OPERATOR', 'proxyCredentials', out);
}

// Fires the vendor's one-shot "change IP" link (stored, or provided and persisted) server-side.
// Failures return or throw cleanly and never touch the live proxy credentials.
async function rotateProxyIp(payload) {
  // Main fetches a renderer-supplied URL: require proxies.manage, access to this proxy, a public target.
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const id = parseId(input.id ?? input.proxyId);
  await assertCanAccessProxy(id);
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
  // DataImpulse sticky proxies need no link: their API resets the session on the port.
  if (!rotationUrl && isDataImpulseSticky(proxy)) return rotateDataImpulseSticky(proxy);
  if (!rotationUrl) throw new Error('No IP rotation link is configured for this proxy.');
  if (!/^https?:\/\//i.test(rotationUrl)) throw new Error('The rotation link must be an http(s) URL.');
  await assertPublicHttpUrl(rotationUrl, 'rotation link');

  const axios = require('axios');
  const startedAt = Date.now();
  let res;
  try {
    res = await axios.get(rotationUrl, {
      timeout: 20000,
      maxRedirects: 3,
      // Connect-time check of the resolved address (DNS rebind, names pointing inward).
      lookup: publicOnlyLookup,
      // Re-check every redirect hop so a 302 to cloud metadata (169.254.169.254) or a LAN host is refused.
      beforeRedirect: (options) => {
        const proto = options.protocol || 'https:';
        const hostPart = options.hostname || options.host || '';
        const port = (options.port && !String(hostPart).includes(':')) ? `:${options.port}` : '';
        assertPublicHttpUrlSync(`${proto}//${hostPart}${port}${options.path || ''}`, 'rotation redirect');
      },
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
    // Many vendors echo the new IP / a status string - surface a short preview.
    response: typeof res.data === 'string' ? res.data.slice(0, 400) : undefined
  };
}

// Streams the profile's cache + config into an AES-256-encrypted .sgz (see profileArchive.js).
// Failures surface a clean error instead of a half-written file.
async function exportProfileArchive(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id ?? input.profileId);
  await assertCanAccessProfile(id);
  // The archive holds every cookie and saved login, more than a cookie dump, so it needs the same
  // clearance.
  await assertCanRevealKind('cookieDump');
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
  await logAudit('profile.archive_exported', { profileId: id, detail: { bytes: res.plainBytes } });
  return { ok: true, path: save.filePath, bytes: res.plainBytes };
}

// Cookie Robot: browse real sites to build organic cookies and history. Reuses an open session or
// launches one so proxy and fingerprint apply, and closes it only if it launched it.
async function cookieRobot(payload) {
  const input = requireObject(payload);
  const profileId = parseId(input.profileId ?? input.id);
  await assertCanAccessProfile(profileId);
  const urls = Array.isArray(input.targetUrls) ? input.targetUrls.map((u) => String(u || '').trim()).filter(Boolean) : [];
  if (!urls.length) throw new Error('Provide at least one target URL for the cookie robot.');
  // http(s) only; a file:// target would drive the profile to local files.
  for (const u of urls) {
    if (!/^https?:\/\//i.test(u)) throw new Error('Cookie Robot targets must be http(s) URLs.');
  }

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
  // The raw row holds platform passwords, the raw proxy string and the 2FA seed; see profileRedaction.js.
  const reveal = currentMemberCanRevealProxy;
  const safe = redactProfileRow(profile, { reveal });

  let platformAccounts = [];
  try { platformAccounts = redactPlatformAccounts(profile.platformAccounts ? JSON.parse(profile.platformAccounts) : [], reveal); } catch (e) {}

  let syncItems = {};
  try { syncItems = profile.syncItemsJson ? JSON.parse(profile.syncItemsJson) : {}; } catch (e) {}

  let browserSettings = {};
  try { browserSettings = profile.browserSettingsJson ? JSON.parse(profile.browserSettingsJson) : {}; } catch (e) {}

  let tags = [];
  try { tags = profile.tags ? JSON.parse(profile.tags) : []; if (!Array.isArray(tags)) tags = []; } catch (e) { tags = []; }

  return {
    ...safe,
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

// Maps the renderer payload onto Prisma columns.
function extractFingerprintData(input) {
  return {
    browserCore: toStoredBrowserCore(input.browserCore),
    browserBrand: input.browserBrand === undefined ? undefined : (normalizeBrand(input.browserBrand) || 'Chrome'),
    browserVersion: input.browserVersion,
    os: input.os,
    osVersion: input.osVersion,
    deviceClass: input.deviceClass === 'mobile' ? 'mobile' : (input.deviceClass === 'desktop' ? 'desktop' : undefined),
    userAgent: input.userAgent || 'Auto',
    startupUrls: input.startupUrls,
    platformAccounts: input.platformAccounts ? JSON.stringify(input.platformAccounts) : null,
    // 2FA seed: undefined leaves it unchanged, '' clears it, otherwise the trimmed base32 secret is
    // sealed at rest and decrypted only to mint a live token.
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
    // HTTP/3 (QUIC) is opt-in, off for stealth; explicit boolean so a payload without it saves false.
    enableQuic: input.enableQuic === true,
    // Per-profile anti-detect engine (fingerprint-chromium) opt-in - explicit boolean.
    antidetectEngine: input.antidetectEngine === true,
    
    advancedExt: input.advancedExt,
    advancedSync: input.advancedSync,
    syncItemsJson: input.syncItems ? JSON.stringify(input.syncItems) : null,
    advancedBrowser: input.advancedBrowser,
    browserSettingsJson: input.browserSettings ? JSON.stringify(input.browserSettings) : null,
    randomFingerprint: input.randomFingerprint === true,
  };
}

// With randomFingerprint, a freshly generated fingerprint is the base and explicit fields override it.
function buildFingerprintFields(input) {
  const manual = extractFingerprintData(input);
  if (input.randomFingerprint !== true) return manual;
  // Generate for the requested OS and version so GPU, screen and UA major agree; overriding os
  // afterwards would leave e.g. a macOS GPU on a Windows profile.
  const merged = { ...generateFingerprint({ deviceClass: input.deviceClass, os: input.os, browserVersion: input.browserVersion }) };
  for (const [key, value] of Object.entries(manual)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

// Every new profile gets a folder name that has never been used, so it can never inherit old
// cookies, logins or a fingerprint seed. See profileData.js.
async function ensureUniqueDataDirName(db, desiredName) {
  return profileData.uniqueDataDirName({
    root: path.resolve(getRuntimeConfig().profileRoot),
    base: sanitizeDataDirName(desiredName),
    isTaken: async (candidate) => Boolean(await db.profile.findUnique({ where: { dataDirName: candidate }, select: { id: true } }))
  });
}

// Folder names whose data could not be erased yet (a file was still locked).
const PENDING_WIPES_KEY = 'pendingProfileWipes';

// Erases a profile's data in every engine's folder. Anything still locked is noted and retried at
// the next start. Returns true when nothing is left.
async function wipeProfileFolders(dataDirName) {
  const name = sanitizeDataDirName(dataDirName);
  const { clean } = await profileData.wipeProfileData(path.resolve(getRuntimeConfig().profileRoot), name);
  if (!clean) {
    const pending = await readSetting(PENDING_WIPES_KEY, []);
    const list = Array.isArray(pending) ? pending : [];
    if (!list.includes(name)) await writeSetting(PENDING_WIPES_KEY, [...list, name]);
    console.error(`[SG][profile] could not erase all data of "${name}" yet, will retry at next start`);
  }
  return clean;
}

async function retryPendingProfileWipes() {
  const pending = await readSetting(PENDING_WIPES_KEY, []);
  if (!Array.isArray(pending) || !pending.length) return;
  const db = getPrisma();
  const root = path.resolve(getRuntimeConfig().profileRoot);
  const still = [];
  for (const raw of pending) {
    const name = sanitizeDataDirName(raw);
    if (await db.profile.findUnique({ where: { dataDirName: name }, select: { id: true } })) continue;
    const { clean } = await profileData.wipeProfileData(root, name);
    if (!clean) still.push(name);
  }
  await writeSetting(PENDING_WIPES_KEY, still);
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

// Capped so a huge cache folder cannot make the walk unbounded.
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

// Shown in the delete dialog so the user sees what would be wiped before confirming.
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

// Matches the DB unique key (type, host, port, username, passwordHash). Vendors carry sticky sessions
// in the password, so lines differing only there are distinct exits. extendClient rewrites `password`
// to passwordHash; explicit nulls match only rows without a username/password.
function proxyIdentityWhere(parsed) {
  return {
    type: parsed.type,
    host: parsed.host,
    port: parsed.port,
    username: parsed.username == null || parsed.username === '' ? null : String(parsed.username),
    password: parsed.password == null || parsed.password === '' ? null : String(parsed.password)
  };
}

async function findOrCreateProxy(db, proxyInput, nameFallback = null, typeHint = null) {
  const parsed = parseProxyInput(proxyInput);
  if (!parsed) return null;
  // An explicit "Proxy Type" column (HTTP/HTTPS/SOCKS5) overrides the default.
  if (typeHint) parsed.type = typeHint;

  // Reuse a row only when every credential matches, so nothing is revealed or changed; a different
  // password is a different sticky session or account. No member-scope query: this also runs inside
  // a migration transaction, where a query on the outer client would block on SQLite's one connection.
  const existing = await db.proxy.findFirst({ where: proxyIdentityWhere(parsed) });
  if (existing) return existing;

  return db.proxy.create({
    data: {
      name: nameFallback || `${parsed.type} ${parsed.host}:${parsed.port}`,
      type: parsed.type,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
      ownerMemberId: ownerStampId() // stamp the creator so it stays visible in their scoped pool
    }
  });
}

async function listProxies(payload = {}) {
  const db = getPrisma();
  const search = optionalString(payload.search);
  const clauses = [];
  if (search) {
    clauses.push({ OR: [{ name: { contains: search } }, { host: { contains: search } }, { username: { contains: search } }] });
  }
  // Optional category filter: a specific group id, "none" (ungrouped), or a provider tag.
  if (payload.proxyGroupId === 'none' || payload.proxyGroupId === null) {
    clauses.push({ proxyGroupId: null });
  } else if (payload.proxyGroupId !== undefined && payload.proxyGroupId !== '' && payload.proxyGroupId !== 'all') {
    clauses.push({ proxyGroupId: parseId(payload.proxyGroupId, 'proxyGroupId') });
  }
  if (optionalString(payload.provider)) {
    clauses.push({ provider: optionalString(payload.provider).toLowerCase() });
  }
  const where = clauses.length ? (clauses.length === 1 ? clauses[0] : { AND: clauses }) : undefined;

  const proxies = await db.proxy.findMany({
    where: await scopedProxyWhere(where),
    orderBy: { createdAt: 'desc' },
    // Names of the profiles directly assigned this proxy (so the pool shows which
    // profiles use it, not just a count). take:50 keeps the payload bounded.
    include: {
      _count: { select: { profiles: true } },
      profiles: { select: { title: true }, orderBy: { title: 'asc' }, take: 50 },
      proxyGroup: true
    }
  });

  return proxies.map(serializeProxy);
}

async function createProxy(payload) {
  await requirePermission('proxies.manage');
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

  // Same identity as the DB unique key, password included: a second sticky session on
  // the same gateway user is a different proxy, not a duplicate.
  const existing = await db.proxy.findFirst({
    where: proxyIdentityWhere(parsed),
    select: { id: true }
  });
  if (existing) throw new Error('This proxy (same type, host, port, username and password) already exists.');

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
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProxy(id);
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
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProxy(id);
  await db.proxy.delete({ where: { id } });
  await logAudit('proxy.delete', { detail: { proxyId: id } });
  const removedGroups = await pruneEmptyAutoGroups(db);
  return { deleted: true, id, removedGroups };
}

// Removes auto-created groups left empty; a group a person made stays, even empty.
async function pruneEmptyAutoGroups(db) {
  const res = await db.proxyGroup.deleteMany({ where: { autoCreated: true, proxies: { none: {} } } });
  return res.count;
}

// Profiles on a deleted proxy get proxyId nulled by the relation's onDelete: SetNull.
async function bulkDeleteProxies(payload) {
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const ids = Array.isArray(input.ids) ? input.ids.map((value) => parseId(value)) : [];
  if (ids.length === 0) throw new Error('No proxies selected.');
  const { allowed, denied } = await partitionAccessibleProxyIds(ids);
  if (allowed.length === 0) { const e = new Error('You do not have access to the selected proxies.'); e.code = 'FORBIDDEN'; throw e; }
  const result = await getPrisma().proxy.deleteMany({ where: { id: { in: allowed } } });
  await logAudit('proxy.delete', { detail: { count: result.count, proxyIds: allowed, bulk: true } });
  const removedGroups = await pruneEmptyAutoGroups(getPrisma());
  return { deleted: result.count, ids: allowed, denied, removedGroups };
}

// ---- Proxy rotation / sticky-session pools ----
// Config lives in Settings keyed by profile id. A rotating profile keeps its userDataDir (cookies
// persist) while the exit IP rotates across the pool each launch.

async function getProxyRotation(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id);
  await assertCanAccessProfile(id); // rotation config is per-profile - gate on profile access
  const all = (await readSetting('proxyRotation', {})) || {};
  const cfg = all[id] || { enabled: false, mode: 'round-robin', proxyIds: [] };
  const proxies = (await getPrisma().proxy.findMany({
    where: await scopedProxyWhere(undefined),
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
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const id = parseId(input.id);
  await assertCanAccessProfile(id); // rotation config is per-profile - gate on profile access
  const enabled = Boolean(input.enabled);
  const mode = input.mode === 'random' ? 'random' : 'round-robin';
  const proxyIds = Array.isArray(input.proxyIds) ? input.proxyIds.map((v) => parseId(v)) : [];
  if (enabled && proxyIds.length === 0) throw new Error('Select at least one proxy for the rotation pool.');
  // Only allow proxies the caller can actually access into the rotation pool (no binding a
  // profile to another member's proxies).
  if (proxyIds.length) {
    const accessible = await getPrisma().proxy.findMany({
      where: await scopedProxyWhere({ id: { in: proxyIds } }), select: { id: true }
    });
    const okSet = new Set(accessible.map((p) => p.id));
    if (proxyIds.some((pid) => !okSet.has(pid))) throw new Error('One or more selected proxies are not accessible to you.');
  }
  const all = (await readSetting('proxyRotation', {})) || {};
  all[id] = { enabled, mode, proxyIds };
  await writeSetting('proxyRotation', all);
  return { profileId: id, enabled, mode, proxyIds };
}

// ---- Proxy policy: how the rotation pool applies to a launch ----
// Setting `proxyPolicy` = { default, byProfile: { [id]: mode } }. each-launch rotates every launch;
// sticky keeps the profile's own proxy; failover skips failed ones. Layers on top of proxyRotation.
const PROXY_POLICY_MODES = new Set(['each-launch', 'sticky', 'failover', 'latency-optimized']);

async function getProxyPolicy() {
  const cfg = (await readSetting('proxyPolicy', {})) || {};
  const def = PROXY_POLICY_MODES.has(cfg.default) ? cfg.default : 'each-launch';
  const byProfile = (cfg.byProfile && typeof cfg.byProfile === 'object' && !Array.isArray(cfg.byProfile)) ? cfg.byProfile : {};
  return {
    default: def,
    byProfile,
    modes: Array.from(PROXY_POLICY_MODES),
    failoverMaxLatencyMs: Number(cfg.failoverMaxLatencyMs) || 0, // 0 = no ceiling
    latencyTopN: Math.max(1, Number(cfg.latencyTopN) || 3)
  };
}

async function setProxyPolicy(payload) {
  const input = requireObject(payload);
  const cur = (await readSetting('proxyPolicy', {})) || {};
  const next = {
    ...cur,
    default: PROXY_POLICY_MODES.has(cur.default) ? cur.default : 'each-launch',
    byProfile: (cur.byProfile && typeof cur.byProfile === 'object' && !Array.isArray(cur.byProfile)) ? { ...cur.byProfile } : {}
  };
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
  if (input.failoverMaxLatencyMs !== undefined) next.failoverMaxLatencyMs = Math.max(0, Number(input.failoverMaxLatencyMs) || 0);
  if (input.latencyTopN !== undefined) next.latencyTopN = Math.max(1, Number(input.latencyTopN) || 3);
  await writeSetting('proxyPolicy', next);
  return getProxyPolicy();
}

// Resolve the effective policy mode for a profile (per-profile override wins).
async function resolveProxyPolicyMode(profileId) {
  const cfg = await getProxyPolicy();
  const byId = cfg.byProfile[profileId] ?? cfg.byProfile[String(profileId)];
  return PROXY_POLICY_MODES.has(byId) ? byId : cfg.default;
}

// Serialize the round-robin cursor's read-modify-write so parallel launches don't
// lose updates (which would hand the same proxy to several profiles and stall the
// cursor). The critical section is tiny, so one global chain suffices.
let rotationCursorLock = Promise.resolve();
function withRotationCursorLock(fn) {
  const run = rotationCursorLock.then(fn, fn);
  rotationCursorLock = run.then(() => {}, () => {});
  return run;
}

async function pickRotationProxy(db, profileId) {
  const policy = await resolveProxyPolicyMode(profileId);
  // Sticky: never rotate - the profile keeps its own fixed proxy.
  if (policy === 'sticky') return null;

  const all = (await readSetting('proxyRotation', {})) || {};
  const cfg = all[profileId];
  if (!cfg || !cfg.enabled || !Array.isArray(cfg.proxyIds) || cfg.proxyIds.length === 0) return null;

  const rows = await db.proxy.findMany({ where: { id: { in: cfg.proxyIds } } });
  // Preserve the configured order for stable round-robin; drop deleted ids.
  let ordered = cfg.proxyIds.map((pid) => rows.find((p) => p.id === pid)).filter(Boolean);
  if (ordered.length === 0) return null;

  // Failover prefers proxies that passed their last check; if none did (or none were checked), use
  // the full list so a stale health table never blocks a launch.
  const policyCfg = (await readSetting('proxyPolicy', {})) || {};
  if (policy === 'failover') {
    const healthy = ordered.filter((p) => p.lastStatus !== 'fail');
    if (healthy.length > 0) ordered = healthy;
    // Optional latency ceiling - skip proxies slower than the threshold, but never
    // empty the pool (a launch must not be blocked by a strict ceiling).
    const maxMs = Number(policyCfg.failoverMaxLatencyMs) || 0;
    if (maxMs > 0) {
      const fast = ordered.filter((p) => typeof p.lastLatencyMs === 'number' && p.lastLatencyMs <= maxMs);
      if (fast.length > 0) ordered = fast;
    }
  } else if (policy === 'latency-optimized') {
    // Prefer healthy proxies (a failed proxy's latency is stale/meaningless), then
    // order by measured latency (unknown sinks to the end) and keep the fastest N.
    // Fall back to the full pool if none are known-healthy so a launch isn't blocked.
    let healthy = ordered.filter((p) => p.lastStatus !== 'fail');
    if (healthy.length === 0) healthy = ordered;
    const sorted = healthy.slice().sort((a, b) => {
      const la = typeof a.lastLatencyMs === 'number' ? a.lastLatencyMs : Infinity;
      const lb = typeof b.lastLatencyMs === 'number' ? b.lastLatencyMs : Infinity;
      return la - lb;
    });
    const topN = Math.max(1, Number(policyCfg.latencyTopN) || 3);
    ordered = sorted.slice(0, Math.min(topN, sorted.length));
  }

  if (cfg.mode === 'random') return ordered[crypto.randomInt(ordered.length)];

  return withRotationCursorLock(async () => {
    const state = (await readSetting('proxyRotationState', {})) || {};
    const next = (Number(state[profileId]) || 0) % ordered.length;
    state[profileId] = next + 1;
    await writeSetting('proxyRotationState', state);
    return ordered[next];
  });
}

async function batchAddProxies(payload) {
  // Same gating as createProxy: manage permission, quota, and an owner so members can see the rows.
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const db = getPrisma();
  await assertWithinLimit('proxies');
  const proxyStampId = ownerStampId();
  const raw = requiredString(input.raw, 'Raw proxy batch');
  const fallbackType = parseProxyType(input.type || 'HTTP');
  const namePrefix = optionalString(input.namePrefix);
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result = { total: lines.length, created: [], skipped: [], errors: [] };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // Quota is checked per row so a large paste cannot exceed maxProxies; the rest are marked skipped.
    try {
      await assertWithinLimit('proxies');
    } catch (quotaErr) {
      for (let j = index; j < lines.length; j += 1) result.skipped.push({ line: j + 1, reason: 'QUOTA', message: 'Proxy limit reached.' });
      break;
    }
    try {
      const parsed = parseColonProxyLine(line, fallbackType);
      // Password included: N sticky-session lines on one gateway user are N proxies.
      const existing = await db.proxy.findFirst({
        where: proxyIdentityWhere(parsed)
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
          password: parsed.password,
          // Vendor tag for auto-grouping, from the batch's declared provider.
          provider: input.provider ? String(input.provider).toLowerCase() : null,
          ownerMemberId: proxyStampId
        }
      });
      result.created.push(serializeProxy(created));
    } catch (error) {
      result.errors.push({ line: index + 1, raw: line, message: error instanceof Error ? error.message : 'Unknown parse error' });
    }
  }

  return result;
}

// ---- Free public proxies (opt-in) ----
// Only candidates that work and hide the real IP are added, to a "Free proxies" group with provider
// 'free'; Quick generate skips them unless chosen. See freeProxies.js.
const freeProxies = require('./freeProxies');
let freeHarvestRun = null; // { controller, ownerMemberId } while a search runs (one at a time)

const freeProxyKey = (p) => `${String(p.type).toLowerCase()}://${p.host}:${p.port}`;
const freeTypeOf = (c) => (c.type === 'socks5' ? 'SOCKS5' : 'HTTP');

async function ensureFreeProxyGroup(db) {
  const where = await scopedProxyGroupWhereForFree();
  const existing = await db.proxyGroup.findFirst({ where });
  if (existing) return existing;
  // autoCreated: the group removes itself once its last free proxy is deleted.
  return db.proxyGroup.create({ data: { name: 'Free proxies', color: '#f59e0b', autoCreated: true, ownerMemberId: ownerStampId() } });
}

async function scopedProxyGroupWhereForFree() {
  const base = { name: 'Free proxies' };
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return base;
  return { ...base, ownerMemberId: ownerStampId() };
}

async function harvestFreeProxiesHandler(payload, event) {
  await requirePermission('proxies.manage');
  if (freeHarvestRun) { const e = new Error('A free-proxy search is already running.'); e.code = 'BUSY'; throw e; }
  const input = requireObject(payload);
  const protocol = String(input.protocol || 'http').toLowerCase() === 'socks5' ? 'socks5' : 'http';
  const country = optionalString(input.country);
  if (country && !/^[A-Za-z]{2}$/.test(country)) throw new Error('Country must be a two-letter code such as US or DE.');
  const limit = Math.max(1, Math.min(100, Number.parseInt(input.limit, 10) || 10));
  await assertWithinLimit('proxies');
  const db = getPrisma();

  // Free proxies already in the pool are not re-tested or re-added.
  const have = await db.proxy.findMany({ where: { provider: 'free' }, select: { type: true, host: true, port: true } });
  const exclude = new Set(have.map(freeProxyKey));

  const controller = new AbortController();
  freeHarvestRun = { controller, ownerMemberId: currentMemberId };
  const runId = `free-${Date.now()}`;
  const sender = event && event.sender ? event.sender : null;
  let lastSent = 0;
  const send = (data, force = false) => {
    const now = Date.now();
    if (!force && now - lastSent < 250) return; // throttle the per-check frames
    lastSent = now;
    try { if (sender) sender.send(CHANNELS.PROXY_FREE_PROGRESS, { runId, ts: now, ...data }); } catch (e) { /* renderer gone */ }
  };

  const deps = {
    fetchText: (url) => freeProxies.fetchTextDirect(url),
    // The user's own public IP, fetched directly (no proxy), for the anonymity check.
    getRealIp: async () => {
      try { const d = await httpGetJson('https://api.ipify.org?format=json', undefined, 8000); if (d && d.ip) return String(d.ip); } catch (e) { /* try the next */ }
      const d2 = await httpGetJson('https://ipinfo.io/json', undefined, 8000);
      return d2 && d2.ip ? String(d2.ip) : null;
    },
    // Live HTTPS request through the proxy; the first of two IP services to answer wins.
    checkExit: async (c) => {
      const agent = buildProxyAgent({ type: freeTypeOf(c), host: c.host, port: c.port });
      if (!agent) throw new Error('Proxy agent module unavailable.');
      const started = Date.now();
      const viaIpinfo = httpGetJson('https://ipinfo.io/json', agent, 8000).then((d) => {
        if (!d || !d.ip) throw new Error('no ip');
        return { ip: String(d.ip), country: d.country || null };
      });
      const viaGeojs = httpGetJson(GEOJS_URL, agent, 8000).then((raw) => {
        const g = normalizeGeoJs(raw);
        if (!g || !g.ip) throw new Error('no ip');
        return { ip: String(g.ip), country: g.country || null };
      });
      const r = await Promise.any([viaIpinfo, viaGeojs]);
      return { ...r, latencyMs: Date.now() - started };
    },
    // Plain-HTTP header echo through an HTTP proxy (the anonymity check).
    judgeHeaders: async (c) => {
      const agent = buildProxyAgent({ type: 'HTTP', host: c.host, port: c.port });
      const d = await httpGetJson('http://httpbin.org/headers', agent, 8000);
      if (!d || !d.headers) throw new Error('no echo');
      return d.headers;
    }
  };

  try {
    const res = await freeProxies.harvestFreeProxies({
      // Most free proxies are dead, so search speed depends on how fast dead ones are given up on.
      protocol, country, limit, concurrency: 48, stepTimeoutMs: 6000, timeBudgetMs: 3 * 60000, exclude,
      signal: controller.signal,
      onProgress: (p) => send(p, p.phase !== 'check')
    }, deps);
    if (res.stopped === 'no-real-ip') {
      const e = new Error('Could not read your own public IP, which the anonymity check needs. Check your internet connection and try again.');
      e.code = 'NO_REAL_IP'; throw e;
    }

    const added = [];
    let limitReached = false;
    if (res.found.length) {
      const group = await ensureFreeProxyGroup(db);
      for (const f of res.found) {
        try { await assertWithinLimit('proxies'); } catch (e) { limitReached = true; break; }
        const type = freeTypeOf(f);
        const dup = await db.proxy.findFirst({ where: proxyIdentityWhere({ type, host: f.host, port: f.port, username: null, password: null }), select: { id: true } });
        if (dup) continue;
        const created = await db.proxy.create({
          data: {
            name: `Free ${f.country || '??'} ${f.host}:${f.port}`,
            type, host: f.host, port: f.port, username: null, password: null,
            provider: 'free', proxyGroupId: group ? group.id : null, ownerMemberId: ownerStampId(),
            lastStatus: 'ok', lastCountry: f.country || null, lastLatencyMs: f.latencyMs || null, lastCheckedAt: new Date()
          }
        });
        added.push(serializeProxy(created));
      }
    }
    const summary = {
      runId, added: added.length, requested: limit, checked: res.checked, total: res.total,
      stopped: res.stopped, rejected: res.rejected, sources: res.sources, limitReached
    };
    send({ phase: 'done', ...summary }, true);
    await logAudit('proxy.free-harvest', { detail: { protocol, country: country || null, limit, added: added.length, checked: res.checked } });
    return { ...summary, proxies: added };
  } finally {
    freeHarvestRun = null;
  }
}

async function cancelFreeProxyHarvest() {
  await requirePermission('proxies.manage');
  if (!freeHarvestRun) return { cancelled: false };
  await assertCanControlRun(freeHarvestRun.ownerMemberId);
  freeHarvestRun.controller.abort();
  return { cancelled: true };
}

// ---- Provider Core: proxy-vendor sync ----
// Pulls a customer's purchased proxies from a vendor and maps them into the Proxy schema; the
// persistence/dedup path is shared by every adapter.
const PROXY_VENDORS = Object.freeze({
  ipfoxy: 'IPFoxy', brightdata: 'Bright Data', oxylabs: 'Oxylabs', smartproxy: 'Smartproxy',
  proxy302: 'Proxy302', mangoproxy: 'MangoProxy',
  ipburger: 'IP Burger', shopsocks5: 'ShopSocks5',
  apify: 'Apify', anyip: 'AnyIP', dataimpulse: 'DataImpulse',
  proxyseller: 'Proxy-Seller', iproyal: 'IPRoyal', marsproxies: 'MarsProxies', nodemaven: 'NodeMaven',
  froxy: 'Froxy', proxidize: 'Proxidize', liveproxies: 'Live Proxies', packetstream: 'PacketStream',
  airproxy: 'Airproxy', catproxies: 'CatProxies', rapidproxy: 'RapidProxy', novada: 'NOVADA',
  proxiessx: 'Proxies.sx', mobileproxyspace: 'MobileProxy.Space', proxysolutions: 'Proxy-Solutions',
  proxmint: 'Proxmint', databay: 'Databay',
  twoextract: '2extract',
  gonzoproxy: 'GonzoProxy',
  simplyproxies: 'Simply Proxies',
  coronium: 'Coronium',
  singaporemobileproxy: 'Singapore Mobile Proxy',
  gsocks: 'Gsocks',
  proxybonanza: 'Proxy Bonanza',
  proxy6: 'PROXY6'
});

// Gateways for adapters that build a URL from this table. Add a host only if the vendor documents it
// and it resolves in DNS.
const VENDOR_GATEWAYS = Object.freeze({
  oxylabs: { host: 'pr.oxylabs.io', port: 7777, type: 'HTTP' },
  smartproxy: { host: 'gate.smartproxy.com', port: 7000, type: 'HTTP' },
  apify: { host: 'proxy.apify.com', port: 8000, type: 'HTTP' }
  // DataImpulse is deliberately absent: GET /api/list returns the real host and port for every row,
  // so a hardcoded gateway would only add an unverified host.
});


// Native HTTPS fetch with custom headers (e.g. a Bearer token httpGetJson cannot set), a timeout and
// a size cap. Rejects with a status-bearing message so adapters surface vendor errors verbatim.
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
      // options.binary collects raw chunks and resolves a Buffer. Appending chunks to a
      // string would corrupt a ZIP (Proxy-Seller serves its geo database as one).
      const chunks = []; let size = 0;
      const maxBytes = Number(options.maxBytes) || 2_000_000;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { res.destroy(); finish(reject, new Error('Vendor response too large.')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (status < 200 || status >= 300) {
          return finish(reject, Object.assign(new Error(`HTTP ${status} ${buf.toString('utf8').slice(0, 200).trim() || res.statusMessage || ''}`.trim()), { status }));
        }
        finish(resolve, options.binary ? buf : buf.toString('utf8'));
      });
    });
    req.on('error', (e) => finish(reject, e));
    timer = setTimeout(() => { try { req.destroy(); } catch (e) {} finish(reject, new Error('Vendor request timed out.')); }, timeoutMs);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ---- Bright Data ----
// GET /zone/route_ips lists a zone's exit IPs for a Bearer token; each is pinned to the super-proxy
// gateway via the `-ip-<ip>` username suffix.
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

  // A pinned IP needs the full brd-customer-<id>-zone-<zone> login; without the customer id
  // every row would be refused, so stop here instead of storing dead proxies.
  if (!/^brd-customer-[^-]+-zone-/.test(baseUser || '')) throw new Error('Bright Data: enter the proxy username from the zone (brd-customer-<id>-zone-<name>) as well as the API token.');
  const userBase = baseUser;
  // Bright Data retired ports 22225 and 33335; 44445 is current.
  return ips.slice(0, 200).map((ip) => ({
    type: 'HTTP', host: 'brd.superproxy.io', port: 44445,
    username: `${userBase}-ip-${ip}`, password: String(password || ''),
    label: `Bright Data • ${z} • ${ip}`
  }));
}

// ---- Oxylabs / Smartproxy ----
// Gateway-based, so there is no per-IP list: sync makes a live authenticated request through the
// vendor gateway and stores only a working endpoint; bad credentials surface as an error.
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
// Oxylabs selects IPv6 via `-ipversion-6` in the username on the same gateway. Per their docs, a host
// without AAAA silently falls back to IPv4 (522 if that fallback is disabled), and the account may
// need the feature enabled first.
function fetchOxylabsPool(creds) {
  const user = String((creds && creds.username) || '').trim();
  const want6 = String((creds && creds.ipVersion) || '') === '6';
  const username = (want6 && user && !/-ipversion-\d/.test(user)) ? `${user}-ipversion-6` : user;
  return fetchGatewayVerifiedPool(want6 ? 'Oxylabs IPv6' : 'Oxylabs', VENDOR_GATEWAYS.oxylabs, { ...creds, username });
}
function fetchSmartproxyPool(creds) { return fetchGatewayVerifiedPool('Smartproxy', VENDOR_GATEWAYS.smartproxy, creds); }

// ---- Country / session helpers (country-aware adapters) ----
function normCountryCode(value) {
  const v = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : '';
}
function randSession(len = 8) {
  let s = '';
  while (s.length < len) s += Math.random().toString(36).slice(2);
  return s.slice(0, len);
}
// Count-driven adapters (Apify) mint sticky-session strings locally with no network call per row, so
// 500 is cheap while still bounding a runaway value. Adapters with a real API limit pass their own max.
// Gateways that mint sessions locally (the username carries the session) have no vendor-side limit
// on how many a pull makes, so they share this cap; list APIs use the vendor's documented maximum.
const MINTED_PULL_MAX = 1000;

function clampPoolCount(value, def = 5, max = 500) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

// ---- Apify Residential ----
// One gateway (proxy.apify.com:8000); the username picks pool (groups-RESIDENTIAL), country
// (country-XX) and stickiness (session-<id>). No list to pull, so `count` sessions are minted.
async function fetchApifyPool({ password, country, count }) {
  const pw = String(password || '').trim();
  if (!pw) throw new Error('Apify: your proxy password is required (Apify Console → Proxy → HTTP settings → password).');
  const cc = normCountryCode(country);
  const gw = VENDOR_GATEWAYS.apify;
  const n = clampPoolCount(count);
  const rows = [];
  for (let i = 1; i <= n; i += 1) {
    const parts = ['groups-RESIDENTIAL'];
    if (cc) parts.push(`country-${cc}`);
    parts.push(`session-${randSession()}`);
    rows.push({
      type: gw.type, host: gw.host, port: gw.port,
      username: parts.join(','), password: pw,
      label: `Apify • ${cc || 'Global'} • #${i}`, country: cc || null
    });
  }
  return rows;
}

// anyip.io: one gateway (portal.anyip.io:1080, overridable); flags go in the username, comma-separated:
// user_X,type_residential,country_US,sesstime_60,session_ab12. A fixed session pins one IP.
// Creds are pasted (the API key is not the proxy password) or provisioned via API key + Team ID.

// Creates an anyip proxy account; the API never returns the password, so the one supplied here is kept.
async function anyipProvisionAccount(apiKey, teamId) {
  const key = String(apiKey || '').trim();
  const team = String(teamId || '').trim();
  if (!key) throw new Error('AnyIP: an API key is required to auto-provision a proxy account.');
  if (!team) throw new Error('AnyIP: your Team ID is required for API provisioning (anyip dashboard → Team / Settings, or the dashboard URL).');
  const nodeCrypto = require('node:crypto');
  const suffix = nodeCrypto.randomBytes(4).toString('hex');
  const genUser = `sg${suffix}`;                                   // >= 6 chars, alnum
  const plainPassword = ('sg' + nodeCrypto.randomBytes(6).toString('hex')).slice(0, 16); // >= 6 alnum
  const url = `https://api.anyip.io/api/teams/${encodeURIComponent(team)}/proxy_accounts`;
  let text;
  try {
    text = await httpRequestText(url, {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: genUser, plain_password: plainPassword, description: 'SoftGlaze auto-provisioned', enabled: true }),
      timeoutMs: 20000
    });
  } catch (e) {
    throw new Error(`AnyIP provisioning failed: ${e.message} - verify the API key and Team ID (dashboard → Settings).`);
  }
  // The password is already known (supplied on create); prefer the API's returned username.
  let acct = null;
  try { acct = JSON.parse(text); } catch (e) { acct = null; }
  const finalUser = (acct && typeof acct.username === 'string' && acct.username) ? acct.username : genUser;
  return { username: finalUser, password: plainPassword };
}

async function fetchAnyIpPool({ username, password, country, session, count, host, port, life, poolType, token, teamId }) {
  let user = String(username || '').trim();
  let pw = String(password || '');
  // Auto-provision: no direct creds, but an API key and Team ID were supplied.
  if ((!user || !pw) && String(token || '').trim() && String(teamId || '').trim()) {
    const prov = await anyipProvisionAccount(token, teamId);
    user = prov.username;
    pw = prov.password;
  }
  if (!user) throw new Error('AnyIP: enter your proxy Username (user_…) + Password from the dashboard, or an API key + Team ID to auto-provision.');
  if (!pw) throw new Error('AnyIP: a proxy password is required (or supply an API key + Team ID to auto-provision one).');
  const cc = normCountryCode(country);
  // Default to the documented gateway; honor an explicit override (custom port).
  const gwHost = String(host || '').trim() || 'portal.anyip.io';
  const gwPort = Number.parseInt(String(port), 10) || 1080;
  const fixedSession = String(session || '').trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  // sesstime = minutes to keep the exit IP (1..10080); blank/0 rotates per request. The UI tops out at
  // 1440, but the full range is accepted.
  const lifeMin = Math.min(10080, Math.max(0, Number.parseInt(String(life), 10) || 0));
  const ptype = String(poolType || '').toLowerCase() === 'mobile' ? 'mobile' : 'residential';
  const n = fixedSession ? 1 : clampPoolCount(count);
  // Operators often paste the whole gateway username (with session_/sesstime_ flags). Duplicate keys
  // leave it to the gateway which one wins, which could collapse every profile onto one IP. Keep the
  // bare account id, treat pasted flags as defaults, and emit each key once.
  const userSegs = user.split(',').map((s) => s.trim()).filter(Boolean);
  const baseUser = userSegs.shift() || user;
  const flags = new Map(); // key -> full "key_value" segment, insertion-ordered
  for (const seg of userSegs) {
    const key = seg.split('_')[0];
    if (key) flags.set(key, seg);
  }
  const rows = [];
  for (let i = 1; i <= n; i += 1) {
    const own = new Map(flags);
    own.set('type', `type_${ptype}`);
    if (cc) own.set('country', `country_${cc}`);
    if (lifeMin) own.set('sesstime', `sesstime_${lifeMin}`);
    // session goes last, the layout known to work against the live gateway; delete first because
    // Map.set keeps an existing key's position.
    own.delete('session');
    own.set('session', `session_${fixedSession || randSession()}`);
    const parts = [baseUser, ...own.values()];
    rows.push({
      type: 'HTTP', host: gwHost, port: gwPort,
      username: parts.join(','), password: pw,
      label: `AnyIP • ${ptype === 'mobile' ? 'Mobile' : 'Res'} • ${cc || 'Global'} • #${i}`, country: cc || null
    });
  }
  return rows;
}

// ---- ShopSocks5 ----
// POST form-urlencoded to /socks/{premium|list|daily}; needs both user_name and api_token (the token
// alone fails). proxy_type is proxy_sock_5 or proxy_https; rows come back under `response`.
async function fetchShopSocks5Pool({ token, username, country, count, state, city, plan, proxyType }) {
  const tok = String(token || '').trim();
  if (!tok) throw new Error('ShopSocks5: your API token is required.');
  const user = String(username || '').trim();
  if (!user) throw new Error('ShopSocks5: your ShopSocks5 account username or email is required - the API authenticates with user_name + api_token together.');
  const cc = normCountryCode(country);

  // API docs: https://shopsocks5.com/document. Returns { success, response: [...], message }.
  const ep = (String(plan || 'premium').toLowerCase().match(/^(premium|list|daily)$/) || [])[1] || 'premium';
  const ptype = String(proxyType || 'proxy_sock_5').trim() || 'proxy_sock_5';
  const isHttps = ptype === 'proxy_https';
  const qty = clampPoolCount(count, 5, 100);

  const form = new URLSearchParams();
  form.set('user_name', user);
  form.set('api_token', tok);
  form.set('qty', String(qty));
  if (cc) form.set('country', cc);
  if (String(state || '').trim()) form.set('state', String(state).trim());
  if (String(city || '').trim()) form.set('city', String(city).trim());
  if (ep === 'premium') form.set('proxy_type', ptype); else form.set('sock_type', 'residential');

  let text;
  try {
    text = await httpRequestText(`https://shopsocks5.com/socks/${ep}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
      timeoutMs: 30000
    });
  } catch (e) { throw new Error(`ShopSocks5 API error: ${e.message}`); }

  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new Error('ShopSocks5: the API did not return JSON - verify the username + token.'); }
  if (!parsed || parsed.success === false) {
    const msg = (parsed && parsed.message) || 'request failed';
    if (/too fast|slow/i.test(msg)) throw new Error('ShopSocks5: rate limited ("Too fast, please slowly") - wait ~10 seconds and pull again.');
    throw new Error(`ShopSocks5: ${msg} - check your account username + API token, and that the chosen country/type has stock.`);
  }

  // Items look like { sock_ip: "host:port", user_name, password, proxy_type: "SOCKS5 Proxy",
  // country_code, country, city, states }. Plain {ip/host, port}, packed combos and bare strings
  // are tolerated too.
  const list = Array.isArray(parsed.response) ? parsed.response : (Array.isArray(parsed) ? parsed : []);
  const rows = [];
  for (const it of list) {
    let host, port, u, pw, rowCc, scheme, place;
    if (typeof it === 'string') {
      const parts = it.split(':'); host = parts[0]; port = parts[1]; u = parts[2]; pw = parts[3];
    } else if (it && typeof it === 'object') {
      host = it.ip || it.host || it.server;
      port = it.port;
      u = it.user || it.username || it.login || it.user_name;
      pw = it.pass || it.password || it.passwd;
      rowCc = it.country_code || it.geo || it.country; // prefer 2-letter code over full name
      scheme = String(it.proxy_type || '');
      place = [it.city, it.states].filter(Boolean).join(', ');
      // ShopSocks5 packs host:port into `sock_ip` ("1.2.3.4:7998").
      const combo = [it.sock_ip, it.socks, it.socks5, it.proxy, it.ip_port, it.proxy_address]
        .find((v) => typeof v === 'string' && v.includes(':'));
      if ((!host || !port) && combo) { const p = combo.split(':'); host = host || p[0]; port = port || p[1]; u = u || p[2]; pw = pw || p[3]; }
    }
    const pnum = Number.parseInt(String(port), 10);
    if (!host || !Number.isFinite(pnum)) continue;
    const rc = normCountryCode(rowCc) || cc || null;
    // Honor the scheme the API reports; otherwise fall back to the requested type.
    let rtype = isHttps ? 'HTTP' : 'SOCKS5';
    if (/socks/i.test(scheme || '')) rtype = 'SOCKS5'; else if (/https?/i.test(scheme || '')) rtype = 'HTTP';
    const labelGeo = [rc, place].filter(Boolean).join(' ') || String(host).trim();
    rows.push({
      type: rtype, host: String(host).trim(), port: pnum,
      username: u ? String(u).trim() : null, password: pw != null ? String(pw) : null,
      label: `ShopSocks5 • ${labelGeo}`, country: rc
    });
  }
  if (!rows.length) throw new Error('ShopSocks5: the API returned no usable proxies (try a different country/state, or check your stock).');
  return rows.slice(0, 200);
}

// ---- DataImpulse ----
// GET /api/list (Basic Auth) returns ready `login:password@host:port` lines with targeting applied,
// stored as-is. Each plan has its own login, so `plan` only labels rows; it is not an API parameter.
const DI_API = 'https://gw.dataimpulse.com:777/api';
const DI_PRODUCTS = Object.freeze({
  residential: 'Residential', residential_premium: 'Residential Premium',
  mobile: 'Mobile', datacenter: 'Datacenter'
});
function diAuthHeaders(username, password) {
  const user = String(username || '').trim();
  const pw = String(password || '');
  if (!user) throw new Error('DataImpulse: the plan login is required (dashboard, open the product, proxy credentials).');
  if (!pw) throw new Error('DataImpulse: the plan password is required.');
  return { Authorization: `Basic ${Buffer.from(`${user}:${pw}`).toString('base64')}` };
}

// GET /api/stats. Doubles as the credential check: a wrong login is an auth error here
// rather than an empty list later.
async function diPlanStats(headers) {
  let stats = null;
  try {
    stats = JSON.parse(await httpRequestText(`${DI_API}/stats`, { headers }));
  } catch (e) {
    throw new Error(`DataImpulse credential check failed: ${e.message}`);
  }
  if (stats && stats.status && String(stats.status).toLowerCase() !== 'ok') {
    throw new Error(`DataImpulse credential check failed: ${stats.message || 'the gateway rejected these credentials.'}`);
  }
  return stats || {};
}

async function fetchDataImpulsePool({ username, password, country, state, city, zip, asn, excludeCountries, excludeAsns, count, life, plan, poolType, proxyType, existingPorts }) {
  const headers = diAuthHeaders(username, password);

  // Verify via /api/stats first so a wrong login is an auth error and an exhausted plan is named as such.
  const stats = await diPlanStats(headers);
  const left = Number(stats && stats.traffic_left);
  if (Number.isFinite(left) && left <= 0) {
    throw new Error('DataImpulse: this plan has no traffic left, so anything pulled from it would fail on first use.');
  }

  const cc = normCountryCode(country);
  const n = clampPoolCount(count, 5, 200);
  const sticky = String(poolType || '').toLowerCase() === 'sticky';
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const rowType = socks ? 'SOCKS5' : 'HTTP';
  const ttl = Number.parseInt(String(life), 10);
  const product = DI_PRODUCTS[String(plan || '').toLowerCase()] || DI_PRODUCTS.residential;

  // A rotating pull returns the same endpoint N times (the IP changes per request), so ask for one row.
  // Sticky rows each pin their own session and port, so ask for N.
  const want = sticky ? n : 1;
  const qs = new URLSearchParams();
  qs.set('quantity', String(want));
  qs.set('type', sticky ? 'sticky' : 'rotating');
  qs.set('protocol', socks ? 'socks5' : 'http');
  // The API takes lower-case ISO country codes ("us"), and omitting it means global.
  if (cc) qs.set('countries', cc.toLowerCase());
  // An unknown state, city, zip or ASN comes back as an empty list, which the guard below reports.
  const st = csvFilter(state, FILTER_PATTERNS.text);
  const ct = csvFilter(city, FILTER_PATTERNS.text);
  const zp = csvFilter(zip, FILTER_PATTERNS.zip);
  const as = asnList(asn);
  const exCc = csvFilter(excludeCountries, FILTER_PATTERNS.country).toLowerCase();
  const exAs = asnList(excludeAsns);
  if (st) qs.set('states', st);
  if (ct) qs.set('cities', ct);
  if (zp) qs.set('zipcodes', zp);
  if (as) qs.set('asns', as);
  if (exCc) qs.set('exclude_countries', exCc);
  if (exAs) qs.set('exclude_asns', exAs);
  // session_ttl is minutes and only means anything for sticky sessions.
  if (sticky && Number.isFinite(ttl) && ttl > 0) qs.set('session_ttl', String(ttl));

  // parseLoginList collapses repeats on the pool's dedupe identity, so a rotating endpoint listed
  // five times reports one proxy instead of "Added: 1, Existing: 4".
  const pullList = async () => {
    let text;
    try {
      text = await httpRequestText(`${DI_API}/list?${qs.toString()}`, { headers });
    } catch (e) {
      throw new Error(`DataImpulse list error: ${e.message}`);
    }
    return parseLoginList(text);
  };

  let parsed = await pullList();
  if (!parsed.length) {
    throw new Error('DataImpulse returned no usable proxies. Try a different country, or check the plan still has traffic.');
  }

  // Sticky ports are handed out deterministically from 10000, so request N more than the ports
  // already held for this base login (before "__", where targeting goes) and keep only new ones.
  // Reusing a port could put two profiles on the same exit IP.
  let have = new Set();
  if (sticky && typeof existingPorts === 'function') {
    const first = parsed[0];
    have = await existingPorts({ host: first.host, login: first.username.split('__')[0] });
    if (have.size > 0) {
      qs.set('quantity', String(have.size + n));
      parsed = await pullList();
    }
  }

  const fresh = parsed.filter((r) => !have.has(r.port)).slice(0, want);
  const rows = fresh.map((r) => ({
    type: rowType,
    host: r.host, port: r.port, username: r.username, password: r.password,
    label: sticky
      ? `DataImpulse • ${product} • ${cc || 'Global'} • sticky • port ${r.port}`
      : `DataImpulse • ${product} • ${cc || 'Global'} • rotating gateway`,
    country: cc || null
  }));
  if (!rows.length) {
    if (sticky && have.size) {
      throw new Error(`DataImpulse has no more sticky ports for these settings. The pool already holds ${have.size}.`);
    }
    throw new Error('DataImpulse returned no usable proxies. Try a different country, or check the plan still has traffic.');
  }
  if (sticky && rows.length < n) {
    // The vendor caps how many sessions it can pin for this filter; say so on the first row's label.
    rows[0].label += ` (${rows.length} of ${n} available)`;
  }
  return rows;
}

// DataImpulse sticky proxies use ports 10000+ under one plan login (rotating is port 823).
// GET /api/rotate_ip?port=N with the plan login's Basic Auth gives that port a fresh exit IP;
// the vendor requires 30 s between resets. The plan login is the username before "__".
function isDataImpulseSticky(proxy) {
  return Boolean(proxy)
    && String(proxy.provider || '').toLowerCase() === 'dataimpulse'
    && /(^|\.)dataimpulse\.com$/i.test(String(proxy.host || ''))
    && Number(proxy.port) >= 10000
    && Boolean(proxy.username) && Boolean(proxy.password);
}

async function rotateDataImpulseSticky(proxy) {
  const headers = diAuthHeaders(String(proxy.username).split('__')[0], proxy.password);
  const started = Date.now();
  let body = null;
  try {
    body = JSON.parse(await httpRequestText(`${DI_API}/rotate_ip?port=${encodeURIComponent(String(proxy.port))}`, { headers }));
  } catch (e) {
    // A reset inside the 30 s window returns HTTP 500 with a JSON "message"; a new sticky session
    // (for example after its lifetime expires) starts that window too.
    const vendor = /"message"\s*:\s*"([^"]+)"/.exec(String((e && e.message) || ''));
    if (vendor) throw new Error(`DataImpulse: ${vendor[1]}. Wait 30 seconds after the last change on this proxy, then try again.`);
    throw new Error(`DataImpulse rotation failed: ${scrubProxySecrets(e.message, proxy)}`);
  }
  if (!body || String(body.status || '').toLowerCase() !== 'ok') {
    throw new Error(`DataImpulse refused the rotation: ${(body && body.message) || 'no reason given'}. One port can be reset at most once every 30 seconds.`);
  }
  return { ok: true, status: 200, latencyMs: Date.now() - started, response: String(body.message || 'ok'), provider: 'dataimpulse' };
}

// Plan stats plus a live geo breakdown for the provider panel; pool counts come from
// /api/pool_stats_with_parameters and groupby is limited to the documented values.
const DI_GROUPBY = new Set(['country', 'state', 'city', 'asn', 'zip']);
async function lookupDataImpulse({ username, password, country, groupby }) {
  const headers = diAuthHeaders(username, password);
  const stats = await diPlanStats(headers);
  const out = {
    provider: 'dataimpulse',
    totalBytes: Number(stats.total_traffic) || 0,
    usedBytes: Number(stats.traffic_used) || 0,
    leftBytes: Number(stats.traffic_left) || 0,
    geo: []
  };
  const by = String(groupby || '').toLowerCase();
  if (DI_GROUPBY.has(by)) {
    const qs = new URLSearchParams({ groupby: by, limit: '500' });
    const cc = normCountryCode(country);
    if (cc) qs.set('countries', cc.toLowerCase());
    let pool = null;
    try {
      pool = JSON.parse(await httpRequestText(`${DI_API}/pool_stats_with_parameters?${qs.toString()}`, { headers }));
    } catch (e) {
      throw new Error(`DataImpulse location lookup failed: ${e.message}`);
    }
    out.geo = (Array.isArray(pool && pool.items) ? pool.items : [])
      .filter((it) => it && it.key != null)
      .map((it) => ({ key: String(it.key), label: String(it.label || it.key), count: Number(it.value) || 0 }));
  }
  return out;
}

// ---- Proxy-Seller ----
// API v2 takes the key in the URL path, so never log a request URL; mask errors with maskProxySellerKey.
// A residential list is one login with up to 1000 ports, each its own exit IP; errors come as HTTP 200.
const PS_API = 'https://proxy-seller.com/personal/api/v2';
const PS_MAX_PORTS = 1000;

function psKey(token) {
  const key = String(token || '').trim();
  if (!key) throw new Error('Proxy-Seller: the API key is required (dashboard, API section).');
  // The key becomes a URL path segment, so refuse anything that would change the path.
  if (!/^[^\s/?#%\\]{8,200}$/.test(key)) throw new Error('Proxy-Seller: that does not look like an API key. Copy it again from the dashboard, API section.');
  return key;
}

async function psRequest(key, method, pathAndQuery, what, { body, binary } = {}) {
  try {
    return await httpRequestText(`${PS_API}/${key}/${pathAndQuery}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: '*/*' },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: 30000,
      binary,
      maxBytes: binary ? 8_000_000 : undefined
    });
  } catch (e) {
    throw new Error(`Proxy-Seller ${what}: ${maskProxySellerKey((e && e.message) || 'request failed', key)}`);
  }
}

async function psCall(key, method, pathAndQuery, what, body) {
  return unwrapProxySeller(await psRequest(key, method, pathAndQuery, what, { body }), what, key);
}

async function psPackage(key) {
  const pkg = await psCall(key, 'GET', 'resident/package', 'package check');
  if (!pkg || typeof pkg !== 'object') throw new Error('Proxy-Seller: the package check returned nothing.');
  return pkg;
}

function psRotationLabel(rotation) {
  const r = Number(rotation);
  if (r === -1) return 'sticky';
  if (r === 0) return 'new IP per request';
  if (Number.isFinite(r) && r > 0) return `rotates every ${r}s`;
  return 'rotation unknown';
}

// Per-IP products (IPv6, IPv4, ISP, Mobile, Mix) are orders of N addresses, each with its own HTTP
// and SOCKS5 port on the entry host. Nothing is created: the pull reads proxy/list/{type}.
async function fetchProxySellerOrderPool(key, { product, proxyType, orderId, count, existingPorts }) {
  const label = PROXY_SELLER_ORDER_TYPES[product];
  const qs = new URLSearchParams();
  const oid = String(orderId || '').trim();
  if (/^[A-Za-z0-9_-]{1,40}$/.test(oid)) qs.set('orderId', oid);
  const query = qs.toString();
  const data = await psCall(key, 'GET', `proxy/list/${product}${query ? `?${query}` : ''}`, `${label} list`);
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const rows = proxySellerOrderRows(data && data.items, { socks, label: `Proxy-Seller • ${label}` });
  if (!rows.length) {
    // An order serves one protocol (an HTTPS order has an empty port_socks), so name the mismatch.
    const other = proxySellerOrderRows(data && data.items, { socks: !socks });
    if (other.length) {
      const want = socks ? 'SOCKS5' : 'HTTP';
      const protos = [...new Set((data.items || []).map((it) => it && it.protocol).filter(Boolean).map(String))].join(', ');
      throw new Error(`Proxy-Seller: these ${label} proxies have no ${want} port${protos ? ` (the order's protocol is ${protos})` : ''}. Pull them as ${socks ? 'HTTP' : 'SOCKS5'} instead.`);
    }
    throw new Error(`Proxy-Seller: this account has no active ${label} proxies${oid ? ' in that order' : ''}.`);
  }
  // An order can hold hundreds of addresses: skip those already pooled and take the next "How many".
  // A blank count imports the whole order.
  let fresh = rows;
  if (typeof existingPorts === 'function') {
    const held = new Map();
    const kept = [];
    for (const r of rows) {
      const k = `${r.host}\u0000${r.username}`;
      if (!held.has(k)) held.set(k, await existingPorts({ host: r.host, login: r.username }).catch(() => new Set()));
      if (!held.get(k).has(r.port)) kept.push(r);
    }
    fresh = kept;
  }
  if (!fresh.length) throw new Error(`Proxy-Seller: every ${label} proxy on this account is already in your pool.`);
  const wanted = count != null && String(count).trim() !== '' ? clampPoolCount(count, 5, 5000) : 5000;
  return fresh.slice(0, wanted).map((r) => ({
    type: r.type, host: r.host, port: r.port, username: r.username, password: r.password,
    label: r.label, country: null, rotationUrl: r.rotationUrl
  }));
}

async function fetchProxySellerPool({ token, country, state, city, count, poolType, life, proxyType, listId, plan, orderId, existingPorts }) {
  const key = psKey(token);
  const product = String(plan || 'residential').toLowerCase();
  if (PROXY_SELLER_ORDER_TYPES[product]) {
    return fetchProxySellerOrderPool(key, { product, proxyType, orderId, count, existingPorts });
  }
  const pkg = await psPackage(key);
  if (pkg.is_active === false) throw new Error('Proxy-Seller: the residential package on this account is not active.');
  const left = Number(pkg.traffic_left);
  if (Number.isFinite(left) && left <= 0) {
    throw new Error('Proxy-Seller: the residential package has no traffic left, so anything pulled from it would fail on first use.');
  }

  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  let list = null;
  const wantedId = Number.parseInt(String(listId || ''), 10);
  if (Number.isInteger(wantedId) && wantedId > 0) {
    const data = await psCall(key, 'GET', 'resident/lists', 'list lookup');
    list = proxySellerListItems(data).find((it) => Number(it && it.id) === wantedId) || null;
    if (!list) throw new Error('Proxy-Seller: that list is no longer on the account. Reload the lists and pick again.');
  } else {
    const cc = normCountryCode(country);
    const region = cc ? String(state || '').trim().slice(0, 120) : '';
    const town = region ? String(city || '').trim().slice(0, 120) : '';
    const geo = {};
    if (cc) geo.country = cc;
    if (region) geo.region = region;
    if (town) geo.city = town;
    const rotation = proxySellerRotation(poolType, life);
    const title = `SoftGlaze ${[cc || 'Global', region, town].filter(Boolean).join(' ')} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    list = await psCall(key, 'POST', 'resident/list/add', 'list create', {
      title: title.slice(0, 100),
      // A blank whitelist means login/password auth; a whitelist would tie the list to this machine's IP.
      whitelist: '',
      geo,
      export: { ports: clampPoolCount(count, 5, PS_MAX_PORTS), ext: 'txt' },
      rotation
    });
    if (!list || !list.id) throw new Error('Proxy-Seller: the list was not created (the API returned no list id).');
  }

  const qs = new URLSearchParams({
    ext: '%login%:%password%@%ip%:%port%',
    proto: socks ? 'socks5' : 'https',
    listId: String(list.id)
  });
  const text = await psRequest(key, 'GET', `proxy/download/resident?${qs.toString()}`, 'download');
  const parsed = parseLoginList(text);
  if (!parsed.length) {
    // A JSON body here is an error envelope, so let it speak before the generic message.
    if (String(text).trim().startsWith('{')) unwrapProxySeller(text, 'download', key);
    throw new Error(`Proxy-Seller returned no proxies for list "${list.title || list.id}". It is saved on your account, so pick it under Existing list and pull again in a minute.`);
  }

  const geo = proxySellerListGeo(list && list.geo);
  const cc = normCountryCode(geo.country);
  const where = [cc || 'Global', geo.city || geo.region].filter(Boolean).join(' ');
  const rotation = psRotationLabel(list.rotation);
  return parsed.slice(0, PS_MAX_PORTS).map((r) => ({
    type: socks ? 'SOCKS5' : 'HTTP',
    host: r.host, port: r.port, username: r.username, password: r.password,
    label: `Proxy-Seller • Residential • ${where} • ${rotation} • port ${r.port}`,
    country: cc || null
  }));
}

// Residential geo database: the v2 docs say a ZIP with one JSON file, the SDK READMEs say plain
// JSON, so both are handled. It changes rarely, so the parsed copy is cached for 6 hours.
let psGeoCache = { at: 0, data: null };
async function psGeoDatabase(key) {
  if (psGeoCache.data && Date.now() - psGeoCache.at < 6 * 60 * 60 * 1000) return psGeoCache.data;
  const buf = await psRequest(key, 'GET', 'resident/geo', 'location list', { binary: true });
  const text = buf.toString('utf8').trim();
  let data;
  if (text.startsWith('{')) {
    // An envelope: an error throws here, a success may carry the array as data.
    data = unwrapProxySeller(text, 'location list', key);
  } else if (text.startsWith('[')) {
    data = JSON.parse(text);
  } else {
    const extractZip = require('extract-zip');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sg-psgeo-'));
    try {
      const zipPath = path.join(dir, 'geo.zip');
      await fs.writeFile(zipPath, buf);
      const outDir = path.join(dir, 'out');
      await extractZip(zipPath, { dir: outDir, onEntry: (entry) => require('./extractArchive').assertSafeZipEntry(entry, outDir) }); // extract-zip needs an absolute dir
      const files = (await fs.readdir(outDir, { recursive: true })).map(String).filter((f) => f.toLowerCase().endsWith('.json'));
      if (!files.length) throw new Error('Proxy-Seller location list: the download held no JSON file.');
      data = JSON.parse(await fs.readFile(path.join(outDir, files[0]), 'utf8'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  if (!Array.isArray(data)) throw new Error('Proxy-Seller location list: unexpected format.');
  psGeoCache = { at: Date.now(), data };
  return data;
}

async function lookupProxySeller({ token, country, groupby }) {
  const key = psKey(token);
  // One call covers every per-IP product and proves the key works, even with no residential package.
  const all = await psCall(key, 'GET', 'proxy/list', 'proxy list');
  const products = summarizeProxySellerOrders(all);
  // The residential package is optional: "Tarif not found" just means there is none.
  let pkg = null;
  let listData = null;
  try {
    pkg = await psPackage(key);
    listData = await psCall(key, 'GET', 'resident/lists', 'list lookup');
  } catch (e) {
    if (!/no active residential package/i.test(String(e && e.message))) throw e;
  }
  const out = {
    provider: 'proxyseller',
    residential: Boolean(pkg),
    products,
    totalBytes: pkg ? Number(pkg.traffic_limit) || 0 : 0,
    usedBytes: pkg ? Number(pkg.traffic_usage) || 0 : 0,
    leftBytes: pkg ? Number(pkg.traffic_left) || 0 : 0,
    expiresAt: pkg && pkg.expired_at ? String(pkg.expired_at) : null,
    active: pkg ? pkg.is_active !== false : false,
    lists: proxySellerListItems(listData).map((it) => {
      const geo = proxySellerListGeo(it.geo);
      return {
        id: Number(it.id),
        title: String(it.title || `List ${it.id}`),
        country: geo.country ? String(geo.country) : '',
        region: geo.region ? String(geo.region) : '',
        city: geo.city ? String(geo.city) : '',
        rotation: psRotationLabel(it.rotation)
      };
    }).filter((l) => Number.isInteger(l.id) && l.id > 0),
    geo: []
  };
  const by = String(groupby || '').toLowerCase();
  if (by === 'country' || by === 'region') {
    out.geo = proxySellerGeoView(await psGeoDatabase(key), by === 'region' ? country : '');
  }
  return out;
}

// ---- IPRoyal residential (resi-api.iproyal.com/v1, Bearer token) ----
// Targeting and the sticky session live in the password (_country-us_session-..._lifetime-30m), so
// sticky rows differ only by password. Random rotation lines are all one endpoint, so ask for one.
const IPR_API = 'https://resi-api.iproyal.com/v1';
const IPR_MAX_COUNT = 500;

async function iprCall(token, method, pathAndQuery, what, body) {
  const t = String(token || '').trim();
  if (!t) throw new Error('IPRoyal: the API token is required (Dashboard, Settings, API).');
  let text;
  try {
    text = await httpRequestText(`${IPR_API}${pathAndQuery}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: 30000,
      maxBytes: 20_000_000
    });
  } catch (e) {
    const raw = String((e && e.message) || 'request failed');
    throw new Error(`IPRoyal ${what}: ${ipRoyalErrorMessage(raw) || raw.split(t).join('***')}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`IPRoyal ${what}: the API did not return JSON.`);
  }
}

async function fetchIpRoyalPool({ token, username, password, subuserHash, country, state, city, count, poolType, life, proxyType }) {
  const me = await iprCall(token, 'GET', '/residential/me', 'account check');
  const gb = Number(me && me.available_traffic);
  if (Number.isFinite(gb) && gb <= 0) {
    throw new Error('IPRoyal: this account has no residential traffic left, so anything pulled from it would fail on first use.');
  }
  const sticky = String(poolType || '').toLowerCase() === 'sticky';
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const nodes = await iprCall(token, 'GET', '/access/entry-nodes', 'entry nodes');
  const port = pickIpRoyalPort(nodes, socks);
  if (!port) throw new Error(`IPRoyal: the account lists no ${socks ? 'SOCKS5' : 'HTTP'} entry port.`);

  const n = clampPoolCount(count, 5, IPR_MAX_COUNT);
  const lifetime = ipRoyalLifetime(life);
  const body = {
    format: '{hostname}:{port}:{username}:{password}',
    rotation: sticky ? 'sticky' : 'random',
    port: port.name,
    proxy_count: sticky ? n : 1
  };
  if (sticky) body.lifetime = lifetime;
  const location = ipRoyalLocation({ country, state, city });
  if (location) body.location = location;
  const hash = String(subuserHash || '').trim();
  if (/^[A-Za-z0-9]{26}$/.test(hash)) {
    body.subuser_hash = hash;
  } else {
    const user = String(username || '').trim();
    const pw = String(password || '');
    if (!user || !pw) throw new Error('IPRoyal: pick a sub-user, or enter the proxy username and password from the dashboard.');
    body.username = user;
    body.password = pw;
  }

  const lines = await iprCall(token, 'POST', '/access/generate-proxy-list', 'proxy list', body);
  const cc = normCountryCode(country);
  const rows = [];
  const seen = new Set();
  for (const line of Array.isArray(lines) ? lines : []) {
    const r = parseIpRoyalLine(line);
    if (!r) continue;
    const key = `${r.host}:${r.port}:${r.username}:${r.password}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host: r.host, port: r.port, username: r.username, password: r.password,
      label: sticky
        ? `IPRoyal • Residential • ${cc || 'Global'} • sticky ${lifetime}${r.session ? ` • ${r.session}` : ''}`
        : `IPRoyal • Residential • ${cc || 'Global'} • rotating gateway`,
      country: cc || null,
      // Sticky rows differ only by password, so the pool must compare it when deduping.
      dedupeOnPassword: true
    });
  }
  if (!rows.length) throw new Error('IPRoyal returned no usable proxies. Try another location, or check the account still has traffic.');
  return rows;
}

let iprCountriesCache = { key: '', at: 0, data: null };
async function lookupIpRoyal({ token, country, groupby }) {
  const me = await iprCall(token, 'GET', '/residential/me', 'account check');
  const subs = await iprCall(token, 'GET', '/residential-subusers?page=1&per_page=100', 'sub-user list');
  const gb = Number(me && me.available_traffic) || 0;
  const out = {
    provider: 'iproyal',
    leftBytes: Math.round(gb * 1024 ** 3),
    totalBytes: 0,
    subusersCount: Number(me && me.subusers_count) || 0,
    // Never send the sub-user password to the renderer; the generate call accepts the hash.
    subusers: (subs && Array.isArray(subs.data) ? subs.data : [])
      .filter((s) => s && /^[A-Za-z0-9]{26}$/.test(String(s.hash || '')))
      .map((s) => ({ hash: String(s.hash), username: String(s.username || ''), trafficGb: Number(s.traffic_available) || 0, shared: s.is_using_shared_traffic === true })),
    geo: [],
    cities: []
  };
  const by = String(groupby || '').toLowerCase();
  if (by === 'country' || by === 'region') {
    const cacheKey = require('node:crypto').createHash('sha256').update(String(token)).digest('hex');
    if (!(iprCountriesCache.data && iprCountriesCache.key === cacheKey && Date.now() - iprCountriesCache.at < 60 * 60 * 1000)) {
      iprCountriesCache = { key: cacheKey, at: Date.now(), data: await iprCall(token, 'GET', '/access/countries', 'location list') };
    }
    const view = ipRoyalCountriesView(iprCountriesCache.data, by === 'region' ? country : '');
    out.geo = by === 'region' ? view.states : view.countries;
    out.cities = by === 'region' ? view.cities : [];
  }
  return out;
}

// ---- MarsProxies residential (api.marsproxies.com, Bearer token) ----
// generate-proxy-list returns "host:port:user:pass" strings. The API unlocks after 1 GB of
// residential traffic; ISP, datacenter and mobile have no documented API. Not live-key tested.
const MARS_API = 'https://api.marsproxies.com';
const MARS_GATEWAY = 'ultra.marsproxies.com';

async function marsCall(token, method, pathAndQuery, what, body, raw) {
  const t = String(token || '').trim();
  if (!t) throw new Error('MarsProxies: the API token is required (Dashboard, Settings, API).');
  let text;
  try {
    text = await httpRequestText(`${MARS_API}${pathAndQuery}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: 30000,
      maxBytes: 20_000_000
    });
  } catch (e) {
    const rawMsg = String((e && e.message) || 'request failed').split(t).join('***');
    if (/HTTP 401\b/.test(rawMsg)) throw new Error('MarsProxies: the API token was rejected. Copy it again from Dashboard, Settings, API.');
    if (/HTTP 403\b/.test(rawMsg)) throw new Error('MarsProxies: the residential API is not enabled on this account yet. It unlocks after at least 1 GB of residential traffic is purchased.');
    if (/HTTP 429\b/.test(rawMsg)) throw new Error('MarsProxies: the API rate limit was reached. Wait a minute and try again.');
    const m = /"message"\s*:\s*"([^"]+)"/.exec(rawMsg);
    throw new Error(`MarsProxies ${what}: ${m ? m[1] : rawMsg}`);
  }
  if (raw) return text;
  try { return JSON.parse(text); } catch (e) { throw new Error(`MarsProxies ${what}: the API did not return JSON.`); }
}

async function fetchMarsProxiesPool({ token, username, password, subuserHash, country, state, city, count, poolType, life, proxyType, host }) {
  const me = await marsCall(token, 'GET', '/v1/residential/me', 'account check');
  const gb = Number(me && me.traffic_available);
  if (Number.isFinite(gb) && gb <= 0) {
    throw new Error('MarsProxies: this account has no residential traffic left, so anything pulled from it would fail on first use.');
  }
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  // An anti-detect profile wants a stable exit IP, so default to sticky sessions.
  const rotating = String(poolType || '').toLowerCase() === 'rotating';
  const lifetime = ipRoyalLifetime(life); // same {n}s/{n}m/{n}h rule as IPRoyal
  const n = clampPoolCount(count, 5, 1000);
  const body = {
    format: '{hostname}:{port}:{username}:{password}',
    hostname: String(host || '').trim() || MARS_GATEWAY,
    port: socks ? 'socks5' : 'http',
    rotation: rotating ? 'random' : 'sticky',
    proxy_count: rotating ? 1 : n
  };
  if (!rotating) body.lifetime = lifetime;
  const location = marsProxiesLocation({ country, state, city });
  if (location) body.location = location;
  const hash = String(subuserHash || '').trim();
  if (hash) {
    body.subuser_hash = hash;
  } else {
    const u = String(username || '').trim();
    const pw = password != null ? String(password) : '';
    if (u && pw) { body.username = u; body.password = pw; }
    else {
      // No sub-user supplied: use the first one on the account.
      const subs = await marsCall(token, 'GET', '/v1/residential/subusers/', 'sub-users');
      const items = Array.isArray(subs) ? subs : (subs && Array.isArray(subs.data) ? subs.data : []);
      const first = items.find((s) => s && (s.hash || (s.username && s.password))) || null;
      if (first && first.hash) body.subuser_hash = String(first.hash);
      else if (first) { body.username = String(first.username); body.password = String(first.password); }
      else throw new Error('MarsProxies: no sub-user on this account. Create one in the dashboard, or enter a proxy username and password.');
    }
  }
  const text = await marsCall(token, 'POST', '/v1/residential/access/generate-proxy-list', 'proxy list', body, true);
  const parsed = parseMarsProxiesList(text);
  if (!parsed.length) throw new Error('MarsProxies returned no proxies. Check the token, that the account has residential traffic, and the location.');
  const cc = normCountryCode(country);
  return parsed.map((r) => ({
    type: socks ? 'SOCKS5' : 'HTTP',
    host: r.host, port: r.port, username: r.username, password: r.password,
    label: rotating
      ? `MarsProxies • Residential • ${cc || 'Global'} • rotating gateway`
      : `MarsProxies • Residential • ${cc || 'Global'} • sticky ${lifetime}`,
    country: cc || null,
    dedupeOnPassword: !rotating
  }));
}

// ---- NodeMaven (gateway gate.nodemaven.com, targeting in the username) ----
// No list endpoint: each row is "<login>-country-..-type-<residential|mobile>-sid-<id>", using the
// dashboard proxy login (the account API key is not used). Not live-key tested.
const NODEMAVEN_GATEWAY = Object.freeze({ host: 'gate.nodemaven.com', http: 8080, socks: 1080 });

function nodeMavenTtlFromMinutes(life) {
  const m = Number.parseInt(String(life || ''), 10);
  if (!Number.isFinite(m) || m <= 0) return '';
  return m % 60 === 0 ? `${m / 60}h` : `${m}m`;
}

async function fetchNodeMavenPool({ username, password, country, state, city, session, count, poolType, proxyType, life }) {
  const login = String(username || '').trim();
  const pass = password != null ? String(password) : '';
  if (!login || !pass) throw new Error('NodeMaven: enter your proxy username and password (dashboard, Proxy Setup). The account API key is separate and is not used here.');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const host = NODEMAVEN_GATEWAY.host;
  const port = socks ? NODEMAVEN_GATEWAY.socks : NODEMAVEN_GATEWAY.http;
  const type = String(poolType || '').toLowerCase() === 'mobile' ? 'mobile' : 'residential';
  const cc = normCountryCode(country);
  const ttl = nodeMavenTtl(nodeMavenTtlFromMinutes(life));
  const n = clampPoolCount(count, 1, 200);
  const fixed = String(session || '').trim();
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const sid = fixed ? (n > 1 ? `${fixed}${i}` : fixed) : crypto.randomBytes(6).toString('hex');
    const user = nodeMavenUsername(login, { country: cc, region: state, city, type, sid, ttl });
    if (!user) continue;
    const key = `${host}:${port}:${user}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username: user, password: pass,
      label: `NodeMaven • ${type === 'mobile' ? 'Mobile' : 'Residential'} • ${cc || 'Global'} • sid ${sid}`,
      country: cc || null
    });
  }
  if (!rows.length) throw new Error('NodeMaven: could not build any proxies. Check the username and country.');
  return rows;
}

// Froxy (SOAX reseller, proxy.froxy.com:9000): rows use the dashboard Filter login, since the API
// needs an email login. A country makes the password "<type>;<cc>;;<region>;<city>".
// TODO: confirm the sticky-session delimiter against a live key.
const FROXY_GATEWAY = Object.freeze({ host: 'proxy.froxy.com', port: 9000 });

async function fetchFroxyPool({ username, password, country, state, city, count, poolType, proxyType }) {
  const login = String(username || '').trim();
  const base = froxyBasePassword(password);
  if (!login) throw new Error('Froxy: enter the Login from the subscription page (Manage, Login/Password Access).');
  if (!base) throw new Error('Froxy: enter the Password from the same page. Only the part before the first ";" is used; the app adds the country.');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const kindLabel = (() => {
    const p = String(poolType || '').toLowerCase();
    if (p === 'mobile') return 'Mobile';
    if (p === 'datacenter' || p === 'fast') return 'Datacenter';
    return 'Residential';
  })();
  const cc = normCountryCode(country);
  const pw = froxyPassword(base, { country: cc, region: state, city, poolType });
  // One row per port: each port 9000-9199 is a separate session (its own exit IP).
  const n = clampPoolCount(count, 1, 200);
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host: FROXY_GATEWAY.host, port: FROXY_GATEWAY.port + i, username: login, password: pw,
      label: `Froxy • ${kindLabel} • ${cc || 'Any country'} • port ${FROXY_GATEWAY.port + i}`,
      country: cc || null,
      dedupeOnPassword: true // country and pool type ride in the password
    });
  }
  return rows;
}

// ---- PacketStream (proxy.packetstream.io; HTTP 31112, SOCKS5 31113) ----
// No API: rows are minted locally, with country and sticky session in the password.
const PACKETSTREAM_GATEWAY = Object.freeze({ host: 'proxy.packetstream.io', http: 31112, socks: 31113 });

async function fetchPacketStreamPool({ username, password, country, session, count, proxyType }) {
  const login = String(username || '').trim();
  const base = password != null ? String(password) : '';
  if (!login) throw new Error('PacketStream: enter your username (dashboard, Network Access).');
  if (!base) throw new Error('PacketStream: enter your proxy password (dashboard, Network Access, Proxy Password).');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const host = PACKETSTREAM_GATEWAY.host;
  const port = socks ? PACKETSTREAM_GATEWAY.socks : PACKETSTREAM_GATEWAY.http;
  const cc = normCountryCode(country);
  // A country PacketStream does not list would be dropped from the password and exit anywhere.
  if (cc && !packetStreamCountry(cc)) throw new Error(`PacketStream has no exits in ${cc}. Pick another country, or Any.`);
  const where = cc || 'Random';
  // A blank session with How many > 1 mints that many sticky sessions; with 1 it stays rotating.
  const fixed = String(session || '').trim() || (clampPoolCount(count, 1, 100) > 1 ? `sg${crypto.randomBytes(3).toString('hex')}` : '');
  if (!fixed) {
    // Rotating: one gateway row, a fresh IP per request.
    const pw = packetStreamPassword(base, { country: cc });
    return [{
      type: socks ? 'SOCKS5' : 'HTTP', host, port, username: login, password: pw,
      label: `PacketStream • ${where} • rotating`, country: cc || null, dedupeOnPassword: true
    }];
  }
  // Sticky: mint `count` rows, each pinned to its own session id (one exit IP per profile).
  const n = clampPoolCount(count, 1, 100);
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const sid = n > 1 ? `${fixed}${i + 1}` : fixed;
    const pw = packetStreamPassword(base, { country: cc, session: sid });
    const key = `${host}:${port}:${login}:${pw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP', host, port, username: login, password: pw,
      label: `PacketStream • ${where} • sticky ${sid}`, country: cc || null, dedupeOnPassword: true
    });
  }
  if (!rows.length) throw new Error('PacketStream: could not build any proxies.');
  return rows;
}

// ---- Airproxy (dedicated mobile, list pull) ----
// GET /api/proxy/list/?key=<KEY> returns the account's proxies, one SIM each. Rotation (change_ip)
// is not wired, so the account key is never stored in a rotation URL.
const AIRPROXY_API = 'https://airproxy.io/api/proxy';

// "How many" caps a list pull instead of minting more; blank or 0 keeps the whole list.
// A list of proxies the account already owns passes max = Infinity: How many only trims what exists.
function limitListRows(rows, count, max = 500) {
  const raw = String(count == null ? '' : count).trim();
  if (!raw || !/^\d+$/.test(raw) || Number(raw) <= 0) return rows;
  return rows.slice(0, clampPoolCount(raw, rows.length, max));
}

async function fetchAirproxyPool({ token, count }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('Airproxy: enter your API key (dashboard, API section).');
  let text;
  try {
    text = await httpRequestText(`${AIRPROXY_API}/list/?key=${encodeURIComponent(key)}`, { headers: { Accept: 'application/json' } });
  } catch (error) {
    const status = error && error.status;
    if (status === 401 || status === 403) throw new Error('Airproxy rejected the API key. Copy it again from the dashboard API section.');
    throw new Error('Airproxy: could not read the proxy list. Check your connection and try again.');
  }
  const rows = airproxyRows(text);
  if (!rows.length) throw new Error('Airproxy: no active proxies on this account. Confirm a proxy is assigned and the API key is correct.');
  return limitListRows(rows, count);
}

// ---- CatProxies ----
// The cp_ key and a Plan ID fetch GET /orders/:id for the login; targeting rides in the username.
// US gateways only: the EU/Asia hostnames are unconfirmed. Fixed-IP plans use fetchCatProxiesFixedIps.
const CATPROXIES_API = 'https://catproxies.com/api/v1/user';
const CATPROXIES_PRODUCTS = Object.freeze({
  // Residential splits rotating (9000/11000) and sticky (10000/12000) port ranges; the gateway
  // rejects a -session- username on the rotating range (catproxies.com/docs/api).
  residential: { code: 'v2resi', host: 'resi-us.catproxies.com', http: 9000, socks: 11000, stickyHttp: 10000, stickySocks: 12000, mobile: false, kind: 'Residential' },
  mobile: { code: 'rotatingmobile', host: 'mobile-us.catproxies.com', http: 5000, socks: 5000, mobile: true, kind: 'Mobile' }
});

async function fetchCatProxiesPool({ token, orderId, poolType, country, state, city, session, life, count, proxyType }) {
  const key = String(token || '').trim();
  if (!/^cp_[A-Za-z0-9]{8,128}$/.test(key)) throw new Error('CatProxies: enter your API key (dashboard, My Account, API). It starts with cp_.');
  const product = CATPROXIES_PRODUCTS[String(poolType || '').toLowerCase()] || CATPROXIES_PRODUCTS.residential;
  const id = String(orderId || '').trim();
  if (!/^[0-9a-fA-F-]{8,40}$/.test(id)) throw new Error('CatProxies: paste the Plan ID from the dashboard (Active Plans → the plan you want to use).');
  const pool = String(poolType || '').toLowerCase();
  if (pool === 'isp' || pool === 'datacenter') return fetchCatProxiesFixedIps({ key, id, pool, country, state, city, session, count, proxyType });
  let json;
  try {
    const text = await httpRequestText(`${CATPROXIES_API}/orders/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    json = JSON.parse(text);
  } catch (error) {
    const status = error && error.status;
    if (status === 401 || status === 403) throw new Error('CatProxies rejected the API key. Copy it again from My Account, API.');
    if (status === 404) throw new Error('CatProxies: no plan with that Plan ID on this account. Check it in Active Plans.');
    throw new Error('CatProxies: could not read the plan. Check your connection and try again.');
  }
  const { username, password, bandwidthLeft } = catProxiesCreds(json);
  if (!username || !password) throw new Error('CatProxies: that plan returned no proxy credentials. Confirm the Plan ID matches the chosen product and the plan is active.');
  if (bandwidthLeft === 0) throw new Error('CatProxies: that plan has no bandwidth left, so its proxies would fail on first use.');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  if (socks && product.mobile) throw new Error('CatProxies: Rotating Mobile is HTTP only. Switch Protocol to HTTP.');
  const type = socks ? 'SOCKS5' : 'HTTP';
  const port = socks && !product.mobile ? product.socks : product.http;
  const cc = normCountryCode(country);
  const where = cc || 'Worldwide';
  const lifeMin = Number(life);
  const resiLife = Number.isInteger(lifeMin) && lifeMin > 0 ? lifeMin : 30;
  const buildUser = (sid) => product.mobile
    ? catProxiesMobileUsername(username, { country: cc, city, session: sid, ttlMin: lifeMin })
    : catProxiesResiUsername(username, { country: cc, state, city, session: sid, lifetimeMin: resiLife });
  // A blank session with How many > 1 mints that many sticky sessions; with 1 it stays rotating.
  const fixed = String(session || '').trim() || (clampPoolCount(count, 1, 100) > 1 ? `sg${crypto.randomBytes(3).toString('hex')}` : '');
  if (!fixed) {
    const user = buildUser('');
    return [{ type, host: product.host, port, username: user, password, label: `CatProxies • ${product.kind} • ${where} • rotating`, country: cc || null, dedupeOnPassword: true }];
  }
  const n = clampPoolCount(count, 1, 100);
  const stickyPort = product.mobile ? port : (socks ? product.stickySocks : product.stickyHttp);
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const sid = n > 1 ? `${fixed}${i + 1}` : fixed;
    const user = buildUser(sid);
    const dkey = `${product.host}:${stickyPort}:${user}`;
    if (seen.has(dkey)) continue;
    seen.add(dkey);
    rows.push({ type, host: product.host, port: stickyPort, username: user, password, label: `CatProxies • ${product.kind} • ${where} • ${sid}`, country: cc || null, dedupeOnPassword: true });
  }
  if (!rows.length) throw new Error('CatProxies: could not build any proxies.');
  return rows;
}

// Fixed-IP products are imported as a list; the IP sets the location, so targeting is refused, not ignored.
async function fetchCatProxiesFixedIps({ key, id, pool, country, state, city, session, count, proxyType }) {
  const isp = pool === 'isp';
  const kind = isp ? 'ISP' : 'Datacenter';
  if (String(state || '').trim() || String(city || '').trim() || String(session || '').trim() || (isp && String(country || '').trim())) {
    throw new Error(isp
      ? 'CatProxies: ISP IPs are fixed when you buy them. Clear Country, State, City and Sticky session.'
      : 'CatProxies: Datacenter IPs are fixed, so only Country applies. Clear State, City and Sticky session.');
  }
  const rawCountry = String(country || '').trim();
  const cc = normCountryCode(rawCountry);
  if (rawCountry && !cc) throw new Error(`CatProxies: "${rawCountry}" is not a country code.`);
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const url = isp ? `${CATPROXIES_API}/generator/isp?orderId=${encodeURIComponent(id)}` : `${CATPROXIES_API}/orders/${encodeURIComponent(id)}`;
  let json;
  try {
    json = JSON.parse(await httpRequestText(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, maxBytes: 16_000_000 }));
  } catch (error) {
    const status = error && error.status;
    if (status === 401 || status === 403) throw new Error('CatProxies rejected the API key. Copy it again from My Account, API.');
    if (status === 404) throw new Error('CatProxies: no plan with that Plan ID on this account. Check it in Active Plans.');
    if (status === 429) throw new Error('CatProxies: too many requests (1000 an hour). Wait and pull again.');
    throw new Error(`CatProxies: could not read that plan. Check your connection, and that the Plan ID is a ${kind} plan.`);
  }
  let rows;
  if (isp) {
    const res = catProxiesIspRows(json, { socks });
    if (res.pending) throw new Error('CatProxies: this plan is still being set up. Wait a few seconds and pull again.');
    rows = res.rows;
  } else {
    if (catProxiesCreds(json).bandwidthLeft === 0) throw new Error('CatProxies: that plan has no bandwidth left, so its proxies would fail on first use.');
    rows = catProxiesDatacenterRows(json, { socks });
  }
  if (!rows.length) throw new Error(`CatProxies: that plan returned no ${kind} proxies. Confirm the Plan ID matches the chosen product and the plan is active. A new plan can take a few seconds.`);
  const picked = cc ? rows.filter((r) => r.country === cc) : rows;
  if (!picked.length) {
    const have = [...new Set(rows.map((r) => r.country).filter(Boolean))].join(', ');
    throw new Error(`CatProxies: no IPs in ${cc} on that plan.${have ? ` It has ${have}.` : ''}`);
  }
  return limitListRows(picked, count);
}

// Optional host/port override (some accounts get a regional or per-plan gateway). Only a bare
// hostname and a valid port pass, so a pasted URL or credential never becomes a host.
function gatewayOverride(host, port, def, label) {
  const h = String(host || '').trim();
  const p = port != null && String(port).trim() !== '' ? Number.parseInt(String(port), 10) : def.port;
  if (h && !/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(h)) throw new Error(`${label}: the gateway host must be a hostname like ${def.host}, without http:// or a port.`);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`${label}: the gateway port must be a number from 1 to 65535.`);
  return { host: h || def.host, port: p };
}

// Mint `count` sticky rows (one session id each) or a single rotating row, for vendors whose
// targeting lives in the username. buildUser(sid) returns the full username for that session.
// `max` caps How many; a vendor with no documented session limit passes MINTED_PULL_MAX.
function mintGatewayRows({ type, host, port, password, session, count, buildUser, label, max = 100 }) {
  // A blank session with How many > 1 mints that many sticky sessions; with 1 it stays rotating.
  const fixed = String(session || '').trim() || (clampPoolCount(count, 1, 100) > 1 ? `sg${crypto.randomBytes(3).toString('hex')}` : '');
  if (!fixed) {
    return [{ type, host, port, username: buildUser(''), password, label: `${label} • rotating`, dedupeOnPassword: true }];
  }
  const n = clampPoolCount(count, 1, max);
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const sid = n > 1 ? `${fixed}${i + 1}` : fixed;
    const user = buildUser(sid);
    const key = `${host}:${port}:${user}`;
    if (!user || seen.has(key)) continue;
    seen.add(key);
    rows.push({ type, host, port, username: user, password, label: `${label} • sticky ${sid}`, dedupeOnPassword: true });
  }
  return rows;
}

// ---- RapidProxy (rotating residential) ----
// No management API: rows are minted from a dashboard sub-account, with targeting in the username.
// Default gateway us.rapidproxy.io:5001; other regional nodes go through the override.
const RAPIDPROXY_GATEWAY = Object.freeze({ host: 'us.rapidproxy.io', port: 5001 });

async function fetchRapidProxyPool({ username, password, country, state, city, session, life, count, host, port, poolType }) {
  const sub = String(username || '').trim();
  const pw = password != null ? String(password) : '';
  if (!sub || /[\s:@]/.test(sub)) throw new Error('RapidProxy: enter the sub-account username from the dashboard (Residential → sub-accounts).');
  if (!pw) throw new Error('RapidProxy: enter the sub-account password.');
  const cc = normCountryCode(country);
  if (String(city || '').trim() && !String(state || '').trim()) throw new Error('RapidProxy: city targeting needs a state as well (for example State California, City LosAngeles).');
  if (String(state || '').trim() && !cc) throw new Error('RapidProxy: pick a country before a state.');
  const gw = gatewayOverride(host, port, RAPIDPROXY_GATEWAY, 'RapidProxy');
  const where = cc || 'Global';
  const rows = mintGatewayRows({
    // SOCKS5 runs on the same host:port.
    type: String(poolType || '').toLowerCase() === 'socks5' ? 'SOCKS5' : 'HTTP', host: gw.host, port: gw.port, password: pw, session, count,
    buildUser: (sid) => rapidProxyUsername(sub, { country: cc, state, city, session: sid, lifeMin: Number(life) }),
    label: `RapidProxy • ${where}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('RapidProxy: could not build any proxies.');
  return rows;
}

// ---- NOVADA (residential / rotating ISP / mobile) ----
// Rows use a proxy user (not the login email); zone, geo and sticky session ride in the username.
// Default super.novada.pro:7777; a regional host such as pr-as.novada.pro goes through the override.
const NOVADA_GATEWAY = Object.freeze({ host: 'super.novada.pro', port: 7777 });

async function fetchNovadaPool({ username, password, poolType, country, state, city, session, life, count, host, port }) {
  const user = String(username || '').trim();
  const pw = password != null ? String(password) : '';
  if (!user || /[\s:@]/.test(user)) throw new Error('NOVADA: enter a proxy user from the dashboard (Residential Proxies → Users → Create Users). Your login email does not work here.');
  if (/-zone-/i.test(user)) throw new Error('NOVADA: enter only the proxy user name; the app adds -zone- and the targeting itself.');
  if (!pw) throw new Error('NOVADA: enter that proxy user\'s password.');
  const cc = normCountryCode(country);
  const gw = gatewayOverride(host, port, NOVADA_GATEWAY, 'NOVADA');
  const kind = { res: 'Residential', isp: 'Rotating ISP', mob: 'Mobile' }[NOVADA_ZONES[String(poolType || '').toLowerCase()] || 'res'];
  const rows = mintGatewayRows({
    type: 'HTTP', host: gw.host, port: gw.port, password: pw, session, count,
    buildUser: (sid) => novadaUsername(user, { poolType, country: cc, state, city, session: sid, lifeMin: Number(life) }),
    label: `NOVADA • ${kind} • ${cc || 'Global'}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('NOVADA: could not build any proxies.');
  return rows;
}

// Proxies.sx: the X-API-Key reads the gateway login (the account password never works there).
// A country is required and each row is failover-strict on one pool, so out of stock fails
// (E_NO_STOCK_COUNTRY) instead of exiting elsewhere. Sticky rows pin a sid; rotating rows have none.
const PROXIESSX_API = 'https://api.proxies.sx/v1';
const PROXIESSX_GATEWAY = Object.freeze({ host: 'gw.proxies.sx', http: 7000, socks: 7001 });

async function fetchProxiesSxPool({ token, poolType, country, session, count }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('Proxies.sx: enter your API key (client.proxies.sx → API keys).');
  const cc = normCountryCode(country);
  if (!cc) throw new Error('Proxies.sx: pick a country. The pool never picks one for you, so a country with no stock fails instead of exiting somewhere else.');
  let creds;
  try {
    const text = await httpRequestText(`${PROXIESSX_API}/account/proxy-password`, { headers: { 'X-API-Key': key, Accept: 'application/json' } });
    creds = proxiesSxProxyCreds(text);
  } catch (error) {
    const status = error && error.status;
    if (status === 401 || status === 403) throw new Error('Proxies.sx rejected the API key, or it lacks the account:read scope. Create a key with account:read and try again.');
    throw new Error('Proxies.sx: could not read the proxy credentials. Check your connection and try again.');
  }
  if (!/^psx_[a-z0-9]+$/i.test(creds.username) || !creds.password) {
    throw new Error('Proxies.sx: the account has no proxy password yet. Set one in the dashboard (Proxy password), then pull again.');
  }
  const pool = PROXIESSX_POOLS[String(poolType || '').toLowerCase()] ? String(poolType).toLowerCase() : 'mobile';
  const kind = pool === 'mobile' ? 'Mobile' : 'Residential';
  const rows = mintGatewayRows({
    type: 'HTTP', host: PROXIESSX_GATEWAY.host, port: PROXIESSX_GATEWAY.http, password: creds.password, session, count,
    buildUser: (sid) => proxiesSxUsername(creds.username, { poolType: pool, country: cc, sid: sid ? proxiesSxSid(sid) : '' }),
    label: `Proxies.sx • ${kind} • ${cc}`
  }).map((r) => ({ ...r, country: cc }));
  if (!rows.length) throw new Error('Proxies.sx: could not build any proxies.');
  return rows;
}

// ---- MobileProxy.Space (dedicated mobile, list pull) ----
// Rotation is the per-proxy change-IP link in the vendor dashboard and is not stored here.
// The API allows one identical request per ~5 s, so a quick second pull gets a "wait" message.
const MOBILEPROXYSPACE_API = 'https://mobileproxy.space/api.html';

async function fetchMobileProxySpacePool({ token, poolType, count }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('MobileProxy.Space: enter your API token (personal account → API).');
  let text;
  try {
    text = await httpRequestText(`${MOBILEPROXYSPACE_API}?command=get_my_proxy`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
  } catch (error) {
    const status = error && error.status;
    const msg = String(error && error.message || '');
    if (/too many/i.test(msg)) throw new Error('MobileProxy.Space: too many requests. Wait a few seconds and pull again.');
    if (status === 401 || status === 403) throw new Error('MobileProxy.Space rejected the API token. Copy it again from your personal account.');
    throw new Error('MobileProxy.Space: could not read your proxies. Check your connection and try again.');
  }
  const { error, rows } = mobileProxySpaceRows(text, { socks: String(poolType || '').toLowerCase() === 'socks5' });
  if (error) {
    if (/too many/i.test(error)) throw new Error('MobileProxy.Space: too many requests. Wait a few seconds and pull again.');
    if (/authori[sz]ation|token/i.test(error)) throw new Error('MobileProxy.Space rejected the API token. Copy it again from your personal account.');
    throw new Error(`MobileProxy.Space: ${error.slice(0, 160)}`);
  }
  if (!rows.length) throw new Error('MobileProxy.Space: no active proxies on this account yet. Buy or activate one, then pull again.');
  return limitListRows(rows, count);
}

// ---- Proxy-Solutions (anti-detect integration endpoint) ----
// The provider key is issued per account for anti-detect browsers. Pages of 200 are all read (up
// to a cap) and expired proxies are skipped.
const PROXYSOLUTIONS_API = 'https://proxy-solutions.net/api/proxies';

async function fetchProxySolutionsPool({ token, poolType, country, count }) {
  const key = String(token || '').trim();
  if (!key || !/^[A-Za-z0-9_-]{6,200}$/.test(key)) throw new Error('Proxy-Solutions: paste the Integration token from the API for developers page (not the API key).');
  const proto = String(poolType || '').toLowerCase() === 'socks5' ? 'socks' : 'http';
  const rows = [];
  const seen = new Set();
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, 25); page++) {
    let text;
    try {
      text = await httpRequestText(`${PROXYSOLUTIONS_API}/${encodeURIComponent(key)}?format=object&proto=${proto}&page=${page}&per_page=200`, { headers: { Accept: 'application/json' } });
    } catch (error) {
      const status = error && error.status;
      if (status === 401 || status === 403 || status === 404) throw new Error('Proxy-Solutions did not accept that key. Use the Integration token from the API for developers page, not the API key above it.');
      throw new Error('Proxy-Solutions: could not read your proxies. Check your connection and try again.');
    }
    const res = proxySolutionsPage(text);
    totalPages = res.totalPages;
    for (const r of res.rows) {
      const k = `${r.host}:${r.port}:${r.username}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(r);
    }
  }
  if (!rows.length) throw new Error('Proxy-Solutions: no active proxies on this account.');
  const cc = normCountryCode(country);
  const picked = cc ? rows.filter((r) => r.country === cc) : rows;
  if (!picked.length) {
    const have = [...new Set(rows.map((r) => r.country).filter(Boolean))].join(', ');
    throw new Error(`Proxy-Solutions: none of your proxies are in ${cc}.${have ? ` Your account has: ${have}.` : ''}`);
  }
  return limitListRows(picked, count);
}

// ---- Proxmint (pay-as-you-go residential / premium / mobile / datacenter) ----
// The read-only pmk_ key returns each product's gateway and login; targeting rides in the username.
// A pmk_ key cannot buy or change anything, so storing it carries no spending risk.
const PROXMINT_API = 'https://proxmint.com/api/v1';

async function fetchProxmintPool({ token, poolType, country, state, city, session, life, count, proxyType }) {
  const key = String(token || '').trim();
  if (!/^pmk_[A-Za-z0-9_-]{8,200}$/.test(key)) throw new Error('Proxmint: paste your API key (Settings, API keys). It starts with pmk_.');
  let json;
  try {
    const text = await httpRequestText(`${PROXMINT_API}/account`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': 'SoftGlaze-Browser' } });
    json = JSON.parse(text);
  } catch (error) {
    const status = error && error.status;
    if (status === 401) throw new Error('Proxmint rejected the API key. Create a new one under Settings, API keys.');
    if (status === 429) throw new Error('Proxmint: too many requests (60 a minute). Wait a moment and pull again.');
    throw new Error('Proxmint: could not read the account. Check your connection and try again.');
  }
  const prod = proxmintPickProduct(json, poolType);
  if (!prod.host || !prod.username || !prod.password) throw new Error('Proxmint: the account returned no proxy login for that product.');
  if (prod.remainingBytes === 0) throw new Error(`Proxmint: the ${prod.name} product has no bandwidth left, so its proxies would fail on first use.`);
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const port = socks ? prod.socksPort : prod.httpPort;
  if (!port) throw new Error(`Proxmint: no ${socks ? 'SOCKS5' : 'HTTP'} port on the ${prod.name} product.`);
  const cc = normCountryCode(country);
  const rows = mintGatewayRows({
    type: socks ? 'SOCKS5' : 'HTTP', host: prod.host, port, password: prod.password, session, count,
    buildUser: (sid) => proxmintUsername(prod.username, { country: cc, state, city, session: sid, ttlMin: life }),
    label: `Proxmint • ${prod.name} • ${cc || 'Worldwide'}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('Proxmint: could not build any proxies.');
  return rows;
}

// ---- IP Burger (rotating residential, gateway-minted) ----
// Country (or one city/state token) and session ride in the customer-<id> username. HTTP only:
// IPBurger offers no SOCKS5 on residential. Other hosts go through the override.
const IPBURGER_GATEWAY = Object.freeze({ host: 'residential.ipb.cloud', port: 7777 });

async function fetchIpBurgerPool({ username, password, country, state, city, session, life, count, host, port }) {
  const base = String(username || '').trim();
  const pw = password != null ? String(password) : '';
  if (!base) throw new Error('IP Burger: enter the proxy username from the dashboard (Proxy Users); it starts with customer-.');
  if (!pw) throw new Error('IP Burger: enter the proxy user password from the dashboard (not your account login).');
  const gw = gatewayOverride(host, port, IPBURGER_GATEWAY, 'IP Burger');
  const cc = normCountryCode(country);
  const rows = mintGatewayRows({
    type: 'HTTP', host: gw.host, port: gw.port, password: pw, session, count,
    buildUser: (sid) => ipBurgerUsername(base, { country: cc, state, city, session: sid, sesstimeMin: life }),
    label: `IP Burger • Residential • ${cc || 'Worldwide'}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('IP Burger: could not build any proxies.');
  return rows;
}

// ---- Proxy302 (dynamic residential, Open API; endpoints in proxyVendorUtils.js) ----
// Sign in with the API sub-account key, map the country to its numeric id, then request one proxy
// per call (each a distinct session); a run of duplicates stops the loop early.
const PROXY302_API = 'https://open.proxy302.com/open_api/v3';

async function fetchProxy302Pool({ username, password, country, count, proxyType }) {
  const keyName = String(username || '').trim();
  const keyPass = password != null ? String(password) : '';
  if (!keyName) throw new Error('Proxy302: enter the API key name from the Proxy302 backend (API, not your login email).');
  if (!keyPass) throw new Error('Proxy302: enter the API key password from the Proxy302 backend.');
  let token;
  try {
    const text = await httpRequestText(`${PROXY302_API}/user/users/token?username=${encodeURIComponent(keyName)}&password=${encodeURIComponent(keyPass)}`, { headers: { Accept: 'application/json' } });
    token = proxy302Token(text);
  } catch (error) {
    if (error && error.status === 401) throw new Error('Proxy302 rejected the API key. Generate a sub-account key in the backend and paste its name and password.');
    throw new Error(error && /^Proxy302/.test(String(error.message)) ? error.message : 'Proxy302: could not sign in to the API. Check your connection and the key.');
  }
  const cc = normCountryCode(country);
  let countryId = 0;
  if (cc) {
    try {
      const text = await httpRequestText(`${PROXY302_API}/proxy/area/country`, { headers: { Authorization: token, Accept: 'application/json' } });
      countryId = proxy302CountryId(text, cc);
    } catch (error) {
      throw new Error(error && /^Proxy302/.test(String(error.message)) ? error.message : 'Proxy302: could not read the country list to resolve the location.');
    }
    if (countryId == null) throw new Error(`Proxy302 does not list ${cc} in its country database. Pick another country, or leave it on Any.`);
  }
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const proto = socks ? 'socks5' : 'http';
  const n = clampPoolCount(count, 5, 50);
  const url = `${PROXY302_API}/proxy/api/proxy/dynamic/traffic?s=1&protocol=${proto}&country_id=${countryId}&state_id=0&city_id=0`;
  const rows = [];
  const seen = new Set();
  let dupes = 0;
  for (let i = 0; i < n && dupes < 3; i += 1) {
    let text;
    try {
      text = await httpRequestText(url, { method: 'POST', headers: { Authorization: token, Accept: 'application/json' } });
    } catch (error) {
      if (!rows.length) throw new Error(error && /^Proxy302/.test(String(error.message)) ? error.message : 'Proxy302: the proxy request failed. Check the key has API access and traffic left.');
      break; // keep the proxies already built
    }
    let row;
    try { row = proxy302Row(text, { socks, country: cc }); } catch (error) {
      if (!rows.length) throw error;
      break;
    }
    if (!row) continue;
    const key = `${row.host}:${row.port}:${row.username}`;
    if (seen.has(key)) { dupes += 1; continue; }
    seen.add(key); rows.push(row); dupes = 0;
  }
  if (!rows.length) throw new Error('Proxy302: the API returned no usable proxy. Check the key has traffic and API permission.');
  return rows;
}

// ---- Databay (residential / mobile / datacenter) ----
// One gateway port carries HTTP and SOCKS5; zone, location and sticky session ride in the username.
const DATABAY_GATEWAY = Object.freeze({ host: 'gw.databay.co', port: 8888 });

async function fetchDatabayPool({ username, password, poolType, country, state, city, session, life, count, proxyType, host, port }) {
  const user = String(username || '').trim();
  const pw = password != null ? String(password) : '';
  if (!user) throw new Error('Databay: enter your proxy user (dashboard, Proxy Users), not the login email.');
  if (/@/.test(user)) throw new Error('Databay: that looks like the account email. Use the proxy user from the dashboard, Proxy Users.');
  if (!pw) throw new Error('Databay: enter the proxy user password.');
  const gw = gatewayOverride(host, port, DATABAY_GATEWAY, 'Databay');
  const zone = ['residential', 'mobile', 'datacenter'].includes(String(poolType || '').toLowerCase()) ? String(poolType).toLowerCase() : 'residential';
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const cc = normCountryCode(country);
  const kind = zone.charAt(0).toUpperCase() + zone.slice(1);
  const rows = mintGatewayRows({
    type: socks ? 'SOCKS5' : 'HTTP', host: gw.host, port: gw.port, password: pw, session, count,
    buildUser: (sid) => databayUsername(user, { zone, country: cc, state, city, session: sid, lengthMin: life }),
    label: `Databay • ${kind} • ${cc || 'Worldwide'}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('Databay: could not build any proxies.');
  return rows;
}

// ---- IPFoxy (rotating residential, gateway-minted) ----
// Targeting rides in the username; gate-sg.ipfoxy.io (Asia-Pacific) goes through the override.
const IPFOXY_GATEWAY = Object.freeze({ host: 'gate-us.ipfoxy.io', port: 58688 });

async function fetchIpfoxyPool({ username, password, country, state, city, session, life, count, proxyType, host, port }) {
  const acct = String(username || '').trim();
  const pw = password != null ? String(password) : '';
  if (!acct) throw new Error('IPFoxy: enter the proxy account from the dashboard (Rotating Residential, account).');
  if (!pw) throw new Error('IPFoxy: enter the proxy account password.');
  const gw = gatewayOverride(host, port, IPFOXY_GATEWAY, 'IPFoxy');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const cc = normCountryCode(country);
  const rows = mintGatewayRows({
    type: socks ? 'SOCKS5' : 'HTTP', host: gw.host, port: gw.port, password: pw, session, count,
    buildUser: (sid) => ipfoxyUsername(acct, { country: cc, state, city, session: sid, ttlMin: life }),
    label: `IPFoxy • Residential • ${cc || 'Worldwide'}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('IPFoxy: could not build any proxies.');
  return rows;
}

// ---- MangoProxy (API connection-string generator) ----
// POST /upstream/json returns ready proxy URLs; a blank sub-account means the first one (GET /accounts).
const MANGOPROXY_API = 'https://backend.mangoproxy.com/public-api/v1';
const MANGOPROXY_TRAFFIC = Object.freeze(['residential', 'residential_light', 'datacenter', 'isp']);

async function mangoCall(key, method, pathName, body) {
  try {
    const text = await httpRequestText(`${MANGOPROXY_API}${pathName}`, {
      method,
      headers: { 'x-api-key': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return JSON.parse(text);
  } catch (error) {
    const status = error && error.status;
    if (status === 401 || status === 403) throw new Error('MangoProxy rejected the API key, or this product is not enabled on the account.');
    if (status === 429) throw new Error('MangoProxy: too many requests. Wait a moment and pull again.');
    if (status === 400) throw new Error('MangoProxy: the request was refused (check the sub-account and the chosen location).');
    throw new Error('MangoProxy: could not reach the API. Check your connection and try again.');
  }
}

async function fetchMangoProxyPool({ token, username, poolType, country, state, city, asn, life, count, proxyType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('MangoProxy: paste your API key (dashboard, API).');
  const cc = normCountryCode(country);
  const asnCode = mangoProxyAsn(asn);
  if (asnCode && !cc) throw new Error('MangoProxy: ASN targeting needs a country as well.');
  let sub = String(username || '').trim();
  if (!sub) {
    const accounts = await mangoCall(key, 'GET', '/accounts');
    const first = Array.isArray(accounts) ? accounts.find((a) => a && a.username) : null;
    if (!first) throw new Error('MangoProxy: this account has no proxy sub-accounts yet. Create one in the dashboard, then pull again.');
    sub = String(first.username);
  }
  const trafficType = MANGOPROXY_TRAFFIC.includes(String(poolType || '').toLowerCase()) ? String(poolType).toLowerCase() : 'residential';
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  // No per-pull limit is documented; each call makes up to 100 lines, so a big pull takes several.
  const n = clampPoolCount(count, 1, MINTED_PULL_MAX);
  const lifeMin = Number.parseInt(String(life), 10);
  const body = {
    trafficType,
    protocols: [socks ? 'socks5' : 'http'],
    subAccountUsername: sub,
    // More than one row needs sticky sessions, or every line is the same rotating gateway.
    sessionDuration: Number.isInteger(lifeMin) && lifeMin > 0 ? Math.min(120, lifeMin) : (n > 1 ? 30 : 0)
  };
  if (cc) {
    body.country = cc;
    const st = mangoProxyPlace(state);
    const ct = mangoProxyPlace(city);
    if (st) body.state = st;
    if (ct) body.city = ct;
    if (asnCode) body.asn = asnCode;
  }
  const collected = await mangoProxyCollect(n, (batch) => mangoCall(key, 'POST', '/upstream/json', { ...body, count: batch }), { socks });
  const rows = collected.map((r, i) => ({
    ...r, label: `MangoProxy • ${trafficType.replace('_', ' ')} • ${cc || 'Any country'} • #${i + 1}`, country: cc || null, dedupeOnPassword: true
  }));
  if (!rows.length) throw new Error(`MangoProxy returned no ${socks ? 'SOCKS5' : 'HTTP'} proxies for that request.`);
  return rows;
}

// ---- Proxidize (api.proxidize.com/api/v1, Bearer JWT) ----
// Per-Proxy plans return ready credentials. Per-GB plans give a sub-user with a sticky "-s-<session>"
// token on the Proxy Details gateway (20000 HTTP / 20002 SOCKS5). Not live-key tested.
const PROXIDIZE_API = 'https://api.proxidize.com/api/v1';

async function proxidizeCall(token, method, pathAndQuery, what, body) {
  const t = String(token || '').trim();
  if (!t) throw new Error('Proxidize: the API token is required (app.proxidize.com, Settings, API Token).');
  let text;
  try {
    text = await httpRequestText(`${PROXIDIZE_API}${pathAndQuery}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: 30000,
      maxBytes: 20_000_000
    });
  } catch (e) {
    const rawMsg = String((e && e.message) || 'request failed').split(t).join('***');
    if (/HTTP 401\b/.test(rawMsg)) throw new Error('Proxidize: the API token was rejected. Copy it again from app.proxidize.com, Settings, API Token.');
    if (/HTTP 429\b/.test(rawMsg)) throw new Error('Proxidize: the API rate limit was reached. Wait a minute and try again.');
    const m = /"message"\s*:\s*"([^"]+)"/.exec(rawMsg);
    throw new Error(`Proxidize ${what}: ${m ? m[1] : rawMsg}`);
  }
  try { return JSON.parse(text); } catch (e) { throw new Error(`Proxidize ${what}: the API did not return JSON.`); }
}

async function fetchProxidizePool({ token, username, host, country, state, city, session, count, poolType, proxyType }) {
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const user = String(username || '').trim();
  if (user) {
    // Per-Proxy plan: the list already carries ready credentials.
    const data = await proxidizeCall(token, 'GET', `/perproxy/proxies/${encodeURIComponent(user)}`, 'per-proxy list');
    const rows = parseProxidizePerProxy(data, { socks });
    if (!rows.length) throw new Error('Proxidize: no per-proxy proxies found for that username.');
    return rows.map((r) => ({
      type: r.type, host: r.host, port: r.port, username: r.username, password: r.password,
      label: `Proxidize • Mobile • ${r.ip || r.host} • port ${r.port}`,
      ...(r.rotationUrl ? { rotationUrl: r.rotationUrl } : {})
    }));
  }
  // Per-GB plan (mobile or residential). Needs the gateway host from Proxy Details.
  const kind = String(poolType || '').toLowerCase() === 'residential' ? 'residential' : 'mobile';
  await proxidizeCall(token, 'GET', `/pergb/${kind}/user-info`, 'account check');
  const aps = await proxidizeCall(token, 'GET', `/pergb/${kind}/access-point`, 'access points');
  const apList = Array.isArray(aps) ? aps : (aps && Array.isArray(aps.data) ? aps.data : []);
  const ap = apList.find((x) => x && x.username && x.password) || null;
  if (!ap) throw new Error(`Proxidize: no ${kind} access point on this account. Create one in the dashboard, then pull again.`);
  const gwHost = String(host || '').trim();
  if (!gwHost) throw new Error('Proxidize: for a Per-GB plan, put the gateway host from Proxy Details in the Host field. (A Per-Proxy plan needs the per-proxy username instead.)');
  const port = socks ? 20002 : 20000;
  const n = clampPoolCount(count, 1, 100);
  const rows = [];
  const seen = new Set();
  const fixed = String(session || '').trim();
  for (let i = 0; i < n; i++) {
    const sid = fixed ? (n > 1 ? `${fixed}${i}` : fixed) : crypto.randomBytes(5).toString('hex');
    // Geo tokens need exact values from /pergb/.../locations-proxy, so targeting uses the access
    // point's dashboard geo and only the sticky session is added here.
    const uname = proxidizePerGbUsername(String(ap.username), { session: sid });
    const key = `${gwHost}:${port}:${uname}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host: gwHost, port, username: uname, password: String(ap.password),
      label: `Proxidize • ${kind === 'residential' ? 'Residential' : 'Mobile'} • sticky`,
      country: null
    });
  }
  if (!rows.length) throw new Error('Proxidize: could not build any per-GB proxies.');
  return rows;
}

// ---- Live Proxies ----
// A pasted plan list URL already carries the access code, so a Bearer token is sent only if given.
async function fetchLiveProxiesPool({ apiUrl, token, username, password, country, session, count, proxyType, poolType }) {
  // Gateway mode (what the dashboard actually offers): username LV<id> + proxy password.
  if (String(username || '').trim()) return mintLiveProxiesRows({ username, password, country, session, count, proxyType, poolType });
  // Legacy: a pasted list link, still accepted for saved settings.
  const url = liveProxiesListUrl(apiUrl);
  if (!url) {
    throw new Error('Live Proxies: paste the proxy list URL from your dashboard (it must be an https liveproxies.io link).');
  }
  const t = String(token || '').trim();
  let text;
  try {
    text = await httpRequestText(url, {
      method: 'GET',
      headers: { Accept: 'text/plain, application/json;q=0.9, */*;q=0.8', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      timeoutMs: 30000,
      maxBytes: 20_000_000
    });
  } catch (e) {
    const raw = String((e && e.message) || 'request failed');
    throw new Error(`Live Proxies list: ${t ? raw.split(t).join('***') : raw}`);
  }
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const rows = liveProxiesRows(text, { socks, country, plan: poolType });
  if (!rows.length) {
    throw new Error('Live Proxies returned no usable proxies. Check the plan is active and that the link is the proxy list, not the dashboard page.');
  }
  return rows;
}

// Mirrors the dashboard's Proxy Generation panel: a blank session with How many 1 is one rotating
// row; otherwise sticky rows, each on its own b2b-s<N> server with a numeric 60-minute session.
function mintLiveProxiesRows({ username, password, country, session, count, proxyType, poolType }) {
  const acct = liveProxiesBaseUser(username);
  const pw = password != null ? String(password) : '';
  if (!acct) throw new Error('Live Proxies: enter the username from the dashboard (Proxy Information, for example LV58712).');
  if (!pw) throw new Error('Live Proxies: enter the proxy password from the dashboard (Proxy Information).');
  const cc = normCountryCode(country);
  if (!cc) throw new Error('Live Proxies: pick a country. Every Live Proxies line carries one (for example United States).');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const kind = liveProxiesPlanLabel(poolType);
  const n = clampPoolCount(count, 1, 100);
  const typed = String(session || '').replace(/\D/g, '').slice(0, 7);
  if (!typed && n <= 1) {
    return [{
      type: socks ? 'SOCKS5' : 'HTTP',
      host: socks ? LIVEPROXIES_GATEWAY.socksHost : LIVEPROXIES_GATEWAY.http,
      port: socks ? LIVEPROXIES_GATEWAY.socksPort : LIVEPROXIES_GATEWAY.port,
      username: liveProxiesUsername(acct, { country: cc }), password: pw,
      label: `Live Proxies • ${kind} • ${cc} • rotating`, country: cc
    }];
  }
  const rows = [];
  for (let i = 0; i < n; i++) {
    // Up to 8 digits: a typed session number keeps its digits and adds the index; a blank one
    // gets a random 6-digit id per row, like the dashboard.
    const sid = typed ? `${typed.slice(0, Math.max(1, 8 - String(n).length))}${i + 1}` : String(100000 + crypto.randomInt(0, 900000));
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host: socks ? LIVEPROXIES_GATEWAY.socksHost : liveProxiesStickyHost(i + 1),
      port: socks ? LIVEPROXIES_GATEWAY.socksPort : LIVEPROXIES_GATEWAY.port,
      username: liveProxiesUsername(acct, { country: cc, sid }), password: pw,
      label: `Live Proxies • ${kind} • ${cc} • sticky ${sid}`, country: cc
    });
  }
  return rows;
}

const VENDOR_LOOKUPS = Object.freeze({
  dataimpulse: lookupDataImpulse,
  proxyseller: lookupProxySeller,
  iproyal: lookupIpRoyal
});

// Read-only account view for the provider panel; never creates anything on the vendor side.
async function vendorLookup(payload) {
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const vendorKey = requiredString(input.provider, 'Provider').toLowerCase();
  const lookup = VENDOR_LOOKUPS[vendorKey];
  if (!lookup) throw new Error('This provider has no account lookup.');
  return lookup({
    token: optionalString(input.token) || '',
    username: optionalString(input.username),
    password: input.password != null ? String(input.password) : '',
    country: optionalString(input.country),
    groupby: optionalString(input.groupby)
  });
}

// ---- Provider account status (plan, expiry, traffic, balance) for the provider card ----
// Uses the saved credentials and returns only the summary, never a secret. The last result per
// provider is kept in the providerAccountCache setting, which only this gated handler reads.
async function readSavedProviderCreds(provider) {
  const stored = (await readProxyProviderCredMap())[provider];
  if (!stored || typeof stored !== 'object') return null;
  const out = {};
  for (const f of PROXY_CRED_PLAIN_FIELDS) if (stored[f] != null) out[f] = stored[f];
  for (const f of PROXY_CRED_SECRET_FIELDS) if (stored[f] != null) out[f] = secretStore.open(stored[f]);
  return out;
}

async function readProviderAccountCache() {
  const cache = await readSetting('providerAccountCache', {});
  return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
}

async function getProviderAccount(payload) {
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const provider = requiredString(input.provider, 'Provider').toLowerCase();
  if (!PROXY_VENDORS[provider]) throw new Error('Unknown proxy provider.');
  const supported = Boolean(providerAccount.accountAdapterFor(provider));
  const dashboardUrl = providerAccount.dashboardUrlFor(provider);
  if (input.cachedOnly || !supported) {
    const cached = supported ? (await readProviderAccountCache())[provider] : null;
    return { provider, supported, dashboardUrl, account: cached && typeof cached === 'object' ? cached : null };
  }
  const creds = await readSavedProviderCreds(provider);
  if (!creds) throw new Error(`${PROXY_VENDORS[provider]}: no saved credentials yet. Enter them on the Pull tab and save them first.`);
  const res = await providerAccount.checkProviderAccount(provider, creds, (url, opts = {}) => httpRequestText(url, {
    method: 'GET', headers: opts.headers || {}, timeoutMs: 20000, maxBytes: 8_000_000
  }));
  const account = { ...res.account, checkedAt: new Date().toISOString() };
  // Re-read just before writing so two checks at once keep both results.
  await writeSetting('providerAccountCache', { ...(await readProviderAccountCache()), [provider]: account });
  return { provider, supported: true, dashboardUrl, account };
}

// ---- 2extract (residential + mobile, gateway-minted) ----
// HTTP or SOCKS5 is set per proxy in the 2extract dashboard on one port, so Protocol must match it.
// The /change_ip link carries the proxy password, so it is never stored. Not live-key tested.
const TWOEXTRACT_GATEWAY = Object.freeze({ host: 'proxy.2extract.net', port: 5555 });

async function fetchTwoExtractPool({ username, password, country, state, city, zip, asn, session, life, count, proxyType, host, port }) {
  const pw = password != null ? String(password) : '';
  if (!twoExtractBaseUser(username)) throw new Error('2extract: enter the proxy username from Connection Details. It looks like 2xt-customer-<id>-proxy-<name>.');
  if (!pw) throw new Error('2extract: enter the proxy password from Connection Details.');
  const gw = gatewayOverride(host, port, TWOEXTRACT_GATEWAY, '2extract');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const cc = normCountryCode(country);
  const asnTag = String(asn || '').trim();
  const lifeMin = String(life == null ? '' : life).trim();
  // A chosen Keep same IP needs a session to apply to, even for a single row.
  const fixed = String(session || '').trim() || (lifeMin ? `sg${crypto.randomBytes(3).toString('hex')}` : '');
  const rows = mintGatewayRows({
    type: socks ? 'SOCKS5' : 'HTTP', host: gw.host, port: gw.port, password: pw, session: fixed, count, max: MINTED_PULL_MAX,
    buildUser: (sid) => twoExtractUsername(username, { country, state, city, zip, asn, session: sid, timeMin: sid ? lifeMin : '' }),
    label: `2extract • ${cc || (asnTag ? `ASN ${asnTag}` : 'Worldwide')}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('2extract: could not build any proxies.');
  return rows;
}

// ---- GonzoProxy (residential, mobile, datacenter; gateway-minted) ----
// Geo and session ride in the login. One row with no session rotates per request; more rows are
// sticky for Keep same IP (72h if blank). The pool is whatever the login belongs to (its selector
// parameter is undocumented). Not live-key tested.
const GONZOPROXY_GATEWAY = Object.freeze({ host: 'connect.gonzoproxy.app', port: 10000 });

async function fetchGonzoProxyPool({ username, password, country, state, city, session, life, count, proxyType, host, port }) {
  const pw = password != null ? String(password) : '';
  if (!gonzoProxyBaseLogin(username)) throw new Error('GonzoProxy: enter the login from Proxy Setup in your dashboard (letters and digits, for example Gonzoj9CiIi).');
  if (!pw) throw new Error('GonzoProxy: enter the proxy password from Proxy Setup.');
  const gw = gatewayOverride(host, port, GONZOPROXY_GATEWAY, 'GonzoProxy');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const cc = normCountryCode(country);
  const lifeMin = String(life == null ? '' : life).trim();
  // A chosen Keep same IP needs a session to apply to, even for a single row.
  const fixed = String(session || '').trim() || (lifeMin ? `sg${crypto.randomBytes(3).toString('hex')}` : '');
  const rows = mintGatewayRows({
    type: socks ? 'SOCKS5' : 'HTTP', host: gw.host, port: gw.port, password: pw, session: fixed, count, max: MINTED_PULL_MAX,
    buildUser: (sid) => gonzoProxyUsername(username, { country, state, city, session: sid, ttlMin: sid ? lifeMin : '' }),
    label: `GonzoProxy • ${cc || 'Unknown'}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('GonzoProxy: could not build any proxies.');
  return rows;
}

// ---- Simply Proxies (UK mobile, gateway-minted) ----
// SOCKS5 only: the other endpoint, :6889, needs TLS to the proxy, and this app talks plain-text HTTP
// to proxies (buildProxyServerArgument, proxyAgentScheme). Not live-key tested.
const SIMPLYPROXIES_GATEWAY = Object.freeze({ host: 'proxy.simplyproxies.com', socks: 6890 });

async function fetchSimplyProxiesPool({ username, password, poolType, country, session, life, count }) {
  const pw = password != null ? String(password) : '';
  if (!String(username || '').trim()) throw new Error('Simply Proxies: enter the proxy username from your dashboard.');
  if (!pw) throw new Error('Simply Proxies: enter the proxy password from your dashboard.');
  const cc = String(country || '').trim().toUpperCase();
  if (cc && cc !== 'GB') throw new Error(`Simply Proxies only has UK exits, not ${cc}.`);
  const minutes = String(life == null ? '' : life).trim();
  // A chosen Keep same IP needs a session to apply to, even for a single row.
  const fixed = String(session || '').trim() || (minutes ? `sg${crypto.randomBytes(3).toString('hex')}` : '');
  const net = String(poolType || '').toLowerCase();
  const rows = mintGatewayRows({
    type: 'SOCKS5', host: SIMPLYPROXIES_GATEWAY.host, port: SIMPLYPROXIES_GATEWAY.socks, password: pw, session: fixed, count, max: MINTED_PULL_MAX,
    buildUser: (sid) => simplyProxiesUsername(username, { network: poolType, session: sid, minutes: sid ? minutes : '' }),
    label: `Simply Proxies • UK${SIMPLYPROXIES_NETWORKS.includes(net) ? ` • ${net === 'o2' ? 'O2' : net === 'ee' ? 'EE' : net.charAt(0).toUpperCase() + net.slice(1)}` : ''}`
  }).map((r) => ({ ...r, country: 'GB' }));
  if (!rows.length) throw new Error('Simply Proxies: could not build any proxies.');
  return rows;
}

// ---- Coronium (dedicated mobile, list pull) ----
// The key goes in the Bearer header, never ?auth_token. No rotation link is stored, since fetching
// one changes the IP. Rows carry only an opaque country id, so the health check fills the country.
const CORONIUM_API = 'https://api.coronium.io/api/v3';

async function fetchCoroniumPool({ token, count, proxyType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('Coronium: paste your API key (Dashboard, Account, API Access).');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  let text;
  try {
    text = await httpRequestText(`${CORONIUM_API}/account/proxies`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, maxBytes: 8_000_000 });
  } catch (error) {
    const status = error && error.status;
    if (status === 401 || status === 403) throw new Error('Coronium rejected the API key. Copy it again from Dashboard, Account, API Access.');
    if (status === 429) throw new Error('Coronium: too many requests. Wait a moment and pull again.');
    throw new Error('Coronium: could not read the proxy list. Check your connection and try again.');
  }
  const { rows, total, expired } = coroniumRows(text, { socks });
  if (!rows.length) {
    if (!total) throw new Error('Coronium: no proxies on this account yet.');
    if (expired === total) throw new Error('Coronium: every proxy on this account has expired. Renew one and pull again.');
    throw new Error(`Coronium: none of the proxies on this account has usable ${socks ? 'SOCKS5' : 'HTTP'} details. Try the other protocol.`);
  }
  return limitListRows(rows, count, Infinity);
}

// ---- Singapore Mobile Proxy (dedicated mobile, list pull) ----
// Rotation is not wired and rotation_link is never stored. Rows carry no country (other locations
// are sold too), so the health check fills it. Not live-key tested.
const SINGAPOREMOBILEPROXY_API = 'https://singaporemobileproxy.com/api/v1';

async function fetchSingaporeMobileProxyPool({ token, count, proxyType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('Singapore Mobile Proxy: paste the API key from your client dashboard.');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  let text;
  try {
    text = await httpRequestText(`${SINGAPOREMOBILEPROXY_API}/proxies/my`, { headers: { 'x-api-key': key, Accept: 'application/json' } });
  } catch (error) {
    const status = error && error.status;
    if (status === 401 || status === 403) throw new Error('Singapore Mobile Proxy rejected the API key. Use a client key from the dashboard; reseller keys do not work here.');
    if (status === 429) throw new Error('Singapore Mobile Proxy: too many requests (60 a minute). Wait a moment and pull again.');
    throw new Error('Singapore Mobile Proxy: could not read the proxy list. Check your connection and try again.');
  }
  const { rows, total, inactive, noLogin } = singaporeMobileProxyRows(text, { socks });
  if (!rows.length) {
    if (!total) throw new Error('Singapore Mobile Proxy: no proxies on this account yet.');
    if (inactive === total) throw new Error('Singapore Mobile Proxy: no active proxies on this account. Renew one and pull again.');
    if (noLogin) throw new Error('Singapore Mobile Proxy: your active proxies have no username and password set. Add a login in the dashboard and pull again.');
    throw new Error(`Singapore Mobile Proxy: none of your active proxies has usable ${socks ? 'SOCKS5' : 'HTTP'} details.`);
  }
  return limitListRows(rows, count);
}

// ---- Gsocks (residential + mobile, list pull) ----
// Reads existing lists and their text exports; nothing is bought. Rows are HTTP because the docs name
// no SOCKS5 port. Targeting is fixed when a list is made in the Gsocks panel. Not live-key tested.
// Auth is "authorization: key <api_key>" (the docs' rule and header tables); their curl samples show
// "session <jwt>", the dashboard's own login token, which an API key is not.
const GSOCKS_API = 'https://api.gsocks.net';
// GET /proxy documents no maximum page size, so pages use the size from its own example.
const GSOCKS_PAGE_SIZE = 20;
const GSOCKS_MAX_PAGES = 50;
const GSOCKS_POOLS = Object.freeze({
  residential: { query: 'residential', path: 'residential-proxy-list', kind: 'Residential' },
  mobile: { query: 'mobile', path: 'mobile-proxy-list', kind: 'Mobile' }
});

async function fetchGsocksPool({ token, poolType, count }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('Gsocks: paste the API key from your dashboard.');
  const pool = GSOCKS_POOLS[String(poolType || '').toLowerCase()];
  if (!pool) throw new Error('Gsocks: pick Residential or Mobile. Other types have no documented proxy list to import.');
  const call = async (url) => {
    try {
      return await httpRequestText(url, { headers: { authorization: `key ${key}`, Accept: 'application/json, text/plain' }, maxBytes: 8_000_000 });
    } catch (error) {
      const status = error && error.status;
      if (status === 401 || status === 403) throw new Error('Gsocks rejected the API key. Create a new one in your dashboard and paste it again.');
      if (status === 429) throw new Error('Gsocks: too many requests. Wait a moment and pull again.');
      throw new Error('Gsocks: could not read the proxy list. Check your connection and try again.');
    }
  };
  const ids = [];
  let listed = 0;
  for (let page = 1; page <= GSOCKS_MAX_PAGES; page += 1) {
    const res = gsocksProxyIds(await call(`${GSOCKS_API}/proxy?type=${pool.query}&active=active&limit=${GSOCKS_PAGE_SIZE}&page=${page}`));
    ids.push(...res.ids);
    listed += res.listed;
    if (!res.listed || listed >= res.total) break;
  }
  if (!listed) throw new Error(`Gsocks: no active ${pool.kind.toLowerCase()} proxies on this account. Create one in the Gsocks panel first.`);
  if (!ids.length) throw new Error('Gsocks: the account returned proxies without a readable id, so their lists cannot be fetched.');
  const cap = /^[1-9]\d*$/.test(String(count == null ? '' : count).trim()) ? Number(count) : Infinity;
  const rows = [];
  const seen = new Set();
  for (const id of ids) {
    if (rows.length >= cap) break;
    for (const r of gsocksListRows(await call(`${GSOCKS_API}/proxy/${pool.path}/${encodeURIComponent(id)}`), { kind: pool.kind, id })) {
      const k = `${r.host}:${r.port}:${r.username}:${r.password}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(r);
    }
  }
  if (!rows.length) throw new Error('Gsocks: the proxy lists came back with no host:port:user:pass lines to import.');
  return limitListRows(rows, count, Infinity);
}

// ---- Proxy Bonanza (static IPs, list pull) ----
// One API key returns every IP on the active plans. Not live-key tested.
const PROXYBONANZA_API = 'https://proxybonanza.com/api/v1';

async function fetchProxyBonanzaPool({ token, country, count, proxyType }) {
  const key = String(token || '').trim();
  if (!/^[^\s!]{8,}![0-9]+$/.test(key)) throw new Error('Proxy Bonanza: paste the full API key from Account settings, API Key, including the !<user id> at its end.');
  const rawCountry = String(country || '').trim();
  const cc = normCountryCode(rawCountry);
  if (rawCountry && !cc) throw new Error(`Proxy Bonanza: "${rawCountry}" is not a country code.`);
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  let text;
  try {
    // The docs warn this list is not paginated and can be large.
    text = await httpRequestText(`${PROXYBONANZA_API}/userpackages-ippacks.json`, { headers: { Authorization: key, Accept: 'application/json' }, maxBytes: 32_000_000, timeoutMs: 30000 });
  } catch (error) {
    const status = error && error.status;
    if (status === 401 || status === 403) throw new Error('Proxy Bonanza rejected the API key. Copy it again from Account settings, API Key.');
    throw new Error('Proxy Bonanza: could not read the proxy list. Check your connection and try again.');
  }
  const { rows, error, total } = proxyBonanzaRows(text, { socks });
  if (error) throw new Error(`Proxy Bonanza: ${error}`);
  if (!rows.length) {
    throw new Error(total ? `Proxy Bonanza: none of your proxies has usable ${socks ? 'SOCKS5' : 'HTTP'} details. Try the other protocol.` : 'Proxy Bonanza: no proxies on your active plans.');
  }
  const picked = cc ? rows.filter((r) => r.country === cc) : rows;
  if (!picked.length) {
    const have = [...new Set(rows.map((r) => r.country).filter(Boolean))].join(', ');
    throw new Error(`Proxy Bonanza: no proxies in ${cc} on your plans.${have ? ` You have ${have}.` : ''}`);
  }
  return limitListRows(picked, count, Infinity);
}

// ---- PROXY6 (static IPv4 + IPv6, list pull) ----
// Read-only: buy, prolong and delete are never called. The key is in the URL path, so errors map
// to fixed messages that never echo the URL. Not live-key tested.
const PROXY6_API = 'https://px6.link/api';
const PROXY6_PAGE_SIZE = 1000; // getproxy's documented maximum per page
const PROXY6_PAGE_GAP_MS = 350; // the API allows 3 requests a second

async function fetchProxy6Pool({ token, country, count, proxyType }) {
  const key = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(key)) throw new Error('PROXY6: paste the API key from your account.');
  const rawCountry = String(country || '').trim();
  const cc = normCountryCode(rawCountry);
  if (rawCountry && !cc) throw new Error(`PROXY6: "${rawCountry}" is not a country code.`);
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const want = /^[1-9]\d*$/.test(String(count == null ? '' : count).trim()) ? Number(count) : Infinity;
  const rows = [];
  const seen = new Set();
  let listed = 0;
  let skippedProtocol = 0;
  for (let page = 1; page <= 50; page += 1) {
    if (page > 1) await sleepMs(PROXY6_PAGE_GAP_MS);
    let text;
    try {
      text = await httpRequestText(`${PROXY6_API}/${encodeURIComponent(key)}/getproxy/?state=active&nokey&limit=${PROXY6_PAGE_SIZE}&page=${page}`, { headers: { Accept: 'application/json' }, maxBytes: 8_000_000 });
    } catch (error) {
      if (error && error.status === 429) throw new Error('PROXY6: too many requests (3 a second). Wait a moment and pull again.');
      throw new Error('PROXY6: could not read the proxy list. Check your connection and try again.');
    }
    const res = proxy6Page(text, { socks });
    if (res.error) throw new Error(res.error);
    listed += res.listCount;
    skippedProtocol += res.skippedProtocol;
    for (const r of res.rows) {
      const k = `${r.host}:${r.port}:${r.username}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(r);
    }
    if (res.listCount < PROXY6_PAGE_SIZE) break;
    // Enough proxies (in the chosen country) are in hand, so the next page is not needed.
    if ((cc ? rows.filter((r) => r.country === cc).length : rows.length) >= want) break;
  }
  if (!rows.length) {
    if (skippedProtocol) throw new Error(`PROXY6: your active proxies do not serve ${socks ? 'SOCKS5' : 'HTTP'}. Switch Protocol, or change the proxy type in your account.`);
    throw new Error(listed ? 'PROXY6: none of your active proxies can be imported (MTProto proxies are not web proxies).' : 'PROXY6: no active proxies on this account.');
  }
  const picked = cc ? rows.filter((r) => r.country === cc) : rows;
  if (!picked.length) {
    const have = [...new Set(rows.map((r) => r.country).filter(Boolean))].join(', ');
    throw new Error(`PROXY6: no active proxies in ${cc} on this account.${have ? ` You have ${have}.` : ''}`);
  }
  return limitListRows(picked, count, Infinity);
}

// Vendors wired to live API calls; syncVendorPool refuses every other vendor.
const REAL_VENDOR_ADAPTERS = Object.freeze({
  brightdata: fetchBrightDataPool,
  oxylabs: fetchOxylabsPool,
  smartproxy: fetchSmartproxyPool,
  apify: fetchApifyPool,
  shopsocks5: fetchShopSocks5Pool,
  anyip: fetchAnyIpPool,
  dataimpulse: fetchDataImpulsePool,
  proxyseller: fetchProxySellerPool,
  iproyal: fetchIpRoyalPool,
  marsproxies: fetchMarsProxiesPool,
  nodemaven: fetchNodeMavenPool,
  froxy: fetchFroxyPool,
  proxidize: fetchProxidizePool,
  liveproxies: fetchLiveProxiesPool,
  packetstream: fetchPacketStreamPool,
  airproxy: fetchAirproxyPool,
  catproxies: fetchCatProxiesPool,
  rapidproxy: fetchRapidProxyPool,
  novada: fetchNovadaPool,
  proxiessx: fetchProxiesSxPool,
  mobileproxyspace: fetchMobileProxySpacePool,
  proxysolutions: fetchProxySolutionsPool,
  proxmint: fetchProxmintPool,
  databay: fetchDatabayPool,
  proxy302: fetchProxy302Pool,
  ipburger: fetchIpBurgerPool,
  ipfoxy: fetchIpfoxyPool,
  mangoproxy: fetchMangoProxyPool,
  twoextract: fetchTwoExtractPool,
  gonzoproxy: fetchGonzoProxyPool,
  simplyproxies: fetchSimplyProxiesPool,
  coronium: fetchCoroniumPool,
  singaporemobileproxy: fetchSingaporeMobileProxyPool,
  gsocks: fetchGsocksPool,
  proxybonanza: fetchProxyBonanzaPool,
  proxy6: fetchProxy6Pool
});

async function syncVendorPool(payload) {
  await requirePermission('proxies.manage'); // creates proxies and calls the vendor
  const input = requireObject(payload);
  const vendorKey = requiredString(input.provider, 'Provider').toLowerCase();
  if (!PROXY_VENDORS[vendorKey]) throw new Error('Unknown proxy provider.');

  const db = getPrisma();
  // Refuse before any vendor call when already at maxProxies; each row is re-checked below.
  await assertWithinLimit('proxies');
  const adapter = REAL_VENDOR_ADAPTERS[vendorKey];
  let rows;
  let simulated = false;

  if (adapter) {
    // Adapters throw a user-facing message on auth or endpoint failure.
    rows = await adapter({
      token: optionalString(input.token) || '',
      username: optionalString(input.username),
      password: input.password != null ? String(input.password) : '',
      zone: optionalString(input.zone),
      bdpm: input.bdpm === true,
      country: optionalString(input.country),
      count: input.count,
      state: optionalString(input.state),
      city: optionalString(input.city),
      session: optionalString(input.session),
      life: input.life,
      apiUrl: optionalString(input.apiUrl),
      host: optionalString(input.host),
      port: input.port,
      // ShopSocks5 plan endpoint (premium|list|daily) + proxy type (proxy_sock_5|proxy_https).
      plan: optionalString(input.plan),
      proxyType: optionalString(input.proxyType),
      // anyip.io: pool selector (sent as type_<poolType>) and team id for REST auto-provisioning.
      poolType: optionalString(input.poolType),
      teamId: optionalString(input.teamId),
      // Address family. Only Oxylabs documents a selector for this ('6' -> -ipversion-6);
      // every other configured vendor ignores it because they publish no IPv6 option.
      ipVersion: optionalString(input.ipVersion),
      // DataImpulse list filters beyond country/state/city (all documented on /api/list).
      zip: optionalString(input.zip),
      asn: optionalString(input.asn),
      excludeCountries: optionalString(input.excludeCountries),
      excludeAsns: optionalString(input.excludeAsns),
      // Proxy-Seller: pull an existing residential list by id instead of creating one.
      listId: optionalString(input.listId),
      // Proxy-Seller per-IP products (IPv6 and friends): limit the pull to one order.
      orderId: optionalString(input.orderId),
      // IPRoyal: authenticate the generated list with a sub-user hash instead of a password.
      subuserHash: optionalString(input.subuserHash),
      // Ports already pooled for a plan login (bare, or with DataImpulse's "__" suffix). DataImpulse
      // hands out sticky ports deterministically, so this lets a pull add new proxies.
      existingPorts: async ({ host, login }) => new Set(
        (await db.proxy.findMany({
          where: { host, OR: [{ username: login }, { username: { startsWith: `${login}__` } }] },
          select: { port: true }
        })).map((r) => r.port)
      )
    });
  } else {
    // No live adapter: refuse rather than invent rows that could never connect.
    throw new Error(
      `${PROXY_VENDORS[vendorKey]} is not connected to a live API yet, so there is nothing to pull. `
      + 'Add its proxies manually under Proxies, or use a provider marked as connected.'
    );
  }

  const result = { provider: PROXY_VENDORS[vendorKey], simulated, total: rows.length, created: [], skipped: [] };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    try {
      await assertWithinLimit('proxies');
    } catch (quotaErr) {
      // Stop at the limit and report how many rows were left out.
      result.limitReached = true;
      result.quotaSkipped = rows.length - index;
      result.limitMessage = quotaErr.message;
      break;
    }
    const existing = await db.proxy.findFirst({
      // Sticky IPRoyal-style rows differ only in the password (the session id), which is sealed,
      // so compare its keyed hash.
      where: { type: row.type, host: row.host, port: row.port, username: row.username, ...(row.dedupeOnPassword ? { passwordHash: await proxySecrets.hashPassword(db, row.password) } : {}) },
      select: { id: true }
    });
    if (existing) { result.skipped.push(row.label); continue; }
    const created = await db.proxy.create({
      data: {
        name: row.label, type: row.type, host: row.host, port: row.port,
        username: row.username, password: row.password, ownerMemberId: ownerStampId(),
        // Lets the pool group proxies by provider.
        provider: vendorKey,
        // A vendor-supplied reboot link (Proxy-Seller mobile) powers the pool's Rotate IP.
        ...(row.rotationUrl ? { rotationUrl: row.rotationUrl } : {}),
        // Show the targeted country until a health check reads the live exit IP.
        ...(row.country ? { lastCountry: row.country } : {})
      }
    });
    result.created.push(serializeProxy(created));
  }
  return result;
}

// Max bytes of a non-2xx body kept for an error message; gateways send a short plain-text reason.
const PROXY_ERROR_BODY_LIMIT = 300;

// Strip proxy credentials from a message before it is stored or shown: a transport error can echo
// the whole proxy URL (user:pass@host:port).
function scrubProxySecrets(message, proxy) {
  let out = String(message || '');
  if (!out) return out;
  out = out.replace(/\/\/[^/@\s]*:[^/@\s]*@/g, '//***:***@'); // userinfo in any URL
  for (const secret of [proxy && proxy.password, proxy && proxy.username]) {
    const v = String(secret || '');
    if (v.length >= 4) out = out.split(v).join('***');
  }
  return out;
}

function describeGatewayError(status, headers, body) {
  const h = headers || {};
  const server = String(h.server || '').trim();
  const proxyFlag = Object.keys(h).some((k) => /^x-.*proxy-(error|status)$/i.test(k));
  const reason = String(body || '')
    .slice(0, PROXY_ERROR_BODY_LIMIT)
    .replace(/<[^>]*>/g, ' ') // strip markup so a small HTML error page stays readable
    .replace(/\s+/g, ' ')
    .trim();
  const fromProxy = proxyFlag || /proxy/i.test(server);
  const who = fromProxy ? (server || 'Proxy gateway') : 'IP service';
  return reason ? `${who} returned HTTP ${status}: ${reason}` : `${who} returned HTTP ${status}.`;
}

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
      {
        agent,
        // Some gateways send LF-only line endings (often on 407s), which llhttp rejects as
        // "Missing expected CR"; the lenient parser lets the real answer through.
        insecureHTTPParser: true,
        headers: { 'User-Agent': 'SoftGlaze-ProxyCheck/1.0', Accept: 'application/json' }
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          // Keep a bounded prefix: the gateway's actionable reason (quota, plan, auth) is in the body.
          let errBody = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            if (isDone || errBody.length >= PROXY_ERROR_BODY_LIMIT) return;
            errBody += chunk;
          });
          const finishErr = () => {
            if (isDone) return;
            cleanup();
            reject(new Error(describeGatewayError(status, res.headers, errBody)));
          };
          res.on('end', finishErr);
          res.on('error', finishErr);
          return;
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

// Keep commas literal: gateways such as Apify read comma-separated tokens (country-US), and the proxy
// agent forwards %2C undecoded, so the country would be ignored. Commas are valid in userinfo.
function proxyUserinfo(user) {
  return encodeURIComponent(String(user)).replace(/%2C/gi, ',');
}

// Shared by testProxyConnectivity and buildProxyAgent. socks5h makes the proxy resolve hostnames;
// plain socks5 would resolve them with the local DNS first.
function proxyAgentScheme(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'socks5') return 'socks5h';
  if (t === 'socks4') return 'socks4';
  return 'http';
}

// Routes a request to an IP/geo service through the proxy; returns { success, ip, country, city,
// isp, latencyMs } or { success: false, error }.
async function testProxyConnectivity(proxy) {
  let ProxyAgent;
  try {
    ({ ProxyAgent } = require('proxy-agent'));
  } catch (e) {
    return { success: false, error: 'Proxy agent module unavailable. Run "npm install" with the app closed.' };
  }

  const scheme = proxyAgentScheme(proxy.type);
  const auth = proxy.username
    ? `${proxyUserinfo(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
    : '';
  const proxyUrl = `${scheme}://${auth}${formatProxyHost(proxy.host)}:${proxy.port}`;
  const agent = new ProxyAgent({ getProxyForUrl: () => proxyUrl });

  const started = Date.now();

  // Race two HTTPS services; the first answer wins. ipinfo.io has no AAAA record, so an IPv6-only
  // exit can only reach get.geojs.io, and trying them in turn made IPv6 checks wait out ipinfo.
  const viaIpinfo = httpGetJson('https://ipinfo.io/json', agent, 15000).then((data) => {
    if (!data || !data.ip) throw new Error('ipinfo.io returned no IP.');
    return { ip: data.ip, country: data.country || null, region: data.region || null, city: data.city || null, zip: data.postal || null, isp: data.org || null, timezone: data.timezone || null };
  });
  const viaGeojs = httpGetJson(GEOJS_URL, agent, 15000).then((raw) => {
    const geo = normalizeGeoJs(raw);
    if (!geo) throw new Error('get.geojs.io returned no IP.');
    return { ip: geo.ip, country: geo.country, region: geo.region, city: geo.city, zip: null, isp: geo.isp, timezone: geo.timezone };
  });
  try {
    const first = await Promise.any([viaIpinfo, viaGeojs]);
    return { success: true, ...first, latencyMs: Date.now() - started };
  } catch (raced) {
    const primaryError = raced && raced.errors ? raced.errors[0] : raced;
    // Fallback: ip-api over plain HTTP (some proxies block 443 or SNI).
    try {
      const data = await httpGetJson(
        'http://ip-api.com/json/?fields=status,message,query,country,countryCode,regionName,city,zip,isp,timezone',
        agent,
        15000
      );
      if (data.status && data.status !== 'success') {
        return { success: false, error: scrubProxySecrets(data.message || 'Proxy check failed.', proxy), latencyMs: Date.now() - started };
      }
      return {
        success: true,
        ip: data.query || null,
        country: data.countryCode || data.country || null,
        region: data.regionName || null,
        city: data.city || null,
        zip: data.zip || null,
        isp: data.isp || null,
        timezone: data.timezone || null,
        latencyMs: Date.now() - started
      };
    } catch (fallbackError) {
      // Prefer the plain-HTTP fallback's message when it names the gateway: a failed HTTPS CONNECT
      // usually gives only a generic tunnel error.
      const fb = (fallbackError && fallbackError.message) || '';
      const pm = (primaryError && primaryError.message) || '';
      const message = /returned HTTP/.test(fb) ? fb : (fb || pm || 'Proxy connection failed.');
      return { success: false, error: scrubProxySecrets(message, proxy), latencyMs: Date.now() - started };
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
    await assertCanAccessProxy(savedId);
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

  let result = await testProxyConnectivity(proxy);

  // Vendors can take ~20 s to activate fresh credentials (Proxy-Seller answers 407 meanwhile), so a
  // proxy created in the last 3 minutes that fails with 407 is retried before it is marked dead.
  if (savedId !== null && result && !result.success && /\b407\b/.test(String(result.error || ''))) {
    const row = await getPrisma().proxy.findUnique({ where: { id: savedId }, select: { createdAt: true } });
    const ageMs = row && row.createdAt ? Date.now() - new Date(row.createdAt).getTime() : Infinity;
    for (let attempt = 0; attempt < 4 && ageMs + attempt * 8000 < 180000 && !result.success && /\b407\b/.test(String(result.error || '')); attempt++) {
      await new Promise((r) => setTimeout(r, 8000));
      result = await testProxyConnectivity(proxy);
    }
  }

  if (savedId !== null) {
    await persistProxyHealth(getPrisma(), savedId, result);
  }

  return result;
}

// ---- Deep proxy check ----
// Connectivity, geo, real-site probes and DNSBL rolled into a health score; streamed by runProxyCheckStream.

// Build a proxy agent for ad-hoc probes (mirrors testProxyConnectivity's agent).
function buildProxyAgent(proxy) {
  let ProxyAgent;
  try { ({ ProxyAgent } = require('proxy-agent')); } catch (e) { return null; }
  const scheme = proxyAgentScheme(proxy.type);
  const auth = proxy.username ? `${proxyUserinfo(proxy.username)}:${encodeURIComponent(proxy.password || '')}@` : '';
  return new ProxyAgent({ getProxyForUrl: () => `${scheme}://${auth}${formatProxyHost(proxy.host)}:${proxy.port}` });
}

// Resolves the HTTP status of a request through the agent (any response means bytes flowed);
// throws on timeout or refusal.
function httpProbeStatus(url, agent, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let lib;
    try { const u = new URL(url); lib = u.protocol === 'https:' ? require('node:https') : require('node:http'); }
    catch (e) { return reject(new Error('Invalid probe URL.')); }
    let done = false; let timer;
    const cleanup = () => { done = true; if (timer) clearTimeout(timer); };
    const req = lib.get(url, { agent, insecureHTTPParser: true, headers: { 'User-Agent': 'SoftGlaze-ProxyCheck/1.0', Accept: '*/*' } }, (res) => {
      const status = res.statusCode || 0;
      res.resume(); // drain; only the status matters
      res.on('end', () => { if (done) return; cleanup(); resolve(status); });
      res.on('error', () => { if (done) return; cleanup(); resolve(status); });
    });
    timer = setTimeout(() => { if (done) return; cleanup(); req.destroy(); reject(new Error('timed out')); }, timeoutMs);
    req.on('error', (err) => { if (done) return; cleanup(); reject(err); });
  });
}

// Tiny, globally reachable endpoints that prove the proxy loads real sites, not just the IP service.
const PROXY_PROBE_URLS = [
  { name: 'Google', url: 'https://www.google.com/generate_204', host: 'google.com' },
  { name: 'Cloudflare', url: 'https://www.cloudflare.com/cdn-cgi/trace', host: 'cloudflare.com' }
];
async function probeUrl(agent, target) {
  const started = Date.now();
  try {
    const status = await httpProbeStatus(target.url, agent, 12000);
    return { name: target.name, host: target.host, ok: status > 0 && status < 500, status, ms: Date.now() - started };
  } catch (e) {
    return { name: target.name, host: target.host, ok: false, status: 0, ms: Date.now() - started, error: (e && e.message) || 'failed' };
  }
}

// DNSBL check of the exit IP: a 127.0.0.x answer means listed. Errors, timeouts and sentinels such
// as Spamhaus's 127.255.255.x (public resolver blocked) count as not listed, to avoid false positives.
// v6: whether the zone answers IPv6 nibble queries; zones without it are skipped for IPv6.
const DNSBL_ZONES = [
  { zone: 'zen.spamhaus.org', name: 'Spamhaus', v6: true },
  { zone: 'bl.spamcop.net', name: 'SpamCop', v6: false },
  { zone: 'dnsbl.sorbs.net', name: 'SORBS', v6: true },
  { zone: 'b.barracudacentral.org', name: 'Barracuda', v6: false }
];

// Expands an IPv6 literal to 32 hex chars (DNSBLs query it as reversed nibbles); '' when the
// input is not well-formed IPv6.
function expandIpv6(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').split('%')[0];
  if (!require('node:net').isIPv6(raw)) return '';
  // An embedded IPv4 tail (::ffff:203.0.113.7) folds into two hex groups.
  let rest = raw;
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(raw);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return '';
    rest = raw.slice(0, v4.index)
      + (((o[0] << 8) | o[1]) >>> 0).toString(16) + ':'
      + (((o[2] << 8) | o[3]) >>> 0).toString(16);
  }
  const halves = rest.split('::');
  if (halves.length > 2) return '';
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  let groups;
  if (halves.length === 2) {
    const fill = 8 - left.length - right.length;
    if (fill < 0) return '';
    groups = left.concat(new Array(fill).fill('0'), right);
  } else {
    groups = left;
  }
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return '';
  return groups.map((g) => g.padStart(4, '0')).join('');
}
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}
async function checkBlacklist(ip) {
  // IPv4 reverses by octet; IPv6 reverses by nibble.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ''));
  let rev = '';
  let isV6 = false;
  if (m) {
    rev = `${m[4]}.${m[3]}.${m[2]}.${m[1]}`;
  } else {
    const hex = expandIpv6(ip);
    if (!hex) return { checked: false, listed: false, sources: [] }; // not a queryable IP
    rev = hex.split('').reverse().join('.');
    isV6 = true;
  }
  const zones = DNSBL_ZONES.filter((z) => (isV6 ? z.v6 : true));
  if (!zones.length) return { checked: false, listed: false, sources: [] };
  const dns = require('node:dns').promises;
  const sources = [];
  await Promise.all(zones.map(async ({ zone, name }) => {
    try {
      const a = await withTimeout(dns.resolve4(`${rev}.${zone}`), 4000);
      if (Array.isArray(a) && a.some((addr) => /^127\.0\.0\.\d+$/.test(addr))) sources.push(name);
    } catch (e) { /* NXDOMAIN / timeout / error → not listed */ }
  }));
  return { checked: true, listed: sources.length > 0, sources };
}

function speedRating(avgMs) {
  if (avgMs == null) return { rating: 'unknown', avgMs: null };
  if (avgMs < 500) return { rating: 'fast', avgMs };
  if (avgMs < 1500) return { rating: 'good', avgMs };
  if (avgMs < 3000) return { rating: 'ok', avgMs };
  return { rating: 'slow', avgMs };
}
function computeProxyHealthScore({ okCount, total, avgMs, listedCount }) {
  if (!total || okCount === 0) return { score: 0, grade: 'F', label: 'Dead' };
  let score = Math.round((okCount / total) * 100);
  if (avgMs != null) { if (avgMs > 3000) score -= 30; else if (avgMs > 1500) score -= 18; else if (avgMs > 800) score -= 8; }
  score -= Math.min(30, (listedCount || 0) * 12);
  score = Math.max(0, Math.min(100, score));
  let grade = 'F', label = 'At risk';
  if (score >= 90) { grade = 'A'; label = 'Excellent'; }
  else if (score >= 80) { grade = 'B'; label = 'Good'; }
  else if (score >= 65) { grade = 'C'; label = 'Fair'; }
  else if (score >= 45) { grade = 'D'; label = 'Weak'; }
  return { score, grade, label };
}

// Superset of testProxyConnectivity's result (adds urlChecks, blacklist, avgMs, health, speed);
// persistProxyHealth reads only the shared base fields.
async function deepCheckProxy(proxy) {
  const geo = await testProxyConnectivity(proxy); // primary probe (IP/geo service)
  const urlChecks = [{ name: 'IP / Geo', host: 'ipinfo.io', ok: !!geo.success, status: geo.success ? 200 : 0, ms: geo.latencyMs ?? null }];
  if (geo.success) {
    const agent = buildProxyAgent(proxy);
    if (agent) for (const target of PROXY_PROBE_URLS) urlChecks.push(await probeUrl(agent, target));
  }
  let blacklist = { checked: false, listed: false, sources: [] };
  if (geo.success && geo.ip) { try { blacklist = await checkBlacklist(geo.ip); } catch (e) { /* best-effort */ } }
  const okCount = urlChecks.filter((u) => u.ok).length;
  const times = urlChecks.filter((u) => u.ok && typeof u.ms === 'number').map((u) => u.ms);
  const avgMs = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
  const health = geo.success
    ? computeProxyHealthScore({ okCount, total: urlChecks.length, avgMs, listedCount: blacklist.sources.length })
    : { score: 0, grade: 'F', label: 'Dead' };
  return { ...geo, urlChecks, blacklist, avgMs, health, speed: speedRating(avgMs) };
}

// Only non-secret, display-safe fields cross to the renderer.
function publicProxyCheckResult(r) {
  return {
    success: !!r.success, ip: r.ip || null, country: r.country || null, region: r.region || null,
    city: r.city || null, isp: r.isp || null, latencyMs: r.latencyMs ?? null, avgMs: r.avgMs ?? null,
    urlChecks: Array.isArray(r.urlChecks) ? r.urlChecks : [],
    blacklist: r.blacklist || { checked: false, listed: false, sources: [] },
    health: r.health || { score: 0, grade: 'F', label: '' },
    speed: r.speed || { rating: 'unknown', avgMs: null },
    error: r.error || null
  };
}

// Streamed batch check for "Check all" / "Check selected": deep-checks with bounded concurrency
// and pushes progress on proxy:check-progress.
const proxyCheckRuns = new Map();

async function runProxyCheckStream(payload, event) {
  const input = (payload && typeof payload === 'object') ? payload : {};
  const db = getPrisma();
  let proxies;
  if (Array.isArray(input.ids) && input.ids.length) {
    const ids = parseIdArray(input.ids);
    const { allowed } = await partitionAccessibleProxyIds(ids);
    proxies = await db.proxy.findMany({ where: { id: { in: allowed } }, orderBy: { createdAt: 'asc' } });
  } else {
    proxies = await db.proxy.findMany({ where: await scopedProxyWhere(undefined), orderBy: { createdAt: 'asc' } });
  }
  const total = proxies.length;
  const runId = `pcheck-${Date.now()}`;
  let lastSend = 0;
  const send = (data, force = false) => {
    const now = Date.now();
    if (!force && now - lastSend < 50) return; // Max 20 frames per second
    lastSend = now;
    try { event.sender.send(CHANNELS.PROXY_CHECK_PROGRESS, { runId, ts: now, ...data }); } catch (e) { /* renderer gone */ } 
  };
  
  if (!total) { send({ level: 'WARN', message: 'No proxies to check.', done: 0, total: 0, percent: 100, ok: 0, fail: 0, finished: true }, true); return { started: true, runId, total: 0 }; }

  const run = { aborted: false };
  proxyCheckRuns.set(runId, run);
  const cap = Math.max(1, Math.min(12, Number(input.concurrency) || 6));
  send({ level: 'INFO', message: `Starting health check · ${total} prox${total === 1 ? 'y' : 'ies'} · up to ${cap} at a time…`, done: 0, total, percent: 0, ok: 0, fail: 0 });

  let cursor = 0, done = 0, ok = 0, fail = 0;
  const startedAt = Date.now();
  async function worker() {
    while (cursor < proxies.length && !run.aborted) {
      const p = proxies[cursor++];
      const label = p.name || `${p.host}:${p.port}`;
      send({ level: 'INFO', proxyId: p.id, phase: 'start', message: `Checking ${label} · ${p.type} · ${p.host}:${p.port} …` });
      let result;
      try { result = await deepCheckProxy({ type: p.type, host: p.host, port: p.port, username: p.username, password: p.password }); }
      catch (e) { result = { success: false, error: (e && e.message) || 'check failed', urlChecks: [], blacklist: { checked: false, listed: false, sources: [] }, health: { score: 0, grade: 'F', label: 'Dead' }, speed: { rating: 'unknown', avgMs: null }, avgMs: null }; }
      await persistProxyHealth(db, p.id, result).catch(() => {});
      done += 1; if (result.success) ok += 1; else fail += 1;
      const elapsed = Date.now() - startedAt;
      const etaMs = done ? Math.max(0, Math.round((elapsed / done) * (total - done))) : null;
      const urls = result.urlChecks || [];
      const okUrls = urls.filter((u) => u.ok).length;
      const line = result.success
        ? `${label} → ${result.country || '??'}${result.city ? ' · ' + result.city : ''} · ${result.latencyMs != null ? result.latencyMs + 'ms' : '-'} · ${okUrls}/${urls.length} sites · ${result.health.grade} ${result.health.label} · ${result.speed.rating}${result.blacklist.listed ? ` · ⚠ blacklisted (${result.blacklist.sources.join(', ')})` : (result.blacklist.checked ? ' · clean' : '')}`
        : `${label} → FAILED · ${result.error || 'unreachable'}`;
      send({ level: result.success ? (result.blacklist.listed ? 'WARN' : 'SUCCESS') : 'ERROR', proxyId: p.id, phase: 'result', message: line, result: publicProxyCheckResult(result), done, total, ok, fail, percent: Math.round((done / total) * 100), etaMs });
    }
  }
  (async () => {
    await Promise.all(Array.from({ length: Math.min(cap, total) }, () => worker()));
    try { await autoGroupProxies({ level: 'country', onlyUngrouped: true }); } catch (e) { /* ignore */ }
const totalMs = Date.now() - startedAt;
    send({ level: run.aborted ? 'WARN' : 'SUCCESS', message: run.aborted ? `Stopped · ${done}/${total} checked · ${ok} healthy, ${fail} failed` : `Finished · ${ok} healthy, ${fail} failed · ${(totalMs / 1000).toFixed(1)}s`, done, total, ok, fail, percent: Math.round((done / total) * 100), finished: true, totalMs }, true); // force the final emit
    proxyCheckRuns.delete(runId);
  })();
  return { started: true, runId, total };
}

async function stopProxyCheck(payload) {
  const runId = payload && payload.runId ? String(payload.runId) : null;
  const runs = runId ? (proxyCheckRuns.has(runId) ? [proxyCheckRuns.get(runId)] : []) : [...proxyCheckRuns.values()];
  runs.forEach((r) => { r.aborted = true; });
  return { stopped: runs.length };
}

// Reduces pass/warn/fail checks to a 0-100 score and letter grade. One fail (a real leak such as
// WebRTC exposing the real IP) must visibly sink the score; warns weigh less.
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
    checks.push({ key: 'ip', label: 'IP / Proxy', status: 'warn', detail: 'No profile proxy in use - the machine\'s real IP is exposed.' });
  }

  const webrtc = profile.webrtc || 'Forward';
  if (webrtc === 'Real') {
    checks.push({
      key: 'webrtc', label: 'WebRTC', status: usesProxy ? 'fail' : 'warn',
      detail: usesProxy
        ? 'Set to "Real" - WebRTC can expose the real IP behind the proxy.'
        : 'Set to "Real" (no proxy) - real IP visible via WebRTC.'
    });
  } else {
    checks.push({ key: 'webrtc', label: 'WebRTC', status: 'pass', detail: `Mode "${webrtc}" - real IP not leaked via WebRTC.` });
  }

  const tzType = profile.timezoneType || 'Based on IP';
  if (tzType === 'Based on IP') {
    checks.push({
      key: 'timezone', label: 'Timezone', status: usesProxy ? 'pass' : 'warn',
      detail: usesProxy ? `Auto from proxy${geo && geo.timezone ? ` (${geo.timezone})` : ''}.` : 'Based on IP, but no proxy is set.'
    });
  } else if (tzType === 'Real') {
    checks.push({ key: 'timezone', label: 'Timezone', status: 'warn', detail: 'Using the host timezone - may not match the proxy location.' });
  } else {
    const want = optionalString(profile.timezoneCustom);
    if (usesProxy && geo && geo.success && geo.timezone && want) {
      const match = geo.timezone === want;
      checks.push({
        key: 'timezone', label: 'Timezone', status: match ? 'pass' : 'fail',
        detail: match ? `Custom ${want} matches proxy.` : `Custom ${want} \u2260 proxy ${geo.timezone}.`
      });
    } else {
      checks.push({ key: 'timezone', label: 'Timezone', status: 'warn', detail: `Custom ${want || '(unset)'} - could not compare to proxy.` });
    }
  }

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
      checks.push({ key: 'language', label: 'Language', status: 'warn', detail: `Custom (${lc || 'unset'}) - could not compare to proxy.` });
    }
  }

  const locType = profile.locationType || 'Based on IP';
  if (locType === 'Based on IP') {
    checks.push({ key: 'geo', label: 'Geolocation', status: 'pass', detail: 'Auto from IP.' });
  } else if (locType === 'Block') {
    checks.push({ key: 'geo', label: 'Geolocation', status: 'pass', detail: 'Blocked - no location shared.' });
  } else {
    checks.push({
      key: 'geo', label: 'Geolocation', status: 'warn',
      detail: `Custom (${optionalString(profile.locationLat) || '?'}, ${optionalString(profile.locationLng) || '?'}) - verify it matches the proxy region.`
    });
  }

  const noiseOn = profile.canvasNoise && profile.webglImageNoise && profile.audioContextNoise;
  checks.push({
    key: 'fp', label: 'Fingerprint noise', status: noiseOn ? 'pass' : 'warn',
    detail: noiseOn ? 'Canvas / WebGL / Audio noise enabled.' : 'One or more fingerprint-noise toggles are off.'
  });

  // A mobile UA with a desktop GPU (or the reverse) is an easily scored mismatch.
  const coh = deviceGpuCoherence({ deviceClass: profile.deviceClass, os: profile.os, webglRenderer: profile.webglRenderer });
  checks.push({ key: 'device', label: 'Device coherence', status: coh.status, detail: coh.detail });

  const score = computeTrustScore(checks);
  return { profileId: id, title: profile.title, usesProxy, geo, checks, summary: score.summary, score };
}

// ---- Cookie import/export ----

// Resolves a cookie's expiry to unix seconds. Extension exports (EditThisCookie, Cookie-Editor)
// write `expirationDate`, and a CDP cookie with no `expires` is a session cookie, so reading only
// `expires` would make every persistent login die on close.
function cookieExpirySeconds(c) {
  if (!c) return 0;
  if (c.session === true) return 0; // extensions flag true session cookies explicitly
  for (const key of ['expires', 'expirationDate', 'expiry']) {
    const raw = c[key];
    if (raw == null || raw === '') continue;
    let v = Number(raw);
    if (!Number.isFinite(v) && typeof raw === 'string') {
      const parsed = Date.parse(raw); // ISO-8601 form used by some exporters
      if (Number.isFinite(parsed)) v = parsed / 1000;
    }
    if (!Number.isFinite(v) || v <= 0) continue;
    if (v > 1e11) v = v / 1000; // milliseconds, not seconds
    return v;
  }
  return 0;
}

function cookiesToNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# Generated by SoftGlaze', ''];
  for (const c of cookies) {
    const domain = c.domain || '';
    const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const path = c.path || '/';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expiry = Math.floor(cookieExpirySeconds(c));
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
  const exp = cookieExpirySeconds(c);
  if (exp > 0) param.expires = exp;
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
    const exp = cookieExpirySeconds(c);
    if (exp <= 0) { session += 1; continue; }
    if (exp < now) expired += 1;
    else if (exp < weekOut) expiringSoon += 1;
  }
  return { total: list.length, domains: domains.size, session, expired, expiringSoon, secure, httpOnly };
}

// Data dir and matching Chrome for a stopped profile, so its cookies can move without launching it.
async function offlineProfileOpts(id) {
  const db = getPrisma();
  const profile = await db.profile.findUnique({ where: { id } });
  if (!profile) throw new Error('Profile not found.');
  const userDataDir = resolveProfileDataDir(profile.dataDirName);
  const resolved = resolveBrowserExecutable(profile.browserVersion || profile.browserCore);
  return { userDataDir, executablePath: resolved && resolved.exePath ? resolved.exePath : undefined };
}

// Cookie dumps, archives and live 2FA codes need RAW_VALUE_MIN_RANK on top of profile access, so a
// use-level share cannot take a logged-in session. Single-user mode and the super admin pass.
const REVEAL_LABELS = Object.freeze({
  cookieDump: 'export cookies or archives',
  twoFactorCode: 'read 2FA codes'
});
async function assertCanRevealKind(kind) {
  const member = await getActiveMember();
  if (!member) return;
  try {
    rbacPolicy.assertCanReveal(member.role, kind);
  } catch (e) {
    const err = new Error(`Your role cannot ${REVEAL_LABELS[kind] || `reveal ${kind}`}. Ask an owner or admin.`);
    err.code = 'FORBIDDEN';
    throw err;
  }
}

async function exportProfileCookies(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
  await assertCanRevealKind('cookieDump');
  const format = (optionalString(input.format) || 'json').toLowerCase();
  let cookies = await exportSessionCookies(String(id));
  if (cookies === null) {
    // Profile not running - read its persisted cookies headlessly from disk.
    cookies = await exportStoredCookies(await offlineProfileOpts(id)).catch(() => null);
    if (cookies === null) throw new Error('Could not read this profile\'s stored cookies. Try launching it once.');
  }
  const content = format === 'netscape' ? cookiesToNetscape(cookies) : JSON.stringify(cookies, null, 2);
  await logAudit('profile.cookies_exported', { profileId: id, detail: { format, count: cookies.length } });
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
    // Profile not running - write the cookies into its persisted store headlessly.
    result = await importStoredCookies(await offlineProfileOpts(id), params).catch(() => null);
    if (result === null) throw new Error('Could not write cookies to this profile\'s store. Try launching it once.');
  }
  return { imported: result.imported, parsed: parsed.length, health: cookieHealth(parsed) };
}

// Imports one cookie set into every running profile (injection needs a live CDP session);
// returns a per-session breakdown.
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

// ---- Clone & templates ----

// Identity and bookkeeping columns, never carried into a copy.
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
  // Same create-permission and quota gates as createProfile.
  await requirePermission('profiles.create');
  const input = requireObject(payload);
  const db = getPrisma();
  await assertWithinLimit('profiles');
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
  const reroll = Boolean(input.reroll);
  const src = await db.profile.findUnique({ where: { id } });
  if (!src) throw new Error('Profile not found.');

  const fields = await reconcileReferences(db, pickCloneableFields(src));
  const title = `${src.title} (copy)`;
  const dataDirName = await ensureUniqueDataDirName(db, title);

  // Reroll swaps in a fresh, consistent fingerprint (OS, GPU and screen stay paired, device class
  // kept) so copies never share one; otherwise only the hardware identity is regenerated.
  const isMobile = src.deviceClass === 'mobile';
  const fingerprint = reroll ? generateFingerprint({ deviceClass: src.deviceClass }) : {};
  // The copy belongs to the current member, not the source's owner or assignee.
  const cloneStampId = ownerStampId();
  const data = { ...fields, ...fingerprint, title, dataDirName, macAddress: randomMac(), ownerMemberId: cloneStampId, assignedMemberId: cloneStampId };
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
  // Gated like a clone, so a template cannot copy a profile the member cannot access.
  await requirePermission('profiles.create');
  await assertCanAccessProfile(id);
  const name = requiredString(input.name, 'Template name');
  const src = await db.profile.findUnique({ where: { id } });
  if (!src) throw new Error('Profile not found.');
  const fields = pickCloneableFields(src);
  // Templates are workspace-global, so strip live secrets (2FA seed, platform accounts); clones keep them.
  delete fields.twoFactorSeed;
  delete fields.platformAccounts;
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
  // Same create-permission and quota gates as createProfile.
  await requirePermission('profiles.create');
  const input = requireObject(payload);
  const db = getPrisma();
  await assertWithinLimit('profiles');
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
  // Stamp ownership to the current member (templates carry no owner).
  const tplStampId = ownerStampId();
  const data = { ...fields, title, dataDirName, macAddress: randomMac(), ownerMemberId: tplStampId, assignedMemberId: tplStampId };
  if ('browserCore' in data) data.browserCore = toStoredBrowserCore(data.browserCore);
  if (!isMobile) data.deviceName = randomDeviceName();
  const created = await db.profile.create({ data, include: { proxy: true, group: true } });
  return serializeProfile(created);
}

// ---- Profile access scoping (tenant isolation) ----
// A member sees profiles owned by, assigned to or shared with someone in their visible subtree.
// Single-user mode and the Super Admin are unrestricted. Enforced in main, never in the renderer.
const PROFILE_ACCESS_SELECT = { id: true, ownerMemberId: true, assignedMemberId: true, accesses: { select: { memberId: true, level: true } } };

async function profileAccessChecker() {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return null; // unrestricted
  const all = await getPrisma().member.findMany();
  const visible = permissions.visibleMemberIds(all, member);
  // Fail closed: unowned profiles (the Super Admin stamps no member id) stay hidden until assigned
  // or shared out.
  return (p) => permissions.profileRowAccessible(visible, p, false);
}

async function assertCanAccessProfile(id, opts = {}) {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return;
  const all = await getPrisma().member.findMany();
  const visible = permissions.visibleMemberIds(all, member);
  const p = await getPrisma().profile.findUnique({ where: { id }, select: PROFILE_ACCESS_SELECT });
  if (!p) throw new Error('Profile not found.');
  if (!permissions.profileRowAccessible(visible, p, Boolean(opts.requireEdit))) {
    const e = new Error('You do not have access to this profile.'); e.code = 'FORBIDDEN'; throw e;
  }
}

// Splits renderer-supplied ids into allowed and denied (denied become per-id errors in bulk
// handlers). `requireEdit` keeps only profiles the member may edit, for the sharing handlers.
async function partitionAccessibleProfileIds(ids, opts = {}) {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return { allowed: ids, denied: [] };
  const all = await getPrisma().member.findMany();
  const visible = permissions.visibleMemberIds(all, member);
  const rows = await getPrisma().profile.findMany({ where: { id: { in: ids } }, select: PROFILE_ACCESS_SELECT });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const allowed = []; const denied = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (r && permissions.profileRowAccessible(visible, r, Boolean(opts.requireEdit))) allowed.push(id);
    else denied.push(id);
  }
  return { allowed, denied };
}

// Adds the active member's ownership filter to a profile query; mirrors profileAccessChecker.
async function scopedProfileWhere(baseWhere) {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return baseWhere;
  const all = await getPrisma().member.findMany();
  const visible = [...permissions.visibleMemberIds(all, member)];
  const or = [
    { assignedMemberId: { in: visible } },
    { ownerMemberId: { in: visible } },
    { accesses: { some: { memberId: { in: visible } } } }
  ];
  return { AND: [baseWhere, { OR: or }] };
}

// ---- Proxy ownership scoping ----
// Fail closed like profiles: a member sees only proxies owned within their visible subtree.
async function scopedProxyWhere(baseWhere) {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return baseWhere;
  const all = await getPrisma().member.findMany();
  const visible = [...permissions.visibleMemberIds(all, member)];
  const ownFilter = { ownerMemberId: { in: visible } };
  return baseWhere ? { AND: [baseWhere, ownFilter] } : ownFilter;
}

async function assertCanAccessProxy(id) {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return;
  const all = await getPrisma().member.findMany();
  const visible = permissions.visibleMemberIds(all, member);
  const p = await getPrisma().proxy.findUnique({ where: { id }, select: { id: true, ownerMemberId: true } });
  if (!p) throw new Error('Proxy not found.');
  if (!(p.ownerMemberId != null && visible.has(p.ownerMemberId))) {
    const e = new Error('You do not have access to this proxy.'); e.code = 'FORBIDDEN'; throw e;
  }
}

async function partitionAccessibleProxyIds(ids) {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return { allowed: ids, denied: [] };
  const all = await getPrisma().member.findMany();
  const visible = permissions.visibleMemberIds(all, member);
  const rows = await getPrisma().proxy.findMany({ where: { id: { in: ids } }, select: { id: true, ownerMemberId: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const allowed = []; const denied = [];
  for (const id of ids) { const r = byId.get(id); if (r && r.ownerMemberId != null && visible.has(r.ownerMemberId)) allowed.push(id); else denied.push(id); }
  return { allowed, denied };
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
  await requirePermission('profiles.create');
  // A new profile has nothing stored, so a masked secret in the payload (an editor opened from an
  // existing profile) becomes empty instead of being saved as dots.
  const input = restoreMaskedSecrets(requireObject(payload), null);
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

// ---- Shared profiles ----
// The actor needs edit access to each profile and may share only with a member in their visible
// subtree. level: 'use' | 'edit'.
async function grantProfileAccess(payload) {
  await requirePermission('profiles.share');
  const input = requireObject(payload);
  const profileIds = parseIdArray(input.profileIds != null ? input.profileIds : (input.profileId != null ? [input.profileId] : []));
  const memberId = parseId(input.memberId, 'memberId');
  const level = input.level === 'edit' ? 'edit' : 'use';
  const db = getPrisma();

  const target = await db.member.findUnique({ where: { id: memberId } });
  if (!target) throw new Error('Target member not found.');
  const actor = await getActiveMember();
  if (actor && actor.role !== 'SUPER_ADMIN') {
    const all = await db.member.findMany();
    const visible = permissions.visibleMemberIds(all, actor);
    if (!visible.has(memberId)) throw new Error('You can only share profiles with members you manage.');
  }

  // Only profiles the actor may edit can be shared out.
  const { allowed } = await partitionAccessibleProfileIds(profileIds, { requireEdit: true });
  const grantedBy = ownerStampId();
  let granted = 0;
  for (const pid of allowed) {
    await db.profileAccess.upsert({
      where: { profileId_memberId: { profileId: pid, memberId } },
      update: { level, grantedByMemberId: grantedBy },
      create: { profileId: pid, memberId, level, grantedByMemberId: grantedBy }
    });
    await logAudit('profile.share', { profileId: pid, detail: { member: target.name, level } });
    granted += 1;
  }
  return { ok: true, granted, denied: profileIds.length - allowed.length, memberId, level };
}

// Revoke a member's access to one or more profiles. Same edit-access gate.
async function revokeProfileAccess(payload) {
  await requirePermission('profiles.share');
  const input = requireObject(payload);
  const profileIds = parseIdArray(input.profileIds != null ? input.profileIds : (input.profileId != null ? [input.profileId] : []));
  const memberId = parseId(input.memberId, 'memberId');
  const db = getPrisma();
  const { allowed } = await partitionAccessibleProfileIds(profileIds, { requireEdit: true });
  let revoked = 0;
  for (const pid of allowed) {
    const res = await db.profileAccess.deleteMany({ where: { profileId: pid, memberId } });
    if (res.count) { await logAudit('profile.unshare', { profileId: pid, detail: { memberId } }); revoked += res.count; }
  }
  return { ok: true, revoked };
}

// List who a profile is shared with (members + level). Any access to the profile
// is enough to view its share list.
async function listProfileAccess(payload) {
  const input = requireObject(payload);
  const profileId = parseId(input.profileId, 'profileId');
  await assertCanAccessProfile(profileId);
  const db = getPrisma();
  const rows = await db.profileAccess.findMany({ where: { profileId }, orderBy: { createdAt: 'asc' } });
  const ids = rows.map((r) => r.memberId);
  const members = ids.length
    ? await db.member.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, initials: true, color: true, role: true } })
    : [];
  const byId = new Map(members.map((m) => [m.id, m]));
  return rows.map((r) => ({ memberId: r.memberId, level: r.level, member: byId.get(r.memberId) || null }));
}

// Crypto-seeded in-place Fisher-Yates shuffle (no Math.random - keeps entropy strong).
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Normalize a startup-links field (array OR newline/space/comma-separated string) into
// the newline-joined string the launch engine expects, or null when empty.
function normalizeStartupUrls(value) {
  if (value == null) return null;
  const list = Array.isArray(value) ? value : String(value).split(/[\r\n,\s]+/);
  const urls = list
    .map((u) => String(u || '').trim())
    .filter(Boolean)
    .map((u) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`));
  return urls.length ? urls.join('\n') : null;
}

// Sanity cap so a pasted list cannot spawn hundreds of tabs on a single launch.
const MAX_STARTUP_TABS = 20;
// Read side of normalizeStartupUrls: splits the stored newline-joined string into launch tabs.
// Kept next to the writer so the two cannot drift.
function parseStartupUrls(value) {
  if (!value) return [];
  return String(value)
    .split(/[\r\n]+/)
    .map((u) => String(u || '').trim())
    .filter(Boolean)
    .slice(0, MAX_STARTUP_TABS);
}

// Server-side batch generator. It owns what per-profile create() cannot: a unique proxy per profile
// (the run is capped at available proxies), unique visible fingerprints and an even Chrome-version
// spread. createProfile does the persistence, so limits, ownership and data dirs stay identical.
async function batchGenerateProfiles(payload) {
  const input = requireObject(payload);
  const db = getPrisma();

  const count = Math.max(1, Math.min(500, Number.parseInt(String(input.count), 10) || 1));
  const prefix = (optionalString(input.prefix) || optionalString(input.baseName) || 'Profile').slice(0, 60);
  const startIndex = Math.max(0, Number.parseInt(String(input.startIndex), 10) || 1);
  // No OS means the real host OS (the generator's default), for coherence; an explicit "Random"
  // still mints a cross-OS spread.
  const os = optionalString(input.os) || '';
  const deviceClass = input.deviceClass === 'mobile' ? 'mobile' : 'desktop';
  const randomFp = input.randomFingerprint !== false; // on by default
  const distributeVersions = randomFp && input.distributeVersions !== false && deviceClass !== 'mobile';
  const startupUrls = normalizeStartupUrls(input.startupUrls);
  const notes = optionalString(input.notes) || 'Auto-generated batch';

  // A new group is created only after the proxy plan, so a run that creates nothing leaves none.
  let groupId = input.groupId ? parseId(input.groupId, 'groupId') : null;
  const newGroupName = optionalString(input.newGroupName);

  const proxyMode = (optionalString(input.proxyMode) || 'direct').toLowerCase(); // unique | pool | paste | direct
  const assignments = [];
  let proxyLimited = false;
  let availableProxies = 0;
  let effectiveCount = count;
  let proxyVerifyExcluded = 0;
  // Why a proxy-backed run created nothing: 'no-match' or 'none-healthy'. Never fall back to DIRECT:
  // a profile meant to be behind a proxy must not open on the real IP.
  let noProxyReason = null;
  let poolMatched = 0;

  if (proxyMode === 'unique' || proxyMode === 'pool') {
    const filter = {};
    if (input.proxyGroupId !== undefined && input.proxyGroupId !== '' && input.proxyGroupId !== 'all') {
      filter.proxyGroupId = input.proxyGroupId === 'none' ? null : parseId(input.proxyGroupId, 'proxyGroupId');
    }
    if (optionalString(input.provider)) filter.provider = optionalString(input.provider).toLowerCase();
    // Free public proxies are only used when the user picks them on purpose (their
    // provider or a group): never mixed into "all proxies" for real profiles.
    else if (filter.proxyGroupId === undefined) filter.OR = [{ provider: null }, { provider: { not: 'free' } }];
    const cc = normCountryCode(input.country);
    if (cc) filter.lastCountry = cc;
    // Narrow candidates by stored latency and DNSBL result before the live health check.
    const speedSel = (optionalString(input.proxySpeed) || 'any').toLowerCase();
    if (speedSel === 'fast') filter.lastLatencyMs = { lte: 2000 };
    else if (speedSel === 'slow') filter.lastLatencyMs = { gt: 2000 };
    const blSel = (optionalString(input.proxyBlacklist) || 'any').toLowerCase();
    // Strict, to match the count chips / Proxy Pool page: false = clean, true = flagged,
    // never-checked (null) = neither (so "Clean" doesn't silently pull in unchecked proxies).
    if (blSel === 'clean') filter.lastBlacklisted = false;
    else if (blSel === 'blacklisted') filter.lastBlacklisted = true;
    // A speed or blocklist choice only ever means proxies that work.
    if (speedSel !== 'any' || blSel !== 'any') filter.lastStatus = 'ok';
    // Unique mode: only proxies not bound to a live (non-deleted) profile.
    if (proxyMode === 'unique') filter.profiles = { none: { deletedAt: null } };

    const pool = await db.proxy.findMany({
      where: await scopedProxyWhere(Object.keys(filter).length ? filter : undefined),
      orderBy: { createdAt: 'asc' },
      select: { id: true, type: true, host: true, port: true, username: true, password: true, lastStatus: true, lastCheckedAt: true }
    });
    poolMatched = pool.length;

    // Only attach proxies that pass a live health check; those verified 'ok' in the last 30 minutes
    // are trusted as is. verifyProxies: false bypasses the gate.
    const verify = input.verifyProxies !== false;
    const FRESH_MS = 30 * 60 * 1000;
    const isHealthy = async (p) => {
      if (!verify) return true;
      if (p.lastStatus === 'ok' && p.lastCheckedAt && (Date.now() - new Date(p.lastCheckedAt).getTime()) < FRESH_MS) return true;
      try {
        const result = await testProxyConnectivity({ type: p.type, host: p.host, port: p.port, username: p.username, password: p.password });
        await persistProxyHealth(db, p.id, result).catch(() => {});
        return Boolean(result && result.success);
      } catch (e) { return false; }
    };
    // Bounded-concurrency scan; stops once `limit` healthy proxies are found.
    const collectHealthy = async (candidates, limit) => {
      const healthy = [];
      let checked = 0;
      const CONC = 8;
      for (let i = 0; i < candidates.length && healthy.length < limit; i += CONC) {
        const slice = candidates.slice(i, i + CONC);
        const res = await Promise.all(slice.map(async (p) => ({ p, ok: await isHealthy(p) })));
        for (const r of res) { checked += 1; if (r.ok && healthy.length < limit) healthy.push(r.p); }
      }
      return { healthy, checked };
    };

    if (proxyMode === 'unique') {
      shuffleInPlace(pool); // so the same proxies aren't always picked first
      const { healthy, checked } = await collectHealthy(pool, count);
      availableProxies = healthy.length;
      effectiveCount = Math.min(count, healthy.length);
      if (effectiveCount < count) { proxyLimited = true; proxyVerifyExcluded = Math.max(0, checked - healthy.length); }
      for (let i = 0; i < effectiveCount; i += 1) assignments.push({ proxyId: healthy[i].id });
    } else {
      // Pool: round-robin over the healthy subset, reuse allowed. If none pass, nothing is created
      // (see noProxyReason).
      const { healthy, checked } = await collectHealthy(pool, count);
      availableProxies = healthy.length;
      proxyVerifyExcluded = Math.max(0, checked - healthy.length);
      if (healthy.length) {
        for (let i = 0; i < count; i += 1) assignments.push({ proxyId: healthy[i % healthy.length].id });
      } else {
        effectiveCount = 0;
        proxyLimited = true;
      }
    }
    if (effectiveCount === 0) noProxyReason = poolMatched === 0 ? 'no-match' : 'none-healthy';
  } else if (proxyMode === 'paste') {
    const lines = Array.from(new Set(
      String(input.proxyList || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    ));
    availableProxies = lines.length;
    effectiveCount = Math.min(count, availableProxies);
    if (effectiveCount < count) proxyLimited = true;
    for (let i = 0; i < effectiveCount; i += 1) {
      assignments.push({ proxyRaw: lines[i], proxyType: optionalString(input.proxyType) });
    }
  }
  // 'direct' → assignments empty, effectiveCount = count, no proxy bound.

  // Create the requested new group only now that at least one profile will go in it.
  if (!groupId && newGroupName && effectiveCount > 0) {
    const g = await db.group.create({ data: { name: newGroupName.slice(0, 80) } });
    groupId = g.id;
  }

  let versionPlan = null;
  if (distributeVersions) {
    const order = shuffleInPlace([...CHROME_VERSIONS]);
    versionPlan = Array.from({ length: effectiveCount }, (_, i) => order[i % order.length]);
  }

  const created = [];
  const errors = [];
  const usedSignatures = new Set();
  const padLen = String(startIndex + Math.max(effectiveCount, 1) - 1).length;

  for (let i = 0; i < effectiveCount; i += 1) {
    const num = String(startIndex + i).padStart(padLen, '0');
    const title = `${prefix}-${num}`;
    const assign = assignments[i] || {};
    const hasProxy = Boolean(assign.proxyId || assign.proxyRaw);

    const profilePayload = {
      title,
      dataDirName: title,
      notes,
      deviceClass,
      startupUrls,
      groupId,
      systemProxyBehavior: hasProxy ? 'PROFILE_PROXY' : 'DIRECT',
      randomFingerprint: false // explicit fingerprint fields are supplied below
    };
    if (assign.proxyId) profilePayload.proxyId = assign.proxyId;
    if (assign.proxyRaw) { profilePayload.proxyRaw = assign.proxyRaw; if (assign.proxyType) profilePayload.proxyType = assign.proxyType; }

    if (randomFp) {
      const verPin = versionPlan ? versionPlan[i] : (optionalString(input.browserVersion) || undefined);
      let fp = null;
      // Retry a few times so the visible hardware tuple stays unique while the pools allow; MAC,
      // device name and canvas seed differ anyway.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        fp = generateFingerprint({ deviceClass, os, browserVersion: verPin });
        const sig = fingerprintSignature(fp);
        if (deviceClass === 'mobile' || !usedSignatures.has(sig)) { usedSignatures.add(sig); break; }
      }
      Object.assign(profilePayload, fp);
      profilePayload.randomFingerprint = false; // fp fields are passed explicitly
      profilePayload.deviceClass = deviceClass;
    }

    try {
      const c = await createProfile(profilePayload);
      created.push(c);
    } catch (e) {
      errors.push({ title, message: (e && e.message) || 'create failed' });
    }
  }

  let message;
  if (noProxyReason === 'no-match') {
    message = `Nothing was created: no proxy in your pool matches the selected source, country, speed or blocklist filter. Change the filters or add proxies. To create profiles without a proxy, choose "No proxy".`;
  } else if (noProxyReason === 'none-healthy') {
    message = `Nothing was created: none of the ${poolMatched} matching prox${poolMatched === 1 ? 'y' : 'ies'} passed the live check, and profiles are never created on your real IP by mistake. Check the proxies on the Proxy Pool page, or choose "No proxy" to create profiles without one.`;
  } else if (proxyLimited) {
    if (proxyMode === 'paste') {
      message = `Created ${created.length} of ${count} requested - you have ${availableProxies} unique proxy line(s). Add ${count - availableProxies} more to create the remaining ${count - effectiveCount}.`;
    } else {
      const failNote = proxyVerifyExcluded ? ` (${proxyVerifyExcluded} failed the live health check and were skipped)` : '';
      message = `Created ${created.length} of ${count} requested - only ${availableProxies} proxy(ies) passed verification${failNote}. Add more working proxies to create the remaining ${count - effectiveCount}.`;
    }
  } else {
    const failNote = proxyVerifyExcluded ? ` - ${proxyVerifyExcluded} unhealthy prox${proxyVerifyExcluded === 1 ? 'y was' : 'ies were'} skipped` : '';
    message = `Created ${created.length} profile${created.length === 1 ? '' : 's'}${groupId ? ' in the selected group' : ''}${failNote}.`;
  }

  return {
    requested: count,
    createdCount: created.length,
    profiles: created,
    proxyLimited,
    availableProxies,
    proxyVerifyExcluded,
    proxyMode,
    noProxyReason,
    groupId,
    errors,
    message
  };
}

async function updateProfile(payload) {
  await requirePermission('profiles.edit');
  let input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProfile(id, { requireEdit: true });
  const existing = await db.profile.findUnique({ where: { id }, include: { proxy: true } });
  if (!existing) throw new Error('Profile not found.');
  // The editor echoes back masked secrets; a mask means "keep what is stored", so a save never
  // overwrites a real password or 2FA seed with dots.
  input = restoreMaskedSecrets(input, existing);

  const data = { ...extractFingerprintData(input) };

  // extractFingerprintData maps a missing field to a concrete default for create(), but the scrub
  // below only drops `undefined`, so on update a partial payload would overwrite saved data.
  // These fields keep their stored value when absent.
  const PATCH_SAFE = [
    ['platformAccounts', 'platformAccounts'],   // saved usernames + passwords
    ['browserSettingsJson', 'browserSettings'], // per-profile browser settings
    ['syncItemsJson', 'syncItems'],
    ['userAgent', 'userAgent'],
    ['enableQuic', 'enableQuic'],
    ['antidetectEngine', 'antidetectEngine'],
    ['randomFingerprint', 'randomFingerprint'],
    // These are `input.x !== false`, so an absent field forces them back ON and
    // silently overrides a deliberate per-profile choice to disable that noise.
    ['canvasNoise', 'canvasNoise'],
    ['webglImageNoise', 'webglImageNoise'],
    ['audioContextNoise', 'audioContextNoise'],
    ['clientRectsNoise', 'clientRectsNoise'],
    ['speechVoicesNoise', 'speechVoicesNoise']
  ];
  for (const [dataKey, inputKey] of PATCH_SAFE) {
    if (input[inputKey] === undefined) delete data[dataKey];
  }

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

  // dataDirName never changes once a profile exists: it names the Chromium user-data folder and seeds
  // the fingerprint (canvas noise, media-device ids, fonts). Changing it would orphan every cookie and
  // login and re-seed the fingerprint. Renaming changes only `title`.
  if (input.dataDirName !== undefined) {
    const requestedDir = sanitizeDataDirName(input.dataDirName);
    if (requestedDir !== existing.dataDirName) {
      console.warn(`[SG][profile:update] ignoring dataDirName change for #${id} (${existing.dataDirName} -> ${requestedDir}); the on-disk profile and its fingerprint seed are immutable`);
    }
  }

  Object.keys(data).forEach(key => data[key] === undefined && delete data[key]);

  const updated = await db.profile.update({ where: { id }, data, include: { proxy: true, group: true } });
  await logActivity(db, updated.id, 'update', `edited "${updated.title}"`);
  return serializeProfile(updated);
}

async function deleteProfile(payload) {
  await requirePermission('profiles.delete');
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
  const existing = await db.profile.findUnique({ where: { id } });
  if (!existing) throw new Error('Profile not found.');

  // Soft delete to Trash after closing any session. Local data is kept so the profile can be
  // restored, unless the delete dialog asked to wipe it.
  const removeLocalData = Boolean(input.removeLocalData);
  await closeAnySession(id).catch(() => {});
  await db.profile.update({ where: { id }, data: { deletedAt: new Date() } });
  if (removeLocalData) await wipeProfileFolders(existing.dataDirName);

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
  await requirePermission('profiles.purge');
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
  const existing = await db.profile.findUnique({ where: { id } });
  if (!existing) throw new Error('Profile not found.');

  // Wipe every engine's folder too: nothing reuses it, and it holds the profile's cookies and logins.
  await closeAnySession(id).catch(() => {});
  const erased = await wipeProfileFolders(existing.dataDirName);
  await db.profile.delete({ where: { id } });

  await logAudit('profile.purge', { profileId: id, detail: { title: existing.title, erased } });
  return { purged: true, id, erased };
}

async function bulkDeleteProfiles(payload) {
  await requirePermission('profiles.delete');
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const { allowed, denied } = await partitionAccessibleProfileIds(ids);
  const result = { trashed: [], errors: denied.map((id) => ({ id, message: 'You do not have access to this profile.' })) };
  for (const id of allowed) {
    try {
      await closeAnySession(id).catch(() => {});
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
  await requirePermission('profiles.purge');
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const { allowed, denied } = await partitionAccessibleProfileIds(ids);
  const result = { purged: [], errors: denied.map((id) => ({ id, message: 'You do not have access to this profile.' })) };
  for (const id of allowed) {
    try {
      const existing = await db.profile.findUnique({ where: { id } });
      if (!existing) { result.errors.push({ id, message: 'Profile not found.' }); continue; }
      await closeAnySession(id).catch(() => {});
      const erased = await wipeProfileFolders(existing.dataDirName);
      await db.profile.delete({ where: { id } });
      result.purged.push(id);
      await logAudit('profile.purge', { profileId: id, detail: { erased, bulk: true } });
    } catch (error) {
      result.errors.push({ id, message: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
  return result;
}

// Broadcasts bulk-launch progress to every window; it lives here for the IPC-parity test.
function emitBulkLaunchProgress(data) {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.webContents.send(CHANNELS.PROFILE_BULK_LAUNCH_PROGRESS, data); } catch (e) { /* window gone */ }
    }
  } catch (e) { /* ignore */ }
}
// State of the single bulk-launch queue (pause, resume, stop); a new bulkLaunchProfiles replaces it.
// It lives at module level so a remounted Profiles page can re-attach via getBulkLaunchStatus().
let bulkLaunchState = { runId: null, active: false, paused: false, aborted: false, total: 0, done: 0, ids: [] };

// Snapshot for a renderer re-attaching to a queue already in flight.
function getBulkLaunchStatus() {
  return {
    runId: bulkLaunchState.runId,
    active: Boolean(bulkLaunchState.active),
    paused: Boolean(bulkLaunchState.paused),
    aborted: Boolean(bulkLaunchState.aborted),
    total: Number(bulkLaunchState.total) || 0,
    done: Number(bulkLaunchState.done) || 0,
    width: Number(bulkLaunchState.width) || 1,
    queue: Boolean(bulkLaunchState.queue),
    ids: Array.isArray(bulkLaunchState.ids) ? bulkLaunchState.ids.slice() : []
  };
}

// Pause/resume/stop the running bulk-launch queue. Fail-safe: unknown actions and
// no-active-queue are no-ops that just report state back.
async function controlBulkLaunch(payload) {
  const input = requireObject(payload);
  const action = String(input.action || '').toLowerCase();
  let closed = [];
  if (action === 'pause') bulkLaunchState.paused = true;
  else if (action === 'resume') bulkLaunchState.paused = false;
  else if (action === 'stop' || action === 'end' || action === 'abort') {
    bulkLaunchState.aborted = true;
    bulkLaunchState.paused = false;
    // Stop also closes the sessions this run started; profiles open before the queue began are the
    // user's and stay open. closeOpened: false opts out.
    if (input.closeOpened !== false && Array.isArray(bulkLaunchState.started)) {
      const started = bulkLaunchState.started.splice(0);
      for (const s of started) {
        try {
          const r = await closeAnySession(s.sessionId);
          if (r && r.closed) closed.push(s.id);
        } catch (e) { /* a session that already died is not an error here */ }
      }
      if (closed.length) reconcileProfileLocks();
    }
  }
  emitBulkLaunchProgress({ phase: 'control', active: bulkLaunchState.active, paused: bulkLaunchState.paused, aborted: bulkLaunchState.aborted, closed });
  return { ...bulkLaunchState, closed };
}

// `state` is the run's own state object, not the module-level bulkLaunchState, so an older run
// can still be stopped after a newer one replaces it.
function waitForSessionClose(sessionId, state) {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      // listAllSessions covers both Chrome and Firefox.
      const isOpen = listAllSessions().some((s) => String(s.sessionId) === String(sessionId));
      // Stop waiting on abort, or a stopped queue hangs until the profile is closed by hand.
      if (!isOpen || (state && state.aborted)) {
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });
}
async function bulkLaunchProfiles(payload) {
  const input = requireObject(payload);
  const ids = parseIdArray(input.ids);
  const result = { launched: [], errors: [] };
  if (ids.length === 0) return result;

  const settings = await getGlobalSettings().catch(() => ({}));
  const settingCap = Math.max(1, Number((settings.performance && settings.performance.launchConcurrency) || 5));
  const cap = input.concurrency != null
    ? Math.max(1, Math.min(32, Number.parseInt(input.concurrency, 10) || settingCap))
    : settingCap;
  const total = ids.length;
  const width = Math.min(cap, total);
  let done = 0;
  let cursor = 0;
  // Abort a run in flight first, or its workers keep launching beside the new run's (a double Launch
  // click). They hold their own state object, so this flag still reaches them after replacement.
  if (bulkLaunchState && bulkLaunchState.active) {
    bulkLaunchState.aborted = true;
    bulkLaunchState.active = false;
  }
  // Per-run state; workers close over this object, not the module-level binding.
  const state = { runId: crypto.randomUUID(), active: true, paused: false, aborted: false, total, done: 0, ids: ids.slice(), width, queue: false, started: [] };
  bulkLaunchState = state;
  emitBulkLaunchProgress({ phase: 'start', total, done, width });

  // Queue mode: each worker holds its slot until the user closes that browser, so `width` profiles
  // stay open and the next opens as a slot frees. Without the flag, a concurrency of 1 means queue.
  const isQueueMode = input.queue !== undefined ? Boolean(input.queue) : (cap === 1);
  state.queue = isQueueMode;

  const worker = async () => {
    while (cursor < ids.length) {
      // Stop: abort the rest of the queue.
      if (state.aborted) break;
      // Pause: hold before starting the next profile (already-open ones stay open).
      while (state.paused && !state.aborted) {
        await new Promise((r) => setTimeout(r, 300));
      }
      if (state.aborted) break;
      const id = ids[cursor++];
      try {
        const session = await launchProfile({ id });
        // geoDegraded: opened on the host timezone; the UI warns.
        const geo = session && session.geoDegraded ? { geoDegraded: true, geoWarning: session.geoWarning || null } : {};
        result.launched.push({ id, sessionId: session.sessionId, ...geo });
        // Stop closes only sessions this run started; a profile already open belongs to the user.
        if (!session.alreadyRunning) state.started.push({ id, sessionId: session.sessionId });

        emitBulkLaunchProgress({ phase: 'launched', id, total, done: done + 1, ok: true, ...geo });

        // Queue mode: hold this worker's slot until the user closes the browser.
        if (isQueueMode) {
          await waitForSessionClose(session.sessionId, state);
        }

        done += 1;
        state.done = done;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push({ id, message });
        done += 1;
        state.done = done;
        emitBulkLaunchProgress({ phase: 'launched', id, total, done, ok: false, message });
      }
    }
  };

  if (isQueueMode) {
    // Queue mode waits on the user, so run the workers in the background and resolve now; awaiting
    // them would hang the IPC call.
    Promise.all(Array.from({ length: width }, () => worker())).then(() => {
      const aborted = state.aborted;
      state.active = false;
      emitBulkLaunchProgress({ phase: 'done', total, done, aborted });
    });
    return { message: "Queue started in background.", launched: [], errors: [] };
  } else {
    await Promise.all(Array.from({ length: width }, () => worker()));
    const aborted = state.aborted;
    state.active = false;
    emitBulkLaunchProgress({ phase: 'done', total, done, aborted });
    return result;
  }
}

async function bulkCloseSessions(payload) {
  const input = requireObject(payload);
  const ids = parseIdArray(input.ids);
  const result = { closed: [], errors: [] };
  for (const id of ids) {
    try {
      const r = await closeAnySession(id); // engine-aware: closes Firefox sessions too
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

// Adds or removes one tag across profiles. Tags are a JSON array per profile, so this is a scoped
// read-modify-write, case-insensitive both ways.
async function assignTagToProfiles(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const tag = String(input.tag || '').trim().slice(0, 40);
  const mode = input.mode === 'remove' ? 'remove' : 'add';
  if (!tag) throw new Error('A tag is required.');
  const { allowed } = await partitionAccessibleProfileIds(ids);
  if (!allowed.length) return { updated: 0, tag, mode };
  const rows = await db.profile.findMany({ where: { id: { in: allowed } }, select: { id: true, tags: true } });
  let updated = 0;
  for (const r of rows) {
    let arr = [];
    try { arr = r.tags ? JSON.parse(r.tags) : []; if (!Array.isArray(arr)) arr = []; } catch (e) { arr = []; }
    const has = arr.some((t) => String(t).toLowerCase() === tag.toLowerCase());
    let next;
    if (mode === 'add') { if (has) continue; next = [...arr, tag]; }
    else { if (!has) continue; next = arr.filter((t) => String(t).toLowerCase() !== tag.toLowerCase()); }
    await db.profile.update({ where: { id: r.id }, data: { tags: JSON.stringify(next) } });
    await logActivity(db, r.id, 'tag', `${mode === 'add' ? 'tagged' : 'untagged'} ${tag}`).catch(() => {});
    updated += 1;
  }
  return { updated, tag, mode };
}

// Takes an explicit [{id,title}] list or a { prefix, start } pattern numbered in the renderer's
// visible order. Only the title changes; dataDirName never does.
async function bulkRenameProfiles(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const { allowed } = await partitionAccessibleProfileIds(ids);
  if (!allowed.length) return { renamed: 0 };
  const allowedSet = new Set(allowed.map((n) => Number(n)));
  let renamed = 0;
  if (Array.isArray(input.renames)) {
    for (const r of input.renames) {
      const id = Number(r && r.id);
      const title = String((r && r.title) || '').trim().slice(0, 120);
      if (!allowedSet.has(id) || !title) continue;
      await db.profile.update({ where: { id }, data: { title } });
      await logActivity(db, id, 'rename', `renamed to ${title}`).catch(() => {});
      renamed += 1;
    }
    return { renamed };
  }
  const prefix = String(input.prefix || '').trim().slice(0, 100);
  if (!prefix) throw new Error('A name prefix is required.');
  let n = Number.isFinite(Number(input.start)) ? Number(input.start) : 1;
  for (const id of ids) { // preserve the sent (visible) order
    if (!allowedSet.has(Number(id))) continue;
    const title = `${prefix} ${n}`.trim().slice(0, 120);
    await db.profile.update({ where: { id: Number(id) }, data: { title } });
    await logActivity(db, Number(id), 'rename', `renamed to ${title}`).catch(() => {});
    n += 1; renamed += 1;
  }
  return { renamed };
}

// ---- Proxy groups ----
async function listProxyGroups() {
  const db = getPrisma();
  const groups = await db.proxyGroup.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { proxies: true } } }
  });
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color || '#3b82f6',
    proxyCount: g._count?.proxies ?? 0,
    createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : g.createdAt
  }));
}

async function createProxyGroup(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const name = requiredString(input.name, 'Group name').slice(0, 80);
  const color = optionalString(input.color) || '#3b82f6';
  const created = await db.proxyGroup.create({ data: { name, color, ownerMemberId: ownerStampId() } });
  return { id: created.id, name: created.name, color: created.color, proxyCount: 0 };
}

async function updateProxyGroup(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const data = {};
  if (input.name !== undefined) data.name = requiredString(input.name, 'Group name').slice(0, 80);
  if (input.color !== undefined) data.color = optionalString(input.color) || '#3b82f6';
  const updated = await db.proxyGroup.update({ where: { id }, data });
  return { id: updated.id, name: updated.name, color: updated.color };
}

async function deleteProxyGroup(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  // Detach proxies first (keep the proxies; only drop the grouping).
  await db.proxy.updateMany({ where: { proxyGroupId: id }, data: { proxyGroupId: null } });
  await db.proxyGroup.delete({ where: { id } });
  await logAudit('proxy-group.delete', { detail: { proxyGroupId: id } });
  return { deleted: true, id };
}

async function assignProxiesToGroup(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const groupId = (input.groupId === null || input.groupId === undefined || input.groupId === '')
    ? null
    : parseId(input.groupId, 'proxyGroupId');
  if (groupId !== null) {
    const group = await db.proxyGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new Error('Selected proxy group does not exist.');
  }
  const { allowed } = await partitionAccessibleProxyIds(ids);
  const res = await db.proxy.updateMany({ where: { id: { in: allowed } }, data: { proxyGroupId: groupId } });
  await pruneEmptyAutoGroups(db); // moving the last proxy out empties an auto group too
  return { assigned: res.count, groupId };
}

// Reassigns proxies across existing profiles. Modes: unique (a distinct proxy each, capped by the
// source), pool (round-robin, reuse allowed), single (input.proxyId to all), shuffle, clear.
// Sources come newest first; the live health gate is opt-in since these are known proxies.
async function bulkAssignProxies(payload) {
  await requirePermission('profiles.edit');
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const mode = (optionalString(input.mode) || 'unique').toLowerCase();
  const { allowed, denied } = await partitionAccessibleProfileIds(ids, { requireEdit: true });
  const result = { mode, updated: [], errors: denied.map((id) => ({ id, message: 'You do not have access to this profile.' })) };
  const finish = (extra = {}) => ({ ...result, assigned: result.updated.length, ...extra });
  if (!allowed.length) return finish({ source: 0 });

  // Apply (or clear) one profile's proxy + keep the cached info string and behavior flag in sync.
  const applyProxy = async (profileId, proxy) => {
    const data = proxy
      ? { proxyId: proxy.id, proxyInfoString: buildProxyInfoString(proxy), systemProxyBehavior: 'PROFILE_PROXY' }
      : { proxyId: null, proxyInfoString: null, systemProxyBehavior: 'DIRECT' };
    await db.profile.update({ where: { id: profileId }, data });
    await logActivity(db, profileId, 'proxy-reassign', proxy ? `proxy → ${proxy.name || `${proxy.host}:${proxy.port}`}` : 'proxy cleared');
    result.updated.push(profileId);
  };
  const safeApply = async (profileId, proxy) => {
    try { await applyProxy(profileId, proxy); }
    catch (e) { result.errors.push({ id: profileId, message: (e && e.message) || 'update failed' }); }
  };

  if (mode === 'clear') {
    for (const id of allowed) await safeApply(id, null);
    return finish({ source: 0 });
  }

  // Shuffle swaps the proxies the selected profiles already have among themselves.
  if (mode === 'shuffle') {
    const rows = await db.profile.findMany({ where: { id: { in: allowed } }, select: { id: true, proxyId: true } });
    const proxied = rows.filter((r) => r.proxyId != null);
    if (proxied.length < 2) throw new Error('Select at least two proxied profiles to shuffle their proxies.');
    const proxyIds = proxied.map((r) => r.proxyId);
    const shifted = proxyIds.map((_, i) => proxyIds[(i + 1) % proxyIds.length]); // rotate by one → every profile swaps
    const uniqueIds = [...new Set(shifted)];
    const proxyRows = await db.proxy.findMany({ where: { id: { in: uniqueIds } } });
    const proxyById = new Map(proxyRows.map((p) => [p.id, p]));
    for (let i = 0; i < proxied.length; i += 1) await safeApply(proxied[i].id, proxyById.get(shifted[i]) || null);
    return finish({ source: proxied.length });
  }

  if (mode === 'single') {
    const proxyId = parseId(input.proxyId, 'proxyId');
    await assertCanAccessProxy(proxyId);
    const proxy = await db.proxy.findUnique({ where: { id: proxyId } });
    if (!proxy) throw new Error('Selected proxy does not exist.');
    for (const id of allowed) await safeApply(id, proxy);
    return finish({ source: 1 });
  }

  // Source for unique/pool: 'all', 'unassigned' (not on a live profile), 'group', or 'paste' (raw
  // lines, created or reused on the fly).
  let sourceProxies = [];
  const source = (optionalString(input.source) || 'all').toLowerCase();
  if (source === 'paste') {
    const lines = Array.from(new Set(String(input.proxyList || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)));
    const typeHint = optionalString(input.proxyType) ? parseProxyType(input.proxyType) : null;
    for (const line of lines) {
      try { const p = await findOrCreateProxy(db, line, null, typeHint); if (p) sourceProxies.push(p); }
      catch (e) { /* skip an unparseable line */ }
    }
  } else {
    const filter = {};
    if (source === 'unassigned') filter.profiles = { none: { deletedAt: null } };
    else if (source === 'group') filter.proxyGroupId = parseId(input.proxyGroupId, 'proxyGroupId');
    sourceProxies = await db.proxy.findMany({
      where: await scopedProxyWhere(Object.keys(filter).length ? filter : undefined),
      orderBy: { createdAt: 'desc' } // newest first, so fresh additions are used first
    });
  }

  // Optional live health gate (skip-recent within 30 min, else test + persist).
  if (input.verifyProxies === true && sourceProxies.length) {
    const FRESH_MS = 30 * 60 * 1000;
    const healthy = [];
    const CONC = 8;
    for (let i = 0; i < sourceProxies.length; i += CONC) {
      const res = await Promise.all(sourceProxies.slice(i, i + CONC).map(async (p) => {
        if (p.lastStatus === 'ok' && p.lastCheckedAt && (Date.now() - new Date(p.lastCheckedAt).getTime()) < FRESH_MS) return { p, ok: true };
        try { const r = await testProxyConnectivity({ type: p.type, host: p.host, port: p.port, username: p.username, password: p.password }); await persistProxyHealth(db, p.id, r).catch(() => {}); return { p, ok: Boolean(r && r.success) }; }
        catch (e) { return { p, ok: false }; }
      }));
      for (const r of res) if (r.ok) healthy.push(r.p);
    }
    sourceProxies = healthy;
  }

  const sourceCount = sourceProxies.length;
  if (!sourceCount) throw new Error('No proxies available in the chosen source to assign.');

  if (mode === 'unique') {
    shuffleInPlace(sourceProxies);
    const n = Math.min(allowed.length, sourceCount);
    for (let i = 0; i < n; i += 1) await safeApply(allowed[i], sourceProxies[i]);
    return finish({ source: sourceCount, limited: n < allowed.length, skipped: allowed.length - n });
  }

  // pool → round-robin the source across every selected profile
  for (let i = 0; i < allowed.length; i += 1) await safeApply(allowed[i], sourceProxies[i % sourceCount]);
  return finish({ source: sourceCount });
}

// Friendly country names for auto-group labels (fall back to the 2-letter code).
const AUTO_GROUP_COUNTRY_NAMES = {
  US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
  DE: 'Germany', FR: 'France', NL: 'Netherlands', ES: 'Spain', IT: 'Italy',
  IE: 'Ireland', SE: 'Sweden', NO: 'Norway', FI: 'Finland', DK: 'Denmark',
  PL: 'Poland', PT: 'Portugal', CH: 'Switzerland', AT: 'Austria', BE: 'Belgium',
  CZ: 'Czechia', RO: 'Romania', GR: 'Greece', HU: 'Hungary',
  JP: 'Japan', KR: 'South Korea', CN: 'China', HK: 'Hong Kong', TW: 'Taiwan',
  SG: 'Singapore', IN: 'India', ID: 'Indonesia', PH: 'Philippines', VN: 'Vietnam',
  TH: 'Thailand', MY: 'Malaysia', TR: 'Turkey', AE: 'United Arab Emirates',
  SA: 'Saudi Arabia', IL: 'Israel', BR: 'Brazil', MX: 'Mexico', AR: 'Argentina',
  CL: 'Chile', CO: 'Colombia', ZA: 'South Africa', NG: 'Nigeria', EG: 'Egypt',
  RU: 'Russia', UA: 'Ukraine', NZ: 'New Zealand'
};
const AUTO_GROUP_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#84cc16'];
function autoGroupColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AUTO_GROUP_COLORS[h % AUTO_GROUP_COLORS.length];
}

// Groups proxies by verified exit geo at `level` country, state or city (falling back to the
// coarser level). Each proxy joins exactly one group; proxies with no known country are skipped.
// `onlyUngrouped` (the auto-run after Test All) leaves manually grouped proxies alone.
async function autoGroupProxies(payload) {
  const input = requireObject(payload || {});
  const level = ['country', 'state', 'city'].includes(String(input.level)) ? String(input.level) : 'country';
  const onlyUngrouped = input.onlyUngrouped === true;
  const db = getPrisma();

  const base = { lastCountry: { not: null } };
  if (onlyUngrouped) base.proxyGroupId = null;
  const proxies = await db.proxy.findMany({
    where: await scopedProxyWhere(base),
    select: { id: true, lastCountry: true, lastRegion: true, lastCity: true }
  });

  const targetName = (p) => {
    const cc = normCountryCode(p.lastCountry);
    if (!cc) return null;
    const country = AUTO_GROUP_COUNTRY_NAMES[cc] || cc;
    if (level === 'country') return country;
    const region = optionalString(p.lastRegion);
    const city = optionalString(p.lastCity);
    if (level === 'state') return region ? `${country} - ${region}` : country;
    return city ? `${country} - ${city}` : (region ? `${country} - ${region}` : country);
  };

  const buckets = new Map();
  for (const p of proxies) {
    const name = targetName(p);
    if (!name) continue;
    if (!buckets.has(name)) buckets.set(name, []);
    buckets.get(name).push(p.id);
  }

  // Find-or-create each group by case-insensitive name, then assign its proxies.
  const existing = await db.proxyGroup.findMany({ select: { id: true, name: true } });
  const byName = new Map(existing.map((g) => [String(g.name).toLowerCase(), g.id]));
  let createdGroups = 0;
  let assigned = 0;
  for (const [name, ids] of buckets) {
    let gid = byName.get(name.toLowerCase());
    if (!gid) {
      const g = await db.proxyGroup.create({ data: { name: name.slice(0, 80), color: autoGroupColor(name), ownerMemberId: ownerStampId(), autoCreated: true } });
      gid = g.id;
      byName.set(name.toLowerCase(), gid);
      createdGroups += 1;
    }
    const res = await db.proxy.updateMany({ where: { id: { in: ids } }, data: { proxyGroupId: gid } });
    assigned += res.count;
  }
  const removedGroups = await pruneEmptyAutoGroups(db); // regrouping at another level can empty some
  return { level, groups: buckets.size, createdGroups, assigned, removedGroups };
}

async function listTags() {
  const db = getPrisma();
  const rows = await db.profile.findMany({ where: { deletedAt: null }, select: { tags: true } });
  return collectTags(rows).sort((a, b) => a.localeCompare(b));
}

// ---- Profile lock-when-in-use ----
// In-memory: blocks a second launch of a profile by a different member (Chromium cannot open one
// userDataDir twice). Locks reconcile against listAllSessions(), so a close or crash clears them.
const profileLocks = new Map(); // profileId(Number) -> { memberId, memberName, sessionId, at }
// A pending reservation covers the gap between the launchability check and a real session lock, so
// a parallel launch cannot slip through. Reconcile never prunes it; a dead launch clears after a TTL.
// teamPolicy.lockBlocks treats a live reservation as blocking.
const { PENDING_LOCK, PENDING_LOCK_TTL_MS } = teamPolicy;

function reconcileProfileLocks() {
  if (profileLocks.size === 0) return;
  const live = new Set(listAllSessions().map((s) => String(s.sessionId)));
  for (const [pid, lock] of profileLocks) {
    if (lock.sessionId === PENDING_LOCK) {
      if (Date.now() - (lock.at || 0) > PENDING_LOCK_TTL_MS) profileLocks.delete(pid);
      continue; // launch in progress - not yet a live session
    }
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

// Two-phase lock: reserve before the heavy spawn, upgrade via acquireProfileLock on success, release
// on failure. releaseReservedLock removes only this reservation object, never another launch's lock.
function reserveProfileLock(profileId, member) {
  const reservation = {
    memberId: (member && member.id != null) ? member.id : currentMemberId,
    memberName: (member && member.name) || 'You',
    sessionId: PENDING_LOCK,
    at: Date.now()
  };
  profileLocks.set(Number(profileId), reservation);
  return reservation;
}
function releaseReservedLock(profileId, reservation) {
  const lock = profileLocks.get(Number(profileId));
  if (lock && lock === reservation && lock.sessionId === PENDING_LOCK) profileLocks.delete(Number(profileId));
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

// A second launch of a profile still starting (double-click, a profile listed twice in a batch)
// joins the first instead of racing past the lock. The caller's permission and access checks run first.
const profileLaunchesInFlight = new Map(); // profileId(Number) -> Promise
async function launchProfile(payload) {
  await requirePermission('profiles.launch');
  const id = parseId(requireObject(payload).id);
  await assertCanAccessProfile(id);
  if (profileLaunchesInFlight.has(id)) return profileLaunchesInFlight.get(id);
  const p = launchProfileNow(payload);
  profileLaunchesInFlight.set(id, p);
  try { return await p; }
  finally { if (profileLaunchesInFlight.get(id) === p) profileLaunchesInFlight.delete(id); }
}

async function launchProfileNow(payload) {
  await requirePermission('profiles.launch');
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
  const profile = await db.profile.findUnique({ where: { id }, include: { proxy: true } });
  if (!profile) throw new Error('Profile not found.');

  // A banned owner tree cannot launch; enforced in main, not just the renderer.
  await assertNotBanned();

  // Block a concurrent launch by a different member (lock-when-in-use).
  const launcher = await getActiveMember();
  assertProfileLaunchable(id, launcher);

  // Global browser / on-startup preferences honored at launch time (fetched before
  // the engine split so the concurrency ceiling applies to Chrome AND Firefox).
  const globalSettings = await getGlobalSettings();

  // Optional cap on running sessions (null/0 = unlimited): refuse with a catchable error rather than
  // run the machine out of memory; the bulk launcher reports it per profile.
  const ceiling = Number((globalSettings.performance && globalSettings.performance.maxConcurrentProfiles) || 0);
  if (ceiling > 0 && listAllSessions().length >= ceiling) {
    const e = new Error(`Concurrent profile limit reached (${ceiling} running). Close a profile or raise the limit in Settings → Performance.`);
    e.code = 'CONCURRENCY_LIMIT';
    throw e;
  }

  // Reserve before the heavy spawn so a parallel launch cannot slip through the check-to-acquire window.
  const reservation = reserveProfileLock(id, launcher);
  try {
    // Firefox has no CDP or MV3, so its launcher configures a dedicated profile through user.js prefs
    // (proxy and auth relay, UA, locale, timezone, WebRTC off).
    const isFirefox = normalizeBrowserCore(profile.browserCore) === BROWSER_CORE.FIREFOX;
    if (isFirefox) {
      const { profileRoot: ffRoot } = getRuntimeConfig();
      const useFfProxy = profile.systemProxyBehavior === 'PROFILE_PROXY';
      const ffRotated = await pickRotationProxy(db, id);
      const ffProxy = ffRotated || (useFfProxy ? profile.proxy : null);
      // Smart Autofill on Firefox: master toggle AND the firefox sub-flag must
      // both be on. Installs the WebExtension + enables the loopback bridge path.
      const ffAutofill = (globalSettings.smartAutofill?.enabled !== false)
        && (globalSettings.smartAutofill?.firefox !== false);
      const ffSession = await firefoxEngine.launchFirefoxProfile({
        profileId: profile.id,
        title: profile.title,
        dataDirName: profile.dataDirName,
        proxy: ffProxy,
        proxyInfoString: ffRotated ? null : (useFfProxy ? profile.proxyInfoString : null),
        startUrl: input.startUrl || 'about:blank',
        // The profile's saved links open as extra tabs; `startUrl` is the per-launch override (the warmer
        // and automation pass one).
        startupUrls: parseStartupUrls(profile.startupUrls),
        profileRoot: ffRoot,
        profile,
        autofillEnabled: ffAutofill
      });
      acquireProfileLock(id, ffSession.sessionId, launcher);
      await db.profile.update({ where: { id }, data: { lastUsedAt: new Date(), launchCount: { increment: 1 } } }).catch(() => {});
      await logActivity(db, id, 'launch', `firefox session ${ffSession.sessionId}${ffRotated ? ` · rotated ${ffRotated.name}` : ''}`);
      return { ...ffSession, rotatedProxy: ffRotated ? serializeProxy(ffRotated) : null };
    }

    // A custom UA that does not match the binary would be a tell, but the Chrome engine always derives
    // the UA from the launched binary, so a mismatch only warns and never blocks the launch.
    const uaStr = String(profile.userAgent || '').trim();
    if (uaStr && uaStr.toLowerCase() !== 'auto') {
      const resolved = resolveBrowserExecutable(profile.browserVersion || profile.browserCore);
      const binaryMajor = resolved && resolved.major ? resolved.major : null;
      const uaChrome = uaStr.match(/Chrome\/(\d+)/i);
      if (!uaChrome || (binaryMajor && Number(uaChrome[1]) !== binaryMajor)) {
        console.warn(`[profile:launch] Profile "${profile.title}" has a custom UA that doesn't match the Chrome ${binaryMajor || '?'} engine - launching with the auto-derived (matching) UA instead.`);
      }
    }

    const { profileRoot } = getRuntimeConfig();
    const useProfileProxy = profile.systemProxyBehavior === 'PROFILE_PROXY';

    // browser + onStartup drive launch flags; website rules drive request filtering.
    const browserSettings = { ...globalSettings.browser, ...globalSettings.onStartup, website: globalSettings.website };

    // Proxy rotation: if a pool is configured, the chosen pool proxy overrides the
    // profile's fixed proxy for this launch (sticky session - same userDataDir).
    const rotated = await pickRotationProxy(db, id);
    const launchProxy = rotated || (useProfileProxy ? profile.proxy : null);
    const launchProxyInfo = rotated ? null : (useProfileProxy ? profile.proxyInfoString : null);

    // Stable Chrome ignores --load-extension, so a profile that opts into extensions launches on
    // Chrome for Testing (chooseBrowserBinary); the rest stay on stealthier real Chrome.
    let perProfileBrowser = {};
    try { perProfileBrowser = profile.browserSettingsJson ? JSON.parse(profile.browserSettingsJson) : {}; } catch (e) { perProfileBrowser = {}; }
    const loadExtensions = perProfileBrowser.loadExtensions === true;
    const globalExtensionDirs = loadExtensions ? await extensionManager.resolveGlobalExtensionDirs() : [];

    const session = await launchProfileSession({
      profileId: profile.id,
      title: profile.title,
      dataDirName: profile.dataDirName,
      proxy: launchProxy,
      proxyInfoString: launchProxyInfo,
      startUrl: input.startUrl || 'about:blank',
      // The profile's saved links open as extra tabs; `startUrl` is the per-launch override (the warmer
      // and automation pass one).
      startupUrls: parseStartupUrls(profile.startupUrls),
      profileRoot,
      headless: Boolean(input.headless), // Cookie Warmer warm-ups run headless
      profile, // full fingerprint config applied at launch
      browserSettings,
      captcha: globalSettings.captcha,
      globalExtensionDirs,
      loadExtensions,
      geoMatchEnabled: !(globalSettings.geoMatch && globalSettings.geoMatch.enabled === false),
      startPageLinks: Array.isArray(globalSettings.startPageLinks) ? globalSettings.startPageLinks : []
    });

    acquireProfileLock(id, session.sessionId, launcher);
    await db.profile.update({ where: { id }, data: { lastUsedAt: new Date(), launchCount: { increment: 1 } } }).catch(() => {});
    await logActivity(db, id, 'launch', `session ${session.sessionId}${rotated ? ` · rotated proxy ${rotated.name}` : ''}`);
    return { ...session, rotatedProxy: rotated ? serializeProxy(rotated) : null };
  } catch (err) {
    releaseReservedLock(id, reservation); // no-op once upgraded, or if it is not ours
    throw err;
  }
}

// Close a session by id on either engine. closeProfileSession() alone does nothing for a Firefox
// session, so every id-only caller (Stop, bulk close, delete, purge, warmer) must come through here.
async function closeAnySession(sessionId) {
  const id = String(sessionId);
  return firefoxEngine.isFirefoxSession(id)
    ? firefoxEngine.closeFirefoxSession(id)
    : closeProfileSession(id);
}

async function closeSession(payload) {
  const input = requireObject(payload);
  const sessionId = requiredString(input.sessionId, 'sessionId');
  const result = await closeAnySession(sessionId);
  reconcileProfileLocks(); // release any lock whose session just ended
  return result;
}

// Combined live sessions across both engines (Chrome + Firefox) for the UI.
function listAllSessions() {
  return [...listActiveSessions(), ...firefoxEngine.listFirefoxSessions()];
}

// Sessions the active viewer is allowed to see (their accessible profiles only).
// Internal callers keep using listAllSessions(); only the IPC surface is scoped.
async function listSessionsForViewer() {
  const all = listAllSessions();
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return all;
  const ids = all.map((s) => Number(s.sessionId)).filter((n) => Number.isFinite(n));
  const { allowed } = await partitionAccessibleProfileIds(ids);
  const allowedSet = new Set(allowed.map((n) => String(n)));
  return all.filter((s) => allowedSet.has(String(Number(s.sessionId))));
}

// ---- Session resilience ----
// SessionState persistence, restore, crash recovery and an opt-in memory-pressure guard. The engines
// report lifecycle through the session-event sink set in registerIpcHandlers.
function emitSessionCrash(data) {
  try { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send(CHANNELS.SESSION_CRASH, data); } catch (e) { /* window gone */ } } } catch (e) { /* ignore */ }
}
function emitMemoryPressure(data) {
  try { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send(CHANNELS.MEMORY_PRESSURE, data); } catch (e) { /* window gone */ } } } catch (e) { /* ignore */ }
}

const restartGuard = new Map(); // profileId -> { count, since } - caps auto-restart loops

// status stays 'running' across a clean quit/crash so the next launch can offer to
// restore; a deliberate user-close marks it 'closed'. crashCount is cumulative.
async function markSessionLaunched(profileId, engine) {
  if (profileId == null) return; // temp/leak-test sessions aren't persisted
  const db = getPrisma();
  const now = new Date();
  try {
    await db.sessionState.upsert({
      where: { profileId: Number(profileId) },
      create: { profileId: Number(profileId), engine: engine || 'chrome', status: 'running', launchedAt: now, lastSeenAt: now, crashCount: 0 },
      update: { engine: engine || 'chrome', status: 'running', launchedAt: now, lastSeenAt: now }
    });
  } catch (e) { /* table may be mid-migration; never block a launch */ }
}
async function markSessionClosed(profileId) {
  if (profileId == null) return;
  try { await getPrisma().sessionState.updateMany({ where: { profileId: Number(profileId) }, data: { status: 'closed', lastSeenAt: new Date() } }); } catch (e) { /* ignore */ }
}
async function markSessionCrashed(profileId) {
  if (profileId == null) return 0;
  const db = getPrisma();
  try {
    const row = await db.sessionState.findUnique({ where: { profileId: Number(profileId) } });
    const crashCount = (row ? row.crashCount : 0) + 1;
    await db.sessionState.upsert({
      where: { profileId: Number(profileId) },
      create: { profileId: Number(profileId), status: 'running', crashCount, lastSeenAt: new Date() },
      update: { crashCount, lastSeenAt: new Date() }
    });
    return crashCount;
  } catch (e) { return 0; }
}

// The sink browserEngine/firefoxEngine call on every launch / close / crash / block page.
function handleSessionEvent(evt) {
  if (!evt || !evt.type) return;
  const pid = (evt.profileId != null) ? Number(evt.profileId) : (Number.isFinite(Number(evt.sessionId)) ? Number(evt.sessionId) : null);
  if (evt.type === 'launched') { markSessionLaunched(pid, evt.engine).catch(() => {}); return; }
  if (evt.type === 'blocked') { onSessionBlocked(evt).catch(() => {}); return; }
  if (pid != null) apiDrivenProfiles.delete(pid); // closed or crashed: no script drives it any more
  if (evt.type === 'closed') {
    if (evt.reason === 'shutdown') return; // app quitting - leave the row 'running' so it can be restored next launch
    markSessionClosed(pid).catch(() => {});
    return;
  }
  if (evt.type === 'crashed') { onSessionCrashed(pid).catch(() => {}); }
}

async function onSessionCrashed(profileId) {
  if (profileId == null) return;
  const crashCount = await markSessionCrashed(profileId);
  let title = `Profile ${profileId}`;
  try { const p = await getPrisma().profile.findUnique({ where: { id: Number(profileId) }, select: { title: true } }); if (p && p.title) title = p.title; } catch (e) { /* ignore */ }
  let settings = {};
  try { settings = await getGlobalSettings(); } catch (e) { /* ignore */ }
  const rec = (settings && settings.crashRecovery) || {};
  const maxRetries = Number(rec.maxRetries) || 2;
  let restarted = false;
  if (rec.autoRestart) {
    const now = Date.now();
    const g = restartGuard.get(Number(profileId)) || { count: 0, since: now };
    if (now - g.since > 5 * 60 * 1000) { g.count = 0; g.since = now; } // reset window after 5 min
    if (g.count < maxRetries) {
      g.count += 1; restartGuard.set(Number(profileId), g);
      restarted = true;
      // Delay so the OS releases the crashed process and userDataDir lock.
      setTimeout(() => { launchProfile({ id: Number(profileId) }).catch(() => {}); }, 1500);
    }
  }
  emitSessionCrash({ profileId: Number(profileId), title, crashCount, restarted });
}

// ---- Switch proxy when a site blocks a profile ----
// browserEngine reports a block page that did not clear by itself. Every block is logged with the
// proxy that met it ('proxy.blocked' rows: proxyId, provider, site, kind, action; the vendor
// scoreboard reads them). With browser.switchProxyOnBlock on, the profile then gets a new IP from
// its vendor or a better spare proxy, and the page opens again.
const blockSwitchTimes = new Map(); // profileId -> times of automatic changes, for the loop guard
const blockSwitchInFlight = new Set(); // profileIds being switched right now
const apiDrivenProfiles = new Set(); // profileIds started over the Local API: a script drives them

function emitSessionBlocked(data) {
  try { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send(CHANNELS.SESSION_BLOCKED, data); } catch (e) { /* window gone */ } } } catch (e) { /* ignore */ }
}

// A macro, parallel run, warm-up, recording or Local API script is driving this profile; closing
// its browser or changing its IP would break that run.
function profileDrivenByAutomation(profileId) {
  const id = Number(profileId);
  if (apiDrivenProfiles.has(id) || profilesInParallelRun().has(id)) return true;
  for (const c of macroRuns.values()) if (Number(c.profileId) === id) return true;
  for (const r of warmerRuns.values()) if ((r.profileIds || []).some((p) => Number(p) === id)) return true;
  return isRecordingMacro(String(id));
}

// A rotation pool picks the launch proxy, so changing the profile's own proxy would not change
// the next launch. Same conditions as pickRotationProxy, without moving its cursor.
async function profileUsesRotationPool(profileId) {
  if ((await resolveProxyPolicyMode(profileId)) === 'sticky') return false;
  const cfg = ((await readSetting('proxyRotation', {})) || {})[profileId];
  return Boolean(cfg && cfg.enabled && Array.isArray(cfg.proxyIds) && cfg.proxyIds.length);
}

async function onSessionBlocked(evt) {
  const profileId = Number(evt.profileId);
  if (!Number.isInteger(profileId) || profileId < 1) return;
  const db = getPrisma();
  const profile = await db.profile.findUnique({ where: { id: profileId }, include: { proxy: true } });
  if (!profile || profile.deletedAt) return;
  // Only Chromium sessions are watched (Firefox has no CDP); skip anything else that reports.
  if (normalizeBrowserCore(profile.browserCore) === BROWSER_CORE.FIREFOX) return;
  const proxyId = Number.isInteger(evt.proxyId) ? evt.proxyId : null;
  const proxy = proxyId != null ? await db.proxy.findUnique({ where: { id: proxyId } }).catch(() => null) : null;
  const site = blockDetect.siteOf(evt.url);
  const kind = String(evt.kind || 'unknown');

  let outcome;
  if (blockSwitchInFlight.has(profileId)) {
    outcome = { action: 'none', reason: 'inProgress' };
  } else {
    blockSwitchInFlight.add(profileId);
    try { outcome = await respondToBlock(evt, profile, proxy); }
    catch (e) { outcome = { action: 'none', reason: 'failed' }; }
    finally { blockSwitchInFlight.delete(profileId); }
  }

  const newProxy = outcome.newProxy || null;
  await logAudit('proxy.blocked', {
    profileId,
    detail: {
      proxyId: proxy ? proxy.id : null,
      provider: proxy ? deriveProvider(proxy) : null,
      proxyName: proxy ? proxy.name : null,
      site,
      kind,
      action: outcome.action,
      reason: outcome.reason || null,
      newProxyId: newProxy ? newProxy.id : null,
      newProxyName: newProxy ? newProxy.name : null
    }
  });
  // No toast while a run drives the profile: a warm-up over many profiles would flood the screen,
  // and the run's own log shows the failed page.
  if (outcome.reason === 'busy') return;
  emitSessionBlocked({
    profileId, title: profile.title || `Profile ${profileId}`, site, kind,
    action: outcome.action, reason: outcome.reason || null, limit: blockDetect.SWITCH_LIMIT,
    proxyName: proxy ? proxy.name : null, newProxyName: newProxy ? newProxy.name : null
  });
}

// Tries, in order: a new IP from the vendor (rotation link or DataImpulse sticky port), then a
// better spare proxy. Returns { action: 'rotated' | 'switched' | 'none', reason, newProxy }.
// Automatic changes act with the active member's rights, like the same actions from the UI.
async function respondToBlock(evt, profile, proxy) {
  const id = profile.id;
  const settings = await getGlobalSettings().catch(() => ({}));
  const enabled = !(settings.browser && settings.browser.switchProxyOnBlock === false);
  if (enabled && authGate.decide(CHANNELS.PROFILE_LAUNCH, await ipcAuthState())) return { action: 'none', reason: 'signedOut' };
  const now = Date.now();
  const times = blockDetect.recentSwitches(blockSwitchTimes.get(id), now);
  const plan = blockDetect.planBlockResponse({
    enabled,
    hasProxy: Boolean(proxy),
    busy: profileDrivenByAutomation(id),
    withinBudget: blockDetect.withinSwitchBudget(times, now),
    canRotate: Boolean(proxy) && (Boolean(proxy.rotationUrl) || isDataImpulseSticky(proxy)),
    poolInUse: Boolean(proxy) && (proxy.id !== profile.proxyId || await profileUsesRotationPool(id))
  });
  if (!plan.steps.length) return { action: 'none', reason: plan.reason };

  const retryUrl = blockDetect.retryUrlFor(evt.url);
  let reason = 'failed';
  for (const step of plan.steps) {
    try {
      if (step === 'rotate') {
        const res = await rotateProxyIp({ id: proxy.id });
        if (!res || res.ok === false) { reason = 'failed'; continue; }
        blockSwitchTimes.set(id, [...times, now]);
        await sleepMs(blockDetect.ROTATE_SETTLE_MS);
        await retryBlockedPage(evt.sessionId, evt.url, retryUrl);
        return { action: 'rotated' };
      }
      if (step === 'swap') {
        const swapped = await swapProxyAfterBlock(profile, evt, retryUrl);
        if (swapped) { blockSwitchTimes.set(id, [...times, now]); return swapped; }
        reason = 'noSpare';
      }
    } catch (e) {
      reason = (e && e.code === 'FORBIDDEN') ? 'noPermission' : 'failed';
      console.warn(`[SG][block] profile ${id}: ${step} failed - ${(e && e.message) || e}`);
    }
  }
  return { action: 'none', reason };
}

// The CAPTCHA score's 'swap-proxy' fix for a running profile: the same permission checks, spare
// proxies and scoring, with the blocked proxy counted as failing. The browser closes, the profile
// moves to the spare and opens again on the blocked page. Null when no spare is better.
async function swapProxyAfterBlock(profile, evt, retryUrl) {
  const id = profile.id;
  await requirePermission('profiles.edit');
  await assertCanAccessProfile(id, { requireEdit: true });
  const db = getPrisma();
  const candidates = await db.proxy.findMany({ where: await scopedProxyWhere({ lastStatus: 'ok', profiles: { none: {} } }) });
  const ctx = blockDetect.blockedProxyContext((await captchaContexts(db, [profile])).get(id));
  const best = captchaScore.bestReplacement(profile, ctx, candidates);
  if (!best) return null;
  await db.profile.update({
    where: { id },
    data: { ...best.profileFields, proxyId: best.proxy.id, proxyInfoString: buildProxyInfoString(best.proxy), systemProxyBehavior: 'PROFILE_PROXY' }
  });
  await closeAnySession(evt.sessionId).catch(() => {});
  reconcileProfileLocks();
  // Same pause as a crash restart, so Chrome releases the profile folder first.
  await sleepMs(1500);
  try {
    // The Chrome engine opens its own start page, so the blocked page is opened after launch.
    const session = await launchProfileById(id, 'about:blank');
    if (session && session.sessionId) await retryBlockedPage(session.sessionId, null, retryUrl);
  } catch (e) {
    return { action: 'switched', reason: 'notReopened', newProxy: best.proxy };
  }
  return { action: 'switched', reason: null, newProxy: best.proxy };
}

// Restore candidates: profiles whose SessionState is still 'running' (open at the last exit or
// crash) and not live in this session.
async function getSessionRestore() {
  let settings = {};
  try { settings = await getGlobalSettings(); } catch (e) { /* ignore */ }
  if (settings && settings.sessionRestore && settings.sessionRestore.enabled === false) return { profiles: [] };
  const db = getPrisma();
  let rows = [];
  try { rows = await db.sessionState.findMany({ where: { status: 'running' } }); } catch (e) { return { profiles: [] }; }
  if (!rows.length) return { profiles: [] };
  const live = new Set(listAllSessions().map((s) => String(Number(s.sessionId))));
  const ids = rows.map((r) => r.profileId).filter((id) => !live.has(String(id)));
  if (!ids.length) return { profiles: [] };
  let profiles = [];
  try { profiles = await db.profile.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, title: true } }); } catch (e) { return { profiles: [] }; }
  const { allowed } = await partitionAccessibleProfileIds(profiles.map((p) => p.id));
  const allowedSet = new Set(allowed.map((n) => Number(n)));
  return { profiles: profiles.filter((p) => allowedSet.has(p.id)).map((p) => ({ id: p.id, title: p.title })) };
}

async function runSessionRestore(payload) {
  const input = requireObject(payload);
  const action = String(input.action || 'restore');
  const ids = Array.isArray(input.ids) ? input.ids.map((n) => Number(n)).filter(Number.isFinite) : [];
  if (action === 'dismiss') {
    try { await getPrisma().sessionState.updateMany({ where: { status: 'running' }, data: { status: 'closed' } }); } catch (e) { /* ignore */ }
    return { dismissed: true };
  }
  if (!ids.length) return { launched: 0, errors: [] };
  const res = await bulkLaunchProfiles({ ids }); // respects the concurrency cap
  return { launched: res.launched.length, errors: res.errors };
}

// Per-session memory from one batched Windows tasklist call: main-process RSS in KB. Approximate,
// since Chromium's child processes are not summed.
function readProcessRssKb() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({});
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve({});
      const out = {};
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = line.match(/^"[^"]*","(\d+)",".*?","[^"]*","([\d.,\s]+) K"/);
        if (m) out[Number(m[1])] = Math.round(Number(String(m[2]).replace(/[^\d]/g, '')) || 0);
      }
      resolve(out);
    });
  });
}
async function getSessionResourceUsage() {
  const sessions = listSessionPids();
  const rss = await readProcessRssKb();
  return {
    approximate: true,
    sessions: sessions.map((s) => ({ sessionId: s.sessionId, title: s.title, pid: s.pid, memoryMB: (s.pid && rss[s.pid]) ? Math.round(rss[s.pid] / 1024) : null }))
  };
}

// Opt-in memory-pressure guard: below the free-RAM floor, close the oldest sessions until
// recovered, then notify the renderer.
let memoryGuardBusy = false;
async function checkMemoryPressure() {
  if (memoryGuardBusy) return;
  let settings = {};
  try { settings = await getGlobalSettings(); } catch (e) { return; }
  const cfg = (settings && settings.memoryGuard) || {};
  if (!cfg.enabled) return;
  const total = os.totalmem();
  if (!total) return;
  const lowPct = Number(cfg.lowFreePct) || 12;
  const recoverPct = Number(cfg.recoverFreePct) || 25;
  if ((os.freemem() / total) * 100 >= lowPct) return;
  memoryGuardBusy = true;
  try {
    const closed = [];
    const oldestFirst = listActiveSessions().slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    for (const s of oldestFirst) {
      if ((os.freemem() / total) * 100 >= recoverPct) break;
      try { await closeProfileSession(String(s.sessionId)); closed.push(s.sessionId); } catch (e) { /* ignore */ }
    }
    if (closed.length) {
      reconcileProfileLocks();
      emitMemoryPressure({ closed: closed.length, freePct: Math.round((os.freemem() / total) * 100) });
    }
  } finally { memoryGuardBusy = false; }
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
  emit({ phase: 'start', total, level: 'info', message: `[INFO] Softglaze import started - ${total} profile${total === 1 ? '' : 's'} from "${cached.parsed.fileName}".` });
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

  // Rotation URLs have no Profile column - round-trip them via a Setting map.
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
        // Row has no explicit proxy - bind a saved proxy whose country matches.
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

      // Imported fingerprint and locale fields override the generated base; absent ones keep the default.
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
      // Generate a distinct fingerprint first, then let the imported values override it.
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
  emit({ phase: 'done', total, created: result.createdProfiles.length, proxies: result.createdProxies.length, autoBound: result.autoBound.length, errors: result.errors.length, level: 'info', message: `[INFO] Done - ${result.createdProfiles.length} created, ${result.createdProxies.length} new proxies, ${result.errors.length} error(s).` });
  return result;
}

// ---- Profile migration from other platforms ----
// Owner or Super Admin only, enforced here in main. Each profile and its proxy go in their own
// transaction, so one malformed row cannot abort the transfer; failures are collected.
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
  emit({ phase: 'done', total, created: result.createdProfiles.length, proxies: uniqueProxies, errors: result.errors.length, level: 'info', message: `[INFO] Transfer complete - ${result.createdProfiles.length}/${total} imported, ${uniqueProxies} proxies, ${result.errors.length} error(s).` });
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

// Single source of truth for the export layout, kept symmetrical with the importer's columns so
// an export re-imports cleanly. [header, getter].
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
  // Scope to the member's visible profiles: the export carries raw proxy and account secrets.
  const where = await scopedProfileWhere({ deletedAt: null });
  const profiles = await db.profile.findMany({
    where,
    include: { proxy: true, group: true },
    orderBy: { createdAt: 'asc' }
  });
  const rotationUrls = (await readSetting('profileRotationUrls', {})) || {};
  // profiles.export is rank 1, so blank proxy passwords, account passwords and 2FA keys unless the
  // member may reveal them (the same gates as the profile view and the 2FA code reader).
  await getActiveMember(); // refreshes currentMemberCanRevealProxy
  const revealCreds = currentMemberCanRevealProxy;
  let revealTwoFa = revealCreds;
  if (revealTwoFa) { try { await assertCanRevealKind('twoFactorCode'); } catch (e) { revealTwoFa = false; } }
  const headers = EXPORT_COLUMNS.map((c) => c[0]);
  const rows = profiles.map((p) => EXPORT_COLUMNS.map((c) => {
    if (!revealCreds && (c[0] === 'Proxy Password' || c[0] === 'Account Password')) return '';
    if (!revealCreds && c[0] === 'Proxy Info') return p.proxy ? `${p.proxy.host}:${p.proxy.port}:${p.proxy.username || ''}:` : '';
    if (!revealTwoFa && c[0] === '2FA Key') return '';
    return c[1](p, rotationUrls);
  }));
  return { headers, rows, count: profiles.length };
}

// Data API (returns the full matrix for programmatic use).
async function exportProfiles() {
  await requirePermission('profiles.export');
  return gatherExport();
}

// Native save-dialog export to a CSV or Excel workbook (default xlsx).
async function exportProfilesToFile(payload) {
  await requirePermission('profiles.export');
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

// ---- Activity history ----

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

// ---- Live leak test (reads real values from the running browser) ----

function isPrivateIp(ip) {
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/i.test(ip) || /\.local$/i.test(ip);
}

async function liveProfileLeak(payload) {
  const input = requireObject(payload);
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
    checks.push({ key: 'webrtc', label: 'WebRTC', status: 'pass', detail: `Candidates: ${webrtcIps.join(', ')} - no public IP leak vs exit.` });
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

// ---- CAPTCHA score ----

const HOST_OS_LABEL = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

// Size of a profile's cookie store (plus its write-ahead log), or null when it has never been opened.
async function profileCookieBytes(profile, root) {
  if (!profile.dataDirName) return null;
  const files = profile.browserCore === 'Firefox'
    ? [path.join(root, 'firefox', profileData.firefoxDirName(profile.dataDirName), 'cookies.sqlite')]
    : [path.join(root, profile.dataDirName, 'Default', 'Network', 'Cookies'), path.join(root, profile.dataDirName, 'Default', 'Cookies')];
  let total = null;
  for (const file of files) {
    for (const suffix of ['', '-wal', '-journal']) {
      try { total = (total || 0) + (await fs.stat(file + suffix)).size; } catch (e) { /* not there */ }
    }
  }
  return total;
}

// Everything the score needs besides the profile row, for a batch of rows (with their proxy).
async function captchaContexts(db, rows) {
  const proxyIds = [...new Set(rows.map((r) => r.proxyId).filter(Boolean))];
  const usage = new Map();
  if (proxyIds.length) {
    const users = await db.profile.findMany({ where: { proxyId: { in: proxyIds }, deletedAt: null }, select: { proxyId: true } });
    for (const u of users) usage.set(u.proxyId, (usage.get(u.proxyId) || 0) + 1);
  }
  const settings = (await getGlobalSettings().catch(() => ({}))).browser || {};
  const root = path.resolve(getRuntimeConfig().profileRoot);
  const hostOs = HOST_OS_LABEL[process.platform] || 'Linux';
  const warmStats = (await readSetting('warmStats', {})) || {};
  const out = new Map();
  for (const r of rows) {
    out.set(r.id, {
      proxy: r.proxy,
      sharedWith: r.proxyId ? Math.max(0, (usage.get(r.proxyId) || 1) - 1) : 0,
      settings,
      hostOs,
      cookieBytes: await profileCookieBytes(r, root),
      warmRuns: warmStats[r.id] ? Number(warmStats[r.id].runs) || 0 : 0
    });
  }
  return out;
}

// Scores up to 500 profiles from stored data only (no network), for the Profiles list.
async function captchaScores(payload) {
  const input = requireObject(payload);
  const ids = parseIdArray(input.ids).slice(0, 500);
  if (!ids.length) return { scores: {} };
  const { allowed } = await partitionAccessibleProfileIds(ids);
  const db = getPrisma();
  const rows = await db.profile.findMany({ where: { id: { in: allowed } }, include: { proxy: true } });
  const contexts = await captchaContexts(db, rows);
  const scores = {};
  for (const r of rows) scores[r.id] = captchaScore.scoreProfile(r, contexts.get(r.id));
  return { scores };
}

// Applies one fix from a CAPTCHA score. Profile fixes need edit rights on that profile; the
// third-party cookie switch is workspace-wide, so only the Owner may flip it.
async function captchaFix(payload) {
  const input = requireObject(payload);
  const action = String(input.action || '');
  if (action === 'allow-3p-cookies') {
    await requireOwnerOrSuper('change workspace browser settings');
    await setGlobalSettings({ browser: { blockThirdPartyCookies: false } });
    await logAudit('settings.third-party-cookies', { detail: 'Allowed from the CAPTCHA score' });
    return { ok: true, scope: 'workspace' };
  }
  await requirePermission('profiles.edit');
  const id = parseId(input.id);
  await assertCanAccessProfile(id, { requireEdit: true });
  const db = getPrisma();
  const profile = await db.profile.findUnique({ where: { id }, include: { proxy: true } });
  if (!profile) throw new Error('Profile not found.');

  const fields = captchaScore.PROFILE_FIELD_FIXES[action];
  if (fields) {
    await db.profile.update({ where: { id }, data: fields });
    return { ok: true };
  }
  if (action === 'check-proxy') {
    if (!profile.proxy) throw new Error('This profile has no proxy to check.');
    await assertCanAccessProxy(profile.proxy.id);
    const p = profile.proxy;
    const result = await deepCheckProxy({ type: p.type, host: p.host, port: p.port, username: p.username, password: p.password });
    await persistProxyHealth(db, p.id, result);
    return { ok: Boolean(result.success), error: result.success ? null : (result.error || 'The proxy did not answer.') };
  }
  if (action === 'swap-proxy' || action === 'assign-proxy') {
    const best = await applySpareProxy(db, profile);
    return { ok: true, proxyName: best.proxy.name, score: best.score };
  }
  throw new Error('Unknown fix.');
}

// Moves a profile to the spare proxy that lowers its CAPTCHA risk most: only proxies no other
// profile uses, from the pool this member may use. Throws NO_SPARE_PROXY / NO_BETTER_PROXY.
async function applySpareProxy(db, profile) {
  const candidates = await db.proxy.findMany({ where: await scopedProxyWhere({ lastStatus: 'ok', profiles: { none: {} } }) });
  if (!captchaScore.pickReplacementProxy(candidates, profile.proxy)) {
    const e = new Error('No spare proxy: every working, clean proxy in your pool is already used by a profile. Add or check more proxies, then try again.');
    e.code = 'NO_SPARE_PROXY';
    throw e;
  }
  const ctx = (await captchaContexts(db, [profile])).get(profile.id);
  const best = captchaScore.bestReplacement(profile, ctx, candidates);
  if (!best) {
    const e = new Error('No better proxy: none of your spare proxies would lower this profile\'s CAPTCHA risk.');
    e.code = 'NO_BETTER_PROXY';
    throw e;
  }
  await db.profile.update({
    where: { id: profile.id },
    data: { ...best.profileFields, proxyId: best.proxy.id, proxyInfoString: buildProxyInfoString(best.proxy), systemProxyBehavior: 'PROFILE_PROXY' }
  });
  return best;
}

// "Fix all" for many profiles: each gets its own safe setting fixes, then a spare proxy when one
// lowers its risk. Proxy checks, warm-ups and the workspace cookie switch stay one click each.
async function captchaFixBulk(payload) {
  await requirePermission('profiles.edit');
  const input = requireObject(payload);
  const ids = parseIdArray(input.ids).slice(0, 1000);
  const { allowed, denied } = await partitionAccessibleProfileIds(ids, { requireEdit: true });
  const db = getPrisma();
  const results = [];
  for (const id of allowed) {
    const row = { id, applied: [], proxyName: null, error: null, errorCode: null };
    try {
      let profile = await db.profile.findUnique({ where: { id }, include: { proxy: true } });
      if (!profile || profile.deletedAt) { row.error = 'Profile not found.'; results.push(row); continue; }
      const score = captchaScore.scoreProfile(profile, (await captchaContexts(db, [profile])).get(id));
      const fields = {};
      for (const action of score.fixes) {
        if (captchaScore.PROFILE_FIELD_FIXES[action]) { Object.assign(fields, captchaScore.PROFILE_FIELD_FIXES[action]); row.applied.push(action); }
      }
      if (Object.keys(fields).length) profile = await db.profile.update({ where: { id }, data: fields, include: { proxy: true } });
      if (score.fixes.includes('swap-proxy') || score.fixes.includes('assign-proxy')) {
        try {
          const best = await applySpareProxy(db, profile);
          row.applied.push('swap-proxy');
          row.proxyName = best.proxy.name;
        } catch (e) {
          if (e.code !== 'NO_SPARE_PROXY' && e.code !== 'NO_BETTER_PROXY') throw e;
          row.error = e.message;
          row.errorCode = e.code;
        }
      }
    } catch (e) { row.error = e.message || 'Fix failed.'; row.errorCode = e.code || 'FAILED'; }
    results.push(row);
  }
  return {
    results,
    denied,
    changed: results.filter((r) => r.applied.length).length,
    swapped: results.filter((r) => r.proxyName).length
  };
}

// Mismatches worth stopping a launch for, per profile; empty when the setting is off.
async function prelaunchCheck(payload) {
  const input = requireObject(payload);
  const ids = parseIdArray(input.ids).slice(0, 500);
  const settings = await getGlobalSettings().catch(() => ({}));
  if (settings.browser && settings.browser.checkBeforeLaunch === false) return { enabled: false, issues: {} };
  if (!ids.length) return { enabled: true, issues: {} };
  const { allowed } = await partitionAccessibleProfileIds(ids);
  const db = getPrisma();
  const rows = await db.profile.findMany({ where: { id: { in: allowed } }, include: { proxy: true } });
  const contexts = await captchaContexts(db, rows);
  const issues = {};
  for (const r of rows) {
    const found = launchCheck.preLaunchIssues(r, contexts.get(r.id));
    if (found.length) issues[r.id] = found;
  }
  return { enabled: true, issues };
}

// ---- Proxy health: persistence and scheduler ----

// Build a human geo label from a check result, e.g. "US Kirkland, Washington 98033".
function proxyGeoLabel(result) {
  if (!result || !result.success) return '';
  const cc = String(result.country || '').toUpperCase();
  const place = [result.city, result.region].filter(Boolean).join(', ');
  const head = [cc, place].filter(Boolean).join(' ');
  const zip = result.zip ? ` ${result.zip}` : '';
  return `${head}${zip}`.trim();
}

async function persistProxyHealth(db, id, result) {
  // A single reading is noisy, so the speed the pool shows and filters on is the median of the last
  // three passing checks; result.latencyMs is set to it so the live and saved values match.
  const rawMs = result.latencyMs;
  const recent = result.success && typeof rawMs === 'number'
    ? await db.proxyHealthEvent.findMany({ where: { proxyId: id, status: 'ok', latencyMs: { not: null } }, orderBy: { ts: 'desc' }, take: 2, select: { latencyMs: true } }).catch(() => [])
    : [];
  const speedMs = result.success && typeof rawMs === 'number' ? medianMs([rawMs, ...recent.map((e) => e.latencyMs)]) : null;
  if (speedMs != null) result.latencyMs = speedMs;
  const data = {
    lastStatus: result.success ? 'ok' : 'fail',
    // Keep why it failed so the pool can tell a quota refusal from a dead exit; cleared on success.
    lastError: result.success ? null : (String(result.error || '').slice(0, 400) || null),
    // A failed check has no speed: how long it took to fail means nothing.
    lastLatencyMs: speedMs,
    lastCountry: result.country || null,
    lastRegion: result.region || null,
    lastCity: result.city || null,
    lastCheckedAt: new Date()
  };
  // The exit network's owner tells a datacenter IP from a home one (CAPTCHA score). A failed check
  // keeps the last known value.
  if (result.success && result.isp) data.lastIsp = String(result.isp).slice(0, 200);
  // Store the DNSBL verdict only when the deep check reached it, so the blacklisted/clean filter
  // survives a reload.
  if (result.blacklist && result.blacklist.checked) data.lastBlacklisted = !!result.blacklist.listed;
  // Refresh the geo part of the name ("Provider • US City, Region"); the part before " • " stays.
  const geo = proxyGeoLabel(result);
  if (geo) {
    try {
      const current = await db.proxy.findUnique({ where: { id }, select: { name: true } });
      const base = String((current && current.name) || '').split(' • ')[0].trim() || 'Proxy';
      data.name = `${base} • ${geo}`;
    } catch (e) { /* leave the name untouched if the lookup fails */ }
  }
  await db.proxy.update({ where: { id }, data }).catch(() => {});
  // Append a time-series event for the history charts (best-effort).
  try {
    await db.proxyHealthEvent.create({ data: { proxyId: id, status: data.lastStatus, latencyMs: result.success && typeof rawMs === 'number' ? rawMs : null, country: data.lastCountry } });
  } catch (e) { /* history is best-effort; never block a health write */ }
}

// Recent health events for one proxy, chronological, for the latency/status charts.
async function getProxyHealthHistory(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id, 'id');
  await assertCanAccessProxy(id); // don't leak another member's proxy latency/geo history
  const limit = Math.min(500, Math.max(10, Number(input.limit) || 200));
  const events = await getPrisma().proxyHealthEvent
    .findMany({ where: { proxyId: id }, orderBy: { ts: 'desc' }, take: limit })
    .catch(() => []);
  return events
    .map((e) => ({ ts: e.ts instanceof Date ? e.ts.toISOString() : e.ts, status: e.status, latencyMs: e.latencyMs, country: e.country }))
    .reverse();
}

// Recent health events per accessible proxy for the Proxy Pool history cards (pass/fail pips and
// a verified-then-failed flag). One scoped query grouped in JS, not one round-trip per proxy.
async function getRecentProxyHealth(payload) {
  const input = (payload && typeof payload === 'object') ? payload : {};
  const perProxy = Math.min(20, Math.max(3, Number(input.perProxy) || 8));   // pips per card
  const maxProxies = Math.min(60, Math.max(1, Number(input.maxProxies) || 40));
  const db = getPrisma();
  // Same fail-closed scope as listProxies: a member sees only their subtree's proxies.
  const proxies = await db.proxy
    .findMany({ where: await scopedProxyWhere(undefined), select: { id: true, name: true, host: true, port: true, type: true } })
    .catch(() => []);
  if (!proxies.length) return [];
  const byId = new Map(proxies.map((p) => [p.id, p]));
  const ids = proxies.map((p) => p.id);
  const events = await db.proxyHealthEvent
    .findMany({ where: { proxyId: { in: ids } }, orderBy: { ts: 'desc' }, take: Math.min(3000, ids.length * perProxy + 200) })
    .catch(() => []);
  // Keep the newest `perProxy` events per proxy (events already arrive newest-first).
  const grouped = new Map();
  for (const e of events) {
    let arr = grouped.get(e.proxyId);
    if (!arr) { arr = []; grouped.set(e.proxyId, arr); }
    if (arr.length < perProxy) arr.push(e);
  }
  const iso = (t) => (t instanceof Date ? t.toISOString() : t);
  const cards = [];
  for (const [proxyId, evs] of grouped) {
    const p = byId.get(proxyId);
    if (!p) continue;
    const checks = evs.slice().reverse().map((e) => ({ ts: iso(e.ts), status: e.status === 'ok' ? 'ok' : 'fail', latencyMs: e.latencyMs })); // oldest → newest
    const latest = evs[0];
    // Regressed: passed at least once before and the latest check failed.
    const okBefore = checks.slice(0, -1).some((c) => c.status === 'ok');
    const regressed = okBefore && checks[checks.length - 1].status === 'fail';
    cards.push({
      proxyId, name: p.name, host: p.host, port: p.port, type: p.type,
      checks,
      lastTs: iso(latest.ts),
      lastStatus: latest.status === 'ok' ? 'ok' : 'fail',
      lastLatencyMs: latest.latencyMs,
      okCount: checks.filter((c) => c.status === 'ok').length,
      failCount: checks.filter((c) => c.status !== 'ok').length,
      regressed
    });
  }
  cards.sort((a, b) => new Date(b.lastTs) - new Date(a.lastTs)); // most-recently-checked first
  return cards.slice(0, maxProxies);
}

// ---- Vendor scoreboard ----
// Success rate, speed and blocklist rate per proxy vendor from this workspace's own checks. Scoped
// like the pool: a member sees only the proxies they may use, and only those proxies' checks and
// blocks. The event window is bounded so a large pool still answers quickly.
const SCOREBOARD_MAX_EVENTS = 50000;
const SCOREBOARD_MAX_BLOCKS = 20000;

async function getVendorScoreboard() {
  await requirePermission('proxies.manage');
  const db = getPrisma();
  const now = Date.now();
  const since = new Date(now - vendorScoreboard.WINDOW_MS);
  const scope = await scopedProxyWhere(undefined);
  const proxies = await db.proxy.findMany({
    where: scope,
    select: { id: true, name: true, provider: true, lastStatus: true, lastBlacklisted: true, lastIsp: true, lastCheckedAt: true }
  });
  if (!proxies.length) return { ...vendorScoreboard.buildScoreboard({ now }), truncated: false, maxEvents: SCOREBOARD_MAX_EVENTS };
  // Unscoped (Owner, Super Admin, single user), every event belongs to a listed proxy or to a
  // deleted one that buildScoreboard drops, so no id list is sent. A member's query names their ids.
  const ids = proxies.map((p) => p.id);
  const eventWhere = scope ? { proxyId: { in: ids }, ts: { gte: since } } : { ts: { gte: since } };
  const [events, blocks] = await Promise.all([
    db.proxyHealthEvent.findMany({
      where: eventWhere,
      orderBy: { ts: 'desc' },
      take: SCOREBOARD_MAX_EVENTS,
      select: { proxyId: true, status: true, latencyMs: true, ts: true }
    }).catch(() => []),
    // A block names its proxy inside the JSON detail; buildScoreboard keeps only the listed proxies'.
    db.activityLog.findMany({
      where: { action: 'proxy.blocked', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: SCOREBOARD_MAX_BLOCKS,
      select: { detail: true, createdAt: true }
    }).catch(() => [])
  ]);
  const board = vendorScoreboard.buildScoreboard({ proxies, events, blocks, now, vendors: PROXY_VENDORS });
  return { ...board, truncated: events.length >= SCOREBOARD_MAX_EVENTS, maxEvents: SCOREBOARD_MAX_EVENTS };
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
  // The scheduled sweep and the manual "Test all" share one code path.
  await runProxyHealthSweepConcurrent(8);
}

// Runs up to `limit` health checks at a time through the single-proxy checker; returns
// { total, ok, fail }.
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

// Returns only a count summary, no secrets, so it is safe for any role.
async function testAllProxies() {
  const summary = await runProxyHealthSweepConcurrent(8);
  // Fresh results carry geo, so group the ungrouped proxies by country; manual groups are untouched.
  try { await autoGroupProxies({ level: 'country', onlyUngrouped: true }); } catch (e) { /* ignore */ }
  return summary;
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

// Global settings, one JSON blob under `globalSettings`. Reads merge defaults with stored overrides;
// writes deep-merge a partial patch. Only `browser` and `onStartup` are enforced by launchProfile;
// the other groups are stored preferences that the rest of the app reads.
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
    // Off = Chrome's normal default (third-party cookies allowed outside Incognito),
    // which CAPTCHA providers rely on. See browserEngine.ensureCookiePolicyPref.
    blockThirdPartyCookies: false,
    // Before a profile opens from the Profiles page, list clear mismatches (OS, GPU, screen,
    // language, timezone, WebRTC, dead proxy) and offer to fix them.
    checkBeforeLaunch: true,
    // When a site shows a block or CAPTCHA wall, rotate the IP or move the profile to a better
    // spare proxy and open the page again (Chrome-based profiles; capped per profile per hour).
    switchProxyOnBlock: true,
    enableVirtualCamera: false,
    mobileSimulation: false,
    secureAccess: false,
    disableVideos: false,
    disableImages: false,
    imageMinKb: 10,
    // Opt-in: switch the engine to rebrowser to drop the persistent CDP Runtime.enable, a top anti-bot
    // tell. While on, persona autofill, start-page check-links and sync mirror stop working (they need
    // the CDP binding).
    minimizeCdpFootprint: false,
    // fingerprint-chromium spoofs the fingerprint at the binary level and blocks the WebRTC real-IP
    // leak, with no JS-injection race. Falls back to stock Chrome when the binary is absent.
    antidetectEngine: false
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
  // Derive each profile's timezone, locale and WebRTC IP from its proxy's geo at launch; off means
  // only the manually configured values apply.
  geoMatch: {
    enabled: true
  },
  // Footer branding, editable by the Super Admin. `{year}` becomes the current year and http(s)
  // URLs are auto-linked; keep it one short line.
  branding: {
    footerEnabled: true,
    footerText: '© {year} SoftGlaze - Built by the [SoftGlaze Team](https://softglaze.com) · Developed by [Azhar Ali](https://azhar.softglaze.com)'
  },
  // launchConcurrency caps parallel spawns in a bulk launch (Chromium is RAM-heavy).
  // maxConcurrentProfiles caps running sessions (null = unlimited); launches past it are reported.
  performance: { launchConcurrency: 5, maxConcurrentProfiles: null },
  // Resilience: restore last session's profiles on next launch; auto-restart crashed
  // profiles (opt-in, capped); close oldest sessions under memory pressure (opt-in).
  sessionRestore: { enabled: true },
  crashRecovery: { autoRestart: false, maxRetries: 2 },
  memoryGuard: { enabled: false, lowFreePct: 12, recoverFreePct: 25 },
  // Saved profile-filter presets (name + filter state) - managed from the Profiles page.
  profileFilters: [],
  // `enabled` is the Smart Autofill master toggle; `firefox` also gates the Firefox WebExtension
  // path (no CDP there, so it uses the loopback bridge).
  smartAutofill: { enabled: true, firefox: true },
  // Activity and security events older than this are pruned at startup; 0 keeps them forever.
  audit: { retentionDays: 90 }
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

// Provider trial notes record the Super Admin's own vendor testing, so the IPC read leaves them out
// and the IPC write refuses them for everyone else. Internal callers use the functions above.
const SUPER_ONLY_GLOBAL_KEYS = Object.freeze(['proxyProviderTrials']);

async function activeIsSuperAdmin() {
  const m = await getActiveMember();
  return Boolean(m && m.role === 'SUPER_ADMIN');
}

function withoutSuperOnlyKeys(settings) {
  const out = { ...settings };
  for (const k of SUPER_ONLY_GLOBAL_KEYS) delete out[k];
  return out;
}

async function getGlobalSettingsForActor() {
  const all = await getGlobalSettings();
  return (await activeIsSuperAdmin()) ? all : withoutSuperOnlyKeys(all);
}

async function setGlobalSettingsForActor(payload) {
  const input = requireObject(payload);
  const isSuper = await activeIsSuperAdmin();
  if (!isSuper && SUPER_ONLY_GLOBAL_KEYS.some((k) => Object.prototype.hasOwnProperty.call(input, k))) {
    const err = new Error('Only the Super Admin can track provider trials.');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const next = await setGlobalSettings(input);
  return isSuper ? next : withoutSuperOnlyKeys(next);
}

// Saved proxy provider credentials, one workspace-wide Setting blob keyed by provider; secret
// fields are DPAPI-sealed via secretStore. apiUrl is secret: a Live Proxies link carries the access code.
const PROXY_CRED_SECRET_FIELDS = ['password', 'token', 'apiToken', 'apiUrl'];
const PROXY_CRED_PLAIN_FIELDS = ['username', 'zone', 'plan', 'host', 'port', 'orderId'];

async function readProxyProviderCredMap() {
  const raw = await readSetting('proxyProviderCreds', {});
  return raw && typeof raw === 'object' ? raw : {};
}

async function getProxyProviderCreds(payload) {
  // Returns decrypted workspace vendor credentials, so Owner or Super Admin only, like the write path.
  await requireOwnerOrSuper('view proxy provider credentials');
  const input = requireObject(payload);
  const provider = requiredString(input.provider, 'provider').toLowerCase();
  const map = await readProxyProviderCredMap();
  const stored = map[provider];
  if (!stored || typeof stored !== 'object') return { found: false };
  const out = { found: true };
  for (const f of PROXY_CRED_PLAIN_FIELDS) if (stored[f] != null) out[f] = stored[f];
  // Secrets are sealed at rest; open() is fail-safe (returns input if not sealed).
  for (const f of PROXY_CRED_SECRET_FIELDS) if (stored[f] != null) out[f] = secretStore.open(stored[f]);
  return out;
}

async function saveProxyProviderCreds(payload) {
  await requireOwnerOrSuper('change proxy provider credentials');
  const input = requireObject(payload);
  const provider = requiredString(input.provider, 'provider').toLowerCase();
  const map = await readProxyProviderCredMap();
  const entry = { ...(map[provider] && typeof map[provider] === 'object' ? map[provider] : {}) };
  for (const f of PROXY_CRED_PLAIN_FIELDS) {
    if (input[f] === undefined) continue;
    const v = String(input[f] == null ? '' : input[f]).trim();
    if (v) entry[f] = v; else delete entry[f];
  }
  for (const f of PROXY_CRED_SECRET_FIELDS) {
    if (input[f] === undefined) continue;
    const v = String(input[f] == null ? '' : input[f]);
    if (v) entry[f] = secretStore.seal(v); else delete entry[f];
  }
  map[provider] = entry;
  await writeSetting('proxyProviderCreds', map);
  return { ok: true };
}

// ---- Affiliate links for the Proxy Providers tab ----
// A { providerKey: url } override map under `affiliateLinks`. Reads are open (the URLs are public);
// writes need Owner or Super Admin. A blank value clears the override back to the built-in default.
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

// ---- Team extensions ----
// Chrome Web Store .crx files unzipped locally; global ones join --load-extension at every launch.
// Installs and edits need ADMIN+ since they reach every profile; listing is open.
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

  // Throws a friendly message on any download or unzip failure; manual installs default to enabled.
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

// ---- Identity Data Vault (personas for Smart Autofill) ----
// usedOnUrls lists the hosts a persona was used on, so the widget stops offering it there. Passwords
// are plaintext because autofill types them verbatim; optional whole-DB encryption covers them at rest.

// Persona fields the vault accepts from the client, in form order. `id`,
// `usedOnUrls`, and the timestamps are managed by the DB / handlers.
const PERSONA_TEXT_FIELDS = Object.freeze([
  'label', 'firstName', 'lastName', 'email', 'username', 'password', 'phone',
  'dateOfBirth', 'addressLine1', 'addressLine2', 'city', 'state', 'zipCode',
  'country', 'company', 'companyAddress'
]);
// Required at the model level (NOT NULL). Coerced to '' if a sparse import row
// omits them, so a bulk import never aborts on a single missing cell.
const PERSONA_REQUIRED_FIELDS = Object.freeze(['firstName', 'lastName', 'email', 'username', 'password']);

// Reduce a URL or bare hostname to a comparable registrable host: lowercase, no
// scheme/path, no leading "www.". Returns '' when nothing usable is present.
function normalizeHostname(value) {
  let s = String(value == null ? '' : value).trim().toLowerCase();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `http://${s}`; // give URL() a scheme to parse
  let host = '';
  try { host = new URL(s).hostname; } catch (e) { host = ''; }
  return host ? host.replace(/^www\./, '') : '';
}

// Parse a persona's usedOnUrls JSON blob into a clean, deduped hostname list.
function parseUsedOnUrls(value) {
  try {
    const arr = JSON.parse(value || '[]');
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.map((h) => String(h || '').trim().toLowerCase()).filter(Boolean))];
  } catch (e) {
    return [];
  }
}

// Build a clean PersonaData write payload from arbitrary client input: keep only
// known fields, coerce to trimmed strings, and guarantee the required ones exist.
function sanitizePersonaInput(raw) {
  const input = requireObject(raw, 'persona');
  const data = {};
  for (const f of PERSONA_TEXT_FIELDS) {
    if (input[f] === undefined || input[f] === null) continue;
    const v = String(input[f]).trim();
    if (v) data[f] = v;
  }
  for (const f of PERSONA_REQUIRED_FIELDS) {
    if (data[f] === undefined) data[f] = '';
  }
  return data;
}

// Shape a DB row for the renderer: ISO timestamps + a derived usedOnUrls array and
// usedCount for the "Times Used" column and per-domain availability checks.
function serializePersona(p) {
  const used = parseUsedOnUrls(p.usedOnUrls);
  return {
    id: p.id,
    label: p.label || null,
    firstName: p.firstName || '',
    lastName: p.lastName || '',
    email: p.email || '',
    username: p.username || '',
    password: p.password || '',
    phone: p.phone || null,
    dateOfBirth: p.dateOfBirth || null,
    addressLine1: p.addressLine1 || null,
    addressLine2: p.addressLine2 || null,
    city: p.city || null,
    state: p.state || null,
    zipCode: p.zipCode || null,
    country: p.country || null,
    company: p.company || null,
    companyAddress: p.companyAddress || null,
    usedOnUrls: used,
    usedCount: used.length,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : (p.createdAt || null),
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : (p.updatedAt || null)
  };
}

// Persists personas already mapped in the renderer (it reads the file and maps the columns).
async function importPersonas(payload) {
  await requirePermission('vault.manage');
  const input = requireObject(payload);
  const list = Array.isArray(input.personas) ? input.personas : [];
  if (list.length === 0) throw new Error('No personas were provided to import.');
  if (list.length > 5000) throw new Error('Too many rows in one import (max 5000).');
  const rows = list.map(sanitizePersonaInput);
  const result = await getPrisma().personaData.createMany({ data: rows });
  return { created: result.count };
}

async function createPersonaManual(payload) {
  await requirePermission('vault.manage');
  const data = sanitizePersonaInput(payload);
  const created = await getPrisma().personaData.create({ data });
  return serializePersona(created);
}

async function getAllPersonas() {
  await requirePermission('vault.manage'); // returns plaintext passwords
  const rows = await getPrisma().personaData.findMany({ orderBy: { createdAt: 'desc' } });
  return { personas: rows.map(serializePersona) };
}

// Password-free projection for list payloads: the plaintext password never leaves main in a list.
// getPersonaSecretById resolves it per persona at fill time; `hasPassword` tells the widget to ask.
function toPublicPersona(p) {
  if (!p || typeof p !== 'object') return p;
  const { password, ...rest } = p;
  return { ...rest, hasPassword: Boolean(password) };
}

// Personas not yet used on this site (registrable domain): one used on learn.example.com counts as
// used on example.com, so a used identity is never offered again on any subdomain.
async function getAvailablePersonasForUrl(payload) {
  const input = requireObject(payload);
  const host = normalizeHostname(input.url ?? input.hostname);
  if (!host) throw new Error('A valid URL or hostname is required.');
  const site = siteKeyOf(host) || host;
  const rows = await getPrisma().personaData.findMany({ orderBy: { createdAt: 'desc' } });
  const available = rows.filter((p) => !parseUsedOnUrls(p.usedOnUrls).some((h) => h === host || siteKeyOf(h) === site));
  // Strip the password at the source, so the Chromium bridge, the Firefox bridge and the renderer
  // channel are all password-free.
  return { hostname: host, personas: available.map((p) => toPublicPersona(serializePersona(p))) };
}

// A page may get a persona's password only if that persona is offered for the committed origin,
// never for an arbitrary or guessed id. Returns { password } or null.
async function getPersonaSecretForUrl(id, url) {
  const pid = optionalString(id);
  if (!pid) return null;
  let avail;
  try { avail = await getAvailablePersonasForUrl({ url }); }
  catch (e) { return null; }
  const offered = (avail && Array.isArray(avail.personas) ? avail.personas : []).some((p) => String(p.id) === pid);
  if (!offered) return null; // not offered for this origin - refuse to resolve
  return getPersonaSecretById(pid);
}

// The autofill bridges serve vault data only while the workspace is unlocked and someone is signed
// in, as authGate requires for renderer IPC (no members counts as the Owner). Fails closed on DB error.
async function personaVaultAvailable() {
  const s = await ipcAuthState();
  if (s.vaultLocked) return false;
  return Boolean(s.signedIn) || !(Number(s.memberCount) > 0);
}

// Server-side only: resolves a persona's password for the trusted CDP autofill bridge, which types
// it in main. Never an IPC channel, never returned to the renderer or page.
async function getPersonaSecretById(id) {
  const pid = optionalString(id);
  if (!pid) return null;
  const row = await getPrisma().personaData.findUnique({ where: { id: pid } });
  return row ? { password: row.password || '' } : null;
}

// Append a domain to a persona's usedOnUrls (deduped) so it stops being offered there.
async function markPersonaUsed(payload) {
  const input = requireObject(payload);
  const id = requiredString(input.id, 'Persona id');
  const host = normalizeHostname(input.url ?? input.hostname);
  if (!host) throw new Error('A valid URL or hostname is required.');
  const db = getPrisma();
  const row = await db.personaData.findUnique({ where: { id } });
  if (!row) throw new Error('Persona not found.');
  const used = parseUsedOnUrls(row.usedOnUrls);
  if (!used.includes(host)) used.push(host);
  const updated = await db.personaData.update({ where: { id }, data: { usedOnUrls: JSON.stringify(used) } });
  return serializePersona(updated);
}

// Reset usedOnUrls to "[]" for specific personas ({ ids }) or all ({ all: true }),
// making them available on every domain again.
async function clearPersonaUsed(payload) {
  await requirePermission('vault.manage');
  const input = requireObject(payload);
  const db = getPrisma();
  if (input.all === true) {
    const result = await db.personaData.updateMany({ data: { usedOnUrls: '[]' } });
    return { updated: result.count };
  }
  const ids = Array.isArray(input.ids) ? input.ids.map((v) => requiredString(v, 'Persona id')) : [];
  if (ids.length === 0) throw new Error('Provide persona ids, or { all: true }, to reset.');
  const result = await db.personaData.updateMany({ where: { id: { in: ids } }, data: { usedOnUrls: '[]' } });
  return { updated: result.count };
}

// Delete specific personas ({ ids }) or clear the whole vault ({ all: true }).
async function deletePersonas(payload) {
  await requirePermission('vault.manage');
  const input = requireObject(payload);
  const db = getPrisma();
  if (input.all === true) {
    const result = await db.personaData.deleteMany({});
    return { deleted: result.count };
  }
  const ids = Array.isArray(input.ids) ? input.ids.map((v) => requiredString(v, 'Persona id')) : [];
  if (ids.length === 0) throw new Error('Provide persona ids, or { all: true }, to delete.');
  const result = await db.personaData.deleteMany({ where: { id: { in: ids } } });
  return { deleted: result.count };
}

// Update patch: only keys present in the input. Unlike sanitizePersonaInput it never fills '' for
// an absent required field, so editing one field leaves the rest alone.
function sanitizePersonaPatch(raw) {
  const input = requireObject(raw, 'persona');
  const data = {};
  for (const f of PERSONA_TEXT_FIELDS) {
    if (input[f] === undefined) continue;
    data[f] = String(input[f] == null ? '' : input[f]).trim();
  }
  return data;
}

async function updatePersona(payload) {
  await requirePermission('vault.manage');
  const input = requireObject(payload);
  const id = requiredString(input.id, 'Persona id');
  const data = sanitizePersonaPatch(input);
  const db = getPrisma();
  if (Object.keys(data).length === 0) {
    const cur = await db.personaData.findUnique({ where: { id } });
    if (!cur) throw new Error('Persona not found.');
    return serializePersona(cur);
  }
  const updated = await db.personaData.update({ where: { id }, data });
  return serializePersona(updated);
}

// Parses the chosen workbook or CSV in main (the renderer never bundles xlsx) and returns headers
// and rows for column mapping, capped at parseDataRows' 1000-row limit.
async function previewPersonaFile() {
  const selection = await dialog.showOpenDialog({
    title: 'Select a spreadsheet of identities to import',
    properties: ['openFile'],
    filters: [{ name: 'Spreadsheet files', extensions: ['xlsx', 'xls', 'csv'] }]
  });
  if (selection.canceled || selection.filePaths.length === 0) return { cancelled: true };
  const filePath = selection.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(ext)) throw new Error('Unsupported file type. Choose an .xlsx, .xls, or .csv file.');
  const parsed = parseDataRows(filePath);
  return { fileName: parsed.fileName, headers: parsed.headers, rows: parsed.rows, totalRows: parsed.rows.length };
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

// fingerprint-chromium status and one-shot fetch: the installer ships without the binary.
async function antidetectEngineStatus() {
  return browserDownloader.getFpChromiumStatus();
}

async function downloadAntidetectEngine() {
  return browserDownloader.startFpChromiumDownload();
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
  const member = await getActiveMember();
  const unrestricted = !member || member.role === 'SUPER_ADMIN';

  // Scope every count to what the viewer may see, mirroring listProfiles/listProxies.
  const profileWhere = await scopedProfileWhere({ deletedAt: null });
  const proxyWhere = await scopedProxyWhere(undefined);

  const [totalProfiles, totalProxies, totalGroups] = await Promise.all([
    db.profile.count({ where: profileWhere }),
    db.proxy.count({ where: proxyWhere }),
    // Groups have no owner of their own - count those that hold a visible profile.
    unrestricted ? db.group.count() : db.group.count({ where: { profiles: { some: profileWhere } } })
  ]);

  // Active sessions: only those running for a profile the viewer can access.
  let activeSessions = listActiveSessions().length + firefoxEngine.listFirefoxSessions().length;
  if (!unrestricted) {
    const sessionIds = [...listActiveSessions(), ...firefoxEngine.listFirefoxSessions()]
      .map((s) => Number(s.sessionId)).filter((n) => Number.isFinite(n));
    const { allowed } = await partitionAccessibleProfileIds(sessionIds);
    activeSessions = allowed.length;
  }

  return { totalProfiles, activeSessions, totalProxies, totalGroups };
}

// ---- Members, roles and vault (app lock) ----
const ROLE_RANK = { OPERATOR: 1, MANAGER: 2, ADMIN: 3, OWNER: 4, SUPER_ADMIN: 5 };
const VALID_ROLES = ['OPERATOR', 'MANAGER', 'ADMIN', 'OWNER']; // SUPER_ADMIN is virtual, never a DB row

// Action -> minimum role rank, from the capability catalog in permissions.js; finer control comes
// from per-member revokes.
const PERMISSIONS = permissions.ACTION_MIN_RANK;

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
  // Per-action overrides only restrict: keep known catalog keys as booleans, never grant what the
  // granter lacks, and store only explicit keys (effectivePermissions fills the rest from the role).
  const reqActions = (requested && requested.actions && typeof requested.actions === 'object') ? requested.actions : null;
  if (reqActions) {
    const gActions = granterPerms.actions || {};
    const actions = {};
    for (const a of permissions.ACTION_CATALOG) {
      if (a.key in reqActions) actions[a.key] = Boolean(reqActions[a.key]) && (gActions[a.key] !== false);
    }
    if (Object.keys(actions).length) out.actions = actions; else delete out.actions;
  } else {
    delete out.actions; // don't persist a raw/garbage actions blob
  }
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
  if (currentMemberId == null) { currentMemberCanRevealProxy = true; return null; } // single-user == owner
  if (permissions.isSuperAdminId(currentMemberId)) { currentMemberCanRevealProxy = true; return { ...permissions.SUPER_ADMIN }; }
  try {
    const m = await getPrisma().member.findUnique({ where: { id: currentMemberId } });
    // Refresh the cached redaction capability (rank baseline + any per-member revoke).
    currentMemberCanRevealProxy = m ? (permissions.effectivePermissions(m).actions['proxies.reveal'] !== false) : true;
    return m;
  } catch (e) { return null; }
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
  // Granular per-member override (restrict-only): an admin can revoke a specific
  // capability the role would otherwise allow. Cannot escalate above role rank.
  const eff = permissions.effectivePermissions(member);
  if (eff.actions && eff.actions[action] === false) {
    const err = new Error('This capability has been turned off for your account by an administrator.');
    err.code = 'FORBIDDEN';
    throw err;
  }
}

// Owner or Super Admin only; single-user mode counts as the owner.
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

// Subscription checkout: Owner or Super Admin (or single-user), and unlike requireOwnerOrSuper a
// banned owner passes so they can pay to restore access.
async function requirePurchaser(action = 'purchase a subscription') {
  const member = await getActiveMember();
  if (!member) return; // single-user mode == owner
  if (member.role !== 'OWNER' && member.role !== 'SUPER_ADMIN') {
    const err = new Error(`Only the Owner or Super Admin can ${action}.`);
    err.code = 'FORBIDDEN';
    throw err;
  }
}

// Ungated catalog for the Members UI toggles; editing a member's actions still needs members.manage.
async function getPermissionCatalog() {
  return { actions: permissions.ACTION_CATALOG };
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
    // Workspace totals shown on the Members page must respect the viewer's scope
    // (an owner/admin must not see the global count across other trees).
    totalProfiles = await db.profile.count({ where: await scopedProfileWhere({ deletedAt: null }) });
    totalProxies = await db.proxy.count({ where: await scopedProxyWhere(undefined) });
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
    // Only a signed-in viewer sees pending invite codes: member:list also runs before sign-in, and a
    // code read there could be redeemed via member:accept-invite with no credential.
    inviteCode: viewer && m.inviteStatus === 'pending' ? m.inviteCode : null,
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
  await logAudit('member.create', { detail: { target: m.id, name: m.name, role } });
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
  if (member.status === 'banned' || member.status === 'suspended') throw new Error('This account is not active - contact your administrator.');
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
  vaultUnlockSource = 'member';
  await db.member.update({ where: { id: updated.id }, data: { lastActiveAt: new Date() } }).catch(() => {});
  await logAudit('member.invite-accept', { detail: { name: updated.name } });
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
  vaultUnlockSource = 'member';
  applyRememberChoice(input.remember, { kind: 'member', identifier, password });
  await db.member.update({ where: { id: member.id }, data: { lastActiveAt: new Date() } }).catch(() => {});
  await logAudit('member.login', { detail: { name: member.name } });
  return serializeMember(member, { isCurrent: true });
}

// Signs out: clears the in-memory and persisted member id so a reload lands on the login screen, and
// locks the workspace when it has a password. The Owner's credential is the workspace password, so
// an unlocked vault would let anyone pick the Owner from the member picker.
async function memberLogout() {
  await logAudit('member.logout'); // log while currentMemberId is still the departing member
  currentMemberId = null;
  await writeSetting('currentMemberId', null).catch(() => {});
  try {
    const v = await readVault();
    if (v.enabled && v.hash) { vaultLocked = true; vaultUnlockSource = null; }
  } catch (e) {
    // Cannot read the vault setting: fail closed.
    vaultLocked = true; vaultUnlockSource = null;
  }
  // Signing out is an explicit "this isn't my session" - forget any remembered
  // auto-login on this device so the next start asks for credentials again.
  rememberStore.clear();
  return { ok: true };
}

// ---- Self-service account settings ----
// Name, avatar and color save directly; email and password need an OTP sent to the member's current
// verified email (requestMemberChange, commitMemberChange).
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

// Step 1 of a sensitive change: validate and stash it in the scoped OTP record, then email a 6-digit
// code to the member's current verified email to prove ownership before anything is committed.
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

// Step 2: verify the code, then apply the stashed change. The code is consumed only on success.
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

  // The login greeting and lookup read the 'account' setting, so keep the Owner's email in sync.
  if (data.email && member.role === 'OWNER') {
    const acct = (await readSetting('account', {})) || {};
    await writeSetting('account', { ...acct, email: data.email });
  }

  await writeSetting(key, null);
  return { ok: true, member: serializeMember(updated, { isCurrent: true }) };
}

// Only an ancestor or the Super Admin may change grants, and they are clamped to the granter's own.
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
  // Clearing the overrides makes effectivePermissions fall back to the role defaults.
  if (input.reset) {
    const reverted = await db.member.update({ where: { id }, data: { permissionsJson: null } });
    await logAudit('member.permissions', { detail: { target: id, name: target.name, reset: true } });
    return serializeMember(reverted);
  }
  const granterPerms = permissions.effectivePermissions(granter);
  const next = clampPermissions(input.permissions, granterPerms, target.role);
  const updated = await db.member.update({ where: { id }, data: { permissionsJson: JSON.stringify(next) } });
  await logAudit('member.permissions', { detail: { target: id, name: target.name } });
  return serializeMember(updated);
}

// Member names are admin-typed free text that lands in the invite HTML body, so escape them.
function escapeEmailHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildInviteEmail(cfg, email, name, role, code) {
  return {
    from: `"${cfg.fromName}" <${cfg.user}>`,
    to: email,
    subject: 'You have been invited to SoftGlaze Browser',
    text: `Hi ${name}, you have been added as a ${role.toLowerCase()}. Your invite code is: ${code}. Open SoftGlaze Browser, choose "Have an invite code?", enter it and set your password.`,
    html: `
      <div style="font-family: sans-serif; max-width: 28rem; margin: 0 auto;">
        <h2>SoftGlaze Browser invitation</h2>
        <p>Hi ${escapeEmailHtml(name)}, you have been added as a <b>${role.toLowerCase()}</b>.</p>
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
  await logAudit('member.update', { detail: { target: id, name: m.name, changed: Object.keys(data) } });
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

// Allows acting on yourself (allowSelf) or a strictly lower-ranked member in your visible subtree.
// Single-user mode and the Super Admin are unrestricted.
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

  // Only members beneath you may be removed, never yourself or an equal or higher role.
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

  // Re-parent direct children to the removed member's parent so no subtree is orphaned.
  await db.member.updateMany({ where: { parentMemberId: id }, data: { parentMemberId: target.parentMemberId ?? null } }).catch(() => {});

  // dataAction: 'reassign' moves ownership and assignment to another member (or the actor);
  // 'delete' trashes owned profiles and removes their proxies and groups;
  // unset unassigns them and orphans owned profiles (owner -> null).
  const dataAction = String(input.dataAction || '').toLowerCase();
  let reassignedTo = null;
  if (dataAction === 'reassign') {
    let toId;
    if (input.reassignToMemberId === 'me' || input.reassignToMemberId == null || input.reassignToMemberId === '') {
      toId = actor ? actor.id : null;
    } else {
      toId = parseId(input.reassignToMemberId, 'reassignToMemberId');
    }
    if (!toId) throw new Error('Choose a member to receive the data.');
    if (toId === id) throw new Error('Cannot reassign the data to the member being deleted.');
    const tgt = await db.member.findUnique({ where: { id: toId } });
    if (!tgt) throw new Error('Reassignment target member not found.');
    if (actor && actor.role !== 'SUPER_ADMIN' && toId !== actor.id) {
      const all = await db.member.findMany();
      if (!permissions.visibleMemberIds(all, actor).has(toId)) throw new Error('You can only reassign data to members you manage.');
    }
    reassignedTo = toId;
    await db.profile.updateMany({ where: { ownerMemberId: id }, data: { ownerMemberId: toId, assignedMemberId: toId } }).catch(() => {});
    await db.profile.updateMany({ where: { assignedMemberId: id }, data: { assignedMemberId: toId } }).catch(() => {});
    await db.proxy.updateMany({ where: { ownerMemberId: id }, data: { ownerMemberId: toId } }).catch(() => {});
    await db.proxyGroup.updateMany({ where: { ownerMemberId: id }, data: { ownerMemberId: toId } }).catch(() => {});
  } else if (dataAction === 'delete') {
    // Owned profiles go to Trash (recoverable, local data kept); assigned-only ones are unassigned.
    // Deleting a proxy nulls proxyId on profiles using it (onDelete: SetNull).
    await db.profile.updateMany({ where: { ownerMemberId: id, deletedAt: null }, data: { deletedAt: new Date(), assignedMemberId: null, ownerMemberId: null } }).catch(() => {});
    await db.profile.updateMany({ where: { assignedMemberId: id }, data: { assignedMemberId: null } }).catch(() => {});
    await db.proxy.deleteMany({ where: { ownerMemberId: id } }).catch(() => {});
    await pruneEmptyAutoGroups(db).catch(() => {});
    await db.proxyGroup.deleteMany({ where: { ownerMemberId: id } }).catch(() => {});
  } else {
    await db.profile.updateMany({ where: { assignedMemberId: id }, data: { assignedMemberId: null } }).catch(() => {});
    await db.profile.updateMany({ where: { ownerMemberId: id }, data: { ownerMemberId: null } }).catch(() => {});
  }

  await db.member.delete({ where: { id } });
  await logAudit('member.delete', { detail: { target: id, name: target.name, role: target.role, dataAction: dataAction || 'orphan', reassignedTo } });
  if (currentMemberId === id) { currentMemberId = null; await writeSetting('currentMemberId', null).catch(() => {}); }
  return { deleted: true, dataAction: dataAction || 'orphan', reassignedTo };
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

  // The quick-switcher works inside an authenticated workspace, not as a login: an active member may
  // only switch to members they manage, never to an equal or higher rank without its password.
  // The boot path (no active actor yet) and the Super Admin are unrestricted.
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
  } else if (!actor) {
    // With no active actor (after logout or a vault unlock) the check above is skipped, so require
    // the target's login password when it has one; password-less members still switch freely.
    if (m.passwordHash) {
      const pw = String(input.password || '');
      if (!verifySecret(pw, m.passwordSalt, m.passwordHash)) {
        const err = new Error('Enter this member’s password to sign in.'); err.code = 'NEED_PASSWORD'; throw err;
      }
    } else {
      // A password-less identity (the registered Owner or a single-user setup) opens from the picker only
      // when the workspace was unlocked with the workspace password; otherwise that password is required.
      if (m.inviteStatus === 'pending') {
        const err = new Error('This invite has not been accepted yet. Redeem the invite code to set a password first.'); err.code = 'INVITE_PENDING'; throw err;
      }
      const v = await readVault();
      const vaultOn = Boolean(v.enabled && v.hash);
      if (vaultOn && vaultUnlockSource !== 'vault') {
        const pw = String(input.password || '');
        if (!pw || !verifySecret(pw, v.salt, v.hash)) {
          const err = new Error('Enter the workspace password to open this account.'); err.code = 'NEED_PASSWORD'; throw err;
        }
        vaultUnlockSource = 'vault';
      }
    }
  }

  // The per-member PIN is a secondary lock that applies to everyone.
  if (m.pinHash && !verifySecret(String(input.pin || ''), m.pinSalt, m.pinHash)) {
    const err = new Error('Incorrect PIN.'); err.code = 'BAD_PIN'; throw err;
  }
  currentMemberId = id;
  await writeSetting('currentMemberId', id).catch(() => {});
  await db.member.update({ where: { id }, data: { lastActiveAt: new Date() } }).catch(() => {});
  return serializeMember(m, { isCurrent: true });
}

// Super Admin: the source owner's login. Bypasses registration and the vault, has every permission.
// Its per-install credential is stored hashed in Setting['superAdminAuth'] = { identifier, salt, hash }.
async function readSuperAdminAuth() {
  const a = await readSetting('superAdminAuth', null);
  return (a && a.hash && a.salt) ? a : null;
}

// Tells the renderer whether to show the first-run setup form or the login form.
async function superAdminStatus() {
  return { configured: Boolean(await readSuperAdminAuth()) };
}

// Creates or changes the credential (changing needs the current password), then signs in.
async function superAdminSetup(payload) {
  const input = requireObject(payload);
  const existing = await readSuperAdminAuth();
  if (existing) {
    if (!verifySecret(String(input.currentPassword || ''), existing.salt, existing.hash)) {
      const err = new Error('Enter your current Super Admin password to change it.'); err.code = 'BAD_CREDS'; throw err;
    }
  } else {
    // Claiming Super Admin needs the source owner's certificate (<userData>/owner.cert, base build only);
    // without it anyone could claim the role, and its licence exemption, on a fresh install.
    if (!(await ownerCertValid())) {
      const err = new Error('The Super Admin role can only be set up on the source owner\'s machine (no valid owner certificate was found). Sign in as the workspace Owner instead.');
      err.code = 'OWNER_CERT_REQUIRED'; throw err;
    }
    // A signed-in lower-privileged member must not seize the top role: allow the first-run claim only
    // when no member is active or the active member is the Owner.
    const actor = await getActiveMember();
    if (actor && actor.role !== 'OWNER' && actor.role !== 'SUPER_ADMIN') {
      const err = new Error('Only the workspace Owner can set up the Super Admin credential.'); err.code = 'FORBIDDEN'; throw err;
    }
    if (!actor) {
      // Pre-login, only a genuine first run (no members yet) may claim the role; otherwise the Owner
      // must sign in first.
      const memberCount = await getPrisma().member.count().catch(() => 0);
      if (memberCount > 0) {
        const err = new Error('This workspace is already set up - sign in as the Owner to configure the Super Admin credential.'); err.code = 'FORBIDDEN'; throw err;
      }
    }
  }
  const identifier = (optionalString(input.identifier) || permissions.DEFAULT_SUPER_ADMIN_IDENTIFIER).toLowerCase();
  const password = String(input.password || '');
  if (password.length < 8) throw new Error('Super Admin password must be at least 8 characters.');
  const { salt, hash } = hashSecret(password);
  await writeSetting('superAdminAuth', { identifier, salt, hash });
  currentMemberId = permissions.SUPER_ADMIN_ID;
  await writeSetting('currentMemberId', currentMemberId).catch(() => {});
  vaultLocked = false;
  vaultUnlockSource = 'super';
  return serializeMember({ ...permissions.SUPER_ADMIN }, { isCurrent: true });
}

async function superLogin(payload) {
  const input = requireObject(payload);
  const identifier = String(input.identifier || input.email || input.username || '').trim().toLowerCase();
  const password = String(input.password || '');
  const auth = await readSuperAdminAuth();
  if (!auth) {
    const err = new Error('No Super Admin credential is set yet - create one to continue.'); err.code = 'SUPER_SETUP_REQUIRED'; throw err;
  }
  const idOk = identifier === String(auth.identifier || permissions.DEFAULT_SUPER_ADMIN_IDENTIFIER).toLowerCase()
    || identifier === String(permissions.SUPER_ADMIN.email).toLowerCase();
  if (!idOk || !verifySecret(password, auth.salt, auth.hash)) {
    const err = new Error('Invalid Super Admin credentials.'); err.code = 'BAD_CREDS'; throw err;
  }
  currentMemberId = permissions.SUPER_ADMIN_ID;
  await writeSetting('currentMemberId', currentMemberId).catch(() => {});
  vaultLocked = false; // source owner is never gated by the workspace vault
  vaultUnlockSource = 'super';
  applyRememberChoice(input.remember, { kind: 'super', identifier, password });
  return serializeMember({ ...permissions.SUPER_ADMIN }, { isCurrent: true });
}

// ---- Database encryption at rest + workspace backup/restore ----
// The SQLite file is encrypted with the vault password while the app is closed or locked. Prisma
// needs a plaintext working file while the app runs unlocked. Off by default.

// ---- Starter content ----
// Seeded once on first DB-ready so a new workspace is not empty. A Setting flag guards it, so it
// never duplicates or touches user-created rows.
const STARTER_MACROS = [
  {
    name: 'Warm & scroll',
    description: 'Visit two popular sites and scroll like a reader - quick organic activity. Runs as-is.',
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
    description: 'Template for a registration form - edit the URL, selectors and values for your target site.',
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
    description: 'Template for a login form - replace the selectors and credentials for your site.',
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
    description: 'Open an article and scroll/pause like a real reader - good for low-key warming. Runs as-is.',
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

// The generator picks the OS at random, so retry until it matches, then fall back to any OS.
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
  } catch (e) { /* best-effort - never block startup */ }
}

// First launch only: download the newest few Chrome and Firefox builds in the background.
// Installed versions are skipped, and the flag is set only once a download starts, so an offline
// first launch retries on the next boot.
const FIRST_RUN_BROWSER_COUNT = 3;
async function maybeSeedBrowsers() {
  try {
    const seeded = await readSetting('firstRunBrowsersSeeded', false);
    // If the flag is set but nothing is installed (a failed first run), fall through and retry.
    let anyInstalled = false;
    try { anyInstalled = (listAvailableBrowsers() || []).length > 0; } catch (e) { /* none yet */ }
    if (seeded && anyInstalled) return;

    let started = 0;

    // Chrome (Chrome-for-Testing) - newest stable majors first.
    try {
      const chrome = await browserDownloader.listDownloadableVersions();
      for (const v of (Array.isArray(chrome) ? chrome : []).slice(0, FIRST_RUN_BROWSER_COUNT)) {
        if (browserDownloader.isInstalled(v.version)) { anyInstalled = true; continue; }
        try { browserDownloader.startDownload(v.version); started += 1; }
        catch (e) { /* skip a single version */ }
      }
    } catch (e) { console.warn('[browser-seed] Chrome catalog unavailable:', e && e.message); }

    // Firefox - newest majors first.
    try {
      const ff = await firefoxEngine.listFirefoxDownloadable();
      const items = ff && Array.isArray(ff.items) ? ff.items : [];
      for (const it of items.slice(0, FIRST_RUN_BROWSER_COUNT)) {
        if (it.installed) { anyInstalled = true; continue; }
        try { firefoxEngine.startFirefoxDownload(it.major); started += 1; }
        catch (e) { /* skip a single version */ }
      }
    } catch (e) { console.warn('[browser-seed] Firefox catalog unavailable:', e && e.message); }

    // Set the flag only once a download has started or a browser exists, so an offline boot retries.
    if (started > 0 || anyInstalled) {
      await writeSetting('firstRunBrowsersSeeded', true).catch(() => {});
      console.log(`[browser-seed] First-run fleet: ${started} download(s) started (latest ${FIRST_RUN_BROWSER_COUNT} Chrome + ${FIRST_RUN_BROWSER_COUNT} Firefox).`);
    } else {
      console.warn('[browser-seed] No downloads started (offline or empty catalogs) - will retry on next launch.');
    }
  } catch (e) { /* never block startup */ }
}

// Restores the member session and vault lock. main.js awaits it before creating the window, because
// the renderer's first members.current() answers from currentMemberId without a DB read, and an
// unrestored session drops a returning user onto the member picker.
async function restoreSession() {
  try {
    const savedMember = await readSetting('currentMemberId', null);
    if (savedMember != null) currentMemberId = Number(savedMember) || null;
    const v = await readSetting('vault', null);
    if (v && v.enabled) { vaultLocked = true; vaultUnlockSource = null; } // require unlock at startup
    else vaultUnlockSource = 'none';
  } catch (e) { /* ignore - fall back to a fresh session */ }
}

// In-flight restoreSession() promise for main.js to await. Null until the DB is readable; on the
// encrypted path the restore happens later, in db:unlock -> afterDbReady.
let sessionRestore = null;
async function whenSessionReady() { try { await sessionRestore; } catch (e) { /* proceed */ } }

async function afterDbReady() {
  pruneEmptyAutoGroups(getPrisma()).catch((e) => console.error('[SG][proxy] empty group cleanup failed', e && e.message ? e.message : e));
  retryPendingProfileWipes().catch((e) => console.error('[SG][profile] pending wipe retry failed', e && e.message ? e.message : e));
  sessionRestore = restoreSession();
  await sessionRestore;
  try { await seedStarters(); } catch (e) { /* best-effort */ }
  // First-run browser fleet - fire-and-forget so the window opens immediately.
  maybeSeedBrowsers().catch(() => {});
  try { await localApi.startIfEnabled(); } catch (e) { /* off by default */ }
  // Licensing backend (when a tenant config is baked): refresh the signed lease on
  // startup + every 6h. Best-effort - offline keeps running on the cached lease.
  if (tenantConfig().enabled) {
    refreshBackendLease().catch(() => {});
    const t = setInterval(() => { refreshBackendLease().catch(() => {}); }, 6 * 60 * 60 * 1000);
    if (t.unref) t.unref();
  }
}

async function dbEncryptionStatus() {
  const info = database.getDbEncryptionInfo();
  let lastBackupAt = null;
  if (info.unlocked) {
    try { lastBackupAt = await readSetting('workspaceLastBackupAt', null); } catch (e) { /* unavailable */ }
  }
  return { ...info, lastBackupAt };
}

// No permission gate: the workspace is not open yet, and the .enc GCM tag authenticates the password.
async function dbUnlock(payload) {
  const input = requireObject(payload);
  const password = String(input.password || '');
  if (!password) throw new Error('Enter your password to unlock the database.');
  if (!database.isDbEncryptionEnabled()) return dbEncryptionStatus();
  await database.unlockEncryptedDb(password); // throws DB_UNLOCK_FAILED / DB_MISSING
  await database.bootstrapDatabase();
  await afterDbReady();
  // The DB key is the vault password and it just worked, so unlock the vault too instead of asking again.
  try {
    const v = await readVault();
    if (v.enabled && v.hash && verifySecret(password, v.salt, v.hash)) { vaultLocked = false; vaultUnlockSource = 'vault'; }
  } catch (e) { /* leave vault locked - the Gate will ask */ }
  // The same password opens both the DB and the vault, so remember it as a 'vault'
  // credential - attemptRememberedUnlock() will replay it through this exact path.
  applyRememberChoice(input.remember, { kind: 'vault', password });
  return dbEncryptionStatus();
}

async function dbEnableEncryption(payload) {
  await requirePermission('vault.manage');
  const input = requireObject(payload);
  if (!input.confirm) throw new Error('Please confirm you understand that a lost password makes the data unrecoverable.');
  const password = String(input.password || '');
  // The DB key is the vault password, so require an enabled vault and verify the password against it.
  const v = await readVault();
  if (!v.enabled || !v.hash) {
    const e = new Error('Set a workspace password (vault) first - database encryption uses it as the key.');
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

  // Decrypt (GCM-verified) before touching any live file, so a wrong password or tampered backup
  // leaves the working DB unchanged.
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
    throw new Error('Restore failed - the previous database has been put back.');
  }
  // Success - remove the (plaintext) safety copy so it can't linger on disk.
  await dbCrypto.secureUnlink(safety);
  await afterDbReady();
  // Keychain-sealed secrets (enc:v1:, DPAPI) only open for the Windows user that sealed them;
  // report the ones this restore could not open so the UI can say so.
  let unreadableSecrets = [];
  try { unreadableSecrets = await findUnreadableSealedSecrets(); } catch (e) { unreadableSecrets = []; }
  return { ok: true, exportedAt: restored.exportedAt, unreadableSecrets };
}

// Every sealed value in the database that secretStore.open() can no longer decrypt
// (it fails closed to ''). Labels only - never the values.
async function findUnreadableSealedSecrets() {
  const db = getPrisma();
  const lost = [];
  const dead = (v) => secretStore.isSealed(v) && secretStore.open(v) === '';
  const walk = (v, label) => {
    if (typeof v === 'string') { if (dead(v)) lost.push(label); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${label}[${i}]`)); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${label}.${k}`);
  };
  const settings = await db.setting.findMany().catch(() => []);
  for (const s of settings) {
    let v = s.value;
    try { v = JSON.parse(s.value); } catch (e) { /* raw string */ }
    walk(v, `setting ${s.key}`);
  }
  const profiles = await db.profile.findMany({ where: { twoFactorSeed: { startsWith: 'enc:v1:' } }, select: { id: true, title: true, twoFactorSeed: true } }).catch(() => []);
  for (const p of profiles) if (dead(p.twoFactorSeed)) lost.push(`profile ${p.title || p.id} 2FA seed`);
  const providers = await db.ipProvider.findMany().catch(() => []);
  for (const p of providers) {
    if (dead(p.apiKey)) lost.push(`IP provider ${p.name || p.id} API key`);
    if (dead(p.secretKey)) lost.push(`IP provider ${p.name || p.id} secret key`);
  }
  // Proxy passwords are sealed too; the client opens them, so ask for the stored values.
  const deadProxies = await proxySecrets.listUnreadableProxyPasswords(db).catch(() => []);
  for (const p of deadProxies) lost.push(`proxy ${p.name || p.id} password`);
  return lost;
}

async function readVault() {
  return readSetting('vault', { enabled: false, hash: null, salt: null, autoLockMinutes: 0 });
}

// ---- Keep me signed in (rememberStore, DPAPI-sealed, off by default) ----
// Login and unlock handlers pass the verified secret to applyRememberChoice();
// attemptRememberedUnlock() replays it at boot through the same paths.

// remember: true seals the blob, false forgets it, undefined leaves the stored one untouched.
function applyRememberChoice(remember, blob) {
  try {
    if (remember === true) rememberStore.write(blob);
    else if (remember === false) rememberStore.clear();
  } catch (e) { /* best-effort - never block a successful login */ }
}

// Opens the gates at startup without a prompt. A blob that no longer works (e.g. the password was
// changed elsewhere) is cleared so it cannot retry forever.
async function attemptRememberedUnlock() {
  const blob = rememberStore.read();
  if (!blob) return { attempted: false, unlocked: false };
  try {
    if (blob.kind === 'vault') {
      const password = String(blob.password || '');
      // 1) The vault password is the DB key: open a still-locked encrypted DB first, as dbUnlock does.
      if (database.isDbEncryptionEnabled() && !database.isDbUnlocked()) {
        await database.unlockEncryptedDb(password);
        await database.bootstrapDatabase();
        await afterDbReady();
      }
      // 2) Clear the workspace vault lock.
      const v = await readVault();
      if (v.enabled && v.hash && verifySecret(password, v.salt, v.hash)) { vaultLocked = false; vaultUnlockSource = 'vault'; }
      return { attempted: true, unlocked: !vaultLocked };
    }
    if (blob.kind === 'super') {
      await superLogin({ identifier: blob.identifier, password: blob.password });
      return { attempted: true, unlocked: true };
    }
    if (blob.kind === 'member') {
      await memberLogin({ identifier: blob.identifier, password: blob.password });
      return { attempted: true, unlocked: true };
    }
    return { attempted: true, unlocked: false };
  } catch (e) {
    // The stored credential no longer opens the gate (password changed, DB
    // restored, etc.). Forget it so the user just sees a normal login once.
    rememberStore.clear();
    return { attempted: true, unlocked: false, error: e && e.message };
  }
}

// Non-secret status for Settings UI. Never returns the sealed credential itself.
function rememberStatus() {
  return rememberStore.status();
}

async function forgetRemembered() {
  rememberStore.clear();
  return rememberStore.status();
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
  // Re-key the .enc before saving the new vault hash: rekeyEncryptedDb throws on failure, leaving both
  // on the old password. Saving the hash first could lock the user out on the next boot.
  if (database.isDbEncryptionEnabled()) {
    await database.rekeyEncryptedDb(next);
  }
  await writeSetting('vault', { enabled: true, hash, salt, autoLockMinutes: Number(input.autoLockMinutes ?? v.autoLockMinutes) || 0 });
  vaultLocked = false;
  vaultUnlockSource = 'vault';
  // Re-seal a remembered vault credential with the new password so auto-login keeps working.
  // Super and member blobs are left alone.
  try {
    const remembered = rememberStore.read();
    if (remembered && remembered.kind === 'vault') rememberStore.write({ kind: 'vault', password: next });
  } catch (e) { /* best-effort */ }
  return vaultStatus();
}

async function vaultUnlock(payload) {
  const input = requireObject(payload);
  const v = await readVault();
  if (!v.enabled || !v.hash) { vaultLocked = false; vaultUnlockSource = 'none'; return vaultStatus(); }
  const password = String(input.password || '');
  if (!verifySecret(password, v.salt, v.hash)) {
    const err = new Error('Incorrect password.'); err.code = 'BAD_PASSWORD'; throw err;
  }
  vaultLocked = false;
  vaultUnlockSource = 'vault';
  applyRememberChoice(input.remember, { kind: 'vault', password });
  return vaultStatus();
}

async function vaultLock() {
  const v = await readVault();
  if (v.enabled) { vaultLocked = true; vaultUnlockSource = null; }
  return vaultStatus();
}

async function vaultDisable(payload) {
  await requirePermission('vault.manage');
  // DB encryption is keyed by the vault password, so removing the vault would strand the encrypted DB;
  // turning encryption off first decrypts it.
  if (database.isDbEncryptionEnabled()) {
    const e = new Error('Turn off database encryption first - it uses your workspace password as its key.');
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
  vaultUnlockSource = 'none';
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

const nodemailer = require('nodemailer');

// SMTP settings come from the DB (Settings > Email), then environment variables. Email is optional:
// without it the code is shown in-app so registration never blocks on a fresh install.
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
    // Offline mode: no transport configured. Registration still works - the
    // renderer surfaces the code to the operator who is at this machine.
    console.warn('[OTP] No SMTP configured - offline mode, code returned in-app.');
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

// The password is never sent to the renderer.
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
  // Owner-only: an Admin could point the host at their own server and send a test email to capture
  // the stored password.
  await requireOwnerOrSuper('change the email (SMTP) settings');
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
  // The kept password belongs to the old server/account: never carry it over to a new
  // host, port or user without a fresh password.
  const newPass = input.pass !== undefined && input.pass !== '';
  const targetChanged = next.host !== String(prev.host ?? '').trim()
    || next.port !== Number(prev.port ?? 465)
    || next.user !== String(prev.user ?? '').trim();
  if (!newPass && targetChanged) next.pass = '';
  await writeSetting('smtp', next);
  return getEmailConfig();
}

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

// OTP records are keyed by purpose + identity so concurrent flows cannot overwrite each other:
// registration by the email being verified, account changes (requestMemberChange) by member id.
function otpKey(scope) {
  return `otp:${String(scope || '').toLowerCase()}`;
}

// The master-account bootstrap creates the first Owner and sets the vault password, so it runs only
// at first run. Otherwise anyone with renderer access could register a new Owner and overwrite the
// vault password. Later owners come through member management.
async function assertFirstRunSetup() {
  let memberCount = 0;
  try { memberCount = await getPrisma().member.count(); } catch (e) { memberCount = 0; }
  const vault = await readSetting('vault', null);
  if (memberCount > 0 || (vault && vault.enabled)) {
    const err = new Error('This workspace is already set up - registration is only available on first run.');
    err.code = 'ALREADY_SETUP';
    throw err;
  }
}

async function accountSendOtp(payload) {
  await assertFirstRunSetup();
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

// Verifies the OTP, creates the Owner, sets the vault password and saves the account profile in one
// privileged step; the OTP is consumed only once everything succeeds.
async function accountRegister(payload) {
  await assertFirstRunSetup(); // first run only; never re-register or overwrite the vault
  const input = requireObject(payload);
  const firstName = requiredString(input.firstName, 'First name');
  const lastName = requiredString(input.lastName, 'Last name');
  const email = requiredString(input.email, 'Email').toLowerCase();
  const phone = String(input.phone || '').trim();
  const password = requiredString(input.password, 'Password');
  const code = String(input.code || '').trim();
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');

  // 1) Verify the OTP without clearing it yet.
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

  // 2) Create the master account as OWNER (always - this is the workspace owner).
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

  // 4) Set the vault password (the Owner is now active, so vault.manage passes).
  const { salt, hash } = hashSecret(password);
  await writeSetting('vault', { enabled: true, hash, salt, autoLockMinutes: Number(input.autoLockMinutes) || 0 });
  vaultLocked = false;
  vaultUnlockSource = 'vault';

  // 5) Save the account profile.
  await writeSetting('account', {
    firstName, lastName, email, phone, verified: true, createdAt: new Date().toISOString()
  });

  // 6) Everything succeeded - now it is safe to consume the OTP.
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

// Workspace-wide activity feed: ActivityLog joined with member names and profile titles.
// Per-install only; cross-machine metrics would need a central backend.
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

// Reassigns profiles to a member (null = unassign) and logs each one. Gated to Admin and above
// and scoped to members the actor can see.
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
  if (await isCertifiedSuperAdmin(m)) {
    return { used: 0, total: -1, type: 'source-owner', remaining: -1, full: false, exempt: true };
  }
  const db = getPrisma();
  const ownerId = await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  const members = await db.member.findMany({ select: { id: true, status: true, parentMemberId: true } });
  return teamPolicy.seatUsage(members, ownerId, lic);
}

// Called from createMember, never on the first-Owner bootstrap. Super Admin and single-user mode
// are unrestricted.
async function assertSeatAvailable() {
  const m = await getActiveMember();
  if (!m || await isCertifiedSuperAdmin(m)) return; // the seat exemption needs the owner certificate
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

// ---- End-to-end encrypted cloud sync ----
// Profiles are encrypted locally before upload to the REST object store (syncTransport.js), so the
// bucket holds only opaque envelopes. The passphrase stays in memory for the session only.

// Identity/fingerprint fields that are safe to sync. Install-local fields (id, dataDirName,
// ownership, assignment, proxy bindings) are not synced.
const SYNC_SCALAR_FIELDS = [
  'browserCore', 'browserBrand', 'browserVersion', 'os', 'osVersion', 'userAgent', 'startupUrls',
  'webrtc', 'timezoneType', 'timezoneCustom', 'locationType', 'locationLat', 'locationLng', 'locationAcc',
  'languageType', 'languageCustom', 'displayLangType', 'displayLangCustom',
  'resolutionType', 'resolutionW', 'resolutionH', 'fontsType',
  'canvasNoise', 'webglImageNoise', 'audioContextNoise', 'clientRectsNoise', 'speechVoicesNoise', 'mediaDevice',
  'webglMetadata', 'webglVendor', 'webglRenderer', 'webgpu',
  'cpuType', 'cpuCores', 'ramType', 'ramGb', 'twoFactorSeed', 'notes'
];

// Session-scoped sync state; the passphrase-derived key lives only here.
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
    passphraseVerifier: c.passphraseVerifier || null,
    // Random per-workspace salt for the E2E master key, never the namespace.
    workspaceSalt: c.workspaceSalt || null
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
  // The E2E key comes from a random per-workspace salt, never the public namespace. Every device needs
  // the same salt, so a bucket-held salt wins and ours is uploaded when the bucket has none;
  // a transport error falls back to the local salt (see resolveWorkspaceSalt).
  const workspaceSalt = await resolveWorkspaceSalt(
    transport,
    c.namespace,
    c.workspaceSalt,
    (s) => writeSetting('cloudSync', { ...c, workspaceSalt: s })
  );
  await engine.deriveMasterKey(String(passphrase), Buffer.from(workspaceSalt, 'base64'));
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
  // The namespace goes into the bucket object key, so keep it to one safe path segment that cannot
  // escape its prefix (see syncTransport._url).
  if (!/^[A-Za-z0-9._-]+$/.test(namespace) || namespace === '.' || namespace === '..') {
    throw new Error('Namespace may only contain letters, numbers, dot, underscore, and hyphen - no path separators.');
  }
  let sealedToken = prev.sealedToken;
  if (input.token !== undefined && input.token !== '') sealedToken = secretStore.seal(String(input.token).trim());

  let passphraseSalt = prev.passphraseSalt;
  let passphraseVerifier = prev.passphraseVerifier;
  const passphrase = (input.passphrase !== undefined && input.passphrase !== '') ? String(input.passphrase) : null;
  if (passphrase) {
    // Re-key only when the passphrase differs; the same passphrase just unlocks and keeps the verifier.
    if (!passphraseVerifier || !verifySecret(passphrase, passphraseSalt, passphraseVerifier)) {
      const h = hashSecret(passphrase); passphraseSalt = h.salt; passphraseVerifier = h.hash;
    }
  }

  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : prev.enabled;
  if (enabled && !baseUrl) throw new Error('Enter the sync endpoint URL before enabling sync.');
  if (enabled && !passphraseVerifier) throw new Error('Set a sync passphrase before enabling sync.');

  // Random per-workspace salt, never the namespace; generated once and kept so the derived key is stable.
  const workspaceSalt = prev.workspaceSalt || crypto.randomBytes(16).toString('base64');
  await writeSetting('cloudSync', { enabled, baseUrl, namespace, sealedToken, passphraseSalt, passphraseVerifier, workspaceSalt });

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

// ---- Transport envelope helpers (encrypt locally, store opaque) ----
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
  return engine.decryptPayload(env); // throws on wrong key - caller surfaces it
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

// ---- Profile <-> sync state mapping ----
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

// Build the update data explicitly so install-local fields are never overwritten with defaults.
async function applyRemoteToProfile(db, profile, remoteState) {
  const fp = (remoteState && remoteState.fingerprint) || {};
  const data = {};
  for (const k of SYNC_SCALAR_FIELDS) if (fp[k] !== undefined) data[k] = fp[k];
  // A payload pushed by a build from before the engine rename may carry a legacy name.
  if (data.browserCore !== undefined) data.browserCore = toStoredBrowserCore(data.browserCore);
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

// Convergence: a second install gains the profiles the first one had.
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

// ---- Licensing / billing (local-first) ----
// Each Owner tree has a licence. Payment is via Cryptomus with the Super Admin's merchant credentials.
const TRIAL_DAYS = 7;
const GRACE_DAYS = 3; // after the trial/paid term lapses: app still works but nags, then bans
const PLAN = Object.freeze({ id: 'monthly', amount: '5', currency: 'USD', months: 1, days: 30, label: '$5 / month' });

// Built-in default plans. The live catalog lives in Setting['billingPlans']; the Super Admin can edit
// it and add packages. These defaults apply when no override is saved. `pro` mirrors PLAN.
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
    tagline: 'Test every feature free - full access, no card required.',
    highlight: false,
    features: Object.freeze([
      'Full access to every feature',
      'All fingerprint, proxy & leak tools',
      'Macros, cookie warmer & mobile profiles',
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
      'Cookie warmer',
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
    tagline: 'For teams - seats, audit export, database encryption and self-hosted sync.',
    highlight: true,
    features: Object.freeze([
      'Everything in Pro, plus:',
      'Parallel runner (up to 10 profiles at once) + live run console',
      'Team seats, profile lock & handoff',
      'Audit-log export (CSV / JSON)',
      'End-to-end encrypted sync to a server you host',
      'Full at-rest database encryption',
      'Priority support'
    ])
  })
]);

// Non-negative numeric string with at most 2 decimals ("0" on garbage), so a malformed price
// never reaches checkout or an invoice.
function sanitizeAmount(value) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return '0';
  return String(Math.round(n * 100) / 100);
}

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
    amount: kind === 'trial' ? '0' : sanitizeAmount(p.amount),
    currency: String(p.currency || PLAN.currency).toUpperCase().slice(0, 6),
    months: Math.max(1, Number.parseInt(p.months, 10) || 1),
    period: String(p.period || 'month').slice(0, 16),
    tagline: String(p.tagline || '').slice(0, 200),
    highlight: Boolean(p.highlight),
    active: p.active === undefined ? true : Boolean(p.active),
    features
  };
}

// The Super Admin's saved overrides if present, else the built-in defaults. Includes inactive plans.
async function readBillingPlans() {
  const stored = await readSetting('billingPlans', null);
  const list = Array.isArray(stored) && stored.length ? stored : DEFAULT_BILLING_PLANS;
  return list.map((p, i) => normalizePlan(p, i));
}

// Falls back to the first active plan, then the first plan, so checkout never gets undefined
// when a plan is deleted between page load and pay.
async function findPlan(planId) {
  const id = String(planId || '').toLowerCase();
  const plans = await readBillingPlans();
  return plans.find((p) => p.id === id) || plans.find((p) => p.active) || plans[0] || normalizePlan(DEFAULT_BILLING_PLANS[0], 0);
}

// Unlike findPlan, rejects a supplied id that no longer resolves instead of charging another plan's
// price. An empty id still falls back to the default plan.
async function findPlanOrThrow(planId) {
  const plan = await findPlan(planId);
  const requested = String(planId == null ? '' : planId).trim().toLowerCase();
  if (requested && requested !== plan.id) {
    throw new Error('That plan is no longer available - refresh and choose a current plan.');
  }
  return plan;
}

// Plans plus the viewer's tier and state, so the Billing page can mark the active plan and pick
// its CTA. `canManage` reveals the plan editor, subscribers and assign controls.
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
    // already on a paid plan (best-effort, local - see the Licenses panel note).
    canStartTrial: !lic.isExempt && !lic.isPaid,
    canManage: await isCertifiedSuperAdmin(me)
  };
}

// ---- Super Admin plan management ----
// All plans including inactive ones, for the editor grid.
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
// must not silently buy back an expired trial - see licensePolicy.clampNow.
async function clampLicenseNow() {
  const stored = await readSetting('licenseClock', null);
  const r = licensePolicy.clampNow({ now: Date.now(), lastSeenAt: stored && stored.lastSeenAt });
  if (!stored || stored.lastSeenAt !== r.lastSeenAt) {
    await writeSetting('licenseClock', { lastSeenAt: r.lastSeenAt }).catch(() => {});
  }
  return { effectiveNow: r.effectiveNow, tampered: r.tampered };
}

// Marks an automatic licence-lapse ban. Only these are auto-cleared when the licence is valid again;
// a Super Admin block stays until it is lifted.
const LICENSE_BAN_REASON = 'Trial and grace period ended.';

// Applies or clears licence-lapse bans on the owner; an admin block (other banReason) is never
// touched. Returns the owner's status so callers can fold an admin block into the effective ban.
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

// Runs the state machine on the tamper-clamped clock and reconciles the owner ban flag.
// The effective ban is a licence lapse or a Super Admin block on the owner.
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
    // The workspace already had its free trial (or a paid term): the Billing page
    // shows "Free trial used" instead of a Start button that would be refused.
    trialUsed: licenseTrialUsed(lic),
    plan: PLAN
  };
}

// Shared by redeem and checkout polling: advances the paid term, optionally sets the tier, and
// clears any ban.
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

// ---- Licensing backend client (only when a tenant config is baked in) ----
// Install identity, online lease refresh and offline entitlement from the cached signed lease.
async function getMachineId() {
  let id = await readSetting('machineId', null);
  if (!id) { id = crypto.randomUUID(); await writeSetting('machineId', id); }
  return id;
}

// The Super Admin is licence-exempt only on a base build holding a valid owner certificate
// (<userData>/owner.cert, signed for licenseClient.machineHash()). Otherwise a SUPER_ADMIN is
// licensed like any Owner and has no licence-management powers.
async function ownerCertValid() {
  try {
    if (ownerCert.isTenantBuild()) return false;
    const { app } = require('electron');
    const file = ownerCert.ownerCertPath(app.getPath('userData'));
    return ownerCert.checkOwnerCertFile(file, { machineId: licenseClient.machineHash() }).ok === true;
  } catch (_) { return false; }
}

async function isCertifiedSuperAdmin(member) {
  if (!member || member.role !== 'SUPER_ADMIN') return false;
  return ownerCert.isCertifiedSuperAdmin(member, await ownerCertValid());
}

// The licensing server returns a per-install secret once, at first registration, and requires it
// for license and redeem. It is kept sealed next to the install id.
// Returns { installId, installSecret } or null.
async function ensureBackendInstall() {
  const installId = await readSetting('backendInstallId', null);
  const sealed = await readSetting('backendInstallSecret', null);
  const installSecret = sealed ? secretStore.open(sealed) : '';
  if (installId && installSecret) return { installId, installSecret };

  const owner = await getPrisma().member.findFirst({ where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' } }).catch(() => null);
  const account = owner && owner.email ? owner.email : null;
  let res;
  try {
    res = await licenseClient.api.register(await getMachineId(), account);
  } catch (e) {
    // The server holds a secret for this machine id that is missing locally (an older install or a lost
    // setting). The id alone is not proof, so start a fresh identity rather than stay locked out.
    if (!/already registered/i.test(String(e && e.message))) throw e;
    await writeSetting('machineId', crypto.randomUUID());
    res = await licenseClient.api.register(await getMachineId(), account);
  }
  if (!res || !res.installId || !res.installSecret) return null;
  await writeSetting('backendInstallId', res.installId);
  await writeSetting('backendInstallSecret', secretStore.seal(String(res.installSecret)));
  return { installId: res.installId, installSecret: String(res.installSecret) };
}

// Fetch + verify + cache the signed lease. Best-effort (network); returns the
// entitlement or null. The cached lease (sealed) is what powers offline grace.
async function refreshBackendLease() {
  if (!tenantConfig().enabled) return null;
  try {
    const install = await ensureBackendInstall();
    if (!install) return null;
    const res = await licenseClient.api.license({ installId: install.installId, installSecret: install.installSecret });
    if (!res || !res.lease) {
      await writeSetting('backendLease', null).catch(() => {}); // no active license server-side
      return null;
    }
    const { effectiveNow } = await clampLicenseNow();
    const ent = licenseClient.verifyLease(res.lease, { nowMs: effectiveNow });
    if (!ent) return null;
    await writeSetting('backendLease', secretStore.seal(JSON.stringify({
      token: res.lease, currentPeriodEnd: res.currentPeriodEnd || null, tier: ent.tier, fetchedAt: Date.now()
    })));
    return { tier: ent.tier, exp: ent.exp, currentPeriodEnd: res.currentPeriodEnd || null };
  } catch (e) { return null; } // offline / backend down → keep using the cached lease
}

// Offline entitlement: re-verify the cached lease token (catches tamper + the
// 7-day lease expiry). Returns { tier, exp, currentPeriodEnd } or null.
async function getBackendEntitlement() {
  if (!tenantConfig().enabled) return null;
  const sealed = await readSetting('backendLease', null);
  if (!sealed) return null;
  let cached;
  try { cached = JSON.parse(secretStore.open(sealed)); } catch (_) { return null; }
  // Verify against the tamper-clamped clock, not the system clock, so rolling the clock back cannot
  // keep a cancelled lease paid offline. The clamp only raises "now", so honest users are unaffected.
  const { effectiveNow } = await clampLicenseNow();
  const ent = licenseClient.verifyLease(cached.token, { nowMs: effectiveNow });
  if (!ent) return null;
  return { tier: ent.tier, exp: ent.exp, currentPeriodEnd: cached.currentPeriodEnd || null };
}

// Render a "paid" license view from a verified backend entitlement. endsAt is the
// subscription period end (not the short lease exp).
function licenseViewFromLease(ent) {
  const endsAt = ent.currentPeriodEnd || (ent.exp ? new Date(ent.exp * 1000).toISOString() : null);
  return {
    type: 'paid', tier: ent.tier === 'enterprise' ? 'enterprise' : 'pro',
    state: 'paid', status: 'active', endsAt,
    daysLeft: null, daysLeftTrial: null, daysLeftGrace: null,
    isExpired: false, isTrial: false, isPaid: true, isGrace: false, isBanned: false,
    isExempt: false, clockTamper: false, purchaseCode: null, plan: PLAN, source: 'backend'
  };
}

// Status surface for the renderer/dev - never returns the lease token itself.
async function backendLicenseInfo() {
  const cfg = tenantConfig();
  if (!cfg.enabled) return { enabled: false };
  const installId = await readSetting('backendInstallId', null);
  const ent = await getBackendEntitlement();
  return {
    enabled: true, tenantId: cfg.tenantId, apiBaseUrl: cfg.apiBaseUrl, installId: installId || null,
    lease: ent ? { tier: ent.tier, exp: ent.exp, currentPeriodEnd: ent.currentPeriodEnd } : null
  };
}

async function getLicense() {
  // The certified Super Admin (valid owner certificate, base build) is exempt from the trial and
  // subscription system; otherwise a SUPER_ADMIN is licensed like any Owner.
  const m = await getActiveMember();
  if (await isCertifiedSuperAdmin(m)) {
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
  // Backend-licensed builds: a verified, unexpired lease means paid; otherwise use the local model.
  // `reason` explains a licensing problem (e.g. the lease is bound to another computer); a machine
  // mismatch never reports paid.
  const issueOf = () => ((licenseClient.licenseIssue && licenseClient.licenseIssue()) || {}).reason || null;
  if (tenantConfig().enabled) {
    const ent = await getBackendEntitlement();
    if (ent && issueOf() !== 'machine_mismatch') return { ...licenseViewFromLease(ent), reason: issueOf() };
  }
  const ownerId = await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  return withLicenseReason(await licenseView(lic), issueOf());
}

// Attach the licensing problem reason; a machine mismatch turns a paid view into an
// ended one (the paid term belongs to the other computer).
function withLicenseReason(view, reason) {
  const out = { ...view, reason: reason || null };
  if (reason === 'machine_mismatch' && (out.isPaid || out.state === 'paid')) {
    Object.assign(out, { state: 'banned', status: 'banned', isPaid: false, isBanned: true });
  }
  return out;
}

// Main-side licence gate: refuse a profile launch when the owner tree is banned, never trusting
// the renderer's gate alone. The Super Admin is exempt only with a valid owner certificate.
async function assertNotBanned() {
  const m = await getActiveMember();
  if (await isCertifiedSuperAdmin(m)) return;
  const ownerId = await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  const view = await licenseView(lic);
  if (view.isBanned) {
    const e = new Error('Your subscription has ended - renew it to launch profiles.');
    e.code = 'LICENSE_BANNED';
    throw e;
  }
}

async function redeemPurchaseCode(payload) {
  await requirePurchaser('redeem a purchase code');
  const input = requireObject(payload);
  const code = requiredString(input.code, 'Purchase code');
  if (tenantConfig().enabled) {
    const install = await ensureBackendInstall();
    if (!install) throw new Error('Could not register this install with the licensing server.');
    await licenseClient.api.redeem({ code: code.trim().toUpperCase(), installId: install.installId, installSecret: install.installSecret });
    const ent = await refreshBackendLease();
    if (!ent) throw new Error('Code accepted, but no active license yet - try again in a moment.');
    return licenseViewFromLease(ent);
  }
  // No offline fallback: codes are issued and checked server-side (see payments.js), since a secret
  // in the binary would let anyone mint codes. Builds without a licensing backend use a Super Admin
  // grant or an in-app payment provider instead.
  const e = new Error(
    'Purchase codes are issued by the licensing server, and this build has no licensing server configured. '
    + 'Use a tenant-provisioned build, or have the workspace owner assign a plan.'
  );
  e.code = 'LICENSING_BACKEND_NOT_CONFIGURED';
  throw e;
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
  // Blocking an Owner is a licence power, so it needs the certified Super Admin.
  if (target.role === 'OWNER' && status !== 'active' && !(await isCertifiedSuperAdmin(actor))) {
    throw new Error('Only the Super Admin can block or suspend an owner.');
  }
  const data = { status };
  data.banReason = status === 'banned' ? (optionalString(input.reason) || 'Blocked by administrator.') : null;
  const updated = await db.member.update({ where: { id }, data });
  // Use logAudit (profileId 0): ActivityLog.profileId is required, so logActivity with null fails silently.
  await logAudit('member.status', { detail: { target: id, name: target.name, status, reason: data.banReason || null } });
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

// Every licence gets its trial when created (ensureLicense), so a set trialEndsAt means it was used;
// a paid type or purchase code means it went past the trial.
function licenseTrialUsed(lic) {
  if (!lic) return false;
  return lic.type === 'paid' || Boolean(lic.purchaseCode) || lic.trialEndsAt != null;
}

// Starts the full-access trial (tier and length from the catalog trial plan). Only the Owner may
// call it; a running trial is returned unchanged and a used one is refused. The certified Super Admin
// can grant a fresh trial to any owner.
async function startTrial(payload) {
  const input = (payload && typeof payload === 'object') ? payload : {};
  const me = await getActiveMember();
  const isSuper = await isCertifiedSuperAdmin(me); // targeting any owner needs the owner certificate
  if (isSuper && (input.ownerId == null || input.ownerId === '')) {
    throw new Error('Choose which owner workspace to start the trial for.');
  }
  if (!isSuper && me && me.role === 'SUPER_ADMIN') throw new Error('This Super Admin has no owner certificate on this machine, so it cannot manage trials.');
  if (!isSuper && me && me.role !== 'OWNER') {
    const err = new Error('Only the workspace Owner can start the free trial.'); err.code = 'FORBIDDEN'; throw err;
  }
  const ownerId = (isSuper && input.ownerId != null && input.ownerId !== '') ? parseId(input.ownerId) : await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  const view = await licenseView(lic);
  if (!isSuper && view.isPaid) throw new Error('You are on a paid plan - the free trial does not apply.');
  if (!isSuper && view.isTrial) return view; // already running: never extended by a click
  if (!isSuper && licenseTrialUsed(lic)) {
    const err = new Error('The free trial has already been used for this workspace. Choose a plan to continue.'); err.code = 'TRIAL_USED'; throw err;
  }
  const trialPlan = (await readBillingPlans()).find((p) => p.kind === 'trial' && p.active) || (await readBillingPlans()).find((p) => p.kind === 'trial');
  const days = trialPlan && trialPlan.trialDays ? trialPlan.trialDays : TRIAL_DAYS;
  const tier = trialPlan ? trialPlan.tier : 'enterprise';
  const updated = await getPrisma().license.update({
    where: { id: lic.id },
    data: { type: 'trial', status: 'active', tier, purchaseCode: null, trialEndsAt: new Date(Date.now() + days * 86400000) }
  });
  await syncOwnerBanState(ownerId, false);
  await logAudit('license.trial-start', { detail: { ownerId, days, bySuperAdmin: isSuper } });
  return licenseView(updated);
}

// Super-Admin: set a license's exact state - type (trial/paid), tier (pro/enterprise),
// expiry date and active flag - for precise edits beyond the quick actions.
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

// Ends a subscription now by pushing the term past grace (profile launch locks). A later grant
// reverses it; this is a clean lapse, not a sticky admin block.
async function terminateLicense(payload) {
  await requireSuperAdmin();
  const input = requireObject(payload);
  const ownerId = parseId(input.ownerId);
  const lic = await ensureLicense(ownerId);
  const past = new Date(Date.now() - (GRACE_DAYS + 1) * 86400000);
  const updated = await getPrisma().license.update({ where: { id: lic.id }, data: { status: 'expired', trialEndsAt: past, purchaseCode: null } });
  await logAudit('license.terminate', { detail: { ownerId } });
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

// ---- Payment gateway (Cryptomus); config is Super Admin only ----
async function requireSuperAdmin() {
  const m = await getActiveMember();
  if (!m || m.role !== 'SUPER_ADMIN') { const e = new Error('Only the Super Admin can manage payment settings.'); e.code = 'FORBIDDEN'; throw e; }
  // Plans, licences and payment settings are the source owner's commercial powers, so they need the
  // owner certificate.
  if (!(await isCertifiedSuperAdmin(m))) {
    const e = new Error('This Super Admin has no owner certificate on this machine, so licence and billing management is disabled.'); e.code = 'OWNER_CERT_REQUIRED'; throw e;
  }
}

// In-memory migration of the legacy single-Cryptomus config ({ provider, cryptomus:{...} }) to the
// per-provider map. The legacy plaintext API key is sealed on the way in.
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

// Secrets come back decrypted, so use this for outbound API calls only.
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
      // Secret values are never returned, only whether one is stored.
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
  // Fully migrated to the providers map - drop the legacy keys.
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

// Enabled checkout methods (no secrets). Automated ones appear only once fully configured; manual
// ones carry their public instructions or pay link.
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
  if (!def || !saved.enabled) throw new Error('That payment method is not available - the administrator has not enabled it.');
  if (def.kind !== 'automated') return { provider: null, cfg: null, def };
  if (!providerConfigured(def, saved)) throw new Error(`${def.label} is enabled but not fully configured.`);
  return { provider: payments.getProvider(chosenId), cfg: await openProviderConfig(chosenId), def };
}

async function startCheckout(payload) {
  await requirePurchaser('purchase a subscription');
  const input = (payload && typeof payload === 'object') ? payload : {};
  if (tenantConfig().enabled) {
    const plan = await findPlanOrThrow(input.planId);
    const install = await ensureBackendInstall();
    if (!install) throw new Error('Could not register this install with the licensing server.');
    const r = await licenseClient.api.checkout({ planKey: plan.id, installId: install.installId, provider: input.provider });
    return { url: r.url, ref: r.ref, provider: r.provider || 'stripe', planId: plan.id, planName: plan.name, backend: true };
  }
  const plan = await findPlanOrThrow(input.planId);
  const { provider, def } = await loadCheckoutProvider(input.provider);
  if (def.kind !== 'automated') throw new Error('That payment method is processed manually - submit your payment for approval instead.');
  const cfg = await openProviderConfig(def.id);
  const ownerId = await resolveLicenseOwnerId();
  const orderId = `sg-${ownerId || 'wks'}-${Date.now()}`;
  const invoice = await provider.createInvoice(cfg, { amount: plan.amount, currency: plan.currency, orderId, lifetime: 3600, productName: `SoftGlaze Browser - ${plan.name}` });
  // Stash the chosen plan + provider so pollCheckout grants the right term/tier.
  await writeSetting('pendingCheckout', { ownerId: ownerId ?? null, provider: def.id, orderId: invoice.orderId, uuid: invoice.uuid, planId: plan.id, tier: plan.tier, months: plan.months, createdAt: Date.now() });
  return { url: invoice.url, uuid: invoice.uuid, orderId: invoice.orderId, amount: invoice.amount, currency: invoice.currency, provider: def.id, planId: plan.id, planName: plan.name };
}

async function pollCheckout(payload) {
  await requirePurchaser('purchase a subscription');
  const input = requireObject(payload || {});
  if (tenantConfig().enabled) {
    const ent = await refreshBackendLease();
    if (ent) return { status: 'paid', paid: true, license: licenseViewFromLease(ent) };
    return { status: 'pending', paid: false };
  }
  const pending = (await readSetting('pendingCheckout', null)) || {};
  const { provider, def } = await loadCheckoutProvider(input.provider || pending.provider);
  if (def.kind !== 'automated' || !provider) return { status: 'manual', paid: false };
  const cfg = await openProviderConfig(def.id);
  // Check the status of the order WE created in startCheckout (server-stashed in
  // pendingCheckout) - NEVER a renderer-supplied id. audit: the old fallback to
  // input.uuid / input.orderId let one co-tenant owner (no pending of their own)
  // poll another owner's unpolled paid order on the same merchant account and be
  // granted the term. There is no legitimate flow that reaches a paid grant without
  // a preceding server-stashed startCheckout, so require one.
  if (!pending.uuid && !pending.orderId) return { status: 'pending', paid: false };
  const ref = pending.uuid ? { uuid: pending.uuid } : { orderId: pending.orderId };
  const st = await provider.getStatus(cfg, ref);
  if (!st.paid) return { status: st.status, paid: false };

  // Idempotency: a paid order is applied EXACTLY once. The renderer polls every few
  // seconds, so without this guard each poll after success would stack another month.
  // Gate on the order id via a small processed-orders ledger.
  const orderKey = String(pending.orderId || pending.uuid || '').trim();
  const processedRaw = (await readSetting('processedCheckouts', [])) || [];
  const processedList = Array.isArray(processedRaw) ? processedRaw : [];
  if (orderKey && processedList.includes(orderKey)) {
    const ownerIdNow = await resolveLicenseOwnerId();
    return { status: 'paid', paid: true, alreadyProcessed: true, license: await licenseView(await ensureLicense(ownerIdNow)) };
  }

  // Recover the plan chosen at startCheckout (falls back to Pro for legacy orders).
  const plan = await findPlan(pending.planId);
  const months = Math.max(1, Number(pending.months) || plan.months || PLAN.months);
  const tier = pending.tier || plan.tier || 'pro';

  const ownerId = await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  const code = payments.generatePurchaseCode(months);
  const updated = await applyPaidMonths(lic, months, code, tier);
  // Mark the order processed BEFORE the (best-effort) invoice write so a re-poll
  // can't re-grant even if the receipt write fails.
  if (orderKey) await writeSetting('processedCheckouts', [...processedList, orderKey].slice(-500)).catch(() => {});
  await writeSetting('pendingCheckout', null).catch(() => {});
  await recordInvoice({ ownerId, provider: def.id, amount: plan.amount, currency: plan.currency, tier, months, reference: code, status: 'paid', source: 'auto', note: orderKey || null });
  await logAudit('billing.checkout', { detail: { provider: def.id, months, tier, order: orderKey || null } });
  try {
    const db = getPrisma();
    const owner = ownerId ? await db.member.findUnique({ where: { id: ownerId } }) : null;
    if (owner && owner.email) await deliverPurchaseCode(owner.email, owner.name, code);
  } catch (e) { /* email is best-effort */ }
  return { status: st.status, paid: true, license: await licenseView(updated), purchaseCode: code };
}

// ---- Manual payments (Wise / bank transfer / custom) ----
// The buyer pays out-of-band and submits a reference; a Super Admin approves it in-app, which grants
// the term. Nothing from the renderer is trusted automatically.
async function submitManualPayment(payload) {
  const input = requireObject(payload);
  const def = payments.getProviderDef(String(input.provider || 'manual').trim());
  if (!def || def.kind !== 'manual') throw new Error('That is not a manual payment method.');
  const store = await readPaymentStore();
  if (!store[def.id] || !store[def.id].enabled) throw new Error('That manual payment method is not enabled.');
  const plan = await findPlanOrThrow(input.planId);
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
  // Idempotency: an already-resolved payment must not be re-approved (which would
  // grant the term a second time) or flipped after the fact.
  if (entry.status && entry.status !== 'pending') throw new Error(`This payment was already ${entry.status}.`);
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
  await logAudit('billing.manual-resolve', { detail: { id, status: entry.status, owner: entry.ownerId ?? null, months: entry.months ?? null } });
  return { ok: true, status: entry.status };
}

// ---- Invoices ----
// Captured on checkout or manual approval, or entered by the Super Admin, who manages all of them.
// Owners see their own tree's invoices read-only.
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

// Auto-capture - best-effort; never blocks or fails a payment.
async function recordInvoice(data) {
  try {
    const status = data.status || 'paid';
    await getPrisma().invoice.create({
      data: {
        ownerMemberId: data.ownerId ?? null,
        memberId: data.memberId ?? null,
        amount: sanitizeAmount(data.amount),
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
  } catch (e) {
    // Must never fail a payment, but must not be silent either: the licence may have advanced with no
    // receipt, which a Super Admin needs to reconcile.
    console.error('[recordInvoice] receipt write FAILED - license may be advanced without an invoice:', e && e.message ? e.message : e);
  }
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
      amount: sanitizeAmount(input.amount),
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
  const db = getPrisma();
  const existing = await db.invoice.findUnique({ where: { id } });
  if (!existing) throw new Error('Invoice not found.');
  const data = {};
  if (input.ownerId !== undefined) data.ownerMemberId = (input.ownerId != null && input.ownerId !== '') ? parseId(input.ownerId) : null;
  if (input.amount !== undefined) data.amount = sanitizeAmount(input.amount);
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
  const updated = await db.invoice.update({ where: { id }, data });

  // A refund claws back the granted term: subtract the invoice's months from the owner's licence;
  // licenseView then re-evaluates the state and re-syncs the ban.
  if (data.status === 'refunded' && existing.status !== 'refunded' && existing.ownerMemberId != null && existing.months) {
    try {
      const lic = await db.license.findFirst({ where: { ownerMemberId: existing.ownerMemberId } });
      if (lic && lic.trialEndsAt) {
        const reduced = new Date(new Date(lic.trialEndsAt).getTime() - Number(existing.months) * PLAN.days * 86400000);
        const reducedLic = await db.license.update({ where: { id: lic.id }, data: { trialEndsAt: reduced } });
        await licenseView(reducedLic); // recomputes state + syncs owner ban
      }
      await logAudit('billing.refund', { detail: { invoice: id, months: existing.months, owner: existing.ownerMemberId } });
    } catch (e) { console.error('[updateInvoice] refund downgrade failed:', e && e.message ? e.message : e); }
  }
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
      text: `Hi ${name}, thanks for your payment. Your purchase code is: ${code}. It activates 1 month - enter it under Settings -> Subscription.`,
      html: `<div style="font-family:sans-serif;max-width:28rem;margin:0 auto;"><h2>Payment received</h2><p>Hi ${name}, thanks for your payment.</p><p>Your purchase code:</p><h1 style="background:#f4f4f5;padding:10px;text-align:center;letter-spacing:3px;">${code}</h1><p style="font-size:12px;color:#666;">Activates 1 month. Enter it under Settings &rarr; Subscription.</p></div>`
    });
    return true;
  } catch (e) { console.error('[Purchase code email]', e); return false; }
}

// ---- IP provider integrations (Super Admin only) ----
// Master credentials for resold proxy vendors; the renderer only ever gets a masked key preview.
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
    apiKeyMasked: maskSecret(p.apiKey ? secretStore.open(p.apiKey) : ''),
    hasSecretKey: Boolean(p.secretKey),
    secretKeyMasked: maskSecret(p.secretKey ? secretStore.open(p.secretKey) : ''),
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
  // The renderer only sees a mask, so a missing key keeps the stored value. Keys are sealed at rest;
  // open() in serializeIpProvider tolerates legacy plaintext.
  if (input.apiKey !== undefined && String(input.apiKey).trim() !== '') data.apiKey = secretStore.seal(String(input.apiKey).trim());
  if (input.secretKey !== undefined && String(input.secretKey).trim() !== '') data.secretKey = secretStore.seal(String(input.secretKey).trim());
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

// ---- No-code macro automation ----
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

// A member sees macros owned inside their visible subtree (recorded steps keep typed values,
// passwords included). Unowned macros (older ones and seeded starters) are visible to owners and
// admins only. Single-user mode and the Super Admin are unrestricted.
async function macroScope() {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return null;
  const all = await getPrisma().member.findMany();
  return { member, visible: permissions.visibleMemberIds(all, member) };
}

function macroVisible(scope, row) {
  if (!scope || !row) return Boolean(row);
  if (row.ownerMemberId != null) return scope.visible.has(row.ownerMemberId);
  return permissions.rankOf(scope.member.role) >= permissions.ROLE_RANK.ADMIN;
}

async function loadAccessibleMacro(id) {
  const row = await getPrisma().macro.findUnique({ where: { id } });
  if (!row) throw new Error('Macro not found.');
  if (!macroVisible(await macroScope(), row)) {
    const e = new Error('You do not have access to this macro.'); e.code = 'FORBIDDEN'; throw e;
  }
  return row;
}

async function getMacros() {
  await requirePermission('automation.run');
  const db = getPrisma();
  const scope = await macroScope();
  const rows = await db.macro.findMany({ orderBy: { updatedAt: 'desc' } });
  return rows.filter((r) => macroVisible(scope, r)).map(serializeMacro);
}

async function saveMacro(payload) {
  await requirePermission('automation.run');
  const input = requireObject(payload);
  const db = getPrisma();
  const name = requiredString(input.name, 'Macro name');
  const description = optionalString(input.description);
  let steps = input.steps !== undefined ? input.steps : [];
  if (typeof steps === 'string') {
    // Surface a malformed steps blob instead of saving a macro with no steps.
    try { steps = JSON.parse(steps); } catch (e) { throw new Error('Macro steps are not valid JSON.'); }
  }
  // Validate against the engine's schema; the "Step N (type): ..." error shows inline in the editor,
  // so a bad step fails here, not mid-run across a parallel batch.
  const stepsJson = JSON.stringify(normalizeMacroSteps(Array.isArray(steps) ? steps : []));
  if (input.id) {
    const id = parseId(input.id);
    await loadAccessibleMacro(id);
    const updated = await db.macro.update({ where: { id }, data: { name, description, stepsJson } });
    return serializeMacro(updated);
  }
  const created = await db.macro.create({ data: { name, description, stepsJson, ownerMemberId: ownerStampId() } });
  return serializeMacro(created);
}

async function deleteMacro(payload) {
  await requirePermission('automation.run');
  const id = parseId(requireObject(payload).id);
  await loadAccessibleMacro(id);
  await getPrisma().macro.delete({ where: { id } });
  await logAudit('macro.deleted', { detail: { macroId: id } });
  return { deleted: true };
}

// ---- Cookie warmer ----
// Launches a profile and visits a rotation of popular sites for the requested time so real cookies
// and history build up. Runs in the background and streams per-profile progress.
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

// Serialize history writes through one chain: the store is a single JSON blob in one Setting, so two
// runs finishing together would lose updates with a naive read-modify-write.
let _historyWriteChain = Promise.resolve();
function appendWarmerHistory(entry) {
  _historyWriteChain = _historyWriteChain.then(() => _appendWarmerHistoryUnsafe(entry)).catch(() => {});
  return _historyWriteChain;
}

async function _appendWarmerHistoryUnsafe(entry) {
  const list = (await readSetting('automationHistory', [])) || [];
  const arr = Array.isArray(list) ? list : [];
  // Upsert by runId: a run records on start ('running') and on finish ('completed'/'stopped');
  // merge both into one row, moved to the top, so the history table gets no duplicate keys.
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

// A run that quits or crashes mid-way never writes its finish status, so its row stays 'running'.
// Nothing can be in flight at process start, so settle leftovers here (best-effort).
async function reconcileInterruptedAutomationRuns() {
  const list = (await readSetting('automationHistory', [])) || [];
  const arr = Array.isArray(list) ? list : [];
  let changed = false;
  const next = arr.map((e) => {
    if (e && e.status === 'running') { changed = true; return { ...e, status: 'interrupted' }; }
    return e;
  });
  if (changed) await writeSetting('automationHistory', next);
}

async function getAutomationHistory() {
  const list = (await readSetting('automationHistory', [])) || [];
  return Array.isArray(list) ? list : [];
}

// Wrapper that runs the full launch pipeline (Firefox routing, proxy rotation,
// global settings) for a given profile id. Shared by the local REST API and the
// warmer so neither duplicates launch logic.
async function launchProfileById(id, startUrl, opts = {}) {
  return launchProfile({ id: parseId(id), startUrl: startUrl || 'about:blank', headless: Boolean(opts.headless) });
}

// ---- Macro runner, visual recorder and scheduler ----
// Execution and capture live in browserEngine (runMacro, start/stopMacroRecording) because they need
// the live session page; these handlers add sessions, persistence and scheduling.

// `launched` is true only when this call opened the browser, so the caller owns closing it.
async function ensureProfileSession(profileId) {
  // Check profile access here, before returning or launching a session: the open-session shortcut
  // (and sessions surviving switchMember) would otherwise let a lower member drive another member's
  // signed-in session. Every automation handler routes through this.
  await assertCanAccessProfile(parseId(profileId));
  const pid = String(profileId);
  const open = listActiveSessions().find((s) => String(s.sessionId) === pid);
  if (open) return { sessionId: String(open.sessionId), launched: false };
  const res = await launchProfileById(profileId, 'about:blank');
  return { sessionId: res && res.sessionId ? String(res.sessionId) : pid, launched: true };
}

// Active macro runs, keyed by runId, so a run can be paused / resumed / stopped.
const macroRuns = new Map();

// Typed text (often a recorded password) never leaves main in a progress frame. The run window only
// needs the step's position and kind; the owner can read full steps in the macro editor.
function redactStepForProgress(step) {
  if (!step || typeof step !== 'object') return step;
  const out = { ...step };
  if (out.type === 'type' && out.value != null && out.value !== '') out.value = '••••••';
  return out;
}
function redactProgressEvent(ev) {
  if (!ev || typeof ev !== 'object' || !ev.step) return ev;
  return { ...ev, step: redactStepForProgress(ev.step) };
}

// Who may pause/stop/close a run: the member who started it, anyone above them in the
// team tree, the Super Admin, or anyone in single-user mode. Not a sibling.
async function assertCanControlRun(ownerMemberId) {
  const me = await getActiveMember();
  if (!me || me.role === 'SUPER_ADMIN' || ownerMemberId == null) return;
  if (Number(me.id) === Number(ownerMemberId)) return;
  const all = await getPrisma().member.findMany();
  if (permissions.visibleMemberIds(all, me).has(Number(ownerMemberId))) return;
  const e = new Error('This run was started by another member.'); e.code = 'FORBIDDEN'; throw e;
}

async function runMacroOnProfile(payload, event) {
  await requirePermission('automation.run');
  const input = requireObject(payload);
  const macroId = parseId(input.macroId);
  const profileId = parseId(input.profileId);
  const db = getPrisma();
  // Same ownership rule as the editor, so a member cannot run (and stream the typed values of)
  // another member's macro by id.
  const macro = await loadAccessibleMacro(macroId);
  let steps = [];
  try { steps = JSON.parse(macro.stepsJson || '[]'); } catch (e) { steps = []; }
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('This macro has no steps to run yet.');

  const { sessionId, launched } = await ensureProfileSession(profileId);
  const runId = `macro-${Date.now()}`;
  const control = { paused: false, aborted: false, profileId, ownerMemberId: currentMemberId };
  macroRuns.set(runId, control);

  // Live progress stream (mirrors the warmer-progress pattern). The scheduler runs
  // without an event, so streaming is a no-op there.
  const sender = event && event.sender ? event.sender : null;
  const send = (data) => { if (sender) { try { sender.send(CHANNELS.AUTOMATION_MACRO_PROGRESS, data); } catch (e) { /* renderer gone */ } } };
  send({ runId, kind: 'start', macroId, profileId, name: macro.name, total: steps.length, ts: Date.now() });
  const onStep = (ev) => send({ runId, kind: 'step', ...redactProgressEvent(ev), ts: Date.now() });

  let result;
  try {
    result = await runMacro(sessionId, steps, { continueOnError: Boolean(input.continueOnError), control, onStep });
  } finally {
    macroRuns.delete(runId);
    // Close the browser only when this run opened it and the user stopped the macro. A finished run
    // leaves it open so the result stays visible, and an already-open browser is never touched.
    // This also avoids a relaunch racing a just-closed profile.
    if (launched && result && result.aborted) await closeProfileSession(sessionId).catch(() => {});
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
  await requirePermission('automation.run');
  const input = requireObject(payload);
  const runId = String(input.runId || '');
  const action = String(input.action || '').toLowerCase();
  const control = macroRuns.get(runId);
  if (!control) return { ok: false, reason: 'not-running' };
  await assertCanControlRun(control.ownerMemberId);
  if (action === 'pause') control.paused = true;
  else if (action === 'resume') control.paused = false;
  else if (action === 'stop') { control.aborted = true; control.paused = false; }
  else throw new Error('Action must be pause, resume or stop.');
  return { ok: true, action };
}

async function startMacroRecordingOnProfile(payload) {
  await requirePermission('automation.run');
  const input = requireObject(payload);
  const profileId = parseId(input.profileId);
  const { sessionId } = await ensureProfileSession(profileId);
  const res = await startMacroRecording(sessionId);
  return { ...res, sessionId, profileId };
}

async function stopMacroRecordingOnProfile(payload) {
  // The session is always the profile's own and the caller needs access to that profile, since
  // stopping returns the captured steps, typed passwords included.
  await requirePermission('automation.run');
  const input = requireObject(payload);
  const profileId = parseId(input.profileId);
  await assertCanAccessProfile(profileId);
  const sessionId = String(profileId);
  if (input.sessionId != null && input.sessionId !== '' && String(input.sessionId) !== sessionId) {
    const e = new Error('That recording belongs to a different profile.'); e.code = 'FORBIDDEN'; throw e;
  }
  const res = await stopMacroRecording(sessionId);
  const captured = Array.isArray(res.steps) ? res.steps : [];
  // Canonicalise leniently: a recording cannot be re-taken, so drop and count bad steps rather than
  // throwing the whole session away.
  const steps = [];
  let dropped = 0;
  for (const raw of captured) {
    try { steps.push(normalizeMacroSteps([raw])[0]); }
    catch (e) { dropped += 1; }
  }
  // Optionally persist the captured steps straight into a new macro.
  const name = optionalString(input.saveAs);
  let saved = null;
  if (name) {
    const created = await getPrisma().macro.create({
      data: { name, description: optionalString(input.description) || 'Recorded macro', stepsJson: JSON.stringify(steps), ownerMemberId: ownerStampId() }
    });
    saved = serializeMacro(created);
  }
  return { steps, count: steps.length, dropped, saved };
}

// ---- Macro scheduler ----
let macroSchedulerTimer = null;

// The timer fires as whoever is signed in, often nobody, which passes every access check. So each
// run is checked against the member who set the schedule: still active, still sees the macro and
// each profile. Returns the allowed profileIds, or [] with a reason.
async function scheduleAllowedProfiles(cfg) {
  if (cfg.ownerMemberId == null) return { allowed: cfg.profileIds, reason: null }; // single-user, or a schedule saved without an owner
  const db = getPrisma();
  const all = await db.member.findMany();
  const owner = all.find((m) => Number(m.id) === Number(cfg.ownerMemberId))
    || (Number(cfg.ownerMemberId) === permissions.SUPER_ADMIN_ID ? { ...permissions.SUPER_ADMIN } : null);
  if (!owner) return { allowed: [], reason: 'the member who set this schedule no longer exists' };
  if (owner.status === 'banned' || owner.status === 'suspended') return { allowed: [], reason: 'the member who set this schedule is not active' };
  if (owner.role === 'SUPER_ADMIN') return { allowed: cfg.profileIds, reason: null };
  const visible = permissions.visibleMemberIds(all, owner);
  const macro = await db.macro.findUnique({ where: { id: cfg.macroId } });
  if (!macro || !macroVisible({ member: owner, visible }, macro)) return { allowed: [], reason: 'that member can no longer use this macro' };
  const rows = await db.profile.findMany({ where: { id: { in: cfg.profileIds } }, select: PROFILE_ACCESS_SELECT });
  const ok = new Set(rows.filter((r) => permissions.profileRowAccessible(visible, r, false)).map((r) => r.id));
  return { allowed: cfg.profileIds.filter((id) => ok.has(id)), reason: null };
}

// One scheduled pass at a time, so a pass longer than the interval cannot overlap the next tick.
let macroScheduleBusy = false;

async function runDueMacroSchedule() {
  const cfg = await readSetting('macroSchedule', null);
  if (!cfg || !cfg.enabled || !cfg.macroId || !Array.isArray(cfg.profileIds) || cfg.profileIds.length === 0) return;
  if (macroScheduleBusy) return;
  macroScheduleBusy = true;
  try {
    const { allowed, reason } = await scheduleAllowedProfiles(cfg);
    if (reason || allowed.length < cfg.profileIds.length) {
      await appendWarmerHistory({
        type: 'macro', at: new Date().toISOString(), level: 'WARN',
        detail: reason ? `Scheduled macro skipped: ${reason}.` : `Scheduled macro skipped ${cfg.profileIds.length - allowed.length} profile(s) the member who set it can no longer access.`
      }).catch(() => {});
    }
    for (const pid of allowed) {
      try {
        await runMacroOnProfile({ macroId: cfg.macroId, profileId: pid, continueOnError: true });
      } catch (e) {
        await appendWarmerHistory({
          type: 'macro', profileId: pid, at: new Date().toISOString(),
          level: 'ERROR', detail: `Scheduled macro failed: ${(e && e.message) || 'error'}`
        }).catch(() => {});
      }
    }
  } finally {
    macroScheduleBusy = false;
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
  // Gated like a manual run; only the member who set the schedule or someone above them may replace
  // it. The setter is stored so every scheduled run is re-checked (see scheduleAllowedProfiles).
  await requirePermission('automation.run');
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
  const existing = await readSetting('macroSchedule', null);
  if (existing && existing.ownerMemberId != null) await assertCanControlRun(existing.ownerMemberId);
  if (macroId) await loadAccessibleMacro(macroId);
  for (const pid of profileIds) await assertCanAccessProfile(pid);
  const cfg = { enabled, macroId, everyMinutes, profileIds, ownerMemberId: currentMemberId };
  await writeSetting('macroSchedule', cfg);
  if (enabled) startMacroScheduler(everyMinutes); else stopMacroScheduler();
  return { ...cfg, running: Boolean(macroSchedulerTimer) };
}

// ---- Parallel macro runner + live (redacted) run console ----
// Orchestration and redaction live in the pure parallelRunner module; this injects the real launch,
// run and close primitives. Each profile can bind one spreadsheet row via {{Header}} placeholders.

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
  // Keep the cache small by dropping the oldest entry.
  if (dataRowsCache.size > 20) {
    let oldestKey = null; let oldestAt = Infinity;
    for (const [k, v] of dataRowsCache) { if (v.createdAt < oldestAt) { oldestAt = v.createdAt; oldestKey = k; } }
    if (oldestKey) dataRowsCache.delete(oldestKey);
  }

  // Return only structure (headers + count) to the renderer - never the cell
  // values, so a bound sheet of credentials isn't surfaced unnecessarily.
  return { cancelled: false, token, fileName: parsed.fileName, headers: parsed.headers, rowCount: parsed.rows.length };
}

async function runParallelMacroHandler(payload, event) {
  await requirePermission('automation.run');
  const input = requireObject(payload);
  const macroId = parseId(input.macroId);
  const profileIds = parseIdArray(input.profileIds);
  if (profileIds.length === 0) throw new Error('Select at least one profile for the parallel run.');
  // Check access to every target profile: the parallel path reuses open sessions and would otherwise
  // skip the launch-time access check.
  for (const pid of profileIds) await assertCanAccessProfile(pid);
  const concurrency = Math.max(1, Math.min(10, Number.parseInt(input.concurrency, 10) || 3));
  const continueOnError = input.continueOnError !== false;
  const closeWhenDone = input.closeWhenDone !== false;

  const db = getPrisma();
  // Same macro-ownership rule as a single run.
  const macro = await loadAccessibleMacro(macroId);
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

  // One parallel run per profile at a time: the handler returns at once, so a second click could
  // start an overlapping run on the same browsers.
  const busy = profileIds.filter((pid) => profilesInParallelRun().has(pid));
  if (busy.length) {
    const e = new Error(`${busy.length} of the selected profile(s) are still running a parallel macro. Wait for it to finish or stop it first.`);
    e.code = 'RUN_IN_PROGRESS'; throw e;
  }

  const runId = `par-${Date.now()}`;
  parallelRuns.set(runId, { runId, ownerMemberId: currentMemberId, profileIds, startedAt: Date.now(), done: false, summary: null });

  // Bridge this run's sanitized relay frames to the renderer: one listener filtered by runId that
  // removes itself on the run-level 'done' frame (finally is the backstop). relay.emitFrame already
  // sanitizes every payload.
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

  // Fire-and-forget - the handler returns immediately; progress arrives via the
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
      finishParallelRun(runId, summary || { total: items.length, passed: 0, failed: items.length });
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

// Parallel runs by runId: running ones, plus finished ones kept for 10 minutes so a
// panel that missed the single 'done' frame can still learn the result.
const parallelRuns = new Map();
const PARALLEL_DONE_KEEP_MS = 10 * 60 * 1000;

function profilesInParallelRun() {
  const ids = new Set();
  for (const r of parallelRuns.values()) if (!r.done) r.profileIds.forEach((id) => ids.add(id));
  return ids;
}

function finishParallelRun(runId, summary) {
  const r = parallelRuns.get(runId);
  if (!r) return;
  r.done = true;
  r.summary = { total: summary.total, passed: summary.passed, failed: summary.failed };
  r.finishedAt = Date.now();
  // Drop old finished entries so the map cannot grow without bound.
  for (const [id, x] of parallelRuns) if (x.done && Date.now() - x.finishedAt > PARALLEL_DONE_KEEP_MS) parallelRuns.delete(id);
}

// Is this parallel run still going? The panel polls this while it shows "Running", so
// it clears only when the run has really ended, even if the 'done' frame was lost.
async function getParallelRunStatus(payload) {
  await requirePermission('automation.run');
  const input = requireObject(payload);
  const r = parallelRuns.get(String(input.runId || ''));
  if (!r) return { known: false, running: false };
  await assertCanControlRun(r.ownerMemberId);
  return { known: true, running: !r.done, summary: r.summary, startedAt: r.startedAt, finishedAt: r.finishedAt || null };
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

// Sleep that returns early (true) when shouldAbort() flips - lets a long dwell be
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
  if (alreadyOpen && opts.skipOpen) {
    // The autopilot never drives a browser someone opened after it picked the profile.
    emit(profileId, 'WARN', 'Skipped: the profile is open.');
    return { sessionId, cookieCount: null, loaded: 0, skipped: true };
  }
  if (alreadyOpen) {
    emit(profileId, 'INFO', 'Using the already-open session.');
  } else {
    emit(profileId, 'INFO', opts.headless ? 'Launching profile hidden (no window) for warm-up…' : 'Launching profile for warm-up…');
    const res = await launchProfileById(profileId, 'about:blank', { headless: opts.headless });
    sessionId = res && res.sessionId ? String(res.sessionId) : sessionId;
    if (run) run.launched.add(sessionId);
    emit(profileId, 'SUCCESS', `Session ${sessionId} started${opts.headless ? ' (hidden)' : ''}.`);
  }
  if (run) run.sessions.add(sessionId);

  const aborted = () => Boolean(run && run.aborted);
  const rounds = opts.loop ? 1000 : 1; // "loop" repeats until stopped (safety cap)
  let loaded = 0;
  outer:
  for (let r = 0; r < rounds; r++) {
    for (const site of sites) {
      if (aborted()) break outer;
      const tag = site.clickMode === 'random' ? ' · random clicks' : site.clickMode === 'links' ? ' · browse links' : '';
      emit(profileId, 'INFO', `Visiting ${site.label} (${site.seconds}s${tag})…`);
      const ok = await navigateSession(sessionId, site.url, { timeout: 30000 });
      if (!ok) { emit(profileId, 'WARN', `Could not load ${site.label} (skipped)`); continue; }
      loaded += 1;
      emit(profileId, 'SUCCESS', `Loaded ${site.label}`);
      try {
        const inter = await warmInteract(sessionId, { clickMode: site.clickMode, clicks: site.clicks, scroll: site.scroll });
        if (inter && inter.clicked) emit(profileId, 'INFO', `Interacted - ${inter.clicked} click(s) on ${site.label}`);
      } catch (e) { /* best-effort */ }
      if (await interruptibleSleep(site.seconds * 1000, aborted)) break outer;
    }
    if (opts.loop && !aborted()) emit(profileId, 'INFO', 'Looping the site list again…');
  }

  // Read the live cookie jar before closing; it needs the open session.
  let cookieCount = null;
  try { const cookies = await exportSessionCookies(sessionId); cookieCount = Array.isArray(cookies) ? cookies.length : null; }
  catch (e) { /* ignore */ }

  // Close only sessions this run launched, unless keepOpen. A graceful browser.close() flushes cookies
  // and cache to the userDataDir, so a later normal launch reuses the warmed session.
  const didClose = !opts.keepOpen && run && run.launched.has(sessionId);
  if (didClose) await closeAnySession(sessionId).catch(() => {}); // engine-aware (Firefox too)

  // The on-disk footprint is only meaningful once a close has flushed it, so skip it for keep-open runs.
  let diskNote = '';
  if (didClose) {
    try {
      const prof = await getPrisma().profile.findUnique({ where: { id: parseId(profileId) }, select: { dataDirName: true } });
      if (prof && prof.dataDirName) {
        const size = await directorySize(resolveProfileDataDir(prof.dataDirName));
        if (size && size.bytes) diskNote = ` · ${(size.bytes / 1048576).toFixed(1)} MB cache+cookies on disk`;
      }
    } catch (e) { /* ignore */ }
  }

  const cookieNote = cookieCount != null ? ` · ${cookieCount} cookies saved` : '';
  emit(profileId, aborted() ? 'WARN' : 'SUCCESS', `${aborted() ? 'Warm-up stopped' : 'Warm-up complete'}${cookieNote}${diskNote}.`);
  return { sessionId, cookieCount, loaded };
}

async function startWarmer(payload, event) {
  // Gated like the other automation handlers, with a per-profile check so a member cannot drive
  // another member's open signed-in session.
  await requirePermission('automation.run');
  const input = requireObject(payload);
  const ids = parseIdArray(input.profileIds);
  if (!ids.length) throw new Error('Select at least one profile to warm up.');
  for (const pid of ids) await assertCanAccessProfile(pid);
  let sites = normalizeWarmSites(input.sites);
  if (!sites.length) sites = defaultWarmSites();
  const opts = { loop: Boolean(input.loop), keepOpen: Boolean(input.keepOpen), headless: Boolean(input.headless) };
  // Default concurrency 1 is a strict queue: each profile finishes its sites and closes before the next
  // launches. Launching every selected browser at once runs out of memory on large selections.
  const concurrency = Math.max(1, Math.min(16, Number.parseInt(input.concurrency, 10) || 1));
  const run = await beginWarmerRun({
    ids, sites, opts, concurrency,
    push: (frame) => { try { event.sender.send(CHANNELS.AUTOMATION_WARMER_PROGRESS, frame); } catch (e) { /* renderer gone */ } },
    ownerMemberId: currentMemberId // who may stop / force-close it (see stopWarmer)
  });
  return { started: true, runId: run.id, profileIds: ids, sites: sites.length, loop: opts.loop, concurrency };
}

// Registers a warm-up run and starts its worker pool in the background. `push` streams each frame
// to the renderer that started the run; the autopilot has no renderer and passes none. Autopilot runs
// stay out of the Task History, which keeps only 50 rows. `run.finished` settles when the run ends.
async function beginWarmerRun({ ids, sites, opts, concurrency, push = null, autopilot = false, ownerMemberId = null }) {
  const runId = autopilot ? `autowarm-${ids[0]}-${Date.now()}` : `warm-${Date.now()}`;
  const run = {
    id: runId, aborted: false, launched: new Set(), sessions: new Set(), send: null,
    // Metadata and a rolling log let a renderer that navigated away re-attach to (and stop) the run.
    // `active` holds profiles warming right now; total/done drive the live progress counter.
    profileIds: ids, total: ids.length, done: 0, active: new Set(), concurrency,
    loop: opts.loop, headless: opts.headless, sitesCount: sites.length, startedAt: Date.now(), logs: [],
    autopilot, results: new Map(), finished: null, ownerMemberId
  };
  warmerRuns.set(runId, run);

  // Each frame carries a `counts` snapshot (total/done/active/remaining) for the live counter and
  // re-attach, in its own key so it never overwrites the terminal `done: true`.
  const send = (data) => {
    const enriched = {
      ...data,
      counts: {
        total: run.total, done: run.done, active: run.active.size,
        remaining: Math.max(0, run.total - run.done - run.active.size),
        concurrency: run.concurrency
      }
    };
    try { run.logs.push(enriched); if (run.logs.length > 300) run.logs.splice(0, run.logs.length - 300); } catch (e) {}
    if (push) push(enriched);
  };
  run.send = send;
  const emit = (profileId, level, message) => send({ runId, profileId, level, message, ts: Date.now() });

  send({ runId, level: 'INFO', message: `Starting warm-up · ${ids.length} profile(s) · ${sites.length} site(s) · ${concurrency === 1 ? 'one-by-one (queue)' : concurrency + ' at a time'}${opts.headless ? ' · hidden (no windows)' : ''}${opts.loop ? ' · looping until stopped' : ''}.`, ts: Date.now() });
  if (!autopilot) await appendWarmerHistory({ type: 'warmer', runId, profileIds: ids, sites: sites.length, status: 'running', startedAt: Date.now() }).catch(() => {});

  // Fire-and-forget worker pool with a shared cursor caps how many profiles warm at once; at width 1
  // a worker takes the next id only after its previous profile has finished and closed.
  run.finished = (async () => {
    let cursor = 0;
    const worker = async () => {
      while (!run.aborted) {
        const i = cursor; cursor += 1;
        if (i >= ids.length) break;
        run.active.add(String(ids[i])); // now warming - reflected in the live counter
        try {
          const res = await warmOneProfile(ids[i], sites, opts, emit, run);
          run.results.set(ids[i], res);
          // A warm-up counts once a site has loaded; the autopilot and the CAPTCHA score read the count.
          if (res && res.loaded > 0) await recordWarmRun(ids[i]);
        } catch (e) {
          const message = e && e.message ? e.message : 'Warm-up failed.';
          run.results.set(ids[i], { loaded: 0, error: message });
          emit(ids[i], 'ERROR', message);
        }
        finally { run.active.delete(String(ids[i])); run.done += 1; }
      }
    };
    const width = Math.min(concurrency, ids.length);
    await Promise.all(Array.from({ length: width }, () => worker()));
    const stopped = run.aborted;
    send({ runId, level: stopped ? 'WARN' : 'SUCCESS', message: stopped ? 'Warm-up stopped.' : 'All warm-up tasks finished.', done: true, ts: Date.now() });
    if (!autopilot) await appendWarmerHistory({ type: 'warmer', runId, profileIds: ids, sites: sites.length, status: stopped ? 'stopped' : 'completed', finishedAt: Date.now() }).catch(() => {});
    warmerRuns.delete(runId);
    return { stopped };
  })();

  return run;
}

// Serialised like the history writes: warm-ups finishing together would otherwise lose a count.
let _warmStatsChain = Promise.resolve();
function recordWarmRun(profileId) {
  _warmStatsChain = _warmStatsChain.then(async () => {
    const stats = (await readSetting('warmStats', {})) || {};
    await writeSetting('warmStats', warmAutopilot.withWarmRun(stats, profileId, Date.now()));
  }).catch(() => {});
  return _warmStatsChain;
}

// Lets a renderer returning to the Automation page re-attach to a job still running in main, with
// its recent logs, instead of leaving the launched browsers orphaned and unstoppable. Autopilot runs
// are left out: they stream to no renderer, so the panel would wait on them forever.
function listActiveWarmers() {
  return [...warmerRuns.values()].filter((r) => !r.autopilot).map((r) => ({
    runId: r.id, total: r.total, done: r.done, active: r.active ? r.active.size : 0,
    remaining: Math.max(0, r.total - r.done - (r.active ? r.active.size : 0)),
    concurrency: r.concurrency,
    loop: r.loop, headless: r.headless, sites: r.sitesCount, startedAt: r.startedAt,
    aborted: r.aborted, logs: Array.isArray(r.logs) ? r.logs.slice(-300) : []
  }));
}

// Stop a running warm-up. `force` also closes the sessions this run launched.
// With no runId, stops every active run except the autopilot's (turning the autopilot off stops those).
async function stopWarmer(payload) {
  // Gated like startWarmer and limited to runs the caller may control, since force-stop closes the
  // run's browsers.
  await requirePermission('automation.run');
  const input = (payload && typeof payload === 'object') ? payload : {};
  const force = Boolean(input.force);
  const runId = input.runId ? String(input.runId) : null;
  const candidates = runId ? (warmerRuns.has(runId) ? [warmerRuns.get(runId)] : []) : [...warmerRuns.values()].filter((r) => !r.autopilot);
  const targets = [];
  for (const run of candidates) {
    try { await assertCanControlRun(run.ownerMemberId); targets.push(run); }
    catch (e) { if (runId) throw e; /* "stop all" just skips other members' runs */ }
  }
  if (!targets.length) return { stopped: false };
  for (const run of targets) {
    run.aborted = true;
    if (run.send) { try { run.send({ runId: run.id, level: 'WARN', message: force ? 'Force-stopping - closing sessions…' : 'Stopping after the current step…', ts: Date.now() }); } catch (e) { /* renderer gone */ } }
    if (force) {
      for (const sid of run.launched) await closeAnySession(sid).catch(() => {}); // engine-aware (Firefox too)
    }
  }
  return { stopped: true, force, runs: targets.length };
}

// ---- Warm-up autopilot ----
// Warms each covered profile with a few random sites, a few times a day inside the active hours,
// through the Cookie Warmer runner, so history and cookies build up over days. Who is due and when
// lives in warmAutopilot.js. The timer always ticks and reads the setting each time, so turning the
// autopilot on needs no restart and works when the database is unlocked after start-up.
const WARM_AUTOPILOT_TICK_MS = 60 * 1000;
let warmAutopilotTimer = null;
// One tick at a time, so a slow tick cannot overlap the next.
let warmAutopilotBusy = false;
const warmAutopilotRetryAt = new Map(); // profileId -> when a failed profile may be tried again
let warmAutopilotLastError = null; // { code, message, profileId, title, at }

function autopilotWarmerRuns() {
  return [...warmerRuns.values()].filter((r) => r.autopilot);
}

// Profiles something else is using: open or launching browsers, launch locks, warm-up, macro and
// parallel runs, and a scheduled macro pass in progress. The autopilot leaves them alone.
async function profilesBusyForWarmup() {
  const busy = new Set();
  const add = (id) => { const n = Number(id); if (Number.isInteger(n)) busy.add(n); };
  for (const s of listAllSessions()) add(s.sessionId);
  for (const id of profileLocks.keys()) add(id);
  for (const id of profileLaunchesInFlight.keys()) add(id);
  for (const r of warmerRuns.values()) r.profileIds.forEach(add);
  for (const c of macroRuns.values()) add(c.profileId);
  for (const id of profilesInParallelRun()) add(id);
  if (macroScheduleBusy) {
    const m = await readSetting('macroSchedule', null);
    if (m && Array.isArray(m.profileIds)) m.profileIds.forEach(add);
  }
  return busy;
}

// The timer runs as whoever is signed in (often nobody, which passes every access check), so like
// the macro schedule the autopilot only covers profiles the member who turned it on may still use.
// Returns the covered rows, or none with a problem code.
async function warmAutopilotProfiles(cfg) {
  const db = getPrisma();
  const where = cfg.target === 'group' ? { deletedAt: null, groupId: cfg.groupId } : { deletedAt: null };
  const rows = await db.profile.findMany({ where, select: { ...PROFILE_ACCESS_SELECT, title: true, groupId: true, deletedAt: true } });
  if (cfg.ownerMemberId == null) return { rows, problem: null }; // single-user mode
  const all = await db.member.findMany();
  const owner = all.find((m) => Number(m.id) === Number(cfg.ownerMemberId))
    || (Number(cfg.ownerMemberId) === permissions.SUPER_ADMIN_ID ? { ...permissions.SUPER_ADMIN } : null);
  if (!owner) return { rows: [], problem: 'owner-missing' };
  if (owner.status === 'banned' || owner.status === 'suspended') return { rows: [], problem: 'owner-inactive' };
  if (owner.role === 'SUPER_ADMIN') return { rows, problem: null };
  if (permissions.effectivePermissions(owner).actions['automation.run'] === false) return { rows: [], problem: 'owner-no-permission' };
  const visible = permissions.visibleMemberIds(all, owner);
  return { rows: rows.filter((r) => permissions.profileRowAccessible(visible, r, false)), problem: null };
}

async function runWarmAutopilotTick() {
  if (warmAutopilotBusy) return;
  warmAutopilotBusy = true;
  try {
    if (!database.isDbUnlocked()) return;
    const cfg = warmAutopilot.normalizeConfig(await readSetting('warmAutopilot', null));
    const now = Date.now();
    if (!cfg.enabled || !warmAutopilot.inWindow(new Date(now).getHours(), cfg)) return;
    const slots = cfg.maxConcurrent - autopilotWarmerRuns().length;
    if (slots <= 0) return;
    for (const [id, at] of warmAutopilotRetryAt) if (at <= now) warmAutopilotRetryAt.delete(id);
    const { rows, problem } = await warmAutopilotProfiles(cfg);
    if (problem) {
      warmAutopilotLastError = { code: problem, message: null, profileId: null, title: null, at: now };
      return;
    }
    const stats = (await readSetting('warmStats', {})) || {};
    const busy = await profilesBusyForWarmup();
    const due = warmAutopilot.pickDue(rows, { cfg, stats, now, busy, retryAt: warmAutopilotRetryAt, slots });
    const titles = new Map(rows.map((r) => [r.id, r.title]));
    for (const pid of due) await startAutopilotWarm(pid, titles.get(pid), cfg);
  } catch (e) {
    warmAutopilotLastError = { code: 'tick-failed', message: (e && e.message) || 'Unknown error', profileId: null, title: null, at: Date.now() };
  } finally {
    warmAutopilotBusy = false;
  }
}

async function startAutopilotWarm(profileId, title, cfg) {
  const sites = warmAutopilot.pickSites(defaultWarmSites(), cfg.sitesPerRun);
  const run = await beginWarmerRun({
    ids: [profileId], sites, concurrency: 1, autopilot: true, ownerMemberId: cfg.ownerMemberId,
    // skipOpen: a browser someone opened after this tick picked the profile is left alone.
    opts: { loop: false, keepOpen: false, headless: cfg.headless, skipOpen: true }
  });
  run.finished.then(async () => {
    const res = run.results.get(profileId) || { loaded: 0 };
    if (res.loaded > 0) {
      warmAutopilotRetryAt.delete(profileId);
      const cookies = res.cookieCount != null ? ` · ${res.cookieCount} cookies` : '';
      await logActivity(getPrisma(), profileId, 'warm-up', `autopilot · ${res.loaded}/${sites.length} sites${cookies}`);
    } else if (!res.skipped && !run.aborted) {
      warmAutopilotRetryAt.set(profileId, Date.now() + warmAutopilot.RETRY_MS);
      warmAutopilotLastError = { code: 'warm-failed', message: res.error || 'No site loaded.', profileId, title: title || null, at: Date.now() };
    }
  }).catch(() => {});
}

function startWarmAutopilotTimer() {
  stopWarmAutopilotTimer();
  warmAutopilotTimer = setInterval(() => { runWarmAutopilotTick().catch(() => {}); }, WARM_AUTOPILOT_TICK_MS);
  if (warmAutopilotTimer.unref) warmAutopilotTimer.unref();
}

function stopWarmAutopilotTimer() {
  if (warmAutopilotTimer) { clearInterval(warmAutopilotTimer); warmAutopilotTimer = null; }
}

// Settings plus a status line. Counts and the last error cover only profiles this viewer may see.
async function warmAutopilotView(cfg) {
  const now = Date.now();
  const { rows, problem } = await warmAutopilotProfiles(cfg);
  const check = await profileAccessChecker();
  const seen = new Set((check ? rows.filter(check) : rows).map((r) => r.id));
  const stats = (await readSetting('warmStats', {})) || {};
  let canEdit = true;
  try { await assertCanChangeWarmAutopilot(cfg.ownerMemberId); } catch (e) { canEdit = false; }
  let lastError = problem ? { code: problem, at: now } : warmAutopilotLastError;
  if (lastError && lastError.profileId != null && !seen.has(lastError.profileId)) lastError = { code: lastError.code, at: lastError.at };
  const { ownerMemberId, ...settings } = cfg;
  return {
    ...settings,
    canEdit,
    status: {
      inWindow: warmAutopilot.inWindow(new Date(now).getHours(), cfg),
      covered: seen.size,
      warmedToday: warmAutopilot.warmedToday(stats, [...seen], now),
      warmingNow: autopilotWarmerRuns().length,
      nextRunAt: problem ? null : warmAutopilot.nextRunAt(rows, { cfg, stats, now, retryAt: warmAutopilotRetryAt }),
      lastError
    }
  };
}

// Only the member who turned the autopilot on, or someone above them, may change it. When that
// member has been deleted nobody is above them, so the workspace Owner takes it over.
async function assertCanChangeWarmAutopilot(ownerMemberId) {
  if (ownerMemberId == null) return;
  const gone = !permissions.isSuperAdminId(ownerMemberId)
    && !(await getPrisma().member.findUnique({ where: { id: Number(ownerMemberId) }, select: { id: true } }));
  if (gone) await requireOwnerOrSuper('take over the warm-up autopilot');
  else await assertCanControlRun(ownerMemberId);
}

async function getWarmAutopilot() {
  await requirePermission('automation.run');
  return warmAutopilotView(warmAutopilot.normalizeConfig(await readSetting('warmAutopilot', null)));
}

async function setWarmAutopilot(payload) {
  // Gated like the macro schedule. The caller becomes the owner every tick is checked against
  // (see warmAutopilotProfiles).
  await requirePermission('automation.run');
  const input = requireObject(payload);
  const existing = await readSetting('warmAutopilot', null);
  if (existing) await assertCanChangeWarmAutopilot(existing.ownerMemberId);
  const cfg = { ...warmAutopilot.normalizeConfig(input), ownerMemberId: currentMemberId };
  if (warmAutopilot.configProblem(cfg)) throw new Error('Choose a group for the autopilot to warm.');
  // Groups belong to the whole workspace (the group list is not scoped per member), so any existing
  // group is one the member can see; the profiles in it are still checked one by one on each tick.
  if (cfg.target === 'group' && !(await getPrisma().group.findUnique({ where: { id: cfg.groupId }, select: { id: true } }))) {
    throw new Error('That group no longer exists.');
  }
  await writeSetting('warmAutopilot', cfg);
  // Turning it off stops warm-ups in flight; each closes the browser it opened.
  if (!cfg.enabled) for (const run of autopilotWarmerRuns()) run.aborted = true;
  warmAutopilotLastError = null;
  await logAudit('automation.warm-autopilot', { detail: { enabled: cfg.enabled, target: cfg.target, groupId: cfg.groupId } });
  return warmAutopilotView(cfg);
}

// Warm-up count and last warm-up per profile, for the age badge on the Profiles list.
async function getWarmStats(payload) {
  const input = requireObject(payload);
  const ids = parseIdArray(input.ids).slice(0, 500);
  const { allowed } = await partitionAccessibleProfileIds(ids);
  const all = (await readSetting('warmStats', {})) || {};
  const stats = {};
  for (const id of allowed) {
    const s = all[id];
    if (s) stats[id] = { runs: Number(s.runs) || 0, lastAt: s.lastAt || null };
  }
  return { stats };
}

// ---- Local developer API tokens + server toggle ----
function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function serializeApiToken(t) {
  return {
    id: t.id,
    name: t.name,
    // Only the hash is stored, so after creation the token can only be shown as a generic mask.
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
  // `token` is returned exactly once - the renderer must show it now or never.
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

// ---- 2FA vault, Human-Type, Synchronizer ----
async function getProfile2faToken(payload) {
  const input = requireObject(payload);
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
  // A live code is a login credential, so revealing it is role-gated and logged.
  await assertCanRevealKind('twoFactorCode');
  const profile = await getPrisma().profile.findUnique({ where: { id }, select: { twoFactorSeed: true } });
  if (!profile) throw new Error('Profile not found.');
  if (!profile.twoFactorSeed) throw new Error('This profile has no 2FA secret saved.');
  let token;
  try {
    token = totp.totpToken(secretStore.open(profile.twoFactorSeed)); // open() is fail-safe for legacy plaintext seeds
  } catch (e) {
    throw new Error('The saved 2FA secret is not valid base32.');
  }
  await logAudit('profile.2fa_code_read', { profileId: id });
  return token;
}

async function systemHumanType(payload) {
  const input = requireObject(payload);
  const sessionId = requiredString(input.sessionId, 'sessionId');
  // Session ids equal profile ids, so check the caller may access that profile before typing.
  if (/^\d+$/.test(sessionId)) await assertCanAccessProfile(Number.parseInt(sessionId, 10));
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
  registerHandler(CHANNELS.ANTIDETECT_ENGINE_STATUS, antidetectEngineStatus);
  registerHandler(CHANNELS.ANTIDETECT_ENGINE_DOWNLOAD, downloadAntidetectEngine);
  registerHandler(CHANNELS.BROWSER_FIREFOX_STATUS, firefoxStatus);
  registerHandler(CHANNELS.BROWSER_FIREFOX_LIST, firefoxListDownloadable);
  registerHandler(CHANNELS.BROWSER_FIREFOX_DOWNLOAD, downloadFirefox);
  registerHandler(CHANNELS.BROWSER_FIREFOX_DOWNLOAD_STATUS, firefoxDownloadStatus);
  registerHandler(CHANNELS.BROWSER_FIREFOX_DOWNLOAD_PAUSE, pauseFirefoxDownload);
  registerHandler(CHANNELS.BROWSER_FIREFOX_DOWNLOAD_RESUME, resumeFirefoxDownload);
  // Extract leftover browser .zips (e.g. a half-finished manual download) into usable installs, then
  // re-surface downloads interrupted by a crash so the UI can offer Resume.
  browserDownloader.reconcileStrayZips().catch(() => {});
  browserDownloader.initResumableState().catch(() => {});
  firefoxEngine.initFirefoxResumableState().catch(() => {});
  // Settle any automation run left mid-flight by a crash or a quit (see the function).
  reconcileInterruptedAutomationRuns().catch(() => {});
  registerHandler(CHANNELS.DASHBOARD_GET_STATS, getDashboardStats);

  registerHandler(CHANNELS.PROXY_LIST, listProxies);
  registerHandler(CHANNELS.PROXY_CREATE, createProxy);
  registerHandler(CHANNELS.PROXY_UPDATE, updateProxy);
  registerHandler(CHANNELS.PROXY_DELETE, deleteProxy);
  registerHandler(CHANNELS.PROXY_BATCH_ADD, batchAddProxies);
  registerHandler(CHANNELS.PROXY_FREE_HARVEST, harvestFreeProxiesHandler);
  registerHandler(CHANNELS.PROXY_FREE_CANCEL, cancelFreeProxyHarvest);
  registerHandler(CHANNELS.PROXY_CHECK, checkProxy);
  registerHandler(CHANNELS.PROXY_BULK_DELETE, bulkDeleteProxies);
  registerHandler(CHANNELS.PROXY_ROTATION_GET, getProxyRotation);
  registerHandler(CHANNELS.PROXY_ROTATION_SET, setProxyRotation);
  registerHandler(CHANNELS.PROXY_SYNC_VENDOR_POOL, syncVendorPool);
  registerHandler(CHANNELS.PROXY_VENDOR_LOOKUP, vendorLookup);
  registerHandler(CHANNELS.PROXY_PROVIDER_CREDS_GET, getProxyProviderCreds);
  registerHandler(CHANNELS.PROXY_PROVIDER_CREDS_SET, saveProxyProviderCreds);
  registerHandler(CHANNELS.PROXY_PROVIDER_ACCOUNT, getProviderAccount);
  registerHandler(CHANNELS.PROXY_ROTATE_IP, rotateProxyIp);
  registerHandler(CHANNELS.PROXY_TEST_ALL, testAllProxies);
  registerHandler(CHANNELS.PROXY_CHECK_STREAM, runProxyCheckStream);
  registerHandler(CHANNELS.PROXY_CHECK_STOP, stopProxyCheck);
  registerHandler(CHANNELS.PROXY_GROUP_LIST, listProxyGroups);
  registerHandler(CHANNELS.PROXY_GROUP_CREATE, createProxyGroup);
  registerHandler(CHANNELS.PROXY_GROUP_UPDATE, updateProxyGroup);
  registerHandler(CHANNELS.PROXY_GROUP_DELETE, deleteProxyGroup);
  registerHandler(CHANNELS.PROXY_GROUP_ASSIGN, assignProxiesToGroup);
  registerHandler(CHANNELS.PROXY_AUTO_GROUP, autoGroupProxies);
  registerHandler(CHANNELS.PROXY_HEALTH_HISTORY, getProxyHealthHistory);
  registerHandler(CHANNELS.PROXY_RECENT_HEALTH, getRecentProxyHealth);
  registerHandler(CHANNELS.PROXY_VENDOR_SCOREBOARD, getVendorScoreboard);

  registerHandler(CHANNELS.PROFILE_LIST, listProfiles);
  registerHandler(CHANNELS.PROFILE_CREATE, createProfile);
  registerHandler(CHANNELS.PROFILE_BATCH_GENERATE, batchGenerateProfiles);
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
  registerHandler(CHANNELS.PROFILE_BULK_LAUNCH_CONTROL, controlBulkLaunch);
  registerHandler(CHANNELS.PROFILE_BULK_LAUNCH_STATUS, async () => getBulkLaunchStatus());
  registerHandler(CHANNELS.PROFILE_BULK_CLOSE, bulkCloseSessions);
  registerHandler(CHANNELS.PROFILE_BULK_ASSIGN_PROXY, bulkAssignProxies);
  registerHandler(CHANNELS.PROFILE_ACCESS_GRANT, grantProfileAccess);
  registerHandler(CHANNELS.PROFILE_ACCESS_REVOKE, revokeProfileAccess);
  registerHandler(CHANNELS.PROFILE_ACCESS_LIST, listProfileAccess);
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
  registerHandler(CHANNELS.PROFILE_CAPTCHA_SCORES, captchaScores);
  registerHandler(CHANNELS.PROFILE_CAPTCHA_FIX, captchaFix);
  registerHandler(CHANNELS.PROFILE_CAPTCHA_FIX_BULK, captchaFixBulk);
  registerHandler(CHANNELS.PROFILE_PRELAUNCH_CHECK, prelaunchCheck);
  registerHandler(CHANNELS.PROFILE_WARM_STATS, getWarmStats);
  registerHandler(CHANNELS.PROFILE_ACTIVITY, listActivity);
  registerHandler(CHANNELS.PROFILE_GET_2FA_TOKEN, getProfile2faToken);
  registerHandler(CHANNELS.PROFILE_BULK_SYNCHRONIZE, bulkSynchronize);
  registerHandler(CHANNELS.PROFILE_EXPORT_ARCHIVE, exportProfileArchive);
  registerHandler(CHANNELS.PROFILE_COOKIE_ROBOT, cookieRobot);
  registerHandler(CHANNELS.PROFILE_GET_LOCKS, getProfileLocks);
  registerHandler(CHANNELS.SYSTEM_HUMAN_TYPE, systemHumanType);
  registerHandler(CHANNELS.SETTINGS_GET_SCHEDULER, getProxyScheduler);
  registerHandler(CHANNELS.SETTINGS_SET_SCHEDULER, setProxyScheduler);
  registerHandler(CHANNELS.SETTINGS_GET_GLOBAL, getGlobalSettingsForActor);
  registerHandler(CHANNELS.SETTINGS_SET_GLOBAL, setGlobalSettingsForActor);
  registerHandler(CHANNELS.SETTINGS_GET_PROXY_POLICY, getProxyPolicy);
  registerHandler(CHANNELS.SETTINGS_SET_PROXY_POLICY, setProxyPolicy);

  // Monetization - affiliate links for the Proxy Provider marketplace
  registerHandler(CHANNELS.MONETIZATION_GET_LINKS, getAffiliateLinks);
  registerHandler(CHANNELS.MONETIZATION_SET_LINKS, setAffiliateLinks);

  // Team Extensions - download/unzip Chrome extensions and inject into profiles
  registerHandler(CHANNELS.EXTENSIONS_LIST, listExtensions);
  registerHandler(CHANNELS.EXTENSIONS_INSTALL_FROM_ID, installExtensionFromId);
  registerHandler(CHANNELS.EXTENSIONS_DELETE, deleteExtension);
  registerHandler(CHANNELS.EXTENSIONS_TOGGLE_GLOBAL, toggleExtensionGlobal);

  // Identity Data Vault - personas for the Smart Autofill engine
  registerHandler(CHANNELS.PERSONA_IMPORT_BATCH, importPersonas);
  registerHandler(CHANNELS.PERSONA_CREATE_MANUAL, createPersonaManual);
  registerHandler(CHANNELS.PERSONA_GET_ALL, getAllPersonas);
  // These channels need vault.manage so a non-owner cannot enumerate the vault or poison usedOnUrls.
  // The autofill bridges below call the raw functions (password-free, origin-scoped) so in-session
  // autofill works for any member.
  registerHandler(CHANNELS.PERSONA_GET_AVAILABLE_FOR_URL, async (payload) => {
    await requirePermission('vault.manage');
    return getAvailablePersonasForUrl(payload);
  });
  registerHandler(CHANNELS.PERSONA_MARK_USED, async (payload) => {
    await requirePermission('vault.manage');
    return markPersonaUsed(payload);
  });
  registerHandler(CHANNELS.PERSONA_CLEAR_USED, clearPersonaUsed);
  registerHandler(CHANNELS.PERSONA_DELETE, deletePersonas);
  registerHandler(CHANNELS.PERSONA_UPDATE, updatePersona);
  registerHandler(CHANNELS.PERSONA_PREVIEW_FILE, previewPersonaFile);

  // In-app OTA updates (electron-updater) - state/install/check for the Dashboard banner.
  registerHandler(CHANNELS.UPDATER_GET_STATE, () => updater.getState());
  registerHandler(CHANNELS.UPDATER_INSTALL, () => updater.installDownloadedUpdate());
  registerHandler(CHANNELS.UPDATER_CHECK, () => updater.checkForUpdatesNow());
  // Broadcast updater events to every window - owned here so the channel definition
  // and its emit live alongside the rest of the renderer comms.
  updater.setEventSink((payload) => {
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.webContents.send(CHANNELS.UPDATER_EVENT, payload); } catch (e) { /* window gone */ }
    }
  });

  // Smart Autofill - let the in-page widget (run in a private isolated world of
  // launched Chromium profiles) reach the persona vault over its CDP channel.
  configurePersonaBridge({
    // Refuse vault calls while locked or signed out.
    isAvailable: () => personaVaultAvailable(),
    listForUrl: (url) => getAvailablePersonasForUrl({ url }),
    markUsed: (id, url) => markPersonaUsed({ id, url }),
    // Resolve the plaintext password server-side by id: it is typed via the trusted CDP bridge and
    // never crosses into page JS.
    getSecret: (id) => getPersonaSecretById(id),
    // Gate injection on the global Smart Autofill toggle (default on; fail-open).
    isEnabled: async () => { try { const g = await getGlobalSettings(); return g?.smartAutofill?.enabled !== false; } catch (e) { return true; } }
  });

  // Firefox Smart Autofill: Firefox has no CDP/exposeFunction, so its WebExtension reaches the same
  // persona vault over a loopback-only bridge.
  autofillBridge.configure({
    listForUrl: (url) => getAvailablePersonasForUrl({ url }),
    markUsed: (id, url) => markPersonaUsed({ id, url }),
    // Firefox has no CDP trusted typer, so the content script fills the password itself, but only for a
    // persona offered on the committed origin, resolved one id at a time via the loopback /secret endpoint.
    getSecret: (id, url) => getPersonaSecretForUrl(id, url),
    // No vault data while the app is locked or nobody is signed in.
    isAvailable: () => personaVaultAvailable()
  });
  // Not started at boot: firefoxEngine acquires the bridge when a Firefox profile with the autofill
  // extension launches and releases it on exit, so the loopback port is open only while needed.

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
    startWarmAutopilotTimer();
    try {
      // Keep the proxy health-history table bounded (~30 days).
      const cutoff = new Date(Date.now() - 30 * 86400000);
      await getPrisma().proxyHealthEvent.deleteMany({ where: { ts: { lt: cutoff } } });
    } catch (e) { /* ignore */ }
    try {
      // Audit-log retention - prune activity/security events past the configured age.
      const g = await getGlobalSettings();
      const days = Number(g && g.audit && g.audit.retentionDays);
      if (Number.isFinite(days) && days > 0) {
        const auditCutoff = new Date(Date.now() - days * 86400000);
        await getPrisma().activityLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } });
      }
    } catch (e) { /* ignore */ }
  })();

  // Reap stale profile locks (crash/orphan) by reconciling against live sessions.
  const lockSweep = setInterval(() => {
    try { pruneDeadSessions(); } catch (e) { /* ignore */ } // drop Chromium sessions that died without firing 'disconnected'
    try { reconcileProfileLocks(); } catch (e) { /* ignore */ }
  }, 60000);
  if (lockSweep.unref) lockSweep.unref();

  // Resilience: persist/restore sessions, surface crashes, optional auto-restart.
  setSessionEventSink(handleSessionEvent);
  try { firefoxEngine.setSessionEventSink(handleSessionEvent); } catch (e) { /* firefox engine optional */ }
  // Memory-pressure guard (opt-in via settings; checks every 30s, no-op when off).
  memoryGuardTimer = setInterval(() => { checkMemoryPressure().catch(() => {}); }, 30000);
  if (memoryGuardTimer.unref) memoryGuardTimer.unref();

  registerHandler(CHANNELS.GROUP_LIST, listGroups);
  registerHandler(CHANNELS.GROUP_CREATE, createGroup);
  registerHandler(CHANNELS.GROUP_UPDATE, updateGroup);
  registerHandler(CHANNELS.GROUP_DELETE, deleteGroup);
  registerHandler(CHANNELS.GROUP_ASSIGN, assignProfilesToGroup);
  registerHandler(CHANNELS.TAG_LIST, listTags);
  registerHandler(CHANNELS.PROFILE_TAG_ASSIGN, assignTagToProfiles);
  registerHandler(CHANNELS.PROFILE_BULK_RENAME, bulkRenameProfiles);

  registerHandler(CHANNELS.SESSION_LIST, () => listSessionsForViewer());
  registerHandler(CHANNELS.SESSION_CLOSE, closeSession);
  registerHandler(CHANNELS.SESSION_RESTORE_GET, getSessionRestore);
  registerHandler(CHANNELS.SESSION_RESTORE_RUN, runSessionRestore);
  registerHandler(CHANNELS.SESSION_RESOURCE_USAGE, getSessionResourceUsage);

  registerHandler(CHANNELS.BATCH_PREVIEW_PROFILES_DIALOG, previewProfilesViaDialog);
  registerHandler(CHANNELS.BATCH_COMMIT_PROFILE_IMPORT, commitProfileImport);
  registerHandler(CHANNELS.BATCH_EXPORT_PROFILES, exportProfiles);
  registerHandler(CHANNELS.BATCH_EXPORT_PROFILES_FILE, exportProfilesToFile);

  // Profile migration - transfer from competitor platforms (Owner / Super Admin)
  registerHandler(CHANNELS.MIGRATION_START_TRANSFER, migrateProfiles);

  // Softglaze Pro - automation
  registerHandler(CHANNELS.AUTOMATION_GET_MACROS, getMacros);
  registerHandler(CHANNELS.AUTOMATION_SAVE_MACRO, saveMacro);
  registerHandler(CHANNELS.AUTOMATION_DELETE_MACRO, deleteMacro);
  registerHandler(CHANNELS.AUTOMATION_START_WARMER, startWarmer);
  registerHandler(CHANNELS.AUTOMATION_STOP_WARMER, stopWarmer);
  registerHandler(CHANNELS.AUTOMATION_LIST_WARMERS, listActiveWarmers);
  registerHandler(CHANNELS.AUTOMATION_GET_HISTORY, getAutomationHistory);
  registerHandler(CHANNELS.AUTOMATION_RUN_MACRO, runMacroOnProfile);
  registerHandler(CHANNELS.AUTOMATION_CONTROL_MACRO, controlMacro);
  registerHandler(CHANNELS.AUTOMATION_START_RECORDING, startMacroRecordingOnProfile);
  registerHandler(CHANNELS.AUTOMATION_STOP_RECORDING, stopMacroRecordingOnProfile);
  registerHandler(CHANNELS.AUTOMATION_GET_SCHEDULE, getMacroSchedule);
  registerHandler(CHANNELS.AUTOMATION_SET_SCHEDULE, setMacroSchedule);
  registerHandler(CHANNELS.AUTOMATION_RUN_PARALLEL, runParallelMacroHandler);
  registerHandler(CHANNELS.AUTOMATION_PARALLEL_STATUS, getParallelRunStatus);
  registerHandler(CHANNELS.AUTOMATION_PICK_DATA_FILE, pickDataFile);
  registerHandler(CHANNELS.AUTOMATION_WARM_AUTOPILOT_GET, getWarmAutopilot);
  registerHandler(CHANNELS.AUTOMATION_WARM_AUTOPILOT_SET, setWarmAutopilot);

  // Softglaze Pro - local developer API
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
  registerHandler(CHANNELS.MEMBER_SUPER_STATUS, superAdminStatus);
  registerHandler(CHANNELS.MEMBER_SUPER_SETUP, superAdminSetup);
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
  registerHandler(CHANNELS.LICENSE_BACKEND_INFO, backendLicenseInfo);
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
  registerHandler(CHANNELS.TEAM_PERMISSION_CATALOG, getPermissionCatalog);
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
  registerHandler(CHANNELS.AUTH_REMEMBER_STATUS, rememberStatus);
  registerHandler(CHANNELS.AUTH_FORGET, forgetRemembered);
  registerHandler(CHANNELS.ACCOUNT_GET, accountGet);
  registerHandler(CHANNELS.ACCOUNT_SAVE, accountSave);
  registerHandler(CHANNELS.ACCOUNT_SEND_OTP, accountSendOtp);
  registerHandler(CHANNELS.ACCOUNT_VERIFY_OTP, accountVerifyOtp);
  registerHandler(CHANNELS.ACCOUNT_REGISTER, accountRegister);
  registerHandler(CHANNELS.EMAIL_GET_CONFIG, getEmailConfig);
  registerHandler(CHANNELS.EMAIL_SET_CONFIG, setEmailConfig);
  registerHandler(CHANNELS.EMAIL_TEST, testEmail);

  // Softglaze Pro - wire the local REST API to the launch pipeline + settings,
  // then start it if the user has it enabled. Loopback-only; off by default.
  localApi.configure({
    // A profile started over the API is driven by the caller's script, so a block must not switch it.
    launchProfileById: async (id, startUrl, opts) => {
      const res = await launchProfileById(id, startUrl, opts);
      apiDrivenProfiles.add(Number(id));
      return res;
    },
    // Slim, non-secret profile list for GET /api/v1/profiles (no proxy passwords).
    readProfiles: async () => {
      const rows = await getPrisma().profile.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' } });
      return rows.map((p) => ({
        id: p.id,
        title: p.title,
        os: p.os || null,
        browserVersion: p.browserVersion || null,
        userAgent: p.userAgent || null,
        // proxyInfoString is host:port:user:pass; mask it so the API never returns the password.
        proxy: p.proxyInfoString ? maskProxyInfoString(p.proxyInfoString, null) : null,
        groupId: p.groupId || null,
        lastUsedAt: p.lastUsedAt instanceof Date ? p.lastUsedAt.toISOString() : (p.lastUsedAt || null)
      }));
    },
    readConfig: () => readSetting('localApi', { enabled: false, port: localApi.DEFAULT_PORT }),
    writeConfig: (cfg) => writeSetting('localApi', cfg)
  });
  // Bring the session online only when the DB is readable. With at-rest encryption the DB starts
  // locked, and db:unlock runs afterDbReady() itself.
  if (database.isDbUnlocked()) {
    afterDbReady();
  }

  registered = true;
}

async function shutdownIpcHandlers() {
  stopProxyScheduler();
  stopMacroScheduler();
  stopWarmAutopilotTimer();
  if (memoryGuardTimer) { clearInterval(memoryGuardTimer); memoryGuardTimer = null; }
  await localApi.stop().catch(() => {});
  await autofillBridge.stop().catch(() => {});
  await closeAllProfileSessions();
  await firefoxEngine.closeAllFirefoxSessions().catch(() => {});
  await disconnectPrisma();
}

module.exports = {
  CHANNELS,
  registerIpcHandlers,
  shutdownIpcHandlers,
  attemptRememberedUnlock,
  whenSessionReady
};