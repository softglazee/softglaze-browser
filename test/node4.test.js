'use strict';
// Node4 connector. Fixtures follow the public OpenAPI 3.1.0 at node4.io/api/v1/openapi.json (read
// 2026-11-10): POST /gateways/endpoint (endpoints[] per session), GET /proxies/list, GET /status,
// GET /geo/countries and the 429 body. Built from the docs only; no test reaches Node4.
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

const KEY = 'n4k_TESTKEY0000example';

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
const SECTION = between('// ---- Node4 (gateway builder', '// ---- ProxyEmpire (proxy-list');

const httpError = (status, body = '', headers = {}) => Object.assign(new Error(`HTTP ${status} ${body}`.trim()), { status, headers });

// A gateway reply as documented: one endpoints[] item per session (top-level fields mirror the first).
function gatewayReply(body, start = 0) {
  const sticky = Boolean(body.sticky);
  const endpoints = sticky
    ? Array.from({ length: body.count }, (_, i) => ({ sessionId: `s${start + i}`, host: 'gw-residential.node4.io', port: body.protocol === 'socks5' ? 1082 : 8082, username: `cust-res-country-${body.country || 'any'}-session-s${start + i}`, password: 'pw-example' }))
    : [];
  return JSON.stringify({ success: true, data: { product: body.product, name: 'Residential', protocol: body.protocol, rotation: 'per_connection', sticky: { enabled: sticky, maxSeconds: 1800 }, sessionId: sticky ? 's0' : null, host: 'gw-residential.node4.io', port: body.protocol === 'socks5' ? 1082 : 8082, username: 'cust-res', password: 'pw-example', endpoints } });
}

const STATIC_LIST = { success: true, data: [
  { host: '198.51.100.10', port: 8080, username: 'u1', password: 'p1', protocol: 'http', type: 'premium_private', country: 'us' },
  { host: '198.51.100.11', port: 8080, username: 'u2', password: 'p2', protocol: 'http', type: 'shared', country: 'it' },
  { host: '198.51.100.12', port: 1080, username: 'u3', password: 'p3', protocol: 'socks5', type: 'premium_private', country: 'us' },
  { host: '198.51.100.13', port: 8080, username: '', password: '', protocol: 'http', type: 'shared', country: 'es' },
  { host: 'gw-residential.node4.io', port: 8082, username: 'u5', password: 'p5', protocol: 'http', type: 'residential', country: 'us' }
] };

function load(route) {
  const calls = [];
  const sleeps = [];
  let n = 0;
  const httpRequestText = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method: options.method || 'GET', headers: options.headers || {}, body });
    return route(url, body, n++);
  };
  const scope = { ...U, httpRequestText, sleepMs: async (ms) => { sleeps.push(ms); } };
  const consts = `const MINTED_PULL_MAX = ${/const MINTED_PULL_MAX = (\d+);/.exec(IPC)[1]};\nconst LIST_IMPORT_MAX = ${/const LIST_IMPORT_MAX = (\d+);/.exec(IPC)[1]};`;
  const code = [consts, fnSrc('normCountryCode'), fnSrc('clampPoolCount'), fnSrc('limitListRows'), SECTION].join('\n');
  // eslint-disable-next-line no-new-func
  const api = new Function(...Object.keys(scope), `${code}\nreturn { node4Call, fetchNode4Pool, lookupNode4 };`)(...Object.values(scope));
  return { ...api, calls, sleeps };
}

// ---- The body builder ----

test('the gateway body: product, protocol, lowercase targeting, sticky only above one, no ttl', () => {
  const b = U.node4GatewayBody({ pool: 'residential', socks: true, country: 'US', state: 'TX', city: 'Austin', asn: 'AS7922', count: 5, sticky: true });
  assert.deepEqual(b, { product: 'residential', protocol: 'socks5', country: 'us', state: 'tx', city: 'austin', asn: '7922', sticky: true, count: 5 });
  assert.equal(Object.prototype.hasOwnProperty.call(b, 'ttl'), false, 'ttl is not selectable');
  assert.deepEqual(U.node4GatewayBody({ pool: 'residential', count: 9 }), { product: 'residential', protocol: 'http', sticky: false, count: 1 }, 'rotating is one login');
  assert.equal(U.node4GatewayBody({ pool: 'residential', count: 500, sticky: true }).count, 100, '100 a call');
  assert.equal(U.node4GatewayBody({ pool: 'residential', country: 'GB' }).country, 'gb');
  assert.equal(U.node4GatewayBody({ pool: 'residential', country: 'UK' }).country, 'gb', 'the UK is gb');
  assert.equal(U.node4GatewayBody({ pool: 'residential', country: 'US', city: 'New York' }).city, 'newyork');
  assert.equal(U.node4GatewayBody({ pool: 'rotating_unmetered', country: 'US' }).product, 'rotating_unmetered');
});

