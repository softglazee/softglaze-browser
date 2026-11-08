'use strict';
// Install channel (store | website | base): how the main process decides it, and that it rides on
// register, licence refresh, verify/start and trial/start (the calls that carry appVersion) and on
// nothing else.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { generateKeyPairSync } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const tc = require('../src/main/tenantConfig');
const ch = require('../src/main/installChannel');

const { publicKey } = generateKeyPairSync('ed25519');
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const TENANT_ENV = ['SG_TENANT_ID', 'SG_API_BASE_URL', 'SG_TENANT_PUBLIC_KEY'];

function setTenantEnv(baseUrl) {
  process.env.SG_TENANT_ID = 'tenant_test';
  process.env.SG_API_BASE_URL = baseUrl;
  process.env.SG_TENANT_PUBLIC_KEY = PEM;
}
function clearTenantEnv() { for (const k of TENANT_ENV) delete process.env[k]; }
// Plain node has no process.windowsStore; Electron sets it (read-only) inside an MSIX/AppX package.
function setWindowsStore(v) { if (v === undefined) delete process.windowsStore; else process.windowsStore = v; }
function fresh() { tc._reset(); ch._reset(); }

const saved = Object.fromEntries(TENANT_ENV.map((k) => [k, process.env[k]]));
test.after(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setWindowsStore(undefined);
  fresh();
});

test('decideChannel: an MSIX/Store package wins, then a baked tenant (website), else base', () => {
  assert.equal(ch.decideChannel({ windowsStore: true, distribution: '', tenantEnabled: true }), 'store');
  assert.equal(ch.decideChannel({ windowsStore: true, distribution: '', tenantEnabled: false }), 'store');
  assert.equal(ch.decideChannel({ windowsStore: undefined, distribution: 'store', tenantEnabled: true }), 'store', 'the build-store.js marker alone is enough');
  assert.equal(ch.decideChannel({ windowsStore: undefined, distribution: '', tenantEnabled: true }), 'website');
  assert.equal(ch.decideChannel({ windowsStore: undefined, distribution: '', tenantEnabled: false }), 'base');
  assert.equal(ch.decideChannel({}), 'base');
  assert.equal(ch.decideChannel(), 'base');
  // Only a real `true` counts: Electron leaves the property undefined outside a package.
  assert.equal(ch.decideChannel({ windowsStore: 'true', tenantEnabled: true }), 'website');
  assert.equal(ch.decideChannel({ windowsStore: false, tenantEnabled: true }), 'website');
  assert.equal(ch.decideChannel({ distribution: 'website', tenantEnabled: false }), 'base');
  assert.deepEqual(ch.CHANNELS, ['store', 'website', 'base']);
});

test('installChannel() reads process.windowsStore and the tenant config, once', () => {
  clearTenantEnv(); setWindowsStore(undefined); fresh();
  assert.equal(tc.tenantConfig().enabled, false, 'the committed base config has no tenant');
  assert.equal(tc.tenantConfig().distribution, '', 'and no Store marker');
  assert.equal(ch.installChannel(), 'base');

  setTenantEnv('https://api.example.test'); fresh();
  assert.equal(ch.installChannel(), 'website');

  setWindowsStore(true); fresh();
  assert.equal(ch.installChannel(), 'store');

  clearTenantEnv(); fresh();
  assert.equal(ch.installChannel(), 'store', 'a Store package without a tenant is still the Store');

  // Worked out once: a later change is not picked up without a reset (neither input changes at runtime).
  setWindowsStore(undefined);
  assert.equal(ch.installChannel(), 'store');
  fresh();
  assert.equal(ch.installChannel(), 'base');
});

test('the Store build bakes distribution "store"; the website build never does', () => {
  const store = fs.readFileSync(path.join(ROOT, 'scripts', 'build-store.js'), 'utf8');
  const bake = store.slice(store.indexOf('function bakeTenant'), store.indexOf('function newestAppx'));
  assert.match(bake, /const baked = \{[^}]*distribution: 'store'[^}]*\}/);
  const website = fs.readFileSync(path.join(ROOT, 'scripts', 'build-tenant.js'), 'utf8');
  assert.ok(!/distribution/.test(website), 'build-tenant.js (website installer) writes no distribution');
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'main', 'tenant.config.json'), 'utf8'));
  assert.equal('distribution' in base, false, 'the committed base config stays unmarked');
});

// ---- payloads against a fake licensing server -------------------------------------------------

const requests = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    requests.push({ url: req.url, body: body ? JSON.parse(body) : null });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
});

async function everyCall(client) {
  requests.length = 0;
  const inst = { installId: 'i1', installSecret: 's1' };
  await client.api.register('mid-1', 'a@b.co');
  await client.api.license(inst);
  await client.api.verifyStart({ ...inst, email: 'a@b.co', consentMarketing: false, lang: 'en' });
  await client.api.trialStart({ ...inst, email: 'a@b.co' });
  await client.api.verifyCheck({ ...inst, email: 'a@b.co', code: '123456' });
  await client.api.redeem({ ...inst, code: 'CODE-1' });
  await client.api.checkout({ planKey: 'pro', installId: 'i1', account: 'a@b.co', provider: 'stripe' });
  await client.api.transfer({ ...inst, proof: 'CODE-1' });
  return Object.fromEntries(requests.map((r) => [r.url, r.body]));
}

test('channel rides on register, licence refresh, verify/start and trial/start only', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    setTenantEnv(`http://127.0.0.1:${server.address().port}`);
    setWindowsStore(undefined); fresh();
    const client = require('../src/main/licenseClient');

    let by = await everyCall(client);
    for (const url of ['/v1/register', '/v1/license', '/v1/account/verify/start', '/v1/trial/start']) {
      assert.equal(by[url].channel, 'website', `${url} carries the channel`);
    }
    for (const url of ['/v1/account/verify/check', '/v1/redeem', '/v1/checkout', '/v1/license/transfer']) {
      assert.equal('channel' in by[url], false, `${url} sends nothing new`);
    }
    // No other new field: register still sends no appVersion, the others keep theirs.
    assert.deepEqual(Object.keys(by['/v1/register']).sort(), ['account', 'channel', 'machineHash', 'machineId', 'tenantId']);
    assert.ok(by['/v1/license'].appVersion);

    setWindowsStore(true); fresh();
    by = await everyCall(client);
    for (const url of ['/v1/register', '/v1/license', '/v1/account/verify/start', '/v1/trial/start']) {
      assert.equal(by[url].channel, 'store', `${url} from a Store package`);
    }
  } finally {
    setWindowsStore(undefined);
    await new Promise((r) => server.close(r));
  }
});
