'use strict';
// ProxyBrazil connector. Fixtures follow the Partner API docs and its OpenAPI 3.1 contract
// (proxybrazil.com/api-docs, read 2026-11-10): the docs' Proxy sample with the credentials replaced.
// Built from the docs only: never checked against a live account, and no test reaches ProxyBrazil.
const test = require('node:test');
const assert = require('node:assert/strict');
const { IPC, UI, LOCALES, U, fnSrc, httpError, load, loadRotation, providerLine } = require('./helpers/connectorHarness');
const pa = require('../src/main/providerAccount');

const KEY = `pb_live_${'TestKey0'.repeat(5)}`;
const PROXY = {
  id: '5f0c2a8e-0000-4000-8000-000000000001', name: 'BR 1', type: 'mobile_4g_dedicated', country: 'BR', status: 'active',
  expires_at: '2026-11-01T00:00:00Z', host: 'secure.proxybrazil.com', http_port: 10100, socks5_port: 20100,
  username: 'example-user', password: 'example-pass', data_limit_mb: 61440, data_used_mb: 0,
  rotation_url: 'https://rotate.proxybrazil.com/v1/rotate/example-token'
};
const page = (data, extra = {}) => ({ data, page: 1, per_page: 200, total: data.length, ...extra });

const pool = (route) => load({ from: '// ---- ProxyBrazil (dedicated 4G', to: '// ---- ProxyUDP (mobile', names: ['fetchProxyBrazilPool'], route });

test('the docs\' Proxy sample maps to one row per protocol, with its rotation link', () => {
  const h = U.proxyBrazilRows(page([PROXY])).rows[0];
  assert.deepEqual([h.type, h.host, h.port, h.username, h.password, h.country], ['HTTP', 'secure.proxybrazil.com', 10100, 'example-user', 'example-pass', 'BR']);
  assert.equal(h.rotationUrl, 'https://rotate.proxybrazil.com/v1/rotate/example-token');
  assert.equal(h.label, 'ProxyBrazil • 4G • BR 1 • 0/60 GB • until 2026-11-01');
  const s = U.proxyBrazilRows(JSON.stringify(page([PROXY])), { socks: true }).rows[0];
  assert.deepEqual([s.type, s.port], ['SOCKS5', 20100]);
  const used = U.proxyBrazilRows(page([{ ...PROXY, data_used_mb: 2150 }])).rows[0];
  assert.match(used.label, / • 2\.1\/60 GB • /);
});

test('used-up, inactive and login-less proxies are counted, not imported; only an https link is kept', () => {
  const r = U.proxyBrazilRows(page([{ ...PROXY, status: 'data_exhausted' }, { ...PROXY, status: 'suspended' }, { ...PROXY, password: '' }]));
  assert.deepEqual([r.rows.length, r.total, r.exhausted, r.inactive, r.noLogin], [0, 3, 1, 1, 1]);
  assert.equal(U.proxyBrazilRows(page([{ ...PROXY, rotation_url: null }])).rows[0].rotationUrl, null, 'null while links are not configured');
  assert.equal(U.proxyBrazilRows(page([{ ...PROXY, rotation_url: 'http://rotate.proxybrazil.com/v1/rotate/x' }])).rows[0].rotationUrl, null);
  assert.equal(U.proxyBrazilRows(page([{ ...PROXY, host: 'evil.example/x' }])).rows.length, 0, 'a host with a path is refused');
  assert.match(U.proxyBrazilRows('<html>').error, /did not return JSON/);
});

test('paging follows page * per_page < total', () => {
  assert.equal(U.proxyBrazilRows(page([PROXY], { total: 250 })).more, true);
  assert.equal(U.proxyBrazilRows(page([PROXY], { page: 2, total: 250 })).more, false);
  assert.equal(U.proxyBrazilRows(page([], { total: 250 })).more, false, 'an empty page never loops');
});

