'use strict';

// Audit L11 (7 Oct): proxy passwords were stored in plaintext in SQLite.
// Now: Proxy.password is sealed (secretStore enc:v1:), uniqueness moves to a keyed
// HMAC in Proxy.passwordHash, a Prisma client extension seals on write / opens on
// read, and a startup data migration converts existing rows idempotently.
// These tests run the REAL Prisma client against a throwaway SQLite file in a temp
// folder (never the owner's %APPDATA% database), with a fake safeStorage.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'src', 'main');
const MIGRATION = path.join(ROOT, 'prisma', 'migrations', '20261007000000_proxy_password_hash', 'migration.sql');

// Reversible fake of Electron's safeStorage (DPAPI stand-in).
const fakeSafeStorage = {
  available: true,
  isEncryptionAvailable() { return this.available; },
  encryptString(s) { return Buffer.from('FAKE' + Buffer.from(String(s), 'utf8').toString('hex'), 'utf8'); },
  decryptString(buf) {
    const t = buf.toString('utf8');
    if (!t.startsWith('FAKE')) throw new Error('bad blob');
    return Buffer.from(t.slice(4), 'hex').toString('utf8');
  }
};

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-proxyseal-'));
const elPath = require.resolve('electron');
const prevElectron = require.cache[elPath];
require.cache[elPath] = {
  id: elPath, filename: elPath, loaded: true,
  exports: { app: { isPackaged: false, getPath: () => userData }, safeStorage: fakeSafeStorage }
};
for (const m of ['database', 'secretStore', 'proxySecrets']) delete require.cache[path.join(MAIN, m + '.js')];
const prevDbUrl = process.env.DATABASE_URL;
// Pin the database to the temp folder BEFORE @prisma/client loads: an unset
// DATABASE_URL would let Prisma pick up the repo .env (file:./softglaze.sqlite).
process.env.DATABASE_URL = `file:${path.join(userData, 'softglaze.sqlite').replace(/\\/g, '/')}`;

const database = require(path.join(MAIN, 'database.js'));
const secretStore = require(path.join(MAIN, 'secretStore.js'));
const proxySecrets = require(path.join(MAIN, 'proxySecrets.js'));

const quietLog = { lines: [], error(...a) { this.lines.push(a.join(' ')); }, log() {} };

let db;
let prismaUsable = true;
test.before(async () => {
  assert.ok(process.env.DATABASE_URL.includes(userData.split(path.sep).join('/')), 'tests must only ever open the temp database');
  try {
    await database.bootstrapDatabase();
    db = database.getPrisma();
  } catch (e) {
    prismaUsable = false;
    console.warn('[proxyPasswordSeal.test] Prisma engine unavailable, DB tests skipped:', e.message);
  }
});

