'use strict';
// iProxy.online connector. Fixtures follow the Console-API Swagger (iproxy.online/docs/swagger,
// specs/console/Console-API.yaml) and the guide at iproxy.online/docs-api-console (read 2026-11-10):
// GET /proxy-access, GET /actionlinks?action=changeip, GET /connections (the guide: /connection) and
// the { code, error, req_id } error body. Built from the docs only; no test reaches iProxy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');
const pa = require('../src/main/providerAccount');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lang, 'cmpSettingsC.json'), 'utf8'));

const KEY = 'ipx_TEST_user_key_0000';
const NOW = Date.parse('2026-11-10T12:00:00Z');

const between = (from, to) => {
  const a = IPC.indexOf(from);
  const b = IPC.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `section ${from} .. ${to} must exist`);
  return IPC.slice(a, b);
};
const fnSrc = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};
const SECTION = between('// ---- iProxy.online (your own phones', '// ---- ProxyBrazil (dedicated 4G');
const httpError = (status, body = '') => Object.assign(new Error(`HTTP ${status} ${body}`.trim()), { status });

const access = (over = {}) => ({
  id: 'pa1', connection_id: 'c1', description: 'Main HTTP', listen_service: 'http', auth_type: 'userpass',
  auth: { login: 'phoneuser', password: 'phonepass' }, ip: '203.0.113.7', port: 31001, hostname: 'x1.iproxy.online',
  expires_at: null, deactivated_at: null, deactivated_by_trigger: null, ...over
});
const ACCESSES = { proxy_accesses: [
  access(),
  access({ id: 'pa2', description: 'Socks', listen_service: 'socks5', port: 31002 }),
  access({ id: 'pa3', connection_id: 'c2', description: '', port: 31003, hostname: '' }),
  access({ id: 'pa4', auth_type: 'noauth', auth: {}, port: 31004 }),
  access({ id: 'pa5', deactivated_at: '2026-11-01T00:00:00Z', port: 31005 }),
  access({ id: 'pa6', expires_at: '2026-11-09T00:00:00Z', port: 31006 })
] };
const LINKS = { action_links: [
  { connection_id: 'c1', id: 'l-old', link: 'https://i.fxdx.in/actionlinks/do/changeip/OLDID', action: 'changeip', comment: '', created_at: '2026-10-01T00:00:00Z' },
  { connection_id: 'c1', id: 'l-new', link: 'https://i.fxdx.in/actionlinks/do/changeip/NEWID', action: 'changeip', comment: '', created_at: '2026-11-01T00:00:00Z' }
] };
const CONNECTIONS = { connections: [
  { id: 'c1', basic_info: { name: 'Pixel 7', server_geo: { country: 'DE', city: 'Frankfurt' } }, plan_info: { active_plan: { expires_at: '2026-11-12T00:00:00Z' } }, app_data: { ip_country_code: 'us', ip_city: 'Dallas', ready_to_change_ip: true, last_activity_at: '2026-11-10T11:59:00Z' } },
  { id: 'c2', basic_info: { name: 'Galaxy A12' }, plan_info: { active_plan: null }, app_data: { ip_country_code: 'gb' } }
] };

function load(routes) {
  const calls = [];
  const httpRequestText = async (url, options = {}) => {
    calls.push({ url, headers: options.headers || {} });
    const pathName = url.replace('https://iproxy.online/api/console/v1', '');
    const r = routes[pathName];
    if (typeof r === 'function') return r();
    if (r === undefined) throw httpError(404, '{"code":"NotFound","error":"not found","req_id":"r1","data":null}');
    return JSON.stringify(r);
  };
  const scope = { ...U, httpRequestText, iproxyRows: (a, l, c, o) => U.iproxyRows(a, l, c, { ...o, now: NOW }) };
  const consts = `const LIST_IMPORT_MAX = ${/const LIST_IMPORT_MAX = (\d+);/.exec(IPC)[1]};`;
  const code = [consts, fnSrc('clampPoolCount'), fnSrc('limitListRows'), SECTION].join('\n');
  // eslint-disable-next-line no-new-func
  const api = new Function(...Object.keys(scope), `${code}\nreturn { fetchIproxyPool };`)(...Object.values(scope));
  return { ...api, calls };
}
const ALL = { '/proxy-access': ACCESSES, '/actionlinks?action=changeip': LINKS, '/connections': CONNECTIONS };

// ---- The rows ----

