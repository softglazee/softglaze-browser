'use strict';
// Opt-in end-to-end check against a real MySQL / MariaDB with the real Prisma client. Skipped unless
// TEST_DATABASE_URL points at a database that `prisma migrate deploy` has been run on, e.g.
//   TEST_DATABASE_URL="mysql://root@127.0.0.1:3399/sgtest" npx prisma migrate deploy
//   TEST_DATABASE_URL="mysql://root@127.0.0.1:3399/sgtest" node --test test/integration.mysql.test.js
// It creates its own tenant and deletes it at the end (cascade). Never point it at production.
const test = require('node:test');

const URL = process.env.TEST_DATABASE_URL;
if (!URL) {
  test('MySQL integration (set TEST_DATABASE_URL to run)', { skip: 'TEST_DATABASE_URL is not set' }, () => {});
} else {
  const crypto = require('node:crypto');
  const path = require('node:path');
  const os = require('node:os');
  process.env.DATABASE_URL = URL;
  process.env.MASTER_KEY = crypto.randomBytes(32).toString('base64');
  process.env.PUBLIC_BASE_URL = 'https://api.test';
  process.env.CONFIG_ENV_FILE = path.join(os.tmpdir(), `sg-int-none-${process.pid}.env`);
  process.env.PUBLIC_RATE_PER_MIN = '100000';
  process.env.VERIFY_RATE_PER_MIN = '100000';

  const assert = require('node:assert/strict');
  const prisma = require('../src/db');
  const transport = require('../src/email/transport');
  const mx = require('../src/customers/mx');
  const { generateTenantKeypair, sha256Hex } = require('../src/crypto/keys');
  const { seal } = require('../src/crypto/secrets');
  const { ensureDefaultTemplates } = require('../src/email/templates');
  const { runCron } = require('../src/cron');
  const app = require('../src/server');

  const sent = [];
  transport.setTransportForTests({ async sendMail(m) { sent.push(m); return { messageId: `<${sent.length}@int>` }; } });
  mx.setResolverFactoryForTests(() => ({ resolveMx: async (d) => [{ exchange: `mx.${d}`, priority: 1 }], resolve4: async () => [], resolve6: async () => [] }));

  const T = `int${crypto.randomBytes(6).toString('hex')}`;
  const KEY = `sgls_int_${crypto.randomBytes(8).toString('hex')}`;
  let server;
  let base;
  const call = async (method, url, body, headers = {}) => {
    const r = await fetch(base + url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { /* csv */ }
    return { status: r.status, json, text };
  };
  const admin = (method, url, body) => call(method, `/v1/admin${url}`, body, { authorization: `Bearer ${KEY}`, 'x-admin-actor': 'integration' });
  const mh = (s) => crypto.createHash('sha256').update(s).digest('hex');

  test.before(async () => {
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}`;
    const { publicKeyPem, privateKeyPem } = generateTenantKeypair();
    await prisma.tenant.create({ data: { id: T, name: 'Integration', publicKeyPem, privateKeySealed: seal(privateKeyPem), apiKeyHash: sha256Hex(KEY) } });
    await prisma.plan.create({ data: { tenantId: T, key: 'pro', name: 'Pro', tier: 'pro', amount: 500 } });
    await prisma.plan.create({ data: { tenantId: T, key: 'enterprise', name: 'Enterprise', tier: 'enterprise', amount: 2900, highlight: true, features: ['Audit export'] } });
    await ensureDefaultTemplates(prisma, T);
  });
  test.after(async () => {
    server.close();
    await prisma.tenant.delete({ where: { id: T } }).catch(() => {});
    await prisma.jobLock.deleteMany({ where: { name: 'cron' } }).catch(() => {});
    await prisma.$disconnect();
  });

  test('sign-up, trial, licence, admin, cron and erase work on a real MySQL/MariaDB', async () => {
    const reg = await call('POST', '/v1/register', { tenantId: T, machineId: 'int-m1', account: 'Int.User+x@gmail.com', machineHash: mh('pc1'), appVersion: '1.0.22', channel: 'website' });
    assert.equal(reg.status, 200, reg.text);
    const inst = { installId: reg.json.installId, installSecret: reg.json.installSecret, machineHash: mh('pc1') };
    const lead = await prisma.customer.findUnique({ where: { tenantId_emailKey: { tenantId: T, emailKey: 'intuser@gmail.com' } } });
    assert.ok(lead && !lead.emailVerifiedAt, 'register creates an unverified lead');

    assert.equal((await call('POST', '/v1/account/verify/start', { tenantId: T, ...inst, email: 'int.user@gmail.com', name: 'Int User', consentMarketing: true, lang: 'en' }, { 'x-forwarded-for': '8.8.8.8' })).status, 200);
    const code = /\b(\d{6})\b/.exec(sent[sent.length - 1].text)[1];
    const chk = await call('POST', '/v1/account/verify/check', { tenantId: T, ...inst, email: 'int.user@gmail.com', code });
    assert.equal(chk.status, 200, chk.text);
    assert.equal(chk.json.customerId, lead.id, 'the Gmail alias resolves to the same customer');

    const tr = await call('POST', '/v1/trial/start', { tenantId: T, ...inst, email: 'int.user@gmail.com', appVersion: '1.0.22' }, { 'x-forwarded-for': '8.8.8.8' });
    assert.equal(tr.status, 200, tr.text);
    assert.equal(tr.json.type, 'trial');
    const lic = await call('POST', '/v1/license', { tenantId: T, ...inst, appVersion: '1.0.23' });
    assert.equal(lic.json.type, 'trial');

    const reg2 = await call('POST', '/v1/register', { tenantId: T, machineId: 'int-m2', machineHash: mh('pc2') });
    const inst2 = { installId: reg2.json.installId, installSecret: reg2.json.installSecret, machineHash: mh('pc2') };
    await call('POST', '/v1/account/verify/start', { tenantId: T, ...inst2, email: 'intuser@googlemail.com', consentMarketing: false, lang: 'en' });
    const code2 = /\b(\d{6})\b/.exec(sent[sent.length - 1].text)[1];
    assert.equal((await call('POST', '/v1/account/verify/check', { tenantId: T, ...inst2, email: 'intuser@googlemail.com', code: code2 })).status, 200);
    const tr2 = await call('POST', '/v1/trial/start', { tenantId: T, ...inst2, email: 'intuser@googlemail.com' }, { 'x-forwarded-for': '9.9.9.9' });
    assert.deepEqual([tr2.status, tr2.json.reason], [409, 'email']);

    let r = await admin('GET', '/customers?q=int&status=trial&verified=1&consent=1&sort=lastSeenAt&order=desc');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.total, 1);
    const cid = r.json.items[0].id;
    assert.equal(r.json.items[0].appVersion, '1.0.23');
    assert.equal(r.json.items[0].firstChannel, 'website');
    // Install channel: the first install said website, the second (no channel, an older app) is unknown.
    const web = await admin('GET', '/installs?channel=website');
    assert.equal(web.status, 200, web.text);
    assert.deepEqual(web.json.items.map((i) => [i.id, i.channel]), [[inst.installId, 'website']]);
    assert.deepEqual((await admin('GET', '/installs?channel=unknown')).json.items.map((i) => i.id), [inst2.installId]);
    assert.equal((await admin('GET', '/installs?channel=store,unknown')).json.total, 1);
    const met = await admin('GET', '/metrics');
    assert.equal(met.json.installsTotal, 2);
    assert.deepEqual(met.json.installsByChannel, { store: 0, website: 1, base: 0, unknown: 1 });
    assert.equal((await admin('PATCH', `/customers/${cid}`, { tags: ['beta', 'pk'], country: 'PK' })).status, 200);
    assert.equal((await admin('GET', '/customers?tag=beta&country=PK')).json.total, 1);
    assert.equal((await admin('GET', `/customers/${cid}`)).status, 200);
    const csv = await admin('GET', '/customers/export');
    assert.match(csv.text, /,int\.user@gmail\.com,/, 'the first verified address stays; an alias verified later does not replace it');
    const dry = await admin('POST', '/customers/import', { csv: 'email,name\nnew.int@example.com,New\n' });
    assert.equal(dry.json.summary.create, 1);
    const imp = await admin('POST', '/customers/import', { csv: 'email,name,tags\nnew.int@example.com,New,x;y\n', dryRun: false });
    assert.equal(imp.json.results.created, 1);

    const pay = await admin('POST', '/payments', { customerId: cid, amount: 2900, currency: 'USD', method: 'invoice', reference: 'INV-INT-1', plan: 'enterprise', grant: { installId: inst.installId } });
    assert.equal(pay.status, 201, pay.text);
    assert.equal(pay.json.customer.status, 'paid');
    assert.equal((await admin('POST', `/licenses/${pay.json.license.id}/extend`, { days: 10, reason: 'integration check' })).status, 200);
    assert.equal((await admin('PATCH', '/plans/enterprise', { amount: 3900, note: 'int' })).status, 200);
    const pub = await call('GET', `/v1/plans/public?tenantId=${T}`);
    assert.equal(pub.json.find((p) => p.key === 'enterprise').amount, 3900);
    assert.deepEqual(pub.json.find((p) => p.key === 'enterprise').features, ['Audit export']);
    assert.equal((await admin('PATCH', '/settings', { email: { dailyCap: 400 } })).status, 200);
    const seg = await admin('POST', '/segments', { name: 'Int beta', filters: { tag: 'beta' } });
    assert.equal(seg.status, 201);
    const pv = await admin('POST', '/email/send', { mode: 'send', category: 'service', audience: { segmentId: seg.json.segment.id }, subject: 'Hi {{name}}', html: '<p>{{greeting}}</p>', text: '{{greeting}}' });
    assert.equal(pv.status, 202, pv.text);
    assert.equal((await admin('GET', '/email/outbox?status=queued,sent')).status, 200);
    const m = await admin('GET', '/metrics');
    assert.equal(m.status, 200, m.text);
    assert.equal(m.json.payingCustomers, 1);
    assert.equal(m.json.mrrCents, 3900);
    assert.equal((await admin('GET', '/metrics/monthly?format=csv')).status, 200);
    assert.ok((await admin('GET', '/audit')).json.total > 5);

    const cron = await runCron(prisma);
    assert.ok(!cron.skipped, JSON.stringify(cron));
    assert.equal(cron.tenants[T].errors, undefined, JSON.stringify(cron.tenants[T].errors));

    const er = await admin('POST', `/customers/${cid}/erase`, { confirm: 'int.user@gmail.com' });
    assert.equal(er.status, 200, er.text);
    const p = await prisma.payment.findFirst({ where: { tenantId: T, providerRef: 'INV-INT-1' } });
    assert.deepEqual([p.amount, p.customerId, p.account], [2900, null, null]);
  });
}
