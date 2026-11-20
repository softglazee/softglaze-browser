'use strict';
// Account sessions for the three clients (AuthSession rows; only SHA-256 hashes of tokens are stored):
//
//   desktop  one opaque token per sign-in on an install (POST /auth/exchange, /auth/email/verify). New sessions
//            expire 180 days after their last use (the app works offline and asks the server rarely, and an
//            ended session signs the workspace out). Rows made before this release have expiresAt NULL and
//            never expire, so nobody signed in today is signed out by the upgrade.
//   mobile   one opaque bearer token (the phone keeps it in secure storage), 30 days sliding on use, rotated by
//            POST /v1/mobile/auth/refresh. A MobileDevice row is tied to it (src/auth/mobile.js).
//   web      a short-lived access token (15 minutes) plus a refresh token that rotates on every use and keeps
//            the session alive for 30 days after its last use. A refresh token that was already rotated away
//            and is presented again ends the whole session (reuse detection, OAuth 2.0 Security BCP 4.14).
// Revoking a session also revokes its MobileDevice. Results are plain objects; routes turn them into responses.
const { randomToken, sha256Hex, isOpaqueToken } = require('./tokens');
const { ms } = require('../util/time');

const DAY = 86400000;
const TTL_MS = Object.freeze({ desktop: 180 * DAY, mobile: 30 * DAY, web: 30 * DAY });
const WEB_ACCESS_MS = 15 * 60000;
// A sliding session is written back at most this often (not on every request).
const SLIDE_EVERY_MS = 60 * 60000;
const KINDS = Object.freeze(['desktop', 'mobile', 'web']);

function cleanUserAgent(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 200) : null;
}

// -> { row, token, expiresAt, accessExpiresAt?, refreshToken? }. `token` is the bearer (desktop session, phone
// token, or web access token); every secret is shown once to the caller and only hashed here.
async function createSession(db, { tenantId, customer, identityId = null, provider, kind, clientId = null, installId = '', ipHash = null, userAgent = null, now = Date.now() }) {
  if (!KINDS.includes(kind)) throw new Error(`unknown session kind ${kind}`);
  const at = new Date(now);
  const token = randomToken(32);
  const expiresAt = new Date(now + TTL_MS[kind]);
  const data = {
    tenantId, customerId: customer.id, installId: installId || '', identityId, provider, emailKey: customer.emailKey,
    tokenHash: sha256Hex(token), ipHash, createdAt: at, lastUsedAt: at, kind, clientId, expiresAt, userAgent: cleanUserAgent(userAgent)
  };
  let refreshToken;
  if (kind === 'web') {
    refreshToken = randomToken(32);
    data.accessExpiresAt = new Date(now + WEB_ACCESS_MS);
    data.refreshHash = sha256Hex(refreshToken);
  }
  const row = await db.authSession.create({ data });
  return { row, token, expiresAt, accessExpiresAt: data.accessExpiresAt || null, refreshToken };
}

// Not revoked and not past its end (NULL = legacy desktop session without an end).
function isLive(row, now = Date.now()) {
  return Boolean(row) && !row.revokedAt && (!row.expiresAt || ms(row.expiresAt) > now);
}

// Moves a sliding session's end forward (desktop and mobile; web slides on refresh). Legacy rows stay as they are.
async function slide(db, row, now = Date.now()) {
  if (!row || !row.expiresAt || row.kind === 'web') return row;
  const last = row.lastUsedAt ? ms(row.lastUsedAt) : 0;
  if (now - last < SLIDE_EVERY_MS) return row;
  const data = { lastUsedAt: new Date(now), expiresAt: new Date(now + TTL_MS[row.kind || 'desktop']) };
  await db.authSession.update({ where: { id: row.id }, data }).catch(() => {});
  return { ...row, ...data };
}

// The live phone or web session of a bearer token, with its customer. kinds: which kinds are accepted.
// -> { session, customer } or null.
async function bearerSession(db, token, { kinds = ['mobile', 'web'], now = Date.now() } = {}) {
  if (!isOpaqueToken(token)) return null;
  const row = await db.authSession.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!row || !kinds.includes(row.kind || 'desktop') || !isLive(row, now)) return null;
  if (row.kind === 'web' && (!row.accessExpiresAt || ms(row.accessExpiresAt) <= now)) return null;
  const customer = await db.customer.findUnique({ where: { id: row.customerId } });
  if (!customer || customer.tenantId !== row.tenantId || customer.deletedAt) return null;
  let session = row;
  if (row.kind === 'web') {
    if (!row.lastUsedAt || now - ms(row.lastUsedAt) >= SLIDE_EVERY_MS) {
      await db.authSession.update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } }).catch(() => {});
    }
  } else {
    session = await slide(db, row, now);
  }
  return { session, customer };
}

