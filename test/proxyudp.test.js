'use strict';
// ProxyUDP connector. Fixtures follow the public OpenAPI 3.0.3 schema (proxyudp.com/api/v1/schema/,
// read 2026-11-10: SubscriptionList, SubscriptionDetail and the rotate-ip reply fields); the docs give
// no sample JSON, so the values are made up. Never checked against a live account; no test reaches
// ProxyUDP.
const test = require('node:test');
const assert = require('node:assert/strict');
const { IPC, LOCALES, U, between, fnSrc, httpError, load, loadRotation, providerLine } = require('./helpers/connectorHarness');
const pa = require('../src/main/providerAccount');

const TOKEN = 'udp-test-token-0123456789abcdef';
const NOW = Date.parse('2026-11-10T00:00:00Z');
const SUB = {
  id: '3f2c8a1e-0000-4000-8000-000000000001', server_name: '🇩🇪 1&1 Versatel (Sachsen)', status: 'active',
  created_at: '2026-11-02T10:00:00Z', expires_at: '2099-12-02T10:00:00Z', price_paid: '0.00',
  proxy_ip_address: '203.0.113.10', http_port: 8001, socks_port: 9001, os_spoofing: null, auto_renew: false,
  ip_rotation_available: true, refresh_available: true, os_change_available: false, os_fingerprint_choices: []
};
const DETAIL = { ...SUB, proxy_login: 'example-login', proxy_password: 'example-pass' };
const SUB2 = { ...SUB, id: '3f2c8a1e-0000-4000-8000-000000000002', http_port: 8002, socks_port: 9002, server_name: 'Orange (Paris)' };
const DETAIL2 = { ...SUB2, proxy_login: 'example-login-2', proxy_password: 'example-pass-2' };
const list = (results, next = null) => ({ count: results.length, next, previous: null, results });

const section = { from: '// ---- ProxyUDP (mobile', to: '// ---- Zokol (French mobile', names: ['fetchProxyUdpPool', 'rotateProxyUdp'] };
const router = (subs, details, extra = {}) => (call) => {
  if (extra[call.url]) return extra[call.url](call);
  if (/\/subscriptions\/\?active=true&page=1$/.test(call.url)) return list(subs);
  const m = /\/subscriptions\/([^/?]+)\/$/.exec(call.url);
  if (m) return details.find((d) => d.id === decodeURIComponent(m[1]));
  throw new Error(`no route for ${call.url}`);
};

test('a leading flag gives the country (inferred from the catalog); no flag leaves it to the health check', () => {
  assert.equal(U.proxyUdpFlagCountry('🇩🇪 1&1 Versatel (Sachsen)'), 'DE');
  assert.equal(U.proxyUdpFlagCountry('🇬🇧 EE (London)'), 'GB');
  assert.equal(U.proxyUdpFlagCountry('Orange (Paris)'), '');
  assert.equal(U.proxyUdpFlagCountry(null), '');
});

test('the subscription list keeps active, unexpired ports and pages on `next`', () => {
  const r = U.proxyUdpSubscriptions(list([SUB, { ...SUB, status: 'expired' }, { ...SUB, status: 'error_modem_offline' }, { ...SUB, expires_at: '2026-11-01T00:00:00Z' }, { ...SUB, id: '../x' }], 'https://proxyudp.com/api/v1/subscriptions/?active=true&page=2'), { now: NOW });
  assert.deepEqual(r.active.map((s) => s.id), [SUB.id]);
  assert.equal(r.listed, 5);
  assert.equal(r.more, true);
  assert.equal(U.proxyUdpSubscriptions(list([SUB])).more, false);
  assert.equal(U.proxyUdpSubscriptions('<html>').active.length, 0);
});

test('a detail maps to a row on the chosen port; ports without a login are counted', () => {
  const h = U.proxyUdpRows([DETAIL], { now: NOW }).rows[0];
  assert.deepEqual([h.type, h.host, h.port, h.username, h.password, h.country], ['HTTP', '203.0.113.10', 8001, 'example-login', 'example-pass', 'DE']);
  assert.equal(h.label, 'ProxyUDP • 1&1 Versatel (Sachsen) • 8001 • until 2099-12-02');
  assert.equal(h.rotationUrl, undefined, 'the API has no rotation link');
  const s = U.proxyUdpRows([DETAIL], { socks: true, now: NOW }).rows[0];
  assert.deepEqual([s.type, s.port], ['SOCKS5', 9001]);
  assert.equal(U.proxyUdpRows([DETAIL2], { now: NOW }).rows[0].country, null);
  const r = U.proxyUdpRows([{ ...DETAIL, proxy_password: null }, { ...DETAIL, status: 'expired' }], { now: NOW });
  assert.deepEqual([r.rows.length, r.noLogin], [0, 1]);
});

