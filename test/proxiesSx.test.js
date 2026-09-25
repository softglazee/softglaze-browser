'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { proxiesSxGatewayRows, proxiesSxOwnedPortRows } = require('../src/main/proxyVendorUtils');
const source = fs.readFileSync(path.join(__dirname, '../src/main/ipcHandlers.js'), 'utf8');
const accountId = '0123456789abcdef01234567';
const username = `psx_${accountId}`;
const token = 'psx_0123456789abcdef0123456789abcdef';
const gateway = { provider: 'proxiessx', plan: 'gateway', username, password: 'DUMMY:p@ss/word%', poolType: 'peer', country: 'US', life: 'sticky', session: 'profile', proxyType: 'http', count: 2 };
const owned = { customerId: accountId, _id: 'port_fixture', name: 'fixture', serverIp: '192.0.2.1', httpPort: 45001, socksPort: 45002, proxyLogin: 'dummy-port-login', proxyPassword: 'DUMMY-port-p@ss:', status: 'active', expiresAt: 0 };

function fn(name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(match, `Missing production function ${name}`);
  return match[0];
}

// Execute the actual adapter, IPC importer, serializer and credential handlers.
// Only external boundaries are fixtures: permission, HTTPS, Prisma and OS encryption.
function app({ request = async () => { throw Error('Unexpected network'); }, allowed = true, secretStore } = {}) {
  const rows = [], settings = {}, calls = [];
  const db = { proxy: {
    findMany: async () => rows,
    findFirst: async ({ where }) => rows.find((row) => Object.entries(where).every(([k, v]) => row[k] === v)),
    create: async ({ data }) => { const row = { id: rows.length + 1, ...data }; rows.push(row); return row; }
  } };
  const context = {
    module: {}, crypto, Date, Buffer, URL,
    proxiesSxGatewayRows, proxiesSxOwnedPortRows,
    httpRequestText: async (url, options) => { calls.push({ url, options }); return request(url, options); },
    requirePermission: async () => { if (!allowed) throw Error('Permission denied'); },
    requireOwnerOrSuper: async () => { if (!allowed) throw Error('Permission denied'); },
    getPrisma: () => db, ownerStampId: () => 7,
    currentMemberCanRevealProxy: true, isDataImpulseSticky: () => false,
    readSetting: async (name, fallback) => settings[name] || fallback,
    writeSetting: async (name, value) => { settings[name] = value; },
    secretStore: secretStore || {
      seal: (value) => `sealed:${Buffer.from(value).toString('base64')}`,
      open: (value) => Buffer.from(value.slice(7), 'base64').toString()
    }
  };
  const maps = ['PROXY_VENDORS', 'REAL_VENDOR_ADAPTERS'].map((name) => {
    const match = source.match(new RegExp(`const ${name} = Object\\.freeze\\(\\{[\\s\\S]*?\\}\\);`));
    assert.ok(match, name);
    if (name === 'REAL_VENDOR_ADAPTERS') {
      for (const [, adapter] of match[0].matchAll(/:\s*(fetch\w+)/g)) {
        if (adapter !== 'fetchProxiesSxPool') context[adapter] = () => { throw Error('Unrelated provider called'); };
      }
    }
    return match[0];
  });
  const names = ['requireObject', 'optionalString', 'requiredString', 'deriveProvider', 'serializeProxy', 'fetchProxiesSxPool', 'syncVendorPool', 'readProxyProviderCredMap', 'getProxyProviderCreds', 'saveProxyProviderCreds'];
  vm.runInNewContext(`${maps.join('\n')}\nconst PROXY_CRED_SECRET_FIELDS = ['password', 'token', 'apiToken'];\nconst PROXY_CRED_PLAIN_FIELDS = ['username', 'zone', 'plan', 'host', 'port'];\n${names.map(fn).join('\n')}\nmodule.exports = { syncVendorPool, getProxyProviderCreds, saveProxyProviderCreds };`, context);
  return { ...context.module.exports, rows, calls, settings };
}