test('HTTP and SOCKS5 accesses become rows; noauth, turned-off and expired ones are counted, not added', () => {
  const http = U.iproxyRows(ACCESSES, LINKS, CONNECTIONS, { now: NOW });
  assert.deepEqual(http.rows.map((r) => r.port), [31001, 31003]);
  const [a, b] = http.rows;
  assert.deepEqual([a.type, a.host, a.username, a.password, a.country], ['HTTP', 'x1.iproxy.online', 'phoneuser', 'phonepass', 'US']);
  assert.equal(a.label, 'iProxy • Pixel 7 • Main HTTP • US');
  assert.equal(b.host, '203.0.113.7', 'the ip when the access has no hostname');
  assert.equal(b.label, 'iProxy • Galaxy A12 • #pa3 • GB');
  assert.deepEqual([http.total, http.noAuth, http.inactive, http.wrongProtocol], [6, 1, 2, 1]);
  const socks = U.iproxyRows(ACCESSES, LINKS, CONNECTIONS, { socks: true, now: NOW });
  assert.deepEqual(socks.rows.map((r) => [r.type, r.port]), [['SOCKS5', 31002]]);
});

test('each row keeps its phone\'s newest change-IP link; a phone without one is counted', () => {
  const r = U.iproxyRows(ACCESSES, LINKS, CONNECTIONS, { now: NOW });
  assert.equal(r.rows[0].rotationUrl, 'https://i.fxdx.in/actionlinks/do/changeip/NEWID');
  assert.equal(r.rows[1].rotationUrl, null);
  assert.equal(r.noLinkPhones, 1);
  const shuffled = { action_links: [...LINKS.action_links].reverse() };
  assert.equal(U.iproxyChangeIpLinks(shuffled).get('c1'), 'https://i.fxdx.in/actionlinks/do/changeip/NEWID', 'newest by created_at, in any order');
});

test('a link is kept only when it is https and carries no account key', () => {
  const links = { action_links: [
    { connection_id: 'c1', link: 'http://i.fxdx.in/actionlinks/do/changeip/X', action: 'changeip' },
    { connection_id: 'c2', link: `https://i.fxdx.in/actionlinks/do/changeip/Y?key=${KEY}`, action: 'changeip' },
    { connection_id: 'c3', link: 'https://i.fxdx.in/actionlinks/do/reboot/Z', action: 'reboot' }
  ] };
  const m = U.iproxyChangeIpLinks(links, { key: KEY });
  assert.equal(m.size, 0);
});

// ---- The pull ----