test('the pull: Token header, How many caps the detail calls, never a followed URL', async () => {
  const p = load({ ...section, route: router([SUB, SUB2], [DETAIL, DETAIL2]) });
  await assert.rejects(p.fetchProxyUdpPool({ token: '' }), /paste the API token from Dashboard, API Access\./);
  await assert.rejects(p.fetchProxyUdpPool({ token: 'a b' }), /paste the API token/);
  assert.equal(p.calls.length, 0);
  const rows = await p.fetchProxyUdpPool({ token: TOKEN, count: '' });
  assert.equal(rows.length, 2);
  assert.deepEqual(p.calls.map((c) => c.url), [
    'https://proxyudp.com/api/v1/subscriptions/?active=true&page=1',
    `https://proxyudp.com/api/v1/subscriptions/${SUB.id}/`,
    `https://proxyudp.com/api/v1/subscriptions/${SUB2.id}/`
  ]);
  assert.ok(p.calls.every((c) => c.headers.Authorization === `Token ${TOKEN}` && c.method === 'GET'));
  const one = load({ ...section, route: router([SUB, SUB2], [DETAIL, DETAIL2]) });
  assert.equal((await one.fetchProxyUdpPool({ token: TOKEN, count: '1' })).length, 1);
  assert.equal(one.calls.length, 2, 'one list call and one detail call');
  // `next` asks for page 2 by number; its URL (here another host) is never fetched.
  const paged = load({
    ...section,
    route: (call) => {
      if (call.url.endsWith('page=1')) return list([SUB], 'https://elsewhere.example/steal?page=2');
      if (call.url.endsWith('page=2')) return list([SUB2]);
      return [DETAIL, DETAIL2].find((d) => call.url.includes(d.id));
    }
  });
  assert.equal((await paged.fetchProxyUdpPool({ token: TOKEN })).length, 2);
  assert.ok(paged.calls.every((c) => c.url.startsWith('https://proxyudp.com/api/v1/')));
});

test('the pull says why nothing was added, and keeps what it read before a rate limit', async () => {
  await assert.rejects(load({ ...section, route: () => list([]) }).fetchProxyUdpPool({ token: TOKEN }), /no active ports on this account\. Buy one, or check that your test ports are live\./);
  await assert.rejects(load({ ...section, route: router([SUB], [{ ...DETAIL, proxy_login: '' }]) }).fetchProxyUdpPool({ token: TOKEN }), /1 active port has no username and password, so it was left out\./);
  await assert.rejects(load({ ...section, route: () => { throw httpError(401, '{"detail":"Invalid token."}'); } }).fetchProxyUdpPool({ token: TOKEN }), /ProxyUDP rejected the API token\. Copy it again from Dashboard, API Access\./);
  await assert.rejects(load({ ...section, route: () => { throw httpError(403, '{}'); } }).fetchProxyUdpPool({ token: TOKEN }), /refused access for this token/);
  await assert.rejects(load({ ...section, route: () => { throw httpError(429, '{}', { retryAfter: '120' }); } }).fetchProxyUdpPool({ token: TOKEN }), /too many requests\. Wait 120 seconds/);
  const third = { ...SUB, id: '3f2c8a1e-0000-4000-8000-000000000003', http_port: 8003 };
  const limited = load({
    ...section,
    route: router([SUB, SUB2, third], [DETAIL, DETAIL2], { [`https://proxyudp.com/api/v1/subscriptions/${third.id}/`]: () => { throw httpError(429, '{}'); } })
  });
  const rows = await limited.fetchProxyUdpPool({ token: TOKEN });
  assert.equal(rows.length, 2);
  assert.match(rows[0].label, /\(2 of 3, ProxyUDP asked to slow down\)$/);
});

test('Rotate IP goes through the provider-API hook for every pulled ProxyUDP row; a stored link still wins', () => {
  const r = loadRotation();
  const row = { provider: 'proxyudp', host: '203.0.113.10', port: 8001, username: 'example-login', password: 'x' };
  assert.equal(r.apiRotationProvider(row), 'proxyudp');
  assert.equal(r.proxyCanRotate(row), true);
  assert.equal(typeof r.PROVIDER_ROTATORS.proxyudp, 'function');
  assert.equal(r.apiRotationProvider({ ...row, provider: 'coronium' }), '');
  assert.equal(r.apiRotationProvider({ ...row, host: '' }), '');
  assert.match(fnSrc('rotateProxyIp'), /const apiVendor = rotationUrl \? '' : apiRotationProvider\(proxy\);/);
});