test('Pool Gateway creates native HTTP and SOCKS routes with independent saved sessions', async () => {
  const a = app();
  const result = await a.syncVendorPool(gateway);
  assert.equal(result.created.length, 2);
  assert.equal(result.simulated, false);
  assert.equal(a.calls.length, 0, 'configuration must not silently test or buy traffic');
  assert.equal(a.rows[0].host, 'gw.proxies.sx');
  assert.equal(a.rows[0].port, 7000);
  assert.equal(a.rows[0].username, `${username}-peer-us-rot-sticky-sid-profile_1-failover-strict`);
  assert.notEqual(a.rows[0].username, a.rows[1].username);
  assert.equal(a.rows[0].password, gateway.password);
  assert.equal(result.created[0].password, '••••••••');
  assert.equal(result.created[0].lastStatus, null, 'import must not claim live health');
  assert.equal(result.created[0].lastCountry, null, 'requested country must not become measured geography');
  const socks = await a.syncVendorPool({ ...gateway, proxyType: 'socks5' });
  assert.equal(socks.created[0].port, 7001);
  assert.equal(socks.created[0].type, 'SOCKS5');
});

test('repeated explicit sessions deduplicate and retained rows survive a serialized restart', async () => {
  const a = app();
  await a.syncVendorPool(gateway);
  const before = JSON.stringify(a.rows);
  const again = await a.syncVendorPool(gateway);
  assert.equal(again.created.length, 0);
  assert.equal(again.skipped.length, 2);
  assert.equal(JSON.stringify(a.rows), before);
  assert.equal(JSON.parse(before)[0].username, a.rows[0].username);
  await a.syncVendorPool({ ...gateway, session: '' });
  await a.syncVendorPool({ ...gateway, session: '' });
  assert.equal(new Set(a.rows.map((row) => row.username)).size, 6);
});

test('all exposed rotation modes and pools map to the documented gateway grammar', () => {
  for (const life of ['sticky', 'ondemand', 'auto5', 'auto10', 'auto20', 'auto60']) {
    for (const poolType of ['peer', 'mbl']) {
      const row = proxiesSxGatewayRows({ ...gateway, life, poolType })[0];
      assert.ok(row.username.includes(`-${poolType}-us-rot-${life}-`));
    }
  }
});

test('bad credentials, unsupported grammar, counts and protocols fail before database mutation', async () => {
  for (const bad of [{ username: token }, { username: `${username}-peer-us` }, { password: '' }, { password: token }, { password: 'x\ny' }, { country: 'US-rot-hard' }, { session: 'profile-two' }, { session: 'a'.repeat(49) }, { count: 0 }, { count: 101 }, { count: 1.5 }, { poolType: 'typo' }, { life: 'hard' }, { proxyType: 'socks4' }, { plan: 'buy' }]) {
    const a = app();
    await assert.rejects(a.syncVendorPool({ ...gateway, ...bad }));
    assert.equal(a.rows.length, 0);
    assert.equal(a.calls.length, 0);
  }
});

test('owned dedicated import performs only fixed-origin GETs and preserves separate port credentials', async () => {
  const a = app({ request: async (url, options) => {
    assert.equal(options.headers['X-API-Key'], token);
    assert.equal(options.method, undefined, 'shared helper defaults to GET');
    if (url.endsWith('/account/proxy-password')) return JSON.stringify({ proxyUsername: username, proxyPassword: 'DO_NOT_IMPORT' });
    assert.equal(url, 'https://api.proxies.sx/v1/ports');
    return JSON.stringify([owned, { ...owned, status: 'suspended' }, { ...owned, isExpired: true }]);
  } });
  const result = await a.syncVendorPool({ provider: 'proxiessx', plan: 'dedicated', token, proxyType: 'socks5', apiUrl: 'https://example.invalid/steal', host: 'evil.invalid' });
  assert.equal(result.created.length, 1);
  assert.equal(a.rows[0].port, owned.socksPort);
  assert.equal(a.rows[0].password, owned.proxyPassword);
  assert.equal(a.rows[0].username, owned.proxyLogin);
  assert.equal(a.rows[0].ownerMemberId, 7);
  assert.equal(a.rows[0].provider, 'proxiessx');
  assert.equal(a.calls.length, 2);
  assert.ok(!JSON.stringify(result).includes(owned.proxyPassword));
  assert.ok(!JSON.stringify(result).includes(token));
});

