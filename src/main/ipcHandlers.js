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
  listActiveSessions
} = require('./browserEngine');
const { parseWorkbookFile, parseBooleanInt, parseSystemProxyBehavior } = require('./importParser');

const CHANNELS = Object.freeze({
  SYSTEM_GET_INFO: 'system:get-info',

  PROXY_LIST: 'proxy:list',
  PROXY_CREATE: 'proxy:create',
  PROXY_UPDATE: 'proxy:update',
  PROXY_DELETE: 'proxy:delete',
  PROXY_BATCH_ADD: 'proxy:batch-add',

  PROFILE_LIST: 'profile:list',
  PROFILE_CREATE: 'profile:create',
  PROFILE_UPDATE: 'profile:update',
  PROFILE_DELETE: 'profile:delete',
  PROFILE_LAUNCH: 'profile:launch',

  SESSION_LIST: 'session:list',
  SESSION_CLOSE: 'session:close',

  BATCH_PREVIEW_PROFILES_DIALOG: 'batch:preview-profiles-dialog',
  BATCH_COMMIT_PROFILE_IMPORT: 'batch:commit-profile-import'
});

const VALID_PROXY_TYPES = new Set(['HTTP', 'SOCKS5']);
const VALID_SYSTEM_PROXY_BEHAVIORS = new Set(['DIRECT', 'PROFILE_PROXY', 'SYSTEM_PROXY']);

let registered = false;
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
    profileCount: proxy._count?.profiles ?? undefined
  };
}

function serializeProfile(profile) {
  return {
    id: profile.id,
    title: profile.title,
    proxyId: profile.proxyId,
    proxyInfoString: profile.proxyInfoString,
    notes: profile.notes,
    tagManagement: profile.tagManagement,
    systemProxyBehavior: profile.systemProxyBehavior,
    dataDirName: profile.dataDirName,
    createdAt: profile.createdAt instanceof Date ? profile.createdAt.toISOString() : profile.createdAt,
    proxy: serializeProxy(profile.proxy)
  };
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

async function listProfiles(payload = {}) {
  const db = getPrisma();
  const search = optionalString(payload.search);
  const where = search
    ? { OR: [{ title: { contains: search } }, { notes: { contains: search } }, { dataDirName: { contains: search } }, { proxyInfoString: { contains: search } }] }
    : undefined;

  const profiles = await db.profile.findMany({ where, orderBy: { createdAt: 'desc' }, include: { proxy: true } });
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
      tagManagement: parseBooleanInt(input.tagManagement),
      systemProxyBehavior: validateSystemProxyBehavior(input.systemProxyBehavior),
      dataDirName
    },
    include: { proxy: true }
  });

  return serializeProfile(created);
}

async function updateProfile(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const existing = await db.profile.findUnique({ where: { id }, include: { proxy: true } });
  if (!existing) throw new Error('Profile not found.');

  const data = {};
  if (input.title !== undefined) data.title = requiredString(input.title, 'Profile title');
  if (input.notes !== undefined) data.notes = optionalString(input.notes);
  if (input.tagManagement !== undefined) data.tagManagement = parseBooleanInt(input.tagManagement);
  if (input.systemProxyBehavior !== undefined) data.systemProxyBehavior = validateSystemProxyBehavior(input.systemProxyBehavior);

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

  const updated = await db.profile.update({ where: { id }, data, include: { proxy: true } });
  return serializeProfile(updated);
}

async function deleteProfile(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const removeLocalData = Boolean(input.removeLocalData);
  const existing = await db.profile.findUnique({ where: { id } });
  if (!existing) throw new Error('Profile not found.');

  await db.profile.delete({ where: { id } });

  if (removeLocalData) {
    const dataDir = resolveProfileDataDir(existing.dataDirName);
    await fs.rm(dataDir, { recursive: true, force: true });
  }

  return { deleted: true, id, removedLocalData: removeLocalData };
}

async function launchProfile(payload) {
  const input = requireObject(payload);
  const db = getPrisma();
  const id = parseId(input.id);
  const profile = await db.profile.findUnique({ where: { id }, include: { proxy: true } });
  if (!profile) throw new Error('Profile not found.');

  const { profileRoot } = getRuntimeConfig();
  const useProfileProxy = profile.systemProxyBehavior === 'PROFILE_PROXY';

  return launchProfileSession({
    profileId: profile.id,
    title: profile.title,
    dataDirName: profile.dataDirName,
    proxy: useProfileProxy ? profile.proxy : null,
    proxyInfoString: useProfileProxy ? profile.proxyInfoString : null,
    startUrl: input.startUrl || 'about:blank',
    profileRoot,
    headless: false,
    windowSize: { width: 1280, height: 720 }
  });
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
          tagManagement: parseBooleanInt(item.tagManagement),
          systemProxyBehavior: parseSystemProxyBehavior(item.systemProxyBehavior, 'DIRECT'),
          dataDirName
        },
        include: { proxy: true }
      });

      result.createdProfiles.push(serializeProfile(profile));
    } catch (error) {
      result.errors.push({ row: item.row, message: error instanceof Error ? error.message : 'Unknown import error' });
    }
  }

  importPreviewCache.delete(token);
  return result;
}

async function getSystemInfo() {
  const { dbPath, profileRoot } = getRuntimeConfig();
  return { dbPath, profileRoot, databaseUrlConfigured: Boolean(process.env.DATABASE_URL) };
}

function registerIpcHandlers() {
  if (registered) return;

  registerHandler(CHANNELS.SYSTEM_GET_INFO, getSystemInfo);

  registerHandler(CHANNELS.PROXY_LIST, listProxies);
  registerHandler(CHANNELS.PROXY_CREATE, createProxy);
  registerHandler(CHANNELS.PROXY_UPDATE, updateProxy);
  registerHandler(CHANNELS.PROXY_DELETE, deleteProxy);
  registerHandler(CHANNELS.PROXY_BATCH_ADD, batchAddProxies);

  registerHandler(CHANNELS.PROFILE_LIST, listProfiles);
  registerHandler(CHANNELS.PROFILE_CREATE, createProfile);
  registerHandler(CHANNELS.PROFILE_UPDATE, updateProfile);
  registerHandler(CHANNELS.PROFILE_DELETE, deleteProfile);
  registerHandler(CHANNELS.PROFILE_LAUNCH, launchProfile);

  registerHandler(CHANNELS.SESSION_LIST, () => listActiveSessions());
  registerHandler(CHANNELS.SESSION_CLOSE, closeSession);

  registerHandler(CHANNELS.BATCH_PREVIEW_PROFILES_DIALOG, previewProfilesViaDialog);
  registerHandler(CHANNELS.BATCH_COMMIT_PROFILE_IMPORT, commitProfileImport);

  registered = true;
}

async function shutdownIpcHandlers() {
  await closeAllProfileSessions();
  await disconnectPrisma();
}

module.exports = {
  CHANNELS,
  registerIpcHandlers,
  shutdownIpcHandlers
};
