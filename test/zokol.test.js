'use strict';
// Zokol connector. The ProxyDto fixture is built field by field from the "Zokol Dashboard API" v2.24.0
// schema (docs.zokol.fr, read 2026-11-10); the docs give no example JSON, so the values are made up.
// Never checked against a live account; no test reaches Zokol.
const test = require('node:test');
const assert = require('node:assert/strict');
const { IPC, LOCALES, U, between, fnSrc, httpError, load, loadRotation, providerLine } = require('./helpers/connectorHarness');
const pa = require('../src/main/providerAccount');

const KEY = 'zokol-test-key-0123456789';
const NOW = Date.parse('2026-11-10T00:00:00Z');
const DTO = {
  id: 4211, hostname: 'fr1.example-zokol.test', portHttp: { protocol: 'HTTP', port: 31001 }, portSocks5: { protocol: 'SOCKS5', port: 41001 },
  auth: { username: 'example-user', password: 'example-pass' },
  network: { data: { isp: 'ISP_ORANGE_FR', ipMode: 'DUAL', ipVersion: 'IPV4' }, nextIspUpdateAt: null },
  rotation: { uuid: '0d6c-example', manual: { url: 'https://rotate.example-zokol.test/r/0d6c-example', nextAt: null }, schedule: { enabled: false, delaySeconds: 0, minSeconds: 0, maxSeconds: 0, nextAt: null } },
  trafficQuota: { amount: 0, period: 'MONTH', reachableAt: null }, trafficConsumption: null, trafficBandwidth: null,
  spoofer: null, shared: false, beginAt: '2026-11-07T00:00:00Z', finishAt: '2026-12-07T00:00:00Z', nextRebootAt: null,
  trial: true, state: 'ACTIVE', renew: { enabled: false, autoEnabled: false, nextAutoAt: null }, note: ''
};
const SHARED = {
  ...DTO, id: 4212, portHttp: { protocol: 'HTTP', port: 31002 }, portSocks5: { protocol: 'SOCKS5', port: 41002 }, auth: { username: 'example-user-2', password: 'example-pass-2' },
  shared: true, trial: false, network: { data: { isp: 'ISP_SFR_FR' } }, rotation: { uuid: 'x', manual: null, schedule: { enabled: true } }
};
const pageOf = (content, number = 0, totalPages = 1) => ({ content, page: { size: 100, number, totalElements: content.length, totalPages } });

const pool = (route) => load({ from: '// ---- Zokol (French mobile', to: '// ---- ResiProx (residential', names: ['fetchZokolPool'], route });

test('a dedicated line keeps its rotation link; a shared one has none', () => {
  const r = U.zokolRows(pageOf([DTO, SHARED]), { now: NOW });
  const [d, s] = r.rows;
  assert.deepEqual([d.type, d.host, d.port, d.username, d.password, d.country], ['HTTP', 'fr1.example-zokol.test', 31001, 'example-user', 'example-pass', 'FR']);
  assert.equal(d.rotationUrl, 'https://rotate.example-zokol.test/r/0d6c-example');
  assert.equal(d.label, 'Zokol • Orange • Dedicated • trial • #4211 • until 2026-12-07');
  assert.equal(s.rotationUrl, null);
  assert.equal(s.label, 'Zokol • SFR • Shared • #4212 • until 2026-12-07');
  assert.equal(U.zokolRows(pageOf([DTO]), { socks: true, now: NOW }).rows[0].port, 41001);
  assert.equal(U.zokolRows(pageOf([{ ...DTO, rotation: { manual: { url: 'http://rotate.example-zokol.test/r/x' } } }]), { now: NOW }).rows[0].rotationUrl, null, 'https only');
  assert.equal(U.zokolRows(pageOf([{ ...DTO, shared: true }]), { now: NOW }).rows[0].rotationUrl, null, 'never a link on a shared line');
});