test.after(async () => {
  try { await database.disconnectPrisma(); } catch (e) { /* noop */ }
  if (prevElectron) require.cache[elPath] = prevElectron; else delete require.cache[elPath];
  for (const m of ['database', 'secretStore', 'proxySecrets']) delete require.cache[path.join(MAIN, m + '.js')];
  if (prevDbUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevDbUrl;
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { /* noop */ }
});

const rawRow = async (id) => (await db.$queryRawUnsafe('SELECT "password", "passwordHash" FROM "Proxy" WHERE "id" = ?', id))[0];

test('secretStore seal/open round trip', () => {
  const sealed = secretStore.seal('s3cr:et@pw');
  assert.ok(secretStore.isSealed(sealed));
  assert.ok(!sealed.includes('s3cr:et@pw'));
  assert.equal(secretStore.open(sealed), 's3cr:et@pw');
  assert.equal(secretStore.seal(sealed), sealed, 'sealing twice is a no-op');
  assert.equal(secretStore.open('legacy-plain'), 'legacy-plain', 'plaintext passes through');
});

test('writes seal the password and set a keyed hash; reads (top level and nested) get plaintext', async (t) => {
  if (!prismaUsable) return t.skip('no Prisma engine');
  const p = await db.proxy.create({ data: { name: 'a', type: 'HTTP', host: 'gw.example', port: 8000, username: 'u', password: 'pw-1' } });
  assert.equal(p.password, 'pw-1', 'create returns the opened password');
  assert.equal(p.passwordHash, undefined, 'the hash is never handed back');
  const raw = await rawRow(p.id);
  assert.ok(secretStore.isSealed(raw.password), 'stored sealed, not plaintext');
  const { key } = await proxySecrets.loadHashKey(db);
  assert.equal(raw.passwordHash, crypto.createHmac('sha256', key).update('pw-1').digest('hex'));

  assert.equal((await db.proxy.findUnique({ where: { id: p.id } })).password, 'pw-1');
  assert.equal((await db.proxy.findMany({ where: { id: p.id } }))[0].password, 'pw-1');
  assert.equal((await db.proxy.findUnique({ where: { id: p.id }, select: { password: true } })).password, 'pw-1');

  // The launch path loads the profile with include: { proxy: true } (launchProfileSession,
  // checks, export) - the nested proxy must arrive opened as well.
  const prof = await db.profile.create({ data: { title: 'seal-test', dataDirName: 'seal-test-dir', proxyId: p.id }, include: { proxy: true } });
  assert.equal(prof.proxy.password, 'pw-1');
  const again = await db.profile.findUnique({ where: { id: prof.id }, include: { proxy: true } });
  assert.equal(again.proxy.password, 'pw-1');
  assert.equal(again.proxy.passwordHash, undefined);

  const upd = await db.proxy.update({ where: { id: p.id }, data: { password: 'pw-2' } });
  assert.equal(upd.password, 'pw-2');
  const raw2 = await rawRow(p.id);
  assert.ok(secretStore.isSealed(raw2.password));
  assert.equal(raw2.passwordHash, proxySecrets.hashWithKey(key, 'pw-2'));
  assert.equal(secretStore.open(raw2.password), 'pw-2');

  await db.proxy.update({ where: { id: p.id }, data: { password: null } });
  assert.deepEqual(await rawRow(p.id), { password: null, passwordHash: null });
  await db.proxy.update({ where: { id: p.id }, data: { password: 'pw-1' } });
});

test('the unique key holds via passwordHash; rows differing only by password coexist', async (t) => {
  if (!prismaUsable) return t.skip('no Prisma engine');
  const base = { type: 'HTTP', host: 'rot.example', port: 9000, username: 'sticky' };
  await db.proxy.create({ data: { ...base, name: 's1', password: 'sess-1' } });
  await db.proxy.create({ data: { ...base, name: 's2', password: 'sess-2' } });
  await assert.rejects(
    db.proxy.create({ data: { ...base, name: 'dup', password: 'sess-1' } }),
    (e) => e.code === 'P2002'
  );
  // Equality filters on password are rewritten to the hash (vendor sync dedupe).
  const hit = await db.proxy.findFirst({ where: { ...base, password: 'sess-2' } });
  assert.equal(hit.name, 's2');
  assert.equal(await db.proxy.findFirst({ where: { ...base, password: 'nope' } }), null);
  const byHash = await db.proxy.findFirst({ where: { ...base, passwordHash: await proxySecrets.hashPassword(db, 'sess-1') } });
  assert.equal(byHash.name, 's1');
});

test('data migration: mixed sealed/plain rows, idempotent, empty-safe, never loses a password', async (t) => {
  if (!prismaUsable) return t.skip('no Prisma engine');
  const ins = (name, pw, hash) => db.$executeRawUnsafe(
    'INSERT INTO "Proxy" ("name","type","host","port","username","password","passwordHash") VALUES (?,?,?,?,?,?,?)',
    name, 'SOCKS5', 'legacy.example', 1080, name, pw, hash);
  await ins('plain-a', 'legacy:pa$$', null);
  await ins('plain-empty', '', null);
  await ins('nullpw', null, null);
  await ins('sealed-nohash', secretStore.seal('was-sealed'), null);
  await ins('sealed-foreign', 'enc:v1:' + Buffer.from('not-ours').toString('base64'), null);

  const first = await proxySecrets.migrateProxyPasswords(db, quietLog);
  assert.ok(first.sealed >= 1 && first.failed === 0, JSON.stringify(first));
  const rows = await db.$queryRawUnsafe('SELECT "name","password","passwordHash" FROM "Proxy" WHERE "host" = ?', 'legacy.example');
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  const { key } = await proxySecrets.loadHashKey(db);
  assert.ok(secretStore.isSealed(by['plain-a'].password));
  assert.equal(secretStore.open(by['plain-a'].password), 'legacy:pa$$');
  assert.equal(by['plain-a'].passwordHash, proxySecrets.hashWithKey(key, 'legacy:pa$$'));
  assert.equal(by['plain-empty'].password, '');
  assert.equal(by['plain-empty'].passwordHash, proxySecrets.hashWithKey(key, ''));
  assert.deepEqual([by.nullpw.password, by.nullpw.passwordHash], [null, null]);
  assert.equal(by['sealed-nohash'].passwordHash, proxySecrets.hashWithKey(key, 'was-sealed'));
  assert.ok(by['sealed-foreign'].password.startsWith('enc:v1:'), 'an unopenable blob is kept as is');
  assert.equal(by['sealed-foreign'].passwordHash, null);

  const second = await proxySecrets.migrateProxyPasswords(db, quietLog);
  assert.equal(second.sealed, 0);
  assert.equal(second.hashed, 0);
  assert.equal(second.failed, 0);
  const rows2 = await db.$queryRawUnsafe('SELECT "name","password","passwordHash" FROM "Proxy" WHERE "host" = ?', 'legacy.example');
  assert.deepEqual(rows2, rows, 'a second run changes nothing');

  // The app reads the converted row as plaintext.
  assert.equal((await db.proxy.findFirst({ where: { name: 'plain-a' } })).password, 'legacy:pa$$');
  assert.equal((await db.proxy.findFirst({ where: { name: 'sealed-foreign' } })).password, '', 'unopenable reads as absent, never the blob');
  assert.ok(!quietLog.lines.join('\n').includes('legacy:pa$$'), 'logs never carry a password');
  // A backup restored under another Windows user leaves blobs that no longer open; the
  // restore warning lists them by name (audit S5 + L11).
  const dead = await proxySecrets.listUnreadableProxyPasswords(db);
  assert.deepEqual(dead.map((d) => d.name), ['sealed-foreign']);
});

test('data migration keeps plaintext and still hashes when OS encryption is unavailable', async (t) => {
  if (!prismaUsable) return t.skip('no Prisma engine');
  await db.$executeRawUnsafe('INSERT INTO "Proxy" ("name","type","host","port","username","password") VALUES (?,?,?,?,?,?)', 'noenc', 'HTTP', 'noenc.example', 1, 'x', 'keep-me');
  fakeSafeStorage.available = false;
  try {
    const log = { lines: [], error(...a) { this.lines.push(a.join(' ')); }, log() {} };
    const r = await proxySecrets.migrateProxyPasswords(db, log);
    assert.equal(r.failed, 0);
  } finally { fakeSafeStorage.available = true; }
  const row = (await db.$queryRawUnsafe('SELECT "password","passwordHash" FROM "Proxy" WHERE "name" = ?', 'noenc'))[0];
  assert.equal(row.password, 'keep-me', 'never lost');
  assert.ok(row.passwordHash);
  await proxySecrets.migrateProxyPasswords(db, quietLog);
  const row2 = (await db.$queryRawUnsafe('SELECT "password" FROM "Proxy" WHERE "name" = ?', 'noenc'))[0];
  assert.equal(secretStore.open(row2.password), 'keep-me', 'sealed on the next run once encryption is back');
});

test('the migration swaps the unique index from password to passwordHash', (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { return t.skip('node:sqlite unavailable'); }
  const sdb = new DatabaseSync(':memory:');
  sdb.exec('CREATE TABLE "Proxy" ("id" INTEGER PRIMARY KEY, "type" TEXT, "host" TEXT, "port" INTEGER, "username" TEXT, "password" TEXT)');
  sdb.exec('CREATE UNIQUE INDEX "Proxy_type_host_port_username_password_key" ON "Proxy"("type","host","port","username","password")');
  sdb.exec('INSERT INTO "Proxy" VALUES (1,\'HTTP\',\'h\',1,\'u\',\'p\')');
  const sql = fs.readFileSync(MIGRATION, 'utf8').split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const s of sql.split(';').map((x) => x.trim()).filter(Boolean)) sdb.exec(s + ';');
  const idx = sdb.prepare('SELECT name FROM sqlite_master WHERE type=\'index\' AND tbl_name=\'Proxy\'').all().map((r) => r.name);
  assert.ok(idx.includes('Proxy_type_host_port_username_passwordHash_key'));
  assert.ok(!idx.includes('Proxy_type_host_port_username_password_key'));
  assert.equal(sdb.prepare('SELECT "password" FROM "Proxy" WHERE id = 1').get().password, 'p', 'no row touched');
});

