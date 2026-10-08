'use strict';
// Audit L3: install credentials could be shared. installId + installSecret alone returned
// a lease on any number of machines. Each install is now bound to one machine hash (trust
// on first use), the lease carries it as `mid`, and moving it needs the tenant admin or a
// limited self-service transfer. Prisma is an in-memory fake; the real routers run over HTTP.
process.env.MASTER_KEY = require('node:crypto').randomBytes(32).toString('base64');
process.env.DATABASE_URL = 'mysql://test';

const test = require('node:test');
const assert = require('node:assert/strict');

function matches(row, where) {
  for (const [k, v] of Object.entries(where || {})) {
    if (v === null ? row[k] != null : row[k] !== v) return false;
  }
  return true;
}
function fakeDb() {
  const tables = { tenant: [], install: [], license: [], licenseCode: [], payment: [] };
  let n = 0;
  const model = (name) => ({
    findUnique: async ({ where }) => {
      if (where.id) return tables[name].find((r) => r.id === where.id) || null;
      const [key] = Object.keys(where);
      return tables[name].find((r) => matches(r, where[key])) || null;
    },
    findFirst: async ({ where }) => tables[name].filter((r) => matches(r, where)).slice(-1)[0] || null,
    create: async ({ data }) => { const row = { id: `${name}_${++n}`, ...data }; tables[name].push(row); return { ...row }; },
    update: async ({ where, data }) => { const row = tables[name].find((r) => r.id === where.id); Object.assign(row, data); return { ...row }; },
    updateMany: async ({ where, data }) => {
      const list = tables[name].filter((r) => matches(r, where));
      for (const r of list) Object.assign(r, data);
      return { count: list.length };
    }
  });
  const db = { tables };
  for (const k of Object.keys(tables)) db[k] = model(k);
  return db;
}

const db = fakeDb();
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };

const express = require('express');
const { seal } = require('../src/crypto/secrets');
const { generateTenantKeypair, sha256Hex } = require('../src/crypto/keys');
const { hashInstallSecret, registerInstall } = require('../src/installAuth');
const { checkMachine, transferMachine, TRANSFER_LIMIT } = require('../src/machineBinding');

const DAY = 86400000;
const API_KEY = 'sgls_test_admin_key';
const SECRET = 'install-secret-1';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const H3 = 'c'.repeat(64);
const keys = generateTenantKeypair();

let base;
let server;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/license', require('../src/routes/license'));
  app.use('/v1/tenant', require('../src/routes/tenantAdmin'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

function reset({ machineHash = null, rebindCount = 0, rebindWindowStart = null } = {}) {
  for (const k of Object.keys(db.tables)) db.tables[k] = [];
  db.tables.tenant.push(
    { id: 't1', status: 'active', apiKeyHash: sha256Hex(API_KEY), privateKeySealed: seal(keys.privateKeyPem) },
    { id: 't2', status: 'active', apiKeyHash: sha256Hex('other_tenant_key'), privateKeySealed: seal(keys.privateKeyPem) }
  );
  db.tables.install.push({ id: 'i1', tenantId: 't1', machineId: 'm1', secretHash: hashInstallSecret(SECRET), machineHash });
  db.tables.license.push({
    id: 'l1', tenantId: 't1', installId: 'i1', tier: 'pro', status: 'active', providerRef: 'sub_ABC123',
    currentPeriodEnd: new Date(Date.now() + 20 * DAY), rebindCount, rebindWindowStart
  });
  db.tables.licenseCode.push({ id: 'c1', tenantId: 't1', code: 'SG-ABCDEF123456', redeemedBy: 'i1' });
}

async function post(path, body, headers = {}) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json() };
}
const license = (machineHash) => post('/v1/license', { tenantId: 't1', installId: 'i1', installSecret: SECRET, machineHash });
const leaseMid = (token) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')).mid;
const install = () => db.tables.install.find((r) => r.id === 'i1');

test('an unbound install binds to the first machine it sees and the lease carries it as mid', async () => {
  reset();
  const r = await license(H1);
  assert.equal(r.status, 200);
  assert.ok(r.body.lease);
  assert.equal(leaseMid(r.body.lease), H1);
  assert.equal(install().machineHash, H1);
  const again = await license(H1);
  assert.equal(again.status, 200, 'the bound machine keeps working');
});

test('the same install secret on another machine is refused with machine_mismatch and no lease', async () => {
  reset({ machineHash: H1 });
  const r = await license(H2);
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { error: 'machine_mismatch' });
  assert.equal(install().machineHash, H1, 'a mismatch never rebinds');
});