test('expired, suspended and login-less lines are counted, not imported', () => {
  const r = U.zokolRows(pageOf([{ ...DTO, state: 'EXPIRED' }, { ...DTO, finishAt: '2026-11-01T00:00:00Z' }, { ...DTO, state: 'POLICY_VIOLATION' }, { ...DTO, auth: { username: 'u' } }, { ...DTO, state: 'EXPIRE_SOON', id: 9 }]), { now: NOW });
  assert.deepEqual([r.rows.length, r.total, r.expired, r.violation, r.noLogin], [1, 5, 2, 1, 1]);
  assert.match(r.rows[0].label, /#9/, 'EXPIRE_SOON is still active');
  assert.match(U.zokolRows('<html>').error, /did not return JSON/);
});

test('the pull: Bearer key, zero-based pages while number + 1 < totalPages, How many caps the list', async () => {
  const empty = pool(() => pageOf([DTO]));
  await assert.rejects(empty.fetchZokolPool({ token: ' ' }), /paste an API key from your dashboard \(API keys\)\./);
  assert.equal(empty.calls.length, 0);
  const p = pool((call) => (call.url.endsWith('page=0') ? pageOf([DTO], 0, 2) : pageOf([{ ...DTO, id: 5, auth: { username: 'u2', password: 'p2' } }], 1, 2)));
  const rows = await p.fetchZokolPool({ token: KEY, count: '' });
  assert.equal(rows.length, 2);
  assert.deepEqual(p.calls.map((c) => c.url), [
    'https://api.dashboard.zokol.fr/v1/proxies/mobile/?active=true&size=100&page=0',
    'https://api.dashboard.zokol.fr/v1/proxies/mobile/?active=true&size=100&page=1'
  ]);
  assert.equal(p.calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal((await pool(() => pageOf([DTO, { ...DTO, id: 5, auth: { username: 'u2', password: 'p2' } }])).fetchZokolPool({ token: KEY, count: '1' })).length, 1);
});

test('the pull says why nothing was added; API errors never echo the key', async () => {
  await assert.rejects(pool(() => pageOf([])).fetchZokolPool({ token: KEY }), /no active proxies on this account\. Start a trial or buy one in your dashboard\./);
  await assert.rejects(pool(() => pageOf([{ ...DTO, state: 'EXPIRED' }])).fetchZokolPool({ token: KEY }), /every proxy on this account has expired/);
  await assert.rejects(pool(() => pageOf([{ ...DTO, state: 'POLICY_VIOLATION' }])).fetchZokolPool({ token: KEY }), /suspended by Zokol \(policy\)\. Contact Zokol support\./);
  for (const [status, re] of [[401, /Zokol rejected the API key\. Create a new one in your dashboard, API keys\./], [403, /refused access for this key/], [429, /too many requests/], [500, /could not read the proxy list/]]) {
    await assert.rejects(pool(() => { throw httpError(status, { timestamp: 'x', code: 'E', message: `bad ${KEY}`, details: [] }); }).fetchZokolPool({ token: KEY }), (e) => re.test(e.message) && !e.message.includes(KEY));
  }
});

test('Rotate IP: the stored link (undocumented behaviour) gets clear messages when Zokol refuses it', () => {
  const r = loadRotation();
  const row = { provider: 'zokol', rotationUrl: 'https://rotate.example-zokol.test/r/x' };
  assert.equal(r.proxyCanRotate(row), true);
  assert.equal(r.proxyCanRotate({ provider: 'zokol', rotationUrl: null }), false, 'a shared line cannot rotate from the app');
  assert.equal(r.rotationLinkTimeoutMs(row), 20000);
  assert.equal(r.rotationLinkRefusal(row, 200, ''), '');
  assert.match(r.rotationLinkRefusal(row, 429, ''), /Wait for the cooldown the Zokol dashboard shows/);
  assert.match(r.rotationLinkRefusal(row, 401, ''), /Zokol refused this rotation link/);
  assert.match(r.rotationLinkRefusal(row, 500, ''), /the IP change failed \(HTTP 500\)/);
});

test('account check: lines, plan kinds and the first to expire; no traffic (units undocumented)', async () => {
  const seen = [];
  const get = async (url, opts = {}) => { seen.push({ url, headers: opts.headers || {} }); return JSON.stringify(pageOf([DTO, { ...SHARED, finishAt: '2026-11-20T00:00:00Z' }])); };
  const r = await pa.checkProviderAccount('zokol', { token: KEY }, get, { now: NOW });
  assert.equal(seen[0].url, 'https://api.dashboard.zokol.fr/v1/proxies/mobile/?active=true&size=100&page=0');
  assert.equal(seen[0].headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual([r.account.status, r.account.plan, r.account.expiresAt, r.account.trafficLeftGb, r.account.note],
    ['active', 'Dedicated, Shared', '2026-11-20T00:00:00.000Z', null, 'firstToExpire']);
  const susp = await pa.checkProviderAccount('zokol', { token: KEY }, async () => JSON.stringify(pageOf([{ ...DTO, state: 'POLICY_VIOLATION' }])), { now: NOW });
  assert.equal(susp.account.status, 'suspended');
  assert.equal(r.dashboardUrl, 'https://dashboard.zokol.fr/products/mobile-proxies/list');
});

test('Zokol is wired, only reads, and has its strings', () => {
  const sec = between('// ---- Zokol (French mobile', '// ---- ResiProx (residential');
  const code = sec.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /method:\s*'(POST|PATCH|PUT|DELETE)'/);
  assert.doesNotMatch(code, /regenerate|rotationLink|reboot|purchase|\/trial|\/isp/);
  assert.match(IPC, /zokol: fetchZokolPool/);
  assert.match(IPC, /zokol: 'Zokol'/);
  assert.match(fnSrc('fetchZokolPool'), /\/v1\/proxies\/mobile\/\?active=true&size=\$\{ZOKOL_PAGE_SIZE\}&page=\$\{page\}/);
  assert.match(providerLine('zokol'), /creds: \['token'\], labels: \{ token: 'apiKeyLabel' \}, noCountry: true, count: true, list: true, proto: true/);
  for (const lang of ['en', 'es']) {
    const hint = LOCALES[lang].proxyProviders.geoHints.zokol;
    assert.equal(typeof hint, 'string', lang);
    assert.doesNotMatch(hint, /[–—]/, `${lang}: no em or en dashes`);
  }
});