// Reads the bearer token of a request (Authorization: Bearer <token>).
function bearerOf(req) {
  const h = req && req.headers ? req.headers.authorization : null;
  const m = typeof h === 'string' ? /^Bearer\s+([A-Za-z0-9_-]{43})$/.exec(h.trim()) : null;
  return m ? m[1] : null;
}

const INVALID_GRANT = { ok: false, status: 400, error: 'invalid_grant' };

// POST /v1/web/auth/token grant_type=refresh_token. -> { ok: true, row, token, refreshToken, expiresAt,
// accessExpiresAt } or INVALID_GRANT. A rotated-away refresh token presented again revokes the session.
async function refreshWeb(db, refreshToken, { clientId, now = Date.now() } = {}) {
  if (!isOpaqueToken(refreshToken)) return INVALID_GRANT;
  const hash = sha256Hex(refreshToken);
  const row = await db.authSession.findUnique({ where: { refreshHash: hash } });
  if (!row) {
    const replayed = await db.authSession.findFirst({ where: { prevRefreshHash: hash, kind: 'web' } });
    if (replayed && !replayed.revokedAt) await revokeSession(db, replayed, now);
    return INVALID_GRANT;
  }
  if (row.kind !== 'web' || row.clientId !== clientId || !isLive(row, now)) return INVALID_GRANT;
  const customer = await db.customer.findUnique({ where: { id: row.customerId } });
  if (!customer || customer.deletedAt) return INVALID_GRANT;
  const token = randomToken(32);
  const next = randomToken(32);
  const data = {
    tokenHash: sha256Hex(token), accessExpiresAt: new Date(now + WEB_ACCESS_MS), refreshHash: sha256Hex(next), prevRefreshHash: hash,
    expiresAt: new Date(now + TTL_MS.web), lastUsedAt: new Date(now)
  };
  // Only if the row still holds this refresh token: two refreshes at once cannot both win.
  const claim = await db.authSession.updateMany({ where: { id: row.id, refreshHash: hash, revokedAt: null }, data });
  if (claim.count !== 1) return INVALID_GRANT;
  return { ok: true, row: { ...row, ...data }, customer, token, refreshToken: next, expiresAt: data.expiresAt, accessExpiresAt: data.accessExpiresAt };
}

// POST /v1/mobile/auth/refresh: a new phone token for the same session (and the same MobileDevice); the old
// token stops working. -> { ok: true, row, token, expiresAt } or { ok: false, status: 401 }.
async function rotateMobile(db, token, { now = Date.now() } = {}) {
  const found = await bearerSession(db, token, { kinds: ['mobile'], now });
  if (!found) return { ok: false, status: 401, error: 'session_invalid' };
  const fresh = randomToken(32);
  const data = { tokenHash: sha256Hex(fresh), expiresAt: new Date(now + TTL_MS.mobile), lastUsedAt: new Date(now) };
  const claim = await db.authSession.updateMany({ where: { id: found.session.id, tokenHash: sha256Hex(token), revokedAt: null }, data });
  if (claim.count !== 1) return { ok: false, status: 401, error: 'session_invalid' };
  await db.mobileDevice.updateMany({ where: { authSessionId: found.session.id, revokedAt: null }, data: { lastSeenAt: new Date(now) } });
  return { ok: true, row: { ...found.session, ...data }, customer: found.customer, token: fresh, expiresAt: data.expiresAt };
}

async function revokeSession(db, row, now = Date.now()) {
  const at = new Date(now);
  const r = await db.authSession.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: at } });
  await db.mobileDevice.updateMany({ where: { authSessionId: row.id, revokedAt: null }, data: { revokedAt: at } });
  return r.count;
}

// Ends every live session of a customer (optionally only some kinds). -> the number ended.
async function revokeAll(db, tenantId, customerId, { kinds = null, now = Date.now() } = {}) {
  const where = { tenantId, customerId, revokedAt: null, ...(kinds ? { kind: { in: kinds } } : {}) };
  const rows = await db.authSession.findMany({ where });
  let n = 0;
  for (const row of rows) n += await revokeSession(db, row, now);
  return n;
}

// A session as the web app's "Where you're signed in" list shows it. Never a hash.
function publicSession(row, { currentId = null, device = null, now = Date.now() } = {}) {
  return {
    id: row.id,
    kind: row.kind || 'desktop',
    provider: row.provider,
    client: row.clientId || (row.kind === 'desktop' || !row.kind ? 'softglaze-desktop' : null),
    device: device ? { platform: device.platform, model: device.model || null, appVersion: device.appVersion || null } : null,
    userAgent: row.userAgent || null,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt || null,
    expiresAt: row.expiresAt || null,
    current: row.id === currentId,
    live: isLive(row, now)
  };
}

module.exports = {
  TTL_MS, WEB_ACCESS_MS, SLIDE_EVERY_MS, KINDS, createSession, isLive, slide, bearerSession, bearerOf, refreshWeb, rotateMobile,
  revokeSession, revokeAll, publicSession, cleanUserAgent
};
