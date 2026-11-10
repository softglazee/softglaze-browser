'use strict';
// Per-vendor connector fixes, 1.0.27 backlog batches 3 and 4 (items 48 to 55 and 67 to 75): Databay,
// GonzoProxy, 2extract, Simply Proxies, Coronium, Singapore Mobile Proxy, Gsocks, Proxy Bonanza,
// Proxies.sx, Proxy-Solutions, RapidProxy, MobileProxy.Space, CatProxies, PacketStream and Airproxy.
// Vendor answers are fixtures built from each vendor's documented shapes; no test reaches a provider,
// and every key below is a made-up example.
//
// The adapters live in ipcHandlers.js, which pulls in electron, so the vendor sections are lifted out
// of the file and run against a stubbed transport (as test/connectorsShared.test.js does).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const U = require('../src/main/proxyVendorUtils');
const pa = require('../src/main/providerAccount');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lang, 'cmpSettingsC.json'), 'utf8'));
const LOCALES = { en: locale('en'), es: locale('es') };
const pull = () => import('../src/renderer/lib/gatewayPull.mjs');

const between = (from, to) => {
  const a = IPC.indexOf(from);
  const b = IPC.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `section ${from} .. ${to} must exist`);
  return IPC.slice(a, b);
};
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

const CORE = between('// ---- Country / session helpers', '// ---- Apify Residential');
const SECTIONS = [
  between('// ---- PacketStream (proxy.packetstream.io', '// ---- Proxmint (pay-as-you-go'),
  between('// ---- Databay (residential', '// ---- IPFoxy (rotating residential'),
  between('// ---- 2extract (residential', '// ---- PROXY6 (static IPv4')
].join('\n');
const FETCHERS = ['protocolChoice', 'fetchPacketStreamPool', 'fetchAirproxyPool', 'fetchCatProxiesPool', 'fetchRapidProxyPool', 'fetchProxiesSxPool',
  'fetchMobileProxySpacePool', 'fetchProxySolutionsPool', 'fetchDatabayPool', 'fetchTwoExtractPool', 'fetchGonzoProxyPool',
  'fetchSimplyProxiesPool', 'fetchCoroniumPool', 'fetchSingaporeMobileProxyPool', 'fetchGsocksPool', 'fetchProxyBonanzaPool'];

// route(url, options) answers a request or returns undefined for "not stubbed".
function load(route = () => undefined) {
  const calls = [];
  const httpRequestText = async (url, options = {}) => {
    calls.push({ url, headers: options.headers || {} });
    const answer = await route(url, options);
    if (answer === undefined) throw new Error(`no network in this test: ${url}`);
    return typeof answer === 'string' ? answer : JSON.stringify(answer);
  };
  const scoped = { ...U, httpRequestText, crypto: nodeCrypto };
  const names = Object.keys(scoped);
  // eslint-disable-next-line no-new-func
  const api = new Function(...names, `${CORE}\n${SECTIONS}\nreturn { ${FETCHERS.join(', ')} };`)(...names.map((n) => scoped[n]));
  return { ...api, calls };
}

// A connector's geoSync object, read from its PROVIDERS line.
const providerLine = (key) => {
  const line = UI.split(/\r?\n/).find((l) => l.includes(`{ key: '${key}',`));
  assert.ok(line, `${key} must be a PROVIDERS entry`);
  return line;
};
function geoSyncOf(key) {
  const line = providerLine(key);
  const start = line.indexOf('geoSync: {') + 'geoSync: '.length;
  let depth = 0;
  let end = start;
  for (; end < line.length; end += 1) {
    if (line[end] === '{') depth += 1;
    if (line[end] === '}') { depth -= 1; if (!depth) break; }
  }
  // eslint-disable-next-line no-new-func
  return new Function('PACKETSTREAM_COUNTRY_CODES', `return (${line.slice(start, end + 1)});`)([]);
}
const hint = (lang, key) => LOCALES[lang].proxyProviders.geoHints[key];
const geoText = (lang, key) => LOCALES[lang].proxyProviders.geo[key];

// ---- 48 Databay ----------------------------------------------------------------------------------

test('48 Databay: Residential Flex offers only its own 30 minutes; the other pools keep up to 2 hours', async () => {
  const { lifeOptionsFor } = await pull();
  const g = geoSyncOf('databay');
  assert.deepEqual(lifeOptionsFor(g, 'residential_FLEX'), [5, 10, 30], 'no 1 h or 2 h that main would clamp to 30');
  for (const pool of ['residential', 'mobile', 'datacenter']) assert.deepEqual(lifeOptionsFor(g, pool), [5, 10, 30, 60, 120], pool);
  // Main agrees: every Flex option is sent as picked.
  for (const m of lifeOptionsFor(g, 'residential_FLEX')) {
    assert.match(U.databayUsername('u1', { zone: 'residential_FLEX', session: 'a', lengthMin: m }), new RegExp(`-sessionLength-${m}$`));
  }
  // One mechanism with NOVADA's Rotating ISP: the pool's maximum (maxLifeByPool), and another Pool type
  // clears a time it does not offer.
  assert.deepEqual(g.maxLifeByPool, { residential_FLEX: 30 });
  assert.match(UI, /if \(form\.life && !lifeValuesFor\(value\)\.includes\(String\(form\.life\)\)\) set\('life', ''\);/);
});

