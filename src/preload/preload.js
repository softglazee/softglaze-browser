'use strict';

const { contextBridge, ipcRenderer } = require('electron');

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
  PROXY_PROVIDER_CREDS_GET: 'proxy-provider:creds-get',
  PROXY_PROVIDER_CREDS_SET: 'proxy-provider:creds-set',
  PROXY_ROTATE_IP: 'proxy:rotate-ip',
  PROXY_TEST_ALL: 'proxy:test-all',
  PROXY_GROUP_LIST: 'proxy-group:list',
  PROXY_GROUP_CREATE: 'proxy-group:create',
  PROXY_GROUP_UPDATE: 'proxy-group:update',
  PROXY_GROUP_DELETE: 'proxy-group:delete',
  PROXY_GROUP_ASSIGN: 'proxy-group:assign',
  PROXY_AUTO_GROUP: 'proxy:auto-group',
  PROXY_HEALTH_HISTORY: 'proxy:health-history',

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
  PROFILE_BULK_LAUNCH_PROGRESS: 'profile:bulk-launch-progress',
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

  PERSONA_IMPORT_BATCH: 'personas:import-batch',
  PERSONA_CREATE_MANUAL: 'personas:create-manual',
  PERSONA_GET_ALL: 'personas:get-all',
  PERSONA_GET_AVAILABLE_FOR_URL: 'personas:get-available-for-url',
  PERSONA_MARK_USED: 'personas:mark-used',
  PERSONA_CLEAR_USED: 'personas:clear-used',
  PERSONA_DELETE: 'personas:delete',
  PERSONA_UPDATE: 'personas:update',
  PERSONA_PREVIEW_FILE: 'personas:preview-file',

  EMAIL_GET_CONFIG: 'email:get-config',
  EMAIL_SET_CONFIG: 'email:set-config',
  EMAIL_TEST: 'email:test',
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
  SYNC_STATUS: 'sync:status',
  SYNC_CONFIGURE: 'sync:configure',
  SYNC_RUN: 'sync:run',
  DB_ENCRYPTION_STATUS: 'db:encryption-status',
  DB_UNLOCK: 'db:unlock',
  DB_ENABLE_ENCRYPTION: 'db:enable-encryption',
  DB_DISABLE_ENCRYPTION: 'db:disable-encryption',
  WORKSPACE_BACKUP: 'workspace:backup',
  WORKSPACE_RESTORE: 'workspace:restore',
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
  SESSION_CRASH: 'session:crash',
  MEMORY_PRESSURE: 'system:memory-pressure',

  BATCH_PREVIEW_PROFILES_DIALOG: 'batch:preview-profiles-dialog',
  BATCH_COMMIT_PROFILE_IMPORT: 'batch:commit-profile-import',
  BATCH_IMPORT_PROGRESS: 'batch:import-progress',
  BATCH_EXPORT_PROFILES: 'batch:export-profiles',
  BATCH_EXPORT_PROFILES_FILE: 'batch:export-profiles-file',

  MIGRATION_START_TRANSFER: 'migration:start-transfer',
  MIGRATION_PROGRESS: 'migration:progress',

  AUTOMATION_GET_MACROS: 'automation:get-macros',
  AUTOMATION_SAVE_MACRO: 'automation:save-macro',
  AUTOMATION_DELETE_MACRO: 'automation:delete-macro',
  AUTOMATION_START_WARMER: 'automation:start-warmer',
  AUTOMATION_STOP_WARMER: 'automation:stop-warmer',
  AUTOMATION_GET_HISTORY: 'automation:get-history',
  AUTOMATION_WARMER_PROGRESS: 'automation:warmer-progress',
  AUTOMATION_RUN_MACRO: 'automation:run-macro',
  AUTOMATION_MACRO_PROGRESS: 'automation:macro-progress',
  AUTOMATION_CONTROL_MACRO: 'automation:control-macro',
  AUTOMATION_START_RECORDING: 'automation:start-recording',
  AUTOMATION_STOP_RECORDING: 'automation:stop-recording',
  AUTOMATION_GET_SCHEDULE: 'automation:get-schedule',
  AUTOMATION_SET_SCHEDULE: 'automation:set-schedule',
  AUTOMATION_RUN_PARALLEL: 'automation:run-parallel',
  AUTOMATION_RUN_PROGRESS: 'automation:run-progress',
  AUTOMATION_PICK_DATA_FILE: 'automation:pick-data-file',

  API_TOKEN_LIST: 'api:token-list',
  API_TOKEN_CREATE: 'api:token-create',
  API_TOKEN_REVOKE: 'api:token-revoke',
  API_SERVER_STATUS: 'api:server-status',
  API_SERVER_SET_ENABLED: 'api:server-set-enabled',

  UPDATER_EVENT: 'updater:event',
  UPDATER_GET_STATE: 'updater:get-state',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_CHECK: 'updater:check'
});

