'use strict';
// ProxyEmpire connector. Fixtures follow the public OpenAPI 3.0.3 "ProxyEmpire API" v2.0.0 at
// panel.proxyempire.io/docs (read 2026-11-10): GET /user slots, POST /proxy-list { message, count,
// proxies }, GET /countries and the 401/403/422/429 bodies. Built from the docs only; no test reaches
// ProxyEmpire.
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
const pull = () => import('../src/renderer/lib/gatewayPull.mjs');

const TOKEN = 'pe_TEST_token_0000';
const GB = 1024 ** 3;

const between = (from, to) => {
  const a = IPC.indexOf(from);
  const b = IPC.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `section ${from} .. ${to} must exist`);
  return IPC.slice(a, b);
};
const SECTION = between('// ---- ProxyEmpire (proxy-list', '// ---- MountProxies (dedicated');
const httpError = (status, body = '', headers = {}) => Object.assign(new Error(`HTTP ${status} ${body}`.trim()), { status, headers });

const slot = (over = {}) => ({
  proxy_username: 'pe-user', proxy_password: 'pe-pass',
  bandwidth: { total: 10 * GB, used: 2 * GB, remaining: 8 * GB, source: 'provider' },
  provider_availability: { state: 'live', provider: 'p1', connection_type: 'residential', reason: null, message: null, checked_at: '2026-11-10T10:00:00Z' },
  ...over
});
const USER = { message: 'ok', data: { residential: slot(), mobile: null, datacenter: slot(), 'static-resi': null, 'private-resi': null } };

function proxyList(body) {
  const lines = Array.from({ length: body.length }, (_, i) => `pe-user-country-${body.country || 'any'}-session-${i}:pe-pass@v2.proxyempire.io:5000`);
  return JSON.stringify({ message: 'ok', count: lines.length, proxies: lines });
}

function load(route) {
  const calls = [];
  const httpRequestText = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method: options.method || 'GET', headers: options.headers || {}, body });
    return route(url, body);
  };
  const scope = { ...U, httpRequestText, MINTED_PULL_MAX: Number(/const MINTED_PULL_MAX = (\d+);/.exec(IPC)[1]) };
  // eslint-disable-next-line no-new-func
  const api = new Function(...Object.keys(scope), `${SECTION}\nreturn { proxyEmpireCall, fetchProxyEmpirePool, lookupProxyEmpire };`)(...Object.values(scope));
  return { ...api, calls };
}
const okRoute = (user = USER) => (url, body) => (url.endsWith('/user') ? JSON.stringify(user) : proxyList(body));

// ---- The body builder ----

test('the body per pool: rotation from How many and Keep same IP, targeting joined with +', () => {
  const one = U.proxyEmpireBody({ pool: 'residential', count: '1' });
  assert.deepEqual(one.body, { proxy_type: 'residential', format: 1, length: 1, ip_rotation_type: 'random' });
  assert.equal(one.mode, 'random', 'How many 1 with Keep same IP blank rotates');
  const sticky = U.proxyEmpireBody({ pool: 'mobile', country: 'US', state: 'New York', city: 'New York', zip: '10001', asn: 'AS7922', count: '5' });
  assert.deepEqual(sticky.body, { proxy_type: 'mobile', format: 1, length: 5, country: 'us', region: 'new+york', city: 'new+york', zip: '10001', asn: '7922', ip_rotation_type: 'sticky' });
  const custom = U.proxyEmpireBody({ pool: 'residential', country: 'US', count: '3', life: '10' });
  assert.deepEqual([custom.body.ip_rotation_type, custom.body.session_lifetime, custom.mode], ['custom', 10, 'custom']);
  assert.equal(U.proxyEmpireBody({ pool: 'residential', count: '1', life: '1440' }).body.session_lifetime, 120, 'life above 120 clamps to 120');
  assert.equal(U.proxyEmpireBody({ pool: 'residential', count: '99999' }).body.length, 1000, 'up to 1000 a pull');
});