test('a pull reads accesses, links and phones with the Bearer key, and never makes or changes anything', async () => {
  const a = load(ALL);
  const rows = await a.fetchIproxyPool({ token: KEY, count: '' });
  assert.deepEqual(a.calls.map((c) => c.url), [
    'https://iproxy.online/api/console/v1/proxy-access',
    'https://iproxy.online/api/console/v1/actionlinks?action=changeip',
    'https://iproxy.online/api/console/v1/connections'
  ]);
  assert.equal(a.calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.notice, { code: 'noChangeIpLink', count: 1 });
  assert.equal((await a.fetchIproxyPool({ token: KEY, count: '1' })).length, 1, 'How many caps the list');
  assert.doesNotMatch(SECTION, /['`]\/(me\/api-key|command-push|credentials\/export)/, 'no call that voids the key or acts on a phone');
  assert.doesNotMatch(SECTION, /method: 'POST'|method: 'DELETE'/);
});

test('/connections falls back to the guide\'s /connection; links and names are optional', async () => {
  const a = load({ '/proxy-access': ACCESSES, '/actionlinks?action=changeip': LINKS, '/connection': CONNECTIONS });
  const rows = await a.fetchIproxyPool({ token: KEY });
  assert.equal(a.calls[3].url, 'https://iproxy.online/api/console/v1/connection');
  assert.equal(rows[0].label, 'iProxy • Pixel 7 • Main HTTP • US');
  const b = load({ '/proxy-access': ACCESSES, '/actionlinks?action=changeip': () => { throw httpError(500, '{"code":"InternalServerError"}'); } });
  const bare = await b.fetchIproxyPool({ token: KEY });
  assert.equal(bare.length, 2, 'the proxies still come in');
  assert.equal(bare[0].rotationUrl, null);
  assert.equal(bare[0].country, null, 'the health check fills the country');
  assert.deepEqual(bare.notice, { code: 'noChangeIpLink', count: 2 });
});

test('every failure has a clear message, and none echoes the key', async () => {
  const cases = [
    [{ '/proxy-access': () => { throw httpError(401, '{"code":"Unauthorized","error":"Unauthorized","req_id":"r1"}'); } }, /rejected the API key\. If you generated a new one, the old one stopped working\./],
    [{ '/proxy-access': () => { throw httpError(403, '{"code":"Forbidden"}'); } }, /refused this API key \(Forbidden\)/],
    [{ '/proxy-access': () => { throw httpError(429, ''); } }, /too many requests/],
    [{ '/proxy-access': () => { throw new Error(`socket hang up Bearer ${KEY}`); } }, /could not read your proxy accesses/],
    [{ ...ALL, '/actionlinks?action=changeip': () => { throw httpError(401, ''); } }, /rejected the API key/],
    [{ '/proxy-access': { proxy_accesses: [] } }, /none of your phones has a HTTP proxy access with a login/],
    [{ '/proxy-access': { proxy_accesses: [access({ auth_type: 'noauth', auth: {} })] } }, /use no login \(IP restriction only\)/],
    [{ '/proxy-access': { proxy_accesses: [access({ deactivated_at: '2026-11-01T00:00:00Z' })] } }, /turned off or expired/],
    [{ '/proxy-access': { proxy_accesses: [access({ listen_service: 'socks5' })] } }, /none of your phones has a HTTP proxy access/]
  ];
  for (const [routes, want] of cases) {
    await assert.rejects(load(routes).fetchIproxyPool({ token: KEY }), (e) => want.test(e.message) && !e.message.includes(KEY), String(want));
  }
  await assert.rejects(load(ALL).fetchIproxyPool({ token: '' }), /paste the user API key from your dashboard/);
  assert.doesNotMatch(SECTION, /new Error\([^;]*\berror\.message\b/, 'a transport error is never echoed');
});

test('the pull result carries the notice, and the form shows it in en and es', () => {
  const sync = fnSrc('syncVendorPool');
  assert.match(sync, /if \(rows && rows\.notice && typeof rows\.notice === 'object'/);
  assert.match(sync, /result\.notice = \{ code: String\(rows\.notice\.code\), count:/);
  assert.match(UI, /const RESULT_NOTICES = \['noChangeIpLink'\];/);
  assert.match(UI, /t\(`proxyProviders\.result\.\$\{syncResult\.notice\.code\}`, \{ count: syncResult\.notice\.count \}\)/);
  for (const lang of ['en', 'es']) {
    const r = locale(lang).proxyProviders.result;
    for (const k of ['noChangeIpLink_one', 'noChangeIpLink_other']) {
      assert.match(r[k], /\{\{count\}\}/, `${lang} ${k}`);
      assert.doesNotMatch(r[k], /[–—]/);
    }
  }
});

// ---- Account check ----

test('account: phones with an active plan, and the next plan to end', async () => {
  const seen = [];
  const r = await pa.checkProviderAccount('iproxy', { token: KEY }, async (url, opts) => { seen.push({ url, headers: opts.headers }); return JSON.stringify(CONNECTIONS); }, { now: NOW });
  assert.equal(seen[0].url, 'https://iproxy.online/api/console/v1/connections');
  assert.equal(seen[0].headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual([r.account.status, r.account.expiresAt, r.account.trafficLeftGb, r.account.note], ['active', '2026-11-12T00:00:00.000Z', null, null]);
  const seen2 = [];
  await pa.checkProviderAccount('iproxy', { token: KEY }, async (url) => {
    seen2.push(url);
    if (url.endsWith('/connections')) throw Object.assign(new Error('HTTP 404'), { status: 404 });
    return JSON.stringify(CONNECTIONS);
  }, { now: NOW });
  assert.deepEqual(seen2.map((u) => u.split('/').pop()), ['connections', 'connection']);
  assert.equal(pa.parsers.iproxy({ connections: [] }).note, 'noActivePlans');
  await assert.rejects(pa.checkProviderAccount('iproxy', { token: KEY }, async () => { throw httpError(401); }), (e) => /rejected the saved API key/.test(e.message) && !e.message.includes(KEY));
});

// ---- Wiring ----

test('iProxy.online is wired: registry, PROVIDERS entry, en and es hint', () => {
  assert.match(IPC, /iproxy: 'iProxy\.online'/);
  assert.match(IPC, /iproxy: fetchIproxyPool/);
  const line = UI.split(/\r?\n/).find((l) => l.includes("{ key: 'iproxy',"));
  assert.ok(line, 'PROVIDERS entry');
  assert.match(line, /referral: 'https:\/\/iproxy\.online\/'/);
  assert.match(line, /creds: \['token'\], labels: \{ token: 'apiKeyLabel' \}, noCountry: true, count: true, list: true, proto: true/);
  for (const lang of ['en', 'es']) {
    const hint = locale(lang).proxyProviders.geoHints.iproxy;
    assert.equal(typeof hint, 'string', lang);
    assert.doesNotMatch(hint, /[–—]/, 'no em or en dashes');
  }
});
