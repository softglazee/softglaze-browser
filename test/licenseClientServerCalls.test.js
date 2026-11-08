'use strict';
// The licensing client against a fake server on 127.0.0.1: the exact bodies of the new calls
// (spec A2 verify/start + check, A3 trial/start, A4 plans/public), the app version on lease refresh,
// error codes with their reason, and the offline flag.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { generateKeyPairSync } = require('node:crypto');

const requests = [];
let reply = () => [200, {}];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
    const [status, json] = reply(req);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  });
});

let client;
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { publicKey } = generateKeyPairSync('ed25519');
  process.env.SG_TENANT_ID = 'tenant_test';
  process.env.SG_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.SG_TENANT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  client = require('../src/main/licenseClient');
});
test.after(() => new Promise((r) => server.close(r)));
test.beforeEach(() => { requests.length = 0; reply = () => [200, {}]; });

const VERSION = require('../package.json').version;

test('verify/start sends the email, name, consent (false unless true) and language', async () => {
  reply = () => [200, { sent: true }];
  await client.api.verifyStart({ installId: 'i1', installSecret: 's1', email: 'a@b.co', name: 'Ada', consentMarketing: true, lang: 'es' });
  await client.api.verifyStart({ installId: 'i1', installSecret: 's1', email: 'a@b.co', consentMarketing: 'yes' });
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/v1/account/verify/start');
  assert.deepEqual(requests[0].body, { tenantId: 'tenant_test', installId: 'i1', installSecret: 's1', email: 'a@b.co', name: 'Ada', consentMarketing: true, lang: 'es', appVersion: VERSION, channel: 'website' });
  assert.equal(requests[1].body.consentMarketing, false);
  assert.equal(requests[1].body.lang, 'en');
  assert.equal('name' in requests[1].body, false);
});

test('verify/check sends the code and returns the customer', async () => {
  reply = () => [200, { verified: true, customerId: 'cus_1' }];
  const r = await client.api.verifyCheck({ installId: 'i1', installSecret: 's1', email: 'a@b.co', code: '123456' });
  assert.deepEqual(r, { verified: true, customerId: 'cus_1' });
  assert.equal(requests[0].url, '/v1/account/verify/check');
  assert.deepEqual(requests[0].body, { tenantId: 'tenant_test', installId: 'i1', installSecret: 's1', email: 'a@b.co', code: '123456' });
});

test('trial/start sends the install, machine hash, email and app version', async () => {
  reply = () => [200, { lease: 'x.y' }];
  await client.api.trialStart({ installId: 'i1', installSecret: 's1', email: 'a@b.co' });
  assert.equal(requests[0].url, '/v1/trial/start');
  assert.deepEqual(requests[0].body, { tenantId: 'tenant_test', installId: 'i1', installSecret: 's1', machineHash: client.machineHash(), email: 'a@b.co', appVersion: VERSION, channel: 'website' });
});

test('a 409 trial_used rejects with the code, status and reason', async () => {
  reply = () => [409, { error: 'trial_used', reason: 'network' }];
  await assert.rejects(client.api.trialStart({ installId: 'i1', installSecret: 's1', email: 'a@b.co' }), (e) => {
    assert.equal(e.code, 'trial_used');
    assert.equal(e.status, 409);
    assert.equal(e.reason, 'network');
    assert.notEqual(e.network, true);
    return true;
  });
});

test('plans/public is a GET with the tenant id and no body', async () => {
  reply = () => [200, [{ key: 'pro', name: 'Pro', amount: 500 }]];
  const r = await client.api.plans();
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].url, '/v1/plans/public?tenantId=tenant_test');
  assert.equal(requests[0].body, null);
  assert.equal(r[0].key, 'pro');
});

test('lease refresh sends the app version from package.json', async () => {
  reply = () => [200, { lease: null, status: 'none' }];
  await client.api.license({ installId: 'i1', installSecret: 's1' });
  assert.equal(requests[0].url, '/v1/license');
  assert.equal(requests[0].body.appVersion, VERSION);
  assert.equal(requests[0].body.channel, 'website', 'a baked tenant outside an MSIX package is the website installer');
  assert.equal(client.appVersion(), VERSION);
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
});

test('no answer at all is flagged as network (offline)', async () => {
  const dead = http.createServer();
  await new Promise((r) => dead.listen(0, '127.0.0.1', r));
  const port = dead.address().port;
  await new Promise((r) => dead.close(r));
  const saved = process.env.SG_API_BASE_URL;
  process.env.SG_API_BASE_URL = `http://127.0.0.1:${port}`;
  require('../src/main/tenantConfig')._reset();
  try {
    await assert.rejects(client.api.trialStart({ installId: 'i1', installSecret: 's1', email: 'a@b.co' }), (e) => e.network === true);
  } finally {
    process.env.SG_API_BASE_URL = saved;
    require('../src/main/tenantConfig')._reset();
  }
});

// ---- 1.0.23: lead fields, account status, checkout methods -------------------------------------------

test('verify/start carries the lead details only when they are filled', async () => {
  reply = () => [200, { sent: true }];
  await client.api.verifyStart({ installId: 'i1', installSecret: 's1', email: 'a@b.co', consentMarketing: false, lang: 'en', phone: '+92 300 1234567', useCase: 'other', useCaseOther: 'QA', company: 'Acme' });
  await client.api.verifyStart({ installId: 'i1', installSecret: 's1', email: 'a@b.co', useCase: 'agency', phone: '', company: '' });
  const b0 = requests[0].body;
  assert.deepEqual([b0.phone, b0.useCase, b0.useCaseOther, b0.company], ['+92 300 1234567', 'other', 'QA', 'Acme']);
  const b1 = requests[1].body;
  assert.equal(b1.useCase, 'agency');
  for (const k of ['phone', 'useCaseOther', 'company']) assert.equal(k in b1, false, `${k} is left out when empty`);
});

test('account status asks the server with the install credentials, app version and channel', async () => {
  reply = () => [200, { verified: false }];
  const r = await client.api.accountStatus({ installId: 'i1', installSecret: 's1' });
  assert.deepEqual(r, { verified: false });
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/v1/account/status');
  assert.deepEqual(requests[0].body, { tenantId: 'tenant_test', installId: 'i1', installSecret: 's1', appVersion: VERSION, channel: 'website' });
});

test('checkout methods are read from the public endpoint, no credentials sent', async () => {
  reply = () => [200, { providers: [{ id: 'stripe', label: 'Stripe (cards)', kind: 'automated' }], store: { salesEnabled: false } }];
  const r = await client.api.checkoutMethods();
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].url, '/v1/checkout/methods?tenantId=tenant_test');
  assert.equal(requests[0].body, null);
  assert.equal(r.providers[0].id, 'stripe');
});
