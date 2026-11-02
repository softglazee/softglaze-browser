'use strict';

// Proxy.password is sealed at rest (secretStore). Sealing is not deterministic, so uniqueness of rows
// differing only by password rides on passwordHash, a keyed HMAC-SHA256. extendClient() seals writes,
// rewrites password filters to the hash and opens reads (nested too); passwordHash is never returned.

const crypto = require('node:crypto');
const secretStore = require('./secretStore');

const KEY_SETTING = 'proxyPasswordHashKey';
let keyPromise = null;

function hashWithKey(key, plain) {
  if (plain === null || plain === undefined) return null;
  return crypto.createHmac('sha256', key).update(String(plain), 'utf8').digest('hex');
}

// Loads or creates the per-install HMAC key, memoised per database; database.js calls
// resetHashKeyCache() when it drops the client, since a restored DB carries its own key.
// `created` means a new key was minted, so the migration recomputes every hash.
function loadHashKey(db) {
  if (!keyPromise) {
    keyPromise = (async () => {
      const row = await db.setting.findUnique({ where: { key: KEY_SETTING } });
      if (row) {
        let opened = '';
        let wasPlain = false;
        try {
          const parsed = JSON.parse(row.value);
          // Fallback form written when OS encryption was unavailable (below).
          if (parsed && typeof parsed.plain === 'string') { opened = parsed.plain; wasPlain = true; }
          else opened = secretStore.open(parsed);
        } catch (e) { opened = ''; }
        if (typeof opened === 'string' && /^[0-9a-f]{64}$/.test(opened)) {
          // If it was stored unsealed and encryption is back, upgrade it to sealed.
          if (wasPlain) {
            try {
              const v = JSON.stringify(secretStore.seal(opened));
              await db.setting.update({ where: { key: KEY_SETTING }, data: { value: v } });
            } catch (e) { /* still no encryption; keep the plain key */ }
          }
          return { key: Buffer.from(opened, 'hex'), created: false };
        }
      }
      const key = crypto.randomBytes(32);
      let value;
      // The HMAC key only keys the dedup hash, and without OS encryption passwords stay plaintext anyway,
      // so store the key unsealed rather than fail to hash.
      try { value = JSON.stringify(secretStore.seal(key.toString('hex'))); }
      catch (e) { value = JSON.stringify({ plain: key.toString('hex') }); }
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

// Copy of a proxy write payload with the password sealed and passwordHash set. A caller-supplied
// passwordHash is never trusted (it may use another install's key); it is recomputed or dropped.
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

// Equality on `password` (string or null) becomes equality on passwordHash. Other operators on the
// sealed column would be meaningless; nothing in the app filters proxies that way.
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

// Idempotent conversion of stored proxy passwords; raw SQL so it sees stored, not opened, values.
// Plaintext rows are sealed and hashed, sealed rows get a missing hash, NULL is untouched. Updates are
// guarded on the value read so concurrent edits win; failed rows stay as they were until next start.
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
  const rows = await db.$queryRawUnsafe('SELECT "id" AS "id", "password" AS "password", "passwordHash" AS "passwordHash" FROM "Proxy" WHERE "password" IS NOT NULL');
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
  const rows = await db.$queryRawUnsafe('SELECT "id" AS "id", "name" AS "name", "password" AS "password" FROM "Proxy" WHERE "password" LIKE ?', 'enc:v1:%');
  return rows.filter((r) => secretStore.open(r.password) === '').map((r) => ({ id: r.id, name: r.name }));
}

module.exports = {
  listUnreadableProxyPasswords,
  extendClient,
  migrateProxyPasswords,
  hashPassword,
  loadHashKey,
  resetHashKeyCache,
  // exported for tests
  hashWithKey,
};
