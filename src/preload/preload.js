'use strict';

const { contextBridge, ipcRenderer } = require('electron');

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
    getInfo: () => invoke(CHANNELS.SYSTEM_GET_INFO)
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
    check: (payload) => invoke(CHANNELS.PROXY_CHECK, payload)
  }),
  profiles: Object.freeze({
    list: (params = {}) => invoke(CHANNELS.PROFILE_LIST, params),
    create: (payload) => invoke(CHANNELS.PROFILE_CREATE, payload),
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
    bulkClose: (ids) => invoke(CHANNELS.PROFILE_BULK_CLOSE, { ids }),
    analyzeLeaks: (id) => invoke(CHANNELS.PROFILE_ANALYZE_LEAKS, { id }),
    exportCookies: (id, format) => invoke(CHANNELS.PROFILE_EXPORT_COOKIES, { id, format }),
    importCookies: (id, data, format) => invoke(CHANNELS.PROFILE_IMPORT_COOKIES, { id, data, format })
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
    close: (sessionId) => invoke(CHANNELS.SESSION_CLOSE, { sessionId })
  }),
  batch: Object.freeze({
    previewProfilesFromSpreadsheet: () => invoke(CHANNELS.BATCH_PREVIEW_PROFILES_DIALOG),
    commitProfileImport: (token) => invoke(CHANNELS.BATCH_COMMIT_PROFILE_IMPORT, { token })
  })
});

contextBridge.exposeInMainWorld('softglaze', api);