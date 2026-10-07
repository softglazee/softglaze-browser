'use strict';

// Proxy passwords at rest (audit L11, 7 Oct).
//
// Proxy.password used to sit in SQLite in plaintext. It is now sealed with
// secretStore (enc:v1:, DPAPI / Keychain / libsecret) like every other stored
// credential. A sealed value is not deterministic, so it cannot carry the unique
// key that lets rotating vendors keep rows differing only by password; that job
// moves to Proxy.passwordHash, a keyed HMAC-SHA256 of the plaintext password.
// The HMAC key is random per install and stored sealed in the Setting table.
//
// One choke point instead of forty call sites: extendClient() wraps the Prisma
// client so that
//  - every proxy write (create / update / upsert / *Many) seals `password` and
//    sets `passwordHash` from the plaintext,
//  - every proxy filter on `password` equality is rewritten to `passwordHash`,
//  - every proxy read (top level AND nested `include: { proxy: true }`) returns
//    the OPENED password, so the launch path, the checks, export, reveal and the
//    renderer keep seeing plaintext exactly as before (never a sealed blob),
//  - `passwordHash` itself is never handed back to callers.
// migrateProxyPasswords() converts existing plaintext rows once, at startup.

const crypto = require('node:crypto');
const secretStore = require('./secretStore');

const KEY_SETTING = 'proxyPasswordHashKey';
let keyPromise = null;

function hashWithKey(key, plain) {
  if (plain === null || plain === undefined) return null;
  return crypto.createHmac('sha256', key).update(String(plain), 'utf8').digest('hex');
}

// Load (or create on first use) the per-install HMAC key. Memoised per database:
// database.js calls resetHashKeyCache() whenever it drops the client (restore,
// encryption toggle), because a restored DB carries its own key.
// `created` is true when this call had to mint a new key, which makes the data
// migration recompute every hash (a key that no longer opens, e.g. after a
// restore on another Windows user, invalidates the old hashes).
function loadHashKey(db) {
  if (!keyPromise) {
    keyPromise = (async () => {
      const row = await db.setting.findUnique({ where: { key: KEY_SETTING } });
      if (row) {
        let opened = '';
        try { opened = secretStore.open(JSON.parse(row.value)); } catch (e) { opened = ''; }
        if (typeof opened === 'string' && /^[0-9a-f]{64}$/.test(opened)) return { key: Buffer.from(opened, 'hex'), created: false };
      }
      const key = crypto.randomBytes(32);
      const value = JSON.stringify(secretStore.seal(key.toString('hex'))); // throws if OS encryption is unavailable
      await db.setting.upsert({ where: { key: KEY_SETTING }, update: { value }, create: { key: KEY_SETTING, value } });
      return { key, created: true };
    })();
    keyPromise.catch(() => { keyPromise = null; }); // retry next time instead of caching a failure
  }
  return keyPromise;
}

function resetHashKeyCache() { keyPromise = null; }

async function hashPassword(db, plain) {
  if (plain === null || plain === undefined) return null;
  const { key } = await loadHashKey(db);
  return hashWithKey(key, plain);
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Copy of a proxy write payload with the password sealed and passwordHash set.
// A caller-supplied passwordHash is never trusted (it may come from another
// install's key, e.g. a sync import); it is recomputed or dropped.
async function sealProxyData(data, getKey) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out = { ...data };
  delete out.passwordHash;
  if (!has(out, 'password')) return out;
  let v = out.password;
  if (v && typeof v === 'object' && has(v, 'set')) v = v.set; // Prisma's { set: x } form
  if (v === undefined) { delete out.password; return out; }
  if (v === null) { out.password = null; out.passwordHash = null; return out; }
  const wasSealed = secretStore.isSealed(v);
  const plain = wasSealed ? secretStore.open(v) : String(v);
  if (wasSealed && plain === '') { out.password = v; return out; } // cannot open here: keep the blob, no hash
  out.passwordHash = hashWithKey(await getKey(), plain);
  out.password = plain === '' ? '' : secretStore.seal(plain);
  return out;
}

function whereNeedsKey(where) {
  if (!where || typeof where !== 'object') return false;
  if (has(where, 'password') && (where.password === null || typeof where.password === 'string')) return true;
  return ['AND', 'OR', 'NOT'].some((k) => {
    const c = where[k];
    return Array.isArray(c) ? c.some(whereNeedsKey) : whereNeedsKey(c);
  });
}

// `password: 'x'` / `password: null` equality becomes `passwordHash: hmac(x)` / null.
// Other operators on the sealed column (contains, startsWith) would be meaningless
// and are left alone; nothing in the app filters proxies that way.
function rewriteWhere(where, key) {
  if (!where || typeof where !== 'object') return where;
  const out = { ...where };
  if (has(out, 'password') && (out.password === null || typeof out.password === 'string')) {
    out.passwordHash = out.password === null ? null : hashWithKey(key, out.password);
    delete out.password;
  }
  for (const k of ['AND', 'OR', 'NOT']) {
    if (Array.isArray(out[k])) out[k] = out[k].map((w) => rewriteWhere(w, key));
    else if (out[k] && typeof out[k] === 'object') out[k] = rewriteWhere(out[k], key);
  }
  return out;
}

// Open a stored value for callers. Plaintext (a legacy row the migration could not
// convert) passes through; a sealed value that cannot be opened reads as '' (absent).
function openPassword(value) {
  return secretStore.open(value);
}