test('Datacenter takes a country only (the UK is uk there); Static Residential takes nothing', () => {
  assert.equal(U.proxyEmpireBody({ pool: 'datacenter', country: 'GB', count: '2' }).body.country, 'uk');
  assert.equal(U.proxyEmpireBody({ pool: 'residential', country: 'UK' }).body.country, 'gb');
  for (const extra of [{ state: 'Texas' }, { city: 'Austin' }, { zip: '73301' }, { asn: '7922' }]) {
    assert.throws(() => U.proxyEmpireBody({ pool: 'datacenter', country: 'US', ...extra }), /Rotating Datacenter takes a country only/);
  }
  const fixed = U.proxyEmpireBody({ pool: 'static-resi', count: '4' });
  assert.deepEqual(fixed.body, { proxy_type: 'static-resi', format: 1, length: 4 }, 'no targeting and no rotation fields');
  assert.equal(fixed.mode, 'fixed');
  for (const extra of [{ country: 'US' }, { state: 'Texas' }, { city: 'x' }, { zip: '1' }, { asn: '1' }]) {
    assert.throws(() => U.proxyEmpireBody({ pool: 'static-resi', ...extra }), /Static Residential takes no location/);
  }
  assert.throws(() => U.proxyEmpireBody({ pool: 'static-resi', life: '30' }), /Leave Keep same IP blank/);
  assert.throws(() => U.proxyEmpireBody({ pool: 'residential', zip: '10001' }), /ZIP code needs a country/);
  assert.throws(() => U.proxyEmpireBody({ pool: 'residential', state: 'Texas' }), /pick a country before a state or city/);
  assert.throws(() => U.proxyEmpireBody({ pool: 'residential', country: 'US', asn: 'Comcast' }), /ASN is digits only/);
  assert.throws(() => U.proxyEmpireBody({ pool: 'isp-orders' }), /pick Rotating Residential/);
});

test('the package slot: null slots, a missing data object', () => {
  assert.equal(U.proxyEmpireSlot(USER, 'residential').slot.proxy_username, 'pe-user');
  assert.deepEqual(U.proxyEmpireSlot(USER, 'mobile'), { found: true, slot: null });
  assert.deepEqual(U.proxyEmpireSlot(JSON.stringify(USER), 'static-resi'), { found: true, slot: null });
  assert.deepEqual(U.proxyEmpireSlot({ message: 'Unauthenticated.' }, 'residential'), { found: false, slot: null });
});

// ---- The pull ----

test('a pull checks the package, then asks for ready lines with the Bearer token', async () => {
  const a = load(okRoute());
  const rows = await a.fetchProxyEmpirePool({ token: TOKEN, poolType: 'residential', country: 'US', count: '3', proxyType: 'socks5' });
  assert.deepEqual(a.calls.map((c) => [c.method, c.url]), [['GET', 'https://panel.proxyempire.io/api/v2/user'], ['POST', 'https://panel.proxyempire.io/api/v2/proxy-list']]);
  assert.equal(a.calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(a.calls[0].headers.Accept, 'application/json');
  assert.deepEqual(a.calls[1].body, { proxy_type: 'residential', format: 1, length: 3, country: 'us', ip_rotation_type: 'sticky' });
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].type, rows[0].host, rows[0].port, rows[0].username, rows[0].password, rows[0].country, rows[0].dedupeOnPassword], ['SOCKS5', 'v2.proxyempire.io', 5000, 'pe-user-country-us-session-0', 'pe-pass', 'US', false]);
  assert.match(rows[0].label, /^ProxyEmpire • Rotating Residential • US • sticky • #1$/);
  const b = load(okRoute());
  const kept = await b.fetchProxyEmpirePool({ token: TOKEN, poolType: 'residential', count: '1', life: '30' });
  assert.match(kept[0].label, /Any country • 30 min • #1$/);
  const dc = await load(okRoute()).fetchProxyEmpirePool({ token: TOKEN, poolType: 'datacenter', country: 'GB', count: '2' });
  assert.equal(dc[0].country, 'GB', 'the row says GB though the request said uk');
});

