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
  findRealChrome,
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
  isRecordingMacro,
  getAutomationPage,
  reapplyScreenMetrics
} = require('./browserEngine');
const blockDetect = require('./blockDetect');
const dnsbl = require('./dnsbl');
const browserDownloader = require('./browserDownloader');
const firefoxEngine = require('./firefoxEngine');
const localApi = require('./localApi');
const aiActor = require('./ai/actor');
const ai = require('./ai');
const { registerAiIpc, createWindowEmitter } = require('./ai/ipc');
const autofillBridge = require('./autofillBridge');
const { siteKeyOf } = require('./siteKey');
const updater = require('./updater');
const totp = require('./totp');
const permissions = require('./permissions');
const rbacPolicy = require('./rbacPolicy');
const payments = require('./payments');
const { parseWorkbookFile, parseDataRows, parseSystemProxyBehavior, BROWSER_CORE, normalizeBrowserCore, toStoredBrowserCore } = require('./importParser');
const { generateFingerprint, normalizeBrand, deviceGpuCoherence, fingerprintSignature, CHROME_VERSIONS } = require('./fingerprintGenerator');
const { doNotTrackChoice } = require('./doNotTrack');
const profileOptions = require('./profileOptions');
const migrationService = require('./migrationService');
const extensionManager = require('./extensionManager');
const profileArchive = require('./profileArchive');
const profileData = require('./profileData');
const captchaScore = require('./captchaScore');
const launchCheck = require('./launchCheck');
const vendorScoreboard = require('./vendorScoreboard');
const proxyScope = require('./proxyScope');
const proxyGate = require('./proxyGate');
const warmAutopilot = require('./warmAutopilot');
const providerAccount = require('./providerAccount');
const dbCrypto = require('./dbCrypto');
const database = require('./database');
const licensePolicy = require('./licensePolicy');
const { relay } = require('./remoteRelay');
const { runParallelMacro } = require('./parallelRunner');
const teamPolicy = require('./teamPolicy');
const tierPolicy = require('./tierPolicy');
const { CloudSyncEngine, resolveWorkspaceSalt } = require('./cloudSync');
const syncTransport = require('./syncTransport');
const syncPolicy = require('./syncPolicy');
const secretStore = require('./secretStore');
const proxySecrets = require('./proxySecrets');
const proxyExtensionExport = require('./proxyExtensionExport');
const rememberStore = require('./rememberStore');
const { tenantConfig } = require('./tenantConfig');
const licenseClient = require('./licenseClient');
const storeBridge = require('./storeBridge');
const storeCommerceLib = require('./storeCommerce');
const storeRatingLib = require('./storeRating');
const { installChannel } = require('./installChannel');
const tenantSignup = require('./tenantSignup');
const tenantTrial = require('./tenantTrial');
const planCatalog = require('./planCatalog');
const checkoutMethods = require('./checkoutMethods');
const signupLead = require('./signupLead');
const signupConfirm = require('./signupConfirm');
const serverErrors = require('./serverErrors');
const ownerCert = require('./ownerCert');
const authGate = require('./authGate');
const featureGate = require('./featureGate');
const { SECRET_MASK, redactPlatformAccounts, redactProfileRow, restoreMaskedSecrets, restoreMaskedProxyRaw, storedProxyCredentials, maskProxyInfoString, redactUseOnlyProxy, redactForeignProxy } = require('./profileRedaction');
const {
  parseLoginList, csvFilter, asnList, FILTER_PATTERNS, proxySellerRotation, unwrapProxySeller, maskProxySellerKey, proxySellerListItems, proxySellerListGeo, proxySellerGeoView,
  GEOJS_URL, normalizeGeoJs, PROXY_SELLER_ORDER_TYPES, proxySellerOrderRows, summarizeProxySellerOrders,
  parseIpRoyalLine, ipRoyalLifetime, ipRoyalLocation, pickIpRoyalPort, ipRoyalCountriesView, ipRoyalErrorMessage,
  marsProxiesLocation, parseMarsProxiesList, nodeMavenUsername, nodeMavenTtl, froxyPassword, froxyBasePassword,
  packetStreamPassword, packetStreamCountry, airproxyRows,
  proxmintUsername, proxmintPickProduct, databayUsername, databayZone,
  ipfoxyUsername, mangoProxyPlace, mangoProxyAsn, mangoProxyCollect, mangoProxyCountryPage,
  catProxiesResiUsername, catProxiesMobileUsername, catProxiesCreds, catProxiesPremiumPassword,
  rapidProxySid, rapidProxyUsername, NOVADA_ZONES, novadaUsername,
  PROXIESSX_POOLS, proxiesSxSid, proxiesSxUsername, proxiesSxProxyCreds,
  proxiesSxStock, PROXIESSX_MOBILE_COUNTRIES, PROXIESSX_MAX_SESSIONS,
  mobileProxySpaceRows, mobileProxySpaceCountries, proxySolutionsPage,
  collectProxidizePerProxy, proxidizePerGbUsername,
  liveProxiesListUrl, liveProxiesRows, liveProxiesPlanLabel,
  LIVEPROXIES_GATEWAY, liveProxiesBaseUser, liveProxiesUsername, liveProxiesStickyHost,
  ipBurgerUsername, proxy302Token, proxy302CountryId, proxy302Row, proxy302AreaId, proxy302PurchaseQuery,
  medianMs,
  twoExtractBaseUser, twoExtractUsername,
  gonzoProxyBaseLogin, gonzoProxyUsername,
  SIMPLYPROXIES_NETWORKS, simplyProxiesUsername,
  coroniumRows,
  singaporeMobileProxyRows,
  gsocksProxyIds, gsocksListRows, gsocksAuthSchemes,
  proxyBonanzaRows,
  proxy6Page,
  catProxiesIspRows, catProxiesDatacenterRows,
  vendorErrorText, collectVendorStrings,
  PROXYBRAZIL_KEY, proxyBrazilRows, proxyBrazilErrorMessage, proxyBrazilRotateRefusal,
  proxyUdpSubscriptions, proxyUdpRows, proxyUdpFindSubscription, proxyUdpRotateOutcome, retryAfterWait,
  zokolRows, zokolRotateRefusal,
  RESIPROX_POOLS, resiProxPool, resiProxCountries, resiProxRow,
  SIMPLYNODE_POOLS, simplyNodeTrafficValue, simplyNodeSubaccountPick, simplyNodeCountries, simplyNodeProxyBody, simplyNodeRow,
  retryAfterSeconds,
  NODE4_GATEWAY_PRODUCTS, NODE4_CALL_MAX, node4GatewayBody, node4GatewayRows, node4StaticRows, node4Countries,
  PROXYEMPIRE_POOLS, proxyEmpireBody, proxyEmpireSlot, proxyEmpireErrorMessage, proxyEmpireCountries,
  mountProxiesRows, mountProxiesRotateTarget,
  massiveBaseUser, massiveUsername,
  iproxyRows
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
  PROFILE_ROTATE_IP: 'profile:rotate-ip', // Rotate IP on a profile's own proxy (Profiles page)
  PROXY_EXTENSION_COPY_INFO: 'proxy:extension-copy-info', // counts for "Copy for SoftGlaze Proxy"; no secrets
  PROXY_EXTENSION_COPY: 'proxy:extension-copy', // main writes the clipboard; returns counts only
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
  PROFILE_BATCH_GENERATE_CANCEL: 'profile:batch-generate-cancel', // renderer -> main (stop a Quick generate run)
  PROFILE_BATCH_GENERATE_PROGRESS: 'profile:batch-generate-progress', // main -> renderer stream
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
  PROFILE_EDITOR_OPTIONS: 'profile:editor-options',
  PROFILE_GENERATE_IDENTITY: 'profile:generate-identity',
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
  STORE_STATUS: 'store:status',
  STORE_PURCHASE: 'store:purchase',
  STORE_RESTORE: 'store:restore',
  STORE_RATING_STATUS: 'store:rating-status',
  STORE_RATING_CHOOSE: 'store:rating-choose',
  STORE_RATING_RATE: 'store:rating-rate',
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
  ACCOUNT_SIGNUP_STATUS: 'account:signup-status',
  ACCOUNT_CONFIRM_START: 'account:confirm-start',
  ACCOUNT_CONFIRM_CHECK: 'account:confirm-check',
  ACCOUNT_CONFIRM_LATER: 'account:confirm-later',
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
  UPDATER_CHECK: 'updater:check',
  // The website installer's "new version available" notice (no automatic updates there).
  UPDATER_NOTICE_LATER: 'updater:notice-later',
  UPDATER_NOTICE_DOWNLOAD: 'updater:notice-download'
});

// HTTPS is a proxy reached over TLS (Chrome's https:// proxy scheme); since 1.0.26 it is kept as HTTPS.
const VALID_PROXY_TYPES = new Set(['HTTP', 'HTTPS', 'SOCKS5', 'SOCKS4']);
const VALID_SYSTEM_PROXY_BEHAVIORS = new Set(['DIRECT', 'PROFILE_PROXY', 'SYSTEM_PROXY']);

let registered = false;
let proxySchedulerTimer = null;
let memoryGuardTimer = null;
let currentMemberId = null;
// Cached by getActiveMember() so the synchronous proxy serializer can decide redaction.
// Single-user mode (no member) counts as owner, so full reveal.
let currentMemberCanRevealProxy = true;
// The same flag for an AI or Local API token's member, per call (keyed by the frozen actor of
// aiActor.run()): getActiveMember() records it while a token acts; the window's flag is left alone.
const actorCanRevealProxy = new WeakMap();
// The member a call acts as: an AI or Local API token's member inside aiActor.run() (see
// src/main/ai/actor.js), otherwise the member signed in to the window.
function actingMemberId() {
  const a = aiActor.current();
  return a ? a.memberId : currentMemberId;
}
// proxies.reveal of the member this call acts as, for the synchronous serializers (serializeProxy,
// serializeProfile, the profile list, the export). Inside an AI or Local API call that is the token's
// member, as for every other permission check there; a token whose member was not read yet gets none.
function proxyRevealAllowed() {
  const a = aiActor.current();
  if (!a) return currentMemberCanRevealProxy;
  return actorCanRevealProxy.get(a) === true;
}
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
      // A page turned off for this member under "Visible features" cannot be used from anywhere else.
      if (featureGate.featureForChannel(channel)) {
        const off = featureGate.refusalFor(channel, await getActiveMember());
        if (off) return { ok: false, error: { message: off.message, code: off.code } };
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
  try { await db.activityLog.create({ data: { profileId, action, detail: aiActor.tagDetail(detail), memberId: actingMemberId() } }); } catch (e) { /* non-fatal */ }
}

// Audit-log entry for security/team events with no profile, stored under profileId 0 (shown as
// System). Object details are stored as compact JSON. Never throws, so logging cannot break the action.
async function logAudit(action, opts = {}) {
  try {
    const raw = aiActor.tagDetail(opts && opts.detail);
    const detail = (raw && typeof raw === 'object') ? JSON.stringify(raw) : (raw || null);
    await getPrisma().activityLog.create({
      data: { profileId: (opts && opts.profileId) || 0, action, detail, memberId: actingMemberId() }
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
    .replace(/^SOCKS4A$/, 'SOCKS4')
    .replace(/^SOCKS5H?$|^SOCKS$/, 'SOCKS5');
  if (!VALID_PROXY_TYPES.has(normalized)) throw new Error('Proxy type must be HTTP, HTTPS, SOCKS5, or SOCKS4.');
  return normalized;
}

// The type the profile editor picked for a raw "host:port:user:pass" proxy. A scheme written in the
// string itself (socks5://...) wins, and a label that is not a proxy protocol leaves the string's own
// default. (The editor's "Local" sends the protocol picked for it, see ProfilesPage.)
function proxyTypeHintFor(raw, type) {
  if (!type || /^[a-z0-9]+:\/\//i.test(String(raw || '').trim())) return null;
  try { return parseProxyType(type); } catch (e) { return null; }
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
  // Smartproxy is now Decodo; stored rows keep the provider key smartproxy.
  if (n.startsWith('smartproxy') || n.startsWith('decodo')) return 'smartproxy';
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
    // The vendor's "change IP" link often carries the account's API key, so it follows the username:
    // shown with proxies.reveal, a mask otherwise (rbacPolicy). Rotate IP never needs it in the
    // window: main fires the stored link by proxy id (rotateProxyIp).
    rotationUrl: proxy.rotationUrl || null,
    hasRotationUrl: Boolean(proxy.rotationUrl),
    // The pool shows a Rotate IP action only where a rotation can actually happen.
    canRotate: proxyCanRotate(proxy),
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
  return proxyRevealAllowed() ? out : rbacPolicy.redactForRole('OPERATOR', 'proxyCredentials', out);
}

// The proxies a profile opens on: its own proxy and the proxies of its rotation pool (pickRotationProxy).
async function profileLaunchProxyIds(db, profileId) {
  const ids = new Set();
  const row = await db.profile.findUnique({ where: { id: profileId }, select: { proxyId: true } });
  if (row && row.proxyId != null) ids.add(Number(row.proxyId));
  const cfg = ((await readSetting('proxyRotation', {})) || {})[profileId];
  if (cfg && cfg.enabled && Array.isArray(cfg.proxyIds)) for (const pid of cfg.proxyIds) ids.add(Number(pid));
  return ids;
}

// Who may rotate this proxy. The member's own Proxy pool (the proxy is owned within their visible
// subtree), as before. Or, with `profileId`, a proxy that profile opens on, for anyone who may launch the
// profile: a "use only" share included, since main fires the stored link by id and nothing secret
// reaches the member. Returns { inPool }. Throws FORBIDDEN otherwise.
async function assertCanRotateProxy(id, profileId) {
  try {
    await assertCanAccessProxy(id);
    return { inPool: true };
  } catch (e) {
    if (!e || e.code !== 'FORBIDDEN' || profileId == null) throw e;
  }
  await requirePermission('profiles.launch');
  await assertCanAccessProfile(profileId);
  if (!(await profileLaunchProxyIds(getPrisma(), profileId)).has(Number(id))) {
    const e = new Error('You do not have access to this proxy.'); e.code = 'FORBIDDEN'; throw e;
  }
  return { inPool: false };
}

// Fires the vendor's one-shot "change IP" link (stored, or provided and persisted) server-side.
// Failures return or throw cleanly and never touch the live proxy credentials.
// Callers: the Proxy pool and SoftGlaze AI / the Local API by proxy id; the Profiles page
// (rotateProfileProxyIp) and the automatic block response with the profile's id as well.
async function rotateProxyIp(payload) {
  // Main fetches a renderer-supplied URL: require proxies.manage, access to this proxy, a public target.
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const id = parseId(input.id ?? input.proxyId);
  const profileId = input.profileId == null ? null : parseId(input.profileId, 'profileId');
  const { inPool } = await assertCanRotateProxy(id, profileId);
  const db = getPrisma();
  const proxy = await db.proxy.findUnique({ where: { id } });
  if (!proxy) throw new Error('Proxy not found.');

  // Prefer a freshly-provided link (and persist it for next time), else the stored one. The window
  // never needs the stored link (a member without proxies.reveal is sent a mask), so rotating is by
  // proxy id only; a mask sent back means "the stored link". Only a proxy of the member's own pool
  // takes a new link: a shared profile's proxy belongs to someone else.
  let rotationUrl = String(input.rotationUrl || '').trim();
  if (rotationUrl === SECRET_MASK) rotationUrl = '';
  if (rotationUrl && !inPool) {
    const e = new Error('A rotation link can only be saved on a proxy of your own Proxy pool.'); e.code = 'FORBIDDEN'; throw e;
  }
  if (rotationUrl) {
    await db.proxy.update({ where: { id }, data: { rotationUrl } }).catch(() => {});
  } else {
    rotationUrl = String(proxy.rotationUrl || '').trim();
  }
  // The vendor's reply is shown only to a member who may see the link (some vendors echo it or the key).
  const showReply = inPool && await canRevealProxyCredentials();
  // A vendor that rotates through its own API needs no link (PROVIDER_ROTATORS: DataImpulse sticky
  // ports, ...). A stored or provided link still wins.
  const apiVendor = rotationUrl ? '' : apiRotationProvider(proxy);
  if (apiVendor) {
    const res = await PROVIDER_ROTATORS[apiVendor](proxy);
    return showReply ? res : { ...res, response: undefined };
  }
  if (!rotationUrl) throw new Error('No IP rotation link is configured for this proxy.');
  if (!/^https?:\/\//i.test(rotationUrl)) throw new Error('The rotation link must be an http(s) URL.');
  await assertPublicHttpUrl(rotationUrl, 'rotation link');

  const axios = require('axios');
  const startedAt = Date.now();
  let res;
  try {
    res = await axios.get(rotationUrl, {
      timeout: rotationLinkTimeoutMs(proxy),
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
  // A vendor that documents its refusals says why (ROTATION_LINK_REFUSALS), never echoing the link.
  const refusal = rotationLinkRefusal(proxy, res.status, res.data);
  if (refusal) throw new Error(refusal);
  const ok = res.status >= 200 && res.status < 400;
  return {
    ok,
    status: res.status,
    latencyMs: Date.now() - startedAt,
    // Many vendors echo the new IP / a status string - surface a short preview.
    response: showReply && typeof res.data === 'string' ? res.data.slice(0, 400) : undefined
  };
}

// Rotate IP from the Profiles page: a new IP on the profile's own proxy, for any member who may launch
// the profile, a "use only" share included (rotateProxyIp's rules: proxies.manage, profiles.launch,
// access to the profile, and a proxy that can rotate). Logged in the profile's activity, as launches
// that rotate are. The proxy comes back as the profile list shows it to this member (launchedProxyView:
// without its username, password and link outside their own pool, and masked without proxies.reveal).
async function rotateProfileProxyIp(payload) {
  await requirePermission('profiles.launch');
  const input = requireObject(payload);
  const id = parseId(input.id ?? input.profileId);
  await assertCanAccessProfile(id); // use access is enough
  const db = getPrisma();
  const profile = await db.profile.findUnique({ where: { id }, include: { proxy: true } });
  if (!profile || profile.deletedAt) throw new Error('Profile not found.');
  if (!profile.proxy) throw new Error('This profile has no proxy to rotate.');
  const res = await rotateProxyIp({ id: profile.proxy.id, profileId: id });
  const label = profile.proxy.name || `${profile.proxy.host}:${profile.proxy.port}`;
  await logActivity(db, id, 'proxy-rotate', res && res.ok === false ? `new IP refused by proxy ${label} (HTTP ${res.status})` : `new IP from proxy ${label}`);
  return { ok: Boolean(res && res.ok !== false), status: res ? res.status : null, latencyMs: res ? res.latencyMs : null, proxy: await launchedProxyView(profile.proxy) };
}

// ---- Rotation links from a spreadsheet import ----
// A row's "Proxy Rotation URL" is the vendor's "change IP" link of the proxy on that row. Since 1.0.26 it
// is put on that proxy when the proxy has no link yet, so it works and is hidden exactly like a proxy's
// own link: Rotate IP (Proxy pool and Profiles), the automatic block response, SoftGlaze AI and the Local
// API fire it by proxy id, and the window gets it only with proxies.reveal (serializeProxy).
// Precedence: the proxy's own link (from a vendor pull or an earlier row) always wins; an import never
// replaces it. Then the imported link; then the DataImpulse sticky reset (rotateProxyIp). A row without a
// proxy of its own (auto-bound to a pool proxy, or no proxy) has no proxy the link belongs to, so it is
// kept for the export only. Every imported link also stays in the Setting profileRotationUrls, as before.
function importedRotationUrl(value) {
  const s = String(value == null ? '' : value).trim();
  if (!/^https?:\/\/\S+$/i.test(s)) return null;
  try { new URL(s); } catch (e) { return null; }
  return s;
}

// Puts `url` on the proxy only while it has no link: one conditional write, so an import and the start-up
// pass below never replace a link, whichever runs first. True when the link was put on the proxy.
async function attachImportedRotationUrl(db, proxyId, url) {
  if (!url || proxyId == null) return false;
  const r = await db.proxy.updateMany({ where: { id: proxyId, OR: [{ rotationUrl: null }, { rotationUrl: '' }] }, data: { rotationUrl: url } });
  return Boolean(r && r.count);
}

// The proxy an import made for this profile's row, still on it: named "<title> Proxy", owned by the
// profile's owner, created at most a minute before the profile (commitProfileImport makes the row's
// proxy just before its profile) and without a link. A renamed or reassigned profile, a proxy reused
// from the pool or an auto-bound one does not qualify.
function proxyMadeForImportedRow(profile, proxy) {
  if (!profile || !proxy || profile.proxyId !== proxy.id || proxy.rotationUrl) return false;
  if (String(proxy.name || '') !== `${profile.title} Proxy`) return false;
  if ((proxy.ownerMemberId ?? null) !== (profile.ownerMemberId ?? null)) return false;
  const made = new Date(proxy.createdAt).getTime();
  const born = new Date(profile.createdAt).getTime();
  return Number.isFinite(made) && Number.isFinite(born) && made <= born && born - made <= 60 * 1000;
}

// Links imported before 1.0.26 are only in profileRotationUrls. Once per link, when the database is
// ready, each is put on its profile's proxy if that proxy was made for the row (proxyMadeForImportedRow)
// and has no link. Every link looked at is recorded in the Setting profileRotationUrlsAdopted, so it is
// looked at once: running again changes nothing, and a link taken off a proxy later is not put back.
// profileRotationUrls itself is never rewritten. A link that does not qualify stays as it was (exported,
// not used).
const ROTATION_LINKS_ADOPTED_SETTING = 'profileRotationUrlsAdopted';
let rotationLinksAdoptedThisRun = false;
async function adoptImportedRotationLinks() {
  if (rotationLinksAdoptedThisRun) return { attached: 0, skipped: 0 };
  const db = getPrisma();
  const links = (await readSetting('profileRotationUrls', {})) || {};
  const seen = await readSetting(ROTATION_LINKS_ADOPTED_SETTING, null);
  const done = seen && typeof seen === 'object' && seen.done && typeof seen.done === 'object' ? { ...seen.done } : {};
  const pending = Object.keys(links).filter((k) => /^\d+$/.test(k) && !Object.prototype.hasOwnProperty.call(done, k))
    .sort((a, b) => Number(a) - Number(b)); // oldest row first: of two rows on one proxy, the first wins
  let attached = 0;
  let skipped = 0;
  for (const key of pending) {
    let outcome = 'skipped';
    try {
      const url = importedRotationUrl(links[key]);
      const profile = url ? await db.profile.findUnique({ where: { id: Number(key) }, include: { proxy: true } }) : null;
      if (profile && proxyMadeForImportedRow(profile, profile.proxy) && await attachImportedRotationUrl(db, profile.proxy.id, url)) outcome = 'attached';
    } catch (e) {
      continue; // not recorded: looked at again at the next start
    }
    done[key] = outcome;
    if (outcome === 'attached') attached += 1; else skipped += 1;
  }
  if (attached + skipped > 0) await writeSetting(ROTATION_LINKS_ADOPTED_SETTING, { version: 1, done });
  rotationLinksAdoptedThisRun = true;
  if (attached) await logAudit('proxy.rotation-links-adopted', { detail: { attached, skipped } });
  return { attached, skipped };
}

// Streams the profile's cache + config into an AES-256-encrypted .sgz (see profileArchive.js).
// Failures surface a clean error instead of a half-written file.
async function exportProfileArchive(payload) {
  await requirePermission('profiles.export');
  const input = requireObject(payload);
  const id = parseId(input.id ?? input.profileId);
  // The archive holds every cookie and saved login, more than a cookie dump, so it needs the same
  // clearance: edit access (never a "use only" share) and the reveal rank.
  await assertCanAccessProfile(id, { requireEdit: true });
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

  // The archive's config is readable by whoever has its password, so its proxy address follows the
  // profile list: username and password only with proxies.reveal (a Manager or Admin can have it
  // turned off and still export archives).
  const revealProxy = await canRevealProxyCredentials();
  const config = {
    profile: {
      title: profile.title,
      dataDirName: profile.dataDirName,
      os: profile.os || null,
      userAgent: profile.userAgent || null,
      proxyInfoString: (revealProxy ? profile.proxyInfoString : maskProxyInfoString(profile.proxyInfoString, null, { maskUsername: true })) || null
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
  const reveal = proxyRevealAllowed();
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
    fontsList: profileOptions.parseFontList(profile.fontsList || []),
    mediaDeviceCounts: profileOptions.parseMediaCounts(profile.mediaDeviceCounts),
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
    // 'Custom' when the user picked this UA (applied at launch), 'Auto' when it was generated for display.
    userAgentMode: input.userAgentMode === undefined ? undefined : (input.userAgentMode === 'Custom' ? 'Custom' : 'Auto'),
    // Stored as newline-joined text. The editor sends that text as typed (kept as is); a list from an
    // API caller is joined the same way, each entry whole (an array here was a database error).
    startupUrls: Array.isArray(input.startupUrls) ? normalizeStartupUrls(input.startupUrls) : input.startupUrls,
    platformAccounts: input.platformAccounts ? JSON.stringify(input.platformAccounts) : null,
    // 2FA seed: undefined leaves it unchanged, '' clears it, otherwise the trimmed base32 secret is
    // sealed at rest and decrypted only to mint a live token.
    twoFactorSeed: input.twoFactorSeed === undefined ? undefined : (String(input.twoFactorSeed).trim() ? secretStore.seal(String(input.twoFactorSeed).trim()) : null),

    // The editor's words; the retired "Proxy UDP" (and other spellings) become the mode they launch as.
    webrtc: input.webrtc === undefined ? undefined : (profileOptions.parseWebrtc(input.webrtc) || input.webrtc),
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
    // Fonts > Custom: the fonts websites may see (JSON array); empty means this OS's standard set.
    fontsList: input.fontsList === undefined ? undefined : (() => {
      const list = profileOptions.parseFontList(input.fontsList);
      return list.length ? JSON.stringify(list) : null;
    })(),
    
    canvasNoise: input.canvasNoise !== false,
    webglImageNoise: input.webglImageNoise !== false,
    audioContextNoise: input.audioContextNoise !== false,
    clientRectsNoise: input.clientRectsNoise !== false,
    speechVoicesNoise: input.speechVoicesNoise !== false,
    mediaDevice: input.mediaDevice,
    // Media Device "Edit": how many microphones, speakers and cameras websites see (0-4 each).
    mediaDeviceCounts: input.mediaDeviceCounts === undefined ? undefined : JSON.stringify(profileOptions.parseMediaCounts(input.mediaDeviceCounts)),
    
    webglMetadata: input.webglMetadata,
    webglVendor: input.webglVendor,
    webglRenderer: input.webglRenderer,
    webgpu: input.webgpu,
    
    cpuType: input.cpuType,
    cpuCores: input.cpuCores,
    ramType: input.ramType,
    ramGb: input.ramGb,
    
    deviceNameType: input.deviceNameType,
    deviceName: input.deviceName === undefined ? undefined : (String(input.deviceName == null ? '' : input.deviceName).trim() || null),
    macAddressType: input.macAddressType,
    // Stored as AA:BB:CC:DD:EE:FF when it is a MAC at all (validation reports anything else).
    macAddress: input.macAddress === undefined ? undefined
      : (profileOptions.normalizeMac(input.macAddress) || (String(input.macAddress == null ? '' : input.macAddress).trim() || null)),
    
    // Stored as the editor's word: 'Open' / 'Close' / 'Default' (the API may send on/off, 1/0, true/false).
    doNotTrack: input.doNotTrack === undefined ? undefined : doNotTrackChoice(input.doNotTrack),
    portScanProtection: input.portScanProtection,
    // Default / On / Off (older words: Open = On, Close = Off).
    hardwareAcceleration: input.hardwareAcceleration === undefined ? undefined : profileOptions.hardwareAccelerationChoice(input.hardwareAcceleration),
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

// The proxy's credentials (type, host, port, username, password). With the owner it is the DB unique
// key (type, host, port, username, passwordHash, ownerMemberId): two members may each save the same
// proxy as their own row. Vendors carry sticky sessions in the password, so lines differing only
// there are distinct exits. extendClient rewrites `password` to passwordHash; explicit nulls match
// only rows without a username/password.
function proxyIdentityWhere(parsed) {
  return {
    type: parsed.type,
    host: parsed.host,
    port: parsed.port,
    username: parsed.username == null || parsed.username === '' ? null : String(parsed.username),
    password: parsed.password == null || parsed.password === '' ? null : String(parsed.password)
  };
}

// Who is adding proxies, read once: which existing rows count as theirs to reuse or skip as
// duplicates (`visible`, the same rule as scopedProxyWhere; undefined = every row), the owner to
// stamp, and the member's proxy limit (-1 = none). Read before a transaction: inside one, a query on
// the outer client blocks on SQLite's one connection.
async function proxyAddContext() {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return { visible: undefined, ownerId: ownerStampId(), max: -1 };
  const all = await getPrisma().member.findMany();
  const max = permissions.effectivePermissions(member).maxProxies;
  return {
    visible: { ownerMemberId: { in: [...permissions.visibleMemberIds(all, member)] } },
    ownerId: member.id,
    max: max == null ? -1 : Number(max)
  };
}

// assertWithinLimit('proxies') on the given client (a transaction's, too) and a context read before.
async function assertProxyQuota(db, ctx) {
  if (!ctx || ctx.max < 0 || ctx.ownerId == null) return;
  const used = await db.proxy.count({ where: { ownerMemberId: ctx.ownerId } });
  if (used >= ctx.max) throw limitError('proxy', ctx.max);
}

// A saved proxy with these credentials that the member may already use: their own row first, then
// one of their visible subtree. Never another member's row they cannot see (that row's profile titles
// would show in the other member's pool, and the member's own copy would skip their proxy limit).
async function findVisibleProxy(db, parsed, ctx) {
  const identity = proxyIdentityWhere(parsed);
  if (ctx.visible && ctx.ownerId != null) {
    const own = await db.proxy.findFirst({ where: { ...identity, ownerMemberId: ctx.ownerId } });
    if (own) return own;
  }
  return db.proxy.findFirst({ where: proxyScope.andWhere(identity, ctx.visible) });
}

async function findOrCreateProxy(db, proxyInput, nameFallback = null, typeHint = null, ctx = null) {
  const parsed = parseProxyInput(proxyInput);
  if (!parsed) return null;
  // An explicit "Proxy Type" column (HTTP/HTTPS/SOCKS5/SOCKS4) overrides the default. Both go through
  // parseProxyType, so the stored value is always one the ProxyType enum accepts (SOCKS4A -> SOCKS4,
  // SOCKS -> SOCKS5) instead of failing the database write.
  parsed.type = parseProxyType(typeHint || parsed.type);

  // Reuse a row only when every credential matches, so nothing is revealed or changed; a different
  // password is a different sticky session or account. Only a row the member may use is reused;
  // otherwise the member gets their own row, which counts against their proxy limit. `ctx` comes
  // from proxyAddContext(); a caller inside a transaction must pass it (see there).
  const add = ctx || await proxyAddContext();
  const existing = await findVisibleProxy(db, parsed, add);
  if (existing) return existing;
  await assertProxyQuota(db, add);

  return db.proxy.create({
    data: {
      name: nameFallback || `${parsed.type} ${parsed.host}:${parsed.port}`,
      type: parsed.type,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
      ownerMemberId: add.ownerId // stamp the creator so it stays visible in their scoped pool
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
  // scope: 'paid' (default), 'free' (the Free proxies page) or 'all' (pickers that show both).
  const scopeWhere = proxyScope.proxyScopeWhere(payload.scope);
  if (scopeWhere) clauses.push(scopeWhere);
  const where = clauses.length ? (clauses.length === 1 ? clauses[0] : { AND: clauses }) : undefined;

  // Names of the profiles directly assigned this proxy (so the pool shows which profiles use it, not
  // just a count). take:50 keeps the payload bounded. Only profiles the member can see are named or
  // counted: an Admin may put a member's proxy on a profile that member cannot see.
  const visibleProfiles = await scopedProfileWhere({});
  const proxies = await db.proxy.findMany({
    where: await scopedProxyWhere(where),
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { profiles: { where: visibleProfiles } } },
      profiles: { where: visibleProfiles, select: { title: true }, orderBy: { title: 'asc' }, take: 50 },
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

  // Same credentials, password included: a second sticky session on the same gateway user is a
  // different proxy, not a duplicate. Only a proxy the member can already use is a duplicate; the
  // same proxy in another member's pool (which this member cannot see) does not block their own.
  const add = await proxyAddContext();
  const existing = await findVisibleProxy(db, parsed, add);
  if (existing) throw new Error('This proxy (same type, host, port, username and password) already exists.');

  const created = await db.proxy.create({
    data: {
      name: requiredString(input.name || `${parsed.type} ${parsed.host}:${parsed.port}`, 'Proxy name'),
      type: parsed.type,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
      ownerMemberId: add.ownerId
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
  // The pool shows a member without proxies.reveal the username as a mask, and the edit dialog sends it
  // back: a mask keeps the stored value, as for the password.
  if (input.username !== undefined && input.username !== SECRET_MASK) data.username = optionalString(input.username);
  if (input.password !== undefined && input.password !== SECRET_MASK) data.password = optionalString(input.password);
  await assertHiddenCredentialsStayWithHost(id, data);

  const updated = await db.proxy.update({ where: { id }, data });
  return serializeProxy(updated);
}

// A member who may not see proxy credentials (no proxies.reveal) edits a proxy whose username or
// password they were shown as a mask: the stored values stay with their host. Moving them to another
// host would send them to a server the member chose, where they could read them. Retyping both
// credentials (or clearing them) is fine.
async function assertHiddenCredentialsStayWithHost(id, data) {
  if (data.host === undefined || await canRevealProxyCredentials()) return;
  const cur = await getPrisma().proxy.findUnique({ where: { id }, select: { host: true, username: true, password: true } });
  if (!cur || String(cur.host || '').trim().toLowerCase() === String(data.host).trim().toLowerCase()) return;
  const keepsUser = Boolean(cur.username) && data.username === undefined;
  const keepsPass = Boolean(cur.password) && data.password === undefined;
  if (keepsUser || keepsPass) {
    const e = new Error('The proxy username and password are hidden for your account, so they stay with their host. To use another host, type the username and password again.');
    e.code = 'FORBIDDEN';
    throw e;
  }
}

async function deleteProxy(payload) {
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProxy(id);
  const profilesNeedProxy = await detachProfilesFromProxies(db, [id]);
  await db.proxy.delete({ where: { id } });
  await logAudit('proxy.delete', { detail: { proxyId: id, profilesNeedProxy } });
  const removedGroups = await pruneEmptyAutoGroups(db);
  return { deleted: true, id, removedGroups, profilesNeedProxy };
}

// Removes auto-created groups left empty; a group a person made stays, even empty.
async function pruneEmptyAutoGroups(db) {
  const res = await db.proxyGroup.deleteMany({ where: { autoCreated: true, proxies: { none: {} } } });
  return res.count;
}

// Before proxies are deleted: their profiles lose the proxy AND its cached address (proxyInfoString),
// which launch used to fall back to, so a profile never opens on a deleted proxy. They keep "Profile
// proxy", so they do not quietly open on the real IP either: launch refuses them ("proxy missing")
// until a proxy is assigned or the profile is set to no proxy (assertProfileHasLaunchProxy). Returns
// how many profiles (not in Trash) now need a proxy.
async function detachProfilesFromProxies(db, proxyIds) {
  if (!proxyIds.length) return 0;
  const users = await db.profile.findMany({ where: { proxyId: { in: proxyIds } }, select: { id: true, systemProxyBehavior: true, deletedAt: true } });
  if (!users.length) return 0;
  await db.profile.updateMany({ where: { id: { in: users.map((u) => u.id) } }, data: { proxyId: null, proxyInfoString: null } });
  for (const u of users) await logActivity(db, u.id, 'proxy-reassign', 'proxy deleted; assign a proxy before launching').catch(() => {});
  return users.filter((u) => u.systemProxyBehavior === 'PROFILE_PROXY' && u.deletedAt == null).length;
}

async function bulkDeleteProxies(payload) {
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const ids = Array.isArray(input.ids) ? input.ids.map((value) => parseId(value)) : [];
  if (ids.length === 0) throw new Error('No proxies selected.');
  const { allowed, denied } = await partitionAccessibleProxyIds(ids);
  if (allowed.length === 0) { const e = new Error('You do not have access to the selected proxies.'); e.code = 'FORBIDDEN'; throw e; }
  const profilesNeedProxy = await detachProfilesFromProxies(getPrisma(), allowed);
  const result = await getPrisma().proxy.deleteMany({ where: { id: { in: allowed } } });
  await logAudit('proxy.delete', { detail: { count: result.count, proxyIds: allowed, bulk: true, profilesNeedProxy } });
  const removedGroups = await pruneEmptyAutoGroups(getPrisma());
  return { deleted: result.count, ids: allowed, denied, removedGroups, profilesNeedProxy };
}

// ---- Copy for SoftGlaze Proxy (the browser extension's Bulk import) ----
// Usernames and passwords follow the rule used everywhere else for proxy credentials:
// `proxies.reveal` (Manager and up, unless revoked for the member; single-user mode is the owner).
// The renderer never receives them: the main process writes the clipboard itself and returns counts.
// The clipboard is cleared after 2 minutes if it still holds the list (proxyExtensionExport.js).
let proxyExtensionClipboard = null;
function extensionClipboard() {
  if (!proxyExtensionClipboard) {
    proxyExtensionClipboard = proxyExtensionExport.createClipboardGuard({ clipboard: require('electron').clipboard });
  }
  return proxyExtensionClipboard;
}

async function canRevealProxyCredentials() {
  try { await requirePermission('proxies.reveal'); return true; } catch (e) { return false; }
}

// The selected proxies this member may see, oldest first. Throws when none.
async function extensionCopyRows(input) {
  const ids = parseIdArray(input.ids);
  const { allowed } = await partitionAccessibleProxyIds(ids);
  if (allowed.length === 0) { const e = new Error('You do not have access to the selected proxies.'); e.code = 'FORBIDDEN'; throw e; }
  return getPrisma().proxy.findMany({ where: { id: { in: allowed } }, orderBy: { createdAt: 'asc' } });
}

// { ids } -> { count, skipped, withLogin, socks5WithLogin, socks4WithLogin, canIncludeCredentials }
async function getProxyExtensionCopyInfo(payload) {
  const input = requireObject(payload);
  const rows = await extensionCopyRows(input);
  return { ...proxyExtensionExport.summarize(rows), canIncludeCredentials: await canRevealProxyCredentials() };
}

// { ids, includeCredentials } -> { copied, skipped, includedCredentials, socks4LoginLeftOut, clearAfterSeconds }
async function copyProxiesForExtension(payload) {
  const input = requireObject(payload);
  const includeCredentials = input.includeCredentials === true;
  if (includeCredentials) {
    // Checked before any proxy row is read.
    try {
      await requirePermission('proxies.reveal');
    } catch (e) {
      const err = new Error('Your role cannot copy proxy usernames and passwords. Ask an owner or admin.');
      err.code = 'FORBIDDEN';
      throw err;
    }
  }
  const rows = await extensionCopyRows(input);
  const out = proxyExtensionExport.buildExtensionExport(rows, { includeCredentials });
  if (out.count === 0) throw new Error('None of the selected proxies can be copied: their type, address or port is not one the extension reads.');
  const { clearAfterMs } = extensionClipboard().write(out.text);
  // The count and whether logins went along; never hosts, usernames or passwords.
  await logAudit('proxy.copied_for_extension', { detail: { count: out.count, credentials: includeCredentials } });
  return {
    copied: out.count,
    skipped: out.skipped,
    includedCredentials: includeCredentials,
    socks4LoginLeftOut: out.socks4LoginLeftOut,
    clearAfterSeconds: Math.round(clearAfterMs / 1000)
  };
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
  // Free public proxies never join a rotation pool.
  const proxies = (await getPrisma().proxy.findMany({
    where: await scopedProxyWhere(proxyScope.proxyScopeWhere('paid')),
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
  // The pool decides which proxy the profile opens on, so it needs edit access, as changing the
  // profile's own proxy does (updateProfile).
  await assertCanAccessProfile(id, { requireEdit: true });
  const enabled = Boolean(input.enabled);
  const mode = input.mode === 'random' ? 'random' : 'round-robin';
  const proxyIds = Array.isArray(input.proxyIds) ? input.proxyIds.map((v) => parseId(v)) : [];
  if (enabled && proxyIds.length === 0) throw new Error('Select at least one proxy for the rotation pool.');
  // Only allow proxies the caller can actually access into the rotation pool (no binding a
  // profile to another member's proxies).
  if (proxyIds.length) {
    const accessible = await getPrisma().proxy.findMany({
      where: await scopedProxyWhere({ id: { in: proxyIds } }), select: { id: true, provider: true }
    });
    const okSet = new Set(accessible.map((p) => p.id));
    if (proxyIds.some((pid) => !okSet.has(pid))) throw new Error('One or more selected proxies are not accessible to you.');
    if (accessible.some((p) => proxyScope.isFreeProxy(p))) throw new Error('Free proxies cannot join a rotation pool.');
  }
  // A pool on a profile with no proxy of its own opened on the real IP whenever the pool was skipped
  // (the Sticky policy never rotates). As the editor does, the first pool proxy becomes the profile's
  // own proxy, so the profile is never left DIRECT behind an enabled pool.
  let assignedProxy = null;
  if (enabled) {
    const db = getPrisma();
    const profile = await db.profile.findUnique({ where: { id }, select: { proxyId: true, systemProxyBehavior: true } });
    if (!profile) throw new Error('Profile not found.');
    if (profile.proxyId == null || profile.systemProxyBehavior !== 'PROFILE_PROXY') {
      const first = await db.proxy.findUnique({ where: { id: proxyIds[0] } });
      if (!first) throw new Error('Selected proxy does not exist.');
      await db.profile.update({ where: { id }, data: { proxyId: first.id, proxyInfoString: buildProxyInfoString(first), systemProxyBehavior: 'PROFILE_PROXY' } });
      const label = first.name || `${first.host}:${first.port}`;
      await logActivity(db, id, 'proxy-reassign', `proxy → ${label} (first proxy of its rotation pool)`);
      assignedProxy = { id: first.id, name: label };
    }
  }
  const all = (await readSetting('proxyRotation', {})) || {};
  all[id] = { enabled, mode, proxyIds };
  await writeSetting('proxyRotation', all);
  return { profileId: id, enabled, mode, proxyIds, assignedProxy };
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

// The workspace default (and the failover / latency settings) decide how every member's pooled
// profiles launch, so they need proxies.manage AND the Owner or an Admin. A per-profile override is
// part of that profile's proxy setup: proxies.manage and edit access to the profile, as the row's
// Proxy Rotation dialog needs (setProxyRotation).
async function setProxyPolicy(payload) {
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  if (input.default !== undefined || input.failoverMaxLatencyMs !== undefined || input.latencyTopN !== undefined) {
    await requireWorkspaceProxySettings('rotation policy');
  }
  if (input.profileId !== undefined && input.profileId !== null) {
    await assertCanAccessProfile(parseId(input.profileId), { requireEdit: true });
  }
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
  return getProxyPolicyForActor();
}

// The policy as the window sees it: the per-profile overrides only of profiles the member can see (Trash
// included), so other members' profile ids and modes stay in main. Launch reads the whole map
// (resolveProxyPolicyMode). Single-user mode and the Super Admin see every override.
async function getProxyPolicyForActor() {
  const cfg = await getProxyPolicy();
  const ids = Object.keys(cfg.byProfile).map((k) => Number(k)).filter((n) => Number.isInteger(n) && n > 0);
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return cfg;
  const seen = ids.length
    ? await getPrisma().profile.findMany({ where: await scopedProfileWhere({ id: { in: ids } }), select: { id: true } })
    : [];
  const keep = new Set(seen.map((r) => String(r.id)));
  const byProfile = {};
  for (const [k, mode] of Object.entries(cfg.byProfile)) if (keep.has(String(Number(k)))) byProfile[k] = mode;
  return { ...cfg, byProfile };
}

// Workspace-wide proxy settings (the default rotation policy, the health-check schedule): the Owner
// or an Admin. Single-user mode and the Super Admin pass. Call after requirePermission, which already
// refuses a suspended or banned member and a revoked proxies.manage.
async function requireWorkspaceProxySettings(what) {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return;
  if (permissions.rankOf(member.role) < permissions.ROLE_RANK.ADMIN) {
    const e = new Error(`Your role does not permit this action: only the Owner or an Admin can change the workspace ${what}.`);
    e.code = 'FORBIDDEN';
    throw e;
  }
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
  if (policy === 'sticky') {
    const own = await db.profile.findUnique({ where: { id: profileId }, select: { proxyId: true, systemProxyBehavior: true } });
    if (!own || (own.proxyId != null && own.systemProxyBehavior === 'PROFILE_PROXY')) return null;
  }

  const all = (await readSetting('proxyRotation', {})) || {};
  const cfg = all[profileId];
  if (!cfg || !cfg.enabled || !Array.isArray(cfg.proxyIds) || cfg.proxyIds.length === 0) return null;

  const rows = await db.proxy.findMany({ where: proxyScope.withProxyScope({ id: { in: cfg.proxyIds } }, 'paid') });
  // Preserve the configured order for stable round-robin; drop deleted (and free) ids.
  let ordered = cfg.proxyIds.map((pid) => rows.find((p) => p.id === pid)).filter(Boolean);
  if (ordered.length === 0) return null;

  // Sticky with no proxy of its own (a pool turned on before 1.0.26, or the profile's proxy was
  // cleared later): keep the first pool proxy fixed rather than open on the real IP.
  if (policy === 'sticky') return ordered[0];

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
  // Batch Add's optional Provider: a key of PROXY_VENDORS (a connector, or ARNPROXY's manual list), so
  // the rows group and count under that provider like pulled ones. Anything else is refused.
  const provider = input.provider == null || String(input.provider).trim() === '' ? null : String(input.provider).trim().toLowerCase();
  if (provider && !Object.prototype.hasOwnProperty.call(PROXY_VENDORS, provider)) throw new Error('Unknown proxy provider.');
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result = { total: lines.length, created: [], skipped: [], errors: [] };
  const add = await proxyAddContext();

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
      // Password included: N sticky-session lines on one gateway user are N proxies. Only a proxy
      // this member can already use is a duplicate (and returned); another member's is never shown.
      const existing = await findVisibleProxy(db, parsed, add);

      if (existing) {
        result.skipped.push({ line: index + 1, reason: 'DUPLICATE', proxy: serializeProxy(existing) });
        continue;
      }

      const created = await db.proxy.create({
        data: {
          // A provider's name labels the row like a pulled one ("ARNPROXY • host:port").
          name: namePrefix ? `${namePrefix} • ${parsed.host}:${parsed.port}` : `${parsed.type} ${parsed.host}:${parsed.port}`,
          type: parsed.type,
          host: parsed.host,
          port: parsed.port,
          username: parsed.username,
          password: parsed.password,
          // Vendor tag for auto-grouping, from the batch's declared provider.
          provider,
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

  // Free proxies already in the member's pool are not re-tested or re-added (another member's free
  // proxies do not count: this member cannot see or use them).
  const add = await proxyAddContext();
  const have = await db.proxy.findMany({ where: proxyScope.andWhere({ provider: 'free' }, add.visible), select: { type: true, host: true, port: true } });
  const exclude = new Set(have.map(freeProxyKey));

  const controller = new AbortController();
  freeHarvestRun = { controller, ownerMemberId: actingMemberId() };
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
    // Plain-HTTP echo through an HTTP proxy (the anonymity check). /get, not /headers: httpbin leaves
    // X-Forwarded-For, Via and X-Real-Ip out of its header list (ENV_HEADERS in httpbin's helpers.py)
    // and reports the X-Forwarded-For chain only in `origin`, where a leaked real IP shows up.
    judgeEcho: async (c) => {
      const agent = buildProxyAgent({ type: 'HTTP', host: c.host, port: c.port });
      const d = await httpGetJson('http://httpbin.org/get', agent, 8000);
      if (!d || !d.headers || typeof d.origin !== 'string') throw new Error('no echo');
      return { headers: d.headers, origin: d.origin };
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
        const dup = await findVisibleProxy(db, { type, host: f.host, port: f.port, username: null, password: null }, add);
        if (dup) continue;
        const created = await db.proxy.create({
          data: {
            name: `Free ${f.country || '??'} ${f.host}:${f.port}`,
            type, host: f.host, port: f.port, username: null, password: null,
            provider: 'free', proxyGroupId: group ? group.id : null, ownerMemberId: add.ownerId,
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
  // smartproxy is Decodo's old name; the key stays because stored rows and settings use it.
  ipfoxy: 'IPFoxy', brightdata: 'Bright Data', oxylabs: 'Oxylabs', smartproxy: 'Decodo',
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
  proxy6: 'PROXY6',
  proxybrazil: 'ProxyBrazil',
  proxyudp: 'ProxyUDP',
  zokol: 'Zokol',
  resiprox: 'ResiProx',
  simplynode: 'SimplyNode',
  node4: 'Node4',
  proxyempire: 'ProxyEmpire',
  mountproxies: 'MountProxies',
  massive: 'Massive',
  iproxy: 'iProxy.online',
  // No connector yet: its proxies are added with Batch Add's Provider tag, so the pool and the Proxy
  // providers page group and count them (syncVendorPool refuses a pull).
  arnproxy: 'ARNPROXY'
});

// Gateways for adapters that build a URL from this table. Add a host only if the vendor documents it
// and it resolves in DNS.
const VENDOR_GATEWAYS = Object.freeze({
  oxylabs: { host: 'pr.oxylabs.io', port: 7777, type: 'HTTP' },
  // Smartproxy is now Decodo; its docs name gate.decodo.com (HTTP and SOCKS5 on 7000).
  smartproxy: { host: 'gate.decodo.com', port: 7000, type: 'HTTP' },
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
          // Retry-After and a request id ride along for the adapters that show or log them.
          const header = (name) => { const v = res.headers && res.headers[name]; return typeof v === 'string' ? v.slice(0, 80) : undefined; };
          return finish(reject, Object.assign(new Error(`HTTP ${status} ${buf.toString('utf8').slice(0, 200).trim() || res.statusMessage || ''}`.trim()), { status, retryAfter: header('retry-after'), requestId: header('x-request-id') }));
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

const {
  ipRoyalMaxCount, ipRoyalCountRefused, ipRoyalLifetimeFromMinutes, oxylabsBaseUser, oxylabsUsername, decodoBaseUser, decodoUsername,
  brightDataZoneUser, brightDataUsername, brightDataRouteIps, brightDataState, apifyUsername, anyIpPlace,
  shopSocks5Request, PROXY_SELLER_PAGE_SIZE, proxySellerPageInfo,
  froxyPastedPool, LIVEPROXIES_SID_MAX
} = require('./proxyVendorUtils');

// ---- Session gateways: Bright Data, Oxylabs, Smartproxy (Decodo) ----
// Each username carries the targeting and, for a sticky row, its own session ID (one ID, one exit
// IP). A sticky pull mints `count` rows; a rotating pull is one row whose IP changes per request.
// The first row is proven with a live request, so a wrong login fails the pull instead of filling
// the pool with rows that can never connect.
async function mintVerifiedGatewayRows(label, gateway, { sticky, count, password, socks, country, place, build }) {
  const n = sticky ? clampPoolCount(count, 5, MINTED_PULL_MAX) : 1;
  const type = socks ? 'SOCKS5' : gateway.type;
  const where = [country || 'Global', place].filter(Boolean).join(' ');
  const rows = [];
  for (let i = 1; i <= n; i += 1) {
    const sid = sticky ? randSession(10) : '';
    rows.push({
      type, host: gateway.host, port: gateway.port,
      username: build(sid), password,
      label: `${label} • ${where} • ${sticky ? `sticky ${sid}` : 'rotating gateway'}`,
      country: country || null
    });
  }
  const probe = await testProxyConnectivity(rows[0]);
  if (!probe.success) throw new Error(`${label} credential check failed: ${probe.error || 'could not authenticate against the gateway.'}`);
  if (probe.ip) rows[0].label += ` • verified ${probe.ip}`;
  return rows;
}

// Host : Port from the form. Blank keeps the vendor's documented gateway; only a bare hostname and a
// valid port pass (the rule gatewayOverride uses), so a pasted URL or credential never becomes a host.
function apiSyncGateway(def, host, port, label) {
  const h = String(host || '').trim();
  const p = port != null && String(port).trim() !== '' ? Number.parseInt(String(port), 10) : def.port;
  if (h && !/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(h)) throw new Error(`${label}: the gateway host must be a hostname like ${def.host}, without http:// or a port.`);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`${label}: the gateway port must be a number from 1 to 65535.`);
  return { ...def, host: h || def.host, port: p };
}

// State and city need the country their docs pair them with; say so instead of sending a username
// the gateway would reject or quietly widen.
function gatewayGeo(label, { country, state, city, stateNeedsUs = true }) {
  const cc = normCountryCode(country);
  const st = String(state || '').trim();
  const ct = String(city || '').trim();
  if (ct && !cc) throw new Error(`${label}: pick a country to target a city.`);
  if (st && !ct && stateNeedsUs && cc !== 'US') throw new Error(`${label}: state targeting covers US states only, so pick United States.`);
  if (st && !ct && cc && cc !== 'US') throw new Error(`${label}: state targeting covers US states only.`);
  return { cc, st, ct, place: ct || st };
}

// ---- Bright Data ----
// brd.superproxy.io:44445 is the port in every current docs example. Three ways to pull:
//  zone: GET /zone/route_ips lists a zone's dedicated datacenter or ISP IPs (no paging); each is
//        pinned with `-ip-<ip>`, which the docs allow only for zones with dedicated IPs.
//  sticky / rotating: minted usernames with -country-, -state- (a US state's two-letter code, such
//  as -state-ny), -city- and -session-.
// Host : Port in the form overrides the gateway for every mode (an older port, for one).
const BRIGHTDATA_GATEWAY = Object.freeze({ host: 'brd.superproxy.io', port: 44445, type: 'HTTP' });
const BRIGHTDATA_ZONE_MAX = 5000;

async function fetchBrightDataPool({ token, username, password, zone, poolType, country, state, city, count, host, port }) {
  const mode = String(poolType || '').toLowerCase();
  const zoneUser = brightDataZoneUser(username);
  const pw = String(password || '');
  const gw = apiSyncGateway(BRIGHTDATA_GATEWAY, host, port, 'Bright Data');
  if (mode === 'sticky' || mode === 'rotating') {
    if (!zoneUser) throw new Error('Bright Data: enter the proxy username from the zone (brd-customer-<id>-zone-<name>).');
    if (!pw) throw new Error('Bright Data: enter the zone password.');
    const geo = gatewayGeo('Bright Data', { country, state, city });
    if (geo.st && !geo.ct && !brightDataState(geo.st)) throw new Error('Bright Data: enter the US state as its two-letter code, for example NY for New York.');
    return mintVerifiedGatewayRows(`Bright Data • ${zoneUser.zone}`, gw, {
      sticky: mode === 'sticky', count, password: pw, country: geo.cc, place: geo.place,
      build: (sid) => brightDataUsername(zoneUser.base, { country: geo.cc, state: geo.st, city: geo.ct, session: sid })
    });
  }

  const apiToken = String(token || '').trim();
  if (!apiToken) throw new Error('Bright Data API token is required to sync.');
  const z = String(zone || '').trim() || (zoneUser ? zoneUser.zone : '');
  if (!z) throw new Error('Bright Data zone is required (provide it, or use a username like brd-customer-<id>-zone-<zone>).');

  const qs = new URLSearchParams({ zone: z, list_countries: 'true' });
  const cc = normCountryCode(country);
  if (cc) qs.set('country', cc.toLowerCase());
  let text;
  try {
    text = await httpRequestText(`https://api.brightdata.com/zone/route_ips?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      maxBytes: 8_000_000
    });
  } catch (e) {
    throw new Error(`Bright Data API error: ${e.message}`);
  }

  const ips = brightDataRouteIps(text);
  if (!ips.length) {
    throw new Error(cc
      ? `Bright Data returned no routable IPs in ${cc} for this zone. Try Any country, or use Sticky sessions for a residential zone.`
      : 'Bright Data returned no routable IPs for this zone. A residential zone has none to list: use Sticky sessions instead.');
  }

  // A pinned IP needs the full brd-customer-<id>-zone-<zone> login; without the customer id
  // every row would be refused, so stop here instead of storing dead proxies.
  if (!zoneUser) throw new Error('Bright Data: enter the proxy username from the zone (brd-customer-<id>-zone-<name>) as well as the API token.');
  return ips.slice(0, BRIGHTDATA_ZONE_MAX).map(({ ip, country: ipCc }) => ({
    type: gw.type, host: gw.host, port: gw.port,
    username: `${zoneUser.base}-ip-${ip}`, password: pw,
    label: `Bright Data • ${z} • ${ipCc ? `${ipCc} • ` : ''}${ip}`,
    country: ipCc || cc || null
  }));
}

// ---- Oxylabs residential ----
// pr.oxylabs.io:7777 serves HTTP, HTTPS and SOCKS5. The username needs the customer- prefix; cc,
// city (with cc) or st (US), and sessid with sesstime (up to 1440 minutes) follow it.
// IPv6 is `-ipversion-6`: a host without AAAA silently falls back to IPv4 (522 if that fallback is
// disabled), and the account may need the feature enabled first. Host : Port overrides the gateway.
async function fetchOxylabsPool({ username, password, ipVersion, poolType, country, state, city, count, life, proxyType, host, port } = {}) {
  const base = oxylabsBaseUser(username);
  if (!base) throw new Error('Oxylabs: a proxy username is required to sync.');
  const gw = apiSyncGateway(VENDOR_GATEWAYS.oxylabs, host, port, 'Oxylabs');
  const want6 = String(ipVersion || '') === '6';
  const user = want6 && !/-ipversion-\d/.test(base) ? `${base}-ipversion-6` : base;
  const geo = gatewayGeo('Oxylabs', { country, state, city, stateNeedsUs: false });
  return mintVerifiedGatewayRows(want6 ? 'Oxylabs IPv6' : 'Oxylabs', gw, {
    sticky: String(poolType || '').toLowerCase() === 'sticky', count, password: String(password || ''),
    socks: String(proxyType || '').toLowerCase() === 'socks5', country: geo.cc || (geo.st ? 'US' : ''), place: geo.place,
    build: (sid) => oxylabsUsername(user, { country: geo.cc, state: geo.st, city: geo.ct, session: sid, minutes: life })
  });
}

// ---- Decodo (formerly Smartproxy; the provider key stays smartproxy) ----
// gate.decodo.com:7000 serves HTTP and SOCKS5 (country endpoints do not take SOCKS5, so the
// targeting rides in the username). The username needs the user- prefix; country, city or a US
// state, and session with sessionduration (1 to 1440 minutes) follow it. Host : Port overrides the
// gateway.
async function fetchSmartproxyPool({ username, password, poolType, country, state, city, count, life, proxyType, host, port } = {}) {
  const base = decodoBaseUser(username);
  if (!base) throw new Error('Decodo: a proxy username is required to sync.');
  const gw = apiSyncGateway(VENDOR_GATEWAYS.smartproxy, host, port, 'Decodo');
  const geo = gatewayGeo('Decodo', { country, state, city });
  return mintVerifiedGatewayRows('Decodo', gw, {
    sticky: String(poolType || '').toLowerCase() === 'sticky', count, password: String(password || ''),
    socks: String(proxyType || '').toLowerCase() === 'socks5', country: geo.cc, place: geo.place,
    build: (sid) => decodoUsername(base, { country: geo.cc, state: geo.st, city: geo.ct, session: sid, minutes: life })
  });
}

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
// Proxies a list API reports as already owned (dedicated, static or ported lists).
const LIST_IMPORT_MAX = 5000;

function clampPoolCount(value, def = 5, max = 500) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

// What a gateway pull makes, for every connector with Keep same IP and a session name. One proxy with
// no session name and Keep same IP blank ("Different IP each time") is one rotating proxy: a new IP on
// every request. A session name, a Keep same IP time, or How many above 1 makes sticky proxies, one
// session each, because several rotating rows would be the same login. With Keep same IP blank they
// keep the IP for the vendor's default time, and the form says so instead of "Different IP each time"
// (src/renderer/lib/gatewayPull.mjs mirrors this rule).
function gatewayPullPlan({ session, count, life } = {}) {
  const name = String(session == null ? '' : session).trim();
  const minutes = Number.parseInt(String(life == null ? '' : life), 10);
  const lifeSet = Number.isFinite(minutes) && minutes > 0;
  const many = clampPoolCount(count, 1, MINTED_PULL_MAX) > 1;
  return { sticky: Boolean(name || lifeSet || many), session: name, lifeSet };
}

// ---- Apify Residential ----
// One HTTP gateway (proxy.apify.com:8000); the username picks pool (groups-RESIDENTIAL), country
// (country-XX, or country-US_CA for a US state) and stickiness (session-<id>, about 30 minutes on
// residential). No list to pull, so `count` sessions are minted.
async function fetchApifyPool({ password, country, state, count }) {
  const pw = String(password || '').trim();
  if (!pw) throw new Error('Apify: your proxy password is required (Apify Console → Proxy → HTTP settings → password).');
  const cc = normCountryCode(country);
  const st = String(state || '').trim();
  if (st && cc !== 'US') throw new Error('Apify: state targeting covers US states only, so pick United States.');
  if (st && !/^[A-Za-z]{2}$/.test(st)) throw new Error('Apify: enter the US state as its two-letter code, for example CA for California.');
  const gw = VENDOR_GATEWAYS.apify;
  const n = clampPoolCount(count, 5, MINTED_PULL_MAX);
  const where = [cc || 'Global', st.toUpperCase()].filter(Boolean).join(' ');
  const rows = [];
  for (let i = 1; i <= n; i += 1) {
    rows.push({
      type: gw.type, host: gw.host, port: gw.port,
      username: apifyUsername({ country: cc, state: st, session: randSession() }), password: pw,
      label: `Apify • ${where} • #${i}`, country: cc || null
    });
  }
  return rows;
}

// anyip.io: one gateway (portal.anyip.io:1080, overridable); flags go in the username, comma-separated:
// user_X,type_residential,country_US,region_texas,city_dallas,sesstime_60,session_ab12. A city needs a
// region and a region needs a country. A fixed session pins one IP. HTTP and SOCKS5 share the port.
// Creds are pasted (the API key is not the proxy password) or provisioned via API key + Team ID.

// The API lives on dashboard.anyip.io (the old api. host no longer resolves). The docs give
// POST /api/v1/teams/{team_id}/proxy_accounts with an Api-Key header and an optional password
// (6+ letters, digits or _); the server still answers the older /api/teams/{team_id}/proxy_accounts,
// so that is the fallback when the v1 route is not there.
const ANYIP_API = 'https://dashboard.anyip.io';
async function anyipProvisionAccount(apiKey, teamId) {
  const key = String(apiKey || '').trim();
  const team = String(teamId || '').trim();
  if (!key) throw new Error('AnyIP: an API key is required to auto-provision a proxy account.');
  if (!team) throw new Error('AnyIP: your Team ID is required for API provisioning (anyip dashboard → Team / Settings, or the dashboard URL).');
  const nodeCrypto = require('node:crypto');
  const suffix = nodeCrypto.randomBytes(4).toString('hex');
  const genUser = `sg${suffix}`;                                   // >= 6 chars, alnum
  const plainPassword = ('sg' + nodeCrypto.randomBytes(6).toString('hex')).slice(0, 16); // >= 6 alnum
  // password is the documented field; username and plain_password are what the older route took.
  const body = JSON.stringify({ username: genUser, password: plainPassword, plain_password: plainPassword, description: 'SoftGlaze auto-provisioned', enabled: true });
  const post = (route) => httpRequestText(`${ANYIP_API}${route}`, {
    method: 'POST',
    headers: { 'Api-Key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
    timeoutMs: 20000
  });
  const teamPath = encodeURIComponent(team);
  let text;
  try {
    try {
      text = await post(`/api/v1/teams/${teamPath}/proxy_accounts`);
    } catch (e) {
      if (!e || e.status !== 404) throw e;
      text = await post(`/api/teams/${teamPath}/proxy_accounts`);
    }
  } catch (e) {
    throw new Error(`AnyIP provisioning failed: ${scrubProxySecrets(e.message, { password: plainPassword })} - verify the API key and Team ID (dashboard → Settings).`);
  }
  // The password is the one sent; the username is assigned by the server, so prefer its answer.
  let acct = null;
  try { acct = JSON.parse(text); } catch (e) { acct = null; }
  const finalUser = (acct && typeof acct.username === 'string' && acct.username) ? acct.username : genUser;
  const finalPassword = (acct && typeof acct.password === 'string' && acct.password) ? acct.password : plainPassword;
  return { username: finalUser, password: finalPassword };
}

// AnyIP caps proxy users per plan (Micro 2, Basic 5, Pro 10) and cannot delete them, so the account an
// API key + Team ID provisions is kept and every later pull with the same key and team reuses it
// instead of creating another. The setting is keyed by a keyed hash of the team and key
// (proxySecrets.hashPassword), so it never holds the key, and the password is sealed like the other
// saved provider secrets. Main-only: neither is sent to the window. If saving fails, the account is
// still remembered for this run.
const ANYIP_PROVISIONED_SETTING = 'anyipProvisionedAccounts';
const anyipProvisionedMemo = new Map();
const anyipProvisioning = new Map();
async function anyipReuseOrProvision(apiKey, teamId) {
  const key = String(apiKey || '').trim();
  const team = String(teamId || '').trim();
  // A missing key or team gets anyipProvisionAccount's own message.
  if (!key || !team) return anyipProvisionAccount(key, team);
  const id = await proxySecrets.hashPassword(getPrisma(), `anyip\u0000${team}\u0000${key}`);
  if (anyipProvisionedMemo.has(id)) return { ...anyipProvisionedMemo.get(id), reused: true };
  const map = await readSetting(ANYIP_PROVISIONED_SETTING, {});
  const saved = map && typeof map === 'object' ? map[id] : null;
  const savedPw = saved && saved.username && saved.password ? secretStore.open(saved.password) : '';
  if (savedPw) {
    const acct = { username: String(saved.username), password: savedPw };
    anyipProvisionedMemo.set(id, acct);
    return { ...acct, reused: true };
  }
  // Two pulls started together make one account.
  if (anyipProvisioning.has(id)) return anyipProvisioning.get(id);
  const job = (async () => {
    const acct = await anyipProvisionAccount(key, team);
    anyipProvisionedMemo.set(id, acct);
    try {
      const now = await readSetting(ANYIP_PROVISIONED_SETTING, {});
      const next = now && typeof now === 'object' && !Array.isArray(now) ? now : {};
      next[id] = { username: acct.username, password: secretStore.seal(acct.password), createdAt: new Date().toISOString() };
      await writeSetting(ANYIP_PROVISIONED_SETTING, next);
    } catch (e) { /* kept in anyipProvisionedMemo for this run */ }
    return { ...acct, reused: false };
  })();
  anyipProvisioning.set(id, job);
  try { return await job; } finally { anyipProvisioning.delete(id); }
}

async function fetchAnyIpPool({ username, password, country, state, city, session, count, host, port, life, poolType, proxyType, token, teamId }) {
  let user = String(username || '').trim();
  let pw = String(password || '');
  // Auto-provision: no direct creds, but an API key and Team ID were supplied. The first such pull
  // creates one proxy account; later pulls with the same key and team reuse it.
  if ((!user || !pw) && String(token || '').trim() && String(teamId || '').trim()) {
    const prov = await anyipReuseOrProvision(token, teamId);
    user = prov.username;
    pw = prov.password;
  }
  if (!user) throw new Error('AnyIP: enter your proxy Username (user_…) + Password from the dashboard, or an API key + Team ID to auto-provision.');
  if (!pw) throw new Error('AnyIP: a proxy password is required (or supply an API key + Team ID to auto-provision one).');
  const cc = normCountryCode(country);
  const region = anyIpPlace(state);
  const town = anyIpPlace(city);
  if (region && !cc) throw new Error('AnyIP: pick a country to target a state or region.');
  if (town && !region) throw new Error('AnyIP: a city needs its state or region as well (for example Texas and Dallas).');
  // Default to the documented gateway; honor an explicit override (custom port).
  const gwHost = String(host || '').trim() || 'portal.anyip.io';
  const gwPort = Number.parseInt(String(port), 10) || 1080;
  const rowType = String(proxyType || '').toLowerCase() === 'socks5' ? 'SOCKS5' : 'HTTP';
  // Session names are 1 to 32 letters or digits.
  const fixedSession = String(session || '').trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  // sesstime = minutes to keep the exit IP (1..10080). Blank keeps AnyIP's own default for a
  // session, 7 days. The UI tops out at 1440, but the full range is accepted.
  const lifeMin = Math.min(10080, Math.max(0, Number.parseInt(String(life), 10) || 0));
  const ptype = String(poolType || '').toLowerCase() === 'mobile' ? 'mobile' : 'residential';
  // gatewayPullPlan: one row with no session name and Keep same IP blank is AnyIP's rotating login (no
  // session_ flag, a new IP per request). Otherwise each row has its own session, held for Keep same IP
  // or AnyIP's default of 7 days. A fixed session name pins one IP, so it makes one row.
  const plan = gatewayPullPlan({ session: fixedSession, count, life: lifeMin });
  const n = fixedSession || !plan.sticky ? 1 : clampPoolCount(count, 1, MINTED_PULL_MAX);
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
    if (cc) {
      // A country picked here replaces any pasted location, which could name another country.
      for (const k of ['country', 'pool', 'region', 'city', 'lat', 'lon']) own.delete(k);
      own.set('country', `country_${cc}`);
      if (region) own.set('region', `region_${region}`);
      if (town) own.set('city', `city_${town}`);
    }
    if (lifeMin) own.set('sesstime', `sesstime_${lifeMin}`);
    // session goes last, the layout known to work against the live gateway; delete first because
    // Map.set keeps an existing key's position. A rotating row drops a pasted session and its time.
    own.delete('session');
    if (plan.sticky) own.set('session', `session_${fixedSession || randSession()}`);
    else own.delete('sesstime');
    const parts = [baseUser, ...own.values()];
    rows.push({
      type: rowType, host: gwHost, port: gwPort,
      username: parts.join(','), password: pw,
      label: `AnyIP • ${ptype === 'mobile' ? 'Mobile' : 'Res'} • ${[cc || 'Global', town || region].filter(Boolean).join(' ')} • ${plan.sticky ? `#${i}` : 'rotating'}`, country: cc || null
    });
  }
  return rows;
}

// ---- ShopSocks5 ----
// POST form-urlencoded (helper shopSocks5Request); needs both user_name and api_token (the token
// alone fails). Rows come back under `response`. qty has no documented maximum and no paging, so
// one request asks for the whole amount, bounded by the shared cap.
const SHOPSOCKS5_MAX_QTY = MINTED_PULL_MAX;
async function fetchShopSocks5Pool({ token, username, country, count, state, city, plan, proxyType, poolType }) {
  const tok = String(token || '').trim();
  if (!tok) throw new Error('ShopSocks5: your API token is required.');
  const user = String(username || '').trim();
  if (!user) throw new Error('ShopSocks5: your ShopSocks5 account username or email is required - the API authenticates with user_name + api_token together.');
  const cc = normCountryCode(country);

  // API docs: https://shopsocks5.com/document. Returns { success, response: [...], message }.
  // Only the Premium route takes proxy_type (the form shows Proxy type for Premium only); on the other
  // routes each row keeps the type the API reports, and SOCKS5 when it reports none.
  const premium = String(plan || '').trim().toLowerCase() === 'premium';
  const ptype = premium ? (String(proxyType || 'proxy_sock_5').trim() || 'proxy_sock_5') : 'proxy_sock_5';
  const isHttps = ptype === 'proxy_https';
  const qty = clampPoolCount(count, 5, SHOPSOCKS5_MAX_QTY);
  const { path: route, form } = shopSocks5Request({ user, token: tok, plan, qty, country: cc, state, city, sockType: poolType, proxyType: ptype });

  let text;
  try {
    text = await httpRequestText(`https://shopsocks5.com${route}`, {
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
  return rows.slice(0, qty);
}

// ---- DataImpulse ----
// GET /api/list (Basic Auth) returns ready `login:password@host:port` lines with targeting applied,
// stored as-is. Each plan has its own login, so `plan` only labels rows; it is not an API parameter.
const DI_API = 'https://gw.dataimpulse.com:777/api';
// Sticky ports run from 10000 to 20000 and keep an IP for 1 to 120 minutes (docs.dataimpulse.com).
const DI_STICKY_PORTS = 10001;
const DI_MAX_TTL = 120;
const DI_PRODUCTS = Object.freeze({
  residential: 'Residential', residential_premium: 'Premium Residential',
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
  // Sticky sessions are ports, so a pull mints them like a gateway would and shares that cap.
  const n = clampPoolCount(count, 5, MINTED_PULL_MAX);
  const sticky = String(poolType || '').toLowerCase() === 'sticky';
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const rowType = socks ? 'SOCKS5' : 'HTTP';
  const ttl = Math.min(DI_MAX_TTL, Number.parseInt(String(life), 10));
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
    if (have.size >= DI_STICKY_PORTS) {
      throw new Error(`DataImpulse has ${DI_STICKY_PORTS} sticky ports per login (10000 to 20000), and the pool already holds them all.`);
    }
    if (have.size > 0) {
      qs.set('quantity', String(Math.min(DI_STICKY_PORTS, have.size + n)));
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

// ---- Provider-API rotation (rotateProxyIp) ----
// Vendors whose API gives a proxy a new IP, instead of a change-IP link stored on the proxy.
// apiRotationProvider names the vendor that can rotate this proxy ('' for none), from the stored row
// alone, so canRotate (serializeProxy, the block response) stays a pure function of the row; a new
// vendor adds one line here and one entry in PROVIDER_ROTATORS. A rotator takes the proxy and returns
// { ok, status, latencyMs, response } or throws a clear message. An account key is read from the saved
// provider credentials (readSavedProviderCreds) when the rotation runs, and never put in a proxy's
// rotationUrl, which members with proxies.reveal can see and export.
function apiRotationProvider(proxy) {
  if (!proxy) return '';
  if (isDataImpulseSticky(proxy)) return 'dataimpulse';
  // ProxyUDP: POST /subscriptions/{id}/rotate-ip/ with the saved token (its API returns no link).
  if (String(proxy.provider || '').toLowerCase() === 'proxyudp' && String(proxy.host || '').trim() && Number(proxy.port) > 0) return 'proxyudp';
  // SimplyNode port format: each sticky port on proxy.simplynode.io (9000 to 18999) is a session that
  // GET /subaccounts/{login}/session:reset?ports= renews; the row's username is the sub-account login.
  if (String(proxy.provider || '').toLowerCase() === 'simplynode' && String(proxy.host || '').toLowerCase() === 'proxy.simplynode.io'
    && Number(proxy.port) >= 9000 && Number(proxy.port) <= 18999 && Boolean(proxy.username)) return 'simplynode';
  // A pulled MountProxies modem: the saved key finds its subscription_key (rotateMountProxies).
  if (String(proxy.provider || '').toLowerCase() === 'mountproxies' && proxy.host && proxy.port && proxy.username) return 'mountproxies';
  return '';
}
const PROVIDER_ROTATORS = Object.freeze({
  dataimpulse: rotateDataImpulseSticky,
  // Late-bound: these rotators live in their vendors' sections further down.
  proxyudp: (proxy) => rotateProxyUdp(proxy),
  simplynode: (proxy) => rotateSimplyNodeSession(proxy),
  // Resolved when called: the rotator sits with its connector further down.
  mountproxies: (proxy) => rotateMountProxies(proxy)
});
function proxyCanRotate(proxy) {
  return Boolean(proxy) && (Boolean(proxy.rotationUrl) || Boolean(apiRotationProvider(proxy)));
}
// A change-IP link that answers only once the new IP is up gets longer than the default 20 seconds,
// by the proxy's provider tag.
const ROTATION_LINK_TIMEOUT_MS = Object.freeze({
  // "A rotation can take close to a minute when the modem is slow; use a client timeout of at least
  // 60 seconds." (ProxyBrazil Partner API)
  proxybrazil: 65000
});
function rotationLinkTimeoutMs(proxy) {
  const v = ROTATION_LINK_TIMEOUT_MS[String((proxy && proxy.provider) || '').toLowerCase()];
  return Number(v) > 0 ? Number(v) : 20000;
}
// What a change-IP link answered, for the vendors whose refusals say why (ProxyBrazil's 30 changes in
// 15 minutes, a Zokol cooldown): a clear message instead of a bare HTTP status, by the provider tag.
// '' when the link worked or the vendor has no entry.
const ROTATION_LINK_REFUSALS = Object.freeze({
  proxybrazil: proxyBrazilRotateRefusal,
  zokol: zokolRotateRefusal
});
function rotationLinkRefusal(proxy, status, data) {
  const describe = ROTATION_LINK_REFUSALS[String((proxy && proxy.provider) || '').toLowerCase()];
  return describe ? String(describe(status, data) || '') : '';
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
    // The country list is the whole pool; only a state, city, ASN or ZIP list narrows to a country.
    if (cc && by !== 'country') qs.set('countries', cc.toLowerCase());
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
const PS_ORDER_MAX = 5000;
const PS_ORDER_MAX_PAGES = 100;
async function fetchProxySellerOrderPool(key, { product, proxyType, orderId, count, existingPorts }) {
  const label = PROXY_SELLER_ORDER_TYPES[product];
  const oid = String(orderId || '').trim();
  const listPath = (page, perPage) => {
    const qs = new URLSearchParams();
    if (/^[A-Za-z0-9_-]{1,40}$/.test(oid)) qs.set('orderId', oid);
    if (page) { qs.set('page', String(page)); qs.set('per_page', String(perPage)); }
    const query = qs.toString();
    return `proxy/list/${product}${query ? `?${query}` : ''}`;
  };
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const rowLabel = `Proxy-Seller • ${label}`;
  // An order can hold hundreds of addresses: skip those already pooled and take the next "How many".
  // A blank count imports the whole order.
  const wanted = count != null && String(count).trim() !== '' ? clampPoolCount(count, 5, PS_ORDER_MAX) : PS_ORDER_MAX;
  const held = new Map();
  const items = [];
  const seen = new Set();
  const fresh = [];
  const take = async (pageItems) => {
    const added = [];
    for (const it of pageItems) {
      if (!it || typeof it !== 'object') continue;
      const id = it.id != null ? String(it.id) : `${it.ip}|${it.port_http}|${it.port_socks}`;
      if (seen.has(id)) continue;
      seen.add(id);
      added.push(it);
    }
    items.push(...added);
    for (const r of proxySellerOrderRows(added, { socks, label: rowLabel })) {
      if (typeof existingPorts === 'function') {
        const k = `${r.host}\u0000${r.username}`;
        if (!held.has(k)) held.set(k, await existingPorts({ host: r.host, login: r.username }).catch(() => new Set()));
        if (held.get(k).has(r.port)) continue;
      }
      fresh.push(r);
    }
    return added.length;
  };

  // GET proxy/list/{type} pages with page and per_page (100 by default) and reports total_pages. A
  // reply without paging fields that holds a full default page may still be cut short, so keep
  // asking until a page adds nothing new.
  const first = proxySellerPageInfo(await psCall(key, 'GET', listPath(0), `${label} list`));
  await take(first.items);
  const perPage = first.perPage || PROXY_SELLER_PAGE_SIZE;
  let page = first.page || 1;
  let more = first.totalPages ? page < first.totalPages : first.items.length >= PROXY_SELLER_PAGE_SIZE;
  while (more && fresh.length < wanted && page < PS_ORDER_MAX_PAGES) {
    page += 1;
    const next = proxySellerPageInfo(await psCall(key, 'GET', listPath(page, perPage), `${label} list`));
    const added = await take(next.items);
    more = added > 0 && (next.totalPages ? page < next.totalPages : next.items.length >= perPage);
  }

  if (!proxySellerOrderRows(items, { socks }).length) {
    // An order serves one protocol (an HTTPS order has an empty port_socks), so name the mismatch.
    const other = proxySellerOrderRows(items, { socks: !socks });
    if (other.length) {
      const want = socks ? 'SOCKS5' : 'HTTP';
      const protos = [...new Set(items.map((it) => it && it.protocol).filter(Boolean).map(String))].join(', ');
      throw new Error(`Proxy-Seller: these ${label} proxies have no ${want} port${protos ? ` (the order's protocol is ${protos})` : ''}. Pull them as ${socks ? 'HTTP' : 'SOCKS5'} instead.`);
    }
    throw new Error(`Proxy-Seller: this account has no active ${label} proxies${oid ? ' in that order' : ''}.`);
  }
  if (!fresh.length) throw new Error(`Proxy-Seller: every ${label} proxy on this account is already in your pool.`);
  return fresh.slice(0, wanted).map((r) => ({
    type: r.type, host: r.host, port: r.port, username: r.username, password: r.password,
    label: r.label, country: null, rotationUrl: r.rotationUrl
  }));
}

// Residential entry servers: Europe (the default), the United States and Asia.
const PROXY_SELLER_RESIDENT_HOSTS = Object.freeze(['res.proxy-seller.com', 'us.res.proxy-seller.com', 'asia.res.proxy-seller.com']);
function proxySellerResidentHost(host) {
  const h = String(host || '').trim().toLowerCase();
  return PROXY_SELLER_RESIDENT_HOSTS.includes(h) ? h : PROXY_SELLER_RESIDENT_HOSTS[0];
}

async function fetchProxySellerPool({ token, country, state, city, count, poolType, life, proxyType, listId, plan, orderId, existingPorts, host }) {
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

  // The v2 export takes the scheme as `protocol` (`proto` does not apply to resident lists) and the
  // entry server as `host`; without one every line uses the European default. Rows still take their
  // host and port from the downloaded lines.
  const qs = new URLSearchParams({
    ext: '%login%:%password%@%ip%:%port%',
    protocol: socks ? 'socks5' : 'http',
    host: proxySellerResidentHost(host),
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
// proxy_count runs from 1 to a server maximum the spec does not publish. Each generate call mints
// new random sessions, so a large sticky pull is made in batches of this size, or smaller when the
// server names a lower maximum.
const IPR_BATCH = 500;
const IPR_MAX_CALLS = 50;
// GET /residential-subusers pages with page and per_page and reports meta.last_page.
const IPR_SUBUSER_PAGE = 100;
const IPR_SUBUSER_MAX_PAGES = 50;

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

  const n = clampPoolCount(count, 5, MINTED_PULL_MAX);
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

  const cc = normCountryCode(country);
  const want = body.proxy_count;
  let batch = Math.min(IPR_BATCH, want);
  const rows = [];
  const seen = new Set();
  for (let calls = 0; rows.length < want && calls < IPR_MAX_CALLS; calls += 1) {
    let lines;
    try {
      lines = await iprCall(token, 'POST', '/access/generate-proxy-list', 'proxy list', { ...body, proxy_count: Math.min(batch, want - rows.length) });
    } catch (e) {
      const msg = e && e.message;
      const max = ipRoyalMaxCount(msg);
      if (max && max < batch) { batch = max; continue; }
      // The spec's wording names no number ("must be between 1 and the configured
      // proxy_list_max_quantity"), so halve the batch until the server takes it.
      if (!max && batch > 1 && ipRoyalCountRefused(msg)) { batch = Math.max(1, Math.floor(batch / 2)); continue; }
      throw e;
    }
    const before = rows.length;
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
    if (rows.length === before) break;
  }
  if (!rows.length) throw new Error('IPRoyal returned no usable proxies. Try another location, or check the account still has traffic.');
  return rows.slice(0, want);
}

let iprCountriesCache = { key: '', at: 0, data: null };
async function lookupIpRoyal({ token, country, groupby }) {
  const me = await iprCall(token, 'GET', '/residential/me', 'account check');
  const subs = { data: [] };
  for (let page = 1; page <= IPR_SUBUSER_MAX_PAGES; page += 1) {
    const res = await iprCall(token, 'GET', `/residential-subusers?page=${page}&per_page=${IPR_SUBUSER_PAGE}`, 'sub-user list');
    const data = res && Array.isArray(res.data) ? res.data : [];
    subs.data.push(...data);
    const last = Number(res && res.meta && res.meta.last_page);
    if (!data.length || !(Number.isFinite(last) && page < last)) break;
  }
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
// generate-proxy-list returns "host:port:user:pass" strings; proxy_count has no documented maximum.
// The API unlocks after 1 GB of residential traffic; ISP, datacenter and mobile have no documented
// API. Not live-key tested.
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

// Traffic left on the sub-user that pays for the proxies: MarsProxies moves traffic given to a
// sub-user out of the main balance, so the main account can read 0 while the sub-user has plenty. A
// sub-user on shared traffic draws from the main balance. NaN when the sub-user cannot be read, so the
// pull goes ahead and the API answers for it.
async function marsSubuserTrafficLeft(token, { username, hash }, mainGb) {
  try {
    const query = username ? `?search=${encodeURIComponent(username)}` : '';
    const subs = await marsCall(token, 'GET', `/v1/residential/subusers${query}`, 'sub-user check');
    const items = Array.isArray(subs) ? subs : (subs && Array.isArray(subs.data) ? subs.data : []);
    const hit = items.find((s) => s && ((hash && String(s.hash || '') === hash) || (username && String(s.username || '').toLowerCase() === username.toLowerCase())));
    if (!hit) return NaN;
    if (hit.is_using_shared_traffic === true) return mainGb;
    const left = Number(hit.traffic_available);
    return Number.isFinite(left) ? left : NaN;
  } catch (e) {
    return NaN;
  }
}

async function fetchMarsProxiesPool({ token, username, password, subuserHash, country, state, city, count, life, proxyType, host }) {
  const me = await marsCall(token, 'GET', '/v1/residential/me', 'account check');
  const mainGb = Number(me && me.traffic_available);
  const subName = String(username || '').trim();
  const subHash = String(subuserHash || '').trim();
  const gb = subName || subHash ? await marsSubuserTrafficLeft(token, { username: subName, hash: subHash }, mainGb) : mainGb;
  if (Number.isFinite(gb) && gb <= 0) {
    throw new Error(subName || subHash
      ? 'MarsProxies: this sub-user has no residential traffic left, so anything pulled for it would fail on first use. Give it traffic in the dashboard (Sub-users).'
      : 'MarsProxies: this account has no residential traffic left, so anything pulled from it would fail on first use.');
  }
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  // gatewayPullPlan: one proxy with Keep same IP blank is one rotating proxy (a new IP per request);
  // How many above 1 or a Keep same IP time makes sticky proxies, held for that time (1 second to 168
  // hours) or MarsProxies' default of 24 hours.
  const plan = gatewayPullPlan({ count, life });
  const rotating = !plan.sticky;
  const lifetime = ipRoyalLifetimeFromMinutes(life) || '24h';
  const n = rotating ? 1 : clampPoolCount(count, 1, MINTED_PULL_MAX);
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
  const hash = subHash;
  if (hash) {
    body.subuser_hash = hash;
  } else {
    const u = subName;
    // A sub-user password is 6 to 16 letters and digits. One copied from the dashboard's proxy list
    // carries the targeting after an underscore (password123_country-us_session-...), so only the
    // part before the first underscore is the password.
    const pw = password != null ? String(password).split('_')[0].trim() : '';
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
// dashboard proxy login (the account API key is not used). Sessions are minted locally, so a pull
// is capped only by MINTED_PULL_MAX. Not live-key tested.
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
  // gatewayPullPlan: one row with no session name and Keep same IP blank has no -sid-, so NodeMaven
  // gives it a new IP per request. Otherwise each row has its own -sid-, held for Keep same IP or, when
  // that is blank, as long as NodeMaven can (up to 24 hours).
  const fixed = String(session || '').trim();
  const plan = gatewayPullPlan({ session: fixed, count, life });
  const n = plan.sticky ? clampPoolCount(count, 1, MINTED_PULL_MAX) : 1;
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const sid = !plan.sticky ? '' : fixed ? (n > 1 ? `${fixed}${i}` : fixed) : crypto.randomBytes(6).toString('hex');
    // -filter-medium is the dashboard's default Quality filter (without it NodeMaven uses its whole
    // pool), and -ipv4-true keeps every exit on IPv4 (NodeMaven mixes in IPv6 otherwise).
    const user = nodeMavenUsername(login, { country: cc, region: state, city, type, sid, ttl: sid ? ttl : '', filter: 'medium', ipv4: true });
    if (!user) continue;
    const key = `${host}:${port}:${user}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host, port, username: user, password: pass,
      label: `NodeMaven • ${type === 'mobile' ? 'Mobile' : 'Residential'} • ${cc || 'Global'} • ${sid ? `sid ${sid}` : 'rotating'}`,
      country: cc || null
    });
  }
  if (!rows.length) throw new Error('NodeMaven: could not build any proxies. Check the username and country.');
  return rows;
}

// Froxy (SOAX reseller, proxy.froxy.com:9000): rows use the dashboard Filter login, since the API
// needs an email login. A country makes the password "<type>;<cc>;<region>;<city>;". Froxy has no
// session token: each port 9000-9999 holds its own exit IP until the forced rotation interval set in
// the dashboard, so one row per port is one sticky proxy, up to 1000.
const FROXY_GATEWAY = Object.freeze({ host: 'proxy.froxy.com', port: 9000, maxPorts: 1000 });
const FROXY_POOL_NAMES = Object.freeze({ residential: 'Residential', mobile: 'Mobile', datacenter: 'Datacenter', fast: 'Fast residential' });

async function fetchFroxyPool({ username, password, country, state, city, count, poolType, proxyType, existingPorts }) {
  const login = String(username || '').trim();
  const base = froxyBasePassword(password);
  if (!login) throw new Error('Froxy: enter the Login from the subscription page (Manage, Login/Password Access).');
  if (!base) throw new Error('Froxy: enter the Password from the same page. Only the part before the first ";" is used; the app adds the country.');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  // A pasted type word (wifi, mobile, shared, fast) names the subscription the login belongs to, and is
  // kept as pasted. A Pool type that disagrees would be refused by Froxy, so stop with a clear message
  // instead of rewriting the word.
  const pasted = froxyPastedPool(password);
  const chosen = String(poolType || '').toLowerCase();
  const picked = FROXY_POOL_NAMES[chosen] && chosen !== 'fast' ? chosen : '';
  if (pasted && pasted !== 'fast' && picked && picked !== pasted) {
    throw new Error(`Froxy: the pasted password is for a ${FROXY_POOL_NAMES[pasted]} subscription, but Pool type is ${FROXY_POOL_NAMES[picked]}. Pick ${FROXY_POOL_NAMES[pasted]}, or paste the login and password of your ${FROXY_POOL_NAMES[picked]} subscription.`);
  }
  const kindLabel = FROXY_POOL_NAMES[pasted || picked || 'residential'];
  const cc = normCountryCode(country);
  const pw = froxyPassword(base, { country: cc, region: state, city });
  // One row per port: each port is a separate session (its own exit IP). A pull takes the first ports
  // the pool does not already hold for this login, whatever their targeting, so a pull for a second
  // country does not put two profiles on one port. Ports past the package's port count are refused
  // by Froxy.
  const held = typeof existingPorts === 'function'
    ? await existingPorts({ host: FROXY_GATEWAY.host, login }).catch(() => new Set())
    : new Set();
  const n = clampPoolCount(count, 1, FROXY_GATEWAY.maxPorts);
  const ports = [];
  for (let p = FROXY_GATEWAY.port; p < FROXY_GATEWAY.port + FROXY_GATEWAY.maxPorts && ports.length < n; p++) {
    if (!held.has(p)) ports.push(p);
  }
  if (!ports.length) throw new Error(`Froxy: the pool already holds all ${FROXY_GATEWAY.maxPorts} ports (9000 to 9999) for this login.`);
  const rows = ports.map((p) => ({
    type: socks ? 'SOCKS5' : 'HTTP',
    host: FROXY_GATEWAY.host, port: p, username: login, password: pw,
    label: `Froxy • ${kindLabel} • ${cc || 'Any country'} • port ${p}`,
    country: cc || null,
    dedupeOnPassword: true // country and pool type ride in the password
  }));
  if (rows.length < n) rows[0].label += ` (${rows.length} of ${n} ports left)`;
  return rows;
}

// ---- PacketStream (proxy.packetstream.io; HTTPS 31111, HTTP 31112, SOCKS5 31113) ----
// No API: rows are minted locally, with country and sticky session in the auth key (the proxy
// password). A session label keeps its exit while it opens a new connection at least every 60 minutes
// (packetstream.io/docs). PacketStream recommends HTTPS (TLS to the proxy, an HTTPS proxy row since
// 1.0.26) and keeps HTTP for older integrations; HTTP stays the default, as it is the one tested live.
const PACKETSTREAM_GATEWAY = Object.freeze({ host: 'proxy.packetstream.io', https: 31111, http: 31112, socks: 31113 });

async function fetchPacketStreamPool({ username, password, country, session, count, proxyType }) {
  const login = String(username || '').trim();
  const base = password != null ? String(password) : '';
  if (!login) throw new Error('PacketStream: enter your username (dashboard, Proxy Access).');
  if (!base) throw new Error('PacketStream: enter your auth key (dashboard, Proxy Access). It is not your account password.');
  const proto = String(proxyType || '').toLowerCase();
  const socks = proto === 'socks5';
  const tls = proto === 'https';
  const type = socks ? 'SOCKS5' : (tls ? 'HTTPS' : 'HTTP');
  const host = PACKETSTREAM_GATEWAY.host;
  const port = socks ? PACKETSTREAM_GATEWAY.socks : (tls ? PACKETSTREAM_GATEWAY.https : PACKETSTREAM_GATEWAY.http);
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
      type, host, port, username: login, password: pw,
      label: `PacketStream • ${where} • rotating`, country: cc || null, dedupeOnPassword: true
    }];
  }
  // Sticky: mint `count` rows, each pinned to its own session id (one exit IP per profile).
  const n = clampPoolCount(count, 1, MINTED_PULL_MAX);
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const sid = n > 1 ? `${fixed}${i + 1}` : fixed;
    const pw = packetStreamPassword(base, { country: cc, session: sid });
    const key = `${host}:${port}:${login}:${pw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      type, host, port, username: login, password: pw,
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
function limitListRows(rows, count, max = LIST_IMPORT_MAX) {
  const raw = String(count == null ? '' : count).trim();
  if (!raw || !/^\d+$/.test(raw) || Number(raw) <= 0) return rows;
  // A list import is bounded by what the account owns; the cap only guards a runaway count.
  return rows.slice(0, clampPoolCount(raw, rows.length, max));
}

async function fetchAirproxyPool({ token, count, proxyType }) {
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
  // Every Airproxy proxy is in Italy. SOCKS5 uses the same port (seen in the dashboard, not in the docs).
  const rows = airproxyRows(text, { socks: String(proxyType || '').toLowerCase() === 'socks5' });
  if (!rows.length) throw new Error('Airproxy: no active proxies on this account. Confirm a proxy is assigned and the API key is correct.');
  return limitListRows(rows, count);
}

// ---- CatProxies ----
// The cp_ key and a Plan ID fetch GET /orders/:id for the login; targeting rides in the username
// (Standard Residential, Rotating Mobile) or in the password (Premium Residential), and sticky sessions
// are minted locally. Each of these products has a US, a Europe and an Asia gateway for the same login
// (catproxies.com/docs/api: pick the one nearest the target country); the form's Gateway select sends
// it as zone, US when blank. Fixed-IP plans use fetchCatProxiesFixedIps.
const CATPROXIES_API = 'https://catproxies.com/api/v1/user';
const CATPROXIES_REGIONS = Object.freeze(['us', 'eu', 'asia']);
const CATPROXIES_PRODUCTS = Object.freeze({
  // Residential splits rotating (9000/11000) and sticky (10000/12000) port ranges on every gateway; the
  // gateway rejects a -session- username on the rotating range.
  residential: { code: 'v2resi', hosts: { us: 'resi-us.catproxies.com', eu: 'resi-fr.catproxies.com', asia: 'resi-sg.catproxies.com' }, http: 9000, socks: 11000, stickyHttp: 10000, stickySocks: 12000, kind: 'Residential' },
  // Premium Residential: one host per region with its own HTTP and SOCKS5 ports; a bare password
  // rotates, a _session- flag holds the IP on the same port.
  residential_premium: { code: 'resix', hosts: { us: 'us.premium.catproxies.com', eu: 'eu.premium.catproxies.com', asia: 'asia.premium.catproxies.com' }, http: { us: 6011, eu: 6012, asia: 6013 }, socks: { us: 6014, eu: 6015, asia: 6016 }, premium: true, kind: 'Premium Residential' },
  // Rotating Mobile: port 5000, HTTP (and HTTPS) only; the docs list no SOCKS5 port.
  mobile: { code: 'rotatingmobile', hosts: { us: 'mobile-us.catproxies.com', eu: 'mobile-eu.catproxies.com', asia: 'mobile-asia.catproxies.com' }, http: 5000, socks: 5000, mobile: true, kind: 'Mobile' }
});

async function fetchCatProxiesPool({ token, orderId, poolType, country, state, city, session, life, count, proxyType, zone }) {
  const key = String(token || '').trim();
  if (!/^cp_[A-Za-z0-9]{8,128}$/.test(key)) throw new Error('CatProxies: enter your API key (dashboard, My Account, API). It starts with cp_.');
  const product = CATPROXIES_PRODUCTS[String(poolType || '').toLowerCase()] || CATPROXIES_PRODUCTS.residential;
  const id = String(orderId || '').trim();
  if (!/^[0-9a-fA-F-]{8,40}$/.test(id)) throw new Error('CatProxies: paste the Plan ID from the dashboard (Active Plans → the plan you want to use).');
  const pool = String(poolType || '').toLowerCase();
  if (pool === 'isp' || pool === 'datacenter') return fetchCatProxiesFixedIps({ key, id, pool, country, state, city, session, count, proxyType });
  const rawRegion = String(zone || '').trim().toLowerCase();
  if (rawRegion && !CATPROXIES_REGIONS.includes(rawRegion)) throw new Error('CatProxies: Gateway must be US, Europe or Asia.');
  const region = rawRegion || 'us';
  const atRegion = (v) => (v && typeof v === 'object' ? v[region] : v);
  const cc = normCountryCode(country);
  if (product.premium) {
    // Premium takes a state for the US only, and a state or a city, not both.
    if (String(state || '').trim() && String(city || '').trim()) throw new Error('CatProxies: Premium Residential takes a state or a city, not both. Clear one of them.');
    if (String(state || '').trim() && cc !== 'US') throw new Error('CatProxies: Premium Residential takes a state for the United States only. Pick US as the country, or clear State.');
  }
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
  const host = atRegion(product.hosts);
  const port = atRegion(socks && !product.mobile ? product.socks : product.http);
  const where = cc || 'Worldwide';
  // Keep same IP left blank holds a sticky IP for 30 minutes on every pool (LIFE_BLANK_DEFAULTS), so a
  // Mobile sticky session always carries its -ttl- (the docs give no default and refuse odd values).
  const lifeMin = Number(life);
  const stickyMin = Number.isInteger(lifeMin) && lifeMin > 0 ? lifeMin : 30;
  const buildUser = (sid) => (product.mobile
    ? catProxiesMobileUsername(username, { country: cc, region: state, city, session: sid, ttlMin: stickyMin })
    : (product.premium ? username : catProxiesResiUsername(username, { country: cc, state, city, session: sid, lifetimeMin: stickyMin })));
  const buildPassword = (sid) => (product.premium
    ? catProxiesPremiumPassword(password, { country: cc, state, city, session: sid, lifetimeMin: stickyMin })
    : password);
  // gatewayPullPlan: a session name, a Keep same IP time or How many above 1 mints sticky sessions;
  // otherwise one rotating row.
  const plan = gatewayPullPlan({ session, count, life });
  const fixed = plan.session || (plan.sticky ? `sg${crypto.randomBytes(3).toString('hex')}` : '');
  if (!fixed) {
    return [{ type, host, port, username: buildUser(''), password: buildPassword(''), label: `CatProxies • ${product.kind} • ${where} • rotating`, country: cc || null, dedupeOnPassword: true }];
  }
  const n = clampPoolCount(count, 1, MINTED_PULL_MAX);
  const stickyPort = product.mobile || product.premium ? port : (socks ? product.stickySocks : product.stickyHttp);
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const sid = n > 1 ? `${fixed}${i + 1}` : fixed;
    const user = buildUser(sid);
    const pass = buildPassword(sid);
    const dkey = `${host}:${stickyPort}:${user}:${pass}`;
    if (seen.has(dkey)) continue;
    seen.add(dkey);
    rows.push({ type, host, port: stickyPort, username: user, password: pass, label: `CatProxies • ${product.kind} • ${where} • ${sid}`, country: cc || null, dedupeOnPassword: true });
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

// RapidProxy, MobileProxy.Space and Proxy-Solutions carried HTTP or SOCKS5 in Pool type until the
// form gave them the Protocol select (proxyType). A caller that still sends the old poolType value
// ('http' or 'socks5') keeps getting the protocol it asked for.
function protocolChoice({ proxyType, poolType } = {}) {
  const p = String(proxyType || '').toLowerCase();
  if (p === 'socks5' || p === 'http') return p;
  return String(poolType || '').toLowerCase() === 'socks5' ? 'socks5' : 'http';
}

// Mint `count` sticky rows (one session id each) or a single rotating row, for vendors whose
// targeting lives in the username. buildUser(sid) returns the full username for that session.
// `max` is lower than MINTED_PULL_MAX only for a vendor that documents a session limit.
// gatewayPullPlan decides sticky or rotating: a session name, a Keep same IP time (`life`) or How many
// above 1 is sticky; otherwise one rotating row.
function mintGatewayRows({ type, host, port, password, session, count, life, buildUser, label, max = MINTED_PULL_MAX }) {
  const plan = gatewayPullPlan({ session, count, life });
  const fixed = plan.session || (plan.sticky ? `sg${crypto.randomBytes(3).toString('hex')}` : '');
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
// Default gateway us.rapidproxy.io:5001, HTTP and SOCKS5 on the same port (read from the dashboard on
// 29 Sep 2026; SOCKS5 not yet tested live); other regional nodes go through the override.
const RAPIDPROXY_GATEWAY = Object.freeze({ host: 'us.rapidproxy.io', port: 5001 });

async function fetchRapidProxyPool({ username, password, country, state, city, session, life, count, host, port, poolType, proxyType }) {
  const sub = String(username || '').trim();
  const pw = password != null ? String(password) : '';
  if (!sub || /[\s:@]/.test(sub)) throw new Error('RapidProxy: enter the sub-account username from the dashboard (Residential → sub-accounts).');
  if (!pw) throw new Error('RapidProxy: enter the sub-account password.');
  const cc = normCountryCode(country);
  if (String(city || '').trim() && !String(state || '').trim()) throw new Error('RapidProxy: city targeting needs a state as well (for example State California, City LosAngeles).');
  if (String(state || '').trim() && !cc) throw new Error('RapidProxy: pick a country before a state.');
  const gw = gatewayOverride(host, port, RAPIDPROXY_GATEWAY, 'RapidProxy');
  const where = cc || 'Global';
  // Session names become 8-digit ids by hashing, so two names can land on the same id (the same
  // exit IP). Step past an id already used in this pull.
  const usedSids = new Set();
  const uniqueSid = (sid) => {
    let num = rapidProxySid(sid);
    while (num && usedSids.has(num)) num = String(10000000 + ((Number(num) + 1) % 90000000));
    if (num) usedSids.add(num);
    return num;
  };
  const rows = mintGatewayRows({
    // SOCKS5 runs on the same host:port.
    type: protocolChoice({ proxyType, poolType }) === 'socks5' ? 'SOCKS5' : 'HTTP', host: gw.host, port: gw.port, password: pw, session, count, life,
    buildUser: (sid) => rapidProxyUsername(sub, { country: cc, state, city, session: uniqueSid(sid), lifeMin: Number(life) }),
    label: `RapidProxy • ${where}`,
    max: MINTED_PULL_MAX
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('RapidProxy: could not build any proxies.');
  return rows;
}

// ---- NOVADA (residential / rotating ISP / mobile) ----
// Rows use a proxy user (not the login email); zone, geo and sticky session ride in the username.
// Default super.novada.pro:7777. Hosts are per account, so another host the dashboard endpoint
// generator shows goes through the override.
const NOVADA_GATEWAY = Object.freeze({ host: 'super.novada.pro', port: 7777 });

async function fetchNovadaPool({ username, password, poolType, country, state, city, session, life, count, host, port }) {
  const user = String(username || '').trim();
  const pw = password != null ? String(password) : '';
  if (!user || /[\s:@]/.test(user)) throw new Error('NOVADA: enter a proxy user from the dashboard (Users, Add User). Your login email does not work here.');
  if (/-zone-/i.test(user)) throw new Error('NOVADA: enter only the proxy user name; the app adds -zone- and the targeting itself.');
  if (!pw) throw new Error('NOVADA: enter that proxy user\'s password.');
  const cc = normCountryCode(country);
  const gw = gatewayOverride(host, port, NOVADA_GATEWAY, 'NOVADA');
  const kind = { res: 'Residential', isp: 'Rotating ISP', mob: 'Mobile' }[NOVADA_ZONES[String(poolType || '').toLowerCase()] || 'res'];
  const rows = mintGatewayRows({
    type: 'HTTP', host: gw.host, port: gw.port, password: pw, session, count, life,
    buildUser: (sid) => novadaUsername(user, { poolType, country: cc, state, city, session: sid, lifeMin: Number(life) }),
    label: `NOVADA • ${kind} • ${cc || 'Global'}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('NOVADA: could not build any proxies.');
  return rows;
}

// Proxies.sx: the X-API-Key reads the gateway login with GET /account/proxy-password (scope
// account:read; the account password never works there). A country is required and each row is
// failover-strict on one pool, so out of stock fails (E_NO_STOCK_COUNTRY) instead of exiting
// elsewhere. Sticky rows pin a sid and carry Keep same IP as -ttl- in seconds; left blank it is 24
// hours, because the gateway's own default (1 hour) would drop a profile's session record after an
// hour. Rotating rows ask for a new endpoint per connection.
const PROXIESSX_API = 'https://api.proxies.sx/v1';
const PROXIESSX_GATEWAY = Object.freeze({ host: 'gw.proxies.sx', http: 7000, socks: 7001 });
const PROXIESSX_DEFAULT_TTL_MIN = 1440;

async function fetchProxiesSxPool({ token, poolType, country, state, city, session, life, count, proxyType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('Proxies.sx: enter your API key (client.proxies.sx → API keys).');
  const cc = normCountryCode(country);
  if (!cc) throw new Error('Proxies.sx: pick a country. The pool never picks one for you, so a country with no stock fails instead of exiting somewhere else.');
  const pool = PROXIESSX_POOLS[String(poolType || '').toLowerCase()] ? String(poolType).toLowerCase() : 'mobile';
  const st = String(state || '').trim();
  const ct = String(city || '').trim();
  if (pool === 'mobile' && !PROXIESSX_MOBILE_COUNTRIES.includes(cc)) {
    throw new Error(`Proxies.sx: the Mobile pool runs only in ${PROXIESSX_MOBILE_COUNTRIES.join(', ')} (GE is Georgia). Pick one of those, or Residential for ${cc}.`);
  }
  if (pool === 'mobile' && (st || ct)) throw new Error('Proxies.sx: State and City work on the Residential pool only. Clear them, or switch to Residential.');
  if (st && !/^[A-Za-z]{2}$/.test(st)) throw new Error('Proxies.sx: State takes the 2-letter region code, for example CA or NY, not the full name.');
  // Public stock counts (no key needed): refuse a country with no endpoints now rather than build
  // proxies that fail on first use. If the stock read fails, the pull goes ahead.
  let stock = null;
  try { stock = proxiesSxStock(await httpRequestText(`${PROXIESSX_API}/gateway/pool/stock`, { headers: { Accept: 'application/json' } }), pool, cc); } catch { stock = null; }
  if (stock === 0) throw new Error(`Proxies.sx has no ${pool === 'mobile' ? 'Mobile' : 'Residential'} stock in ${cc} right now. Pick another country${pool === 'mobile' ? '' : ' or the Mobile pool'}.`);
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
  const kind = pool === 'mobile' ? 'Mobile' : 'Residential';
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const lifeMin = Number.parseInt(String(life == null ? '' : life), 10);
  const ttlSeconds = (Number.isInteger(lifeMin) && lifeMin > 0 ? lifeMin : PROXIESSX_DEFAULT_TTL_MIN) * 60;
  const rows = mintGatewayRows({
    type: socks ? 'SOCKS5' : 'HTTP', host: PROXIESSX_GATEWAY.host, port: socks ? PROXIESSX_GATEWAY.socks : PROXIESSX_GATEWAY.http,
    password: creds.password, session, count, life, max: PROXIESSX_MAX_SESSIONS,
    buildUser: (sid) => proxiesSxUsername(creds.username, { poolType: pool, country: cc, state: st, city: ct, sid: sid ? proxiesSxSid(sid) : '', ttlSeconds }),
    label: `Proxies.sx • ${kind} • ${cc}`
  }).map((r) => ({ ...r, country: cc }));
  if (!rows.length) throw new Error('Proxies.sx: could not build any proxies.');
  return rows;
}

// ---- MobileProxy.Space (dedicated mobile, list pull) ----
// Rotation is the per-proxy change-IP link in the vendor dashboard and is not stored here.
// get_my_proxy returns every active proxy in one answer (no paging). The API allows one identical
// request every few seconds (HTTP 429), so a quick second pull gets a "wait" message. Its docs disagree
// on the address: mpsapi.com/docs.html gives mpsapi.com/api.html and says the old
// mobileproxy.space/api.html stops after 31 Aug 2026, while the OpenAPI file on GitHub
// (mobileproxy/api-docs) still lists https://mobileproxy.space as the production server. The app stays
// on mpsapi.com, the address their current docs page gives (an open question for MobileProxy.Space).
const MOBILEPROXYSPACE_API = 'https://mpsapi.com/api.html';

function mobileProxySpaceGet(key, query) {
  return httpRequestText(`${MOBILEPROXYSPACE_API}${query}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Accept-Language': 'en' } });
}

async function fetchMobileProxySpacePool({ token, poolType, proxyType, count }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('MobileProxy.Space: enter your API token (personal account → API).');
  let text;
  try {
    text = await mobileProxySpaceGet(key, '?command=get_my_proxy');
  } catch (error) {
    const status = error && error.status;
    const msg = String(error && error.message || '');
    if (status === 429 || /too many/i.test(msg)) throw new Error('MobileProxy.Space: too many requests. Wait a few seconds and pull again.');
    if (status === 401 || status === 403) throw new Error('MobileProxy.Space rejected the API token. Copy it again from your personal account.');
    throw new Error('MobileProxy.Space: could not read your proxies. Check your connection and try again.');
  }
  // Each proxy's id_country becomes its ISO code through get_id_country (asked only when the list has
  // one); if that call fails the rows still import, and the health check fills the country in.
  let countries = null;
  if (/"id_country"/.test(text)) {
    try { countries = mobileProxySpaceCountries(await mobileProxySpaceGet(key, '?command=get_id_country')); } catch { countries = null; }
  }
  const { error, rows } = mobileProxySpaceRows(text, { socks: protocolChoice({ proxyType, poolType }) === 'socks5', countries });
  if (error) {
    if (/too many/i.test(error)) throw new Error('MobileProxy.Space: too many requests. Wait a few seconds and pull again.');
    if (/authori[sz]ation|token/i.test(error)) throw new Error('MobileProxy.Space rejected the API token. Copy it again from your personal account.');
    throw new Error(`MobileProxy.Space: ${error.slice(0, 160)}`);
  }
  if (!rows.length) throw new Error('MobileProxy.Space: no active proxies on this account yet. Buy or activate one, then pull again.');
  return limitListRows(rows, count);
}

// ---- Proxy-Solutions (anti-detect integration endpoint) ----
// The provider key is issued per account for anti-detect browsers. Pages of 200 (the size in the
// vendor's contract) are read until How many is met in the chosen country or the list ends, up to
// 25 pages; expired proxies are skipped.
const PROXYSOLUTIONS_API = 'https://proxy-solutions.net/api/proxies';
const PROXYSOLUTIONS_MAX_PAGES = 25;

async function fetchProxySolutionsPool({ token, poolType, proxyType, country, count }) {
  const key = String(token || '').trim();
  if (!key || !/^[A-Za-z0-9_-]{6,200}$/.test(key)) throw new Error('Proxy-Solutions: paste the Integration token from the API for developers page (not the API key).');
  const proto = protocolChoice({ proxyType, poolType }) === 'socks5' ? 'socks' : 'http';
  const cc = normCountryCode(country);
  const raw = String(count == null ? '' : count).trim();
  const want = /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : Infinity;
  const rows = [];
  const seen = new Set();
  let matched = 0;
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, PROXYSOLUTIONS_MAX_PAGES) && matched < want; page++) {
    let text;
    try {
      text = await httpRequestText(`${PROXYSOLUTIONS_API}/${encodeURIComponent(key)}?format=object&proto=${proto}&page=${page}&per_page=200`, { headers: { Accept: 'application/json' } });
    } catch (error) {
      const status = error && error.status;
      if (status === 401 || status === 403 || status === 404) throw new Error('Proxy-Solutions did not accept that Integration token. Copy it again from the API for developers page (the third box, not the API key above it).');
      throw new Error('Proxy-Solutions: could not read your proxies. Check your connection and try again.');
    }
    const res = proxySolutionsPage(text);
    totalPages = res.totalPages;
    for (const r of res.rows) {
      const k = `${r.host}:${r.port}:${r.username}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(r);
      if (!cc || r.country === cc) matched += 1;
    }
  }
  if (!rows.length) throw new Error('Proxy-Solutions: no active proxies on this account.');
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
    type: socks ? 'SOCKS5' : 'HTTP', host: prod.host, port, password: prod.password, session, count, life,
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
    type: 'HTTP', host: gw.host, port: gw.port, password: pw, session, count, life,
    buildUser: (sid) => ipBurgerUsername(base, { country: cc, state, city, session: sid, sesstimeMin: life }),
    label: `IP Burger • Residential • ${cc || 'Worldwide'}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('IP Burger: could not build any proxies.');
  return rows;
}

// ---- Proxy302 (dynamic residential, Open API; endpoints in proxyVendorUtils.js) ----
// Sign in with the API key, map country (and on the premium line state/city) to numeric ids, then
// buy one proxy per call (each its own credential). The calls run a few at a time; the first failure
// stops new calls and keeps what was built, and a run of duplicates stops the pull early.
const PROXY302_API = 'https://proxy302.com/open_api/v3';
const PROXY302_PARALLEL = 4;

function proxy302Failure(error, fallback) {
  const msg = String((error && error.message) || '');
  if (/invalid API credential/i.test(msg)) return new Error('Proxy302 rejected the API key. Paste the key id as the username and the key secret as the password (console, API keys).');
  return new Error(/^Proxy302/.test(msg) ? msg : fallback);
}

async function fetchProxy302Pool({ username, password, poolType, country, state, city, life, count, proxyType }) {
  const keyName = String(username || '').trim();
  const keyPass = password != null ? String(password) : '';
  if (!keyName) throw new Error('Proxy302: enter the API key id from the Proxy302 console (API keys, not your login email).');
  if (!keyPass) throw new Error('Proxy302: enter the API key secret from the Proxy302 console.');
  const line = String(poolType || '').toLowerCase() === 'standard' ? 'standard' : 'premium';
  const cc = normCountryCode(country);
  const st = String(state || '').trim();
  const ct = String(city || '').trim();
  if ((st || ct) && line === 'standard') throw new Error('Proxy302: State and City work on the Premium line only. Clear them, or switch to Premium.');
  if (st && !cc) throw new Error('Proxy302: pick a country before a state.');
  if (ct && !st) throw new Error('Proxy302: city targeting needs its state as well (for example State California, City Los Angeles).');
  let token;
  try {
    const text = await httpRequestText(`${PROXY302_API}/user/users/token?username=${encodeURIComponent(keyName)}&password=${encodeURIComponent(keyPass)}`, { headers: { Accept: 'application/json' } });
    token = proxy302Token(text);
  } catch (error) {
    throw proxy302Failure(error, 'Proxy302: could not sign in to the API. Check your connection and the key.');
  }
  const auth = { Authorization: token, Accept: 'application/json' };
  const areaId = async (type, pid, place, missing) => {
    let id;
    try {
      const query = pid ? `?pid=${encodeURIComponent(pid)}` : '';
      // A big state's city list can pass the default 2 MB response cap.
      const text = await httpRequestText(`${PROXY302_API}/proxy/area/${type}${query}`, { headers: auth, maxBytes: 8_000_000 });
      id = type === 'country' ? proxy302CountryId(text, place) : proxy302AreaId(text, place);
    } catch (error) {
      throw proxy302Failure(error, `Proxy302: could not read the ${type} list to resolve the location.`);
    }
    if (id == null) throw new Error(missing);
    return id;
  };
  const countryId = cc ? await areaId('country', '', cc, `Proxy302 does not list ${cc} in its country database. Pick another country, or leave it on Any.`) : 0;
  const stateId = st ? await areaId('state', countryId, st, `Proxy302 does not list the state "${st}" in ${cc}. Check the spelling, or leave State blank.`) : 0;
  const cityId = ct ? await areaId('city', stateId, ct, `Proxy302 does not list the city "${ct}" in ${st}. Check the spelling, or leave City blank.`) : 0;
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const n = clampPoolCount(count, 5, MINTED_PULL_MAX);
  const url = `${PROXY302_API}/proxy/api/proxy/dynamic/traffic?${proxy302PurchaseQuery({ line, socks, countryId, stateId, cityId, lifeMin: life })}`;
  const rows = [];
  const seen = new Set();
  let started = 0;
  let dupes = 0;
  let failure = null;
  const worker = async () => {
    while (!failure && started < n && rows.length < n && dupes < 3) {
      started += 1;
      let row;
      try {
        const text = await httpRequestText(url, { method: 'POST', headers: auth });
        row = proxy302Row(text, { socks, country: cc });
      } catch (error) {
        failure = failure || error;
        return;
      }
      if (!row) continue;
      const key = `${row.host}:${row.port}:${row.username}`;
      if (seen.has(key)) { dupes += 1; continue; }
      seen.add(key); rows.push(row); dupes = 0;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROXY302_PARALLEL, n) }, worker));
  if (!rows.length) {
    // The API reference allows rotating on the Premium line in one place and not in another, so a
    // refusal of a Premium rotating purchase says which choice to change.
    if (failure && line === 'premium' && String(life == null ? '' : life).trim().toLowerCase() === 'rotating') {
      const said = String((failure && failure.message) || '').replace(/^Proxy302[^:]*:\s*/, '');
      throw new Error(`Proxy302 refused a rotating proxy on the Premium line${said ? ` (${said})` : ''}. Set Keep same IP to Proxy302's fixed time, or use the Standard line for rotating proxies.`);
    }
    if (failure) throw proxy302Failure(failure, 'Proxy302: the proxy request failed. Check the key has API access and traffic left.');
    throw new Error('Proxy302: the API returned no usable proxy. Check the key has traffic and API permission.');
  }
  return rows.slice(0, n);
}

// ---- Databay (residential / residential flex / mobile / datacenter) ----
// One gateway port carries HTTP and SOCKS5; zone, location and sticky session ride in the username.
const DATABAY_GATEWAY = Object.freeze({ host: 'gw.databay.co', port: 8888 });

async function fetchDatabayPool({ username, password, poolType, country, state, city, session, life, count, proxyType, host, port }) {
  const user = String(username || '').trim();
  const pw = password != null ? String(password) : '';
  if (!user) throw new Error('Databay: enter your proxy user (dashboard, Proxy Users), not the login email.');
  if (/@/.test(user)) throw new Error('Databay: that looks like the account email. Use the proxy user from the dashboard, Proxy Users.');
  if (!pw) throw new Error('Databay: enter the proxy user password.');
  const gw = gatewayOverride(host, port, DATABAY_GATEWAY, 'Databay');
  const zone = databayZone(poolType);
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const cc = normCountryCode(country);
  const kind = { residential: 'Residential', residential_FLEX: 'Residential Flex', mobile: 'Mobile', datacenter: 'Datacenter' }[zone];
  // State and City target Residential only; another pool takes a country (the form hides them there).
  if (zone !== 'residential' && (String(state || '').trim() || String(city || '').trim())) {
    throw new Error(`Databay: State and City work on Residential only. ${kind} takes a country; clear State and City.`);
  }
  const rows = mintGatewayRows({
    type: socks ? 'SOCKS5' : 'HTTP', host: gw.host, port: gw.port, password: pw, session, count, life,
    buildUser: (sid) => databayUsername(user, { zone, country: cc, state, city, session: sid, lengthMin: life }),
    label: `Databay • ${kind} • ${cc || 'Worldwide'}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('Databay: could not build any proxies.');
  return rows;
}

// ---- IPFoxy (rotating residential, gateway-minted) ----
// Targeting rides in the username; gate.ipfoxy.io, gate-sg.ipfoxy.io (Asia-Pacific) and
// gate-de.ipfoxy.io (Europe) go through the override. Every route reaches every exit country.
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
    type: socks ? 'SOCKS5' : 'HTTP', host: gw.host, port: gw.port, password: pw, session, count, life,
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
  const trafficType = MANGOPROXY_TRAFFIC.includes(String(poolType || '').toLowerCase()) ? String(poolType).toLowerCase() : 'residential';
  // Residential Light and dynamic datacenter target a country only (MangoProxy's product table).
  if ((trafficType === 'residential_light' || trafficType === 'datacenter') && (mangoProxyPlace(state) || mangoProxyPlace(city) || asnCode)) {
    throw new Error(`MangoProxy: ${trafficType === 'datacenter' ? 'Datacenter' : 'Residential light'} targets a country only. Clear State, City and ASN, or pick Residential or ISP.`);
  }
  let sub = String(username || '').trim();
  if (!sub) {
    const accounts = await mangoCall(key, 'GET', '/accounts');
    const first = Array.isArray(accounts) ? accounts.find((a) => a && a.username) : null;
    if (!first) throw new Error('MangoProxy: this account has no proxy sub-accounts yet. Create one in the dashboard, then pull again.');
    sub = String(first.username);
  }
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

// Countries the chosen pool can target, for the country picker. Read-only; the list endpoint
// documents no maximum page size (only count on /upstream/json has one), and meta says when to stop.
const MANGOPROXY_COUNTRY_PAGE = 100;
async function lookupMangoProxy({ token, groupby, poolType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('MangoProxy: paste your API key (dashboard, API).');
  if (groupby !== 'country') throw new Error('MangoProxy: only the country list can be loaded here.');
  const trafficType = MANGOPROXY_TRAFFIC.includes(String(poolType || '').toLowerCase()) ? String(poolType).toLowerCase() : 'residential';
  const geo = [];
  const seen = new Set();
  for (let page = 1; page <= 10; page += 1) {
    const res = mangoProxyCountryPage(await mangoCall(key, 'GET', `/locations/countries?trafficType=${trafficType}&limit=${MANGOPROXY_COUNTRY_PAGE}&page=${page}`));
    for (const c of res.countries) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      geo.push(c);
    }
    if (!res.more) break;
  }
  if (!geo.length) throw new Error(`MangoProxy lists no countries for ${trafficType.replace('_', ' ')} on this account.`);
  geo.sort((a, b) => a.label.localeCompare(b.label));
  return { provider: 'mangoproxy', geo };
}

// ---- Proxidize (api.proxidize.com/api/v1, Bearer JWT) ----
// Per-Proxy plans return ready credentials, page by page. Per-GB plans give an access point whose
// username carries a sticky "-s-<session>" and the geo, on pg.proxi.es (20000 HTTP / 20002 SOCKS5);
// a segment left out means random. Not live-key tested.
const PROXIDIZE_API = 'https://api.proxidize.com/api/v1';
const PROXIDIZE_PERGB_GATEWAY = Object.freeze({ host: 'pg.proxi.es', http: 20000, socks: 20002 });
// page_size has no documented maximum; the reply's perPage drives paging either way.
const PROXIDIZE_PAGE_SIZE = 100;

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

// The Per GB port: 20000 (HTTP) and 20002 (SOCKS5) follow the Protocol, so the prefilled 20000 never
// sends SOCKS5 to the HTTP port; any other port typed in the form (Proxy Details may show one) is used
// as typed.
function proxidizePerGbPort(port, socks) {
  const def = socks ? PROXIDIZE_PERGB_GATEWAY.socks : PROXIDIZE_PERGB_GATEWAY.http;
  const raw = String(port == null ? '' : port).trim();
  if (!raw) return def;
  const p = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('Proxidize: the port must be a number from 1 to 65535.');
  return p === PROXIDIZE_PERGB_GATEWAY.http || p === PROXIDIZE_PERGB_GATEWAY.socks ? def : p;
}

async function fetchProxidizePool({ token, username, host, port, country, state, city, session, count, poolType, proxyType }) {
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const user = String(username || '').trim();
  const cc = normCountryCode(country);
  if (user) {
    // Per-Proxy plan: fixed modems whose list already carries ready credentials.
    if (cc || String(state || '').trim() || String(city || '').trim() || String(session || '').trim()) {
      throw new Error('Proxidize: Per-Proxy modems are fixed when you buy them. Clear Country, State, City and Sticky session, or clear the username to use a Per-GB plan.');
    }
    const raw = String(count == null ? '' : count).trim();
    const want = /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : 0;
    const rows = await collectProxidizePerProxy(
      (page) => proxidizeCall(token, 'GET', `/perproxy/proxies/${encodeURIComponent(user)}?page=${page}&page_size=${PROXIDIZE_PAGE_SIZE}`, 'per-proxy list'),
      { socks, want }
    );
    if (!rows.length) throw new Error('Proxidize: no per-proxy proxies found for that username.');
    return rows.map((r) => ({
      type: r.type, host: r.host, port: r.port, username: r.username, password: r.password,
      label: `Proxidize • Mobile • ${r.ip || r.host} • port ${r.port}`,
      ...(r.rotationUrl ? { rotationUrl: r.rotationUrl } : {})
    }));
  }
  // Per-GB plan (mobile or residential): the username carries the geo and session.
  const kind = String(poolType || '').toLowerCase() === 'residential' ? 'residential' : 'mobile';
  if (kind === 'mobile' && cc && cc !== 'US') throw new Error('Proxidize: Mobile Per GB is United States only. Pick United States or Any, or switch Pool type to Residential.');
  if ((String(state || '').trim() || String(city || '').trim()) && !cc) throw new Error('Proxidize: pick a country before a state or city.');
  // Proxy Details may show the gateway IP instead of the hostname; either works.
  const gwHost = String(host || '').trim() || PROXIDIZE_PERGB_GATEWAY.host;
  if (/[\s/:@]/.test(gwHost)) throw new Error(`Proxidize: the gateway host must be a hostname like ${PROXIDIZE_PERGB_GATEWAY.host}, without http:// or a port.`);
  const gwPort = proxidizePerGbPort(port, socks);
  await proxidizeCall(token, 'GET', `/pergb/${kind}/user-info`, 'account check');
  const aps = await proxidizeCall(token, 'GET', `/pergb/${kind}/access-point`, 'access points');
  const apList = Array.isArray(aps) ? aps : (aps && Array.isArray(aps.data) ? aps.data : []);
  const ap = apList.find((x) => x && x.username && x.password) || null;
  if (!ap) throw new Error(`Proxidize: no ${kind} access point on this account. Create one in the dashboard, then pull again.`);
  const n = clampPoolCount(count, 1, MINTED_PULL_MAX);
  const rows = [];
  const seen = new Set();
  const fixed = String(session || '').trim();
  const kindLabel = kind === 'residential' ? 'Residential' : 'Mobile';
  for (let i = 0; i < n; i++) {
    const sid = fixed ? (n > 1 ? `${fixed}${i}` : fixed) : crypto.randomBytes(5).toString('hex');
    const uname = proxidizePerGbUsername(String(ap.username), { session: sid, country: cc, state, city, residential: kind === 'residential' });
    const key = `${gwHost}:${gwPort}:${uname}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      type: socks ? 'SOCKS5' : 'HTTP',
      host: gwHost, port: gwPort, username: uname, password: String(ap.password),
      label: `Proxidize • ${kindLabel} • ${cc || 'Any country'} • sticky`,
      country: cc || null
    });
  }
  if (!rows.length) throw new Error('Proxidize: could not build any per-GB proxies.');
  return rows;
}

// ---- Live Proxies ----
// A pasted plan list URL already carries the access code, so a Bearer token is sent only if given.
async function fetchLiveProxiesPool({ apiUrl, token, username, password, country, session, count, proxyType, poolType }) {
  // Gateway mode (what the dashboard actually offers): username LV<id> + proxy password.
  if (String(username || '').trim()) return mintLiveProxiesRows({ username, password, country, session, count, proxyType });
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
// row; otherwise sticky rows, each on its own b2b-s<N> server with a numeric session (held up to 60
// minutes on residential, 30 on mobile). The gateway logins are Live Proxies' B2B residential ones;
// how a B2B login asks for static or mobile IPs is not published, so the form offers no pool type.
// A typed session is 1 to 8 digits and is used as typed on one row; with How many above 1 each row
// adds its number to it. Anything else is refused with a message, never trimmed.
function mintLiveProxiesRows({ username, password, country, session, count, proxyType }) {
  const acct = liveProxiesBaseUser(username);
  const pw = password != null ? String(password) : '';
  if (!acct) throw new Error('Live Proxies: enter the username from the dashboard (Proxy Information, for example LV00000).');
  if (!pw) throw new Error('Live Proxies: enter the proxy password from the dashboard (Proxy Information).');
  const cc = normCountryCode(country);
  if (!cc) throw new Error('Live Proxies: pick a country. Every Live Proxies line carries one (for example United States).');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const kind = 'Residential';
  const n = clampPoolCount(count, 1, MINTED_PULL_MAX);
  const typed = String(session == null ? '' : session).trim();
  if (typed && !/^\d+$/.test(typed)) throw new Error(`Live Proxies: a sticky session is digits only (1 to ${LIVEPROXIES_SID_MAX}), as in the dashboard. Type digits such as 123456, or leave it blank.`);
  if (typed.length > LIVEPROXIES_SID_MAX) throw new Error(`Live Proxies: a sticky session is at most ${LIVEPROXIES_SID_MAX} digits.`);
  if (typed && n > 1 && `${typed}${n}`.length > LIVEPROXIES_SID_MAX) {
    throw new Error(`Live Proxies: with How many ${n}, each row adds its number to the session, which would run past ${LIVEPROXIES_SID_MAX} digits. Type a shorter session, or leave it blank for random ones.`);
  }
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
  // The session id picks the exit IP, so two rows must never share one.
  const used = new Set();
  const randomSid = () => {
    let s;
    do { s = String(100000 + crypto.randomInt(0, 900000)); } while (used.has(s));
    used.add(s);
    return s;
  };
  for (let i = 0; i < n; i++) {
    // A typed session is used as typed on one row and gets the row number on several; a blank one
    // gets a random 6-digit id per row, like the dashboard.
    const sid = typed ? (n > 1 ? `${typed}${i + 1}` : typed) : randomSid();
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
  iproyal: lookupIpRoyal,
  mangoproxy: lookupMangoProxy,
  resiprox: lookupResiProx,
  simplynode: lookupSimplyNode,
  node4: lookupNode4,
  proxyempire: lookupProxyEmpire
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
    groupby: optionalString(input.groupby),
    // MangoProxy's country list depends on the pool.
    poolType: optionalString(input.poolType)
  });
}

// ---- Provider account status (plan, expiry, traffic, balance) for the provider card ----
// Uses the saved credentials and returns only the summary, never a secret. The last result per
// provider is kept in the providerAccountCache setting, which only this gated handler reads.
// readSavedProviderCreds is main-only: the account check and a provider-API rotation
// (PROVIDER_ROTATORS) read the opened credentials here; they never go back to the window. An entry
// with no key or login (hasProxyProviderKey) is nothing saved.
async function readSavedProviderCreds(provider) {
  const stored = (await readProxyProviderCredMap())[String(provider || '').toLowerCase()];
  if (!hasProxyProviderKey(stored)) return null;
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
// HTTPS (the default, TLS to the gateway), HTTP or SOCKS5 is set per proxy in the 2extract dashboard
// (Connection Helper) on one port, so Protocol must match it. HTTPS rows are proxies reached over TLS,
// which the app uses since 1.0.26. The /change_ip link carries the proxy password, so it is never
// stored. Not live-key tested.
const TWOEXTRACT_GATEWAY = Object.freeze({ host: 'proxy.2extract.net', port: 5555 });

async function fetchTwoExtractPool({ username, password, country, state, city, zip, asn, session, life, count, proxyType, host, port }) {
  const pw = password != null ? String(password) : '';
  if (!twoExtractBaseUser(username)) throw new Error('2extract: enter the proxy username from Connection Details. It looks like 2xt-customer-<id>-proxy-<name>.');
  if (!pw) throw new Error('2extract: enter the proxy password from Connection Details.');
  const gw = gatewayOverride(host, port, TWOEXTRACT_GATEWAY, '2extract');
  const proto = String(proxyType || '').toLowerCase();
  const cc = normCountryCode(country);
  const asnTag = String(asn || '').trim();
  const lifeMin = String(life == null ? '' : life).trim();
  // A chosen Keep same IP makes even one row sticky (gatewayPullPlan).
  const rows = mintGatewayRows({
    type: proto === 'socks5' ? 'SOCKS5' : (proto === 'https' ? 'HTTPS' : 'HTTP'), host: gw.host, port: gw.port, password: pw, session, count, life: lifeMin, max: MINTED_PULL_MAX,
    buildUser: (sid) => twoExtractUsername(username, { country, state, city, zip, asn, session: sid, timeMin: sid ? lifeMin : '' }),
    label: `2extract • ${cc || (asnTag ? `ASN ${asnTag}` : 'Worldwide')}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('2extract: could not build any proxies.');
  return rows;
}

// ---- GonzoProxy (residential, mobile, datacenter; gateway-minted) ----
// Geo and session ride in the login. One row with no session rotates per request; more rows are
// sticky for Keep same IP (72h if blank). The pool is whatever the login belongs to (its selector
// parameter is undocumented), so the app cannot tell a mobile login, whose pool has no cities; the hint
// says to leave City blank there. Not live-key tested.
const GONZOPROXY_GATEWAY = Object.freeze({ host: 'connect.gonzoproxy.app', port: 10000 });

async function fetchGonzoProxyPool({ username, password, country, state, city, session, life, count, proxyType, host, port }) {
  const pw = password != null ? String(password) : '';
  if (!gonzoProxyBaseLogin(username)) throw new Error('GonzoProxy: enter the login from Proxy Setup in your dashboard (letters and digits, for example Gonzoj9CiIi).');
  if (!pw) throw new Error('GonzoProxy: enter the proxy password from Proxy Setup.');
  const gw = gatewayOverride(host, port, GONZOPROXY_GATEWAY, 'GonzoProxy');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const cc = normCountryCode(country);
  const lifeMin = String(life == null ? '' : life).trim();
  // A chosen Keep same IP makes even one row sticky (gatewayPullPlan).
  const rows = mintGatewayRows({
    type: socks ? 'SOCKS5' : 'HTTP', host: gw.host, port: gw.port, password: pw, session, count, life: lifeMin, max: MINTED_PULL_MAX,
    buildUser: (sid) => gonzoProxyUsername(username, { country, state, city, session: sid, ttlMin: sid ? lifeMin : '' }),
    label: `GonzoProxy • ${cc || 'Unknown'}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('GonzoProxy: could not build any proxies.');
  return rows;
}

// ---- Simply Proxies (UK mobile, gateway-minted) ----
// SOCKS5 on :6890, which sends the proxy password in clear text (RFC 1929), as Simply Proxies' docs say
// and the hint repeats. Its HTTPS endpoint :6889 (TLS to the proxy) holds a sticky IP for a fixed 12
// hours, so Keep same IP would not apply there; it is not offered yet. Not live-key tested.
const SIMPLYPROXIES_GATEWAY = Object.freeze({ host: 'proxy.simplyproxies.com', socks: 6890 });

async function fetchSimplyProxiesPool({ username, password, poolType, country, session, life, count }) {
  const pw = password != null ? String(password) : '';
  if (!String(username || '').trim()) throw new Error('Simply Proxies: enter the proxy username from your dashboard.');
  if (!pw) throw new Error('Simply Proxies: enter the proxy password from your dashboard.');
  const cc = String(country || '').trim().toUpperCase();
  if (cc && cc !== 'GB') throw new Error(`Simply Proxies only has UK exits, not ${cc}.`);
  const minutes = String(life == null ? '' : life).trim();
  // A chosen Keep same IP makes even one row sticky (gatewayPullPlan).
  const net = String(poolType || '').toLowerCase();
  const rows = mintGatewayRows({
    type: 'SOCKS5', host: SIMPLYPROXIES_GATEWAY.host, port: SIMPLYPROXIES_GATEWAY.socks, password: pw, session, count, life: minutes, max: MINTED_PULL_MAX,
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
// One proxy per modem the account owns, each with its own data allowance; more IPs come from
// rotating a modem (its rotation link), more proxies only from buying more on the vendor's site.
// The vendor sells Singapore only, so every row is SG from the start.
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
// Reads existing lists and their text exports; nothing is bought. HTTP and SOCKS5 share each line's
// host and port (Gsocks' help guides), so Protocol sets the row type. Targeting is fixed when a list is
// made in the Gsocks panel. Not live-key tested.
// Auth (gsocksAuthSchemes): the API page's rule says "authorization: key <api_key>", its curl samples
// send "session <jwt>". The first request tries the rule (or session first for a key that is a JWT),
// and on 401/403 tries the other form once; the form that works is kept for the rest of the pull.
const GSOCKS_API = 'https://api.gsocks.net';
// GET /proxy documents no maximum page size, so pages use the size from its own example.
const GSOCKS_PAGE_SIZE = 20;
const GSOCKS_MAX_PAGES = 50;
const GSOCKS_POOLS = Object.freeze({
  residential: { query: 'residential', path: 'residential-proxy-list', kind: 'Residential' },
  mobile: { query: 'mobile', path: 'mobile-proxy-list', kind: 'Mobile' }
});

async function fetchGsocksPool({ token, poolType, count, proxyType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('Gsocks: paste the API key from your dashboard.');
  const pool = GSOCKS_POOLS[String(poolType || '').toLowerCase()];
  if (!pool) throw new Error('Gsocks: pick Residential or Mobile. Other types have no documented proxy list to import.');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  let schemes = gsocksAuthSchemes(key);
  let settled = false;
  const call = async (url) => {
    for (;;) {
      try {
        const text = await httpRequestText(url, { headers: { authorization: `${schemes[0]} ${key}`, Accept: 'application/json, text/plain' }, maxBytes: 8_000_000 });
        settled = true;
        return text;
      } catch (error) {
        const status = error && error.status;
        if ((status === 401 || status === 403) && !settled && schemes.length > 1) { schemes = schemes.slice(1); continue; }
        if (status === 401 || status === 403) throw new Error('Gsocks rejected the API key in both header forms its docs show ("key" and "session"). Create a new key in your dashboard and paste it again; if it still fails, tell SoftGlaze support.');
        if (status === 429) throw new Error('Gsocks: too many requests. Wait a moment and pull again.');
        throw new Error('Gsocks: could not read the proxy list. Check your connection and try again.');
      }
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
  if (!ids.length) throw new Error('Gsocks: the account returned proxies without the id the app reads, so their lists cannot be fetched. Tell SoftGlaze support, so the connector can follow Gsocks\' current API.');
  const cap = /^[1-9]\d*$/.test(String(count == null ? '' : count).trim()) ? Number(count) : Infinity;
  const rows = [];
  const seen = new Set();
  for (const id of ids) {
    if (rows.length >= cap) break;
    for (const r of gsocksListRows(await call(`${GSOCKS_API}/proxy/${pool.path}/${encodeURIComponent(id)}`), { kind: pool.kind, id, socks })) {
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
// One API key returns every IP on the active plans. Not live-key tested. An IP without a login (a plan
// set to IP authorization only, if the API sends those without one) is left out, and a pull that finds
// only such IPs says so instead of reporting a protocol problem.
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
  const { rows, error, total, noLogin } = proxyBonanzaRows(text, { socks });
  if (error) throw new Error(`Proxy Bonanza: ${error}`);
  if (!rows.length) {
    if (total && noLogin === total) throw new Error(`Proxy Bonanza: the ${total === 1 ? 'IP' : `${total} IPs`} on your plans came without a login and password, which a plan set to IP authorization only does. The app imports proxies that use a login: turn on login and password authentication for the plan in the user panel, then pull again.`);
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

// ---- Node4 (gateway builder + static list) ----
// An n4k_ API key with read:proxies. Residential, Rotating Datacenter and Rotating Unmetered logins are
// built by Node4 (POST /gateways/endpoint, 100 a call); Static Datacenter lists the IPs the account
// owns (GET /proxies/list). Never called: replace, refresh, credentials or sub-user writes, orders,
// top-ups. Not live-key tested.
const NODE4_API = 'https://node4.io/api/v1';
const NODE4_KEY = /^n4k_[A-Za-z0-9_-]{8,200}$/;
// 60 requests a minute per key: a pull of 1000 is 10 calls, spaced so it stays well inside that.
const NODE4_MAX_CALLS = 10;
const NODE4_CALL_GAP_MS = 1100;

async function node4Call(key, method, pathName, body, productName = '') {
  let text;
  try {
    text = await httpRequestText(`${NODE4_API}${pathName}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: 30000,
      maxBytes: 8_000_000
    });
  } catch (error) {
    const status = error && error.status;
    const raw = String((error && error.message) || '');
    if (status === 401) throw new Error('Node4 rejected the API key, or it expired. Create a new one with the read:proxies permission.');
    if (status === 403) throw new Error('Node4: this key lacks the read:proxies permission. Create a key with it.');
    if (status === 429) {
      // httpRequestText keeps Retry-After as error.retryAfter; Node4 also puts retryAfterSeconds in the body.
      const s = retryAfterSeconds(error.headers || { 'retry-after': error.retryAfter }, raw);
      throw new Error(`Node4: too many requests (60 a minute per key). Wait ${s || 60} seconds and pull again.`);
    }
    if (status === 404 && productName) throw new Error(`Node4: this account has no active ${productName} plan.`);
    if (status === 409) throw new Error('Node4: the proxy login is over its monthly limit, or there is no active login.');
    if (status === 422 || status === 400) {
      // Node4's own words, which list the countries a product serves; the key is never in them.
      const m = /"error"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
      const why = m ? m[1].replace(/\\(.)/g, '$1').split(key).join('***').replace(/[.\s]+$/, '').slice(0, 200) : 'the request was refused';
      throw new Error(`Node4: ${why}.`);
    }
    if (status) throw new Error(`Node4: the API answered HTTP ${status}. Try again later.`);
    throw new Error('Node4: could not reach the API. Check your connection and try again.');
  }
  try { return JSON.parse(text); } catch (e) { throw new Error('Node4: the API did not return JSON.'); }
}

async function fetchNode4Pool({ token, poolType, country, state, city, asn, count, proxyType }) {
  const key = String(token || '').trim();
  if (!NODE4_KEY.test(key)) throw new Error('Node4: paste an API key from Account Settings, API & Webhooks. It starts with n4k_.');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const pool = String(poolType || 'residential').toLowerCase();
  if (pool === 'static') {
    if (String(state || '').trim() || String(city || '').trim() || String(asn || '').trim()) {
      throw new Error('Node4: state, city and ASN work on Residential only. Clear them for this pool.');
    }
    const rawCountry = String(country || '').trim();
    const cc = normCountryCode(rawCountry);
    if (rawCountry && !cc) throw new Error(`Node4: "${rawCountry}" is not a country code.`);
    const json = await node4Call(key, 'GET', '/proxies/list?format=json&fields=host,port,username,password,protocol,type,country');
    const res = node4StaticRows(json, { socks });
    if (!res.rows.length) {
      if (res.total && res.noLogin && !res.skippedProtocol) throw new Error('Node4: your static proxies have no username and password (the free tier uses IP authorization). Set a login in the dashboard, then pull again.');
      if (res.skippedProtocol) throw new Error(`Node4: none of your static proxies is listed for ${socks ? 'SOCKS5' : 'HTTP'}. Switch Protocol and pull again.`);
      throw new Error('Node4: no active static proxies on this account.');
    }
    const picked = cc ? res.rows.filter((r) => r.country === cc) : res.rows;
    if (!picked.length) {
      const have = [...new Set(res.rows.map((r) => r.country).filter(Boolean))].join(', ');
      throw new Error(`Node4: no static proxies in ${cc} on this account.${have ? ` You have ${have}.` : ''}`);
    }
    return limitListRows(picked, count, Infinity);
  }
  const product = NODE4_GATEWAY_PRODUCTS[pool];
  if (!product) throw new Error('Node4: pick Residential, Rotating Datacenter, Rotating Unmetered or Static Datacenter.');
  // How many 1 is one rotating login (a new exit per connection); more are sticky, one session each.
  const want = clampPoolCount(count, 1, MINTED_PULL_MAX);
  const sticky = want > 1;
  const cc = normCountryCode(country);
  // Validates the targeting before any call (state, city and ASN are Residential only).
  node4GatewayBody({ pool, socks, country, state, city, asn, count: want, sticky });
  const rows = [];
  const seen = new Set();
  for (let call = 0; call < NODE4_MAX_CALLS && rows.length < want; call += 1) {
    if (call > 0) await sleepMs(NODE4_CALL_GAP_MS);
    const body = node4GatewayBody({ pool, socks, country, state, city, asn, count: Math.min(NODE4_CALL_MAX, want - rows.length), sticky });
    const json = await node4Call(key, 'POST', '/gateways/endpoint', body, product.name);
    let added = 0;
    for (const r of node4GatewayRows(json, { socks, name: product.name, country: cc })) {
      const k = `${r.host}:${r.port}:${r.username}:${r.password}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(r);
      added += 1;
    }
    if (!sticky || !added) break;
  }
  if (!rows.length) throw new Error(`Node4 returned no ${product.name} login for that location. Try a wider location.`);
  return rows.slice(0, want);
}

// Load countries: Residential from GET /geo/countries; the datacenter products serve the plan's
// countries (US, Italy, Spain), so no call is made for them.
const NODE4_DATACENTER_COUNTRIES = Object.freeze(['US', 'IT', 'ES']);

async function lookupNode4({ token, groupby, poolType }) {
  const key = String(token || '').trim();
  if (!NODE4_KEY.test(key)) throw new Error('Node4: paste an API key from Account Settings, API & Webhooks. It starts with n4k_.');
  if (groupby !== 'country') throw new Error('Node4: only the country list can be loaded here.');
  if (String(poolType || 'residential').toLowerCase() !== 'residential') {
    return { provider: 'node4', geo: NODE4_DATACENTER_COUNTRIES.map((code) => ({ key: code })) };
  }
  const geo = node4Countries(await node4Call(key, 'GET', '/geo/countries', null, 'Residential'));
  if (!geo.length) throw new Error('Node4 lists no Residential countries for this account.');
  return { provider: 'node4', geo };
}

// ---- ProxyEmpire (proxy-list generator) ----
// A Bearer API token (panel, Settings, API Tokens). GET /user checks the package for the pool, then
// POST /proxy-list returns ready user:pass@host:port lines. Never called: rotate-session, bandwidth
// moves, sub-users, ISP orders and renewals. Not live-key tested.
const PROXYEMPIRE_API = 'https://panel.proxyempire.io/api/v2';

async function proxyEmpireCall(token, method, pathName, body, poolName) {
  let text;
  try {
    text = await httpRequestText(`${PROXYEMPIRE_API}${pathName}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: 30000,
      maxBytes: 8_000_000
    });
  } catch (error) {
    throw new Error(proxyEmpireErrorMessage(error, poolName));
  }
  try { return JSON.parse(text); } catch (e) { throw new Error('ProxyEmpire: the API did not return JSON.'); }
}

async function fetchProxyEmpirePool({ token, poolType, country, state, city, zip, asn, count, life, proxyType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('ProxyEmpire: paste an API token from Settings, API Tokens in the panel.');
  const pool = String(poolType || 'residential').toLowerCase();
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  // Throws, before any call, on targeting the pool refuses.
  const plan = proxyEmpireBody({ pool, country, state, city, zip, asn, count, life, max: MINTED_PULL_MAX });
  const { found, slot } = proxyEmpireSlot(await proxyEmpireCall(key, 'GET', '/user', null, plan.name), pool);
  if (!found) throw new Error('ProxyEmpire: the account details came back in an unexpected shape. Try again later.');
  if (!slot) throw new Error(`ProxyEmpire: this account has no ${plan.name} package.`);
  const bw = slot.bandwidth && typeof slot.bandwidth === 'object' ? slot.bandwidth : {};
  if (Number(bw.total) > 0 && bw.remaining != null && Number(bw.remaining) <= 0) {
    throw new Error(`ProxyEmpire: your ${plan.name} package has no traffic left. Top it up in the panel.`);
  }
  const avail = slot.provider_availability && typeof slot.provider_availability === 'object' ? slot.provider_availability : {};
  if (['unavailable', 'circuit_open'].includes(String(avail.state || '').toLowerCase())) {
    const why = String(avail.message || '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '').slice(0, 160);
    throw new Error(`ProxyEmpire: ${plan.name} is unavailable right now${why ? ` (${why})` : ''}. Try again later.`);
  }
  const res = await proxyEmpireCall(key, 'POST', '/proxy-list', plan.body, plan.name);
  const lines = Array.isArray(res && res.proxies) ? res.proxies.map((l) => String(l)) : [];
  const parsed = parseLoginList(lines.join('\n'));
  if (!parsed.length) throw new Error('ProxyEmpire returned no proxies for that location. Try a wider location.');
  const sent = String(plan.body.country || '').toUpperCase();
  const cc = sent === 'UK' ? 'GB' : sent;
  const how = { random: 'rotating', sticky: 'sticky', custom: `${plan.lifeMin} min`, fixed: 'static' }[plan.mode];
  return parsed.slice(0, plan.body.length).map((r, i) => ({
    type: socks ? 'SOCKS5' : 'HTTP',
    host: r.host, port: r.port, username: r.username, password: r.password,
    label: `ProxyEmpire • ${plan.name} • ${cc || 'Any country'} • ${how} • #${i + 1}`,
    country: cc || null,
    dedupeOnPassword: false
  }));
}

async function lookupProxyEmpire({ token, groupby, poolType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('ProxyEmpire: paste an API token from Settings, API Tokens in the panel.');
  if (groupby !== 'country') throw new Error('ProxyEmpire: only the country list can be loaded here.');
  const pool = PROXYEMPIRE_POOLS[String(poolType || '').toLowerCase()] || PROXYEMPIRE_POOLS.residential;
  const geo = proxyEmpireCountries(await proxyEmpireCall(key, 'GET', `/countries?connection_type=${encodeURIComponent(pool.type)}`, null, pool.name));
  if (!geo.length) throw new Error(`ProxyEmpire lists no countries for ${pool.name} on this account.`);
  return { provider: 'proxyempire', geo };
}

// ---- MountProxies (dedicated US 4G/5G modems, list pull + Rotate IP by API) ----
// The account API key travels in the query string, so every failure maps to a fixed message that never
// echoes the URL, and no key is stored on a row: Rotate IP reads the saved key (rotateMountProxies).
// Never called: update_credentials, rotation_time, change_location, speed tests. Not live-key tested.
const MOUNTPROXIES_API = 'https://api.mountproxies.com/api';
const MOUNTPROXIES_KEY = /^[A-Za-z0-9_-]{8,200}$/;

// GET /proxies with the key in the query string. A failure keeps only its status (never the URL).
async function mountProxiesFetchList(key) {
  try {
    return await httpRequestText(`${MOUNTPROXIES_API}/proxies?api_key=${encodeURIComponent(key)}&output=json`, { headers: { Accept: 'application/json' }, timeoutMs: 20000, maxBytes: 8_000_000 });
  } catch (error) {
    throw Object.assign(new Error('MountProxies: the proxy list could not be read.'), { status: error && error.status });
  }
}

async function fetchMountProxiesPool({ token, count }) {
  const key = String(token || '').trim();
  if (!MOUNTPROXIES_KEY.test(key)) throw new Error('MountProxies: paste the API key from your account page.');
  let text;
  try {
    text = await mountProxiesFetchList(key);
  } catch (error) {
    if (error.status === 401 || error.status === 403) throw new Error('MountProxies rejected the API key. Copy it again from your account page.');
    if (error.status === 429) throw new Error('MountProxies: too many requests. Wait a minute and pull again.');
    throw new Error('MountProxies: could not read the proxy list. Check your connection and try again.');
  }
  const res = mountProxiesRows(text);
  if (res.error) throw new Error(res.error);
  if (!res.rows.length) {
    if (res.noLogin && res.noLogin + res.expired >= res.total) throw new Error('MountProxies: your proxies use IP authorization only. Set a username and password in the dashboard, then pull again.');
    throw new Error('MountProxies: no active proxies on this account.');
  }
  return limitListRows(res.rows, count, Infinity);
}

// Rotate IP for a pulled MountProxies modem: the saved key lists the proxies, the stored row is matched
// by IP, port and username to its subscription_key, and GET /subscription/<key>/rotate_ip asks for a new
// IP (about 10 seconds). A 404 there retries once with the V1 path and the modem_key, as the help article
// does. Errors are fixed messages or MountProxies' own reply, with the key masked.
async function rotateMountProxies(proxy) {
  const saved = await readSavedProviderCreds('mountproxies');
  const key = String((saved && saved.token) || '').trim();
  if (!key) throw new Error('MountProxies: Rotate IP uses your saved API key. Save it on the Proxy providers page (MountProxies, Save credentials), then try again.');
  if (!MOUNTPROXIES_KEY.test(key)) throw new Error('MountProxies: the saved API key does not look right. Save it again on the Proxy providers page.');
  const started = Date.now();
  let listText;
  try {
    listText = await mountProxiesFetchList(key);
  } catch (error) {
    if (error.status === 401 || error.status === 403) throw new Error('MountProxies rejected the saved API key. Save it again on the Proxy providers page.');
    if (error.status === 429) throw new Error('MountProxies: too many requests. Wait a minute before the next rotation.');
    throw new Error('MountProxies: could not read the proxy list to find this proxy. Check your connection and try again.');
  }
  const target = mountProxiesRotateTarget(listText, proxy);
  if (!target) throw new Error('MountProxies: this proxy is no longer on your account, or its login changed. Pull again from the Proxy providers page, then rotate.');
  const vendorSays = (error) => {
    const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(String((error && error.message) || ''));
    return m ? m[1].replace(/\\(.)/g, '$1').split(key).join('***').replace(/[.\s]+$/, '').slice(0, 200) : '';
  };
  const call = (pathName) => httpRequestText(`${MOUNTPROXIES_API}${pathName}?api_key=${encodeURIComponent(key)}`, { headers: { Accept: 'application/json' }, timeoutMs: 30000 });
  let text;
  let via = 'V2';
  try {
    if (!target.subscriptionKey) throw Object.assign(new Error('no subscription key'), { status: 404 });
    text = await call(`/subscription/${encodeURIComponent(target.subscriptionKey)}/rotate_ip`);
  } catch (error) {
    let failed = error;
    if (error && error.status === 404 && target.modemKey) {
      try {
        text = await call(`/proxy/${encodeURIComponent(target.modemKey)}/rotate_ip`);
        via = 'V1';
        failed = null;
      } catch (e) { failed = e; }
    }
    if (failed) {
      const status = failed && failed.status;
      if (status === 401 || status === 403) throw new Error('MountProxies rejected the saved API key. Save it again on the Proxy providers page.');
      if (status === 404) throw new Error('MountProxies could not find this proxy to rotate. Rotate it from the MountProxies dashboard.');
      if (status === 429) throw new Error('MountProxies: too many requests. Wait a minute before the next rotation.');
      const why = vendorSays(failed);
      if (status) throw new Error(`MountProxies refused the rotation${why ? `: ${why}` : ` (HTTP ${status})`}. After a failed rotation, wait at least one minute before trying again.`);
      throw new Error('MountProxies: could not reach the API. Check your connection and try again.');
    }
  }
  let message = '';
  try { const body = JSON.parse(text); message = body && body.message != null ? String(body.message) : ''; } catch (e) { message = ''; }
  message = message.split(key).join('***').replace(/\s+/g, ' ').trim().slice(0, 200);
  return { ok: true, status: 200, latencyMs: Date.now() - started, response: `${message || 'Rotation requested'} (${via})`, provider: 'mountproxies' };
}

// ---- Massive (residential + ISP, gateway-minted) ----
// network.joinmassive.com (HTTP 65534, SOCKS5 65533) with the targeting in the username; the proxy
// password is the account's API token. ISP is isp.joinmassive.com:8000 for both protocols, with no
// targeting. No API call: the rows are built here. Not live-key tested.
const MASSIVE_GATEWAYS = Object.freeze({
  residential: { host: 'network.joinmassive.com', http: 65534, socks: 65533 },
  isp: { host: 'isp.joinmassive.com', http: 8000, socks: 8000 }
});
const MASSIVE_POOLS = Object.freeze({
  residential: { name: 'Residential', type: '' },
  residential_mobile: { name: 'Residential mobile', type: 'mobile' },
  isp: { name: 'ISP', type: '', isp: true }
});

async function fetchMassivePool({ username, password, poolType, country, state, city, zip, asn, session, life, count, proxyType, host, port }) {
  const base = massiveBaseUser(username);
  if (!base) throw new Error('Massive: enter the proxy username from your Massive dashboard (Profile).');
  if (/[\s:]/.test(base)) throw new Error('Massive: the proxy username has no spaces or colons. Copy it again from your Massive dashboard (Profile).');
  const pw = password != null ? String(password) : '';
  if (!pw.trim() || /\s/.test(pw)) throw new Error('Massive: enter your Massive API token as the proxy password (dashboard, Profile).');
  const pool = MASSIVE_POOLS[String(poolType || '').toLowerCase()] || MASSIVE_POOLS.residential;
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const rawCountry = String(country || '').trim();
  const cc = normCountryCode(rawCountry);
  if (rawCountry && !cc) throw new Error(`Massive: "${rawCountry}" is not a country code.`);
  const st = String(state || '').trim();
  const ct = String(city || '').trim();
  const z = String(zip || '').trim();
  const a = String(asn || '').trim().replace(/^AS/i, '');
  if (pool.isp) {
    if (cc || st || ct || z || a) throw new Error('Massive: ISP proxies take no location. Clear Country, State, City, ZIP and ASN.');
  } else if ((st || ct || z || a) && !cc) {
    throw new Error('Massive: pick a country before a state, city, ZIP or ASN.');
  }
  if (a && !/^\d{1,10}$/.test(a)) throw new Error('Massive: an ASN is digits only, for example 7922.');
  if (z && !/^[A-Za-z0-9 -]{2,12}$/.test(z)) throw new Error(`Massive: "${z}" is not a ZIP code.`);
  const sess = String(session || '').trim();
  if (sess && !/^[A-Za-z0-9_]{1,200}$/.test(sess)) throw new Error('Massive: a sticky session name is letters, digits and _ only.');
  // ISP always uses isp.joinmassive.com:8000. On Residential a typed host wins (a regional host), and
  // the port follows the protocol unless one other than 65534 or 65533 was typed.
  let gw;
  if (pool.isp) {
    gw = { host: MASSIVE_GATEWAYS.isp.host, port: MASSIVE_GATEWAYS.isp.http };
  } else {
    const def = MASSIVE_GATEWAYS.residential;
    const protoPort = socks ? def.socks : def.http;
    const typed = port != null && String(port).trim() !== '' ? Number.parseInt(String(port), 10) : null;
    const usePort = typed == null || typed === def.http || typed === def.socks ? protoPort : port;
    gw = gatewayOverride(host, usePort, { host: def.host, port: protoPort }, 'Massive');
  }
  // ISP sessions do not expire, so Keep same IP applies to Residential only.
  const lifeMin = pool.isp ? '' : String(life == null ? '' : life).trim();
  const rows = mintGatewayRows({
    type: socks ? 'SOCKS5' : 'HTTP', host: gw.host, port: gw.port, password: pw, session: sess, count, life: lifeMin, max: MINTED_PULL_MAX,
    buildUser: (sid) => massiveUsername(base, { type: pool.type, country: cc, subdivision: st, city: ct, zip: z, asn: a, session: sid, ttlMin: sid ? lifeMin : '' }),
    label: `Massive • ${pool.name} • ${cc || 'Any country'}`
  }).map((r) => ({ ...r, country: cc || null }));
  if (!rows.length) throw new Error('Massive: could not build any proxies.');
  return rows;
}

// ---- iProxy.online (your own phones, list pull) ----
// A user API key (dashboard) lists the proxy accesses on the user's Android phones and each phone's
// change-IP link, which becomes the proxy's rotation link (it carries a link id, not the key). Never
// called: POST /me/api-key (it would void the key), creating or deleting accesses or links,
// command-push, VPN configs, credential exports. Not live-key tested.
const IPROXY_API = 'https://iproxy.online/api/console/v1';

async function fetchIproxyPool({ token, count, proxyType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('iProxy.online: paste the user API key from your dashboard.');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const call = async (pathName) => {
    try {
      return await httpRequestText(`${IPROXY_API}${pathName}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, timeoutMs: 20000, maxBytes: 8_000_000 });
    } catch (error) {
      const status = error && error.status;
      let message = 'iProxy.online: could not read your proxy accesses. Check your connection and try again.';
      if (status === 401) message = 'iProxy.online rejected the API key. If you generated a new one, the old one stopped working.';
      else if (status === 403) message = 'iProxy.online refused this API key (Forbidden). Check the user API key in your dashboard.';
      else if (status === 429) message = 'iProxy.online: too many requests. Wait a minute and pull again.';
      throw Object.assign(new Error(message), { status });
    }
  };
  const accesses = await call('/proxy-access');
  // The links and the phone names only enrich the rows: without them the proxies still work, with no
  // Rotate IP link and no country until a health check. A refused key still stops the pull; a 404
  // tries the next path.
  const optional = async (...paths) => {
    for (const p of paths) {
      try {
        return await call(p);
      } catch (e) {
        if ([401, 403, 429].includes(e.status)) throw e;
        if (e.status !== 404) return '';
      }
    }
    return '';
  };
  const links = await optional('/actionlinks?action=changeip');
  // The Swagger names /connections, the guide /connection.
  const phones = await optional('/connections', '/connection');
  const res = iproxyRows(accesses, links, phones, { socks, key });
  const proto = socks ? 'SOCKS5' : 'HTTP';
  if (!res.rows.length) {
    if (res.noAuth && !res.wrongProtocol) throw new Error('iProxy.online: your proxy accesses use no login (IP restriction only). Add one with a username and password.');
    if (res.total && res.inactive === res.total) throw new Error('iProxy.online: your proxy accesses are turned off or expired. Turn one on in the dashboard, then pull again.');
    throw new Error(`iProxy.online: none of your phones has a ${proto} proxy access with a login. Create one in the dashboard.`);
  }
  const out = limitListRows(res.rows, count, Infinity);
  // Shown under the pull result: proxies of a phone without a change-IP link were added without one.
  if (res.noLinkPhones) out.notice = { code: 'noChangeIpLink', count: res.noLinkPhones };
  return out;
}

// ---- ProxyBrazil (dedicated 4G mobile in Brazil, list pull) ----
// The Partner API for profile browsers: a pb_live_ key (Integrations, App: SoftGlaze) lists the
// account's proxies, 200 a page. Each keeps its rotation_url, a per-proxy link that needs no key, for
// Rotate IP (65 seconds, ROTATION_LINK_TIMEOUT_MS; refusals explained by proxyBrazilRotateRefusal).
// Read-only: the API rotate call is never used. Not tested with a live key.
const PROXYBRAZIL_API = 'https://api.proxybrazil.com/v1';
const PROXYBRAZIL_PAGE_SIZE = 200; // per_page runs from 1 to 200
const PROXYBRAZIL_MAX_PAGES = 10;

async function fetchProxyBrazilPool({ token, count, proxyType }) {
  const key = String(token || '').trim();
  if (!PROXYBRAZIL_KEY.test(key)) throw new Error('ProxyBrazil: paste the API key from Integrations in your dashboard. It starts with pb_live_.');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const rows = [];
  const seen = new Set();
  let total = 0;
  let exhausted = 0;
  let noLogin = 0;
  for (let page = 1; page <= PROXYBRAZIL_MAX_PAGES; page += 1) {
    let text;
    try {
      text = await httpRequestText(`${PROXYBRAZIL_API}/proxies?page=${page}&per_page=${PROXYBRAZIL_PAGE_SIZE}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, maxBytes: 8_000_000, timeoutMs: 30000 });
    } catch (error) {
      // The request id helps ProxyBrazil support; the key is never logged.
      if (error && error.requestId) console.warn(`[ProxyBrazil] proxy list failed: HTTP ${error.status || 0}, X-Request-Id ${error.requestId}`);
      throw new Error(proxyBrazilErrorMessage(error && error.status, error && error.message));
    }
    const res = proxyBrazilRows(text, { socks });
    if (res.error) throw new Error(res.error);
    total += res.total;
    exhausted += res.exhausted;
    noLogin += res.noLogin;
    for (const r of res.rows) {
      const k = `${r.host}:${r.port}:${r.username}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(r);
    }
    if (!res.more) break;
  }
  if (!rows.length) {
    if (!total) throw new Error('ProxyBrazil: no active proxies on this account. Buy or renew one on proxybrazil.com.');
    if (exhausted === total) throw new Error('ProxyBrazil: your proxies have used their data allowance, so they will not carry traffic until renewed.');
    if (noLogin) throw new Error('ProxyBrazil: your active proxies came without a username and password, so none could be added.');
    throw new Error(`ProxyBrazil: none of your active proxies has usable ${socks ? 'SOCKS5' : 'HTTP'} details. Try the other protocol.`);
  }
  return limitListRows(rows, count, Infinity);
}

// ---- ProxyUDP (mobile 4G/5G ports, list pull + detail per port) ----
// An API token (Dashboard, API Access) lists the active subscriptions, then one detail call per port
// reads its login (two at a time; the API allows 1,000 requests an hour). The private rotation link is
// not in the API, so Rotate IP asks the API with the saved token (rotateProxyUdp, PROVIDER_ROTATORS).
// Never called: orders, rotate-all, reboot, change-os, auto-renew, refresh, login and logout (logout
// invalidates the token). Not tested with a live key.
const PROXYUDP_API = 'https://proxyudp.com/api/v1';
const PROXYUDP_MAX_PAGES = 20;

async function proxyUdpCall(key, pathName) {
  try {
    return JSON.parse(await httpRequestText(`${PROXYUDP_API}${pathName}`, { headers: { Authorization: `Token ${key}`, Accept: 'application/json' }, maxBytes: 8_000_000 }));
  } catch (error) {
    const status = error && error.status;
    if (status === 401) throw new Error('ProxyUDP rejected the API token. Copy it again from Dashboard, API Access.');
    if (status === 403) throw new Error('ProxyUDP refused access for this token.');
    if (status === 429) throw Object.assign(new Error(`ProxyUDP: too many requests. Wait ${retryAfterWait(error.retryAfter)} and try again.`), { status: 429 });
    if (error instanceof SyntaxError) throw new Error('ProxyUDP: the API did not return JSON.');
    throw new Error('ProxyUDP: could not reach the API. Check your connection and try again.');
  }
}

// The active subscriptions on the token's account, page by page (`next`, never a followed URL).
async function proxyUdpActiveSubscriptions(key) {
  const active = [];
  for (let page = 1; page <= PROXYUDP_MAX_PAGES; page += 1) {
    const res = proxyUdpSubscriptions(await proxyUdpCall(key, `/subscriptions/?active=true&page=${page}`));
    active.push(...res.active);
    if (!res.more) break;
  }
  return active;
}

async function fetchProxyUdpPool({ token, count, proxyType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('ProxyUDP: paste the API token from Dashboard, API Access.');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const subs = await proxyUdpActiveSubscriptions(key);
  if (!subs.length) throw new Error('ProxyUDP: no active ports on this account. Buy one, or check that your test ports are live.');
  // How many caps the list before the detail calls, so 3 makes 3 calls, not one per port.
  const want = /^[1-9]\d*$/.test(String(count == null ? '' : count).trim()) ? Number(count) : Infinity;
  const picked = subs.slice(0, want);
  const details = [];
  let stopped = null;
  for (let i = 0; i < picked.length && !stopped; i += 2) {
    const settled = await Promise.allSettled(picked.slice(i, i + 2).map((s) => proxyUdpCall(key, `/subscriptions/${encodeURIComponent(s.id)}/`)));
    for (const r of settled) {
      if (r.status === 'fulfilled') details.push(r.value);
      else if (!stopped) stopped = r.reason;
    }
  }
  const { rows, noLogin } = proxyUdpRows(details, { socks });
  if (!rows.length) {
    if (stopped) throw stopped;
    if (noLogin) throw new Error(`ProxyUDP: ${noLogin} active port${noLogin === 1 ? ' has' : 's have'} no username and password, so ${noLogin === 1 ? 'it was' : 'they were'} left out.`);
    throw new Error(`ProxyUDP: none of your active ports has usable ${socks ? 'SOCKS5' : 'HTTP'} details. Try the other protocol.`);
  }
  // A rate limit part way keeps the ports already read; pulling again adds the rest.
  if (stopped) rows[0].label += ` (${rows.length} of ${picked.length}, ProxyUDP asked to slow down)`;
  return rows;
}

// Rotate IP for a ProxyUDP row: find its subscription by address and port with the saved token, then
// POST rotate-ip. The token stays in main and never reaches a message.
async function rotateProxyUdp(proxy) {
  const saved = await readSavedProviderCreds('proxyudp');
  const key = String((saved && saved.token) || '').trim();
  if (!key || /\s/.test(key)) throw new Error('ProxyUDP: Rotate IP needs the API token saved on the Proxy providers page (ProxyUDP, Save credentials).');
  const started = Date.now();
  const sub = proxyUdpFindSubscription(await proxyUdpActiveSubscriptions(key), proxy);
  if (!sub) throw new Error('ProxyUDP: this proxy is not one of the active ports of the saved token\'s account, so its IP cannot be changed from here.');
  let outcome;
  try {
    // A carrier can take a while to hand out a new address.
    const text = await httpRequestText(`${PROXYUDP_API}/subscriptions/${encodeURIComponent(sub.id)}/rotate-ip/`, {
      method: 'POST', headers: { Authorization: `Token ${key}`, Accept: 'application/json' }, timeoutMs: 60000
    });
    outcome = proxyUdpRotateOutcome(200, text);
  } catch (error) {
    const status = error && error.status;
    if (!status) throw new Error('ProxyUDP: could not reach the API to change the IP. Try again in a moment.');
    outcome = proxyUdpRotateOutcome(status, String(error.message || '').replace(/^HTTP \d+\s*/, ''), { retryAfter: error.retryAfter });
  }
  if (!outcome.ok) throw new Error(String(outcome.message).split(key).join('***'));
  return { ok: true, status: 200, latencyMs: Date.now() - started, response: outcome.response, provider: 'proxyudp' };
}

// ---- Zokol (French mobile, list pull) ----
// A Bearer API key lists the account's mobile lines, 100 a page (zero-based). Dedicated lines keep
// rotation.manual.url as their Rotate IP link (the dashboard opens it with a plain GET; whether it
// needs a token is undocumented, so a refusal is explained by zokolRotateRefusal); shared lines have
// none. Never called: credential regeneration, rotation-link or schedule changes, ISP switch, reboot,
// purchase, trial. Not tested with a live key.
const ZOKOL_API = 'https://api.dashboard.zokol.fr';
const ZOKOL_PAGE_SIZE = 100;
const ZOKOL_MAX_PAGES = 20;

async function fetchZokolPool({ token, count, proxyType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('Zokol: paste an API key from your dashboard (API keys).');
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const rows = [];
  const seen = new Set();
  let total = 0;
  let expired = 0;
  let violation = 0;
  let noLogin = 0;
  for (let page = 0; page < ZOKOL_MAX_PAGES; page += 1) {
    let text;
    try {
      text = await httpRequestText(`${ZOKOL_API}/v1/proxies/mobile/?active=true&size=${ZOKOL_PAGE_SIZE}&page=${page}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, maxBytes: 8_000_000 });
    } catch (error) {
      const status = error && error.status;
      if (status === 401) throw new Error('Zokol rejected the API key. Create a new one in your dashboard, API keys.');
      if (status === 403) throw new Error('Zokol refused access for this key.');
      if (status === 429) throw new Error('Zokol: too many requests. Wait a moment and pull again.');
      throw new Error('Zokol: could not read the proxy list. Check your connection and try again.');
    }
    const res = zokolRows(text, { socks });
    if (res.error) throw new Error(res.error);
    total += res.total;
    expired += res.expired;
    violation += res.violation;
    noLogin += res.noLogin;
    for (const r of res.rows) {
      const k = `${r.host}:${r.port}:${r.username}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(r);
    }
    if (!res.more) break;
  }
  if (!rows.length) {
    if (!total) throw new Error('Zokol: no active proxies on this account. Start a trial or buy one in your dashboard.');
    if (violation && violation === total) throw new Error('Zokol: your proxies are suspended by Zokol (policy). Contact Zokol support.');
    if (expired && expired + violation === total) throw new Error('Zokol: every proxy on this account has expired. Renew one and pull again.');
    if (noLogin) throw new Error('Zokol: your active proxies came without a username and password, so none could be added.');
    throw new Error(`Zokol: none of your active proxies has usable ${socks ? 'SOCKS5' : 'HTTP'} details. Try the other protocol.`);
  }
  return limitListRows(rows, count, Infinity);
}

// ---- ResiProx (residential + mobile, one generator call per proxy) ----
// A Bearer API token reads the pool's traffic (GET /user/me), then GET /generate-proxy-string makes
// each proxy: How many 1 is one rotating proxy (sticky off), more is that many sticky ones, at most 3
// calls in flight and 50 per pull. The string format is unpublished (parseVendorProxyString), and the
// sticky flag is sent as 1 or 0 (the API answers like Laravel, whose boolean rule refuses "true").
// Never called: sub-user creation or changes, packages. Not tested with a live key.
const RESIPROX_API = 'https://dashboard.resiprox.com/api/v1';
const RESIPROX_PULL_MAX = 50;

async function resiProxCall(key, pathName) {
  try {
    return JSON.parse(await httpRequestText(`${RESIPROX_API}${pathName}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } }));
  } catch (error) {
    const status = error && error.status;
    if (status === 401) throw new Error('ResiProx rejected the API token. Create a new one in your dashboard and paste it again.');
    if (status === 403) throw new Error('ResiProx refused the request for this account.');
    if (status === 422) {
      const why = vendorErrorText(error.message).split(key).join('***');
      throw new Error(`ResiProx refused the location${why ? `: ${why}` : ''}.`);
    }
    if (status === 429) throw Object.assign(new Error('ResiProx: too many requests. Wait a minute and pull again.'), { status: 429 });
    if (error instanceof SyntaxError) throw new Error('ResiProx: the API did not return JSON.');
    throw new Error('ResiProx: could not reach the API. Check your connection and try again.');
  }
}

async function fetchResiProxPool({ token, poolType, country, state, city, count, proxyType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('ResiProx: paste the API token from your dashboard.');
  const pool = String(poolType || '').toLowerCase() === 'mobile' ? 'mobile' : 'residential';
  const kind = RESIPROX_POOLS[pool];
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const cc = normCountryCode(country);
  const region = String(state || '').trim();
  const town = String(city || '').trim();
  if ((region || town) && !cc) throw new Error('ResiProx: pick a country to target a state or city.');
  const acct = resiProxPool(await resiProxCall(key, '/user/me'), pool);
  if (!acct) throw new Error(`ResiProx: this account has no ${kind} package. Pick the other pool, or buy one on resiprox.com.`);
  if (acct.remainingBytes != null && acct.remainingBytes <= 0) throw new Error(`ResiProx: the ${kind} package has no traffic left, so its proxies would fail on first use.`);
  // gatewayPullPlan without a session or Keep same IP: one row rotates, more rows are sticky.
  const plan = gatewayPullPlan({ count });
  const n = plan.sticky ? clampPoolCount(count, 1, RESIPROX_PULL_MAX) : 1;
  const qs = new URLSearchParams({ connection_type: pool });
  if (cc) qs.set('country_code', cc);
  if (region) qs.set('region', region);
  if (town) qs.set('city', town);
  qs.set('sticky', plan.sticky ? '1' : '0');
  const got = await collectVendorStrings(n, async () => {
    const json = await resiProxCall(key, `/generate-proxy-string?${qs.toString()}`);
    const raw = json && typeof json.proxy_string === 'string' ? json.proxy_string : '';
    if (!raw.trim()) throw new Error('ResiProx returned no proxy string for that request.');
    return raw;
  }, { inFlight: 3, deadlineMs: 60000 });
  const rows = [];
  const why = new Set();
  let foreignHost = '';
  got.strings.forEach((raw, i) => {
    const r = resiProxRow(raw, { socks, pool, country: cc, index: i + 1, sticky: plan.sticky });
    if (r.row) rows.push(r.row);
    else { why.add(r.reason); if (r.host && !foreignHost) foreignHost = r.host; }
  });
  if (!rows.length) {
    if (got.error) throw got.error;
    if (why.has('host')) throw new Error(`ResiProx returned a proxy on ${foreignHost}, which is not a ResiProx host, so it was not added.`);
    if (why.has('noLogin')) throw new Error('ResiProx returned a proxy without a username and password. Its IP allow-list mode is not supported here.');
    if (!got.strings.length) throw new Error('ResiProx: the API did not answer in time. Try again in a moment.');
    throw new Error('ResiProx returned a proxy string the app cannot read. Send the support team its format (without the password).');
  }
  if (rows.length < n) rows[0].label += ` (${rows.length} of ${n}${got.error ? `: ${got.error.message}` : ''})`;
  return rows;
}

// Countries the chosen pool can target, for the country picker (GET /countries). Read-only.
async function lookupResiProx({ token, groupby }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('ResiProx: paste the API token from your dashboard.');
  if (groupby !== 'country') throw new Error('ResiProx: only the country list can be loaded here.');
  const geo = resiProxCountries(await resiProxCall(key, '/countries'));
  if (!geo.length) throw new Error('ResiProx returned no countries the app can read. Type a 2-letter country code instead.');
  geo.sort((a, b) => a.label.localeCompare(b.label));
  return { provider: 'resiprox', geo };
}

// ---- SimplyNode (residential + mobile, one generator call per proxy) ----
// An API key (profile Settings, sent as x-api-key, never in a URL) and one sub-account: the login typed
// in the form, or the first sub-account of the chosen pool with traffic left. POST /proxy makes each
// proxy (auth 'login', so the row has a username and password): How many 1 with Keep same IP blank is
// one rotating proxy, otherwise that many sticky ones held for Keep same IP (30 minutes when blank), at
// most 3 calls in flight and 50 per pull. Rotate IP on a port-format proxy resets its session
// (rotateSimplyNodeSession). Never called: sub-account creation, rotation, traffic or IP changes.
// Not tested with a live key.
const SIMPLYNODE_API = 'https://app.simplynode.io/api';
const SIMPLYNODE_PULL_MAX = 50;
const SIMPLYNODE_MAX_TTL_MIN = 60; // until SimplyNode confirms ttl past 3600 seconds
const SIMPLYNODE_DEFAULT_TTL_MIN = 30; // a sticky pull with Keep same IP blank (LIFE_BLANK_DEFAULTS)

async function simplyNodeCall(key, method, pathName, body, { what = '' } = {}) {
  try {
    const text = await httpRequestText(`${SIMPLYNODE_API}${pathName}`, {
      method,
      headers: { 'x-api-key': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return text && text.trim() ? JSON.parse(text) : null;
  } catch (error) {
    const status = error && error.status;
    if (status === 401) throw new Error('SimplyNode rejected the API key. Copy it again from profile Settings in your dashboard.');
    if (status === 403) throw new Error(what === 'list' ? 'SimplyNode refused this API key.' : 'SimplyNode: that sub-account does not belong to this API key\'s account.');
    if (status === 404 && what === 'subaccount') throw new Error('SimplyNode: no sub-account with that login. Copy it again from the dashboard, or leave it empty.');
    if (status === 400) {
      const said = vendorErrorText(error.message).split(key).join('***');
      throw new Error(`SimplyNode refused the request. Check the country, region and city (pick the country from Load countries).${said ? ` SimplyNode said: ${said}.` : ''}`);
    }
    if (status === 429) throw Object.assign(new Error('SimplyNode: too many requests. Wait a minute and pull again.'), { status: 429 });
    if (error instanceof SyntaxError) throw new Error('SimplyNode: the API did not return JSON.');
    throw new Error('SimplyNode: could not reach the API. Check your connection and try again.');
  }
}

async function fetchSimplyNodePool({ token, username, poolType, country, state, city, life, count, proxyType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('SimplyNode: paste the API key from your dashboard (profile Settings).');
  const pool = SIMPLYNODE_POOLS[String(poolType || '').toLowerCase()] || SIMPLYNODE_POOLS.residential_essential;
  const socks = String(proxyType || '').toLowerCase() === 'socks5';
  const cc = normCountryCode(country);
  const region = String(state || '').trim();
  const town = String(city || '').trim();
  if ((region || town) && !cc) throw new Error('SimplyNode: pick a country to target a state or city.');
  let login = String(username || '').trim();
  let sub = null;
  if (login) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(login)) throw new Error('SimplyNode: that is not a sub-account login (letters and digits, for example m123qWerTy). Copy it again from the dashboard, or leave it empty.');
    sub = await simplyNodeCall(key, 'GET', `/subaccounts/${encodeURIComponent(login)}`, null, { what: 'subaccount' });
  } else {
    let next = '';
    for (let page = 0; page < 10 && !sub; page += 1) {
      const qs = new URLSearchParams({ product_type: pool.productType, limit: '50' });
      if (pool.solution) qs.set('solution', pool.solution);
      if (next) qs.set('next_token', next);
      const json = await simplyNodeCall(key, 'GET', `/subaccounts?${qs.toString()}`, null, { what: 'list' });
      const items = Array.isArray(json && json.items) ? json.items : [];
      sub = simplyNodeSubaccountPick(items);
      next = json && typeof json.nextToken === 'string' ? json.nextToken : '';
      if (!next || !items.length) break;
    }
    if (!sub) throw new Error(`SimplyNode: no ${pool.name} sub-account with traffic on this account. Create one in the dashboard, then pull again.`);
    login = String(sub.subaccountLogin);
  }
  const left = simplyNodeTrafficValue(sub && sub.trafficAvailable);
  if (left != null && left <= 0) throw new Error('SimplyNode: that sub-account has no traffic left, so its proxies would fail on first use.');
  const lifeMin = Number.parseInt(String(life == null ? '' : life), 10);
  // gatewayPullPlan without a session: one row with Keep same IP blank rotates; otherwise sticky.
  const plan = gatewayPullPlan({ count, life: lifeMin });
  const n = plan.sticky ? clampPoolCount(count, 1, SIMPLYNODE_PULL_MAX) : 1;
  const body = simplyNodeProxyBody({
    login, socks, country: cc, region, city: town, sticky: plan.sticky,
    ttlMin: plan.lifeSet ? Math.min(SIMPLYNODE_MAX_TTL_MIN, lifeMin) : SIMPLYNODE_DEFAULT_TTL_MIN
  });
  const kind = String((sub && sub.productType) || '').toLowerCase() === 'mobile' ? 'Mobile' : pool.kind;
  const got = await collectVendorStrings(n, async () => {
    const json = await simplyNodeCall(key, 'POST', '/proxy', body);
    const raw = json && typeof json['proxy-string'] === 'string' ? json['proxy-string'] : '';
    if (!raw.trim()) throw new Error('SimplyNode returned no proxy string for that request.');
    return raw;
  }, { inFlight: 3, deadlineMs: 60000 });
  const rows = [];
  const why = new Set();
  let foreignHost = '';
  got.strings.forEach((raw, i) => {
    const r = simplyNodeRow(raw, { socks, kind, country: cc, index: i + 1, sticky: plan.sticky });
    if (r.row) rows.push(r.row);
    else { why.add(r.reason); if (r.host && !foreignHost) foreignHost = r.host; }
  });
  if (!rows.length) {
    if (got.error) throw got.error;
    if (why.has('host')) throw new Error(`SimplyNode returned a proxy on ${foreignHost}, which is not a SimplyNode host, so it was not added.`);
    if (why.has('noLogin')) throw new Error('SimplyNode returned a proxy without a login. Its IP whitelist mode is not supported; pick a sub-account that uses a username and password.');
    if (!got.strings.length) throw new Error('SimplyNode: the API did not answer in time. Try again in a moment.');
    throw new Error('SimplyNode returned a proxy string the app cannot read. Send the support team the format (without the password).');
  }
  if (rows.length < n) rows[0].label += ` (${rows.length} of ${n}${got.error ? `: ${got.error.message}` : ''})`;
  return rows;
}

// Countries the chosen pool can target (GET /targets/countries?product_type=). Read-only.
async function lookupSimplyNode({ token, groupby, poolType }) {
  const key = String(token || '').trim();
  if (!key || /\s/.test(key)) throw new Error('SimplyNode: paste the API key from your dashboard (profile Settings).');
  if (groupby !== 'country') throw new Error('SimplyNode: only the country list can be loaded here.');
  const pool = SIMPLYNODE_POOLS[String(poolType || '').toLowerCase()] || SIMPLYNODE_POOLS.residential_essential;
  const geo = simplyNodeCountries(await simplyNodeCall(key, 'GET', `/targets/countries?product_type=${pool.productType}`, null, { what: 'list' }));
  if (!geo.length) throw new Error(`SimplyNode lists no countries for ${pool.name} on this account.`);
  geo.sort((a, b) => a.label.localeCompare(b.label));
  return { provider: 'simplynode', geo };
}

// Rotate IP for a port-format SimplyNode row (apiRotationProvider): reset the session on its port with
// the saved key, sent in the header. The login is the row's username.
async function rotateSimplyNodeSession(proxy) {
  const saved = await readSavedProviderCreds('simplynode');
  const key = String((saved && saved.token) || '').trim();
  if (!key || /\s/.test(key)) throw new Error('SimplyNode: Rotate IP needs the API key saved on the Proxy providers page (SimplyNode, Save credentials).');
  const login = String((proxy && proxy.username) || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(login)) throw new Error('SimplyNode: this proxy\'s username is not a sub-account login, so its session cannot be reset from here.');
  const started = Date.now();
  try {
    await httpRequestText(`${SIMPLYNODE_API}/subaccounts/${encodeURIComponent(login)}/session:reset?ports=${encodeURIComponent(String(Number(proxy.port)))}`, {
      headers: { 'x-api-key': key, Accept: 'application/json' }
    });
  } catch (error) {
    const status = error && error.status;
    if (status === 401) throw new Error('SimplyNode rejected the saved API key. Save it again on the Proxy providers page.');
    if (status === 403) throw new Error('SimplyNode: this proxy\'s sub-account does not belong to the saved API key\'s account.');
    if (status === 404) throw new Error('SimplyNode: no sub-account with this proxy\'s login.');
    if (status === 429) throw new Error('SimplyNode: too many requests. Wait a minute and try again.');
    throw new Error('SimplyNode: could not reset the session. Try again in a moment.');
  }
  return { ok: true, status: 200, latencyMs: Date.now() - started, response: 'session reset', provider: 'simplynode' };
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
  proxy6: fetchProxy6Pool,
  proxybrazil: fetchProxyBrazilPool,
  proxyudp: fetchProxyUdpPool,
  zokol: fetchZokolPool,
  resiprox: fetchResiProxPool,
  simplynode: fetchSimplyNodePool,
  node4: fetchNode4Pool,
  proxyempire: fetchProxyEmpirePool,
  mountproxies: fetchMountProxiesPool,
  massive: fetchMassivePool,
  iproxy: fetchIproxyPool
});

async function syncVendorPool(payload) {
  await requirePermission('proxies.manage'); // creates proxies and calls the vendor
  const input = requireObject(payload);
  const vendorKey = requiredString(input.provider, 'Provider').toLowerCase();
  if (!PROXY_VENDORS[vendorKey]) throw new Error('Unknown proxy provider.');

  const db = getPrisma();
  // Refuse before any vendor call when already at maxProxies; each row is re-checked below.
  await assertWithinLimit('proxies');
  // The member's own pool decides what is already pulled; another member's copy of the same vendor
  // proxy is neither skipped over nor touched.
  const add = await proxyAddContext();
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
      // Address family: '6' asks Oxylabs for IPv6 exits (-ipversion-6). Other vendors ignore it;
      // NodeMaven, which mixes IPv4 and IPv6, always gets -ipv4-true.
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
          where: proxyScope.andWhere({ host, OR: [{ username: login }, { username: { startsWith: `${login}__` } }] }, add.visible),
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
  // An adapter may hang one notice code on its rows for the pull result, which the form translates
  // (iProxy.online: phones without a change-IP link were added without Rotate IP).
  if (rows && rows.notice && typeof rows.notice === 'object' && /^[A-Za-z]{1,40}$/.test(String(rows.notice.code || ''))) {
    result.notice = { code: String(rows.notice.code), count: Math.max(0, Math.floor(Number(rows.notice.count) || 0)) };
  }
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
      where: proxyScope.andWhere({ type: row.type, host: row.host, port: row.port, username: row.username, ...(row.dedupeOnPassword ? { passwordHash: await proxySecrets.hashPassword(db, row.password) } : {}) }, add.visible),
      select: { id: true, rotationUrl: true }
    });
    if (existing) {
      // A re-pull gives a proxy saved before its vendor link was supported its Rotate IP link.
      if (row.rotationUrl && !existing.rotationUrl) await db.proxy.update({ where: { id: existing.id }, data: { rotationUrl: row.rotationUrl } }).catch(() => {});
      result.skipped.push(row.label);
      continue;
    }
    const created = await db.proxy.create({
      data: {
        name: row.label, type: row.type, host: row.host, port: row.port,
        username: row.username, password: row.password, ownerMemberId: add.ownerId,
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
  if (t === 'https') return 'https'; // TLS to the proxy (https-proxy-agent's secure proxy)
  return 'http';
}

// Routes a request to an IP/geo service through the proxy; returns { success, ip, country, city,
// isp, latencyMs } or { success: false, error }. opts.timeoutMs / opts.fallbackTimeoutMs shorten the
// two stages (15 s each by default); only Quick generate's gate passes them (proxyGate.js).
async function testProxyConnectivity(proxy, opts = {}) {
  const primaryMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 15000;
  const fallbackMs = Number(opts.fallbackTimeoutMs) > 0 ? Number(opts.fallbackTimeoutMs) : 15000;
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
  const viaIpinfo = httpGetJson('https://ipinfo.io/json', agent, primaryMs).then((data) => {
    if (!data || !data.ip) throw new Error('ipinfo.io returned no IP.');
    return { ip: data.ip, country: data.country || null, region: data.region || null, city: data.city || null, zip: data.postal || null, isp: data.org || null, timezone: data.timezone || null };
  });
  const viaGeojs = httpGetJson(GEOJS_URL, agent, primaryMs).then((raw) => {
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
        fallbackMs
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

// The editor's "Check network" sends its fields as they are; for a member without proxies.reveal the
// username and password are masks, put back from the profile being edited (`profileId`, edit access
// needed), as a save does (restoreMaskedSecrets). Without a profile they become empty.
async function unmaskedEditorProxyRaw(input) {
  const raw = String(input.raw);
  if (!raw.includes(SECRET_MASK)) return raw;
  let stored = null;
  if (input.profileId !== undefined && input.profileId !== null && input.profileId !== '') {
    const profileId = parseId(input.profileId, 'profileId');
    await assertCanAccessProfile(profileId, { requireEdit: true });
    stored = storedProxyCredentials(await getPrisma().profile.findUnique({ where: { id: profileId }, include: { proxy: true } }));
  }
  return restoreMaskedProxyRaw(raw, stored);
}

// Accepts { id } (a saved proxy), { raw, type, profileId? }, or { host, port, username, password, type }.
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
    const raw = await unmaskedEditorProxyRaw(input); // masked fields from the editor
    proxy = parseProxyInput(raw);
    // Same rule as saving the profile (createProfile/updateProfile): a scheme in the string wins and
    // the editor's "Local" is not a protocol, so the check tests the proxy that will be saved.
    const typeHint = proxyTypeHintFor(raw, input.type);
    if (proxy && typeHint) proxy.type = typeHint;
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

// DNSBL check of the exit IP: a 127.0.0.x answer means listed, except Spamhaus PBL (127.0.0.10 and
// .11), which marks a residential or dynamic range and is not a spam listing (see dnsbl.js).
// Errors, timeouts and sentinels such as Spamhaus's 127.255.255.x (public resolver blocked) count
// as not listed, to avoid false positives.
// v6: whether the zone answers IPv6 nibble queries; zones without it are skipped for IPv6.
// SORBS is gone: Proofpoint shut it down on 5 June 2024 and its zone no longer resolves (NXDOMAIN),
// so it only cost a lookup. Do not add it back: if the domain were ever re-registered, a wildcard
// answer would mark every proxy as listed.
const DNSBL_ZONES = [
  { zone: 'zen.spamhaus.org', name: 'Spamhaus', v6: true },
  { zone: 'bl.spamcop.net', name: 'SpamCop', v6: false },
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
  // One row per zone, in DNSBL_ZONES order; dnsbl.js reads the answer codes (Spamhaus PBL is a
  // residential range, not a listing) and sums them up.
  const results = await Promise.all(zones.map(async ({ zone, name }) => {
    try {
      const a = await withTimeout(dns.resolve4(`${rev}.${zone}`), 4000);
      return { name, ...dnsbl.classifyAnswer(zone, a) };
    } catch (e) { return { name, outcome: 'clean', lists: [] }; } // NXDOMAIN / timeout / error → not listed
  }));
  return dnsbl.summarize(results);
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
    // "Check all" is the paid pool's; the Free proxies page always names its ids.
    proxies = await db.proxy.findMany({ where: await scopedProxyWhere(proxyScope.proxyScopeWhere('paid')), orderBy: { createdAt: 'asc' } });
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
      const blText = dnsbl.logSuffix(result.blacklist); // listed, residential range, clean or ''
      const line = result.success
        ? `${label} → ${result.country || '??'}${result.city ? ' · ' + result.city : ''} · ${result.latencyMs != null ? result.latencyMs + 'ms' : '-'} · ${okUrls}/${urls.length} sites · ${result.health.grade} ${result.health.label} · ${result.speed.rating}${blText ? ` · ${blText}` : ''}`
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
  if (normalizeBrowserCore(profile.browserCore) === BROWSER_CORE.FIREFOX) {
    // Firefox profiles always run with WebRTC off (firefoxEngine's user.js), whatever the setting says,
    // so the setting is not graded: the same status as "Disabled", which also leaks nothing. The CAPTCHA
    // score says the same (captchaScore.js).
    checks.push({ key: 'webrtc', label: 'WebRTC', status: 'pass', detail: 'WebRTC is off in Firefox profiles - real IP not leaked via WebRTC.' });
  } else if (webrtc === 'Real' && usesProxy) {
    checks.push({ key: 'webrtc', label: 'WebRTC', status: 'fail', detail: 'Set to "Real" - WebRTC can expose the real IP behind the proxy.' });
  } else if (webrtc === 'Real') {
    // No proxy: WebRTC shows the IP every site already sees (the IP / Proxy row says so), so there is no
    // mismatch to flag. The CAPTCHA score says the same (captchaScore.js).
    checks.push({ key: 'webrtc', label: 'WebRTC', status: 'pass', detail: 'Set to "Real" with no proxy - sites already see this computer\'s IP, so WebRTC shows them nothing new.' });
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

// Cookie dumps, archives and live 2FA codes need RAW_VALUE_MIN_RANK on top of profile access. Cookie
// dumps and archives also need edit access, so a "use only" share cannot take a logged-in session.
// Single-user mode and the super admin pass.
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

// Export hands over the profile's logged-in sessions: profiles.export, edit access (a profile shared
// "use only" is used through its browser, never copied out) and the reveal rank.
async function exportProfileCookies(payload) {
  await requirePermission('profiles.export');
  const input = requireObject(payload);
  const id = parseId(input.id);
  await assertCanAccessProfile(id, { requireEdit: true });
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

// Import replaces the profile's sessions, an edit of its data: profiles.edit and edit access.
async function importProfileCookies(payload) {
  await requirePermission('profiles.edit');
  const input = requireObject(payload);
  const id = parseId(input.id);
  await assertCanAccessProfile(id, { requireEdit: true });
  // Both write paths below are Chromium only (CDP, or the Chromium data folder offline). A Firefox
  // profile keeps its cookies in its own folder, so an import there would report success and do
  // nothing.
  const target = await getPrisma().profile.findUnique({ where: { id }, select: { browserCore: true } });
  if (target && normalizeBrowserCore(target.browserCore) === BROWSER_CORE.FIREFOX) {
    throw new Error('Cookie import works for Chromium profiles only. Firefox profiles cannot take imported cookies yet.');
  }
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
// returns a per-session breakdown. Same rule as one profile: profiles.edit, and only profiles the
// member may edit (a running "use only" share is left alone).
async function importCookiesToRunning(payload) {
  await requirePermission('profiles.edit');
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
  // Scope to running sessions whose profile the active member may edit (single-user mode and the Super
  // Admin: every session).
  const member = await getActiveMember();
  if (member && member.role !== 'SUPER_ADMIN') {
    const sids = sessions.map((s) => Number(s.sessionId)).filter((n) => Number.isInteger(n) && n > 0);
    const { allowed } = sids.length ? await partitionAccessibleProfileIds(sids, { requireEdit: true }) : { allowed: [] };
    const okIds = new Set(allowed);
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

// ---- Device name and MAC address ----
// Every profile has its own (profileOptions.js): realistic for its OS (DESKTOP-XXXXXXX on Windows, a
// registered network-adapter prefix for the MAC) and never shared with another profile in the workspace,
// trashed ones included (they can be restored). "Real" fields are left alone.

// The names (lower case) and MACs (normalized) the workspace's profiles use, except excludeId's.
async function takenDeviceIdentities(db, excludeId = null) {
  const rows = await db.profile.findMany({ select: { id: true, deviceName: true, macAddress: true } });
  const names = new Set();
  const macs = new Set();
  for (const r of rows) {
    if (excludeId != null && r.id === excludeId) continue;
    const n = String(r.deviceName || '').trim();
    if (n) names.add(n.toLowerCase());
    const m = profileOptions.normalizeMac(r.macAddress);
    if (m) macs.add(m);
  }
  return { names, macs };
}

const DEVICE_NAME_RULE = {
  Windows: 'a Windows computer name has at most 15 letters, digits and hyphens',
  other: 'use at most 63 letters, digits, spaces, dots, hyphens, underscores or apostrophes, starting with a letter or digit'
};

// Throws a readable error when a device name or MAC typed by the user is unusable or taken.
function assertDeviceIdentity(data, taken, os) {
  const osName = os || data.os;
  if (!/^real$/i.test(String(data.deviceNameType || '')) && data.deviceName) {
    const n = String(data.deviceName).trim();
    const err = profileOptions.deviceNameError(n, osName);
    if (err) throw new Error(`The device name "${n}" cannot be used: ${profileOptions.identityOsKey(osName) === 'Windows' ? DEVICE_NAME_RULE.Windows : DEVICE_NAME_RULE.other}.`);
    if (taken.names.has(n.toLowerCase())) throw new Error(`Another profile already uses the device name "${n}". Every profile needs its own: click "Generate new".`);
  }
  if (!/^real$/i.test(String(data.macAddressType || '')) && data.macAddress) {
    const err = profileOptions.macAddressError(data.macAddress);
    if (err === 'multicast') throw new Error(`The MAC address "${data.macAddress}" is a group address, which no network card has (the first pair must be even). Click "Generate new".`);
    if (err) throw new Error(`The MAC address "${data.macAddress}" cannot be used: write six pairs of hex digits, like 3C:A9:F4:12:34:56.`);
    if (taken.macs.has(profileOptions.normalizeMac(data.macAddress))) throw new Error(`Another profile already uses the MAC address "${data.macAddress}". Every profile needs its own: click "Generate new".`);
  }
}

// Gives `data` (a profile row about to be written) a usable, unique device name and MAC wherever it has
// none, an unusable one or one already taken; usable values are kept (a MAC in AA:BB:CC:DD:EE:FF form).
// Adds what it settles on to `taken`, so a batch never repeats itself.
function fillDeviceIdentity(data, taken, os) {
  const osName = os || data.os;
  if (!/^real$/i.test(String(data.deviceNameType || ''))) {
    const n = String(data.deviceName || '').trim();
    data.deviceName = (!n || profileOptions.deviceNameError(n, osName) || taken.names.has(n.toLowerCase()))
      ? profileOptions.uniqueDeviceIdentity(osName, taken).deviceName
      : n;
    if (!data.deviceNameType) data.deviceNameType = 'Custom';
    taken.names.add(data.deviceName.toLowerCase());
  }
  if (!/^real$/i.test(String(data.macAddressType || ''))) {
    const m = profileOptions.normalizeMac(data.macAddress);
    data.macAddress = (!m || profileOptions.macAddressError(m) || taken.macs.has(m))
      ? profileOptions.uniqueDeviceIdentity(osName, taken).macAddress
      : m;
    if (!data.macAddressType) data.macAddressType = 'Custom';
    taken.macs.add(data.macAddress);
  }
  return data;
}

// createProfile: a device name or MAC the caller typed must be usable and unused (else an error); one the
// random fingerprint made, or none, becomes a unique pair. Changes `fields` in place.
async function settleDeviceIdentity(db, fields, input) {
  const taken = await takenDeviceIdentities(db);
  assertDeviceIdentity({
    deviceNameType: fields.deviceNameType,
    macAddressType: fields.macAddressType,
    deviceName: input && input.deviceName ? fields.deviceName : null,
    macAddress: input && input.macAddress ? fields.macAddress : null
  }, taken, fields.os);
  return fillDeviceIdentity(fields, taken, fields.os);
}

// Batch import and migration: the next profile's device name and MAC, unique within the workspace and
// the run (state keeps what is taken across calls).
async function claimDeviceIdentity(db, state, data, os) {
  if (!state.taken) state.taken = await takenDeviceIdentities(db);
  return fillDeviceIdentity(data, state.taken, os);
}

// A profile made before 1.0.26 may have no device name or MAC, or one that is not usable (old random
// values: a 20-character WORKSTATION- name, a group-address MAC). It gets a new pair on its first launch.
async function ensureProfileDeviceIdentity(db, profile) {
  const needName = !/^real$/i.test(String(profile.deviceNameType || ''))
    && (!profile.deviceName || profileOptions.deviceNameError(profile.deviceName, profile.os));
  const needMac = !/^real$/i.test(String(profile.macAddressType || ''))
    && (!profile.macAddress || profileOptions.macAddressError(profile.macAddress));
  if (!needName && !needMac) return profile;
  try {
    const taken = await takenDeviceIdentities(db, profile.id);
    const fresh = fillDeviceIdentity({
      os: profile.os,
      deviceNameType: profile.deviceNameType, deviceName: needName ? null : profile.deviceName,
      macAddressType: profile.macAddressType, macAddress: needMac ? null : profile.macAddress
    }, taken, profile.os);
    const data = {};
    if (needName) { data.deviceName = fresh.deviceName; data.deviceNameType = fresh.deviceNameType; }
    if (needMac) { data.macAddress = fresh.macAddress; data.macAddressType = fresh.macAddressType; }
    await db.profile.update({ where: { id: profile.id }, data });
    return { ...profile, ...data };
  } catch (e) {
    console.warn('[SG][profile] could not give the profile a device name / MAC:', (e && e.message) || e);
    return profile;
  }
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

// A copy or a profile made from a template carries the source's proxy and group ids. Like a new
// proxy or group in updateProfile, the new profile links only a proxy and joins only a group the
// member may use; any other is left out and reported. The profile keeps "Profile proxy", so with
// its proxy left out it cannot open on the real IP: launch asks for a proxy first.
async function reconcileReferencesForMember(db, fields) {
  await reconcileReferences(db, fields);
  const leftOut = { proxy: false, group: false };
  if (fields.proxyId) {
    try { await assertCanAccessProxy(fields.proxyId); }
    catch (e) {
      if (!e || e.code !== 'FORBIDDEN') throw e;
      fields.proxyId = null; fields.proxyInfoString = null; leftOut.proxy = true;
    }
  }
  if (fields.groupId) {
    try { await assertCanAccessGroup(fields.groupId); }
    catch (e) {
      if (!e || e.code !== 'FORBIDDEN') throw e;
      fields.groupId = null; leftOut.group = true;
    }
  }
  return leftOut;
}

// A copy of a profile shared "use only" keeps its fingerprint and settings, but nothing that would let
// the member sign in to its accounts or use its owner's proxy once the share is gone: the 2FA seed, the
// saved platform logins (usernames, passwords, 2FA keys) and a proxy address saved without a pool proxy
// are left out and reported in `leftOut`. A share can be revoked; a copy is the member's for good. A
// copy of a profile the member may edit keeps them, as before.
function stripUseOnlySecrets(fields, leftOut) {
  if (fields.twoFactorSeed) leftOut.twoFactor = true;
  fields.twoFactorSeed = null;
  let accounts = null;
  try { accounts = fields.platformAccounts ? JSON.parse(fields.platformAccounts) : []; } catch (e) { accounts = null; }
  if (accounts === null || (Array.isArray(accounts) && accounts.length > 0)) leftOut.logins = true;
  fields.platformAccounts = null;
  if (!fields.proxyId && fields.proxyInfoString) {
    fields.proxyInfoString = null;
    // A DIRECT or system-proxy profile never used it, so only a profile proxy counts as left out.
    if (fields.systemProxyBehavior !== 'DIRECT' && fields.systemProxyBehavior !== 'SYSTEM_PROXY') leftOut.proxy = true;
  }
  return leftOut;
}

async function cloneProfile(payload) {
  // Same create-permission and quota gates as createProfile.
  await requirePermission('profiles.create');
  const input = requireObject(payload);
  const db = getPrisma();
  await assertWithinLimit('profiles');
  const id = parseId(input.id);
  await assertCanAccessProfile(id);
  // Shared with this member "use only" (they may launch it, not edit it).
  let useOnly = false;
  try { await assertCanAccessProfile(id, { requireEdit: true }); }
  catch (e) { if (!e || e.code !== 'FORBIDDEN') throw e; useOnly = true; }
  const reroll = Boolean(input.reroll);
  const src = await db.profile.findUnique({ where: { id } });
  if (!src) throw new Error('Profile not found.');

  const fields = pickCloneableFields(src);
  // A copy of a profile shared with the member may sit on its owner's proxy or in their group.
  const leftOut = { ...(await reconcileReferencesForMember(db, fields)), twoFactor: false, logins: false };
  if (useOnly) stripUseOnlySecrets(fields, leftOut);
  const title = `${src.title} (copy)`;
  const dataDirName = await ensureUniqueDataDirName(db, title);

  // Reroll swaps in a fresh, consistent fingerprint (OS, GPU and screen stay paired, device class
  // kept) so copies never share one; otherwise only the hardware identity is regenerated.
  const isMobile = src.deviceClass === 'mobile';
  const fingerprint = reroll ? generateFingerprint({ deviceClass: src.deviceClass }) : {};
  // The copy belongs to the current member, not the source's owner or assignee.
  const cloneStampId = ownerStampId();
  const data = { ...fields, ...fingerprint, title, dataDirName, ownerMemberId: cloneStampId, assignedMemberId: cloneStampId };
  // A copy is another device: it gets its own device name and MAC (the UA's phone model is separate).
  data.deviceName = null;
  data.macAddress = null;
  await claimDeviceIdentity(db, {}, data, data.os || (isMobile ? 'Android' : null));
  const created = await db.profile.create({ data, include: { proxy: true, group: true } });
  return { ...serializeProfile(created), leftOut };
}

async function saveProfileAsTemplate(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  // Gated like a clone, so a template cannot copy a profile the member cannot access.
  await requirePermission('profiles.create');
  await assertCanAccessProfile(id);
  // Shared with this member "use only" (they may launch it, not edit it).
  let useOnly = false;
  try { await assertCanAccessProfile(id, { requireEdit: true }); }
  catch (e) { if (!e || e.code !== 'FORBIDDEN') throw e; useOnly = true; }
  const name = requiredString(input.name, 'Template name');
  const src = await db.profile.findUnique({ where: { id } });
  if (!src) throw new Error('Profile not found.');
  const fields = pickCloneableFields(src);
  // Templates are workspace-global, so strip live secrets (2FA seed, platform accounts); clones keep them.
  delete fields.twoFactorSeed;
  delete fields.platformAccounts;
  // A template of a "use only" share keeps no proxy: its address holds the owner's proxy password,
  // which a profile made from the template would hand to its new owner (the rule of a copy of it,
  // stripUseOnlySecrets). A profile made from it keeps "Profile proxy" and asks for a proxy first.
  const leftOut = { proxy: false };
  if (useOnly && (fields.proxyId || fields.proxyInfoString)) {
    fields.proxyId = null;
    fields.proxyInfoString = null;
    leftOut.proxy = true;
  }
  // The maker owns the template; it is listed for their visible subtree (scopedTemplateWhere).
  const created = await db.template.create({ data: { name, dataJson: JSON.stringify(fields), ownerMemberId: ownerStampId() } });
  return { ...serializeTemplate(created), leftOut };
}

// ---- Template scoping ----
// Templates follow the profile-group rule without its "holds a profile" branch: a member sees (uses
// and deletes) a template made by someone in their visible subtree. A template with no owner (made
// before 1.0.26, in single-user mode or by the Super Admin) is seen by the Owner and Admins only.
// Single-user mode and the Super Admin are unrestricted.
async function scopedTemplateWhere(baseWhere) {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return baseWhere;
  const all = await getPrisma().member.findMany();
  const or = [{ ownerMemberId: { in: [...permissions.visibleMemberIds(all, member)] } }];
  if (permissions.rankOf(member.role) >= permissions.ROLE_RANK.ADMIN) or.push({ ownerMemberId: null });
  return baseWhere ? { AND: [baseWhere, { OR: or }] } : { OR: or };
}

async function assertCanAccessTemplate(id) {
  const db = getPrisma();
  if (!(await db.template.findUnique({ where: { id }, select: { id: true } }))) throw new Error('Template not found.');
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return;
  if (!(await db.template.findFirst({ where: await scopedTemplateWhere({ id }), select: { id: true } }))) {
    const e = new Error('You do not have access to this template.'); e.code = 'FORBIDDEN'; throw e;
  }
}

async function listTemplates() {
  const db = getPrisma();
  const rows = await db.template.findMany({ where: await scopedTemplateWhere(undefined), orderBy: { createdAt: 'desc' } });
  return rows.map(serializeTemplate);
}

// Deleting a template needs the same right as saving one (profiles.create) and a template the member
// can see.
async function deleteTemplate(payload) {
  await requirePermission('profiles.create');
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessTemplate(id);
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
  await assertCanAccessTemplate(templateId);
  const tpl = await db.template.findUnique({ where: { id: templateId } });
  if (!tpl) throw new Error('Template not found.');

  let fields;
  try { fields = JSON.parse(tpl.dataJson || '{}'); }
  catch (e) { throw new Error('Template data is corrupted.'); }
  if (!fields || typeof fields !== 'object') throw new Error('Template data is invalid.');

  const title = requiredString(input.title || tpl.name, 'Profile title');
  // The template's proxy or group may be one this member cannot use (a template saved from a shared
  // profile, or an older template): it is left out and reported, never linked.
  const leftOut = await reconcileReferencesForMember(db, fields);
  const dataDirName = await ensureUniqueDataDirName(db, title);

  // A mobile template keeps its device model (e.g. Pixel 7) so the UA / Client-Hints
  // model stays coherent; desktop profiles get a randomized machine name per profile.
  const isMobile = fields.deviceClass === 'mobile';
  // Stamp ownership to the current member (templates carry no owner).
  const tplStampId = ownerStampId();
  const data = { ...fields, title, dataDirName, ownerMemberId: tplStampId, assignedMemberId: tplStampId };
  if ('browserCore' in data) data.browserCore = toStoredBrowserCore(data.browserCore);
  // Every profile made from a template is its own device: a new device name and MAC.
  data.deviceName = null;
  data.macAddress = null;
  await claimDeviceIdentity(db, {}, data, data.os || (isMobile ? 'Android' : null));
  const created = await db.profile.create({ data, include: { proxy: true, group: true } });
  return { ...serializeProfile(created), leftOut };
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

// ---- Group scoping ----
// Groups follow the profile and proxy rules: a member sees a group made by someone in their visible
// subtree, or one that holds a profile they can see. A group with no owner (made before 1.0.26, by
// the Super Admin or in single-user mode) is also visible to the Owner and Admins, the rule older
// macros follow. Renaming or deleting (`manage`) needs the first or last rule, not just a visible
// profile. Single-user mode and the Super Admin are unrestricted.
async function scopedGroupWhere(baseWhere, opts = {}) {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return baseWhere;
  const all = await getPrisma().member.findMany();
  const visible = [...permissions.visibleMemberIds(all, member)];
  const or = [{ ownerMemberId: { in: visible } }];
  if (permissions.rankOf(member.role) >= permissions.ROLE_RANK.ADMIN) or.push({ ownerMemberId: null });
  if (!opts.manage) or.push({ profiles: { some: await scopedProfileWhere({ deletedAt: null }) } });
  return baseWhere ? { AND: [baseWhere, { OR: or }] } : { OR: or };
}

async function assertCanAccessGroup(id, opts = {}) {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return;
  const db = getPrisma();
  if (!(await db.group.findUnique({ where: { id }, select: { id: true } }))) throw new Error('Group not found.');
  if (!(await db.group.findFirst({ where: await scopedGroupWhere({ id }, opts), select: { id: true } }))) {
    const e = new Error('You do not have access to this group.'); e.code = 'FORBIDDEN'; throw e;
  }
}

async function listProfiles(payload = {}) {
  const db = getPrisma();
  const search = optionalString(payload.search);
  const where = { deletedAt: null };
  if (search) {
    where.OR = [{ title: { contains: search } }, { notes: { contains: search } }, { dataDirName: { contains: search } }, { proxyInfoString: { contains: search } }];
  }

  const profiles = await db.profile.findMany({ where: await scopedProfileWhere(where), orderBy: { createdAt: 'desc' }, include: { proxy: true, group: true, accesses: { select: PROFILE_ACCESS_SELECT.accesses.select } } });
  const rows = await withViewerEditFlags(profiles);
  return search ? rows.filter((r) => searchMatchesView(r, search)) : rows;
}

// A search finds a profile only by what the member is shown of it. The database matched the stored
// proxy address, which holds a password the window may not get (masked for a profile shared "use only"
// and without proxies.reveal), so a row that matched only there is dropped: otherwise typing guesses
// into the search box would tell a shared proxy's password one letter at a time.
function searchMatchesView(row, search) {
  const needle = String(search).toLowerCase();
  return ['title', 'notes', 'dataDirName', 'proxyInfoString'].some((k) => typeof row[k] === 'string' && row[k].toLowerCase().includes(needle));
}

// A proxy the member's own Proxy pool lists: owned within their visible subtree (scopedProxyWhere).
function proxyInVisiblePool(visible, proxy) {
  return Boolean(proxy) && proxy.ownerMemberId != null && visible.has(proxy.ownerMemberId);
}

async function listTrash() {
  const db = getPrisma();
  const profiles = await db.profile.findMany({
    where: await scopedProfileWhere({ deletedAt: { not: null } }),
    orderBy: { deletedAt: 'desc' },
    include: { proxy: true, group: true, accesses: { select: PROFILE_ACCESS_SELECT.accesses.select } }
  });
  return withViewerEditFlags(profiles);
}

// Serialized rows plus `canEdit`: whether this member may edit each one (it is theirs or their
// subtree's, or shared with them for editing). A profile shared "use only" can be launched but not
// edited, renamed, tagged, moved, trashed or restored, so the pages disable those actions on it.
// Main still refuses them on its own (assertCanAccessProfile / partitionAccessibleProfileIds with
// requireEdit). The share list itself is not sent.
async function withViewerEditFlags(rows) {
  const member = await getActiveMember(); // also refreshes the reveal flag (proxyRevealAllowed)
  let canEdit = () => true;
  let inPool = () => true;
  if (member && member.role !== 'SUPER_ADMIN') {
    const visible = permissions.visibleMemberIds(await getPrisma().member.findMany(), member);
    canEdit = (row) => permissions.profileRowAccessible(visible, row, true);
    inPool = (proxy) => proxyInVisiblePool(visible, proxy);
  }
  return rows.map((p) => {
    const { accesses, ...row } = p;
    const editable = canEdit(p);
    let out = serializeProfile(row);
    if (!editable) {
      // A "use only" share never hands over its saved platform logins, whatever the role (the same rule
      // as a copy of it, stripUseOnlySecrets): passwords and 2FA keys arrive masked.
      if (Array.isArray(out.platformAccounts)) out.platformAccounts = redactPlatformAccounts(out.platformAccounts, false);
      // Nor its proxy's password or rotation link; the username only as the member's Proxy pool shows
      // it (their own pool's proxy, with proxies.reveal). Launch still uses the stored proxy.
      out = { ...out, ...redactUseOnlyProxy(row, out, { showUsername: proxyRevealAllowed() && inPool(row.proxy) }) };
    }
    return { ...out, canEdit: editable };
  });
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
    proxy = await findOrCreateProxy(db, input.proxyRaw, `${title} Proxy`, proxyTypeHintFor(input.proxyRaw, input.proxyType));
    proxyId = proxy.id;
  } else if (proxyId) {
    proxy = await db.proxy.findUnique({ where: { id: proxyId } });
    if (!proxy) throw new Error('Selected proxy does not exist.');
    // The editor lists only the member's own proxies; an API caller cannot link someone else's by id.
    await assertCanAccessProxy(proxyId);
  }

  // The runtime Profile table has no foreign key on groupId, so a stale id is refused here, and so is
  // a group the member cannot see.
  const groupId = input.groupId ? parseId(input.groupId, 'groupId') : null;
  if (groupId !== null && !(await db.group.findUnique({ where: { id: groupId } }))) throw new Error('Selected group does not exist.');
  if (groupId !== null) await assertCanAccessGroup(groupId);

  const dataDirName = await ensureUniqueDataDirName(db, input.dataDirName || title);
  const stampId = ownerStampId();

  // Device name and MAC: a value given here must be usable and unused; a missing one is generated.
  const fingerprintFields = buildFingerprintFields(input); // generator-aware fingerprint injection
  await settleDeviceIdentity(db, fingerprintFields, input);

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
      groupId,
      tags: Array.isArray(input.tags) ? JSON.stringify(input.tags) : null,
      ...fingerprintFields
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

// Quick generate runs in flight, by runId, so the modal's Cancel can stop one. A cancel that arrives
// before its run has registered is remembered (bounded) and applied when the run starts.
const batchGenerateRuns = new Map();
const batchGenerateEarlyCancels = new Set();

// IPC entry for Quick generate. Registers the run for Cancel and streams progress frames on
// PROFILE_BATCH_GENERATE_PROGRESS: { runId, phase: 'check' | 'create' | 'done', ... }.
async function batchGenerateHandler(payload, event) {
  const input = requireObject(payload);
  const runId = String(optionalString(input.runId) || `qgen-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`).slice(0, 80);
  const controller = new AbortController();
  batchGenerateRuns.set(runId, controller);
  if (batchGenerateEarlyCancels.delete(runId)) controller.abort();
  const send = (frame) => {
    const sender = event && event.sender;
    if (!sender || (typeof sender.isDestroyed === 'function' && sender.isDestroyed())) return;
    sender.send(CHANNELS.PROFILE_BATCH_GENERATE_PROGRESS, { runId, ts: Date.now(), ...frame });
  };
  try {
    return { runId, ...(await batchGenerateProfiles(input, { signal: controller.signal, progress: proxyGate.createThrottledEmitter(send) })) };
  } finally {
    batchGenerateRuns.delete(runId);
  }
}

// Stops the proxy check at once and the profile creation before its next profile; profiles already
// created are kept.
async function cancelBatchGenerate(payload) {
  const runId = payload && payload.runId ? String(payload.runId).slice(0, 80) : null;
  if (runId && !batchGenerateRuns.has(runId)) {
    batchGenerateEarlyCancels.add(runId);
    if (batchGenerateEarlyCancels.size > 50) batchGenerateEarlyCancels.delete(batchGenerateEarlyCancels.values().next().value);
    return { cancelled: 0, pending: true };
  }
  const runs = runId ? [batchGenerateRuns.get(runId)] : [...batchGenerateRuns.values()];
  runs.forEach((c) => c.abort());
  return { cancelled: runs.length };
}

// Proxy types a Chromium profile can launch with. Chromium's SOCKS4 client resolves hostnames
// locally (a DNS leak), so the launch refuses SOCKS4 and Quick generate (which makes Chromium
// profiles) never assigns one.
const CHROMIUM_PROXY_TYPES = Object.freeze(['HTTP', 'SOCKS5']);

// Server-side batch generator. It owns what per-profile create() cannot: a unique proxy per profile
// (the run is capped at available proxies), unique visible fingerprints and an even Chrome-version
// spread. createProfile does the persistence, so limits, ownership and data dirs stay identical.
// run.signal cancels it (see cancelBatchGenerate); run.progress(frame, force) receives progress.
async function batchGenerateProfiles(payload, run = {}) {
  const input = requireObject(payload);
  await requirePermission('profiles.create');
  const db = getPrisma();
  const signal = run.signal || null;
  const progress = typeof run.progress === 'function' ? run.progress : () => {};

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
  // createProfile refuses a group the member cannot see; refuse it here, before any proxy is checked.
  if (groupId !== null) await assertCanAccessGroup(groupId);
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
  let freeSource = false;
  let proxyChecked = 0; // live checks that finished
  let socks4Skipped = 0; // SOCKS4 proxies left out (Chromium cannot use them without a DNS leak)

  if (proxyMode === 'unique' || proxyMode === 'pool') {
    const filter = {};
    let sourceGroupId;
    if (input.proxyGroupId !== undefined && input.proxyGroupId !== '' && input.proxyGroupId !== 'all') {
      sourceGroupId = input.proxyGroupId === 'none' ? null : parseId(input.proxyGroupId, 'proxyGroupId');
    }
    // Free public proxies are used only when the user picks the Free proxies source, and then only
    // working ones; they are never mixed into the paid pool, a paid group or a provider.
    const sourceWhere = proxyScope.batchProxySourceWhere({ source: input.proxySource, proxyGroupId: sourceGroupId, provider: optionalString(input.provider) });
    freeSource = sourceWhere.provider === proxyScope.FREE_PROVIDER;
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
    // Generated profiles are Chromium, which cannot use SOCKS4 without leaking DNS.
    try {
      socks4Skipped = await db.proxy.count({ where: await scopedProxyWhere(proxyScope.andWhere(sourceWhere, { ...filter, type: 'SOCKS4' })) });
    } catch (e) { socks4Skipped = 0; }
    filter.type = { in: CHROMIUM_PROXY_TYPES };

    const pool = await db.proxy.findMany({
      where: await scopedProxyWhere(proxyScope.andWhere(sourceWhere, filter)),
      orderBy: { createdAt: 'asc' },
      select: { id: true, type: true, host: true, port: true, username: true, password: true, lastStatus: true, lastCheckedAt: true }
    });
    poolMatched = pool.length;

    // Only attach proxies that pass a live health check; those verified 'ok' in the last 30 minutes
    // are trusted as is. verifyProxies: false bypasses the gate, except for free proxies, which die
    // within hours.
    const verify = input.verifyProxies !== false || freeSource;
    if (proxyMode === 'unique') shuffleInPlace(pool); // so the same proxies aren't always picked first
    // Recently verified proxies first: they need no network check.
    const candidates = verify ? proxyGate.orderForCheck(pool) : pool;
    const isHealthy = async (p) => {
      if (!verify || proxyGate.isFreshlyVerified(p)) return true;
      const result = await testProxyConnectivity({ type: p.type, host: p.host, port: p.port, username: p.username, password: p.password }, proxyGate.QUICK_CHECK_TIMEOUTS);
      // A timeout inside the gate's shorter budget is not stored; the full check may still pass it.
      if (!proxyGate.isGateTimeout(result)) await persistProxyHealth(db, p.id, result).catch(() => {});
      return Boolean(result && result.success);
    };
    // Worker pool: the next proxy starts as soon as one finishes; stops once `count` work or on cancel.
    progress({ phase: 'check', checked: 0, total: candidates.length, working: 0, failed: 0, needed: count }, true);
    const scan = await proxyGate.collectWorkingProxies({
      candidates,
      limit: count,
      check: isHealthy,
      signal,
      onProgress: (s) => progress({ phase: 'check', ...s, needed: count })
    });
    progress({ phase: 'check', checked: scan.checked, total: candidates.length, working: scan.working.length, failed: scan.failed, needed: count }, true);
    proxyChecked = scan.checked;

    if (scan.cancelled) {
      progress({ phase: 'done', cancelled: true, created: 0, requested: count }, true);
      return {
        requested: count,
        createdCount: 0,
        profiles: [],
        cancelled: true,
        proxyLimited: false,
        availableProxies: scan.working.length,
        proxyVerifyExcluded: scan.failed,
        proxyChecked,
        socks4Skipped,
        proxyMode,
        proxySource: freeSource ? 'free' : 'paid',
        noProxyReason: null,
        groupId,
        errors: [],
        message: `Cancelled while checking proxies (${scan.checked} of ${candidates.length} checked). Nothing was created.`
      };
    }

    const healthy = scan.working;
    if (proxyMode === 'unique') {
      availableProxies = healthy.length;
      effectiveCount = Math.min(count, healthy.length);
      if (effectiveCount < count) { proxyLimited = true; proxyVerifyExcluded = scan.failed; }
      for (let i = 0; i < effectiveCount; i += 1) assignments.push({ proxyId: healthy[i].id });
    } else {
      // Pool: round-robin over the healthy subset, reuse allowed. If none pass, nothing is created
      // (see noProxyReason).
      availableProxies = healthy.length;
      proxyVerifyExcluded = scan.failed;
      if (healthy.length) {
        for (let i = 0; i < count; i += 1) assignments.push({ proxyId: healthy[i % healthy.length].id });
      } else {
        effectiveCount = 0;
        proxyLimited = true;
      }
    }
    if (effectiveCount === 0) noProxyReason = poolMatched === 0 ? 'no-match' : 'none-healthy';
  } else if (proxyMode === 'paste') {
    const pastedLines = Array.from(new Set(
      String(input.proxyList || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    ));
    // A SOCKS4 line (socks4:// or the SOCKS4 type) would give a Chromium profile a DNS leak.
    const pasteSocks4 = /^socks4/i.test(String(input.proxyType || ''));
    const lines = pastedLines.filter((s) => !(/^socks4a?:\/\//i.test(s) || (pasteSocks4 && !/^[a-z0-9]+:\/\//i.test(s))));
    socks4Skipped = pastedLines.length - lines.length;
    availableProxies = lines.length;
    effectiveCount = Math.min(count, availableProxies);
    if (effectiveCount < count) proxyLimited = true;
    for (let i = 0; i < effectiveCount; i += 1) {
      assignments.push({ proxyRaw: lines[i], proxyType: optionalString(input.proxyType) });
    }
  }
  // 'direct' → assignments empty, effectiveCount = count, no proxy bound.

  // Create the requested new group only now that at least one profile will go in it.
  let newGroupId = null;
  if (!groupId && newGroupName && effectiveCount > 0) {
    const g = await db.group.create({ data: { name: newGroupName.slice(0, 80), ownerMemberId: ownerStampId() } });
    groupId = g.id;
    newGroupId = g.id;
  }

  let versionPlan = null;
  if (distributeVersions) {
    const order = shuffleInPlace([...CHROME_VERSIONS]);
    versionPlan = Array.from({ length: effectiveCount }, (_, i) => order[i % order.length]);
  }

  const created = [];
  const errors = [];
  const usedSignatures = new Set();
  // The window's preview numbers the names with the same rule (src/renderer/lib/quickGenProgress.mjs
  // quickGenNumber; test/permissionsRound5.test.js runs this function to keep the two equal).
  const padLen = String(startIndex + Math.max(effectiveCount, 1) - 1).length;
  let cancelled = false;

  if (effectiveCount > 0) progress({ phase: 'create', created: 0, done: 0, toCreate: effectiveCount, requested: count, failed: 0 }, true);
  for (let i = 0; i < effectiveCount; i += 1) {
    // Cancel stops before the next profile; the ones already created are kept.
    if (signal && signal.aborted) { cancelled = true; break; }
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
      // createProfile gives each profile a device name and MAC no other profile uses.
      delete profilePayload.deviceName;
      delete profilePayload.macAddress;
    }

    try {
      const c = await createProfile(profilePayload);
      created.push(c);
    } catch (e) {
      errors.push({ title, message: (e && e.message) || 'create failed' });
    }
    progress({ phase: 'create', created: created.length, done: i + 1, toCreate: effectiveCount, requested: count, failed: errors.length });
  }
  // A group made for this run is removed again if a cancel left it empty.
  if (cancelled && newGroupId != null && created.length === 0) {
    await db.group.delete({ where: { id: newGroupId } }).catch(() => {});
    groupId = null;
  }

  let message;
  if (cancelled) {
    message = `Stopped: created ${created.length} of ${effectiveCount} profile${effectiveCount === 1 ? '' : 's'} before you cancelled. The ones already created were kept.`;
  } else if (noProxyReason === 'no-match' && freeSource) {
    message = `Nothing was created: there is no working free proxy${proxyMode === 'unique' ? ' that no profile uses yet' : ''}. Find or check some on the Free proxies page, or choose another proxy source.`;
  } else if (noProxyReason === 'no-match') {
    message = `Nothing was created: no proxy in your pool matches the selected source, country, speed or blocklist filter. Change the filters or add proxies. To create profiles without a proxy, choose "No proxy".`;
  } else if (noProxyReason === 'none-healthy') {
    message = `Nothing was created: none of the ${poolMatched} matching prox${poolMatched === 1 ? 'y' : 'ies'} passed the live check, and profiles are never created on your real IP by mistake. Check the proxies on the Proxy Pool page, or choose "No proxy" to create profiles without one.`;
  } else if (proxyLimited) {
    if (proxyMode === 'paste') {
      message = `Created ${created.length} of ${count} requested - you have ${availableProxies} unique proxy line(s). Add ${count - availableProxies} more to create the remaining ${count - effectiveCount}.`;
    } else {
      // Says the shortfall first: "80 requested, only 61 working proxies".
      const missing = count - effectiveCount;
      const failNote = proxyVerifyExcluded ? ` ${proxyVerifyExcluded} of the ${proxyChecked} proxies checked did not work and were skipped.` : '';
      message = `${count} requested, only ${availableProxies} working prox${availableProxies === 1 ? 'y' : 'ies'}: created ${created.length} profile${created.length === 1 ? '' : 's'}.${failNote} Add ${missing} more working prox${missing === 1 ? 'y' : 'ies'} to create the rest.`;
    }
  } else {
    const failNote = proxyVerifyExcluded ? ` - ${proxyVerifyExcluded} unhealthy prox${proxyVerifyExcluded === 1 ? 'y was' : 'ies were'} skipped` : '';
    message = `Created ${created.length} profile${created.length === 1 ? '' : 's'}${groupId ? ' in the selected group' : ''}${failNote}.`;
  }
  // Only worth saying when it cost profiles.
  if (socks4Skipped && (proxyLimited || noProxyReason)) message += ` ${socks4Skipped} SOCKS4 prox${socks4Skipped === 1 ? 'y was' : 'ies were'} left out: Chromium profiles cannot send DNS lookups through SOCKS4.`;
  if (errors.length) message += ` ${errors.length} profile${errors.length === 1 ? '' : 's'} could not be created: ${errors[0].message}`;
  progress({ phase: 'done', cancelled, created: created.length, requested: count }, true);

  return {
    requested: count,
    createdCount: created.length,
    profiles: created,
    cancelled,
    toCreate: effectiveCount,
    proxyLimited,
    availableProxies,
    proxyVerifyExcluded,
    proxyChecked,
    socks4Skipped,
    proxyMode,
    proxySource: freeSource ? 'free' : 'paid',
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

  // A changed device name or MAC must be usable and not used by another profile; an unchanged one is
  // kept as it is, and an emptied one gets a new value.
  {
    const os = data.os !== undefined ? data.os : existing.os;
    const changed = {
      deviceNameType: data.deviceNameType !== undefined ? data.deviceNameType : existing.deviceNameType,
      macAddressType: data.macAddressType !== undefined ? data.macAddressType : existing.macAddressType,
      deviceName: data.deviceName !== undefined && String(data.deviceName || '').trim().toLowerCase() !== String(existing.deviceName || '').trim().toLowerCase() ? data.deviceName : null,
      macAddress: data.macAddress !== undefined && profileOptions.normalizeMac(data.macAddress) !== profileOptions.normalizeMac(existing.macAddress) ? data.macAddress : null
    };
    if (changed.deviceName || changed.macAddress) assertDeviceIdentity(changed, await takenDeviceIdentities(db, id), os);
    if ((data.deviceName !== undefined && !data.deviceName) || (data.macAddress !== undefined && !data.macAddress)) {
      const filled = fillDeviceIdentity({
        deviceNameType: changed.deviceNameType, macAddressType: changed.macAddressType,
        deviceName: data.deviceName !== undefined ? data.deviceName : existing.deviceName,
        macAddress: data.macAddress !== undefined ? data.macAddress : existing.macAddress
      }, await takenDeviceIdentities(db, id), os);
      if (data.deviceName !== undefined && !data.deviceName) data.deviceName = filled.deviceName;
      if (data.macAddress !== undefined && !data.macAddress) data.macAddress = filled.macAddress;
    }
  }

  if (input.groupId !== undefined) {
    data.groupId = (input.groupId === null || input.groupId === '') ? null : parseId(input.groupId, 'groupId');
    if (data.groupId !== null && data.groupId !== existing.groupId && !(await db.group.findUnique({ where: { id: data.groupId } }))) {
      throw new Error('Selected group does not exist.');
    }
    // A new group must be one the member can see; the current one can stay.
    if (data.groupId !== null && data.groupId !== existing.groupId) await assertCanAccessGroup(data.groupId);
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
      // A new proxy must be one the member may use. The current one can stay: a shared profile may
      // run on its owner's proxy, and the editor sends it back unchanged.
      if (proxyId !== existing.proxyId) await assertCanAccessProxy(proxyId);
      data.proxyId = proxyId;
      data.proxyInfoString = buildProxyInfoString(proxy);
    }
  }

  if (input.proxyRaw) {
    const proxy = await findOrCreateProxy(db, input.proxyRaw, `${existing.title} Proxy`, proxyTypeHintFor(input.proxyRaw, input.proxyType));
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

// Trash actions change the profile, so like editing they need edit access: a profile shared with the
// member "use only" cannot be trashed, restored or purged by them.
async function deleteProfile(payload) {
  await requirePermission('profiles.delete');
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProfile(id, { requireEdit: true });
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

// Restoring undoes a move to Trash, so it needs the same right (profiles.delete, Admin and up).
async function restoreProfile(payload) {
  await requirePermission('profiles.delete');
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProfile(id, { requireEdit: true });
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
  await assertCanAccessProfile(id, { requireEdit: true });
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
  const { allowed, denied } = await partitionAccessibleProfileIds(ids, { requireEdit: true });
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
  await requirePermission('profiles.delete');
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const { allowed, denied } = await partitionAccessibleProfileIds(ids, { requireEdit: true });
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
  const { allowed, denied } = await partitionAccessibleProfileIds(ids, { requireEdit: true });
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

// Lists are scoped, not gated, like the profile and proxy lists: only the groups this member may see,
// and only their visible profiles in the count and tags.
async function listGroups() {
  const db = getPrisma();
  const groups = await db.group.findMany({
    where: await scopedGroupWhere(undefined),
    orderBy: { createdAt: 'desc' },
    include: { profiles: { where: await scopedProfileWhere({ deletedAt: null }), select: { tags: true } } }
  });
  const canManage = await ownedRowManageChecker();
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : g.createdAt,
    profileCount: g.profiles.length,
    tags: collectTags(g.profiles),
    canManage: canManage(g) // rename and delete; the Groups page disables them otherwise
  }));
}

// For rows already listed through scopedGroupWhere / scopedProxyGroupWhere: may this member rename
// or delete them (the `manage` rule)? Their owner is in the member's visible subtree, or they have no
// owner and the member is the Owner or an Admin. Main still checks on rename and delete.
async function ownedRowManageChecker() {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return () => true;
  const visible = permissions.visibleMemberIds(await getPrisma().member.findMany(), member);
  const admin = permissions.rankOf(member.role) >= permissions.ROLE_RANK.ADMIN;
  return (row) => (row.ownerMemberId == null ? admin : visible.has(row.ownerMemberId));
}

// Groups only organise profiles, so making, renaming, deleting and filling one needs the right to
// edit profiles (the SoftGlaze AI group tools already ask for it). The creator owns the group, as
// with proxy groups and macros.
async function createGroup(payload) {
  await requirePermission('profiles.edit');
  const input = requireObject(payload);
  const db = getPrisma();
  const name = requiredString(input.name, 'Group name');
  const color = optionalString(input.color) || '#3b82f6';
  const created = await db.group.create({ data: { name, color, ownerMemberId: ownerStampId() } });
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
  await requirePermission('profiles.edit');
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessGroup(id, { manage: true });
  const data = {};
  if (input.name !== undefined) data.name = requiredString(input.name, 'Group name');
  if (input.color !== undefined) data.color = optionalString(input.color) || '#3b82f6';
  const updated = await db.group.update({ where: { id }, data });
  return { id: updated.id, name: updated.name, color: updated.color };
}

async function deleteGroup(payload) {
  await requirePermission('profiles.edit');
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessGroup(id, { manage: true });
  // The runtime SQLite Profile table has no DB-level FK for groupId, so detach
  // member profiles explicitly before removing the group (no dangling refs).
  await db.profile.updateMany({ where: { groupId: id }, data: { groupId: null } });
  await db.group.delete({ where: { id } });
  return { deleted: true, id };
}

// Moving profiles is the bulk form of changing a profile's group in the editor: the same permission,
// edit access to each profile, and a group the member can see.
async function assignProfilesToGroup(payload) {
  await requirePermission('profiles.edit');
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const groupId = (input.groupId === null || input.groupId === undefined || input.groupId === '')
    ? null
    : parseId(input.groupId, 'groupId');
  if (groupId !== null) {
    const group = await db.group.findUnique({ where: { id: groupId } });
    if (!group) throw new Error('Selected group does not exist.');
    await assertCanAccessGroup(groupId);
  }
  const { allowed } = await partitionAccessibleProfileIds(ids, { requireEdit: true });
  const res = await db.profile.updateMany({ where: { id: { in: allowed } }, data: { groupId } });
  const label = groupId === null ? 'removed from group' : 'assigned to a group';
  for (const id of allowed) { await logActivity(db, id, 'assign', label); }
  return { assigned: res.count, groupId };
}

// Adds or removes one tag across profiles. Tags are a JSON array per profile, so this is a scoped
// read-modify-write, case-insensitive both ways. Tagging is editing: profiles.edit and edit access to
// each profile (a profile shared "use only" is skipped and counted in `skipped`).
async function assignTagToProfiles(payload) {
  await requirePermission('profiles.edit');
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const tag = String(input.tag || '').trim().slice(0, 40);
  const mode = input.mode === 'remove' ? 'remove' : 'add';
  if (!tag) throw new Error('A tag is required.');
  const { allowed, denied } = await partitionAccessibleProfileIds(ids, { requireEdit: true });
  const skipped = denied.length;
  if (!allowed.length) return { updated: 0, tag, mode, skipped };
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
  return { updated, tag, mode, skipped };
}

// Takes an explicit [{id,title}] list or a { prefix, start } pattern numbered in the renderer's
// visible order. Only the title changes; dataDirName never does. Renaming is editing: profiles.edit
// and edit access to each profile (others are skipped and counted; numbering skips them too).
async function bulkRenameProfiles(payload) {
  await requirePermission('profiles.edit');
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const { allowed, denied } = await partitionAccessibleProfileIds(ids, { requireEdit: true });
  const skipped = denied.length;
  if (!allowed.length) return { renamed: 0, skipped };
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
    return { renamed, skipped };
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
  return { renamed, skipped };
}

// ---- Proxy groups ----
// Proxy groups follow the profile-group rules (scopedGroupWhere), with proxies in place of profiles:
// a member sees a proxy group made by someone in their visible subtree, or one that holds a proxy
// they may use. A group with no owner (made in single-user mode or by the Super Admin) is also
// visible to the Owner and Admins. Renaming or deleting (`manage`) needs the first or last rule, not
// just a visible proxy inside. Single-user mode and the Super Admin are unrestricted.
async function scopedProxyGroupWhere(baseWhere, opts = {}) {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return baseWhere;
  const all = await getPrisma().member.findMany();
  const visible = [...permissions.visibleMemberIds(all, member)];
  const or = [{ ownerMemberId: { in: visible } }];
  if (permissions.rankOf(member.role) >= permissions.ROLE_RANK.ADMIN) or.push({ ownerMemberId: null });
  if (!opts.manage) or.push({ proxies: { some: { ownerMemberId: { in: visible } } } });
  return baseWhere ? { AND: [baseWhere, { OR: or }] } : { OR: or };
}

async function assertCanAccessProxyGroup(id, opts = {}) {
  const member = await getActiveMember();
  if (!member || member.role === 'SUPER_ADMIN') return;
  const db = getPrisma();
  if (!(await db.proxyGroup.findUnique({ where: { id }, select: { id: true } }))) throw new Error('Proxy group not found.');
  if (!(await db.proxyGroup.findFirst({ where: await scopedProxyGroupWhere({ id }, opts), select: { id: true } }))) {
    const e = new Error('You do not have access to this proxy group.'); e.code = 'FORBIDDEN'; throw e;
  }
}

// Paid view only: the "Free proxies" group and free proxies inside any group are left out. Scoped,
// not gated, like the proxy list: only the groups this member may see, counting only their proxies.
async function listProxyGroups() {
  const db = getPrisma();
  const visibleProxies = await scopedProxyWhere(undefined); // undefined = every proxy
  const [groups, totals, freeCounts] = await Promise.all([
    db.proxyGroup.findMany({ where: await scopedProxyGroupWhere(undefined), orderBy: { createdAt: 'asc' } }),
    db.proxy.groupBy({ by: ['proxyGroupId'], where: proxyScope.andWhere({ proxyGroupId: { not: null } }, visibleProxies), _count: { _all: true } }).catch(() => []),
    db.proxy.groupBy({ by: ['proxyGroupId'], where: proxyScope.andWhere({ provider: proxyScope.FREE_PROVIDER, proxyGroupId: { not: null } }, visibleProxies), _count: { _all: true } }).catch(() => [])
  ]);
  const totalByGroup = {};
  for (const r of totals) totalByGroup[r.proxyGroupId] = r._count._all;
  const freeByGroup = {};
  for (const r of freeCounts) freeByGroup[r.proxyGroupId] = r._count._all;
  const canManage = await ownedRowManageChecker();
  return proxyScope.paidGroupView(groups.map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color || '#3b82f6',
    autoCreated: Boolean(g.autoCreated),
    proxyCount: totalByGroup[g.id] || 0,
    createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : g.createdAt,
    canManage: canManage(g) // rename and delete; the Proxy pool disables them otherwise
  })), freeByGroup);
}

// Proxy groups only organise proxies, so making, renaming, deleting and filling one needs the right
// to manage proxies (as adding, editing and deleting them does). The creator owns the group.
async function createProxyGroup(payload) {
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const db = getPrisma();
  const name = requiredString(input.name, 'Group name').slice(0, 80);
  const color = optionalString(input.color) || '#3b82f6';
  const created = await db.proxyGroup.create({ data: { name, color, ownerMemberId: ownerStampId() } });
  return { id: created.id, name: created.name, color: created.color, proxyCount: 0 };
}

async function updateProxyGroup(payload) {
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProxyGroup(id, { manage: true });
  const data = {};
  if (input.name !== undefined) data.name = requiredString(input.name, 'Group name').slice(0, 80);
  if (input.color !== undefined) data.color = optionalString(input.color) || '#3b82f6';
  const updated = await db.proxyGroup.update({ where: { id }, data });
  return { id: updated.id, name: updated.name, color: updated.color };
}

async function deleteProxyGroup(payload) {
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  await assertCanAccessProxyGroup(id, { manage: true });
  // Detach proxies first (keep the proxies; only drop the grouping).
  await db.proxy.updateMany({ where: { proxyGroupId: id }, data: { proxyGroupId: null } });
  await db.proxyGroup.delete({ where: { id } });
  await logAudit('proxy-group.delete', { detail: { proxyGroupId: id } });
  return { deleted: true, id };
}

// Moves only proxies the member may use, into a proxy group the member can see.
async function assignProxiesToGroup(payload) {
  await requirePermission('proxies.manage');
  const input = requireObject(payload);
  const db = getPrisma();
  const ids = parseIdArray(input.ids);
  const groupId = (input.groupId === null || input.groupId === undefined || input.groupId === '')
    ? null
    : parseId(input.groupId, 'proxyGroupId');
  if (groupId !== null) {
    const group = await db.proxyGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new Error('Selected proxy group does not exist.');
    await assertCanAccessProxyGroup(groupId);
  }
  const { allowed, denied } = await partitionAccessibleProxyIds(ids);
  const res = await db.proxy.updateMany({ where: { id: { in: allowed } }, data: { proxyGroupId: groupId } });
  await pruneEmptyAutoGroups(db); // moving the last proxy out empties an auto group too
  return { assigned: res.count, groupId, skipped: denied.length };
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
  // socks4Chromium: profiles that got a SOCKS4 proxy but open in Chromium, which refuses to launch
  // through SOCKS4 (DNS leak); the renderer says so instead of letting the launch fail later.
  const result = { mode, updated: [], socks4Chromium: [], errors: denied.map((id) => ({ id, message: 'You do not have access to this profile.' })) };
  const finish = (extra = {}) => ({ ...result, assigned: result.updated.length, ...extra });
  if (!allowed.length) return finish({ source: 0 });

  // Apply (or clear) one profile's proxy + keep the cached info string and behavior flag in sync.
  const applyProxy = async (profileId, proxy) => {
    const data = proxy
      ? { proxyId: proxy.id, proxyInfoString: buildProxyInfoString(proxy), systemProxyBehavior: 'PROFILE_PROXY' }
      : { proxyId: null, proxyInfoString: null, systemProxyBehavior: 'DIRECT' };
    const row = await db.profile.update({ where: { id: profileId }, data, select: { id: true, browserCore: true } });
    if (proxy && launchCheck.socks4DnsLeak({ proxyType: proxy.type, browserCore: row && row.browserCore })) result.socks4Chromium.push(profileId);
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
    // A pasted line reuses a proxy the member may use; a new one counts against their proxy limit.
    const add = await proxyAddContext();
    let limitErr = null;
    for (const line of lines) {
      try { const p = await findOrCreateProxy(db, line, null, typeHint, add); if (p) sourceProxies.push(p); }
      catch (e) { if (e && e.code === 'LIMIT_REACHED') limitErr = e; /* otherwise skip an unparseable line */ }
    }
    if (limitErr) {
      if (!sourceProxies.length) throw limitErr;
      result.proxyLimitMessage = limitErr.message; // the lines past the limit were left out
    }
  } else {
    const filter = {};
    if (source === 'unassigned') filter.profiles = { none: { deletedAt: null } };
    else if (source === 'group') filter.proxyGroupId = parseId(input.proxyGroupId, 'proxyGroupId');
    // Reassigning draws from the paid pool only; a free proxy is picked one at a time in the editor.
    sourceProxies = await db.proxy.findMany({
      where: await scopedProxyWhere(proxyScope.withProxyScope(Object.keys(filter).length ? filter : undefined, 'paid')),
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
  await requirePermission('proxies.manage');
  const input = requireObject(payload || {});
  const level = ['country', 'state', 'city'].includes(String(input.level)) ? String(input.level) : 'country';
  const onlyUngrouped = input.onlyUngrouped === true;
  const db = getPrisma();

  const base = { lastCountry: { not: null } };
  if (onlyUngrouped) base.proxyGroupId = null;
  // Free proxies stay in their own group, off the paid side.
  const proxies = await db.proxy.findMany({
    where: await scopedProxyWhere(proxyScope.withProxyScope(base, 'paid')),
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

  // Find-or-create each group by case-insensitive name, then assign its proxies. Only a group the
  // member can see is joined: another member's "United States" is never filled with this member's
  // proxies (the member gets their own, as batch import does for profile groups).
  const existing = await db.proxyGroup.findMany({ where: await scopedProxyGroupWhere(undefined), select: { id: true, name: true } });
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
  // Tags of the profiles this member can see only, as in the Groups list.
  const rows = await db.profile.findMany({ where: await scopedProfileWhere({ deletedAt: null }), select: { tags: true } });
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
  const requesterId = (member && member.id != null) ? member.id : actingMemberId();
  if (teamPolicy.lockBlocks(existing, requesterId, live)) {
    const when = existing.at ? new Date(existing.at).toLocaleString() : 'now';
    const e = new Error(`This profile is in use by ${existing.memberName || 'another member'} (since ${when}). Ask them to close it first.`);
    e.code = 'PROFILE_LOCKED';
    throw e;
  }
}

function acquireProfileLock(profileId, sessionId, member) {
  profileLocks.set(Number(profileId), {
    memberId: (member && member.id != null) ? member.id : actingMemberId(),
    memberName: (member && member.name) || 'You',
    sessionId: String(sessionId),
    at: Date.now()
  });
}

// Two-phase lock: reserve before the heavy spawn, upgrade via acquireProfileLock on success, release
// on failure. releaseReservedLock removes only this reservation object, never another launch's lock.
function reserveProfileLock(profileId, member) {
  const reservation = {
    memberId: (member && member.id != null) ? member.id : actingMemberId(),
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
  const found = await db.profile.findUnique({ where: { id }, include: { proxy: true } });
  if (!found) throw new Error('Profile not found.');
  // A profile without a usable device name / MAC (made before 1.0.26) gets its own pair now.
  const profile = await ensureProfileDeviceIdentity(db, found);

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
  // Data Vault autofill in this browser follows the member launching it now (a token's member for
  // SoftGlaze AI and the Local API), not whoever is signed in to the window later (sessionLaunchers).
  const launchedBy = actingMemberId() == null ? null : actingMemberId(); // null: single-user mode
  let undoLauncher = null;
  try {
    // Firefox has no CDP or MV3, so its launcher configures a dedicated profile through user.js prefs
    // (proxy and auth relay, UA, locale, timezone, WebRTC off).
    const isFirefox = normalizeBrowserCore(profile.browserCore) === BROWSER_CORE.FIREFOX;
    if (isFirefox) {
      const { profileRoot: ffRoot } = getRuntimeConfig();
      const useFfProxy = profile.systemProxyBehavior === 'PROFILE_PROXY';
      const ffRotated = await pickRotationProxy(db, id);
      assertProfileHasLaunchProxy(profile, ffRotated);
      const ffProxy = ffRotated || (useFfProxy ? profile.proxy : null);
      // Smart Autofill on Firefox: master toggle AND the firefox sub-flag must both be on, and the
      // launcher must be allowed the vault in autofill. Installs the WebExtension and gives this profile
      // its own bridge port; without it the engine takes out a copy an earlier launch installed. The
      // bridge then asks the rule for this session at fill time, as the Chromium bridge does.
      const ffAutofill = (globalSettings.smartAutofill?.enabled !== false)
        && (globalSettings.smartAutofill?.firefox !== false)
        && (await vaultAutofillAllowed(launchedBy));
      undoLauncher = recordSessionLauncher(profile.id, launchedBy);
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
      // Already open: that browser keeps the member who launched it.
      if (ffSession && ffSession.alreadyRunning) undoLauncher();
      acquireProfileLock(id, ffSession.sessionId, launcher);
      await db.profile.update({ where: { id }, data: { lastUsedAt: new Date(), launchCount: { increment: 1 } } }).catch(() => {});
      await logActivity(db, id, 'launch', `firefox session ${ffSession.sessionId}${ffRotated ? ` · rotated ${ffRotated.name}` : ''}`);
      noteStoreRatingLaunch(input);
      return { ...ffSession, rotatedProxy: await launchedProxyView(ffRotated) };
    }

    // A User-Agent picked in the editor is applied as picked (browserEngine), even when it names another
    // browser or version than the one launched; the editor warns about that, and so does this log.
    const pickedUa = profileOptions.customUserAgent(profile);
    if (pickedUa) {
      const family = profileOptions.uaFamily(pickedUa);
      const uaMajor = profileOptions.uaChromeMajor(pickedUa);
      if (family !== 'chromium') {
        console.warn(`[profile:launch] Profile "${profile.title}" uses a picked ${family} User-Agent on Chromium: sites can tell from the browser's behaviour that it is not that browser.`);
      } else if (uaMajor) {
        const pin = profileOptions.chromeVersionPin(profile.browserVersion);
        if (pin && pin !== uaMajor) console.warn(`[profile:launch] Profile "${profile.title}" picks a Chrome ${uaMajor} User-Agent but launches Chrome ${pin}.`);
      }
    }

    const { profileRoot } = getRuntimeConfig();
    const useProfileProxy = profile.systemProxyBehavior === 'PROFILE_PROXY';

    // browser + onStartup drive launch flags; website rules drive request filtering.
    const browserSettings = { ...globalSettings.browser, ...globalSettings.onStartup, website: globalSettings.website };

    // Proxy rotation: if a pool is configured, the chosen pool proxy overrides the
    // profile's fixed proxy for this launch (sticky session - same userDataDir).
    const rotated = await pickRotationProxy(db, id);
    assertProfileHasLaunchProxy(profile, rotated);
    const launchProxy = rotated || (useProfileProxy ? profile.proxy : null);
    const launchProxyInfo = rotated ? null : (useProfileProxy ? profile.proxyInfoString : null);

    // Stable Chrome ignores --load-extension, so a profile that opts into extensions launches on
    // Chrome for Testing (chooseBrowserBinary); the rest stay on stealthier real Chrome.
    let perProfileBrowser = {};
    try { perProfileBrowser = profile.browserSettingsJson ? JSON.parse(profile.browserSettingsJson) : {}; } catch (e) { perProfileBrowser = {}; }
    const loadExtensions = perProfileBrowser.loadExtensions === true;
    const globalExtensionDirs = loadExtensions ? await extensionManager.resolveGlobalExtensionDirs() : [];

    undoLauncher = recordSessionLauncher(profile.id, launchedBy);
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
    // Already open: that browser keeps the member who launched it.
    if (session && session.alreadyRunning) undoLauncher();

    acquireProfileLock(id, session.sessionId, launcher);
    await db.profile.update({ where: { id }, data: { lastUsedAt: new Date(), launchCount: { increment: 1 } } }).catch(() => {});
    await logActivity(db, id, 'launch', `session ${session.sessionId}${rotated ? ` · rotated proxy ${rotated.name}` : ''}`);
    noteStoreRatingLaunch(input);
    return { ...session, rotatedProxy: await launchedProxyView(rotated) };
  } catch (err) {
    releaseReservedLock(id, reservation); // no-op once upgraded, or if it is not ours
    if (undoLauncher) undoLauncher();
    throw err;
  }
}

// Who launched each running profile: session id -> { memberId }. memberId is null in single-user mode
// (the Owner). Data Vault autofill in that browser follows this member, not whoever is signed in to the
// window later (sessionAutofillAllowed), so switching members in the window changes nothing for a
// profile already open. Both bridges know the session asking: Chromium passes it, and each Firefox
// profile has its own bridge port (autofillBridge.js). Recorded before the engine starts the browser,
// because its first page asks while the launch is still running; dropped when the session ends.
const sessionLaunchers = new Map();

// Returns an undo for a launch that fails: it puts back what was there, so a profile already open
// keeps its launcher.
function recordSessionLauncher(sessionId, memberId, extra = {}) {
  const key = String(sessionId);
  const prev = sessionLaunchers.get(key);
  const rec = { memberId: memberId == null ? null : memberId, ...extra };
  sessionLaunchers.set(key, rec);
  return () => {
    if (sessionLaunchers.get(key) !== rec) return;
    if (prev) sessionLaunchers.set(key, prev);
    else sessionLaunchers.delete(key);
  };
}

// The rotation pool's proxy a launch picked, as the launcher may see it: one outside their own Proxy
// pool (a profile shared with them, set up by its owner) without its username and rotation link.
async function launchedProxyView(proxy) {
  if (!proxy) return null;
  const view = serializeProxy(proxy);
  try { await assertCanAccessProxy(proxy.id); return view; }
  catch (e) { return redactForeignProxy(view); }
}

// A profile set to "Profile proxy" that has no proxy (its proxy was deleted, or a template or copy
// left out a proxy the member may not use) opens neither on the real IP nor on a stale cached
// address: the launch is refused until a proxy is assigned or the profile is set to no proxy. A
// rotation pool that picked a proxy for this launch is enough.
function assertProfileHasLaunchProxy(profile, rotated) {
  if (rotated || !profile || profile.systemProxyBehavior !== 'PROFILE_PROXY') return;
  if (profile.proxy || profile.proxyInfoString) return;
  const e = new Error('This profile is set to use a proxy but has none (its proxy was deleted, or is not available to you). Assign a proxy in the profile editor, or set it to no proxy, before launching.');
  e.code = 'PROXY_MISSING';
  throw e;
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
  // A script or AI app that drives a profile over its DevTools endpoint can close the browser
  // itself; that ending is a close, not a crash (no crash toast, no auto-restart).
  if (evt.type === 'crashed' && pid != null && apiDrivenProfiles.has(pid)) evt = { ...evt, type: 'closed', reason: 'api-client' };
  if (pid != null) { apiDrivenProfiles.delete(pid); ai.onProfileClosed(pid); } // closed or crashed: no script drives it any more
  // Closed or crashed: the session's launcher goes with it (a restart records its own).
  if (evt.type === 'closed' || evt.type === 'crashed') sessionLaunchers.delete(String(evt.sessionId != null ? evt.sessionId : pid));
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
// the next launch. Same conditions as pickRotationProxy, without moving its cursor. (Sticky with no
// proxy of its own launches on the pool's first proxy; a switch here gives the profile its own
// proxy, which Sticky then keeps, so it still counts as not using the pool.)
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
    canRotate: proxyCanRotate(proxy),
    poolInUse: Boolean(proxy) && (proxy.id !== profile.proxyId || await profileUsesRotationPool(id))
  });
  if (!plan.steps.length) return { action: 'none', reason: plan.reason };

  const retryUrl = blockDetect.retryUrlFor(evt.url);
  let reason = 'failed';
  for (const step of plan.steps) {
    try {
      if (step === 'rotate') {
        // With the profile's id: a member who may only use the profile rotates its proxy as well.
        const res = await rotateProxyIp({ id: proxy.id, profileId: id });
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
  // A spare comes from the paid pool: a free proxy is never picked for a profile automatically.
  const candidates = (await db.proxy.findMany({ where: await scopedProxyWhere({ lastStatus: 'ok', profiles: { none: {} } }) }))
    .filter((p) => !proxyScope.isFreeProxy(p));
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
  // The same permission and profile quota as creating one profile: an import at the limit is refused
  // before it starts, and one that reaches it stops at that row (checked again per row below).
  await requirePermission('profiles.create');
  const input = requireObject(payload);
  const token = requiredString(input.token, 'Import token');
  const autoBind = Boolean(input.autoBindByCountry);
  const cached = importPreviewCache.get(token);
  if (!cached) throw new Error('Import preview expired or was not found. Please preview the file again.');
  await assertWithinLimit('profiles');

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
  // autoBindSource 'free' binds to working free proxies; the default is the paid pool. Either way only
  // proxies the importing member may use, as Quick generate does.
  const pool = autoBind ? await db.proxy.findMany({ where: await scopedProxyWhere(proxyScope.autoBindPoolWhere(input.autoBindSource)) }) : [];
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

  // Rotation URLs have no Profile column - round-trip them via a Setting map (the export reads it). A row
  // with its own proxy also puts its link on that proxy, where rotating uses it (see importedRotationUrl).
  const rotationUrls = (await readSetting('profileRotationUrls', {})) || {};
  let rotationDirty = false;
  // Device names and MACs in use, read once for the run (claimDeviceIdentity keeps it up to date).
  const importIdentities = {};
  // Stamp the importing member as owner and assignee, as createProfile does. An unowned row is
  // hidden from every member but the Super Admin (scopedProfileWhere fails closed), so imported
  // profiles did not show up in the importer's own Profiles list.
  const stampId = ownerStampId();
  // A log-only line (no progress-bar change); item/done lines move the bar.
  const log = (level, message) => emit({ phase: 'log', level, message });
  const groupsByName = new Map(); // group name -> row found or made for an earlier row of this file
  // A custom proxy reuses only a row the importer may use; a new one counts against their proxy limit.
  const proxyAdd = await proxyAddContext();

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
      // Before anything is made for this row (proxy, group), so nothing is created past the limit.
      await assertWithinLimit('profiles');

      let proxy = null;
      let autoBoundProxy = false;
      if (item.proxyMethod === 'CUSTOM') {
        proxy = await findOrCreateProxy(db, item.rawProxy, `${item.title} Proxy`, item.proxyType || null, proxyAdd);
        if (proxy) {
          // The row's rotation link is this proxy's "change IP" link: it goes on the proxy unless the proxy
          // has one of its own, which always wins (importedRotationUrl).
          const link = importedRotationUrl(item.proxyRotationUrl);
          if (link && !proxy.rotationUrl) {
            if (await attachImportedRotationUrl(db, proxy.id, link)) {
              proxy = { ...proxy, rotationUrl: link };
              log('info', `[INFO] Rotation link saved on proxy ${proxy.host}:${proxy.port}.`);
            }
          } else if (link && proxy.rotationUrl !== link) {
            log('info', `[INFO] Proxy ${proxy.host}:${proxy.port} keeps its own rotation link.`);
          }
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

      // Resolve the group by name (create it if new) so "Group Name" works. Only a group the member
      // can see is reused; another member's group with the same name is never joined. A group made
      // here belongs to the importing member.
      let groupId = null;
      if (item.group) {
        const groupName = String(item.group).trim();
        if (groupName && !/^\d+$/.test(groupName)) { // skip bare "0/1" tag flags
          const existingGroup = groupsByName.get(groupName) || await db.group.findFirst({ where: await scopedGroupWhere({ name: groupName }) });
          const grp = existingGroup || await db.group.create({ data: { name: groupName, ownerMemberId: stampId } });
          groupsByName.set(groupName, grp);
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
      if (item.doNotTrack !== undefined && item.doNotTrack !== null) fp.doNotTrack = doNotTrackChoice(item.doNotTrack);
      if (item.timezoneType) fp.timezoneType = item.timezoneType;
      if (item.timezoneCustom) fp.timezoneCustom = item.timezoneCustom;
      if (item.languageType) fp.languageType = item.languageType;
      if (item.languageCustom) fp.languageCustom = item.languageCustom;
      if (item.locationType) fp.locationType = item.locationType;
      if (item.locationLat) fp.locationLat = String(item.locationLat);
      if (item.locationLng) fp.locationLng = String(item.locationLng);

      const dataDirName = await ensureUniqueDataDirName(db, item.dataDirName || item.title);
      // Generate a distinct fingerprint first, then let the imported values override it.
      const fpFields = generateFingerprint({ os: fp.os });
      // Device name and MAC: the imported ones when usable and unused, else new ones for this profile.
      if (item.deviceName) fp.deviceName = String(item.deviceName).trim();
      if (item.macAddress) fp.macAddress = String(item.macAddress).trim();
      const identity = await claimDeviceIdentity(db, importIdentities, { ...fpFields, ...fp }, fp.os || fpFields.os);
      const profile = await db.profile.create({
        data: {
          ...fpFields,
          ...fp,
          deviceName: identity.deviceName,
          macAddress: identity.macAddress,
          title: item.title,
          proxyId: proxy ? proxy.id : null,
          proxyInfoString: proxy ? buildProxyInfoString(proxy) : null,
          notes: optionalString(item.notes),
          systemProxyBehavior,
          dataDirName,
          ownerMemberId: stampId,
          assignedMemberId: stampId,
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
      // The profile limit: no later row can be created either, so the import stops here. (At the proxy
      // limit only rows with a new custom proxy fail; the others still import.)
      if (error && error.code === 'LIMIT_REACHED' && error.limitKind !== 'proxy') {
        const left = total - processed;
        result.stoppedAtLimit = { row: item.row, notImported: left + 1 };
        if (left > 0) log('warn', `[WARN] Import stopped: the profile limit was reached, so ${left} more row${left === 1 ? ' was' : 's were'} not imported.`);
        break;
      }
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
  const migrateIdentities = {}; // device names and MACs in use, read once for the run
  let processed = 0;
  // Read outside the per-profile transactions below (a query on the outer client inside one blocks).
  const proxyAdd = await proxyAddContext();

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
        if (norm.proxyRaw) proxy = await findOrCreateProxy(tx, norm.proxyRaw, `${norm.title} Proxy`, norm.proxyType, proxyAdd);
        const dataDirName = await ensureUniqueDataDirName(tx, norm.title);
        const overrides = {};
        if (norm.os) overrides.os = norm.os;
        if (norm.userAgent) overrides.userAgent = norm.userAgent;
        const base = generateFingerprint(); // distinct Softglaze fingerprint base
        const identity = await claimDeviceIdentity(tx, migrateIdentities, { ...base, ...overrides, deviceName: null, macAddress: null }, overrides.os || base.os);
        const profile = await tx.profile.create({
          data: {
            ...base,
            deviceName: identity.deviceName,
            macAddress: identity.macAddress,
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
  // Read back by batch import (when not used by another profile there).
  ['Device Name', (p) => (/^real$/i.test(String(p.deviceNameType || '')) ? '' : (p.deviceName || ''))],
  ['MAC Address', (p) => (/^real$/i.test(String(p.macAddressType || '')) ? '' : (p.macAddress || ''))],
  // The editor's word, which batch import reads back unchanged (older exports wrote 1 / 0; still read).
  ['Do Not Track', (p) => doNotTrackChoice(p.doNotTrack)],
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
    include: { proxy: true, group: true, accesses: { select: PROFILE_ACCESS_SELECT.accesses.select } },
    orderBy: { createdAt: 'asc' }
  });
  const rotationUrls = (await readSetting('profileRotationUrls', {})) || {};
  // profiles.export is rank 1, so blank proxy passwords, account passwords and 2FA keys unless the
  // member may reveal them (the same gates as the profile view and the 2FA code reader).
  const member = await getActiveMember(); // also refreshes the reveal flag (proxyRevealAllowed)
  const revealCreds = proxyRevealAllowed();
  let revealTwoFa = revealCreds;
  if (revealTwoFa) { try { await assertCanRevealKind('twoFactorCode'); } catch (e) { revealTwoFa = false; } }
  // A profile shared "use only" never hands over its saved platform logins (the rule of a copy of it,
  // stripUseOnlySecrets): its account password and 2FA key stay blank whatever the role. Nor its
  // proxy's password or rotation link, and the proxy username only as the member's Proxy pool shows
  // it (their own pool's proxy, with proxies.reveal); the profile list follows the same rule.
  // Without proxies.reveal the proxy username and the rotation link (it often carries the vendor's
  // API key) are blank on every row, editable ones included, as the profile list masks them.
  let editable = () => true;
  let inPool = () => true;
  if (member && member.role !== 'SUPER_ADMIN') {
    const visible = permissions.visibleMemberIds(await db.member.findMany(), member);
    editable = (p) => permissions.profileRowAccessible(visible, p, true);
    inPool = (proxy) => proxyInVisiblePool(visible, proxy);
  }
  const headers = EXPORT_COLUMNS.map((c) => c[0]);
  const rows = profiles.map((p) => {
    const own = editable(p);
    const showUser = revealCreds && (own || inPool(p.proxy));
    return EXPORT_COLUMNS.map((c) => {
      if (!revealCreds && (c[0] === 'Proxy Password' || c[0] === 'Account Password' || c[0] === 'Proxy Rotation URL')) return '';
      if ((!revealCreds || !own) && c[0] === 'Proxy Info') return p.proxy ? `${p.proxy.host}:${p.proxy.port}:${showUser ? (p.proxy.username || '') : ''}:` : '';
      if (!revealTwoFa && c[0] === '2FA Key') return '';
      if (!own && (c[0] === 'Account Password' || c[0] === '2FA Key' || c[0] === 'Proxy Password' || c[0] === 'Proxy Rotation URL')) return '';
      if (!showUser && c[0] === 'Proxy Username') return '';
      return c[1](p, rotationUrls);
    });
  });
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
// third-party cookie switch is a workspace setting (browser.blockThirdPartyCookies), so it follows the
// rule of the same switch in Settings: settings.manage and the Settings page under Visible features
// (assertCanWriteGlobalSettings), with the same refusal.
async function captchaFix(payload) {
  const input = requireObject(payload);
  const action = String(input.action || '');
  if (action === 'allow-3p-cookies') {
    const patch = { browser: { blockThirdPartyCookies: false } };
    await assertCanWriteGlobalSettings(await getActiveMember(), await getGlobalSettings(), patch);
    await setGlobalSettings(patch);
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
  const candidates = (await db.proxy.findMany({ where: await scopedProxyWhere({ lastStatus: 'ok', profiles: { none: {} } }) }))
    .filter((p) => !proxyScope.isFreeProxy(p)); // never a free proxy automatically
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
  // Same fail-closed scope as listProxies: a member sees only their subtree's proxies (paid only).
  const proxies = await db.proxy
    .findMany({ where: await scopedProxyWhere(proxyScope.proxyScopeWhere('paid')), select: { id: true, name: true, host: true, port: true, type: true } })
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
  // The paid pool only: free proxies are checked from their own page.
  const proxies = await db.proxy.findMany({ where: proxyScope.proxyScopeWhere('paid') });
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

// The automatic health check runs over the whole workspace pool: the same rule as the default
// rotation policy (requireWorkspaceProxySettings).
async function setProxyScheduler(payload) {
  await requirePermission('proxies.manage');
  await requireWorkspaceProxySettings('proxy check schedule');
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
  // path (no CDP there, so it uses the loopback bridge). `members`: the Owner lets the other members
  // use the Data Vault's identities through autofill too (off by default; see vaultAutofillAllowed).
  smartAutofill: { enabled: true, firefox: true, members: false },
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
  const member = await getActiveMember();
  const shared = await getGlobalSettings();
  // The member's own saved filters and warm-up lists in place of the Owner's (memberPageLists).
  let own = null;
  try { own = await readOwnPageLists(member); }
  catch (e) { own = pageListsOwnerKey(member) === null ? null : emptyPageLists(); }
  let all = own ? { ...shared, ...own } : shared;
  // And their own first-run flag in place of the Owner's (memberOnboarding).
  if (onboardingOwnerKey(member) !== null) all = { ...all, onboardingDone: await readOwnOnboardingDoneSafe(member) };
  return withoutWorkspaceSecrets((await activeIsSuperAdmin()) ? all : withoutSuperOnlyKeys(all), member);
}

// ---- Saved Profiles filters and warm-up lists: one set per member ----
// The Profiles page's saved filters (profileFilters) and the Automation page's warm-up plan and named
// link lists (warmer) are a member's own working lists. Until 1.0.26 they were one list in
// globalSettings that every member read and any member's save replaced. Now each member has their own:
//   - The Owner (single-user mode is the Owner) keeps them where every version kept them,
//     globalSettings.profileFilters and .warmer: nothing moves, and an older version still reads them.
//   - Every other member's are in the Setting "memberPageLists":
//     { version: 1, members: { "<member id>": { since, profileFilters, warmer } } }. `since` is the
//     member's createdAt, so a new member who gets a deleted member's id does not get their lists.
//   - Members who exist when the store is first created (the first start of 1.0.26) start with a copy
//     of the shared lists: it is what they saw and used until then, and part of it may be theirs, since
//     every save added to the one list. Members added later start empty. The shared lists are not
//     changed by this.
// The window keeps using settings:get-global and settings:set-global; main puts the member's own lists
// in place of the Owner's (getGlobalSettingsForActor, setGlobalSettingsForActor).
const MEMBER_PAGE_LIST_KEYS = Object.freeze(['profileFilters', 'warmer']);
const MEMBER_PAGE_LISTS_SETTING = 'memberPageLists';
// One read-modify-write of the store at a time.
const memberPageListsLock = { tail: Promise.resolve() };

function withMemberPageLists(fn) {
  const run = memberPageListsLock.tail.then(() => fn());
  memberPageListsLock.tail = run.then(() => {}, () => {});
  return run;
}

// Whose lists: null for the Owner (and single-user mode), kept in globalSettings; otherwise the
// member's id (the Super Admin included).
function pageListsOwnerKey(member) {
  if (!member || member.role === 'OWNER') return null;
  return String(member.id);
}

function emptyPageLists() {
  return { profileFilters: [], warmer: {} };
}

function memberSinceStamp(member) {
  const c = member && member.createdAt;
  if (!c) return null;
  const d = c instanceof Date ? c : new Date(c);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function copyJson(value, fallback) {
  if (value === undefined || value === null) return fallback;
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return fallback; }
}

// readSetting, but a failed read throws instead of looking like a missing row: for a writer that must
// never replace stored data it could not read. undefined when there is no row; null when unreadable.
async function readSettingStrict(key) {
  const row = await getPrisma().setting.findUnique({ where: { key } });
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch (e) { return null; }
}

// The store, created on its first read with a copy of the shared lists for every member who exists
// then (see above). Call inside withMemberPageLists.
async function loadMemberPageLists() {
  const stored = await readSettingStrict(MEMBER_PAGE_LISTS_SETTING);
  if (stored !== undefined) {
    return stored && typeof stored === 'object' && stored.members && typeof stored.members === 'object'
      ? stored
      : { version: 1, members: {} };
  }
  const shared = await getGlobalSettings();
  const store = { version: 1, createdAt: new Date().toISOString(), members: {} };
  for (const m of await getPrisma().member.findMany()) {
    if (m.role === 'OWNER') continue;
    store.members[String(m.id)] = {
      since: memberSinceStamp(m),
      profileFilters: copyJson(Array.isArray(shared.profileFilters) ? shared.profileFilters : [], []),
      warmer: copyJson(shared.warmer && typeof shared.warmer === 'object' ? shared.warmer : {}, {})
    };
  }
  await writeSetting(MEMBER_PAGE_LISTS_SETTING, store);
  return store;
}

// This member's entry, or empty lists (none yet, or one left by a deleted member with the same id).
function ownPageListsIn(store, member) {
  const e = store.members[pageListsOwnerKey(member)];
  const since = memberSinceStamp(member);
  if (!e || typeof e !== 'object' || (e.since && since && e.since !== since)) return emptyPageLists();
  return {
    profileFilters: Array.isArray(e.profileFilters) ? e.profileFilters : [],
    warmer: e.warmer && typeof e.warmer === 'object' && !Array.isArray(e.warmer) ? e.warmer : {}
  };
}

// The member's own lists, or null for the Owner (whose lists are globalSettings' own). Also creates the
// store on the first read, whoever reads first.
async function readOwnPageLists(member) {
  return withMemberPageLists(async () => {
    const store = await loadMemberPageLists();
    return pageListsOwnerKey(member) === null ? null : ownPageListsIn(store, member);
  });
}

// Saves a write's profileFilters and/or warmer as the member's own (not the Owner's; see
// setGlobalSettingsForActor), with the merge globalSettings uses: the filter list is replaced, the
// warm-up plan is merged key by key. Returns the member's lists after the write.
async function writeOwnPageLists(member, patch) {
  return withMemberPageLists(async () => {
    const store = await loadMemberPageLists();
    const cur = ownPageListsIn(store, member);
    const next = { since: memberSinceStamp(member), profileFilters: cur.profileFilters, warmer: cur.warmer };
    if (patch.profileFilters !== undefined) next.profileFilters = Array.isArray(patch.profileFilters) ? patch.profileFilters : [];
    if (patch.warmer !== undefined) {
      const merged = deepMergeSettings(cur.warmer, patch.warmer);
      next.warmer = merged && typeof merged === 'object' && !Array.isArray(merged) ? merged : {};
    }
    store.members[pageListsOwnerKey(member)] = next;
    await writeSetting(MEMBER_PAGE_LISTS_SETTING, store);
    return { profileFilters: next.profileFilters, warmer: next.warmer };
  });
}

// ---- The first-run wizard: one "done" flag per member ----
// Until 1.0.26 `onboardingDone` was one flag in globalSettings: whoever finished or skipped the wizard
// hid it for every member. Now:
//   - The Owner (and single-user mode) keeps globalSettings.onboardingDone, unchanged, so an older
//     version reads the same flag.
//   - Every other member (the Super Admin included) has their own in the Setting "memberOnboarding":
//     { version: 1, createdAt, members: { "<member id>": { since, done } } }. `since` is the member's
//     createdAt, as in memberPageLists, so an entry left by a deleted member is never reused.
//   - Members who exist when the store is first created (the first start of 1.0.26, before anyone signs
//     in) are marked done if they ever signed in (Member.lastActiveAt, set at every sign-in since June
//     2026): they have used the app and are not shown a first-run wizard now. Members who never signed
//     in are not, so they see it at their first sign-in, as do members added later. The Super Admin is
//     marked done. Nothing in globalSettings is changed by this.
// The window keeps using settings:get-global and settings:set-global; main puts the member's own flag
// in place of the Owner's (getGlobalSettingsForActor, setGlobalSettingsForActor).
const MEMBER_ONBOARDING_SETTING = 'memberOnboarding';
const memberOnboardingLock = { tail: Promise.resolve() };

function withMemberOnboarding(fn) {
  const run = memberOnboardingLock.tail.then(() => fn());
  memberOnboardingLock.tail = run.then(() => {}, () => {});
  return run;
}

// Whose flag: null for the Owner (and single-user mode), kept in globalSettings; otherwise the
// member's id (the Super Admin included).
function onboardingOwnerKey(member) {
  return pageListsOwnerKey(member);
}

// The store, created on its first read (see above). Call inside withMemberOnboarding. A database error
// is thrown, never taken for "no store yet", so a stored flag is never replaced.
async function loadMemberOnboarding() {
  const stored = await readSettingStrict(MEMBER_ONBOARDING_SETTING);
  if (stored !== undefined) {
    return stored && typeof stored === 'object' && stored.members && typeof stored.members === 'object'
      ? stored
      : { version: 1, members: {} };
  }
  const store = { version: 1, createdAt: new Date().toISOString(), members: {} };
  for (const m of await getPrisma().member.findMany()) {
    if (m.role === 'OWNER') continue;
    store.members[String(m.id)] = { since: memberSinceStamp(m), done: Boolean(m.lastActiveAt) };
  }
  store.members[String(permissions.SUPER_ADMIN_ID)] = { since: null, done: true };
  await writeSetting(MEMBER_ONBOARDING_SETTING, store);
  return store;
}

// Creates the store if it is not there yet. Called at startup and before a sign-in records
// lastActiveAt, so the members who exist at the update are judged by their sign-ins before it.
function ensureMemberOnboardingStore() {
  return withMemberOnboarding(loadMemberOnboarding);
}

function ownOnboardingDoneIn(store, member) {
  const e = store.members[onboardingOwnerKey(member)];
  const since = memberSinceStamp(member);
  if (!e || typeof e !== 'object' || (e.since && since && e.since !== since)) return false;
  return e.done === true;
}

// The member's own flag (not for the Owner, whose flag is globalSettings' own).
async function readOwnOnboardingDone(member) {
  return withMemberOnboarding(async () => ownOnboardingDoneIn(await loadMemberOnboarding(), member));
}

// A store that cannot be read shows nobody the wizard: a member who has used the app for months must
// not get it because of a database hiccup.
async function readOwnOnboardingDoneSafe(member) {
  try { return await readOwnOnboardingDone(member); } catch (e) { return true; }
}

async function writeOwnOnboardingDone(member, done) {
  return withMemberOnboarding(async () => {
    const store = await loadMemberOnboarding();
    store.members[onboardingOwnerKey(member)] = { since: memberSinceStamp(member), done: done === true };
    await writeSetting(MEMBER_ONBOARDING_SETTING, store);
    return done === true;
  });
}

// Who may change each top-level group of the workspace settings through the window. Every group holds
// one value for the whole workspace, and most of them change how everybody's profiles open (browser
// behaviour, website rules, start-up checks, the CAPTCHA key, launch caps, log retention, start-page
// links). So a group needs settings.manage (Admin and up; the Owner can turn it off for one Admin) and
// the Settings page under "Visible features", unless it is listed here:
//   - lists a member keeps on their own pages: saved Profiles filters and the first-run flag (anyone
//     signed in), and the Automation page's warm-up lists (automation.run); the filters and warm-up
//     lists are each member's own since 1.0.26 (memberPageLists);
//   - Smart Autofill decides who gets the Data Vault's identities, so it follows vault.manage (Owner);
//   - the footer branding is the Super Admin's (proxyProviderTrials is checked separately, read and write).
const GLOBAL_SETTING_WRITE_RULES = Object.freeze({
  profileFilters: Object.freeze({ anyMember: true }),
  onboardingDone: Object.freeze({ anyMember: true }),
  warmer: Object.freeze({ action: 'automation.run', what: 'the warm-up lists' }),
  smartAutofill: Object.freeze({ action: 'vault.manage', what: 'the Smart Autofill settings' }),
  branding: Object.freeze({ superOnly: true, what: 'the footer branding' })
});
const WORKSPACE_SETTING_RULE = Object.freeze({ action: 'settings.manage', feature: 'settings', what: 'the workspace settings' });
const SETTING_ROLE_PHRASE = Object.freeze({ 3: 'the Owner or an Admin', 4: 'the Owner' });

// The groups a write would actually change: a page that saves back a value it read is not refused.
function changedGlobalSettingKeys(current, input) {
  return Object.keys(input).filter((k) => JSON.stringify(deepMergeSettings(current[k], input[k])) !== JSON.stringify(current[k]));
}

async function assertCanWriteGlobalSettings(member, current, input) {
  if (!member || member.role === 'SUPER_ADMIN') return; // single-user mode is the Owner
  for (const key of changedGlobalSettingKeys(current, input)) {
    const rule = GLOBAL_SETTING_WRITE_RULES[key] || WORKSPACE_SETTING_RULE;
    if (rule.anyMember) continue;
    if (rule.superOnly) {
      const e = new Error(`Only the Super Admin can change ${rule.what}.`); e.code = 'FORBIDDEN'; throw e;
    }
    const need = permissions.ACTION_MIN_RANK[rule.action] || 0;
    if (member.status !== 'suspended' && member.status !== 'banned' && permissions.rankOf(member.role) < need) {
      const e = new Error(`Your role does not permit this action: only ${SETTING_ROLE_PHRASE[need] || 'the Owner'} can change ${rule.what}.`);
      e.code = 'FORBIDDEN';
      throw e;
    }
    await requirePermission(rule.action); // suspended or banned, or turned off for this member
    if (rule.feature && featureGate.featureHidden(member, rule.feature)) throw featureGate.featureOffError(rule.feature);
  }
}

// The CAPTCHA solver key is a paid account's credential, so only members who may change the workspace
// settings receive it (the others see the field empty and cannot save it).
function withoutWorkspaceSecrets(settings, member) {
  if (!member || member.role === 'SUPER_ADMIN') return settings;
  const mayChange = permissions.effectivePermissions(member).actions['settings.manage'] === true
    && member.status !== 'suspended' && member.status !== 'banned';
  if (mayChange || !settings || !settings.captcha || !settings.captcha.apiKey) return settings;
  return { ...settings, captcha: { ...settings.captcha, apiKey: '' } };
}

async function setGlobalSettingsForActor(payload) {
  let input = requireObject(payload);
  const isSuper = await activeIsSuperAdmin();
  if (!isSuper && SUPER_ONLY_GLOBAL_KEYS.some((k) => Object.prototype.hasOwnProperty.call(input, k))) {
    const err = new Error('Only the Super Admin can track provider trials.');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const member = await getActiveMember();
  const shared = await getGlobalSettings();
  // A member other than the Owner saves saved filters and warm-up lists as their own (memberPageLists),
  // and they are compared with their own, so saving back what was read is not refused. The Owner's are
  // globalSettings' own, so a store that cannot be read does not hold up the Owner's write.
  const own = pageListsOwnerKey(member) === null
    ? await readOwnPageLists(member).catch(() => null)
    : await readOwnPageLists(member);
  // Their first-run flag likewise (memberOnboarding): finishing the wizard hides it for them only. It is
  // anyone's to set (GLOBAL_SETTING_WRITE_RULES), so it is taken out before the rest is checked.
  const ownsFlag = onboardingOwnerKey(member) !== null;
  let flagWrite;
  if (ownsFlag && Object.prototype.hasOwnProperty.call(input, 'onboardingDone')) {
    const { onboardingDone, ...others } = input;
    flagWrite = onboardingDone === true;
    input = others; // the rest goes on as before
  }
  await assertCanWriteGlobalSettings(member, own ? { ...shared, ...own } : shared, input);
  const flag = !ownsFlag ? {}
    : { onboardingDone: flagWrite !== undefined ? await writeOwnOnboardingDone(member, flagWrite) : await readOwnOnboardingDoneSafe(member) };
  let next;
  if (own) {
    const mine = {};
    const rest = {};
    for (const [k, v] of Object.entries(input)) (MEMBER_PAGE_LIST_KEYS.includes(k) ? mine : rest)[k] = v;
    const lists = Object.keys(mine).length ? await writeOwnPageLists(member, mine) : own;
    next = { ...(Object.keys(rest).length ? await setGlobalSettings(rest) : shared), ...lists };
  } else {
    next = await setGlobalSettings(input);
  }
  next = { ...next, ...flag };
  return withoutWorkspaceSecrets(isSuper ? next : withoutSuperOnlyKeys(next), member);
}

// Saved proxy provider credentials, one workspace-wide Setting blob keyed by provider; secret
// fields are DPAPI-sealed via secretStore. apiUrl is secret: a Live Proxies link carries the access code.
const PROXY_CRED_SECRET_FIELDS = ['password', 'token', 'apiToken', 'apiUrl'];
// teamId (AnyIP) and proxyType (the Protocol or Proxy type select) are kept so they survive a restart.
const PROXY_CRED_PLAIN_FIELDS = ['username', 'zone', 'plan', 'host', 'port', 'orderId', 'teamId', 'proxyType'];
// The fields that make an entry a saved credential. Host, port, plan and the selects alone are not: an
// entry without any of these counts as nothing saved, so the provider does not show as Connected.
const PROXY_CRED_KEY_FIELDS = ['username', ...PROXY_CRED_SECRET_FIELDS];

function hasProxyProviderKey(entry) {
  return Boolean(entry && typeof entry === 'object' && PROXY_CRED_KEY_FIELDS.some((f) => entry[f] != null && String(entry[f]) !== ''));
}

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
  // An entry left empty by an older build (fields cleared, then saved) is nothing saved.
  if (!hasProxyProviderKey(stored)) return { found: false };
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
  // Clearing every key and login removes the entry, so the provider is no longer shown as Connected.
  const saved = hasProxyProviderKey(entry);
  if (saved) map[provider] = entry; else delete map[provider];
  await writeSetting('proxyProviderCreds', map);
  return { ok: true, saved };
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
// in, as authGate requires for renderer IPC (no members counts as the Owner), and only to a browser
// whose launcher may use the vault in autofill. `sessionId`: the session asking. The Chromium bridge
// passes the page's session; the Firefox bridge the session that owns the port the request came in on
// (each Firefox profile can reach only its own port, autofillBridge.js). Fails closed on DB error.
async function personaVaultAvailable({ sessionId = null } = {}) {
  const s = await ipcAuthState();
  if (s.vaultLocked) return false;
  if (!(Boolean(s.signedIn) || !(Number(s.memberCount) > 0))) return false;
  return sessionAutofillAllowed(sessionId);
}

// Data Vault autofill in one running session, Chromium or Firefox: the rule for the member who
// launched it (sessionLaunchers). A session with no recorded launcher gets nothing.
async function sessionAutofillAllowed(sessionId) {
  const rec = sessionId == null ? null : sessionLaunchers.get(String(sessionId));
  return rec ? vaultAutofillAllowed(rec.memberId) : false;
}

// Whose launched profiles may offer the Data Vault's identities (the "SG" autofill button, both
// browsers). The vault belongs to the Owner and its page is shown only with vault.manage, so autofill
// follows the same rule: a member who may manage the vault (the Owner by default; single-user mode and
// the Super Admin) always gets it, and the other members only when the Owner turned on "Team members
// can use the Data Vault in autofill" (smartAutofill.members, off by default). `memberId` is the member
// who launched the profile (null: single-user mode, the Owner); the bridges ask at fill time, so a
// change to the switch, the member's rights or status applies to profiles already open. Fails closed
// when the member cannot be read.
async function vaultAutofillAllowed(memberId) {
  if (memberId === undefined) return false; // no launcher known
  const id = memberId;
  if (id === null || permissions.isSuperAdminId(id)) return true;
  let m;
  try { m = await getPrisma().member.findUnique({ where: { id } }); } catch (e) { return false; }
  if (!m || m.status === 'suspended' || m.status === 'banned') return false;
  if (permissions.effectivePermissions(m).actions['vault.manage'] === true) return true;
  try {
    const g = await getGlobalSettings();
    return Boolean(g && g.smartAutofill && g.smartAutofill.members === true);
  } catch (e) { return false; }
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

// Real Chrome builds available on disk (for the profile editor's version picker), and the installed
// Google Chrome, which "Auto" launches when there is one (browserEngine.chooseBrowserBinary).
async function listBrowsers() {
  const browsers = listAvailableBrowsers();
  let realChrome = null;
  try { const r = findRealChrome(); if (r) realChrome = { major: r.major || null, version: r.version || '' }; } catch (e) { realChrome = null; }
  return {
    count: browsers.length,
    browsers: browsers.map((b) => ({ major: b.major, version: b.version })),
    realChrome
  };
}

// The editor's "Generate new": a device name and MAC for the OS that no profile in the workspace uses
// (payload.excludeId: the profile being edited, whose own values may come back).
async function generateProfileIdentity(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const excludeId = input.excludeId != null && input.excludeId !== '' ? parseId(input.excludeId, 'excludeId') : null;
  const taken = await takenDeviceIdentities(getPrisma(), excludeId);
  return profileOptions.uniqueDeviceIdentity(optionalString(input.os) || 'Windows', taken);
}

// What the profile editor offers for its options: each OS's standard fonts (the Fonts > Custom default)
// and the limits main enforces.
async function profileEditorOptions() {
  return {
    fonts: { ...profileOptions.DATA.fonts },
    fontListMax: 1000,
    mediaCountMax: profileOptions.MEDIA_COUNT_MAX
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
  const proxyWhere = await scopedProxyWhere(proxyScope.proxyScopeWhere('paid')); // free proxies are not counted

  const [totalProfiles, totalProxies, totalGroups] = await Promise.all([
    db.profile.count({ where: profileWhere }),
    db.proxy.count({ where: proxyWhere }),
    // The same groups the Groups page lists for this member.
    db.group.count({ where: await scopedGroupWhere(undefined) })
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
  e.limitKind = kind; // 'profile' | 'proxy': batch import stops only at the profile limit
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
  const id = actingMemberId();
  return (id != null && id >= 0) ? id : null;
}

async function getActiveMember() {
  // Inside an AI or Local API call the token's member acts, and the window's cached redaction
  // flag is left alone: the token's own flag is recorded for this call (proxyRevealAllowed). A token's
  // member that cannot be read fails closed instead of reading as single-user mode.
  const actor = aiActor.current();
  const viaToken = actor != null;
  const id = actingMemberId();
  if (id == null) { if (!viaToken) currentMemberCanRevealProxy = true; else actorCanRevealProxy.set(actor, true); return null; } // single-user == owner
  if (permissions.isSuperAdminId(id)) { if (!viaToken) currentMemberCanRevealProxy = true; else actorCanRevealProxy.set(actor, true); return { ...permissions.SUPER_ADMIN }; }
  try {
    const m = await getPrisma().member.findUnique({ where: { id } });
    if (viaToken) {
      if (!m) { actorCanRevealProxy.set(actor, false); const e = new Error('The member this token acts as no longer exists.'); e.code = 'FORBIDDEN'; throw e; }
      actorCanRevealProxy.set(actor, permissions.effectivePermissions(m).actions['proxies.reveal'] !== false);
      return m;
    }
    // Refresh the cached redaction capability (rank baseline + any per-member revoke).
    currentMemberCanRevealProxy = m ? (permissions.effectivePermissions(m).actions['proxies.reveal'] !== false) : true;
    return m;
  } catch (e) {
    if (viaToken) throw e;
    return null;
  }
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
  // Before lastActiveAt changes: the first-run flags of the members who exist at the update follow their
  // sign-ins before it (memberOnboarding).
  await ensureMemberOnboardingStore().catch(() => {});
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
  // Before lastActiveAt changes: the first-run flags of the members who exist at the update follow their
  // sign-ins before it (memberOnboarding).
  await ensureMemberOnboardingStore().catch(() => {});
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
  // Making a suspended member active again takes a seat, so it is refused when the plan is full.
  if (data.status === 'active' && target.status === 'suspended') await assertSeatAvailable(id);
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
    await db.group.updateMany({ where: { ownerMemberId: id }, data: { ownerMemberId: toId } }).catch(() => {});
    await db.template.updateMany({ where: { ownerMemberId: id }, data: { ownerMemberId: toId } }).catch(() => {});
  } else if (dataAction === 'delete') {
    // Owned profiles go to Trash (recoverable, local data kept); assigned-only ones are unassigned.
    // Profiles on a deleted proxy keep "Profile proxy" with no proxy, so they cannot launch on the
    // real IP or on the deleted proxy until one is assigned (detachProfilesFromProxies).
    await db.profile.updateMany({ where: { ownerMemberId: id, deletedAt: null }, data: { deletedAt: new Date(), assignedMemberId: null, ownerMemberId: null } }).catch(() => {});
    await db.profile.updateMany({ where: { assignedMemberId: id }, data: { assignedMemberId: null } }).catch(() => {});
    const goneProxies = await db.proxy.findMany({ where: { ownerMemberId: id }, select: { id: true } }).catch(() => []);
    await detachProfilesFromProxies(db, goneProxies.map((p) => p.id)).catch(() => {});
    await db.proxy.deleteMany({ where: { ownerMemberId: id } }).catch(() => {});
    await pruneEmptyAutoGroups(db).catch(() => {});
    await db.proxyGroup.deleteMany({ where: { ownerMemberId: id } }).catch(() => {});
  } else {
    await db.profile.updateMany({ where: { assignedMemberId: id }, data: { assignedMemberId: null } }).catch(() => {});
    await db.profile.updateMany({ where: { ownerMemberId: id }, data: { ownerMemberId: null } }).catch(() => {});
  }
  if (dataAction !== 'reassign') {
    // Profile groups and templates of a removed member become ownerless, which the Owner and Admins
    // manage (scopedGroupWhere, scopedTemplateWhere); otherwise nobody could rename or delete them.
    await db.group.updateMany({ where: { ownerMemberId: id }, data: { ownerMemberId: null } }).catch(() => {});
    await db.template.updateMany({ where: { ownerMemberId: id }, data: { ownerMemberId: null } }).catch(() => {});
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
  // Before lastActiveAt changes: the first-run flags of the members who exist at the update follow their
  // sign-ins before it (memberOnboarding).
  await ensureMemberOnboardingStore().catch(() => {});
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
  // Rotation links imported before 1.0.26 go on the proxy made for their row (once each; see there).
  adoptImportedRotationLinks().catch((e) => console.error('[SG][proxy] imported rotation links failed', e && e.message ? e.message : e));
  retryPendingProfileWipes().catch((e) => console.error('[SG][profile] pending wipe retry failed', e && e.message ? e.message : e));
  sessionRestore = restoreSession();
  await sessionRestore;
  try { await seedStarters(); } catch (e) { /* best-effort */ }
  // First-run browser fleet - fire-and-forget so the window opens immediately.
  maybeSeedBrowsers().catch(() => {});
  // Microsoft Store build: today counts as a day of use for the rating card (nothing elsewhere).
  getStoreRating().noteUse().catch(() => {});
  try { await ai.load(); } catch (e) { /* AI stays off */ }
  try { await localApi.startIfEnabled(); } catch (e) { /* off by default */ }
  // Licensing backend (when a tenant config is baked): refresh the signed lease on
  // startup + every 6h. Best-effort - offline keeps running on the cached lease.
  if (tenantConfig().enabled) {
    refreshBackendLease().catch(() => {});
    const t = setInterval(() => { refreshBackendLease().catch(() => {}); }, 6 * 60 * 60 * 1000);
    if (t.unref) t.unref();
    // Microsoft Store build: report Store subscriptions (a purchase not yet sent, renewals, ends).
    if (storeBridge.isStoreInstall()) {
      getStoreCommerce().backgroundSync().catch(() => {});
      const st = setInterval(() => { getStoreCommerce().backgroundSync().catch(() => {}); }, storeCommerceLib.SYNC_EVERY_MS);
      if (st.unref) st.unref();
    }
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
// Any member refuses, from any caller. The certified Super Admin is not a member row (virtual id -1)
// and has its own path (superAdminSetup / superLogin), so a workspace where only the Super Admin has
// signed in can still register its first Owner. An unreadable member count refuses (fails closed).
async function assertFirstRunSetup() {
  let memberCount = 0;
  try { memberCount = await getPrisma().member.count(); } catch (e) { memberCount = Infinity; }
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
  // Tenant builds: our licensing server emails the code (never shown here) and refuses disposable or
  // undeliverable addresses. Marketing consent is sent only when the box was ticked. The lead details
  // (phone, use case, company) go with it and reach the customer once the code is proven.
  if (tenantConfig().enabled) {
    const lead = signupLead.normalizeLead(input, { requireUseCase: true });
    if (lead.error) throw serverErrors.coded(lead.error);
    return tenantSignup.startVerification({
      ensureInstall: ensureBackendInstall,
      api: licenseClient.api,
      email,
      name: `${String(input.firstName || '').trim()} ${String(input.lastName || '').trim()}`.trim(),
      consentMarketing: input.consentMarketing === true,
      lang: input.lang,
      lead: lead.lead
    });
  }
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
  let serverCheck = null;
  if (tenantConfig().enabled) {
    // Tenant builds: the code was emailed by our licensing server, which checks it and links this
    // install to the verified customer.
    serverCheck = await tenantSignup.checkVerification({ ensureInstall: ensureBackendInstall, api: licenseClient.api, email, code });
  } else {
    const rec = await readSetting(key, null);
    if (!rec || !rec.hash) throw new Error('No verification code was requested.');
    if (rec.email !== email) throw new Error('Email does not match the requested code.');
    if (Date.now() > Number(rec.expiresAt || 0)) { await writeSetting(key, null); throw new Error('Verification code expired. Request a new one.'); }
    if (Number(rec.attempts || 0) >= 6) { await writeSetting(key, null); throw new Error('Too many attempts. Request a new code.'); }
    if (!verifySecret(code, rec.salt, rec.hash)) {
      await writeSetting(key, { ...rec, attempts: Number(rec.attempts || 0) + 1 });
      throw new Error('Incorrect code.');
    }
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
  if (serverCheck) {
    await writeSetting('tenantCustomer', { email, customerId: serverCheck.customerId, verifiedAt: new Date().toISOString() }).catch(() => {});
    // The server now has a verified customer for this install: no "Confirm your email" step later.
    await recordSignupVerified().catch(() => {});
  }

  // 6) Everything succeeded - now it is safe to consume the OTP.
  await writeSetting(key, null);

  return { ok: true, member: serializeMember(owner, { isCurrent: true }) };
}

// ---- Confirm your email (tenant builds, 1.0.23) ----
// Workspaces made before server sign-up (or whose server sign-up never finished) confirm the Owner's
// email with our licensing server once, so every install is a lead in the website admin. The server's
// answer is the truth (signupConfirm.js); this run's decision is kept in memory, so the step is asked
// again at the next start until it is done. Base builds never get here.
let signupDecision = null; // { state, required, offline, deferredUntil, at }
let signupFailedAt = 0; // our side failed to send or check a code in this run (offline, server, email)
const SIGNUP_RECHECK_MS = 60000; // a "needed" answer is asked again after a minute
const SIGNUP_FAILURE_MS = 15 * 60000;

async function readSignupCache() {
  const sealed = await readSetting(signupConfirm.CACHE_SETTING, null);
  if (!sealed) return null;
  try { return JSON.parse(secretStore.open(sealed)); } catch (_) { return null; }
}

async function writeSignupCache(record) {
  await writeSetting(signupConfirm.CACHE_SETTING, secretStore.seal(JSON.stringify(record))).catch(() => {});
}

// This install's id at the licensing server, or a stable stand-in before it ever registered.
async function signupInstallKey(install) {
  if (install && install.installId) return String(install.installId);
  return String((await readSetting('backendInstallId', null)) || 'unregistered');
}

// A verified paid lease on this computer: such a customer is never locked out by our server.
async function hasPaidLease() {
  const ent = await getBackendEntitlement();
  return Boolean(ent && ent.type !== 'trial' && ((licenseClient.licenseIssue() || {}).reason !== 'machine_mismatch'));
}

// -> the decision for this run: { state, required, offline, deferredUntil }.
async function signupDecide({ fresh = false } = {}) {
  if (!tenantConfig().enabled) return { state: 'off', required: false, offline: false, deferredUntil: null };
  const d = signupDecision;
  if (!fresh && d && (d.state === 'verified' || d.state === 'deferred' || Date.now() - d.at < SIGNUP_RECHECK_MS)) return d;
  let install = null;
  let server = null;
  try {
    install = await ensureBackendInstall();
    if (install) server = await tenantSignup.accountStatus({ ensureInstall: async () => install, api: licenseClient.api });
  } catch (_) { server = null; } // offline, timeout, server error or an older server: could not ask
  const { effectiveNow } = await clampLicenseNow();
  const next = signupConfirm.decide({
    server, cache: await readSignupCache(), installKey: await signupInstallKey(install), paid: await hasPaidLease(), nowMs: effectiveNow
  });
  await writeSignupCache(next.cache);
  signupDecision = { state: next.state, required: next.required, offline: next.offline, deferredUntil: next.deferredUntil || null, at: Date.now() };
  return signupDecision;
}

// Called once the server has verified this install's customer (sign-up or the confirm step).
async function recordSignupVerified() {
  const install = await ensureBackendInstall().catch(() => null);
  const { effectiveNow } = await clampLicenseNow();
  const next = signupConfirm.decide({ server: { verified: true }, cache: null, installKey: await signupInstallKey(install), nowMs: effectiveNow });
  await writeSignupCache(next.cache);
  signupDecision = { state: next.state, required: false, offline: false, deferredUntil: null, at: Date.now() };
  signupFailedAt = 0;
}

// May the person go on for now after our side failed? Only right after such a failure in this run.
async function signupDeferral() {
  if (!signupFailedAt || Date.now() - signupFailedAt > SIGNUP_FAILURE_MS) return null;
  const install = await ensureBackendInstall().catch(() => null);
  const { effectiveNow } = await clampLicenseNow();
  return signupConfirm.deferAfterFailure({ cache: await readSignupCache(), installKey: await signupInstallKey(install), paid: await hasPaidLease(), nowMs: effectiveNow });
}

// Who may confirm: whoever may purchase (requirePurchaser: the Owner, the Super Admin, single-user mode).
async function mayConfirmSignup() {
  try { await requirePurchaser('confirm the workspace email'); return true; } catch (_) { return false; }
}

// What the Gate shows after sign-in. A tenant build that cannot decide lets the person in; main still
// checks before a profile launches (assertNotBanned).
async function accountSignupStatus() {
  if (!tenantConfig().enabled) return { enabled: false, state: 'off', required: false };
  const d = await signupDecide();
  const canConfirm = await mayConfirmSignup();
  const out = { enabled: true, state: d.state, required: Boolean(d.required), offline: Boolean(d.offline), deferredUntil: d.deferredUntil || null, canConfirm, canDefer: false, prefill: null };
  if (d.required && canConfirm) {
    const deferral = await signupDeferral();
    out.canDefer = Boolean(deferral && deferral.allowed);
    const acct = (await readSetting('account', null)) || {};
    const owner = await getPrisma().member.findFirst({ where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' } }).catch(() => null);
    const parts = String((owner && owner.name) || '').trim().split(' ').filter(Boolean);
    out.prefill = {
      firstName: String(acct.firstName || parts[0] || '').slice(0, 80),
      lastName: String(acct.lastName || parts.slice(1).join(' ') || '').slice(0, 80),
      email: String(acct.email || (owner && owner.email) || '').slice(0, 254),
      phone: String(acct.phone || '').slice(0, 40)
    };
  }
  return out;
}

function requireTenantSignup() {
  if (!tenantConfig().enabled) throw new Error('Email confirmation is only used in builds with a licensing server.');
}

// Step 1: check the details and ask our server to email the code.
async function accountConfirmStart(payload) {
  requireTenantSignup();
  await requirePurchaser('confirm the workspace email');
  const input = requireObject(payload);
  const email = requiredString(input.email, 'Email').toLowerCase();
  if (!tenantSignup.EMAIL_RE.test(email)) throw serverErrors.coded('SIGNUP_INVALID_EMAIL');
  const firstName = requiredString(input.firstName, 'First name').slice(0, 80);
  const lastName = requiredString(input.lastName, 'Last name').slice(0, 80);
  const lead = signupLead.normalizeLead(input, { requireUseCase: true });
  if (lead.error) throw serverErrors.coded(lead.error);
  try {
    const r = await tenantSignup.startVerification({
      ensureInstall: ensureBackendInstall, api: licenseClient.api, email, name: `${firstName} ${lastName}`,
      consentMarketing: input.consentMarketing === true, lang: input.lang, lead: lead.lead, context: 'confirm'
    });
    signupFailedAt = 0;
    return r;
  } catch (e) {
    if (signupConfirm.isOurSide(e)) signupFailedAt = Date.now();
    throw e;
  }
}

// Step 2: check the code with our server, then keep the workspace's own account in step with the
// confirmed details, so the free trial and licences use the same email.
async function accountConfirmCheck(payload) {
  requireTenantSignup();
  await requirePurchaser('confirm the workspace email');
  const input = requireObject(payload);
  const email = requiredString(input.email, 'Email').toLowerCase();
  let res;
  try {
    res = await tenantSignup.checkVerification({ ensureInstall: ensureBackendInstall, api: licenseClient.api, email, code: input.code, context: 'confirmCheck' });
  } catch (e) {
    if (signupConfirm.isOurSide(e)) signupFailedAt = Date.now();
    throw e;
  }
  await recordSignupVerified();
  await writeSetting('tenantCustomer', { email, customerId: res.customerId, verifiedAt: new Date().toISOString() }).catch(() => {});
  const me = await getActiveMember();
  if (!me || me.role === 'OWNER') await syncOwnerAccount(me, input, email).catch(() => {});
  await logAudit('account.confirm-email', { detail: { customerId: res.customerId || null } }).catch(() => {});
  return { verified: true };
}

// The Owner's local account and member row take the confirmed name, email and phone. The member's email
// is changed only when no other member uses it.
async function syncOwnerAccount(me, input, email) {
  const firstName = optionalString(input.firstName);
  const lastName = optionalString(input.lastName);
  const lead = signupLead.normalizeLead(input, { requireUseCase: false });
  const acct = (await readSetting('account', null)) || {};
  const next = { ...acct, email, verified: true };
  if (firstName) next.firstName = firstName.slice(0, 80);
  if (lastName) next.lastName = lastName.slice(0, 80);
  if (lead.lead && lead.lead.phone) next.phone = lead.lead.phone;
  await writeSetting('account', next);
  const db = getPrisma();
  const owner = me && me.role === 'OWNER' ? me : await db.member.findFirst({ where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' } });
  if (!owner || owner.id == null || owner.id < 0) return;
  const data = {};
  const name = `${next.firstName || ''} ${next.lastName || ''}`.trim();
  if (name && name !== owner.name) { data.name = name; data.initials = initialsFrom(name); }
  if (email !== String(owner.email || '').toLowerCase()) {
    const clash = await db.member.findFirst({ where: { email, id: { not: owner.id } } });
    if (!clash) data.email = email;
  }
  if (Object.keys(data).length) await db.member.update({ where: { id: owner.id }, data });
}

// "Continue for now" after our side failed: allowed within the offline window (always with a paid
// licence). The step is asked again at the next start.
async function accountConfirmLater() {
  requireTenantSignup();
  await requirePurchaser('confirm the workspace email');
  const d = await signupDeferral();
  if (!d || !d.allowed) {
    const e = new Error('Confirm your email to continue. Check your internet connection and try again.');
    e.code = 'SIGNUP_REQUIRED';
    throw e;
  }
  await writeSignupCache(d.cache);
  signupDecision = { state: 'deferred', required: false, offline: false, deferredUntil: d.deferredUntil || null, at: Date.now() };
  await logAudit('account.confirm-later', { detail: { until: d.deferredUntil || null } }).catch(() => {});
  return { deferred: true, deferredUntil: d.deferredUntil || null };
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

// Seat accounting: the seat count comes from the plan limits (tierPolicy.js) of the effective
// licence, the same view license:get returns (the local licence, or a verified backend lease).
// The certified Super Admin (source owner) is exempt and uncounted, as before; single-user mode is
// unrestricted.
async function getSeatUsage() {
  const m = await getActiveMember();
  if (await isCertifiedSuperAdmin(m)) {
    return { used: 0, total: -1, type: 'source-owner', tier: 'enterprise', remaining: -1, full: false, exempt: true };
  }
  const db = getPrisma();
  const ownerId = await resolveLicenseOwnerId();
  const lic = await getLicense();
  const members = await db.member.findMany({ select: { id: true, status: true, parentMemberId: true } });
  return teamPolicy.seatUsage(members, ownerId, lic);
}

// Refuses a new seat past the plan's limit. Called from createMember (never on the first-Owner
// bootstrap) and, with reactivateId, when a suspended member is made active again. A team that is
// over the limit (after a downgrade) keeps every member; only new seats are refused until it is
// back under the limit. Super Admin and single-user mode are unrestricted.
async function assertSeatAvailable(reactivateId) {
  const m = await getActiveMember();
  if (!m || await isCertifiedSuperAdmin(m)) return; // the seat exemption needs the owner certificate
  const db = getPrisma();
  const ownerId = await resolveLicenseOwnerId();
  const lic = await getLicense();
  const members = await db.member.findMany({ select: { id: true, status: true, parentMemberId: true } });
  const { ok, usage } = teamPolicy.canTakeSeat(members, ownerId, lic, { reactivateId });
  if (!ok) {
    const e = new Error(seatLimitMessage(usage));
    e.code = 'SEAT_LIMIT';
    throw e;
  }
}

function seatLimitMessage(usage) {
  const head = `Your plan includes up to ${usage.total} team members (the owner counts as one), and ${usage.used} are in use.`;
  if (usage.tier === 'enterprise' && usage.type === 'paid') return `${head} Suspend a member to free a seat.`;
  const most = tierPolicy.TIER_LIMITS.enterprise.seats;
  return `${head} Enterprise includes up to ${most} team members: upgrade on the Billing page, or suspend a member to free a seat.`;
}

// CSV/JSON export of the activity feed, filterable by member/action/date range. Enterprise only
// (tierPolicy.js); viewing the activity log is open to every plan.
async function exportTeamActivity(payload) {
  await requirePermission('members.manage');
  if (!tierPolicy.limitsForLicense(await getLicense()).auditExport) {
    const e = new Error('Audit-log export (CSV / JSON) is an Enterprise feature. Upgrade on the Billing page to export the activity log.');
    e.code = 'ENTERPRISE_REQUIRED';
    throw e;
  }
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
  'cpuType', 'cpuCores', 'ramType', 'ramGb', 'twoFactorSeed', 'notes',
  // Applied at launch since 1.0.26 (a missing one, from an older install, keeps the local value).
  'userAgentMode', 'fontsList', 'mediaDeviceCounts', 'locationPrompt', 'hardwareAcceleration'
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
// Enterprise list price in USD per month (Pro is PLAN.amount).
const ENTERPRISE_AMOUNT = '29';

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
    // Limits shown here are enforced in main from tierPolicy.js.
    features: Object.freeze([
      'Unlimited local browser profiles',
      'Full fingerprint engine + leak checks',
      'Proxy pool, rotation policy & geo auto-match',
      'Macro recorder, scheduler & data-driven runs',
      'Cookie warmer',
      'Mobile / Android device profiles',
      'Encrypted workspace backup & restore',
      'Full at-rest database encryption',
      'Command palette + onboarding',
      'Up to 3 team members',
      'Parallel runner, up to 3 profiles at once, with live run console'
    ])
  }),
  Object.freeze({
    id: 'enterprise',
    tier: 'enterprise',
    name: 'Enterprise',
    amount: ENTERPRISE_AMOUNT,
    currency: PLAN.currency,
    months: 1,
    period: 'month',
    tagline: 'For teams - up to 25 members, 10 profiles at once and audit-log export.',
    highlight: true,
    features: Object.freeze([
      'Everything in Pro, plus:',
      'Up to 25 team members',
      'Parallel runner, up to 10 profiles at once, with live run console',
      'Audit-log export (CSV / JSON)',
      'Priority email support'
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

// Tenant builds read plans and prices from the licensing server (planCatalog.js: cached for an hour,
// the built-in DEFAULT_BILLING_PLANS when it cannot be reached). Base builds keep the local catalog.
const serverPlanCatalog = planCatalog.createPlanCatalog({ fetchPlans: () => licenseClient.api.plans() });
async function effectiveBillingPlans() {
  if (!tenantConfig().enabled) return readBillingPlans();
  const fallback = DEFAULT_BILLING_PLANS.map((p, i) => normalizePlan(p, i));
  return (await serverPlanCatalog.get({ fallback })).plans;
}

// Tenant checkout: a paid plan from the server's list (its key, exact spelling); no id = the first one.
async function findTenantPlanOrThrow(planId) {
  const requested = String(planId == null ? '' : planId).trim().toLowerCase();
  const paid = (await effectiveBillingPlans()).filter((p) => p.active && p.kind !== 'trial');
  const plan = requested ? paid.find((p) => String(p.id).toLowerCase() === requested) : paid[0];
  if (!plan) throw new Error('That plan is no longer available - refresh and choose a current plan.');
  return plan;
}

// Plans plus the viewer's tier and state, so the Billing page can mark the active plan and pick
// its CTA. `canManage` reveals the plan editor, subscribers and assign controls.
async function getBillingPlans() {
  const lic = await getLicense();
  const me = await getActiveMember();
  const all = await effectiveBillingPlans();
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
  // A grant applies the months directly below; this is only the invoice reference.
  const code = optionalString(input.code) || payments.newReceiptRef();
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
  // Tenant builds: record the trials that predate server trials before any new licence row exists.
  if (tenantConfig().enabled) await tenantTrialCutover();
  let lic = await db.license.findFirst({ where: { ownerMemberId: ownerId ?? null }, orderBy: { createdAt: 'desc' } });
  if (!lic) {
    // New workspaces start on the full-access free trial so every feature can be
    // tested out of the box. Tier 'enterprise' for the trial term. In tenant builds the trial comes
    // from the licensing server instead (startTrial), so the row starts with no trial.
    lic = await db.license.create({
      data: { ownerMemberId: ownerId ?? null, type: 'trial', tier: 'enterprise', status: 'active', trialEndsAt: tenantConfig().enabled ? null : new Date(Date.now() + TRIAL_DAYS * 86400000) }
    });
  }
  return lic;
}

// Tenant builds: Setting[tenantTrial.CUTOVER_SETTING], written once, lists the local trials that were
// already running or used when trials moved to the server; only those are honoured from the local row.
async function tenantTrialCutover() {
  // Read directly (readSetting hides errors as "missing", which would re-record later trials as old).
  const row = await getPrisma().setting.findUnique({ where: { key: tenantTrial.CUTOVER_SETTING } });
  if (row) {
    let saved = null;
    try { saved = JSON.parse(row.value); } catch (_) { saved = null; }
    // An unreadable record honours no local trial (fails closed).
    return saved && typeof saved === 'object' && saved.legacy && typeof saved.legacy === 'object' ? saved : { v: 1, at: null, legacy: {} };
  }
  const rows = await getPrisma().license.findMany({ where: { type: 'trial' }, select: { id: true, type: true, trialEndsAt: true } });
  const cut = tenantTrial.buildCutover(rows, new Date().toISOString());
  await writeSetting(tenantTrial.CUTOVER_SETTING, cut);
  return cut;
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
  // Tenant builds: a local trial row grants nothing by itself (only the signed trial lease, read in
  // getLicense, does), except a trial that was already running before trials moved to the server.
  if (tenantConfig().enabled) {
    const d = tenantTrial.localDecision(lic, await tenantTrialCutover(), effectiveNow);
    if (d.kind === 'none') {
      const ownerStatus = await syncOwnerBanState(lic.ownerMemberId ?? null, false);
      return tenantTrial.noPlanView({ trialUsed: d.trialUsed, adminBlocked: ownerStatus === 'banned', clockTamper: tampered, plan: PLAN });
    }
    lic = d.lic;
  }
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
      // No active licence server-side. A still-valid trial lease is kept: it ends on its own, and this
      // endpoint may list only paid licences.
      const cur = await getBackendEntitlement();
      if (!(cur && cur.type === 'trial')) await writeSetting('backendLease', null).catch(() => {});
      return null;
    }
    const { effectiveNow } = await clampLicenseNow();
    const ent = licenseClient.verifyLease(res.lease, { nowMs: effectiveNow });
    if (!ent) return null;
    // A trial lease stays a trial (the signed claim, or the server marking it; a mark can only downgrade).
    const type = ent.type === 'trial' || res.type === 'trial' ? 'trial' : 'paid';
    await writeSetting('backendLease', secretStore.seal(JSON.stringify({
      token: res.lease, currentPeriodEnd: res.currentPeriodEnd || null, tier: ent.tier, type, fetchedAt: Date.now()
    })));
    return { tier: ent.tier, type, exp: ent.exp, currentPeriodEnd: res.currentPeriodEnd || null, plan: ent.plan || null };
  } catch (e) { return null; } // offline / backend down → keep using the cached lease
}

// Offline entitlement: re-verify the cached lease token (catches tamper + the
// 7-day lease expiry). Returns { tier, type, exp, currentPeriodEnd, plan } or null.
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
  const type = ent.type === 'trial' || cached.type === 'trial' ? 'trial' : 'paid';
  return { tier: ent.tier, type, exp: ent.exp, currentPeriodEnd: cached.currentPeriodEnd || null, plan: ent.plan || null };
}

// Render a "paid" license view from a verified backend entitlement. endsAt is the
// subscription period end (not the short lease exp). A trial lease renders as the free trial.
function licenseViewFromLease(ent) {
  if (ent && ent.type === 'trial') return tenantTrial.trialViewFromLease(ent, Date.now(), PLAN);
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
    // plan: the licence's plan key from the signed lease (e.g. 'pro-yearly'), null when it has none.
    lease: ent ? { tier: ent.tier, type: ent.type, exp: ent.exp, currentPeriodEnd: ent.currentPeriodEnd, plan: ent.plan || null } : null
  };
}

// The licence view plus the plan limits it unlocks (tierPolicy.js), so the renderer shows the same
// caps main enforces.
function withPlanLimits(view) {
  const l = tierPolicy.limitsForLicense(view);
  return { ...view, limits: { tier: l.tier, seats: l.seats, maxParallel: l.maxParallel, auditExport: l.auditExport } };
}

async function getLicense() {
  // The certified Super Admin (valid owner certificate, base build) is exempt from the trial and
  // subscription system and gets Enterprise limits; otherwise a SUPER_ADMIN is licensed like any Owner.
  const m = await getActiveMember();
  if (await isCertifiedSuperAdmin(m)) {
    return withPlanLimits({
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
    });
  }
  // Backend-licensed builds: a verified, unexpired lease means paid; otherwise use the local model.
  // `reason` explains a licensing problem (e.g. the lease is bound to another computer); a machine
  // mismatch never reports paid.
  const issueOf = () => ((licenseClient.licenseIssue && licenseClient.licenseIssue()) || {}).reason || null;
  if (tenantConfig().enabled) {
    const ent = await getBackendEntitlement();
    if (ent && issueOf() !== 'machine_mismatch') {
      // A valid lease lifts a licence-lapse ban left by the local trial (an admin block stays).
      await syncOwnerBanState(await resolveLicenseOwnerId(), false);
      return withPlanLimits({ ...licenseViewFromLease(ent), reason: issueOf() });
    }
  }
  const ownerId = await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  return withPlanLimits(withLicenseReason(await licenseView(lic), issueOf()));
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
  // Tenant builds: the workspace email must be confirmed with our server first (signupConfirm.js). Only a
  // "needed" or "overdue" answer refuses; a server that cannot be asked lets the launch through.
  if (tenantConfig().enabled) {
    const d = await signupDecide();
    if (d.required) {
      const e = new Error('Confirm the workspace email first. The owner can do it on the sign-in screen.');
      e.code = 'SIGNUP_REQUIRED';
      throw e;
    }
  }
  // Tenant builds: a verified lease on this machine (paid or trial) is the licence.
  if (tenantConfig().enabled && await getBackendEntitlement() && ((licenseClient.licenseIssue() || {}).reason !== 'machine_mismatch')) return;
  const ownerId = await resolveLicenseOwnerId();
  const lic = await ensureLicense(ownerId);
  const view = await licenseView(lic);
  if (view.isBanned) {
    const e = new Error(view.needsPlan
      ? 'Start the free trial or choose a plan to launch profiles.'
      : 'Your subscription has ended - renew it to launch profiles.');
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
    // A trial lease still in force is not the redeemed licence.
    if (!ent || ent.type === 'trial') throw new Error('Code accepted, but no active license yet - try again in a moment.');
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
  // A suspended member holds no seat; any other status does, so leaving 'suspended' needs a free seat.
  if (target.status === 'suspended' && status !== 'suspended') await assertSeatAvailable(id);
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
  // Tenant builds: the licensing server's trial ledger decides (one trial per computer and email).
  if (!isSuper && tenantConfig().enabled) return startTenantTrial(ownerId, input);
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

// Tenant builds: starts the trial on the licensing server and stores its signed lease the way
// refreshBackendLease does, so the plan shows Trial (Enterprise limits, 3 seats) to the server's end
// date. The local row records that end (the trial counts as used; grace and lock follow it) but never
// grants the trial by itself. input.code confirms the owner's email first when the server asks for it.
async function startTenantTrial(ownerId, input) {
  const view = await getLicense();
  if (view.isPaid) throw new Error('You are on a paid plan - the free trial does not apply.');
  if (view.isTrial) return view; // already running: never extended by a click
  const lic = await ensureLicense(ownerId);
  const { effectiveNow } = await clampLicenseNow();
  // A trial from before server trials (or a paid term) used this computer's trial. Anything else the
  // server decides every time, so a trial an owner resets in the admin can start again.
  const local = tenantTrial.localDecision(lic, await tenantTrialCutover(), effectiveNow);
  if (local.legacy || lic.type === 'paid' || lic.purchaseCode) throw tenantTrialUsedError();
  const owner = ownerId != null ? await getPrisma().member.findUnique({ where: { id: ownerId } }).catch(() => null) : null;
  const account = (await readSetting('account', null)) || {};
  const r = await tenantTrial.startServerTrial({
    ensureInstall: ensureBackendInstall,
    api: licenseClient.api,
    verifyLease: licenseClient.verifyLease,
    nowMs: effectiveNow,
    email: (owner && owner.email) || account.email || '',
    code: optionalString(input && input.code)
  });
  await writeSetting('backendLease', secretStore.seal(JSON.stringify({
    token: r.token, currentPeriodEnd: r.endsAt, tier: r.tier, type: 'trial', fetchedAt: Date.now()
  })));
  await getPrisma().license.update({
    where: { id: lic.id },
    data: { type: 'trial', status: 'active', tier: r.tier, purchaseCode: null, trialEndsAt: new Date(r.endsAt) }
  });
  await syncOwnerBanState(ownerId, false);
  await logAudit('license.trial-start', { detail: { ownerId, endsAt: r.endsAt, server: true } });
  return getLicense();
}

// This computer's trial already ran (a local trial from before server trials) or a plan was bought.
function tenantTrialUsedError() {
  const err = new Error('A free trial has already been used on this computer or email. Choose a plan or enter a purchase code.');
  err.code = 'TRIAL_USED';
  return err;
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

// Tenant builds: the checkout methods the licensing server has switched on (checkoutMethods.js), or the
// providers baked into the build when it cannot be reached.
const serverCheckoutCatalog = checkoutMethods.createCheckoutCatalog({ fetchMethods: () => licenseClient.api.checkoutMethods() });
async function tenantCheckoutMethods() {
  const fallback = checkoutMethods.fallbackMethods(tenantConfig().checkoutProviders, (id) => {
    const def = payments.getProviderDef(id);
    return def ? def.label : id;
  });
  return serverCheckoutCatalog.get({ fallback });
}

// Enabled checkout methods (no secrets). Automated ones appear only once fully configured; manual
// ones carry their public instructions or pay link.
async function listPaymentMethods() {
  // A tenant build sells through the licensing server, which holds the provider keys. A customer's
  // fresh install has no local gateway config, so offer the providers the server has switched on for
  // this tenant (labels from the server, so a provider added there needs no app update), falling back
  // to the providers baked for this tenant when the server cannot be reached.
  if (tenantConfig().enabled) {
    const offered = await tenantCheckoutMethods();
    const methods = offered.providers.map((p) => ({ id: p.id, label: p.label, kind: 'automated' }));
    // The Microsoft Store version sells through Microsoft's checkout, only when the server has Store
    // sales on AND the Store has the add-ons' prices; otherwise the method is simply not listed.
    if (offered.storeSalesEnabled && storeBridge.available()) {
      const st = await getStoreCommerce().status().catch(() => null);
      if (checkoutMethods.storeHasPrices(st)) methods.unshift({ id: STORE_METHOD_ID, label: 'Microsoft Store', kind: 'store' });
    }
    return { methods };
  }
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
    const plan = await findTenantPlanOrThrow(input.planId);
    // Default to this tenant's first provider (the trial-ended screen sends none); never let the
    // server fall back to a provider the tenant hasn't switched on.
    const offered = (await tenantCheckoutMethods()).providers.map((p) => p.id);
    const provider = String(input.provider || offered[0] || '').trim().toLowerCase();
    if (!provider || !offered.includes(provider)) throw new Error('That payment method is not available for this app.');
    const install = await ensureBackendInstall();
    if (!install) throw new Error('Could not register this install with the licensing server.');
    const r = await licenseClient.api.checkout({ planKey: plan.id, installId: install.installId, provider });
    return { url: r.url, ref: r.ref, provider: r.provider || provider, planId: plan.id, planName: plan.name, backend: true };
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
    // A running trial lease is not a payment.
    if (ent && ent.type !== 'trial') return { status: 'paid', paid: true, license: licenseViewFromLease(ent) };
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
  const code = payments.newReceiptRef();
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
    if (owner && owner.email) await deliverPaymentReceipt(owner.email, owner.name, code, months);
  } catch (e) { /* email is best-effort */ }
  return { status: st.status, paid: true, license: await licenseView(updated), purchaseCode: code };
}

// ---- Microsoft Store purchases (Store build only) ----
// The Store package buys Pro / Enterprise as Microsoft Store subscription add-ons; the licensing server
// checks the purchase and issues the usual signed lease (src/main/storeCommerce.js). Website and base
// builds never reach this: storeBridge only loads the addon when process.windowsStore is true.
const STORE_METHOD_ID = 'microsoft_store';
let storeCommerceInstance = null;
function getStoreCommerce() {
  if (!storeCommerceInstance) {
    storeCommerceInstance = storeCommerceLib.createStoreCommerce({
      bridge: storeBridge,
      server: storeCommerceLib.createServerClient(licenseClient, tenantConfig),
      ensureInstall: () => ensureBackendInstall(),
      refreshLease: () => refreshBackendLease(),
      readSetting,
      writeSetting
    });
  }
  return storeCommerceInstance;
}

// The licensing server's Store sales switch (settings.store.salesEnabled, default off; off when it cannot
// be reached). With it off the Store card and prices are hidden, unless this install already has (or
// had) a Store subscription, which can still be restored and managed.
async function storeSalesOpen() {
  const offered = await tenantCheckoutMethods().catch(() => null);
  return Boolean(offered && offered.storeSalesEnabled);
}

async function storeSubscriptionSeen() {
  const pending = await readSetting(storeCommerceLib.PENDING_SETTING, null).catch(() => null);
  const last = await readSetting(storeCommerceLib.SYNC_SETTING, null).catch(() => null);
  return Boolean(pending || (last && last.hadEntitlement));
}

async function storeStatus() {
  if (!tenantConfig().enabled || !storeBridge.isStoreInstall()) return { available: false, reason: 'not_store_build' };
  const salesEnabled = await storeSalesOpen();
  if (!salesEnabled && !(await storeSubscriptionSeen())) return { available: false, reason: 'sales_off', salesEnabled: false };
  return { ...(await getStoreCommerce().status()), salesEnabled };
}

// The app window that asked, as the owner of Microsoft's purchase dialog.
function storeWindowHandle(event) {
  let win = null;
  try { win = event && event.sender ? BrowserWindow.fromWebContents(event.sender) : null; } catch (_) { win = null; }
  return storeBridge.windowHandle(win || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]);
}

async function storeResultWithLicense(r, extra = {}) {
  const out = { ...r, ...extra };
  if (r.status === 'active') {
    await logAudit('billing.store_purchase', { detail: { tier: r.tier || null, verified: Boolean(r.verified), plan: extra.planId || null } });
    out.license = await getLicense();
  }
  return out;
}

async function storePurchase(payload, event) {
  await requirePurchaser('purchase a subscription');
  if (!tenantConfig().enabled || !storeBridge.isStoreInstall()) throw new Error('Microsoft Store purchases are only in the Microsoft Store version of the app.');
  // New Store purchases only while the server has Store sales on (restore keeps working).
  if (!(await storeSalesOpen())) return { status: 'unavailable', code: 'store_sales_off' };
  const input = requireObject(payload || {});
  const plan = await findTenantPlanOrThrow(input.planId);
  // The card's tier and billing period pick the add-on: a yearly plan buys the yearly add-on, never the monthly.
  const period = String(plan.interval || plan.period || '').toLowerCase().startsWith('year') || plan.months === 12 ? 'year' : 'month';
  const r = await getStoreCommerce().purchase(plan.id, storeWindowHandle(event), { tier: plan.tier, period });
  return storeResultWithLicense(r, { planId: plan.id, planName: plan.name });
}

// Restore purchases: re-read this PC's Store licences and report them. move: true takes a subscription
// over from another computer (the server allows a few moves a month).
async function storeRestore(payload) {
  await requirePurchaser('restore purchases');
  if (!tenantConfig().enabled || !storeBridge.isStoreInstall()) throw new Error('Microsoft Store purchases are only in the Microsoft Store version of the app.');
  const input = (payload && typeof payload === 'object') ? payload : {};
  return storeResultWithLicense(await getStoreCommerce().restore({ move: input.move === true }));
}

// ---- Microsoft Store rating (Store build only) ----
// A small Dashboard card after real use (3 different days, 5 successful profile launches) and a
// permanent entry in Settings > Updates, both opening the Store's own rating dialog, else the Store's
// review page (src/main/storeRating.js). Website and base builds never count, ask or show it. Nothing
// is rewarded or unlocked by rating.
let storeRatingInstance = null;
function getStoreRating() {
  if (!storeRatingInstance) {
    storeRatingInstance = storeRatingLib.createStoreRating({
      isStoreBuild: () => installChannel() === 'store',
      readSetting,
      writeSetting,
      bridge: storeBridge,
      openExternal: (url) => require('electron').shell.openExternal(url),
      promptBlocked: storeRatingBlocked
    });
  }
  return storeRatingInstance;
}

// Not while the first-run wizard is still open, nor while the licence has ended, is in grace, is
// blocked or belongs to another computer.
async function storeRatingBlocked() {
  const g = await readSetting('globalSettings', {});
  if (!(g && g.onboardingDone === true)) return true;
  return storeRatingLib.licenceBlocksAsk(await getLicense());
}

// A visible profile launch succeeded (headless warm-ups are not counted). Never slows or fails a launch.
function noteStoreRatingLaunch(input) {
  if (input && input.headless) return;
  getStoreRating().noteLaunch().catch(() => {});
}

async function storeRatingStatus() {
  return getStoreRating().status();
}

async function storeRatingChoose(payload) {
  const input = requireObject(payload || {});
  return getStoreRating().choose(String(input.choice || ''));
}

async function storeRatingRate(_payload, event) {
  return getStoreRating().rate(storeWindowHandle(event));
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
    const code = payments.newReceiptRef();
    await applyPaidMonths(lic, months, code, entry.tier || 'pro');
    await recordInvoice({ ownerId: entry.ownerId ?? null, provider: entry.provider, amount: entry.amount, currency: entry.currency, tier: entry.tier || 'pro', months, reference: code, note: entry.reference || null, status: 'paid', source: 'auto' });
    entry.status = 'approved';
    entry.purchaseCode = code;
    entry.resolvedAt = new Date().toISOString();
    try {
      const db = getPrisma();
      const owner = entry.ownerId != null ? await db.member.findUnique({ where: { id: entry.ownerId } }) : null;
      if (owner && owner.email) await deliverPaymentReceipt(owner.email, owner.name, code, months);
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

// Payment receipt. Both callers have already applied the paid months to the
// workspace licence, so there is nothing for the buyer to enter — this used to mail
// a redeemable purchase code and tell them to type it in, which was both a needless
// step and a transferable credential (see payments.js, decision A4).
async function deliverPaymentReceipt(email, name, reference, months) {
  const cfg = await resolveSmtpConfig();
  if (!cfg.configured) return false;
  const transporter = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass } });
  const term = Math.max(1, Number(months) || 1);
  const termText = term === 1 ? '1 month' : `${term} months`;
  // The member name is user-entered, so it is escaped before it goes into the HTML body.
  const safeName = String(name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  try {
    await transporter.sendMail({
      from: `"${cfg.fromName}" <${cfg.user}>`,
      to: email,
      subject: 'Your SoftGlaze Browser payment receipt',
      text: `Hi ${name}, thanks for your payment. ${termText} has been added to your workspace - there is nothing to enter, it is already active. Reference: ${reference}. You can see the term and your invoices under Settings -> Subscription.`,
      html: `<div style="font-family:sans-serif;max-width:28rem;margin:0 auto;"><h2>Payment received</h2><p>Hi ${safeName}, thanks for your payment.</p><p><strong>${termText}</strong> has been added to your workspace. There is nothing to enter - it is already active.</p><p style="font-size:12px;color:#666;">Reference: <code>${reference}</code><br/>The term and your invoices are under Settings &rarr; Subscription.</p></div>`
    });
    return true;
  } catch (e) { console.error('[Payment receipt email]', e); return false; }
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
  const control = { paused: false, aborted: false, profileId, ownerMemberId: actingMemberId() };
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
  const cfg = { enabled, macroId, everyMinutes, profileIds, ownerMemberId: actingMemberId() };
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
  // Profiles at once is capped by the plan: Pro 3, Enterprise (and the trial) 10 (tierPolicy.js).
  const concurrency = tierPolicy.clampConcurrency(input.concurrency, tierPolicy.limitsForLicense(await getLicense()));
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
  // control.aborted stops each profile's macro between steps and keeps queued profiles from
  // launching (stopParallelRun; used by SoftGlaze AI's stop_run and Stop all AI).
  const control = { paused: false, aborted: false };
  parallelRuns.set(runId, { runId, ownerMemberId: actingMemberId(), profileIds, startedAt: Date.now(), done: false, summary: null, control });

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
    launch: (pid) => {
      if (control.aborted) throw new Error('Run stopped.');
      return launchProfileById(pid, 'about:blank');
    },
    runMacro: (sid, s, opts) => runMacro(sid, s, { ...opts, control }),
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

// Stops a parallel run: the current step of each profile finishes, nothing after it runs, and
// profiles not started yet are skipped. Only whoever may control the run can stop it.
async function stopParallelRun(payload) {
  await requirePermission('automation.run');
  const input = requireObject(payload);
  const r = parallelRuns.get(String(input.runId || ''));
  if (!r || r.done) return { stopped: false };
  await assertCanControlRun(r.ownerMemberId);
  if (r.control) { r.control.aborted = true; r.control.paused = false; }
  return { stopped: true };
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
    ownerMemberId: actingMemberId() // who may stop / force-close it (see stopWarmer)
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
  const cfg = { ...warmAutopilot.normalizeConfig(input), ownerMemberId: actingMemberId() };
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
  const rows = await getPrisma().apiToken.findMany({ where: { kind: 'api' }, orderBy: { createdAt: 'desc' } });
  return rows.map(serializeApiToken);
}

async function createApiToken(payload) {
  await requireOwnerOrSuper();
  const input = requireObject(payload);
  const name = requiredString(input.name, 'Token name');
  // High-entropy, URL-safe token. Only its hash is persisted.
  const token = `sg_${crypto.randomBytes(24).toString('base64url')}`;
  const tokenHash = sha256Hex(token);
  // Developer API tokens act as their creator (null = the workspace owner) with the operate scope:
  // list, start and stop profiles. SoftGlaze AI tokens are made on the AI page (src/main/ai).
  const created = await getPrisma().apiToken.create({ data: { name, tokenHash, kind: 'api', scope: 'operate', memberId: ownerStampId(), createdById: ownerStampId() } });
  // `token` is returned exactly once - the renderer must show it now or never.
  return { ...serializeApiToken(created), token };
}

async function revokeApiToken(payload) {
  await requireOwnerOrSuper();
  const id = parseId(requireObject(payload).id);
  await getPrisma().apiToken.deleteMany({ where: { id, kind: 'api' } }).catch(() => {});
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

// ---- SoftGlaze AI wiring (src/main/ai) ----
// The only app functions AI tools may call (toolRegistry.ALLOWED_DEPS refuses anything else). Each
// runs inside aiActor.run(), so its own permission, access and ownership checks apply to the
// token's member. Nothing here exports cookies, reveals secrets, deletes, bills or changes members.
function buildAiToolDeps() {
  return {
    getPrisma,
    requirePermission,
    // "Visible features" for the token's member, the rule registerHandler applies to the window.
    assertFeature: async (feature) => {
      if (featureGate.featureHidden(await getActiveMember(), feature)) throw featureGate.featureOffError(feature);
    },
    getActiveMember,
    getLicense,
    scopedProfileWhere,
    scopedProxyWhere,
    scopedGroupWhere,
    assertCanAccessProfile,
    assertCanAccessProxy,
    partitionAccessibleProfileIds,
    listAllSessions,
    isFirefoxSession: (sid) => firefoxEngine.isFirefoxSession(String(sid)),
    // A profile an AI app or script started is driven by it: no proxy switch on a block page, and
    // its browser closing is not a crash.
    launchProfile: async (payload) => {
      const res = await launchProfile(payload);
      apiDrivenProfiles.add(Number(payload.id));
      return res;
    },
    closeSession: async (profileId) => {
      await requirePermission('profiles.launch');
      await assertCanAccessProfile(parseId(profileId));
      const r = await closeAnySession(String(profileId));
      reconcileProfileLocks();
      return r;
    },
    markAutomationDriven: (profileId) => { apiDrivenProfiles.add(Number(profileId)); },
    createProfile,
    updateProfile,
    batchGenerateProfiles,
    createGroup,
    assignProfilesToGroup,
    checkProxy,
    getProxyHealthHistory,
    getRecentProxyHealth,
    getVendorScoreboard,
    rotateProxyIp: (payload) => rotateProxyIp({ id: payload.id }), // the stored rotation link only
    bulkAssignProxies,
    harvestFreeProxies: (payload) => harvestFreeProxiesHandler(payload, null),
    cancelFreeProxyHarvest,
    getMacros,
    saveMacro,
    normalizeMacroSteps,
    runParallelMacro: (payload) => runParallelMacroHandler(payload, null),
    getParallelRunStatus,
    stopParallelRun,
    startWarmer: (payload) => startWarmer(payload, null),
    stopWarmer,
    listActiveWarmers,
    captchaScores,
    prelaunchCheck,
    analyzeProfileLeaks,
    runMacro,
    humanType,
    getAutomationPage,
    reapplyScreenMetrics
  };
}

function emitToAllWindows(channel, data) {
  try { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send(channel, data); } catch (e) { /* window gone */ } } } catch (e) { /* ignore */ }
}

// The member signed in to the window, for routing AI events. Reads currentMemberId directly:
// AI events are emitted inside the AI call, where getActiveMember() would answer with the token's
// member. A signed-in id that no longer exists answers nothing.
async function windowMemberForAiEvents() {
  const id = currentMemberId;
  if (id == null) return null;
  if (permissions.isSuperAdminId(id)) return { ...permissions.SUPER_ADMIN };
  const m = await getPrisma().member.findUnique({ where: { id } });
  return m || { id, role: 'NONE', status: 'missing' };
}

// AI events for the window; approval dialogs only reach a member who may answer them
// (ai/ipc.js canAnswerApproval, the same rule as ai:approvals-list).
const emitAiEvent = createWindowEmitter({ getWindowMember: windowMemberForAiEvents, send: emitToAllWindows });

// Where the stdio bridge lives and how to start it: the app's own executable in Node mode, so AI
// apps that only start local commands (Claude Desktop) need no separate Node.js.
function aiBridgeInfo() {
  const { app } = require('electron');
  const packaged = Boolean(app && app.isPackaged);
  const script = packaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'ai', 'bridge', 'softglaze-mcp-bridge.js')
    : path.join(__dirname, 'ai', 'bridge', 'softglaze-mcp-bridge.js');
  return { command: process.execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' }, mcpbPath: null };
}

function buildAiHost() {
  let appVersion = '1.0.0';
  try { appVersion = require('../../package.json').version || appVersion; } catch (e) { /* keep default */ }
  return {
    getPrisma,
    readSetting,
    writeSetting,
    emit: emitAiEvent,
    appVersion,
    isWorkspaceLocked: () => Boolean(vaultLocked) || !database.isDbUnlocked(),
    getLicense,
    localApi,
    bridgeInfo: aiBridgeInfo,
    listAllSessions,
    closeSession: async (profileId) => { const r = await closeAnySession(String(profileId)); reconcileProfileLocks(); return r; },
    stopParallelRun: async ({ runId }) => {
      const r = parallelRuns.get(String(runId || ''));
      if (!r || r.done || !r.control) return { stopped: false };
      r.control.aborted = true;
      return { stopped: true };
    },
    stopWarmer: async ({ runId, force }) => {
      const run = warmerRuns.get(String(runId || ''));
      if (!run) return { stopped: false };
      run.aborted = true;
      if (force) for (const sid of run.launched) await closeAnySession(sid).catch(() => {});
      return { stopped: true };
    }
  };
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
  registerHandler(CHANNELS.PROXY_EXTENSION_COPY_INFO, getProxyExtensionCopyInfo);
  registerHandler(CHANNELS.PROXY_EXTENSION_COPY, copyProxiesForExtension);
  registerHandler(CHANNELS.PROXY_ROTATION_GET, getProxyRotation);
  registerHandler(CHANNELS.PROXY_ROTATION_SET, setProxyRotation);
  registerHandler(CHANNELS.PROXY_SYNC_VENDOR_POOL, syncVendorPool);
  registerHandler(CHANNELS.PROXY_VENDOR_LOOKUP, vendorLookup);
  registerHandler(CHANNELS.PROXY_PROVIDER_CREDS_GET, getProxyProviderCreds);
  registerHandler(CHANNELS.PROXY_PROVIDER_CREDS_SET, saveProxyProviderCreds);
  registerHandler(CHANNELS.PROXY_PROVIDER_ACCOUNT, getProviderAccount);
  registerHandler(CHANNELS.PROXY_ROTATE_IP, rotateProxyIp);
  registerHandler(CHANNELS.PROFILE_ROTATE_IP, rotateProfileProxyIp);
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
  registerHandler(CHANNELS.PROFILE_BATCH_GENERATE, batchGenerateHandler);
  registerHandler(CHANNELS.PROFILE_BATCH_GENERATE_CANCEL, cancelBatchGenerate);
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
  registerHandler(CHANNELS.PROFILE_EDITOR_OPTIONS, profileEditorOptions);
  registerHandler(CHANNELS.PROFILE_GENERATE_IDENTITY, generateProfileIdentity);
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
  registerHandler(CHANNELS.SETTINGS_GET_PROXY_POLICY, getProxyPolicyForActor);
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
  // The notice's "Later" (that version, until restart) and "Download" (main opens its own checked link;
  // the renderer sends no URL).
  registerHandler(CHANNELS.UPDATER_NOTICE_LATER, (payload) => updater.dismissNotice(payload && typeof payload === 'object' ? payload.version : undefined));
  registerHandler(CHANNELS.UPDATER_NOTICE_DOWNLOAD, () => updater.openNoticeDownload());
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
    // Refuse vault calls while locked or signed out, and to a browser whose launcher may not use the
    // vault in autofill. `ctx.sessionId`: the session the page belongs to (browserEngine).
    isAvailable: (ctx) => personaVaultAvailable({ sessionId: ctx && ctx.sessionId != null ? ctx.sessionId : null }),
    listForUrl: (url) => getAvailablePersonasForUrl({ url }),
    markUsed: (id, url) => markPersonaUsed({ id, url }),
    // Resolve the plaintext password server-side by id: it is typed via the trusted CDP bridge and
    // never crosses into page JS.
    getSecret: (id) => getPersonaSecretById(id),
    // Gate injection on the global Smart Autofill toggle (default on; fail-open), and on whether the
    // member who launched this browser may use the vault through autofill (sessionAutofillAllowed;
    // fails closed), so a profile launched by a member without it gets no autofill button at all.
    isEnabled: async (ctx) => {
      let on = true;
      try { const g = await getGlobalSettings(); on = g?.smartAutofill?.enabled !== false; } catch (e) { on = true; }
      return on && (await sessionAutofillAllowed(ctx && ctx.sessionId != null ? ctx.sessionId : null));
    }
  });

  // Firefox Smart Autofill: Firefox has no CDP/exposeFunction, so its WebExtension reaches the same
  // persona vault over a loopback-only bridge.
  autofillBridge.configure({
    listForUrl: (url) => getAvailablePersonasForUrl({ url }),
    markUsed: (id, url) => markPersonaUsed({ id, url }),
    // Firefox has no CDP trusted typer, so the content script fills the password itself, but only for a
    // persona offered on the committed origin, resolved one id at a time via the loopback /secret endpoint.
    getSecret: (id, url) => getPersonaSecretForUrl(id, url),
    // No vault data while the app is locked or nobody is signed in, or for a Firefox profile whose
    // launcher may not use the vault in autofill. The session is the one owning the port the request
    // arrived on: each Firefox profile can reach only its own (autofillBridge.js).
    isAvailable: (ctx) => personaVaultAvailable({ sessionId: ctx && ctx.sessionId != null ? ctx.sessionId : null })
  });
  // Not started at boot: firefoxEngine acquires a port for each Firefox profile with the autofill
  // extension when it launches and releases it on exit, so a loopback port is open only while needed.

  // Resume the background proxy scheduler if it was enabled previously.
  (async () => {
    // Per-member saved filters and warm-up lists: create the store at the first start of 1.0.26, so
    // the copy of the shared lists goes to the members who exist now and not to members added later.
    try { await withMemberPageLists(loadMemberPageLists); } catch (e) { /* created on the first read instead */ }
    // Per-member first-run flags: created now, before anyone signs in, so members who signed in before the
    // update are marked done and members who never did see the wizard (memberOnboarding).
    try { await ensureMemberOnboardingStore(); } catch (e) { /* created before the first sign-in instead */ }
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
  registerHandler(CHANNELS.STORE_STATUS, storeStatus);
  registerHandler(CHANNELS.STORE_PURCHASE, storePurchase);
  registerHandler(CHANNELS.STORE_RESTORE, storeRestore);
  registerHandler(CHANNELS.STORE_RATING_STATUS, storeRatingStatus);
  registerHandler(CHANNELS.STORE_RATING_CHOOSE, storeRatingChoose);
  registerHandler(CHANNELS.STORE_RATING_RATE, storeRatingRate);
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
  registerHandler(CHANNELS.ACCOUNT_SIGNUP_STATUS, accountSignupStatus);
  registerHandler(CHANNELS.ACCOUNT_CONFIRM_START, accountConfirmStart);
  registerHandler(CHANNELS.ACCOUNT_CONFIRM_CHECK, accountConfirmCheck);
  registerHandler(CHANNELS.ACCOUNT_CONFIRM_LATER, accountConfirmLater);
  registerHandler(CHANNELS.EMAIL_GET_CONFIG, getEmailConfig);
  registerHandler(CHANNELS.EMAIL_SET_CONFIG, setEmailConfig);
  registerHandler(CHANNELS.EMAIL_TEST, testEmail);

  // Softglaze Pro - the loopback server for the Developer API (/api/v1) and SoftGlaze AI (/mcp).
  // Both go through the AI tool registry, acting as the token's member. Off by default.
  ai.configure({ toolDeps: buildAiToolDeps(), host: buildAiHost() });
  localApi.configure({
    ai,
    readConfig: () => readSetting('localApi', { enabled: false, port: localApi.DEFAULT_PORT }),
    writeConfig: (cfg) => writeSetting('localApi', cfg)
  });
  registerAiIpc(registerHandler, ai, {
    getWindowMember: () => getActiveMember(),
    visibleMemberIds: async (member) => permissions.visibleMemberIds(await getPrisma().member.findMany(), member)
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
  try { const mcp = ai.mcpHandler(); if (mcp) await mcp.dispose(); } catch (e) { /* not configured */ }
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