test('a missing or malformed machine hash gets no lease and never binds', async () => {
  reset();
  for (const h of [undefined, '', 'raw-serial-123', 'A'.repeat(63)]) {
    const r = await license(h);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'machine_required');
  }
  assert.equal(install().machineHash, null);
});

test('a racing second machine loses the first-use bind', async () => {
  reset();
  const inst = { ...install() }; // both requests read the row while it was unbound
  const a = await checkMachine(db, inst, H1);
  const b = await checkMachine(db, inst, H2);
  assert.equal(a.ok, true);
  assert.deepEqual(b, { ok: false, status: 403, error: 'machine_mismatch' });
});

test('registration binds a new install to its machine hash', async () => {
  reset();
  const r = await registerInstall(db, { id: 't1' }, { machineId: 'new-machine', machineHash: H3 });
  assert.equal(r.status, 200);
  assert.equal(db.tables.install.find((x) => x.id === r.body.installId).machineHash, H3);
});

test('the tenant admin can reset a binding, authenticated by the tenant API key only', async () => {
  reset({ machineHash: H1 });
  assert.equal((await post('/v1/tenant/installs/i1/reset-machine', {})).status, 401);
  assert.equal((await post('/v1/tenant/installs/i1/reset-machine', {}, { authorization: 'Bearer wrong' })).status, 401);
  const other = await post('/v1/tenant/installs/i1/reset-machine', {}, { authorization: 'Bearer other_tenant_key' });
  assert.equal(other.status, 404, 'another tenant cannot reset this install');
  assert.equal(install().machineHash, H1);

  const ok = await post('/v1/tenant/installs/i1/reset-machine', {}, { authorization: `Bearer ${API_KEY}` });
  assert.equal(ok.status, 200);
  assert.equal(install().machineHash, null);
  const r = await license(H2);
  assert.equal(r.status, 200, 'the next machine binds after a reset');
  assert.equal(leaseMid(r.body.lease), H2);
});

test('self-service transfer needs the install secret and a proof of purchase', async () => {
  reset({ machineHash: H1 });
  const t = (over) => post('/v1/license/transfer', { tenantId: 't1', installId: 'i1', installSecret: SECRET, machineHash: H2, ...over });
  assert.equal((await t({ installSecret: 'wrong', proof: 'SG-ABCDEF123456' })).status, 401);
  assert.equal((await t({ proof: undefined })).status, 403);
  assert.equal((await t({ proof: 'SG-NOT-MINE-0000' })).status, 403);
  assert.equal(install().machineHash, H1);

  const r = await t({ proof: 'sg-abcdef123456' }); // the redeemed code, any case
  assert.equal(r.status, 200);
  assert.equal(r.body.transferred, true);
  assert.equal(install().machineHash, H2);
  assert.equal((await license(H1)).status, 403, 'the old machine is cut off');
  assert.equal((await license(H2)).status, 200);
});

test('the licence provider reference is also accepted as proof', async () => {
  reset({ machineHash: H1 });
  const r = await transferMachine(db, { id: 't1' }, install(), { machineHash: H2, proof: 'sub_ABC123' });
  assert.equal(r.status, 200);
});

test('transfers are limited to 2 per licence per 30 days', async () => {
  reset({ machineHash: H1 });
  const now = Date.now();
  const move = (h, at) => transferMachine(db, { id: 't1' }, install(), { machineHash: h, proof: 'SG-ABCDEF123456', nowMs: at });
  assert.equal(TRANSFER_LIMIT, 2);
  assert.equal((await move(H2, now)).status, 200);
  assert.equal((await move(H3, now + DAY)).status, 200);
  const third = await move(H1, now + 2 * DAY);
  assert.equal(third.status, 429);
  assert.equal(third.body.error, 'transfer_limit');
  assert.equal(install().machineHash, H3);
  // After the window the licence may move again.
  assert.equal((await move(H1, now + 31 * DAY)).status, 200);
  assert.equal(install().machineHash, H1);
});

test('the license route checks the machine before looking up the licence', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/routes/license'), 'utf8');
  const route = src.slice(src.indexOf("router.post('/'"), src.indexOf("router.post('/transfer'"));
  assert.ok(route.indexOf('checkMachine(') > 0 && route.indexOf('checkMachine(') < route.indexOf('prisma.license.findFirst'));
  assert.match(route, /issueLease\(tenant, lic, now, \{ mid: install\.machineHash \}\)/);
});