test('state, city and ASN are Residential only; a state or city needs a country', () => {
  for (const pool of ['rotating_datacenter', 'rotating_unmetered']) {
    for (const extra of [{ state: 'tx' }, { city: 'austin' }, { asn: '7922' }]) {
      assert.throws(() => U.node4GatewayBody({ pool, country: 'US', ...extra }), /state, city and ASN work on Residential only/, `${pool} ${JSON.stringify(extra)}`);
    }
  }
  assert.throws(() => U.node4GatewayBody({ pool: 'residential', state: 'TX' }), /pick a country before a state or city/);
  assert.throws(() => U.node4GatewayBody({ pool: 'residential', country: 'US', state: 'Texas' }), /2 or 3 letter code/);
  assert.throws(() => U.node4GatewayBody({ pool: 'residential', asn: 'Comcast' }), /ASN is digits only/);
  assert.throws(() => U.node4GatewayBody({ pool: 'residential', country: 'USA' }), /not a country code/);
  assert.throws(() => U.node4GatewayBody({ pool: 'nope' }), /pick Residential/);
});

// ---- Reply parsers ----

test('gateway rows come from endpoints[], or the single endpoint when that list is empty', () => {
  const many = U.node4GatewayRows(gatewayReply({ product: 'residential', protocol: 'http', country: 'us', sticky: true, count: 3 }), { name: 'Residential', country: 'us' });
  assert.equal(many.length, 3);
  assert.deepEqual([many[0].type, many[0].host, many[0].port, many[0].password, many[0].country], ['HTTP', 'gw-residential.node4.io', 8082, 'pw-example', 'US']);
  assert.match(many[0].label, /^Node4 • Residential • US • sticky s0$/);
  const one = U.node4GatewayRows(gatewayReply({ product: 'residential', protocol: 'socks5', sticky: false, count: 1 }), { socks: true, name: 'Residential' });
  assert.equal(one.length, 1);
  assert.deepEqual([one[0].type, one[0].port, one[0].username], ['SOCKS5', 1082, 'cust-res']);
  assert.match(one[0].label, /Any country • rotating$/);
  // The bare object (no envelope) parses the same, and a broken item is skipped.
  const bare = U.node4GatewayRows({ endpoints: [{ host: 'gw.example', port: '8083', username: 'a', password: 'b', sessionId: 'x' }, { host: 'bad host', port: 1, username: 'a', password: 'b' }] }, { name: 'Rotating Datacenter' });
  assert.equal(bare.length, 1);
  assert.equal(bare[0].port, 8083);
  assert.deepEqual(U.node4GatewayRows('not json'), []);
});

test('static rows: Premium and Shared only, the chosen protocol only, logins required', () => {
  const http = U.node4StaticRows(STATIC_LIST, { socks: false });
  assert.deepEqual(http.rows.map((r) => r.host), ['198.51.100.10', '198.51.100.11']);
  assert.match(http.rows[0].label, /^Node4 • Premium Datacenter • US • 198\.51\.100\.10$/);
  assert.match(http.rows[1].label, /^Node4 • Shared Datacenter • IT • /);
  assert.deepEqual([http.total, http.skippedType, http.skippedProtocol, http.noLogin], [5, 1, 1, 1]);
  const socks = U.node4StaticRows(JSON.stringify(STATIC_LIST), { socks: true });
  assert.deepEqual(socks.rows.map((r) => [r.type, r.host, r.port]), [['SOCKS5', '198.51.100.12', 1080]]);
});

// ---- The pull ----

test('a bad key, or targeting a product does not take, stops before any call', async () => {
  const a = load(() => { throw new Error('no call expected'); });
  await assert.rejects(a.fetchNode4Pool({ token: 'not-a-key', poolType: 'residential' }), /It starts with n4k_/);
  await assert.rejects(a.fetchNode4Pool({ token: KEY, poolType: 'rotating_datacenter', country: 'US', city: 'austin' }), /Residential only/);
  await assert.rejects(a.fetchNode4Pool({ token: KEY, poolType: 'static', asn: '7922' }), /Residential only/);
  assert.equal(a.calls.length, 0);
});