const ALLOWED_CHANNELS = new Set(Object.values(CHANNELS));

async function invoke(channel, payload = undefined) {
  if (!ALLOWED_CHANNELS.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);

  const response = await ipcRenderer.invoke(channel, payload);
  if (!response || response.ok !== true) {
    const message = response?.error?.message || 'IPC request failed.';
    const error = new Error(message);
    error.code = response?.error?.code || 'IPC_ERROR';
    throw error;
  }
  return response.data;
}

const api = Object.freeze({
  system: Object.freeze({
    getInfo: () => invoke(CHANNELS.SYSTEM_GET_INFO),
    listBrowsers: () => invoke(CHANNELS.SYSTEM_LIST_BROWSERS),
    humanType: (payload) => invoke(CHANNELS.SYSTEM_HUMAN_TYPE, payload)
  }),
  browsers: Object.freeze({
    listAvailable: () => invoke(CHANNELS.BROWSER_LIST_AVAILABLE),
    download: (version) => invoke(CHANNELS.BROWSER_DOWNLOAD, { version }),
    downloadStatus: () => invoke(CHANNELS.BROWSER_DOWNLOAD_STATUS),
    pauseDownload: (version) => invoke(CHANNELS.BROWSER_DOWNLOAD_PAUSE, { version }),
    resumeDownload: (version) => invoke(CHANNELS.BROWSER_DOWNLOAD_RESUME, { version }),
    firefoxStatus: () => invoke(CHANNELS.BROWSER_FIREFOX_STATUS),
    firefoxList: () => invoke(CHANNELS.BROWSER_FIREFOX_LIST),
    firefoxDownload: (version) => invoke(CHANNELS.BROWSER_FIREFOX_DOWNLOAD, { version }),
    firefoxDownloadStatus: () => invoke(CHANNELS.BROWSER_FIREFOX_DOWNLOAD_STATUS),
    firefoxPauseDownload: (version) => invoke(CHANNELS.BROWSER_FIREFOX_DOWNLOAD_PAUSE, { version }),
    firefoxResumeDownload: (version) => invoke(CHANNELS.BROWSER_FIREFOX_DOWNLOAD_RESUME, { version })
  }),
  dashboard: Object.freeze({
    getStats: () => invoke(CHANNELS.DASHBOARD_GET_STATS)
  }),
  proxies: Object.freeze({
    list: (params = {}) => invoke(CHANNELS.PROXY_LIST, params),
    create: (payload) => invoke(CHANNELS.PROXY_CREATE, payload),
    update: (payload) => invoke(CHANNELS.PROXY_UPDATE, payload),
    delete: (id) => invoke(CHANNELS.PROXY_DELETE, { id }),
    batchAdd: (payload) => invoke(CHANNELS.PROXY_BATCH_ADD, payload),
    check: (payload) => invoke(CHANNELS.PROXY_CHECK, payload),
    bulkDelete: (ids) => invoke(CHANNELS.PROXY_BULK_DELETE, { ids }),
    getRotation: (profileId) => invoke(CHANNELS.PROXY_ROTATION_GET, { id: profileId }),
    setRotation: (payload) => invoke(CHANNELS.PROXY_ROTATION_SET, payload),
    syncVendorPool: (payload) => invoke(CHANNELS.PROXY_SYNC_VENDOR_POOL, payload),
    getProviderCreds: (provider) => invoke(CHANNELS.PROXY_PROVIDER_CREDS_GET, { provider }),
    saveProviderCreds: (payload) => invoke(CHANNELS.PROXY_PROVIDER_CREDS_SET, payload),
    rotateIp: (payload) => invoke(CHANNELS.PROXY_ROTATE_IP, payload),
    testAll: () => invoke(CHANNELS.PROXY_TEST_ALL),
    autoGroup: (level) => invoke(CHANNELS.PROXY_AUTO_GROUP, { level }),
    healthHistory: (id) => invoke(CHANNELS.PROXY_HEALTH_HISTORY, { id })
  }),
  proxyGroups: Object.freeze({
    list: () => invoke(CHANNELS.PROXY_GROUP_LIST),
    create: (payload) => invoke(CHANNELS.PROXY_GROUP_CREATE, payload),
    update: (payload) => invoke(CHANNELS.PROXY_GROUP_UPDATE, payload),
    delete: (id) => invoke(CHANNELS.PROXY_GROUP_DELETE, { id }),
    assign: (ids, groupId) => invoke(CHANNELS.PROXY_GROUP_ASSIGN, { ids, groupId })
  }),
  profiles: Object.freeze({
    list: (params = {}) => invoke(CHANNELS.PROFILE_LIST, params),
    create: (payload) => invoke(CHANNELS.PROFILE_CREATE, payload),
    batchGenerate: (payload) => invoke(CHANNELS.PROFILE_BATCH_GENERATE, payload),
    update: (payload) => invoke(CHANNELS.PROFILE_UPDATE, payload),
    delete: (id, options = {}) => invoke(CHANNELS.PROFILE_DELETE, { id, removeLocalData: Boolean(options.removeLocalData) }),
    launch: (id, options = {}) => invoke(CHANNELS.PROFILE_LAUNCH, { id, startUrl: options.startUrl || 'about:blank' }),
    restore: (id) => invoke(CHANNELS.PROFILE_RESTORE, { id }),
    purge: (id, options = {}) => invoke(CHANNELS.PROFILE_PURGE, { id, removeLocalData: Boolean(options.removeLocalData) }),
    listTrash: () => invoke(CHANNELS.PROFILE_LIST_TRASH),
    bulkDelete: (ids) => invoke(CHANNELS.PROFILE_BULK_DELETE, { ids }),
    bulkRestore: (ids) => invoke(CHANNELS.PROFILE_BULK_RESTORE, { ids }),
    bulkPurge: (ids, options = {}) => invoke(CHANNELS.PROFILE_BULK_PURGE, { ids, removeLocalData: Boolean(options.removeLocalData) }),
    bulkLaunch: (ids) => invoke(CHANNELS.PROFILE_BULK_LAUNCH, { ids }),
    tagAssign: (ids, tag, mode) => invoke(CHANNELS.PROFILE_TAG_ASSIGN, { ids, tag, mode }),
    bulkRename: (payload) => invoke(CHANNELS.PROFILE_BULK_RENAME, payload),
    bulkClose: (ids) => invoke(CHANNELS.PROFILE_BULK_CLOSE, { ids }),
    // Subscribe to live bulk-launch progress; returns an unsubscribe function.
    onBulkLaunchProgress: (callback) => {
      const listener = (_event, data) => { try { callback(data); } catch (e) { /* ignore */ } };
      ipcRenderer.on(CHANNELS.PROFILE_BULK_LAUNCH_PROGRESS, listener);
      return () => ipcRenderer.removeListener(CHANNELS.PROFILE_BULK_LAUNCH_PROGRESS, listener);
    },
    analyzeLeaks: (id) => invoke(CHANNELS.PROFILE_ANALYZE_LEAKS, { id }),
    exportCookies: (id, format) => invoke(CHANNELS.PROFILE_EXPORT_COOKIES, { id, format }),
    importCookies: (id, data, format) => invoke(CHANNELS.PROFILE_IMPORT_COOKIES, { id, data, format }),
    importCookiesToRunning: (data, format) => invoke(CHANNELS.PROFILE_IMPORT_COOKIES_BULK, { data, format }),
    storageInfo: (id) => invoke(CHANNELS.PROFILE_STORAGE_INFO, { id }),
    clone: (id, options = {}) => invoke(CHANNELS.PROFILE_CLONE, { id, reroll: Boolean(options.reroll) }),
    liveLeak: (id) => invoke(CHANNELS.PROFILE_LIVE_LEAK, { id }),
    activity: (id) => invoke(CHANNELS.PROFILE_ACTIVITY, { id }),
    get2faToken: (id) => invoke(CHANNELS.PROFILE_GET_2FA_TOKEN, { id }),
    bulkSynchronize: (ids) => invoke(CHANNELS.PROFILE_BULK_SYNCHRONIZE, { ids }),
    exportArchive: (payload) => invoke(CHANNELS.PROFILE_EXPORT_ARCHIVE, payload),
    cookieRobot: (payload) => invoke(CHANNELS.PROFILE_COOKIE_ROBOT, payload),
    getLocks: () => invoke(CHANNELS.PROFILE_GET_LOCKS)
  }),
  templates: Object.freeze({
    list: () => invoke(CHANNELS.TEMPLATE_LIST),
    save: (id, name) => invoke(CHANNELS.TEMPLATE_SAVE, { id, name }),
    delete: (id) => invoke(CHANNELS.TEMPLATE_DELETE, { id }),
    createProfile: (templateId, title) => invoke(CHANNELS.TEMPLATE_CREATE_PROFILE, { templateId, title })
  }),
  settings: Object.freeze({
    getProxyScheduler: () => invoke(CHANNELS.SETTINGS_GET_SCHEDULER),
    setProxyScheduler: (config) => invoke(CHANNELS.SETTINGS_SET_SCHEDULER, config),
    getGlobal: () => invoke(CHANNELS.SETTINGS_GET_GLOBAL),
    setGlobal: (patch) => invoke(CHANNELS.SETTINGS_SET_GLOBAL, patch),
    getProxyPolicy: () => invoke(CHANNELS.SETTINGS_GET_PROXY_POLICY),
    setProxyPolicy: (payload) => invoke(CHANNELS.SETTINGS_SET_PROXY_POLICY, payload),
    getEmail: () => invoke(CHANNELS.EMAIL_GET_CONFIG),
    setEmail: (config) => invoke(CHANNELS.EMAIL_SET_CONFIG, config),
    testEmail: (email) => invoke(CHANNELS.EMAIL_TEST, { email })
  }),
  groups: Object.freeze({
    list: () => invoke(CHANNELS.GROUP_LIST),
    create: (payload) => invoke(CHANNELS.GROUP_CREATE, payload),
    update: (payload) => invoke(CHANNELS.GROUP_UPDATE, payload),
    delete: (id) => invoke(CHANNELS.GROUP_DELETE, { id }),
    assign: (ids, groupId) => invoke(CHANNELS.GROUP_ASSIGN, { ids, groupId })
  }),
  tags: Object.freeze({
    list: () => invoke(CHANNELS.TAG_LIST)
  }),
  sessions: Object.freeze({
    list: () => invoke(CHANNELS.SESSION_LIST),
    close: (sessionId) => invoke(CHANNELS.SESSION_CLOSE, { sessionId }),
    restoreGet: () => invoke(CHANNELS.SESSION_RESTORE_GET),
    restoreRun: (payload) => invoke(CHANNELS.SESSION_RESTORE_RUN, payload),
    resourceUsage: () => invoke(CHANNELS.SESSION_RESOURCE_USAGE),
    // Subscribe to crash notifications; returns an unsubscribe function.
    onCrash: (callback) => {
      const listener = (_event, data) => { try { callback(data); } catch (e) { /* ignore */ } };
      ipcRenderer.on(CHANNELS.SESSION_CRASH, listener);
      return () => ipcRenderer.removeListener(CHANNELS.SESSION_CRASH, listener);
    },
    // Subscribe to memory-pressure notifications; returns an unsubscribe function.
    onMemoryPressure: (callback) => {
      const listener = (_event, data) => { try { callback(data); } catch (e) { /* ignore */ } };
      ipcRenderer.on(CHANNELS.MEMORY_PRESSURE, listener);
      return () => ipcRenderer.removeListener(CHANNELS.MEMORY_PRESSURE, listener);
    }
  }),
  members: Object.freeze({
    list: () => invoke(CHANNELS.MEMBER_LIST),
    create: (payload) => invoke(CHANNELS.MEMBER_CREATE, payload),
    update: (payload) => invoke(CHANNELS.MEMBER_UPDATE, payload),
    delete: (id, options = {}) => invoke(CHANNELS.MEMBER_DELETE, { id, ...options }),
    setPin: (id, pin) => invoke(CHANNELS.MEMBER_SET_PIN, { id, pin }),
    current: () => invoke(CHANNELS.MEMBER_CURRENT),
    switch: (id, pin, password) => invoke(CHANNELS.MEMBER_SWITCH, { id, pin, password }),
    superLogin: (identifier, password, remember) => invoke(CHANNELS.MEMBER_SUPER_LOGIN, { identifier, password, remember }),
    superStatus: () => invoke(CHANNELS.MEMBER_SUPER_STATUS),
    superSetup: (payload) => invoke(CHANNELS.MEMBER_SUPER_SETUP, payload),
    acceptInvite: (payload) => invoke(CHANNELS.MEMBER_ACCEPT_INVITE, payload),
    login: (identifier, password, remember) => invoke(CHANNELS.MEMBER_LOGIN, { identifier, password, remember }),
    logout: () => invoke(CHANNELS.MEMBER_LOGOUT),
    updateSelf: (payload) => invoke(CHANNELS.MEMBER_UPDATE_SELF, payload),
    requestChange: (payload) => invoke(CHANNELS.MEMBER_REQUEST_CHANGE, payload),
    commitChange: (payload) => invoke(CHANNELS.MEMBER_COMMIT_CHANGE, payload),
    updatePermissions: (id, permissions) => invoke(CHANNELS.MEMBER_UPDATE_PERMISSIONS, { id, permissions }),
    resetPermissions: (id) => invoke(CHANNELS.MEMBER_UPDATE_PERMISSIONS, { id, reset: true }),
    setInstructions: (id, instructions) => invoke(CHANNELS.MEMBER_SET_INSTRUCTIONS, { id, instructions }),
    setStatus: (payload) => invoke(CHANNELS.MEMBER_SET_STATUS, payload)
  }),
  team: Object.freeze({
    activity: (limit) => invoke(CHANNELS.TEAM_ACTIVITY, { limit }),
    reassignProfiles: (payload) => invoke(CHANNELS.TEAM_REASSIGN_PROFILES, payload),
    seatUsage: () => invoke(CHANNELS.TEAM_SEAT_USAGE),
    exportActivity: (payload) => invoke(CHANNELS.TEAM_EXPORT_ACTIVITY, payload)
  }),
  sync: Object.freeze({
    status: () => invoke(CHANNELS.SYNC_STATUS),
    configure: (payload) => invoke(CHANNELS.SYNC_CONFIGURE, payload),
    run: (payload) => invoke(CHANNELS.SYNC_RUN, payload)
  }),
  db: Object.freeze({
    encryptionStatus: () => invoke(CHANNELS.DB_ENCRYPTION_STATUS),
    unlock: (password, remember) => invoke(CHANNELS.DB_UNLOCK, { password, remember }),
    enableEncryption: (payload) => invoke(CHANNELS.DB_ENABLE_ENCRYPTION, payload),
    disableEncryption: (payload) => invoke(CHANNELS.DB_DISABLE_ENCRYPTION, payload)
  }),
  workspace: Object.freeze({
    backup: (payload) => invoke(CHANNELS.WORKSPACE_BACKUP, payload),
    restore: (payload) => invoke(CHANNELS.WORKSPACE_RESTORE, payload)
  }),
  license: Object.freeze({
    get: () => invoke(CHANNELS.LICENSE_GET),
    redeem: (code) => invoke(CHANNELS.LICENSE_REDEEM, { code }),
    grant: (payload) => invoke(CHANNELS.LICENSE_GRANT, payload),
    extend: (payload) => invoke(CHANNELS.LICENSE_EXTEND, payload),
    reset: (payload) => invoke(CHANNELS.LICENSE_RESET, payload),
    startTrial: (payload) => invoke(CHANNELS.LICENSE_TRIAL_START, payload),
    backendInfo: () => invoke(CHANNELS.LICENSE_BACKEND_INFO),
    edit: (payload) => invoke(CHANNELS.LICENSE_EDIT, payload),
    terminate: (payload) => invoke(CHANNELS.LICENSE_TERMINATE, payload),
    listOwners: () => invoke(CHANNELS.LICENSE_LIST_OWNERS)
  }),
  payments: Object.freeze({
    getConfig: () => invoke(CHANNELS.PAYMENT_CONFIG_GET),
    setConfig: (payload) => invoke(CHANNELS.PAYMENT_CONFIG_SET, payload),
    validate: (payload) => invoke(CHANNELS.PAYMENT_CONFIG_VALIDATE, payload),
    startCheckout: (payload) => invoke(CHANNELS.PAYMENT_CHECKOUT_START, payload),
    pollCheckout: (payload) => invoke(CHANNELS.PAYMENT_CHECKOUT_POLL, payload),
    listMethods: () => invoke(CHANNELS.PAYMENT_LIST_METHODS),
    submitManual: (payload) => invoke(CHANNELS.PAYMENT_SUBMIT_MANUAL, payload),
    manualList: () => invoke(CHANNELS.PAYMENT_MANUAL_LIST),
    manualResolve: (payload) => invoke(CHANNELS.PAYMENT_MANUAL_RESOLVE, payload)
  }),
  billing: Object.freeze({
    getPlans: () => invoke(CHANNELS.BILLING_GET_PLANS),
    plansAdmin: () => invoke(CHANNELS.BILLING_PLANS_ADMIN),
    savePlan: (payload) => invoke(CHANNELS.BILLING_PLAN_SAVE, payload),
    deletePlan: (payload) => invoke(CHANNELS.BILLING_PLAN_DELETE, payload),
    assignPlan: (payload) => invoke(CHANNELS.BILLING_ASSIGN, payload),
    subscribers: () => invoke(CHANNELS.BILLING_SUBSCRIBERS)
  }),
  invoices: Object.freeze({
    list: (payload) => invoke(CHANNELS.INVOICE_LIST, payload),
    create: (payload) => invoke(CHANNELS.INVOICE_CREATE, payload),
    update: (payload) => invoke(CHANNELS.INVOICE_UPDATE, payload),
    remove: (payload) => invoke(CHANNELS.INVOICE_DELETE, payload)
  }),
  ipProviders: Object.freeze({
    getAll: () => invoke(CHANNELS.IP_PROVIDERS_GET_ALL),
    updateCredentials: (payload) => invoke(CHANNELS.IP_PROVIDERS_UPDATE_CREDENTIALS, payload),
    toggleStatus: (payload) => invoke(CHANNELS.IP_PROVIDERS_TOGGLE_STATUS, payload)
  }),
  monetization: Object.freeze({
    getLinks: () => invoke(CHANNELS.MONETIZATION_GET_LINKS),
    setLinks: (payload) => invoke(CHANNELS.MONETIZATION_SET_LINKS, payload)
  }),
  extensions: Object.freeze({
    list: () => invoke(CHANNELS.EXTENSIONS_LIST),
    installFromId: (idOrUrl) => invoke(CHANNELS.EXTENSIONS_INSTALL_FROM_ID, { idOrUrl }),
    delete: (id) => invoke(CHANNELS.EXTENSIONS_DELETE, { id }),
    toggleGlobal: (id, isGlobal) => invoke(CHANNELS.EXTENSIONS_TOGGLE_GLOBAL, { id, isGlobal })
  }),
  personas: Object.freeze({
    importBatch: (personas) => invoke(CHANNELS.PERSONA_IMPORT_BATCH, { personas }),
    createManual: (payload) => invoke(CHANNELS.PERSONA_CREATE_MANUAL, payload),
    getAll: () => invoke(CHANNELS.PERSONA_GET_ALL),
    getAvailableForUrl: (url) => invoke(CHANNELS.PERSONA_GET_AVAILABLE_FOR_URL, { url }),
    markUsed: (id, url) => invoke(CHANNELS.PERSONA_MARK_USED, { id, url }),
    clearUsed: (payload) => invoke(CHANNELS.PERSONA_CLEAR_USED, payload),
    delete: (payload) => invoke(CHANNELS.PERSONA_DELETE, payload),
    update: (payload) => invoke(CHANNELS.PERSONA_UPDATE, payload),
    previewFile: () => invoke(CHANNELS.PERSONA_PREVIEW_FILE)
  }),
  vault: Object.freeze({
    status: () => invoke(CHANNELS.VAULT_STATUS),
    setPassword: (payload) => invoke(CHANNELS.VAULT_SET_PASSWORD, payload),
    unlock: (password, remember) => invoke(CHANNELS.VAULT_UNLOCK, { password, remember }),
    lock: () => invoke(CHANNELS.VAULT_LOCK),
    disable: (password) => invoke(CHANNELS.VAULT_DISABLE, { password }),
    setAutoLock: (minutes) => invoke(CHANNELS.VAULT_SET_AUTOLOCK, { minutes })
  }),
  auth: Object.freeze({
    rememberStatus: () => invoke(CHANNELS.AUTH_REMEMBER_STATUS),
    forget: () => invoke(CHANNELS.AUTH_FORGET)
  }),
  account: Object.freeze({
    get: () => invoke(CHANNELS.ACCOUNT_GET),
    save: (payload) => invoke(CHANNELS.ACCOUNT_SAVE, payload),
    sendOtp: (email) => invoke(CHANNELS.ACCOUNT_SEND_OTP, { email }),
    verifyOtp: (email, code) => invoke(CHANNELS.ACCOUNT_VERIFY_OTP, { email, code }),
    register: (payload) => invoke(CHANNELS.ACCOUNT_REGISTER, payload)
  }),
  batch: Object.freeze({
    previewProfilesFromSpreadsheet: () => invoke(CHANNELS.BATCH_PREVIEW_PROFILES_DIALOG),
    commitProfileImport: (token, options = {}) => invoke(CHANNELS.BATCH_COMMIT_PROFILE_IMPORT, { token, autoBindByCountry: Boolean(options.autoBindByCountry) }),
    exportProfiles: () => invoke(CHANNELS.BATCH_EXPORT_PROFILES),
    exportProfilesToFile: (options = {}) => invoke(CHANNELS.BATCH_EXPORT_PROFILES_FILE, options),
    // Subscribe to live import progress; returns an unsubscribe function.
    onImportProgress: (callback) => {
      const listener = (_event, data) => { try { callback(data); } catch (e) { /* ignore */ } };
      ipcRenderer.on(CHANNELS.BATCH_IMPORT_PROGRESS, listener);
      return () => ipcRenderer.removeListener(CHANNELS.BATCH_IMPORT_PROGRESS, listener);
    }
  }),
  migration: Object.freeze({
    startTransfer: (payload) => invoke(CHANNELS.MIGRATION_START_TRANSFER, payload),
    // Subscribe to live transfer progress; returns an unsubscribe function.
    onProgress: (callback) => {
      const listener = (_event, data) => { try { callback(data); } catch (e) { /* ignore */ } };
      ipcRenderer.on(CHANNELS.MIGRATION_PROGRESS, listener);
      return () => ipcRenderer.removeListener(CHANNELS.MIGRATION_PROGRESS, listener);
    }
  }),
  automation: Object.freeze({
    getMacros: () => invoke(CHANNELS.AUTOMATION_GET_MACROS),
    saveMacro: (payload) => invoke(CHANNELS.AUTOMATION_SAVE_MACRO, payload),
    deleteMacro: (id) => invoke(CHANNELS.AUTOMATION_DELETE_MACRO, { id }),
    startWarmer: (payload) => invoke(CHANNELS.AUTOMATION_START_WARMER, payload),
    stopWarmer: (payload) => invoke(CHANNELS.AUTOMATION_STOP_WARMER, payload),
    getHistory: () => invoke(CHANNELS.AUTOMATION_GET_HISTORY),
    runMacro: (payload) => invoke(CHANNELS.AUTOMATION_RUN_MACRO, payload),
    controlMacro: (payload) => invoke(CHANNELS.AUTOMATION_CONTROL_MACRO, payload),
    startRecording: (payload) => invoke(CHANNELS.AUTOMATION_START_RECORDING, payload),
    stopRecording: (payload) => invoke(CHANNELS.AUTOMATION_STOP_RECORDING, payload),
    getSchedule: () => invoke(CHANNELS.AUTOMATION_GET_SCHEDULE),
    setSchedule: (payload) => invoke(CHANNELS.AUTOMATION_SET_SCHEDULE, payload),
    runParallel: (payload) => invoke(CHANNELS.AUTOMATION_RUN_PARALLEL, payload),
    pickDataFile: () => invoke(CHANNELS.AUTOMATION_PICK_DATA_FILE),
    // Subscribe to live warm-up progress; returns an unsubscribe function.
    onWarmerProgress: (callback) => {
      const listener = (_event, data) => { try { callback(data); } catch (e) { /* ignore */ } };
      ipcRenderer.on(CHANNELS.AUTOMATION_WARMER_PROGRESS, listener);
      return () => ipcRenderer.removeListener(CHANNELS.AUTOMATION_WARMER_PROGRESS, listener);
    },
    // Subscribe to live macro-run progress (per-step); returns an unsubscribe function.
    onMacroProgress: (callback) => {
      const listener = (_event, data) => { try { callback(data); } catch (e) { /* ignore */ } };
      ipcRenderer.on(CHANNELS.AUTOMATION_MACRO_PROGRESS, listener);
      return () => ipcRenderer.removeListener(CHANNELS.AUTOMATION_MACRO_PROGRESS, listener);
    },
    // Subscribe to live parallel-run progress frames; returns an unsubscribe function.
    onRunProgress: (callback) => {
      const listener = (_event, frame) => { try { callback(frame); } catch (e) { /* ignore */ } };
      ipcRenderer.on(CHANNELS.AUTOMATION_RUN_PROGRESS, listener);
      return () => ipcRenderer.removeListener(CHANNELS.AUTOMATION_RUN_PROGRESS, listener);
    }
  }),
  developerApi: Object.freeze({
    listTokens: () => invoke(CHANNELS.API_TOKEN_LIST),
    createToken: (payload) => invoke(CHANNELS.API_TOKEN_CREATE, payload),
    revokeToken: (id) => invoke(CHANNELS.API_TOKEN_REVOKE, { id }),
    serverStatus: () => invoke(CHANNELS.API_SERVER_STATUS),
    setServerEnabled: (enabled) => invoke(CHANNELS.API_SERVER_SET_ENABLED, { enabled })
  }),
  updater: Object.freeze({
    getState: () => invoke(CHANNELS.UPDATER_GET_STATE),
    install: () => invoke(CHANNELS.UPDATER_INSTALL),
    check: () => invoke(CHANNELS.UPDATER_CHECK),
    // Subscribe to live updater events (available / downloading / downloaded); returns an unsubscribe fn.
    onEvent: (callback) => {
      const listener = (_event, data) => { try { callback(data); } catch (e) { /* ignore */ } };
      ipcRenderer.on(CHANNELS.UPDATER_EVENT, listener);
      return () => ipcRenderer.removeListener(CHANNELS.UPDATER_EVENT, listener);
    }
  })
});

contextBridge.exposeInMainWorld('softglaze', api);