test('mismatched owner, missing owner and malformed active rows fail the whole import', async () => {
  for (const bad of [{ ...owned, customerId: 'ffffffffffffffffffffffff' }, { ...owned, customerId: null }, { ...owned, httpPort: 99999 }, { ...owned, proxyPassword: '' }, { ...owned, serverIp: 'user@evil.invalid' }]) {
    const a = app({ request: async (url) => JSON.stringify(url.endsWith('/account/proxy-password') ? { proxyUsername: username } : [owned, bad]) });
    await assert.rejects(a.syncVendorPool({ provider: 'proxiessx', plan: 'dedicated', token, proxyType: 'http' }));
    assert.equal(a.rows.length, 0);
  }
});

test('empty, expired, wrong-shape and unauthenticated lists cannot simulate success', async () => {
  for (const response of [[], [{ ...owned, expiresAt: 1 }], [{ ...owned, status: 'grace_period' }], { data: [owned] }]) {
    const a = app({ request: async (url) => JSON.stringify(url.endsWith('/account/proxy-password') ? { proxyUsername: username } : response) });
    await assert.rejects(a.syncVendorPool({ provider: 'proxiessx', plan: 'dedicated', token, proxyType: 'http' }));
    assert.equal(a.rows.length, 0);
  }
  const a = app({ request: async () => JSON.stringify({ proxyUsername: token }) });
  await assert.rejects(a.syncVendorPool({ provider: 'proxiessx', plan: 'dedicated', token, proxyType: 'http' }));
  assert.equal(a.calls.length, 1, 'identity must pass before listing ports');
});

test('auth, scope, throttle, transport and parse failures do not leak secrets', async () => {
  for (const status of [401, 403, 429, 500, undefined]) {
    const a = app({ request: async () => { throw Object.assign(new Error(`${token} ${gateway.password}`), { status }); } });
    await assert.rejects(a.syncVendorPool({ provider: 'proxiessx', plan: 'dedicated', token, proxyType: 'http' }), (error) => {
      assert.ok(!error.message.includes(token)); assert.ok(!error.message.includes(gateway.password)); return true;
    });
    assert.equal(a.rows.length, 0);
  }
  const a = app({ request: async () => '<html>no</html>' });
  await assert.rejects(a.syncVendorPool({ provider: 'proxiessx', plan: 'dedicated', token, proxyType: 'http' }), /invalid response/);
});

test('existing IPC permissions gate import and the existing sealed provider store', async () => {
  const denied = app({ allowed: false });
  await assert.rejects(denied.syncVendorPool(gateway), /Permission/);
  await assert.rejects(denied.saveProxyProviderCreds({ ...gateway, token }), /Permission/);
  await assert.rejects(denied.getProxyProviderCreds({ provider: 'proxiessx' }), /Permission/);
  assert.equal(denied.calls.length, 0);
  const a = app();
  await a.saveProxyProviderCreds({ ...gateway, token });
  const stored = JSON.stringify(a.settings);
  assert.ok(!stored.includes(token)); assert.ok(!stored.includes(gateway.password));
  const restored = await a.getProxyProviderCreds({ provider: 'proxiessx' });
  assert.equal(restored.password, gateway.password);
  assert.equal(restored.token, token);
});


test('OS encryption failure refuses saving credentials without a plaintext fallback', async () => {
  const secretSource = fs.readFileSync(path.join(__dirname, '../src/main/secretStore.js'), 'utf8');
  const osContext = { module: {}, Buffer, require: () => ({ safeStorage: { isEncryptionAvailable: () => false } }) };
  vm.runInNewContext(secretSource, osContext);
  const a = app({ secretStore: osContext.module.exports });
  await assert.rejects(a.saveProxyProviderCreds({ ...gateway, token }), /OS encryption/);
  assert.deepEqual(a.settings, {});
});