test('rotateProxyUdp: the saved token finds the port and POSTs rotate-ip; replies become clear messages', async () => {
  const proxy = { provider: 'proxyudp', host: '203.0.113.10', port: 9001, username: 'example-login', password: 'example-pass' };
  const rotateUrl = `https://proxyudp.com/api/v1/subscriptions/${SUB.id}/rotate-ip/`;
  const none = load({ ...section, route: router([SUB], [DETAIL]) });
  await assert.rejects(none.rotateProxyUdp(proxy), /Rotate IP needs the API token saved on the Proxy providers page/);
  assert.equal(none.calls.length, 0);
  const ok = load({ ...section, saved: { proxyudp: { token: TOKEN } }, route: router([SUB2, SUB], [], { [rotateUrl]: () => ({ status: 'ok', message: 'IP changed', code: 'ok', changed: true, success: true, egress_ip: '198.51.100.7' }) }) });
  const res = await ok.rotateProxyUdp(proxy);
  assert.deepEqual([res.ok, res.response, res.provider], [true, 'New IP 198.51.100.7', 'proxyudp']);
  const post = ok.calls.find((c) => c.url === rotateUrl);
  assert.equal(post.method, 'POST', 'matched by address and SOCKS5 port');
  assert.equal(post.headers.Authorization, `Token ${TOKEN}`);
  assert.ok(post.timeoutMs >= 60000, 'a carrier can be slow');
  const busy = load({ ...section, saved: { proxyudp: { token: TOKEN } }, route: router([SUB], [], { [rotateUrl]: () => { throw httpError(409, { success: false, message: 'Modem busy', code: 'busy' }, { retryAfter: '30' }); } }) });
  await assert.rejects(busy.rotateProxyUdp(proxy), /ProxyUDP: the modem is busy\. Try again in 30 seconds\./);
  const refused = load({ ...section, saved: { proxyudp: { token: TOKEN } }, route: router([SUB], [], { [rotateUrl]: () => ({ success: false, message: `no rotation for ${TOKEN}` }) }) });
  await assert.rejects(refused.rotateProxyUdp(proxy), (e) => /ProxyUDP did not change the IP/.test(e.message) && !e.message.includes(TOKEN));
  const gone = load({ ...section, saved: { proxyudp: { token: TOKEN } }, route: router([SUB2], []) });
  await assert.rejects(gone.rotateProxyUdp(proxy), /not one of the active ports of the saved token's account/);
});

test('the rotate-ip outcome: the same IP is not a failure; unknown statuses are', () => {
  assert.match(U.proxyUdpRotateOutcome(200, { success: true, changed: false, egress_ip: '198.51.100.7' }).response, /kept the same IP \(198\.51\.100\.7\)/);
  assert.equal(U.proxyUdpRotateOutcome(503, '{}').message, 'ProxyUDP: the modem is busy. Try again in a minute.');
  assert.match(U.proxyUdpRotateOutcome(400, '{"message":"Rotation not available for this plan"}').message, /refused the IP change: Rotation not available for this plan\./);
  assert.match(U.proxyUdpRotateOutcome(500, '').message, /could not reach the API/);
});

test('account check: /me/ balance in USD, the active ports\' plans and next expiry', async () => {
  const seen = [];
  const get = async (url, opts = {}) => {
    seen.push({ url, headers: opts.headers || {} });
    if (url.endsWith('/me/')) return JSON.stringify({ id: 7, username: 'example', email: 'x@example.com', date_joined: '2026-11-01T00:00:00Z', balance: '12.50', active_subscriptions: 2 });
    return JSON.stringify(list([SUB, { ...SUB2, expires_at: '2026-12-02T00:00:00Z' }]));
  };
  const r = await pa.checkProviderAccount('proxyudp', { token: TOKEN }, get, { now: NOW });
  assert.deepEqual(seen.map((s) => s.url), ['https://proxyudp.com/api/v1/me/', 'https://proxyudp.com/api/v1/subscriptions/?active=true&page=1']);
  assert.equal(seen[0].headers.Authorization, `Token ${TOKEN}`);
  assert.deepEqual([r.account.status, r.account.plan, r.account.expiresAt, r.account.balance, r.account.currency, r.account.note],
    ['active', '1&1 Versatel (Sachsen), Orange (Paris)', '2026-12-02T00:00:00.000Z', 12.5, 'USD', 'firstToExpire']);
  assert.equal(r.dashboardUrl, 'https://proxyudp.com/en/account/dashboard/');
});

test('ProxyUDP is wired, never calls an action endpoint while pulling, and has its strings', () => {
  const sec = between('// ---- ProxyUDP (mobile', '// ---- Zokol (French mobile');
  const code = sec.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /\/auth\/|\/orders|rotate-all|reboot-modem|change-os|toggle-auto-renew|refresh|referrals/);
  assert.equal((code.match(/rotate-ip\//g) || []).length, 1, 'only rotateProxyUdp changes the IP');
  assert.doesNotMatch(fnSrc('fetchProxyUdpPool'), /rotate-ip/);
  assert.match(IPC, /proxyudp: fetchProxyUdpPool/);
  assert.match(IPC, /proxyudp: 'ProxyUDP'/);
  assert.match(IPC, /proxyudp: \(proxy\) => rotateProxyUdp\(proxy\)/);
  assert.match(providerLine('proxyudp'), /creds: \['token'\], noCountry: true, count: true, list: true, proto: true/);
  for (const lang of ['en', 'es']) {
    const hint = LOCALES[lang].proxyProviders.geoHints.proxyudp;
    assert.equal(typeof hint, 'string', lang);
    assert.doesNotMatch(hint, /[–—]/, `${lang}: no em or en dashes`);
  }
  assert.match(LOCALES.en.proxyProviders.geoHints.proxyudp, /Rotate IP asks ProxyUDP for a new IP with your saved token/);
});