test('no package, no traffic, an unavailable product or an empty list stop with a clear message', async () => {
  await assert.rejects(load(okRoute()).fetchProxyEmpirePool({ token: TOKEN, poolType: 'mobile' }), /this account has no Rotating Mobile package/);
  const empty = { ...USER, data: { ...USER.data, residential: slot({ bandwidth: { total: 10 * GB, used: 10 * GB, remaining: 0 } }) } };
  await assert.rejects(load(okRoute(empty)).fetchProxyEmpirePool({ token: TOKEN, poolType: 'residential' }), /no traffic left/);
  const down = { ...USER, data: { ...USER.data, residential: slot({ provider_availability: { state: 'circuit_open', message: 'Upstream is recovering.' } }) } };
  await assert.rejects(load(okRoute(down)).fetchProxyEmpirePool({ token: TOKEN, poolType: 'residential' }), /Rotating Residential is unavailable right now \(Upstream is recovering\)/);
  const none = load((url) => (url.endsWith('/user') ? JSON.stringify(USER) : JSON.stringify({ message: 'ok', count: 0, proxies: [] })));
  await assert.rejects(none.fetchProxyEmpirePool({ token: TOKEN, poolType: 'residential', country: 'TV' }), /returned no proxies for that location/);
  const a = load(() => { throw new Error('no call expected'); });
  await assert.rejects(a.fetchProxyEmpirePool({ token: '', poolType: 'residential' }), /paste an API token from Settings, API Tokens/);
  await assert.rejects(a.fetchProxyEmpirePool({ token: TOKEN, poolType: 'static-resi', country: 'US' }), /takes no location/);
  assert.equal(a.calls.length, 0, 'refused before any call');
});