test('How many 1 is one rotating login; more are sticky, 100 a call, up to 1000', async () => {
  const a = load((url, body, i) => gatewayReply(body, i * 100));
  const one = await a.fetchNode4Pool({ token: KEY, poolType: 'residential', country: 'US', count: '1' });
  assert.equal(one.length, 1);
  assert.match(one[0].label, /rotating$/);
  assert.equal(a.calls[0].url, 'https://node4.io/api/v1/gateways/endpoint');
  assert.equal(a.calls[0].method, 'POST');
  assert.equal(a.calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(a.calls[0].headers['X-API-Key'], undefined, 'one auth header, not both');
  assert.deepEqual(a.calls[0].body, { product: 'residential', protocol: 'http', country: 'us', sticky: false, count: 1 });

  const b = load((url, body, i) => gatewayReply(body, i * 100));
  const many = await b.fetchNode4Pool({ token: KEY, poolType: 'residential', country: 'US', state: 'TX', city: 'Austin', count: '150', proxyType: 'socks5' });
  assert.equal(many.length, 150);
  assert.equal(new Set(many.map((r) => r.username)).size, 150);
  assert.deepEqual(b.calls.map((c) => [c.body.count, c.body.sticky]), [[100, true], [50, true]]);
  assert.equal(b.calls[1].body.state, 'tx');
  assert.equal(many[0].type, 'SOCKS5');
  assert.equal(b.sleeps.length, 1, 'calls are spaced (60 a minute per key)');

  const c = load((url, body, i) => gatewayReply(body, i * 100));
  assert.equal((await c.fetchNode4Pool({ token: KEY, poolType: 'residential', count: '5000' })).length, 1000);
  assert.equal(c.calls.length, 10, 'at most 10 calls');
});

test('Static Datacenter lists the account\'s IPs, filtered by country and protocol', async () => {
  const a = load(() => JSON.stringify(STATIC_LIST));
  const rows = await a.fetchNode4Pool({ token: KEY, poolType: 'static', country: 'IT' });
  assert.equal(a.calls[0].url, 'https://node4.io/api/v1/proxies/list?format=json&fields=host,port,username,password,protocol,type,country');
  assert.deepEqual(rows.map((r) => r.host), ['198.51.100.11']);
  await assert.rejects(a.fetchNode4Pool({ token: KEY, poolType: 'static', country: 'DE' }), /no static proxies in DE on this account\. You have US, IT\./);
  assert.equal((await a.fetchNode4Pool({ token: KEY, poolType: 'static', count: '1' })).length, 1);
  const empty = load(() => JSON.stringify({ success: true, data: [] }));
  await assert.rejects(empty.fetchNode4Pool({ token: KEY, poolType: 'static' }), /no active static proxies on this account/);
  const free = load(() => JSON.stringify({ success: true, data: [STATIC_LIST.data[3]] }));
  await assert.rejects(free.fetchNode4Pool({ token: KEY, poolType: 'static' }), /free tier uses IP authorization/);
  const socksOnly = load(() => JSON.stringify({ success: true, data: [STATIC_LIST.data[2]] }));
  await assert.rejects(socksOnly.fetchNode4Pool({ token: KEY, poolType: 'static' }), /listed for HTTP\. Switch Protocol/);
});

test('every documented failure has its own message, and none echoes the key', async () => {
  const cases = [
    [httpError(401, '{"error":"Invalid API key"}'), /rejected the API key, or it expired/],
    [httpError(403, '{"error":"Missing scope read:proxies"}'), /lacks the read:proxies permission/],
    [httpError(404, '{"error":"No active plan"}'), /no active Residential plan/],
    [httpError(409, '{"error":"Credential over limit"}'), /over its monthly limit/],
    [httpError(422, `{"error":"Country xx is not served. Served: us, gb (${KEY})"}`), /^Node4: Country xx is not served\. Served: us, gb \(\*\*\*\)\.$/],
    [httpError(429, '{"error":"Rate limit exceeded. Please wait before making more requests.","retryAfterSeconds":23,"limit":60,"windowSeconds":60}'), /Wait 23 seconds and pull again/],
    [httpError(429, '{"error":"Rate limit exceeded."}', { 'retry-after': '41' }), /Wait 41 seconds/],
    [Object.assign(httpError(429, '{"error":"Rate limit exceeded."}'), { headers: undefined, retryAfter: '17' }), /Wait 17 seconds/],
    [httpError(500, 'oops'), /answered HTTP 500/],
    [new Error(`connect ECONNREFUSED node4.io ${KEY}`), /could not reach the API/]
  ];
  for (const [err, want] of cases) {
    const a = load(() => { throw err; });
    await assert.rejects(a.fetchNode4Pool({ token: KEY, poolType: 'residential' }), (e) => want.test(e.message) && !e.message.includes(KEY), String(want));
  }
});

test('Load countries: Residential from /geo/countries; datacenter products use the plan countries without a call', async () => {
  const a = load(() => JSON.stringify({ countries: [{ code: 'us', name: 'United States', cityCount: 900, availableIps: 1000 }, { code: 'gb', name: 'United Kingdom', cityCount: 80, availableIps: 300 }, { code: '??', name: 'bad' }] }));
  const r = await a.lookupNode4({ token: KEY, groupby: 'country', poolType: 'residential' });
  assert.equal(a.calls[0].url, 'https://node4.io/api/v1/geo/countries');
  assert.deepEqual(r.geo.map((c) => c.key), ['GB', 'US']);
  const b = load(() => { throw new Error('no call expected'); });
  const dc = await b.lookupNode4({ token: KEY, groupby: 'country', poolType: 'rotating_datacenter' });
  assert.deepEqual(dc.geo.map((c) => c.key), ['US', 'IT', 'ES']);
  assert.equal(b.calls.length, 0);
});

test('Node4 is read-only: it never replaces, refreshes or writes', () => {
  assert.doesNotMatch(SECTION, /\/replace|\/refresh|\/credentials|\/sub-users|\/orders|\/topups|\/webhooks/);
  assert.doesNotMatch(SECTION, /ttl/);
  assert.doesNotMatch(SECTION, /throw new Error\([^;]*\berror\.message\b/, 'a transport error is never echoed');
});

// ---- Account check ----

test('account: GET /status gives the bandwidth when the plan is limited, and the reasons', async () => {
  const body = { success: true, data: { ok: true, reason: 'ok', message: 'ok', subscription: { active: true, status: 'active' }, bandwidth: { limited: true, usedMb: 2048, limitMb: 10240, remainingMb: 8192 }, proxies: { active: 5 } } };
  const seen = [];
  const r = await pa.checkProviderAccount('node4', { token: KEY }, async (url, opts) => { seen.push({ url, headers: opts.headers }); return JSON.stringify(body); });
  assert.equal(seen[0].url, 'https://node4.io/api/v1/status');
  assert.equal(seen[0].headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual([r.account.status, r.account.trafficUsedGb, r.account.trafficTotalGb, r.account.trafficLeftGb], ['active', 2, 10, 8]);
  assert.equal(r.account.dashboardUrl, 'https://node4.io/dashboard');
  const unlimited = pa.parsers.node4({ ok: true, bandwidth: { limited: false, usedMb: 512 } });
  assert.deepEqual([unlimited.trafficUsedGb, unlimited.trafficLeftGb, unlimited.trafficTotalGb], [0.5, null, null]);
  assert.equal(pa.parsers.node4({ ok: false, reason: 'no_active_proxies' }).note, 'noActiveProxies');
  assert.equal(pa.parsers.node4({ ok: false, reason: 'user_inactive' }).status, 'suspended');
  const over = pa.finalizeAccount(pa.parsers.node4({ ok: false, reason: 'plan_bandwidth_exceeded', bandwidth: { limited: true, usedMb: 1024, limitMb: 1024, remainingMb: 0 } }));
  assert.equal(over.trafficLeftGb, 0);
  await assert.rejects(pa.checkProviderAccount('node4', { token: KEY }, async () => { throw httpError(401); }), (e) => /read:proxies/.test(e.message) && !e.message.includes(KEY));
  await assert.rejects(pa.checkProviderAccount('node4', { token: 'abc' }, async () => '{}'), /does not start with n4k_/);
});

// ---- Wiring ----

test('Node4 is wired: registry, lookup, PROVIDERS entry with the live affiliate link, en and es hint', () => {
  assert.match(IPC, /node4: 'Node4'/);
  assert.match(IPC, /node4: fetchNode4Pool/);
  assert.match(IPC, /node4: lookupNode4/);
  const line = UI.split(/\r?\n/).find((l) => l.includes("{ key: 'node4',"));
  assert.ok(line, 'PROVIDERS entry');
  assert.match(line, /referral: 'https:\/\/node4\.io\?ref=REF-7643BU'/);
  assert.match(line, /creds: \['token'\], labels: \{ token: 'apiKeyLabel' \}/);
  assert.match(line, /\['static', 'Static Datacenter'\]/);
  assert.match(line, /geo: true, asn: true, countryLookup: true, noSession: true, proto: true/);
  assert.doesNotMatch(line, /life: true/, 'Node4 fixes the sticky time at 30 minutes');
  for (const lang of ['en', 'es']) {
    const hint = locale(lang).proxyProviders.geoHints.node4;
    assert.equal(typeof hint, 'string', lang);
    assert.match(hint, /n4k_/);
    assert.doesNotMatch(hint, /[–—]/, 'no em or en dashes');
  }
});
