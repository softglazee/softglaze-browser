'use strict';
// Audit T2-6: a lease must require proof that the caller owns the install. Neither a
// customer's email nor a machine id may be enough.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newInstallSecret, hashInstallSecret, verifyInstallSecret, registerInstall, authenticateInstall } = require('../src/installAuth');

const SRC = path.join(__dirname, '..', 'src');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

// In-memory stand-in for the two prisma.install calls the module uses.
function fakePrisma() {
  const rows = new Map();
  let n = 0;
  return {
    rows,
    install: {
      findUnique: async ({ where }) => {
        if (where.id) return rows.get(where.id) || null;
        const k = where.tenantId_machineId;
        return [...rows.values()].find((r) => r.tenantId === k.tenantId && r.machineId === k.machineId) || null;
      },
      create: async ({ data }) => { const row = { id: `inst_${++n}`, secretHash: null, ...data }; rows.set(row.id, row); return row; },
      update: async ({ where, data }) => { const row = { ...rows.get(where.id), ...data }; rows.set(where.id, row); return row; }
    }
  };
}
const tenant = { id: 'tenant_a' };

test('secrets are random, stored only as SHA-256, and verified in constant time', () => {
  const a = newInstallSecret();
  const b = newInstallSecret();
  assert.notEqual(a.secret, b.secret);
  assert.equal(a.hash, hashInstallSecret(a.secret));
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.ok(verifyInstallSecret(a.secret, a.hash));
  assert.ok(!verifyInstallSecret(b.secret, a.hash));
  assert.ok(!verifyInstallSecret('', a.hash));
  assert.ok(!verifyInstallSecret(a.secret, null));
});

test('first registration returns the secret once and stores only its hash', async () => {
  const db = fakePrisma();
  const r = await registerInstall(db, tenant, { machineId: 'm1', account: 'owner@example.com' });
  assert.equal(r.status, 200);
  assert.ok(r.body.installId && r.body.installSecret);
  const row = db.rows.get(r.body.installId);
  assert.equal(row.secretHash, hashInstallSecret(r.body.installSecret));
  assert.ok(!JSON.stringify(row).includes(r.body.installSecret), 'the plaintext secret must not be stored');
});

test('knowing a machine id is no longer enough to get its install back', async () => {
  const db = fakePrisma();
  const first = await registerInstall(db, tenant, { machineId: 'victim-machine' });
  const attacker = await registerInstall(db, tenant, { machineId: 'victim-machine' });
  assert.equal(attacker.status, 403);
  assert.equal(attacker.body.installId, undefined);
  const owner = await registerInstall(db, tenant, { machineId: 'victim-machine', installSecret: first.body.installSecret });
  assert.equal(owner.status, 200);
  assert.equal(owner.body.installId, first.body.installId);
  assert.equal(owner.body.installSecret, undefined, 'a secret is only ever issued once');
});

test('an install row from before secrets existed is issued one on its next registration', async () => {
  const db = fakePrisma();
  const legacy = await db.install.create({ data: { tenantId: tenant.id, machineId: 'old' } });
  const r = await registerInstall(db, tenant, { machineId: 'old' });
  assert.equal(r.status, 200);
  assert.equal(r.body.installId, legacy.id);
  assert.ok(r.body.installSecret);
});

test('authentication needs the right secret, the right tenant and an existing install', async () => {
  const db = fakePrisma();
  const r = await registerInstall(db, tenant, { machineId: 'm1' });
  const { installId, installSecret } = r.body;
  assert.ok(await authenticateInstall(db, tenant, { installId, installSecret }));
  assert.equal(await authenticateInstall(db, tenant, { installId, installSecret: 'wrong' }), null);
  assert.equal(await authenticateInstall(db, tenant, { installId, installSecret: '' }), null);
  assert.equal(await authenticateInstall(db, { id: 'tenant_b' }, { installId, installSecret }), null);
  assert.equal(await authenticateInstall(db, tenant, { installId: 'nope', installSecret }), null);
});

test('the licence route authenticates the install and never looks a licence up by email', () => {
  const src = read('routes/license.js');
  assert.match(src, /authenticateInstall\(prisma, tenant, \{ installId, installSecret \}\)/);
  assert.match(src, /status\(401\)/);
  assert.match(src, /where: \{ tenantId: tenant\.id, installId: install\.id \}/);
  assert.ok(!/account/.test(src.replace(/\/\/.*$/gm, '')), 'no account lookup may remain in code');
});

test('redeem authenticates before claiming the code and cannot re-bind by email', () => {
  const src = read('routes/redeem.js');
  const authAt = src.indexOf('authenticateInstall(');
  const claimAt = src.indexOf('licenseCode.updateMany(');
  assert.ok(authAt > -1 && claimAt > -1 && authAt < claimAt, 'a bad secret must not burn a code');
  assert.match(src, /where: \{ tenantId: tenant\.id, installId: install\.id \}/);
  const code = src.replace(/\/\/.*$/gm, '');
  assert.ok(!/OR:/.test(code), 'no OR lookup by account');
  assert.ok(!/installId: installId \|\|/.test(code), 'an existing licence must not be moved to another install');
});

test('payment provisioning matches licences by install or subscription, never by account', () => {
  const src = read('licensing.js').replace(/\/\/.*$/gm, '');
  assert.ok(!/\{ account \}/.test(src), 'account must not be used as a lookup key');
  assert.ok(!/installId: installId \|\| existing\.installId/.test(src), 'grantMonths must not re-bind a licence');
  assert.match(src, /installId: \(existing && existing\.installId\) \|\| installId \|\| null/, 'a subscription keeps the install it is bound to');
});

test('register uses the shared install auth', () => {
  assert.match(read('routes/register.js'), /registerInstall\(prisma, tenant, \{ machineId, account, installSecret \}\)/);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  assert.match(/model Install \{[\s\S]*?\n\}/.exec(schema)[0], /secretHash String\?/);
});
