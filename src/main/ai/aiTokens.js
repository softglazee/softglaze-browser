'use strict';
// Tokens for SoftGlaze AI (`sgai_` + 40 random characters) and the Developer API (`sg_`). Only the
// SHA-256 hash is stored; the plain value is returned once, at creation. Each token acts as one
// member and carries a scope, an optional group limit, an optional expiry and, for unattended
// automation, a short list of pre-approved tools with per-call and per-hour caps.
//
// The database is passed in (a Prisma client or a test double), so this file has no Electron or
// app imports and is unit-tested directly.
const crypto = require('node:crypto');

const AI_PREFIX = 'sgai_';
const API_PREFIX = 'sg_';
const AI_TOKEN_CHARS = 40;
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SCOPES = Object.freeze(['read', 'operate', 'full']);
const SCOPE_RANK = Object.freeze({ read: 1, operate: 2, full: 3 });
const EXPIRY_CHOICES = Object.freeze([7, 30, 90]);
const MAX_EXPIRY_DAYS = 3650;
const PRE_APPROVED_DEFAULTS = Object.freeze({ maxProfilesPerCall: 5, maxCallsPerHour: 60 });
// lastUsedAt / lastClientName are written at most this often per token.
const TOUCH_EVERY_MS = 30 * 1000;

function randomBase62(n) {
  let out = '';
  for (let i = 0; i < n; i += 1) out += BASE62[crypto.randomInt(BASE62.length)];
  return out;
}