test('every documented failure maps to its message, and none echoes the token', async () => {
  const cases = [
    [httpError(401, '{"message":"Unauthenticated."}'), /rejected the API token\. Create a new one under Settings, API Tokens\./],
    [httpError(403, '{"message":"This action is unauthorized."}'), /missing a permission the pull needs/],
    [httpError(403, '{"message":"Your account is not active."}'), /your account is not active/],
    [httpError(422, '{"message":"No active package found for the requested proxy type."}'), /no Rotating Residential package/],
    [httpError(422, '{"message":"The given data was invalid.","errors":{"asn":["The asn field must only contain digits."]}}'), /^ProxyEmpire refused the request: The asn field must only contain digits\.$/],
    [httpError(429, '{"message":"Too many proxy-list requests. Please wait before generating more."}', { 'retry-after': '30' }), /Wait 30 seconds and pull again/],
    [httpError(429, '{"message":"Too many proxy-list requests."}'), /Wait a minute and pull again/],
    [Object.assign(httpError(429, '{"message":"Too many proxy-list requests."}'), { headers: undefined, retryAfter: '12' }), /Wait 12 seconds and pull again/],
    [httpError(503, ''), /the API failed \(HTTP 503\)/],
    [new Error(`getaddrinfo ENOTFOUND panel.proxyempire.io Bearer ${TOKEN}`), /could not reach the API/]
  ];
  for (const [err, want] of cases) {
    const a = load((url) => { if (url.endsWith('/user') && err.status !== 422) throw err; if (url.endsWith('/user')) return JSON.stringify(USER); throw err; });
    await assert.rejects(a.fetchProxyEmpirePool({ token: TOKEN, poolType: 'residential' }), (e) => want.test(e.message) && !e.message.includes(TOKEN), String(want));
  }
  assert.doesNotMatch(SECTION, /throw new Error\([^;]*\berror\.message\b/, 'a transport error is never echoed');
});

test('Load countries per pool; never a spending call', async () => {
  const a = load(() => JSON.stringify({ countries: [{ name: 'United States', code: 'us' }, { name: 'United Kingdom', code: 'uk' }], counts: {}, provider_availability: {} }));
  const r = await a.lookupProxyEmpire({ token: TOKEN, groupby: 'country', poolType: 'datacenter' });
  assert.equal(a.calls[0].url, 'https://panel.proxyempire.io/api/v2/countries?connection_type=datacenter');
  assert.deepEqual(r.geo, [{ key: 'UK', label: 'United Kingdom' }, { key: 'US', label: 'United States' }]);
  assert.doesNotMatch(SECTION, /['`]\/(rotate-session|subusers|isp-proxies|user\/bandwidth)/, 'no call that rotates, moves traffic or spends money');
});

// ---- Account check ----

test('account: GET /user sums each package\'s bytes; status follows the traffic left', async () => {
  const seen = [];
  const r = await pa.checkProviderAccount('proxyempire', { token: TOKEN }, async (url, opts) => { seen.push({ url, headers: opts.headers }); return JSON.stringify(USER); });
  assert.equal(seen[0].url, 'https://panel.proxyempire.io/api/v2/user');
  assert.equal(seen[0].headers.Authorization, `Bearer ${TOKEN}`);
  const a = r.account;
  assert.deepEqual([a.status, a.plan, a.trafficLeftGb, a.trafficUsedGb, a.trafficTotalGb, a.note], ['active', 'Rotating Residential, Rotating Datacenter', 16, 4, 20, 'summedPlans']);
  assert.equal(a.expiresAt, null);
  assert.equal(pa.parsers.proxyempire({ data: { residential: null, mobile: null } }).note, 'noActivePlans');
  assert.equal(pa.parsers.proxyempire({ data: { residential: slot({ bandwidth: { total: GB, used: GB, remaining: 0 } }) } }).status, 'unknown');
  await assert.rejects(pa.checkProviderAccount('proxyempire', { token: TOKEN }, async () => { throw httpError(401); }), (e) => /rejected the saved API token/.test(e.message) && !e.message.includes(TOKEN));
});

// ---- Wiring ----

test('ProxyEmpire is wired, with Keep same IP up to 2 hours and its blank option', async () => {
  assert.match(IPC, /proxyempire: 'ProxyEmpire'/);
  assert.match(IPC, /proxyempire: fetchProxyEmpirePool/);
  assert.match(IPC, /proxyempire: lookupProxyEmpire/);
  const line = UI.split(/\r?\n/).find((l) => l.includes("{ key: 'proxyempire',"));
  assert.ok(line, 'PROVIDERS entry');
  assert.match(line, /referral: 'https:\/\/proxyempire\.io\/'/);
  assert.match(line, /creds: \['token'\], poolType: \[\['residential', 'Rotating Residential'\], \['mobile', 'Rotating Mobile'\], \['datacenter', 'Rotating Datacenter'\], \['static-resi', 'Static Residential \(ISP\)'\]\]/);
  assert.match(line, /zip: true, asn: true, countryLookup: true, noSession: true, life: true, maxLife: 120, proto: true/);
  const { LIFE_BLANK_DEFAULTS, lifeBlankLabel, lifeOptionsFor } = await pull();
  assert.equal(LIFE_BLANK_DEFAULTS.proxyempire, null, 'sticky lines keep their IP for ProxyEmpire\'s own time');
  assert.deepEqual(lifeBlankLabel('proxyempire', { count: '1' }), { key: 'lifeDifferent' });
  assert.deepEqual(lifeBlankLabel('proxyempire', { count: '5' }), { key: 'lifeProviderDefault' });
  assert.deepEqual(lifeOptionsFor({ maxLife: 120 }), [5, 10, 30, 60, 120]);
  for (const lang of ['en', 'es']) {
    const hint = locale(lang).proxyProviders.geoHints.proxyempire;
    assert.equal(typeof hint, 'string', lang);
    assert.doesNotMatch(hint, /[–—]/, 'no em or en dashes');
  }
});