test('every proxy read path goes through the sealing client', () => {
  const dbSrc = fs.readFileSync(path.join(MAIN, 'database.js'), 'utf8');
  assert.match(dbSrc, /prisma = proxySecrets\.extendClient\(new PrismaClient\(/);
  assert.match(dbSrc, /await proxySecrets\.migrateProxyPasswords\(db\)/);
  assert.match(dbSrc, /proxySecrets\.resetHashKeyCache\(\)/);
  // No other Prisma client and no raw SQL read of the Proxy table outside proxySecrets,
  // so the launch path (browserEngine/firefoxEngine get the proxy object from
  // ipcHandlers), the checks, export and reveal all see opened plaintext.
  for (const f of fs.readdirSync(MAIN).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(MAIN, f), 'utf8');
    if (f !== 'database.js') assert.ok(!/new PrismaClient\(/.test(src), `${f} must not create its own PrismaClient`);
    if (f !== 'proxySecrets.js') assert.ok(!/FROM\s+"?Proxy"?\b/.test(src), `${f} must not read Proxy with raw SQL`);
  }
  for (const f of ['browserEngine.js', 'firefoxEngine.js', 'socksRelay.js', 'httpRelay.js']) {
    const src = fs.readFileSync(path.join(MAIN, f), 'utf8');
    assert.ok(!/getPrisma\(\)\.proxy|\.proxy\.find/.test(src), `${f} reads proxies only from objects handed in`);
  }
});

test('vendor pool sync dedupes on passwordHash; the restore warning includes proxy passwords', () => {
  const ipc = fs.readFileSync(path.join(MAIN, 'ipcHandlers.js'), 'utf8');
  assert.match(ipc, /row\.dedupeOnPassword \? \{ passwordHash: await proxySecrets\.hashPassword\(db, row\.password\) \}/);
  assert.match(ipc, /proxySecrets\.listUnreadableProxyPasswords\(db\)/);
});