function generateToken(kind = 'ai') {
  if (kind === 'api') return `${API_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
  return `${AI_PREFIX}${randomBase62(AI_TOKEN_CHARS)}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function looksLikeToken(value) {
  const s = String(value || '');
  return new RegExp(`^${AI_PREFIX}[A-Za-z0-9]{${AI_TOKEN_CHARS}}$`).test(s) || /^sg_[A-Za-z0-9_-]{20,}$/.test(s);
}

function scopeAllows(tokenScope, needed) {
  return (SCOPE_RANK[tokenScope] || 0) >= (SCOPE_RANK[needed] || 99);
}

function parseJsonArray(value) {
  if (!value) return [];
  try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

function groupIdsOf(row) {
  return parseJsonArray(row && row.groupIdsJson).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
}

function preApprovedOf(row) {
  if (!row || !row.preApprovedJson) return null;
  try {
    const v = JSON.parse(row.preApprovedJson);
    if (!v || !Array.isArray(v.tools) || !v.tools.length) return null;
    return {
      tools: v.tools.map(String),
      maxProfilesPerCall: Number(v.maxProfilesPerCall) || PRE_APPROVED_DEFAULTS.maxProfilesPerCall,
      maxCallsPerHour: Number(v.maxCallsPerHour) || PRE_APPROVED_DEFAULTS.maxCallsPerHour
    };
  } catch (e) { return null; }
}

const iso = (d) => (d instanceof Date ? d.toISOString() : (d || null));

function isExpired(row, now = Date.now()) {
  return Boolean(row && row.expiresAt && new Date(row.expiresAt).getTime() <= now);
}

function isRevoked(row) {
  return Boolean(row && row.revokedAt);
}

function positiveInt(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

// Validates the AI page's create input. `allowedPreApprovedTools` is the registry's list of tools
// that may be pre-approved (operate scope, never Expert, never anything on the never-exposed list).
function normalizeCreateInput(input, { allowedPreApprovedTools = [], callerIsOwner = true } = {}) {
  const src = (input && typeof input === 'object') ? input : {};
  const name = String(src.name == null ? '' : src.name).trim().slice(0, 80);
  if (!name) throw new Error('Give the token a name, for example "Claude Desktop on my PC".');
  const scope = String(src.scope || 'read').toLowerCase();
  if (!SCOPES.includes(scope)) throw new Error('Scope must be read, operate or full.');
  let memberId = null;
  if (src.memberId !== undefined && src.memberId !== null && src.memberId !== '') memberId = positiveInt(src.memberId, 'memberId');
  let expiresInDays = null;
  if (src.expiresInDays !== undefined && src.expiresInDays !== null && src.expiresInDays !== '') {
    expiresInDays = positiveInt(src.expiresInDays, 'Expiry (days)', { max: MAX_EXPIRY_DAYS });
  }
  const groupIds = Array.isArray(src.groupIds)
    ? [...new Set(src.groupIds.map((g) => positiveInt(g, 'Group id')))]
    : [];

  let preApproved = null;
  const tools = Array.isArray(src.preApprovedTools) ? [...new Set(src.preApprovedTools.map(String))] : [];
  if (tools.length) {
    if (!callerIsOwner) throw new Error('Only the Owner can pre-approve tools for a token.');
    if (scope === 'read') throw new Error('Pre-approved tools need the operate scope.');
    if (!groupIds.length) throw new Error('A token with pre-approved tools must be limited to one or more groups.');
    const allowed = new Set(allowedPreApprovedTools);
    const bad = tools.filter((t) => !allowed.has(t));
    if (bad.length) throw new Error(`These tools cannot be pre-approved: ${bad.join(', ')}.`);
    preApproved = {
      tools,
      maxProfilesPerCall: src.maxProfilesPerCall == null || src.maxProfilesPerCall === ''
        ? PRE_APPROVED_DEFAULTS.maxProfilesPerCall
        : positiveInt(src.maxProfilesPerCall, 'Profiles per call', { max: 50 }),
      maxCallsPerHour: src.maxCallsPerHour == null || src.maxCallsPerHour === ''
        ? PRE_APPROVED_DEFAULTS.maxCallsPerHour
        : positiveInt(src.maxCallsPerHour, 'Calls per hour', { max: 1000 })
    };
  }
  return { name, scope, memberId, expiresInDays, groupIds, preApproved };
}

// Creates a token row and returns { id, token } with the plain token, the only time it exists.
async function createToken(db, input, { kind = 'ai', createdById = null, now = Date.now(), allowedPreApprovedTools, callerIsOwner } = {}) {
  const n = normalizeCreateInput(input, { allowedPreApprovedTools, callerIsOwner });
  const token = generateToken(kind);
  const row = await db.apiToken.create({
    data: {
      name: n.name,
      tokenHash: hashToken(token),
      kind,
      memberId: n.memberId,
      scope: n.scope,
      groupIdsJson: n.groupIds.length ? JSON.stringify(n.groupIds) : null,
      expiresAt: n.expiresInDays ? new Date(now + n.expiresInDays * 24 * 60 * 60 * 1000) : null,
      createdById: createdById == null ? null : Number(createdById),
      preApprovedJson: n.preApproved ? JSON.stringify(n.preApproved) : null
    }
  });
  return { id: row.id, token };
}

// Public view of a token row: never the hash. `memberNames` maps member id -> name.
function serializeToken(row, memberNames = new Map(), now = Date.now()) {
  const pre = preApprovedOf(row);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind || 'api',
    memberId: row.memberId == null ? null : row.memberId,
    memberName: row.memberId == null ? 'Workspace owner' : (memberNames.get(row.memberId) || 'Removed member'),
    scope: row.scope || 'read',
    groupIds: groupIdsOf(row),
    createdAt: iso(row.createdAt),
    expiresAt: iso(row.expiresAt),
    lastUsedAt: iso(row.lastUsedAt),
    lastClientName: row.lastClientName || null,
    revoked: isRevoked(row),
    expired: isExpired(row, now),
    preApprovedTools: pre ? pre.tools : [],
    maxProfilesPerCall: pre ? pre.maxProfilesPerCall : null,
    maxCallsPerHour: pre ? pre.maxCallsPerHour : null
  };
}

async function listTokens(db, { kind = 'ai', now = Date.now() } = {}) {
  const rows = await db.apiToken.findMany({ where: kind ? { kind } : undefined, orderBy: { createdAt: 'desc' } });
  const ids = [...new Set(rows.map((r) => r.memberId).filter((x) => x != null))];
  const members = ids.length ? await db.member.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(members.map((m) => [m.id, m.name]));
  return rows.map((r) => serializeToken(r, names, now));
}

async function revokeToken(db, id, { now = Date.now() } = {}) {
  const tokenId = positiveInt(id, 'Token id');
  const row = await db.apiToken.findUnique({ where: { id: tokenId } });
  if (!row) throw new Error('Token not found.');
  if (!row.revokedAt) await db.apiToken.update({ where: { id: tokenId }, data: { revokedAt: new Date(now) } });
  return { ok: true };
}

// Resolves a presented Bearer value to its row. Returns { ok: true, row } or
// { ok: false, status, code, message } with a message safe to show the caller.
async function verifyToken(db, presented, { now = Date.now(), kinds = null } = {}) {
  const value = String(presented || '').trim();
  if (!value) return { ok: false, status: 401, code: 'NO_TOKEN', message: 'A Bearer token is required. Create one on the SoftGlaze AI page.' };
  let row = null;
  try { row = await db.apiToken.findUnique({ where: { tokenHash: hashToken(value) } }); }
  catch (e) { return { ok: false, status: 503, code: 'DB_UNAVAILABLE', message: 'SoftGlaze could not read its tokens. Unlock the workspace and try again.' }; }
  if (!row) return { ok: false, status: 401, code: 'BAD_TOKEN', message: 'This token is not valid.' };
  if (isRevoked(row)) return { ok: false, status: 401, code: 'REVOKED', message: 'This token was revoked. Create a new one on the SoftGlaze AI page.' };
  if (isExpired(row, now)) return { ok: false, status: 401, code: 'EXPIRED', message: 'This token has expired. Create a new one on the SoftGlaze AI page.' };
  if (kinds && !kinds.includes(row.kind || 'api')) {
    return { ok: false, status: 403, code: 'WRONG_KIND', message: 'This token is a Developer API token. AI apps need a token from the SoftGlaze AI page.' };
  }
  return { ok: true, row };
}

// Records last use and the client name, at most once per TOUCH_EVERY_MS per token unless the
// client name changed. Never throws.
const lastTouch = new Map();
async function touchToken(db, row, clientName, now = Date.now()) {
  if (!row) return;
  const prev = lastTouch.get(row.id);
  const name = clientName ? String(clientName).slice(0, 80) : null;
  if (prev && now - prev.at < TOUCH_EVERY_MS && (!name || name === prev.name)) return;
  lastTouch.set(row.id, { at: now, name: name || (prev && prev.name) || null });
  const data = { lastUsedAt: new Date(now) };
  if (name) data.lastClientName = name;
  try { await db.apiToken.update({ where: { id: row.id }, data }); } catch (e) { /* best-effort */ }
}

module.exports = {
  AI_PREFIX,
  API_PREFIX,
  AI_TOKEN_CHARS,
  SCOPES,
  SCOPE_RANK,
  EXPIRY_CHOICES,
  PRE_APPROVED_DEFAULTS,
  generateToken,
  hashToken,
  looksLikeToken,
  scopeAllows,
  groupIdsOf,
  preApprovedOf,
  isExpired,
  isRevoked,
  normalizeCreateInput,
  createToken,
  serializeToken,
  listTokens,
  revokeToken,
  verifyToken,
  touchToken
};