async function prepareArgs(args, getKey) {
  if (!args || typeof args !== 'object') return args;
  const out = { ...args };
  if (out.where && whereNeedsKey(out.where)) out.where = rewriteWhere(out.where, await getKey());
  if (has(out, 'data')) {
    out.data = Array.isArray(out.data)
      ? await Promise.all(out.data.map((d) => sealProxyData(d, getKey)))
      : await sealProxyData(out.data, getKey);
  }
  if (has(out, 'create')) out.create = await sealProxyData(out.create, getKey);
  if (has(out, 'update')) out.update = await sealProxyData(out.update, getKey);
  return out;
}

function extendClient(base) {
  const getKey = async () => (await loadHashKey(base)).key;
  return base.$extends({
    name: 'proxyPasswordSeal',
    query: {
      proxy: {
        async $allOperations({ args, query }) {
          return query(await prepareArgs(args, getKey));
        }
      }
    },
    result: {
      proxy: {
        password: { needs: { password: true }, compute(p) { return openPassword(p.password); } },
        passwordHash: { needs: { passwordHash: true }, compute() { return undefined; } }
      }
    }
  });
}

function scrub(err, ...secrets) {
  let msg = String((err && err.message) || err || 'unknown error');
  for (const s of secrets) if (s) msg = msg.split(String(s)).join('[redacted]');
  return msg.replace(/enc:v1:[A-Za-z0-9+/=]+/g, 'enc:v1:[redacted]').slice(0, 300);
}

// One-time, idempotent conversion of stored proxy passwords. Raw SQL on purpose:
// it must see the stored value, not the opened one the extended client returns.
//  - plaintext row  -> password sealed + passwordHash set (verified round trip first)
//  - sealed row     -> passwordHash filled in if missing (or recomputed after a new key)
//  - NULL password  -> untouched
// The UPDATE is guarded on the value it read, so a concurrent edit is never overwritten.
// A failing row is logged (scrubbed) and left exactly as it was; the next start retries.
// Safe on an empty database and safe to run any number of times.
async function migrateProxyPasswords(db, log = console) {
  const summary = { sealed: 0, hashed: 0, skipped: 0, failed: 0 };
  let keyInfo;
  try {
    keyInfo = await loadHashKey(db);
  } catch (e) {
    log.error('[proxySecrets] no hash key, proxy passwords left as they are:', scrub(e));
    return { ...summary, error: 'NO_KEY' };
  }
  // A freshly minted key invalidates every stored hash: recompute them once.
  const rehashAll = keyInfo.created && !keyInfo.rehashed;
  keyInfo.rehashed = true;
  const canSeal = secretStore.isAvailable();
  if (!canSeal) log.error('[proxySecrets] OS encryption unavailable: proxy passwords stay unsealed until it is (hashes are still set)');
  const rows = await db.$queryRawUnsafe('SELECT "id", "password", "passwordHash" FROM "Proxy" WHERE "password" IS NOT NULL');
  for (const row of rows) {
    const stored = row.password;
    try {
      if (secretStore.isSealed(stored)) {
        if (row.passwordHash && !rehashAll) continue;
        const plain = secretStore.open(stored);
        if (plain === '') { summary.skipped += 1; continue; } // sealed for another user/machine: keep the blob
        await db.$executeRawUnsafe('UPDATE "Proxy" SET "passwordHash" = ? WHERE "id" = ? AND "password" = ?', hashWithKey(keyInfo.key, plain), row.id, stored);
        summary.hashed += 1;
        continue;
      }
      const plain = String(stored);
      const hash = hashWithKey(keyInfo.key, plain);
      if (plain === '' || !canSeal) {
        if (row.passwordHash === hash) continue;
        await db.$executeRawUnsafe('UPDATE "Proxy" SET "passwordHash" = ? WHERE "id" = ? AND "password" = ?', hash, row.id, stored);
        summary.hashed += 1;
        continue;
      }
      const sealed = secretStore.seal(plain);
      if (secretStore.open(sealed) !== plain) throw new Error('sealed value did not open back to the original');
      await db.$executeRawUnsafe('UPDATE "Proxy" SET "password" = ?, "passwordHash" = ? WHERE "id" = ? AND "password" = ?', sealed, hash, row.id, stored);
      summary.sealed += 1;
    } catch (e) {
      summary.failed += 1;
      log.error(`[proxySecrets] proxy ${row.id}: password left unchanged:`, scrub(e, stored));
    }
  }
  if (summary.sealed || summary.hashed || summary.failed) log.log('[proxySecrets] proxy password migration:', JSON.stringify(summary));
  return summary;
}

// Proxies whose stored password is sealed but no longer opens here (backup restored
// under another Windows user / machine). Ids and names only, never the values.
async function listUnreadableProxyPasswords(db) {
  const rows = await db.$queryRawUnsafe('SELECT "id", "name", "password" FROM "Proxy" WHERE "password" LIKE ?', 'enc:v1:%');
  return rows.filter((r) => secretStore.open(r.password) === '').map((r) => ({ id: r.id, name: r.name }));
}

module.exports = {
  listUnreadableProxyPasswords,
  KEY_SETTING,
  extendClient,
  migrateProxyPasswords,
  hashPassword,
  loadHashKey,
  resetHashKeyCache,
  openPassword,
  // exported for tests
  hashWithKey,
  sealProxyData,
  rewriteWhere
};