test('the pull: key format first, Bearer header, every page, How many caps the list', async () => {
  const bad = pool(() => page([PROXY]));
  await assert.rejects(bad.fetchProxyBrazilPool({ token: 'pb_live_short' }), /paste the API key from Integrations in your dashboard\. It starts with pb_live_\./);
  assert.equal(bad.calls.length, 0, 'no call with a malformed key');
  const second = { ...PROXY, id: 'b', name: 'BR 2', http_port: 10101, username: 'example-user-2' };
  const p = pool((call) => (call.url.includes('page=1&') ? page([PROXY], { total: 2, per_page: 1 }) : page([second], { page: 2, per_page: 1, total: 2 })));
  const rows = await p.fetchProxyBrazilPool({ token: KEY, count: '' });
  assert.equal(rows.length, 2);
  assert.deepEqual(p.calls.map((c) => c.url), [
    'https://api.proxybrazil.com/v1/proxies?page=1&per_page=200',
    'https://api.proxybrazil.com/v1/proxies?page=2&per_page=200'
  ]);
  assert.equal(p.calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.ok(p.calls.every((c) => !c.url.includes(KEY)), 'the key is never in a URL');
  const one = pool(() => page([PROXY, second]));
  assert.equal((await one.fetchProxyBrazilPool({ token: KEY, count: '1' })).length, 1);
  assert.equal((await one.fetchProxyBrazilPool({ token: KEY, count: '1', proxyType: 'socks5' }))[0].port, 20100);
});

test('the pull says why nothing was added', async () => {
  await assert.rejects(pool(() => page([])).fetchProxyBrazilPool({ token: KEY }), /no active proxies on this account\. Buy or renew one on proxybrazil\.com\./);
  await assert.rejects(pool(() => page([{ ...PROXY, status: 'data_exhausted' }])).fetchProxyBrazilPool({ token: KEY }), /used their data allowance/);
});

test('API errors map to fixed messages; the key is never echoed, the request id is logged', async () => {
  const fail = (status, code) => pool(() => { throw httpError(status, { error: { code, message: `echo ${KEY}` } }, { requestId: 'req-123' }); });
  const cases = [
    [401, 'invalid_key', /rejected the API key, or it was revoked\. Create a new one under Integrations \(App: SoftGlaze\)\./],
    [403, 'missing_scope', /this key cannot list proxies/],
    [403, 'account_blocked', /this account is blocked\. Contact ProxyBrazil support\./],
    [429, 'rate_limited', /too many requests \(120 a minute\)/],
    [503, 'api_disabled', /the API is switched off for now/],
    [500, 'internal_error', /could not read the proxy list/]
  ];
  for (const [status, code, re] of cases) {
    const p = fail(status, code);
    await assert.rejects(p.fetchProxyBrazilPool({ token: KEY }), (e) => re.test(e.message) && !e.message.includes(KEY));
    assert.ok(p.logs.some((l) => l.includes('X-Request-Id req-123') && !l.includes(KEY)), `${status} ${code} logs the request id`);
  }
});

test('Rotate IP: the link gets 65 seconds, keyed on the provider tag every pulled row carries', () => {
  const r = loadRotation();
  assert.equal(r.ROTATION_LINK_TIMEOUT_MS.proxybrazil, 65000);
  assert.equal(r.rotationLinkTimeoutMs({ provider: 'proxybrazil' }), 65000);
  assert.equal(r.rotationLinkTimeoutMs({ provider: 'singaporemobileproxy' }), 20000);
  const row = U.proxyBrazilRows(page([PROXY])).rows[0];
  assert.equal(r.proxyCanRotate({ ...row, provider: 'proxybrazil' }), true);
  assert.equal(r.apiRotationProvider({ ...row, provider: 'proxybrazil' }), '', 'the link, not an API call');
  // syncVendorPool tags every created row with its connector, which the timeout is keyed on.
  assert.match(fnSrc('syncVendorPool'), /provider: vendorKey,/);
  assert.match(fnSrc('syncVendorPool'), /\.\.\.\(row\.rotationUrl \? \{ rotationUrl: row\.rotationUrl \} : \{\}\)/);
});

test('Rotate IP: ProxyBrazil\'s documented refusals become clear messages', () => {
  const r = loadRotation();
  const px = { provider: 'proxybrazil' };
  assert.equal(r.rotationLinkRefusal(px, 200, { success: true, old_ip: '198.51.100.1', new_ip: '198.51.100.2' }), '');
  assert.match(r.rotationLinkRefusal(px, 409, { error: { code: 'proxy_not_active' } }), /this proxy is not active, so it cannot change IP/);
  assert.match(r.rotationLinkRefusal(px, 429, '{"error":{"code":"rate_limited"}}'), /30 IP changes in 15 minutes/);
  for (const s of [400, 502, 504]) assert.match(r.rotationLinkRefusal(px, s, {}), /the modem did not change IP this time\. Try again in a minute\./);
  assert.match(r.rotationLinkRefusal(px, 404, { error: { code: 'invalid_link' } }), /no longer works/);
  assert.match(r.rotationLinkRefusal(px, 200, { success: false }), /did not change IP/);
  assert.equal(r.rotationLinkRefusal({ provider: 'other' }, 409, {}), '', 'other vendors keep the plain status');
  const rotate = fnSrc('rotateProxyIp');
  assert.match(rotate, /const refusal = rotationLinkRefusal\(proxy, res\.status, res\.data\);\r?\n\s*if \(refusal\) throw new Error\(refusal\);/);
});

test('account check: GET /proxies, Bearer key; expiry, data used and limit in GB', async () => {
  const seen = [];
  const get = async (url, opts = {}) => { seen.push({ url, headers: opts.headers || {} }); return JSON.stringify(page([PROXY, { ...PROXY, id: 'b', data_used_mb: 1024, data_limit_mb: 10240, expires_at: '2026-12-07T00:00:00Z' }])); };
  const r = await pa.checkProviderAccount('proxybrazil', { token: KEY }, get, { now: Date.parse('2026-11-10T00:00:00Z') });
  assert.equal(seen[0].url, 'https://api.proxybrazil.com/v1/proxies?page=1&per_page=200');
  assert.equal(seen[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(seen.length, 1);
  assert.deepEqual([r.account.status, r.account.plan, r.account.expiresAt, r.account.trafficUsedGb, r.account.trafficTotalGb, r.account.trafficLeftGb, r.account.note],
    ['active', 'Dedicated 4G', '2026-12-07T00:00:00.000Z', 1, 70, 69, 'summedPlans']);
  assert.equal(r.dashboardUrl, 'https://proxybrazil.com/dashboard');
  const none = await pa.checkProviderAccount('proxybrazil', { token: KEY }, async () => JSON.stringify(page([])));
  assert.equal(none.account.note, 'noActiveProxies');
  await assert.rejects(pa.checkProviderAccount('proxybrazil', { token: 'nope' }, async () => '{}'), /does not look right/);
  await assert.rejects(pa.checkProviderAccount('proxybrazil', { token: KEY }, async () => { throw httpError(401, `{"error":{"code":"invalid_key","message":"${KEY}"}}`); }),
    (e) => /rejected the saved key/.test(e.message) && !e.message.includes(KEY));
});

test('ProxyBrazil is wired, read-only, and its strings exist in English and Spanish', () => {
  const body = fnSrc('fetchProxyBrazilPool');
  assert.doesNotMatch(body, /\/rotate\b/, 'the pull never rotates');
  assert.match(body, /throw new Error\(proxyBrazilErrorMessage\(error && error\.status, error && error\.message\)\);/, 'a failed call becomes a fixed message (only its error code is read)');
  assert.match(IPC, /const PROXYBRAZIL_API = 'https:\/\/api\.proxybrazil\.com\/v1';/);
  assert.doesNotMatch(IPC, /supabase\.proxybrazil\.com/, 'the previous address is not used');
  assert.match(IPC, /proxybrazil: fetchProxyBrazilPool/);
  assert.match(IPC, /proxybrazil: 'ProxyBrazil'/);
  const line = providerLine('proxybrazil');
  assert.match(line, /creds: \['token'\], labels: \{ token: 'apiKeyLabel' \}, noCountry: true, count: true, list: true, proto: true/);
  assert.match(line, /referral: 'https:\/\/proxybrazil\.com\/'/, 'no live affiliate link yet: the plain site');
  assert.match(line, /initials: 'BR'/);
  // The five new connectors have no logo file, so their tiles show the catalog's initials.
  const logos = require('node:fs').readdirSync(require('node:path').join(__dirname, '..', 'src', 'renderer', 'assets', 'providers'));
  for (const k of ['proxybrazil', 'proxyudp', 'zokol', 'resiprox', 'simplynode']) assert.ok(!logos.some((f) => f.startsWith(`${k}.`)), k);
  assert.match(UI, /const initials = \(PROVIDERS\.find\(\(p\) => p\.key === k\) \|\| \{\}\)\.initials;/);
  for (const lang of ['en', 'es']) {
    const hint = LOCALES[lang].proxyProviders.geoHints.proxybrazil;
    assert.equal(typeof hint, 'string', lang);
    assert.doesNotMatch(hint, /[–—]/, `${lang}: no em or en dashes`);
    assert.match(hint, /pb_live_/);
    assert.doesNotMatch(hint, /Softglaze/);
  }
});