test('48 Databay: State and City show and are sent on Residential only, and main refuses them elsewhere', async () => {
  const g = geoSyncOf('databay');
  assert.deepEqual(g.geoPools, ['residential']);
  // The shared geoPools rule (gatewayPull.mjs geoForPool): the form hides State and City, and the pull sends neither.
  const { geoForPool } = await pull();
  assert.equal(geoForPool(g, 'residential'), true);
  for (const pool of ['residential_FLEX', 'mobile', 'datacenter']) assert.equal(geoForPool(g, pool), false, pool);
  assert.match(UI, /\{\(geoOn \|\| provider\.geoSync\.usState\) && \(/, 'State is hidden off Residential');
  assert.match(UI, /\{geoOn && \(/, 'City too');
  assert.match(UI, /state: placeOn \? form\.state\.trim\(\) : '',/, 'a hidden State is not sent');
  assert.match(UI, /city: placeOn \? form\.city\.trim\(\) : '',/);
  const a = load();
  for (const poolType of ['residential_FLEX', 'mobile', 'datacenter']) {
    await assert.rejects(a.fetchDatabayPool({ username: 'u1', password: 'p', poolType, country: 'US', city: 'Miami', count: '2' }), /State and City work on Residential only/, poolType);
  }
  const rows = await a.fetchDatabayPool({ username: 'u1', password: 'p', poolType: 'residential', country: 'US', city: 'Miami', count: '2' });
  assert.match(rows[0].username, /-cityName-Miami-sessionId-/);
  for (const lang of ['en', 'es']) assert.match(hint(lang, 'databay'), /Springfield/, `${lang}: an ambiguous city can exit elsewhere`);
});

test('48 Databay: a hyphen in a place name is %2D and a space %20, as the Connection String page asks', () => {
  const user = (city) => U.databayUsername('u1', { country: 'US', city });
  assert.equal(user('Winston-Salem'), 'u1-zone-residential-cityName-Winston%2DSalem', 'not "Winston Salem"');
  assert.equal(user('Los Angeles'), 'u1-zone-residential-cityName-Los%20Angeles');
  assert.equal(user('Los%20Angeles'), 'u1-zone-residential-cityName-Los%20Angeles', 'typed already encoded: not encoded twice');
  assert.equal(user('los_angeles'), 'u1-zone-residential-cityName-los%20angeles');
  assert.equal(user('  -Aix - en-Provence- '), 'u1-zone-residential-cityName-Aix%2Den%2DProvence');
  assert.equal(U.databayUsername('u1', { country: 'US', state: 'North Carolina' }), 'u1-zone-residential-stateName-North%20Carolina');
  assert.doesNotMatch(user('Winston-Salem').split('-cityName-')[1], /[- ]/, 'no raw separator inside the value');
});

// ---- 49 GonzoProxy ---------------------------------------------------------------------------------

test('49 GonzoProxy: Country is required in the form, so a pull never starts on Any / Random', () => {
  // The shared countryRequired flag: no Any / Random option, the form starts on United States, and Pull
  // asks for a country before calling the vendor.
  assert.equal(geoSyncOf('gonzoproxy').countryRequired, true);
  assert.match(UI, /\{!provider\.geoSync\.countryRequired && <option value="">/, 'no Any / Random option');
  assert.match(UI, /country: needCountry \? 'US' : ''/);
  assert.match(UI, /if \(g\.countryRequired && !form\.country\) \{ setErr\(/);
  // Main still refuses an empty country, with its own message.
  assert.throws(() => U.gonzoProxyUsername('Gz1abc', {}), /pick a country/);
});

test('49 GonzoProxy: the hint says the mobile pool has no cities (the app cannot know the pool)', () => {
  assert.match(hint('en', 'gonzoproxy'), /mobile pool has no cities/);
  assert.match(hint('es', 'gonzoproxy'), /pool móvil de GonzoProxy no tiene ciudades/);
});

// ---- 50 2extract -------------------------------------------------------------------------------------

test('50 2extract: Protocol offers HTTPS, its default, as a TLS proxy on the same port; the hint says so', async () => {
  assert.equal(geoSyncOf('twoextract').protoHttps, true);
  assert.match(UI, /\{provider\.geoSync\.protoHttps && <option value="https">HTTPS<\/option>\}/);
  const a = load();
  const rows = await a.fetchTwoExtractPool({ username: '2xt-customer-1-proxy-a', password: 'pw', country: 'US', count: '2', proxyType: 'https' });
  assert.deepEqual([rows[0].type, rows[0].host, rows[0].port], ['HTTPS', 'proxy.2extract.net', 5555]);
  assert.equal((await a.fetchTwoExtractPool({ username: '2xt-customer-1-proxy-a', password: 'pw', count: '1' }))[0].type, 'HTTP', 'HTTP stays the default');
  assert.match(hint('en', 'twoextract'), /Connection Helper: HTTPS \(2extract's default/);
  assert.match(hint('es', 'twoextract'), /Connection Helper: HTTPS \(el predeterminado de 2extract/);
});

test('protocolValue: HTTPS shows only where the vendor offers it', () => {
  const src = /function protocolValue\([\s\S]*?\n\}/.exec(UI)[0];
  // eslint-disable-next-line no-new-func
  const protocolValue = new Function(`${src}; return protocolValue;`)();
  assert.equal(protocolValue({ protoHttps: true }, 'https'), 'https');
  assert.equal(protocolValue({ proto: true }, 'https'), 'http', 'a vendor without HTTPS shows HTTP');
  assert.equal(protocolValue({ proto: true }, 'socks5'), 'socks5');
  assert.equal(protocolValue({ proto: true }, 'proxy_sock_5'), 'http', 'a stale value from another form reads as HTTP, as main does');
});

// ---- 51 Simply Proxies -------------------------------------------------------------------------------

test('51 Simply Proxies: How many is the gateway field, not "All / leave blank for all"', async () => {
  assert.ok(!geoSyncOf('simplyproxies').list, 'Simply Proxies mints, it does not list owned proxies');
  // One How many block for every connector of the shared form; the list wording follows geoSync.list only.
  const form = UI.slice(UI.indexOf('Geo-targeted pull: one consistent grid'), UI.indexOf('Rotating engine configuration form'));
  assert.equal((form.match(/<label className=\{labelCls\}>\{t\('proxyProviders\.geo\.howMany'\)\}<\/label>/g) || []).length, 1);
  assert.match(UI, /placeholder=\{provider\.geoSync\.list \? t\('proxyProviders\.geo\.howManyAll', 'All'\) : '5'\} title=\{provider\.geoSync\.list \? t\('proxyProviders\.geo\.howManyListTitle'\)/);
  // Blank really is one rotating proxy, which the Keep same IP select already says.
  const rows = await load().fetchSimplyProxiesPool({ username: 'u1', password: 'p', count: '' });
  assert.equal(rows.length, 1);
  assert.doesNotMatch(rows[0].username, /-session-/);
  const { lifeBlankLabel } = await pull();
  assert.deepEqual(lifeBlankLabel('simplyproxies', { count: '' }), { key: 'lifeDifferent' });
});

test('51 Simply Proxies: the hint says SOCKS5 sends the password in clear text', () => {
  assert.match(hint('en', 'simplyproxies'), /SOCKS5 sends the proxy password in clear text/);
  assert.match(hint('es', 'simplyproxies'), /SOCKS5 envía la contraseña del proxy sin cifrar/);
  assert.doesNotMatch(between('// ---- Simply Proxies (UK mobile', '// ---- Coronium'), /talks plain-text HTTP/, 'no stale reason in the code comment');
});

// ---- 52 Coronium -------------------------------------------------------------------------------------

const CORONIUM = { _id: 'c1', name: 'dongle1_pl', proxy_login: 'example_login', proxy_password: 'example_password', http_port: '8695', socks_port: '5695', isOnline: true, ip_address: '203.0.113.10', connection_ip: '203.0.113.10' };
const NOW = Date.parse('2026-11-10T00:00:00Z');

test('52 Coronium: expiry reads tariff_expired_at (ms, or seconds by mistake) and support\'s expires_at', () => {
  const rows = (p) => U.coroniumRows({ data: [{ ...CORONIUM, ...p }] }, { now: NOW });
  assert.equal(rows({ tariff_expired_at: NOW + 86_400_000 }).rows.length, 1, 'epoch ms ahead: kept (OpenAPI schema Proxy)');
  assert.equal(rows({ tariff_expired_at: Math.floor((NOW + 86_400_000) / 1000) }).rows.length, 1, 'epoch seconds ahead: kept, not read as 1970');
  assert.equal(rows({ tariff_expired_at: NOW - 1 }).expired, 1);
  assert.equal(rows({ expires_at: '2026-11-09T12:00:00Z' }).expired, 1, 'an ISO expires_at in the past is expired');
  assert.equal(rows({ expires_at: '2026-12-01T00:00:00Z' }).rows.length, 1);
  assert.equal(rows({ tariff_expired_at: 0, expires_at: null }).rows.length, 1, 'no expiry: kept');
  assert.equal(U.coroniumExpiryMs({ expires_at: 'not a date' }), null);
});

test('52 Coronium: the host is ip_address or its documented alias connection_ip', () => {
  const only = { ...CORONIUM, ip_address: undefined, connection_ip: 'm1.coronium.example' };
  assert.equal(U.coroniumRows({ data: [only] }, { now: NOW }).rows[0].host, 'm1.coronium.example', 'connection_ip alone works, and may be a hostname');
  assert.equal(U.coroniumRows({ data: [CORONIUM] }, { now: NOW }).rows[0].host, '203.0.113.10');
});

test('52 Coronium: the account card reads the same expiry fields', () => {
  const account = JSON.stringify({ usdt: { balance: 1 }, accountCredit: 0, proxyCount: 1 });
  const a = pa.finalizeAccount(pa.parsers.coronium(account, JSON.stringify({ data: [{ expires_at: '2026-12-01T00:00:00Z' }] }), { now: NOW }), { now: NOW });
  assert.equal(a.expiresAt, '2026-12-01T00:00:00.000Z');
});

// ---- 53 Singapore Mobile Proxy -----------------------------------------------------------------------

test('53 Singapore Mobile Proxy: every row is SG, and nothing says other countries are sold', () => {
  const body = { proxyList: [{ license_status: 'ACTIVE', host_domain: 'sg.example.net', http_port: 8101, socket_port: 5101, authentication_user: 'proxy_abc:pw1' }] };
  assert.equal(U.singaporeMobileProxyRows(body).rows[0].country, 'SG');
  assert.doesNotMatch(hint('en', 'singaporemobileproxy'), /other countries/);
  assert.match(hint('en', 'singaporemobileproxy'), /sells no other country/);
  assert.match(hint('es', 'singaporemobileproxy'), /no vende otros países/);
  assert.doesNotMatch(between('// ---- Singapore Mobile Proxy', '// ---- Gsocks'), /other locations are sold/);
});

// ---- 54 Gsocks ---------------------------------------------------------------------------------------

function gsocksRoute({ accept = ['key'], ids = [{ id: 7 }] } = {}) {
  return (url, opts) => {
    const scheme = String(opts.headers.authorization || '').split(' ')[0];
    if (!accept.includes(scheme)) throw httpError(401);
    if (/\/proxy\?type=/.test(url)) return { proxies: ids, count: ids.length };
    if (/-proxy-list\//.test(url)) return 'residential.gsocks.net:10000:u1:p1\nresidential.gsocks.net:10001:u1:p2';
    return undefined;
  };
}

test('54 Gsocks: SOCKS5 on the same host and port as HTTP', async () => {
  assert.equal(geoSyncOf('gsocks').proto, true);
  const a = load(gsocksRoute());
  const socks = await a.fetchGsocksPool({ token: 'K1', poolType: 'residential', proxyType: 'socks5' });
  const http = await load(gsocksRoute()).fetchGsocksPool({ token: 'K1', poolType: 'residential' });
  assert.deepEqual(socks.map((r) => [r.type, r.host, r.port]), [['SOCKS5', 'residential.gsocks.net', 10000], ['SOCKS5', 'residential.gsocks.net', 10001]]);
  assert.deepEqual(http.map((r) => r.type), ['HTTP', 'HTTP']);
  assert.match(hint('en', 'gsocks'), /HTTP or SOCKS5 under Protocol/);
  assert.doesNotMatch(hint('en', 'gsocks'), /Every proxy is added as HTTP/);
});

test('54 Gsocks: the documented "key" header first, "session" once on 401/403, and the working form is kept', async () => {
  const a = load(gsocksRoute({ accept: ['session'] }));
  const rows = await a.fetchGsocksPool({ token: 'K1', poolType: 'residential' });
  assert.equal(rows.length, 2);
  assert.deepEqual(a.calls.map((c) => c.headers.authorization), ['key K1', 'session K1', 'session K1'], 'one retry, then the form that worked');
  assert.ok(a.calls.every((c) => !c.url.includes('K1')), 'the key never rides in a URL');
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';
  const b = load(gsocksRoute({ accept: ['session'] }));
  await b.fetchGsocksPool({ token: jwt, poolType: 'residential' });
  assert.equal(b.calls[0].headers.authorization, `session ${jwt}`, 'a key that is a JWT goes as session first');
  const c = load(gsocksRoute({ accept: [] }));
  await assert.rejects(c.fetchGsocksPool({ token: 'K1', poolType: 'residential' }), (e) => /both header forms/.test(e.message) && !e.message.includes('K1'));
  assert.equal(c.calls.length, 2);
});

test('54 Gsocks: list ids may be numbers or plain tokens; anything else fails with a clear message', async () => {
  assert.deepEqual(U.gsocksProxyIds({ proxies: [{ id: 'ab12_C-3' }, { id: 5 }, { id: 'a/b' }, { id: -1 }] }).ids, ['ab12_C-3', '5']);
  const a = load(gsocksRoute({ ids: [{ name: 'no id' }] }));
  await assert.rejects(a.fetchGsocksPool({ token: 'K1', poolType: 'residential' }), /without the id the app reads/);
});

test('54 Gsocks: the account card tries the second header form too', async () => {
  const seen = [];
  const get = async (url, opts) => {
    seen.push(opts.headers.authorization);
    if (!/^session /.test(opts.headers.authorization)) throw httpError(403);
    if (/balance/.test(url)) return '{"balance":"3.5"}';
    return '{"have_traffic":true,"volume":10,"rest_volume":4}';
  };
  const r = await pa.checkProviderAccount('gsocks', { token: 'K1' }, get, { now: NOW });
  assert.equal(r.account.balance, 3.5);
  assert.deepEqual(seen, ['key K1', 'session K1', 'session K1', 'session K1']);
});

// ---- 55 Proxy Bonanza --------------------------------------------------------------------------------

test('55 Proxy Bonanza: IPs without a login are counted, and a pull of only those says why', async () => {
  const ip = (n, login) => ({ ip: `198.51.100.${n}`, port_http: 60000, port_socks: 61000, login, password: login ? 'pw' : '', countrycode: 'PL' });
  const mixed = U.proxyBonanzaRows({ success: true, data: [ip(1, 'l1'), ip(2, ''), ip(3, null)] });
  assert.deepEqual([mixed.rows.length, mixed.noLogin, mixed.total], [1, 2, 3]);
  const KEY = `${'a'.repeat(50)}!42`;
  const onlyIpAuth = load(() => ({ success: true, data: [ip(1, ''), ip(2, '')] }));
  await assert.rejects(onlyIpAuth.fetchProxyBonanzaPool({ token: KEY }), /without a login and password, which a plan set to IP authorization only does/);
  const some = load(() => ({ success: true, data: [ip(1, 'l1'), ip(2, '')] }));
  assert.equal((await some.fetchProxyBonanzaPool({ token: KEY })).length, 1);
  assert.match(hint('en', 'proxybonanza'), /IP authorization only/);
  assert.match(hint('es', 'proxybonanza'), /autorización por IP/);
});

// ---- 67, 68 Proxies.sx -------------------------------------------------------------------------------

function proxiesSxRoute(url) {
  if (/\/gateway\/pool\/stock$/.test(url)) return { pools: { mbl: { us: 9 }, peer: { de: 9, us: 9 } } };
  if (/\/account\/proxy-password$/.test(url)) return { proxyUsername: 'psx_ab12cd', proxyPassword: 'secret1' };
  return undefined;
}

test('67 Proxies.sx: Residential asks for residential devices only (-iptype-residential); Mobile does not', async () => {
  const a = load(proxiesSxRoute);
  const resi = await a.fetchProxiesSxPool({ token: 'psx_key', poolType: 'residential', country: 'DE', count: '1' });
  assert.equal(resi[0].username, 'psx_ab12cd-peer-de-iptype-residential-rot-ondemand-failover-strict');
  const mob = await a.fetchProxiesSxPool({ token: 'psx_key', poolType: 'mobile', country: 'US', count: '1' });
  assert.doesNotMatch(mob[0].username, /iptype/);
});

test('68 Proxies.sx: sticky rows carry -ttl- (Keep same IP in seconds, 24 hours when blank), rotating rows none', async () => {
  const a = load(proxiesSxRoute);
  const blank = await a.fetchProxiesSxPool({ token: 'psx_key', poolType: 'mobile', country: 'US', count: '2' });
  for (const r of blank) assert.match(r.username, /-sid-[a-z0-9_]{8,64}-ttl-86400-rot-sticky-failover-strict$/);
  const hour = await a.fetchProxiesSxPool({ token: 'psx_key', poolType: 'mobile', country: 'US', count: '1', life: '60' });
  assert.equal(hour.length, 1, 'a Keep same IP time makes one row sticky');
  assert.match(hour[0].username, /-ttl-3600-rot-sticky-/);
  const rotating = await a.fetchProxiesSxPool({ token: 'psx_key', poolType: 'mobile', country: 'US', count: '1' });
  assert.doesNotMatch(rotating[0].username, /-ttl-|-sid-/);
  // The gateway clamps -ttl- to 60 s .. 30 days.
  assert.match(U.proxiesSxUsername('psx_a', { country: 'US', sid: 'abcdefgh', ttlSeconds: 1e9 }), /-ttl-2592000-/);
  assert.match(U.proxiesSxUsername('psx_a', { country: 'US', sid: 'abcdefgh', ttlSeconds: 5 }), /-ttl-60-/);
  // The form: Keep same IP up to 7 days, its blank option names 24 hours, and a country is required.
  const g = geoSyncOf('proxiessx');
  assert.deepEqual([g.life, g.maxLife, g.countryRequired], [true, 10080, true]);
  const { lifeBlankLabel, LIFE_BLANK_DEFAULTS } = await pull();
  assert.equal(LIFE_BLANK_DEFAULTS.proxiessx, 1440);
  assert.deepEqual(lifeBlankLabel('proxiessx', { count: '2' }), { key: 'lifeDefaultTime', minutes: 1440 });
});

test('68 Proxies.sx: the hint names the parallel-connection limit next to the 250-session cap', () => {
  assert.match(hint('en', 'proxiessx'), /5 on the Starter tier/);
  assert.match(hint('en', 'proxiessx'), /up to 250 per pull/);
  assert.match(hint('es', 'proxiessx'), /5 en el nivel Starter/);
});

// ---- 69 Proxy-Solutions ------------------------------------------------------------------------------

test('69 Proxy-Solutions: every error asks for the Integration token, as the field is labelled', () => {
  const sec = between('// ---- Proxy-Solutions (anti-detect', '// ---- Proxmint (pay-as-you-go');
  const messages = [...sec.matchAll(/new Error\('([^']*)'\)/g)].map((m) => m[1]).filter((m) => /key|token/i.test(m));
  assert.ok(messages.length >= 2);
  for (const m of messages) assert.match(m, /Integration token/, m);
  assert.doesNotMatch(sec, /did not accept that key/);
  // The form's empty-field error uses the field's own name.
  assert.match(UI, /setErr\(tokenLabel \? t\('proxyProviders\.errors\.enterNamedToken', \{ field: t\(`proxyProviders\.geo\.\$\{tokenLabel\}`\) \}\) : t\('proxyProviders\.errors\.enterApiToken'\)\);/);
  for (const lang of ['en', 'es']) assert.match(LOCALES[lang].proxyProviders.errors.enterNamedToken, /\{\{field\}\}/);
});

// ---- 70 Protocol, not Pool type ------------------------------------------------------------------------

test('70 RapidProxy, MobileProxy.Space and Proxy-Solutions pick HTTP or SOCKS5 under Protocol', () => {
  for (const key of ['rapidproxy', 'mobileproxyspace', 'proxysolutions']) {
    const g = geoSyncOf(key);
    assert.equal(g.proto, true, key);
    assert.equal(g.poolType, undefined, `${key}: no protocol under Pool type`);
  }
});

test('70 the Protocol choice wins, and an old caller that sends poolType still gets its protocol', async () => {
  const { protocolChoice } = load();
  assert.equal(protocolChoice({ proxyType: 'socks5' }), 'socks5');
  assert.equal(protocolChoice({ proxyType: 'http', poolType: 'socks5' }), 'http', 'the Protocol select wins');
  assert.equal(protocolChoice({ poolType: 'socks5' }), 'socks5', 'old saved poolType');
  assert.equal(protocolChoice({ proxyType: 'proxy_sock_5', poolType: 'residential' }), 'http');
  const a = load((url) => (url.includes('mpsapi.com') ? { status: 'ok', list: [{ proxy_id: 1, proxy_host_ip: '192.0.2.1', proxy_http_port: 5000, proxy_socks5_port: 5001, proxy_login: 'l', proxy_pass: 'p' }] } : undefined));
  assert.equal((await a.fetchMobileProxySpacePool({ token: 'tok', proxyType: 'socks5' }))[0].port, 5001);
  assert.equal((await a.fetchMobileProxySpacePool({ token: 'tok', poolType: 'socks5' }))[0].port, 5001, 'legacy poolType');
  assert.equal((await a.fetchMobileProxySpacePool({ token: 'tok', proxyType: 'http', poolType: 'residential' }))[0].port, 5000);
  const rp = await a.fetchRapidProxyPool({ username: 'sub1', password: 'p', count: '1', proxyType: 'socks5' });
  assert.deepEqual([rp[0].type, rp[0].port], ['SOCKS5', 5001]);
  const ps = load((url) => (url.includes('proxy-solutions.net') ? { total_pages: 1, proxies: [] } : undefined));
  await assert.rejects(ps.fetchProxySolutionsPool({ token: 'abcdef123', proxyType: 'socks5' }), /no active proxies/);
  assert.match(ps.calls[0].url, /proto=socks&/);
});

// ---- 71 RapidProxy -------------------------------------------------------------------------------------

test('71 RapidProxy: Keep same IP reaches its 180-minute maximum, and the hint names SOCKS5', async () => {
  const { lifeOptionsFor } = await pull();
  const opts = lifeOptionsFor(geoSyncOf('rapidproxy'));
  assert.equal(opts[opts.length - 1], 180);
  for (const lang of ['en', 'es']) assert.equal(typeof geoText(lang, 'life180'), 'string', `${lang} life180`);
  const rows = await load().fetchRapidProxyPool({ username: 'sub1', password: 'p', count: '1', life: '180' });
  assert.match(rows[0].username, /-stime-180$/);
  assert.match(hint('en', 'rapidproxy'), /HTTP and SOCKS5 on the same port/);
  assert.match(hint('en', 'rapidproxy'), /up to 3 hours/);
  assert.match(hint('es', 'rapidproxy'), /HTTP y SOCKS5 en el mismo puerto/);
});

// ---- 72 CatProxies -------------------------------------------------------------------------------------

const CP_KEY = 'cp_abcdefgh1234';
const CP_PLAN = 'abcd1234-ef';
const catRoute = (url) => (url.startsWith('https://catproxies.com/api/v1/user/orders/') ? { payload: { order: { proxy: { username: 'cpuser', password: 'cppass', bandwidth_left: 3 } } } } : undefined);

test('72 CatProxies: a Mobile sticky session always carries -ttl- (30 minutes when Keep same IP is blank)', async () => {
  const a = load(catRoute);
  const rows = await a.fetchCatProxiesPool({ token: CP_KEY, orderId: CP_PLAN, poolType: 'mobile', country: 'US', count: '2' });
  for (const r of rows) assert.match(r.username, /-sid-sg[0-9a-f]+\d-ttl-30m$/);
  const { LIFE_BLANK_DEFAULTS } = await pull();
  assert.equal(LIFE_BLANK_DEFAULTS.catproxies, 30, 'the form says 30 minutes, as main sends');
});

test('72 CatProxies: Keep same IP offers each pool its own range (Mobile up to 4 hours, Premium up to 7 days)', async () => {
  const { lifeOptionsFor } = await pull();
  const g = geoSyncOf('catproxies');
  assert.deepEqual(lifeOptionsFor(g, 'mobile'), [5, 10, 30, 60, 120, 180, 240]);
  for (const m of lifeOptionsFor(g, 'mobile')) assert.equal(U.catProxiesMobileTtl(m), m, `${m} is an accepted ttl, never clamped`);
  assert.equal(lifeOptionsFor(g, 'residential').slice(-1)[0], 1440);
  assert.equal(lifeOptionsFor(g, 'residential_premium').slice(-1)[0], 10080);
  for (const lang of ['en', 'es']) for (const m of [180, 240]) assert.equal(typeof geoText(lang, `life${m}`), 'string', `${lang} life${m}`);
});

test('72 CatProxies: Gateway picks the US, Europe or Asia server of each pool', async () => {
  const a = load(catRoute);
  const host = async (poolType, zone, extra = {}) => (await a.fetchCatProxiesPool({ token: CP_KEY, orderId: CP_PLAN, poolType, zone, count: '1', ...extra }))[0];
  assert.equal((await host('residential', '')).host, 'resi-us.catproxies.com', 'US when blank');
  assert.equal((await host('residential', 'eu')).host, 'resi-fr.catproxies.com');
  assert.equal((await host('residential', 'asia')).host, 'resi-sg.catproxies.com');
  assert.equal((await host('mobile', 'eu')).host, 'mobile-eu.catproxies.com');
  assert.equal((await host('mobile', 'asia')).host, 'mobile-asia.catproxies.com');
  const premiumEu = await host('residential_premium', 'eu', { proxyType: 'socks5' });
  assert.deepEqual([premiumEu.host, premiumEu.port, premiumEu.type], ['eu.premium.catproxies.com', 6015, 'SOCKS5']);
  await assert.rejects(host('residential', 'mars'), /Gateway must be US, Europe or Asia/);
  const g = geoSyncOf('catproxies');
  assert.deepEqual(g.regions, ['residential', 'residential_premium', 'mobile'], 'not on the fixed-IP pools');
  assert.match(UI, /zone: regionForPool\(g, form\.poolType\) && \['eu', 'asia'\]\.includes\(form\.zone\) \? form\.zone : ''/);
  for (const lang of ['en', 'es']) for (const k of ['gatewayRegionLabel', 'regionUs', 'regionEu', 'regionAsia']) assert.equal(typeof geoText(lang, k), 'string', `${lang} ${k}`);
});

test('72 CatProxies: Premium Residential puts its targeting on the password (resix)', async () => {
  assert.ok(geoSyncOf('catproxies').poolType.some(([v, l]) => v === 'residential_premium' && l === 'Premium Residential'));
  assert.equal(U.catProxiesPremiumPassword('pw', { country: 'GB', city: 'London' }), 'pw-country-gb_city-london', 'first flag with "-", the rest with "_"');
  assert.equal(U.catProxiesPremiumPassword('pw', { country: 'US', state: 'California' }), 'pw-country-us_state-california');
  assert.equal(U.catProxiesPremiumPassword('pw', { country: 'DE', state: 'Bayern' }), 'pw-country-de', 'a state is US-only');
  assert.equal(U.catProxiesPremiumPassword('pw', { session: 'ab12cd34', lifetimeMin: 90 }), 'pw-session-ab12cd34_lifetime-90m');
  assert.equal(U.catProxiesPremiumPassword('pw', { session: 'ab12cd34', lifetimeMin: 1440 }), 'pw-session-ab12cd34_lifetime-24h');
  assert.equal(U.catProxiesPremiumPassword('pw', { session: 'ab12cd34', lifetimeMin: 99999 }), 'pw-session-ab12cd34_lifetime-168h', 'capped at 168 hours');
  for (const name of ['shop1', 'Sg-ABC_1', 'x'.repeat(40)]) assert.match(U.catProxiesPremiumSession(name), /^[a-z0-9]{8}$/, name);
  assert.equal(U.catProxiesPremiumSession('shop1'), U.catProxiesPremiumSession('shop1'), 'stable: the same name keeps the same IP');
  const a = load(catRoute);
  const rotating = await a.fetchCatProxiesPool({ token: CP_KEY, orderId: CP_PLAN, poolType: 'residential_premium', country: 'GB', count: '1' });
  assert.deepEqual([rotating[0].host, rotating[0].port, rotating[0].username, rotating[0].password], ['us.premium.catproxies.com', 6011, 'cpuser', 'cppass-country-gb']);
  const sticky = await a.fetchCatProxiesPool({ token: CP_KEY, orderId: CP_PLAN, poolType: 'residential_premium', country: 'GB', count: '3' });
  assert.equal(new Set(sticky.map((r) => r.password)).size, 3, 'one session per row, on the password');
  for (const r of sticky) {
    assert.equal(r.port, 6011, 'sticky on the same port');
    assert.match(r.password, /^cppass-country-gb_session-[a-z0-9]{8}_lifetime-30m$/);
    assert.equal(r.dedupeOnPassword, true);
  }
  await assert.rejects(a.fetchCatProxiesPool({ token: CP_KEY, orderId: CP_PLAN, poolType: 'residential_premium', country: 'DE', state: 'Bayern', count: '1' }), /state for the United States only/);
  await assert.rejects(a.fetchCatProxiesPool({ token: CP_KEY, orderId: CP_PLAN, poolType: 'residential_premium', country: 'US', state: 'CA', city: 'Fresno', count: '1' }), /a state or a city, not both/);
});

// ---- 73 PacketStream -----------------------------------------------------------------------------------

test('73 PacketStream: HTTPS on 31111 (TLS to the proxy) as a Protocol choice; HTTP stays the default', async () => {
  assert.equal(geoSyncOf('packetstream').protoHttps, true);
  const a = load();
  const https = await a.fetchPacketStreamPool({ username: 'me', password: 'authkey1', count: '1', proxyType: 'https' });
  assert.deepEqual([https[0].type, https[0].host, https[0].port], ['HTTPS', 'proxy.packetstream.io', 31111]);
  assert.deepEqual([(await a.fetchPacketStreamPool({ username: 'me', password: 'k', count: '1' }))[0].port], [31112]);
  assert.deepEqual([(await a.fetchPacketStreamPool({ username: 'me', password: 'k', count: '1', proxyType: 'socks5' }))[0].port], [31113]);
  // An HTTPS row is a proxy the launch and the checker reach over TLS (since 1.0.26).
  assert.match(IPC, /const VALID_PROXY_TYPES = new Set\(\['HTTP', 'HTTPS', 'SOCKS5', 'SOCKS4'\]\);/);
});

test('73 PacketStream: the texts use its own names, Proxy Access and auth key', async () => {
  const a = load();
  await assert.rejects(a.fetchPacketStreamPool({ password: 'k' }), /dashboard, Proxy Access/);
  await assert.rejects(a.fetchPacketStreamPool({ username: 'me' }), /auth key \(dashboard, Proxy Access\)/);
  assert.doesNotMatch(between('// ---- PacketStream (proxy.packetstream.io', '// ---- Airproxy'), /Network Access|Proxy Password/);
  for (const lang of ['en', 'es']) {
    assert.match(hint(lang, 'packetstream'), /Proxy Access/);
    assert.match(hint(lang, 'packetstream'), /31111/);
    assert.doesNotMatch(hint(lang, 'packetstream'), /Network Access/);
  }
  // The country stays the dashboard name the live test of 6 Oct needed (ISO codes are a re-test item).
  assert.equal(U.packetStreamPassword('k', { country: 'US' }), 'k_country-UnitedStates');
});

// ---- 74 Airproxy -----------------------------------------------------------------------------------------

test('74 Airproxy: every proxy comes in as IT, and Protocol can make it SOCKS5 on the same port', async () => {
  const list = { success: true, proxies: [{ id: 9, ip: 's1.airproxy.io', port: 30501, username: 'acct', password: 'DUMMYpass', isp: 'TIM' }] };
  const http = U.airproxyRows(list);
  assert.deepEqual([http[0].type, http[0].country], ['HTTP', 'IT']);
  const socks = U.airproxyRows(list, { socks: true });
  assert.deepEqual([socks[0].type, socks[0].host, socks[0].port, socks[0].country], ['SOCKS5', 's1.airproxy.io', 30501, 'IT']);
  const a = load(() => list);
  assert.equal((await a.fetchAirproxyPool({ token: 'k1', proxyType: 'socks5' }))[0].type, 'SOCKS5');
  assert.ok(a.calls.every((c) => !/change_ip/.test(c.url)), 'rotation is still never called');
  assert.equal(geoSyncOf('airproxy').proto, true);
  assert.match(hint('en', 'airproxy'), /all in Italy/);
  assert.match(hint('es', 'airproxy'), /todos en Italia/);
});

// ---- 75 MobileProxy.Space ----------------------------------------------------------------------------------

const MPS_PROXY = {
  proxy_id: 101, proxy_login: 'lg1', proxy_pass: 'pw1', proxy_hostname: 'p1.mobileproxy.example', proxy_host_ip: '185.1.2.3',
  proxy_http_port: 11001, proxy_socks5_port: 11002, proxy_geo: 'Moscow', proxy_operator: 'MTS', id_country: 7,
  proxy_independent_http_hostname: 'ind-http.mobileproxy.example', proxy_independent_socks5_hostname: 'ind-socks.mobileproxy.example', proxy_independent_port: 21000
};

test('75 MobileProxy.Space: the equipment-independent address wins, with the old host as a fallback', () => {
  const http = U.mobileProxySpaceRows({ status: 'ok', list: [MPS_PROXY] }).rows[0];
  assert.deepEqual([http.host, http.port], ['ind-http.mobileproxy.example', 21000]);
  const socks = U.mobileProxySpaceRows({ status: 'ok', list: [MPS_PROXY] }, { socks: true }).rows[0];
  assert.deepEqual([socks.host, socks.port, socks.type], ['ind-socks.mobileproxy.example', 21000, 'SOCKS5']);
  const ipOnly = { ...MPS_PROXY, proxy_independent_http_hostname: '', proxy_independent_http_host_ip: '91.0.0.9' };
  assert.equal(U.mobileProxySpaceRows({ status: 'ok', list: [ipOnly] }).rows[0].host, '91.0.0.9');
  const classic = { ...MPS_PROXY, proxy_independent_http_hostname: '', proxy_independent_port: '' };
  assert.deepEqual(['host', 'port'].map((k) => U.mobileProxySpaceRows({ status: 'ok', list: [classic] }).rows[0][k]), ['185.1.2.3', 11001]);
});

test('75 MobileProxy.Space: each proxy gets its country from id_country, asked once and only when needed', async () => {
  const route = (url) => {
    if (url.endsWith('?command=get_my_proxy')) return { status: 'ok', list: [MPS_PROXY] };
    if (url.endsWith('?command=get_id_country')) return { status: 'ok', id_country: [{ id_country: 7, name: 'Russia', iso: 'ru' }, { id_country: 8, name: 'Bad', iso: 'xx1' }] };
    return undefined;
  };
  const a = load(route);
  const rows = await a.fetchMobileProxySpacePool({ token: 'tok' });
  assert.equal(rows[0].country, 'RU');
  assert.deepEqual(a.calls.map((c) => c.url), ['https://mpsapi.com/api.html?command=get_my_proxy', 'https://mpsapi.com/api.html?command=get_id_country']);
  assert.ok(a.calls.every((c) => c.headers.Authorization === 'Bearer tok' && !c.url.includes('tok')));
  // The country table failing does not stop the import.
  const b = load((url) => (url.endsWith('get_id_country') ? (() => { throw httpError(429); })() : route(url)));
  const plain = await b.fetchMobileProxySpacePool({ token: 'tok' });
  assert.deepEqual([plain.length, plain[0].country], [1, null]);
  assert.deepEqual(U.mobileProxySpaceCountries('nope'), {});
  // The address stays on mpsapi.com (the docs disagree; listed as an open question).
  assert.match(IPC, /const MOBILEPROXYSPACE_API = 'https:\/\/mpsapi\.com\/api\.html';/);
});

// ---- The shared mechanisms this lane adds ------------------------------------------------------------------

test('lifeOptionsFor: a pool maximum (maxLifeByPool) also cuts a vendor\'s own lifeOptions list', async () => {
  const { lifeOptionsFor } = await pull();
  const g = { maxLife: 120, maxLifeByPool: { flex: 30 } };
  assert.deepEqual(lifeOptionsFor(g, 'flex'), [5, 10, 30]);
  assert.deepEqual(lifeOptionsFor(g, 'other'), [5, 10, 30, 60, 120]);
  assert.deepEqual(lifeOptionsFor(g), [5, 10, 30, 60, 120], 'no pool: the vendor list');
  const own = { lifeOptions: [5, 180, 240, 1440], maxLifeByPool: { m: 240 } };
  assert.deepEqual(lifeOptionsFor(own, 'm'), [5, 180, 240], 'steps the shared list lacks, cut for the pool');
  assert.deepEqual(lifeOptionsFor(own, 'x'), [5, 180, 240, 1440]);
});

test('every new or changed string is in English and Spanish, with no em or en dashes', () => {
  const vendors = ['packetstream', 'airproxy', 'catproxies', 'rapidproxy', 'proxiessx', 'mobileproxyspace', 'proxysolutions', 'databay',
    'proxybonanza', 'gsocks', 'singaporemobileproxy', 'simplyproxies', 'gonzoproxy', 'twoextract', 'coronium'];
  const geoKeys = ['life180', 'life240', 'gatewayRegionLabel', 'regionUs', 'regionEu', 'regionAsia'];
  for (const lang of ['en', 'es']) {
    for (const v of vendors) {
      assert.equal(typeof hint(lang, v), 'string', `${lang} ${v}`);
      assert.doesNotMatch(hint(lang, v), /[–—]/, `${lang} ${v}: no dashes`);
      assert.doesNotMatch(hint(lang, v), /Softglaze|LV\d{5}/, `${lang} ${v}: SoftGlaze spelling, no real trial username`);
    }
    for (const k of geoKeys) assert.doesNotMatch(geoText(lang, k), /[–—]/, `${lang} ${k}`);
  }
  for (const k of geoKeys) assert.notEqual(geoText('es', k) === geoText('en', k) && !/^(Asia)$/.test(geoText('en', k)), true, `es ${k} is translated`);
});
