'use strict';
// Per-vendor connector fixes, 1.0.27 backlog batches 1 and 2 plus items 11 to 13: NOVADA, DataImpulse,
// Apify, Proxidize, Proxy-Seller, Froxy, IPRoyal, Live Proxies, AnyIP, MarsProxies, NodeMaven, Bright
// Data, Oxylabs, Decodo, ShopSocks5, Proxy302, IPFoxy, IP Burger and MangoProxy.
//
// Vendor answers are fixtures built from the documented shapes in the vendor notes; no test reaches a
// provider and no real credential is used. ipcHandlers.js pulls in electron, so each test lifts the
// vendor's section out of the file and runs it against a stubbed transport.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const UTILS = read('src', 'main', 'proxyVendorUtils.js');
const UI = read('src', 'renderer', 'components', 'ProxyProviders.jsx');
const PAGE = read('src', 'renderer', 'pages', 'ProxyProvidersPage.jsx');
const locale = (lang, ns = 'cmpSettingsC') => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`));
const LOCALES = { en: locale('en'), es: locale('es') };
const hint = (lang, key) => LOCALES[lang].proxyProviders.geoHints[key];
const pull = () => import('../src/renderer/lib/gatewayPull.mjs');

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
const providerLine = (key) => {
  const line = UI.split(/\r?\n/).find((l) => l.includes(`{ key: '${key}',`));
  assert.ok(line, `${key} must be a PROVIDERS entry`);
  return line;
};
const lift = (code, scope, names) => {
  const keys = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, `${code}\nreturn { ${names.join(', ')} };`)(...keys.map((k) => scope[k]));
};
const CORE = between('function normCountryCode(', '// ---- Apify Residential');

// A stub transport: routes maps a URL prefix (longest first) to a reply, a function or an Error.
function transport(routes) {
  const calls = [];
  const httpRequestText = async (url, options = {}) => {
    calls.push({ url, options, body: options.body && String(options.body).startsWith('{') ? JSON.parse(options.body) : options.body });
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((r) => url.startsWith(r));
    if (!key) throw new Error(`no network in this test: ${url}`);
    const answer = routes[key];
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(url, options) : answer;
  };
  return { calls, httpRequestText };
}

// ---- 11 NOVADA -----------------------------------------------------------------------------------

test('NOVADA: Rotating ISP sessions run to 360 minutes, Residential and Mobile to 120', async () => {
  assert.equal(U.novadaUsername('u1', { poolType: 'isp', session: 's', lifeMin: 360 }), 'u1-zone-isp-session-s-sessTime-360');
  assert.equal(U.novadaUsername('u1', { poolType: 'isp', session: 's', lifeMin: 1440 }), 'u1-zone-isp-session-s-sessTime-360');
  assert.equal(U.novadaUsername('u1', { poolType: 'residential', session: 's', lifeMin: 360 }), 'u1-zone-res-session-s-sessTime-120');
  assert.equal(U.novadaUsername('u1', { poolType: 'mobile', session: 's', lifeMin: 360 }), 'u1-zone-mob-session-s-sessTime-120');
  assert.match(providerLine('novada'), /maxLife: 120, maxLifeByPool: \{ isp: 360 \}/);
  const { lifeOptionsFor } = await pull();
  const g = { maxLife: 120, maxLifeByPool: { isp: 360 } };
  assert.deepEqual(lifeOptionsFor(g, 'isp'), [5, 10, 30, 60, 120, 360]);
  assert.deepEqual(lifeOptionsFor(g, 'residential'), [5, 10, 30, 60, 120]);
  // Another pool type clears a time it does not offer.
  assert.match(UI, /if \(form\.life && !lifeValuesFor\(value\)\.includes\(String\(form\.life\)\)\) set\('life', ''\);/);
  assert.match(UI, /onChange=\{\(e\) => choosePool\(e\.target\.value\)\}/);
});

test('NOVADA: the docs path is Users, Add User, and no example host is named', () => {
  assert.match(fnSrc('fetchNovadaPool'), /Users, Add User/);
  for (const [name, text] of [['ipcHandlers', IPC], ['proxyVendorUtils', UTILS], ['ProxyProviders', UI], ['en', JSON.stringify(LOCALES.en)], ['es', JSON.stringify(LOCALES.es)]]) {
    assert.doesNotMatch(text, /pr-as\.novada\.pro/, `${name}: hosts are per account`);
    assert.doesNotMatch(text, /Create Users/, name);
  }
  assert.match(hint('en', 'novada'), /Users, Add User/);
  assert.match(hint('en', 'novada'), /360 on Rotating ISP/);
  assert.match(hint('es', 'novada'), /360 en ISP rotativo/);
});

// ---- 12 DataImpulse, 13 Apify ----------------------------------------------------------------------

test('DataImpulse: the overview names the SOCKS5 port, and the product is Premium Residential', () => {
  assert.match(providerLine('dataimpulse'), /gateway: \{ host: 'gw\.dataimpulse\.com', port: 823, type: 'HTTP', socksPort: 824 \}/);
  assert.match(PAGE, /p\.gateway\.socksPort\s*\? t\('detail\.gatewayPorts', \{ host: p\.gateway\.host, port: p\.gateway\.port, socksPort: p\.gateway\.socksPort \}\)/);
  for (const lang of ['en', 'es']) {
    assert.equal(locale(lang, 'providersPage').detail.gatewayPorts, '{{host}}:{{port}} HTTP, :{{socksPort}} SOCKS5');
  }
  assert.match(IPC, /residential_premium: 'Premium Residential'/);
  assert.equal(LOCALES.en.proxyProviders.geo.diResidentialPremium, 'Premium Residential');
  assert.match(UI, /t\('proxyProviders\.geo\.diResidentialPremium', 'Premium Residential'\)/);
  assert.doesNotMatch(IPC + UI, /Residential Premium/);
});

test('Apify: the hint says residential proxies need a paid plan', () => {
  assert.match(hint('en', 'apify'), /Residential proxies need a paid Apify plan\./);
  assert.match(hint('es', 'apify'), /plan de pago de Apify/);
});

// ---- 24, 33 Proxidize --------------------------------------------------------------------------------

function proxidize() {
  const t = transport({
    'https://api.proxidize.com/api/v1/pergb/residential/user-info': JSON.stringify({ data: { traffic_left: 5 } }),
    'https://api.proxidize.com/api/v1/pergb/mobile/user-info': JSON.stringify({ data: { traffic_left: 5 } }),
    'https://api.proxidize.com/api/v1/pergb/residential/access-point': JSON.stringify({ data: [{ username: 'apuser', password: 'appass' }] }),
    'https://api.proxidize.com/api/v1/pergb/mobile/access-point': JSON.stringify([{ username: 'apmob', password: 'appass2' }])
  });
  const fns = lift(`${CORE}\n${between('// ---- Proxidize (api.proxidize.com', '// ---- Live Proxies ----')}`,
    { ...U, httpRequestText: t.httpRequestText, crypto: nodeCrypto }, ['fetchProxidizePool']);
  return { ...fns, calls: t.calls };
}

test('Proxidize Per GB runs end to end with a blank username, from the form as it opens', () => {
  // The form: the username is optional, and a fresh form starts on the first pool (Residential).
  assert.match(providerLine('proxidize'), /creds: \['token', 'username'\], optional: \['username'\], labels: \{ username: 'perProxyUsernameLabel' \}/);
  const geo = UI.slice(UI.indexOf('async function handleGeoSync'), UI.indexOf('async function handleLookup'));
  assert.match(geo, /!optional\.includes\('username'\)/);
  for (const lang of ['en', 'es']) assert.equal(typeof LOCALES[lang].proxyProviders.geo.perProxyUsernameLabel, 'string');
  assert.match(hint('en', 'proxidize'), /For a Per-GB plan, leave the username empty/);
});

test('Proxidize Per GB: blank username builds sticky rows; the Port field is used, and 20000 / 20002 follow Protocol', async () => {
  const p = proxidize();
  const rows = await p.fetchProxidizePool({ token: 'tok', username: '', host: 'pg.proxi.es', port: '20000', poolType: 'residential', country: 'US', count: '3' });
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].host, rows[0].port, rows[0].type], ['pg.proxi.es', 20000, 'HTTP']);
  assert.match(rows[0].username, /^apuser-s-[0-9a-f]{10}-co-US-type-residential$/);
  assert.deepEqual(p.calls.map((c) => new URL(c.url).pathname), ['/api/v1/pergb/residential/user-info', '/api/v1/pergb/residential/access-point']);
  const socks = await proxidize().fetchProxidizePool({ token: 'tok', port: '20000', proxyType: 'socks5', poolType: 'mobile', count: '1' });
  assert.deepEqual([socks[0].port, socks[0].type], [20002, 'SOCKS5'], 'the prefilled 20000 does not send SOCKS5 to the HTTP port');
  const custom = await proxidize().fetchProxidizePool({ token: 'tok', port: '31000', poolType: 'mobile', count: '1' });
  assert.equal(custom[0].port, 31000, 'a port from Proxy Details is used as typed');
  const bad = proxidize();
  await assert.rejects(bad.fetchProxidizePool({ token: 'tok', port: 'abc', poolType: 'mobile' }), /port must be a number/);
  assert.equal(bad.calls.length, 0, 'a bad port stops before any API call');
});

// ---- 25, 32, 40 Proxy-Seller ------------------------------------------------------------------------

const PS_KEY = 'fakeKey1234567890abcd';
const PS_BASE = `https://proxy-seller.com/personal/api/v2/${PS_KEY}/`;
const psOk = (data) => JSON.stringify({ status: 'success', data, errors: [] });
function proxySeller(routes) {
  const t = transport(Object.fromEntries(Object.entries(routes).map(([k, v]) => [`${PS_BASE}${k}`, v])));
  const fns = lift(between('const PS_API = ', 'const IPR_API = '), {
    ...U, fs: fs.promises, path, os: require('node:os'),
    normCountryCode: (v) => { const s = String(v || '').trim().toUpperCase(); return /^[A-Z]{2}$/.test(s) ? s : ''; },
    clampPoolCount: (value, def = 5, max = 500) => { const n = Number.parseInt(String(value), 10); return !Number.isFinite(n) || n < 1 ? def : Math.min(n, max); },
    httpRequestText: t.httpRequestText
  }, ['fetchProxySellerPool']);
  return { ...fns, calls: t.calls };
}

test('Proxy-Seller per-IP orders import every IP: the hidden How many is not sent', async () => {
  const geo = UI.slice(UI.indexOf('async function handleGeoSync'), UI.indexOf('async function handleLookup'));
  assert.match(geo, /count: g\.ps && form\.plan !== 'residential' \? '' : form\.count,/);
  const items = Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, ip: `203.0.113.${i + 1}`, port_http: 10000 + i, port_socks: 20000 + i, login: 'l', password: 'p', protocol: 'HTTP' }));
  const p = proxySeller({ 'proxy/list/ipv6': psOk({ items }) });
  const rows = await p.fetchProxySellerPool({ token: PS_KEY, plan: 'ipv6', count: '' });
  assert.equal(rows.length, 7, 'a blank count is the whole order');
});

test('Proxy-Seller residential export sends protocol= and the chosen entry server', async () => {
  const pkg = { is_active: true, traffic_left: '1073741824' };
  const list = { id: 77, title: 'SoftGlaze US', geo: { country: 'US' }, rotation: -1 };
  const download = 'l1:p1@us.res.proxy-seller.com:10000\nl1:p1@us.res.proxy-seller.com:10001';
  const p = proxySeller({ 'resident/package': psOk(pkg), 'resident/lists': psOk([list]), 'proxy/download/resident': download });
  const rows = await p.fetchProxySellerPool({ token: PS_KEY, listId: '77', proxyType: 'socks5', host: 'us.res.proxy-seller.com' });
  const url = new URL(p.calls.find((c) => c.url.includes('proxy/download/resident')).url);
  assert.equal(url.searchParams.get('protocol'), 'socks5');
  assert.equal(url.searchParams.has('proto'), false, 'proto does not apply to resident lists');
  assert.equal(url.searchParams.get('host'), 'us.res.proxy-seller.com');
  assert.deepEqual([rows.length, rows[0].type, rows[0].host], [2, 'SOCKS5', 'us.res.proxy-seller.com']);
  const q = proxySeller({ 'resident/package': psOk(pkg), 'resident/lists': psOk([list]), 'proxy/download/resident': download });
  await q.fetchProxySellerPool({ token: PS_KEY, listId: '77', host: 'evil.example.com' });
  const url2 = new URL(q.calls.find((c) => c.url.includes('proxy/download/resident')).url);
  assert.deepEqual([url2.searchParams.get('protocol'), url2.searchParams.get('host')], ['http', 'res.proxy-seller.com'], 'only the three documented servers pass');
  // The form: an Entry server select on residential, stored in host.
  assert.match(UI, /const PS_RESIDENT_HOSTS = \[\['', 'psHostEurope'\], \['us\.res\.proxy-seller\.com', 'psHostUs'\], \['asia\.res\.proxy-seller\.com', 'psHostAsia'\]\];/);
  for (const lang of ['en', 'es']) for (const k of ['hostLabel', 'psHostEurope', 'psHostUs', 'psHostAsia', 'hostHint']) assert.equal(typeof LOCALES[lang].proxyProviders.ps[k], 'string', `${lang} ${k}`);
});

test('Proxy-Seller hint names IPv4 Mix and ISP Mix', () => {
  assert.match(hint('en', 'proxyseller'), /IPv4 Mix and ISP Mix are sold per IP/);
  assert.match(hint('es', 'proxyseller'), /IPv4 Mix e ISP Mix se venden por IP/);
});

// ---- 26, 41 Froxy --------------------------------------------------------------------------------------

function froxy() {
  return lift(`${CORE}\n${between('// Froxy (SOAX reseller, proxy.froxy.com:9000)', '// ---- PacketStream')}`, { ...U }, ['fetchFroxyPool']);
}

test('Froxy: Datacenter is shared, a pasted Mobile password stays mobile, and a Pool type against it is refused', async () => {
  const f = froxy();
  const mob = await f.fetchFroxyPool({ username: 'pkg', password: 'mobile;;;;', poolType: 'mobile', country: 'US', count: '1' });
  assert.equal(mob[0].password, 'mobile;us;;;');
  assert.match(mob[0].label, /Froxy • Mobile/);
  await assert.rejects(f.fetchFroxyPool({ username: 'pkg', password: 'mobile;;;;', poolType: 'residential', count: '1' }),
    /pasted password is for a Mobile subscription, but Pool type is Residential/);
  const dc = await f.fetchFroxyPool({ username: 'pkg', password: 'shared;;;;', poolType: 'datacenter', count: '1' });
  assert.match(dc[0].label, /Froxy • Datacenter/);
  assert.equal(dc[0].password, 'shared;;;;');
  // The form follows the pasted word.
  assert.match(UI, /const FROXY_TYPE_POOLS = \{ wifi: 'residential', mobile: 'mobile', shared: 'datacenter' \};/);
  assert.match(UI, /if \(provider\.key !== 'froxy'\) return;/);
});

test('Froxy: a pull takes the ports the pool does not hold yet for the login', async () => {
  const f = froxy();
  const asked = [];
  const existingPorts = async (q) => { asked.push(q); return new Set([9000, 9001, 9003]); };
  const rows = await f.fetchFroxyPool({ username: 'pkg', password: 'wifi;;;;', country: 'DE', count: '3', existingPorts });
  assert.deepEqual(rows.map((r) => r.port), [9002, 9004, 9005]);
  assert.deepEqual(asked, [{ host: 'proxy.froxy.com', login: 'pkg' }]);
  const full = new Set(Array.from({ length: 1000 }, (_, i) => 9000 + i));
  await assert.rejects(f.fetchFroxyPool({ username: 'pkg', password: 'wifi', count: '1', existingPorts: async () => full }), /already holds all 1000 ports/);
  const fresh = await f.fetchFroxyPool({ username: 'pkg', password: 'wifi', count: '2' });
  assert.deepEqual(fresh.map((r) => r.port), [9000, 9001], 'with nothing pooled, ports start at 9000');
});

test('Froxy hint: the plans always need an IP whitelist', () => {
  assert.match(hint('en', 'froxy'), /always authorize by IP whitelist/);
  assert.doesNotMatch(hint('en', 'froxy'), /If your subscription uses an IP whitelist/);
  assert.match(hint('es', 'froxy'), /siempre autorizan por lista blanca de IP/);
});

// ---- 27 IPRoyal -------------------------------------------------------------------------------------------

test('IPRoyal: an HTTP port named "http|https" is found', () => {
  const nodes = [{ dns: 'geo.iproyal.com', ports: [{ name: 'socks5', port: 32325 }, { name: 'http|https', port: 12321 }] }];
  assert.deepEqual(U.pickIpRoyalPort(nodes, false), { name: 'http|https', port: 12321, dns: 'geo.iproyal.com' });
  assert.equal(U.pickIpRoyalPort(nodes, true).name, 'socks5');
  assert.equal(U.pickIpRoyalPort([{ ports: [{ name: 'socks5', port: 1 }] }], false), null);
});

test('IPRoyal: the spec wording without a number still makes the pull retry with a smaller batch', async () => {
  assert.equal(U.ipRoyalCountRefused('IPRoyal proxy list: The proxy count field must be between 1 and the configured proxy_list_max_quantity.'), true);
  assert.equal(U.ipRoyalCountRefused('IPRoyal proxy list: The location is invalid.'), false);
  const serverMax = 100;
  let n = 0;
  const t = transport({
    'https://resi-api.iproyal.com/v1/residential/me': JSON.stringify({ available_traffic: 5 }),
    'https://resi-api.iproyal.com/v1/access/entry-nodes': JSON.stringify([{ dns: 'geo.iproyal.com', ports: [{ name: 'http|https', port: 12321 }] }]),
    'https://resi-api.iproyal.com/v1/access/generate-proxy-list': (url, options) => {
      const body = JSON.parse(options.body);
      if (body.proxy_count > serverMax) {
        throw Object.assign(new Error('HTTP 422 {"error":{"code":"failed_validation","message":"The proxy count field must be between 1 and the configured proxy_list_max_quantity."}}'), { status: 422 });
      }
      return JSON.stringify(Array.from({ length: body.proxy_count }, () => { n += 1; return `geo.iproyal.com:12321:sub:pw_country-us_session-s${n}_lifetime-24h`; }));
    }
  });
  const { fetchIpRoyalPool } = lift(between('const IPR_API = ', '// ---- MarsProxies'), {
    ...U, httpRequestText: t.httpRequestText, MINTED_PULL_MAX: 1000,
    normCountryCode: (v) => String(v || '').toUpperCase(),
    clampPoolCount: (value, def = 5, max = 500) => { const k = Number.parseInt(String(value), 10); return !Number.isFinite(k) || k < 1 ? def : Math.min(k, max); }
  }, ['fetchIpRoyalPool']);
  const rows = await fetchIpRoyalPool({ token: 'tok', username: 'sub', password: 'pw', country: 'us', count: '300', poolType: 'sticky' });
  assert.equal(rows.length, 300);
  const sizes = t.calls.filter((c) => c.url.endsWith('/generate-proxy-list')).map((c) => c.body.proxy_count);
  assert.deepEqual(sizes.slice(0, 3), [300, 150, 75], 'halves until the server takes it');
  assert.equal(t.calls.filter((c) => c.url.endsWith('/generate-proxy-list')).every((c) => c.body.port === 'http|https'), true);
});

// ---- 28, 37, 38, 80 Live Proxies -------------------------------------------------------------------------

function liveProxies() {
  return lift(`${CORE}\n${between('// ---- Live Proxies ----', 'const VENDOR_LOOKUPS = ')}`, { ...U, crypto: nodeCrypto }, ['fetchLiveProxiesPool']);
}

test('Live Proxies: a typed session is used as typed, and anything else is refused, never trimmed', async () => {
  const lp = liveProxies();
  const one = await lp.fetchLiveProxiesPool({ username: 'LV00000', password: 'pw', country: 'US', session: '123', count: '1' });
  assert.deepEqual([one.length, one[0].username], [1, 'LV00000-lv_us-123'], 'no row number on one row');
  const eight = await lp.fetchLiveProxiesPool({ username: 'LV00000', password: 'pw', country: 'US', session: '12345678', count: '1' });
  assert.equal(eight[0].username, 'LV00000-lv_us-12345678', 'eight digits are kept, not cut to seven');
  const many = await lp.fetchLiveProxiesPool({ username: 'LV00000', password: 'pw', country: 'GB', session: '42', count: '12' });
  assert.deepEqual([many[0].username, many[11].username], ['LV00000-lv_gb-421', 'LV00000-lv_gb-4212']);
  await assert.rejects(lp.fetchLiveProxiesPool({ username: 'LV00000', password: 'pw', country: 'US', session: 'ab12', count: '1' }), /digits only/);
  await assert.rejects(lp.fetchLiveProxiesPool({ username: 'LV00000', password: 'pw', country: 'US', session: '123456789', count: '1' }), /at most 8 digits/);
  await assert.rejects(lp.fetchLiveProxiesPool({ username: 'LV00000', password: 'pw', country: 'US', session: '1234567', count: '20' }), /run past 8 digits/);
  await assert.rejects(lp.fetchLiveProxiesPool({ username: 'LV00000', password: 'pw', country: '', count: '1' }), /pick a country/);
});

test('Live Proxies form: a country from the start, no label-only pool types, and a digits session that says so', () => {
  const line = providerLine('liveproxies');
  assert.match(line, /countryRequired: true/);
  assert.match(line, /sessionDigits: 8/);
  assert.doesNotMatch(line, /poolType|Static residential|Rotating mobile/, 'gateway logins are B2B residential; the pool type changed only the label');
  assert.match(UI, /\{!provider\.geoSync\.countryRequired && <option value="">/);
  assert.match(UI, /country: needCountry \? 'US' : ''/);
  assert.match(UI, /needCountry && !draft\.country \? \{ country: 'US' \} : \{\}/);
  const geo = UI.slice(UI.indexOf('async function handleGeoSync'), UI.indexOf('async function handleLookup'));
  assert.match(geo, /if \(g\.countryRequired && !form\.country\)/);
  assert.match(geo, /if \(g\.sessionDigits && sessionText && !new RegExp/);
  assert.match(UI, /aria-invalid=\{bad \|\| undefined\}/);
  assert.match(UI, /t\('proxyProviders\.geo\.sessionDigitsError', \{ max: digits \}\)/);
  for (const lang of ['en', 'es']) {
    const geoStrings = LOCALES[lang].proxyProviders.geo;
    assert.match(geoStrings.sessionDigitsError, /\{\{max\}\}/);
    assert.match(geoStrings.stickySessionDigitsPlaceholder, /\{\{max\}\}/);
  }
});

test('Live Proxies hint: mobile sessions hold 30 minutes', () => {
  assert.match(hint('en', 'liveproxies'), /60 minutes on residential plans \(30 on mobile plans\)/);
  assert.match(hint('es', 'liveproxies'), /30 en los móviles/);
});

test('the real trial username appears nowhere in the app or the tests', () => {
  const real = ['LV', '58712'].join('');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(js|jsx|mjs|cjs|json)$/.test(e.name) ? [p] : [];
  });
  for (const file of [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'test'))]) {
    assert.ok(!fs.readFileSync(file, 'utf8').includes(real), path.relative(ROOT, file));
  }
  assert.match(hint('en', 'liveproxies'), /for example LV00000/);
  assert.match(fnSrc('mintLiveProxiesRows'), /for example LV00000/);
});

// ---- 29 AnyIP -------------------------------------------------------------------------------------------------

function anyip(settings) {
  let made = 0;
  const t = transport({
    'https://dashboard.anyip.io/api/v1/teams/': () => { made += 1; return JSON.stringify({ username: `user_prov${made}` }); }
  });
  const scope = {
    ...U, crypto: nodeCrypto, require,
    httpRequestText: async (url, o) => { await new Promise((r) => setTimeout(r, 5)); return t.httpRequestText(url, o); },
    scrubProxySecrets: (m) => String(m),
    getPrisma: () => ({}),
    proxySecrets: { hashPassword: async (_db, plain) => `h:${nodeCrypto.createHash('sha256').update(String(plain)).digest('hex')}` },
    secretStore: { seal: (v) => `sealed:${v}`, open: (v) => String(v).replace(/^sealed:/, '') },
    readSetting: async (key, fallback) => (Object.prototype.hasOwnProperty.call(settings, key) ? JSON.parse(JSON.stringify(settings[key])) : fallback),
    writeSetting: async (key, value) => { settings[key] = JSON.parse(JSON.stringify(value)); }
  };
  const fns = lift(`${CORE}\n${between('// anyip.io: one gateway', '// ---- ShopSocks5')}`, scope, ['fetchAnyIpPool']);
  return { ...fns, calls: t.calls, made: () => made };
}

test('AnyIP: an API key pull provisions one proxy user and every later pull reuses it', async () => {
  const settings = {};
  const a = anyip(settings);
  const first = await a.fetchAnyIpPool({ token: 'fake-api-key', teamId: 'team-1', country: 'US', count: '2' });
  const again = await a.fetchAnyIpPool({ token: 'fake-api-key', teamId: 'team-1', country: 'US', count: '2' });
  assert.equal(a.made(), 1, 'one proxy user for the same key and team');
  assert.match(first[0].username, /^user_prov1,/);
  assert.match(again[0].username, /^user_prov1,/);
  assert.equal(first[0].password, again[0].password);
  // After a restart (a new run, the same Setting table) it is still reused.
  const b = anyip(settings);
  const later = await b.fetchAnyIpPool({ token: 'fake-api-key', teamId: 'team-1', count: '1' });
  assert.equal(b.made(), 0);
  assert.equal(later[0].password, first[0].password);
  // The setting holds neither the key nor the plain password.
  const stored = JSON.stringify(settings.anyipProvisionedAccounts);
  assert.doesNotMatch(stored, /fake-api-key/);
  assert.doesNotMatch(stored, new RegExp(`"password":"${first[0].password}"`));
  assert.match(stored, /"password":"sealed:/);
  // Another team is another account.
  await b.fetchAnyIpPool({ token: 'fake-api-key', teamId: 'team-2', count: '1' });
  assert.equal(b.made(), 1);
});

test('AnyIP: two pulls started together make one proxy user', async () => {
  const a = anyip({});
  await Promise.all([
    a.fetchAnyIpPool({ token: 'fake-api-key', teamId: 'team-9', count: '1' }),
    a.fetchAnyIpPool({ token: 'fake-api-key', teamId: 'team-9', count: '1' })
  ]);
  assert.equal(a.made(), 1);
  assert.match(hint('en', 'anyip'), /reuse it, because AnyIP limits proxy users per plan and cannot delete them/);
  assert.match(hint('es', 'anyip'), /lo reutilizan/);
});

// ---- 30, 42 MarsProxies -----------------------------------------------------------------------------------------

function mars({ main = 0, subs = [{ hash: 'h1', username: 'mrsub1', traffic_available: 3 }], failSubs = false } = {}) {
  const t = transport({
    'https://api.marsproxies.com/v1/residential/me': JSON.stringify({ traffic_available: main }),
    'https://api.marsproxies.com/v1/residential/subusers': failSubs ? Object.assign(new Error('HTTP 404 Not Found'), { status: 404 }) : JSON.stringify({ data: subs }),
    'https://api.marsproxies.com/v1/residential/access/generate-proxy-list': (url, options) => {
      const body = JSON.parse(options.body);
      return JSON.stringify(Array.from({ length: body.proxy_count }, (_, i) => `ultra.marsproxies.com:44443:${body.username}:${body.password}_country-us_session-s${i}_lifetime-${body.lifetime || 'x'}`));
    }
  });
  const fns = lift(`${CORE}\n${between('const MARS_API = ', '// ---- NodeMaven')}`, { ...U, httpRequestText: t.httpRequestText, crypto: nodeCrypto }, ['fetchMarsProxiesPool']);
  return { ...fns, calls: t.calls, gen: () => t.calls.filter((c) => c.url.endsWith('/generate-proxy-list')).map((c) => c.body) };
}

test('MarsProxies: the traffic check reads the sub-user that pays, not the main balance', async () => {
  const ok = mars({ main: 0 });
  const rows = await ok.fetchMarsProxiesPool({ token: 't', username: 'mrsub1', password: 'Pw12345', count: '2' });
  assert.equal(rows.length, 2, 'main 0, sub-user 3 GB: the pull goes ahead');
  assert.ok(ok.calls.some((c) => c.url === 'https://api.marsproxies.com/v1/residential/subusers?search=mrsub1'));
  await assert.rejects(mars({ main: 9, subs: [{ username: 'mrsub1', traffic_available: 0 }] }).fetchMarsProxiesPool({ token: 't', username: 'mrsub1', password: 'Pw12345', count: '2' }),
    /this sub-user has no residential traffic left/);
  const shared = mars({ main: 0, subs: [{ username: 'mrsub1', traffic_available: 0, is_using_shared_traffic: true }] });
  await assert.rejects(shared.fetchMarsProxiesPool({ token: 't', username: 'mrsub1', password: 'Pw12345', count: '2' }), /no residential traffic left/, 'shared traffic is the main balance');
  const unknown = mars({ main: 0, failSubs: true });
  assert.equal((await unknown.fetchMarsProxiesPool({ token: 't', username: 'mrsub1', password: 'Pw12345', count: '1' })).length, 1, 'an unreadable sub-user does not block the pull');
});

test('MarsProxies: Keep same IP sets the lifetime, one proxy with it blank rotates, and only the base password is sent', async () => {
  const m = mars({ main: 5 });
  await m.fetchMarsProxiesPool({ token: 't', username: 'mrsub1', password: 'Pw12345_country-us_session-abc', count: '3', life: '60' });
  await m.fetchMarsProxiesPool({ token: 't', username: 'mrsub1', password: 'Pw12345', count: '3', life: '10080' });
  await m.fetchMarsProxiesPool({ token: 't', username: 'mrsub1', password: 'Pw12345', count: '3' });
  await m.fetchMarsProxiesPool({ token: 't', username: 'mrsub1', password: 'Pw12345', count: '1' });
  const [hour, week, blank, one] = m.gen();
  assert.deepEqual([hour.rotation, hour.lifetime, hour.proxy_count, hour.password], ['sticky', '1h', 3, 'Pw12345']);
  assert.equal(week.lifetime, '168h');
  assert.equal(blank.lifetime, '24h', 'MarsProxies default');
  assert.deepEqual([one.rotation, one.proxy_count, one.lifetime], ['random', 1, undefined], 'one proxy with Keep same IP blank is rotating');
  assert.match(providerLine('marsproxies'), /life: true, maxLife: 10080/);
  const { LIFE_BLANK_DEFAULTS, lifeBlankLabel } = await pull();
  assert.equal(LIFE_BLANK_DEFAULTS.marsproxies, 1440);
  assert.deepEqual(lifeBlankLabel('marsproxies', { count: '1' }), { key: 'lifeDifferent' });
  assert.deepEqual(lifeBlankLabel('marsproxies', { count: '3' }), { key: 'lifeDefaultTime', minutes: 1440 });
  assert.equal(U.ipRoyalLifetimeFromMinutes('30'), '30m');
  assert.equal(U.ipRoyalLifetimeFromMinutes(''), '');
});

test('MarsProxies hint: only the part of the password before the first underscore', () => {
  assert.match(hint('en', 'marsproxies'), /only the part before the first underscore/);
  assert.match(hint('es', 'marsproxies'), /primer guion bajo/);
});

// ---- 31, 43 NodeMaven -----------------------------------------------------------------------------------------

test('NodeMaven: every row asks for the medium quality filter and IPv4 only', async () => {
  const { fetchNodeMavenPool } = lift(`${CORE}\n${between('const NODEMAVEN_GATEWAY = ', '// Froxy (SOAX reseller')}`, { ...U, crypto: nodeCrypto }, ['fetchNodeMavenPool']);
  const rot = await fetchNodeMavenPool({ username: 'nm', password: 'p', country: 'US', count: '1' });
  assert.equal(rot[0].username, 'nm-country-us-type-residential-filter-medium-ipv4-true');
  const sticky = await fetchNodeMavenPool({ username: 'nm', password: 'p', country: 'US', state: 'New York', city: 'New York', count: '2', life: '60' });
  assert.match(sticky[0].username, /^nm-country-us-region-new_york-city-new_york-type-residential-sid-[0-9a-f]{12}-ttl-1h-filter-medium-ipv4-true$/);
  assert.equal(U.nodeMavenUsername('nm', { country: 'US' }), 'nm-country-us', 'the helper adds them only when asked');
});

test('NodeMaven: the City placeholder is one NodeMaven matches; no hint says only Oxylabs has an IPv6 option', () => {
  assert.match(providerLine('nodemaven'), /cityPlaceholder: 'New York'/);
  assert.match(UI, /placeholder=\{provider\.geoSync\.cityPlaceholder \|\| 'NewYork'\}/);
  assert.doesNotMatch(UI, /Oxylabs is the one configured provider/);
  for (const lang of ['en', 'es']) assert.doesNotMatch(JSON.stringify(LOCALES[lang]), /Oxylabs is the one|única con selector/);
  assert.match(hint('en', 'nodemaven'), /IPv4 exits only/);
  assert.match(UI, /const GEO_HINTS = cmpSettingsCEn\.proxyProviders\.geoHints;/, 'the fallback hints are the English ones');
});

// ---- 57, 58, 59 Bright Data, Oxylabs, Decodo -----------------------------------------------------------------

function sessionGateways() {
  const probes = [];
  const fns = lift(between('// ---- Session gateways: Bright Data', '// ---- DataImpulse ----'), {
    ...U, require,
    VENDOR_GATEWAYS: { oxylabs: { host: 'pr.oxylabs.io', port: 7777, type: 'HTTP' }, smartproxy: { host: 'gate.decodo.com', port: 7000, type: 'HTTP' }, apify: { host: 'proxy.apify.com', port: 8000, type: 'HTTP' } },
    testProxyConnectivity: async (row) => { probes.push(row); return { success: true }; },
    scrubProxySecrets: (m) => String(m),
    httpRequestText: async (url) => { throw new Error(`no network in this test: ${url}`); }
  }, ['fetchBrightDataPool', 'fetchOxylabsPool', 'fetchSmartproxyPool']);
  return { ...fns, probes };
}

test('Bright Data: a US state goes out as its two-letter code', async () => {
  assert.equal(U.brightDataState('California'), 'ca');
  assert.equal(U.brightDataState('new york'), 'ny');
  assert.equal(U.brightDataState('NY'), 'ny');
  assert.equal(U.brightDataState('Bavaria'), '');
  assert.equal(U.brightDataUsername('brd-customer-c-zone-z', { country: 'US', state: 'California' }), 'brd-customer-c-zone-z-country-us-state-ca');
  const g = sessionGateways();
  const rows = await g.fetchBrightDataPool({ username: 'brd-customer-c-zone-z', password: 'p', poolType: 'sticky', country: 'US', state: 'Texas', count: '1' });
  assert.match(rows[0].username, /-country-us-state-tx-session-/);
  await assert.rejects(g.fetchBrightDataPool({ username: 'brd-customer-c-zone-z', password: 'p', poolType: 'sticky', country: 'US', state: 'Texass', count: '1' }), /two-letter code, for example NY/);
  assert.match(UI, /placeholder=\{m\.stateCode \? 'NY' : 'California'\}/);
  for (const lang of ['en', 'es']) assert.match(LOCALES[lang].proxyProviders.apiSync.geoHintCode, /NY/);
});

test('Bright Data: the BDPM-Session box that did nothing is gone', () => {
  assert.doesNotMatch(UI + IPC, /bdpm/i);
  for (const lang of ['en', 'es']) {
    assert.equal(LOCALES[lang].proxyProviders.rotating.bdpmLabel, undefined);
    assert.equal(LOCALES[lang].proxyProviders.rotating.bdpmDesc, undefined);
  }
});

test('Sync via API uses Host : Port for Bright Data, Oxylabs and Decodo', async () => {
  const api = UI.slice(UI.indexOf('async function handleApiSync'), UI.indexOf('async function handleGeoSync'));
  assert.match(api, /host: form\.host\.trim\(\),\s*port: form\.port,/);
  const g = sessionGateways();
  const bd = await g.fetchBrightDataPool({ username: 'brd-customer-c-zone-z', password: 'p', poolType: 'rotating', host: 'brd.example.net', port: '44446' });
  assert.deepEqual([bd[0].host, bd[0].port], ['brd.example.net', 44446]);
  const ox = await g.fetchOxylabsPool({ username: 'u', password: 'p', poolType: 'sticky', count: '2', host: 'pr2.example.net', port: '8000' });
  assert.deepEqual([ox[1].host, ox[1].port], ['pr2.example.net', 8000]);
  assert.equal(g.probes[g.probes.length - 1].host, 'pr2.example.net', 'the live check runs against that gateway');
  const dc = await g.fetchSmartproxyPool({ username: 'u', password: 'p', poolType: 'rotating', host: '', port: '' });
  assert.deepEqual([dc[0].host, dc[0].port], ['gate.decodo.com', 7000], 'blank keeps the documented gateway');
  await assert.rejects(g.fetchOxylabsPool({ username: 'u', password: 'p', poolType: 'sticky', host: 'http://pr.oxylabs.io' }), /hostname like pr\.oxylabs\.io/);
});

test('Bright Data opens on Sticky sessions, which need no API token', () => {
  assert.match(UI, /return provider && provider\.apiMint && provider\.apiMint\.zone \? \['sticky', 'rotating', 'zone'\] : \['sticky', 'rotating'\];/);
  assert.match(UI, /return modes\.includes\(poolType\) \? poolType : 'sticky';/);
});

// ---- 60 ShopSocks5 ----------------------------------------------------------------------------------------------

test('ShopSocks5: no made-up gateway, and Proxy type only where the API reads it', async () => {
  assert.match(providerLine('shopsocks5'), /gateway: null/);
  assert.doesNotMatch(UI + IPC, /gate\.shopsocks5\.com/);
  assert.match(UI, /\{form\.plan === 'premium' && \(/);
  const list = [{ sock_ip: '198.51.100.7:7000', user_name: 'u', password: 'p', country_code: 'US' }];
  const run = async (plan) => {
    const t = transport({ 'https://shopsocks5.com/socks/': JSON.stringify({ success: true, response: list }) });
    const { fetchShopSocks5Pool } = lift(between('// ---- Session gateways: Bright Data', '// ---- DataImpulse ----'), {
      ...U, require, VENDOR_GATEWAYS: {}, testProxyConnectivity: async () => ({ success: true }), scrubProxySecrets: (m) => m, httpRequestText: t.httpRequestText
    }, ['fetchShopSocks5Pool']);
    const rows = await fetchShopSocks5Pool({ token: 't', username: 'me', plan, proxyType: 'proxy_https', count: '1' });
    return { rows, form: new URLSearchParams(t.calls[0].options.body) };
  };
  const premium = await run('premium');
  assert.deepEqual([premium.form.get('proxy_type'), premium.rows[0].type], ['proxy_https', 'HTTP']);
  const all = await run('all');
  assert.deepEqual([all.form.has('proxy_type'), all.rows[0].type], [false, 'SOCKS5'], 'a hidden Proxy type does not change other plans');
});

// ---- 61 Proxy302 -------------------------------------------------------------------------------------------------

test('Proxy302: Premium can rotate, State and City are Premium only, and the times are Standard\'s four', async () => {
  const q = (o) => Object.fromEntries(new URLSearchParams(U.proxy302PurchaseQuery(o)));
  assert.equal(q({ line: 'premium', lifeMin: 'rotating' }).session_mode, 'rotating');
  assert.equal(q({ line: 'premium', lifeMin: '30' }).session_mode, undefined, 'Premium keeps its fixed time');
  assert.equal(q({ line: 'standard', lifeMin: 'rotating' }).session_mode, 'rotating');
  const line = providerLine('proxy302');
  assert.match(line, /gateway: null/);
  assert.match(line, /geo: true, geoPools: \['premium'\]/);
  assert.match(line, /lifeOptions: \[10, 30, 60, 120\]/);
  assert.match(UI, /const premium302 = provider\.key === 'proxy302' && form\.poolType !== 'standard';/);
  assert.match(UI, /\? \['rotating'\]/);
  for (const lang of ['en', 'es']) assert.match(LOCALES[lang].proxyProviders.geo.lifeVendorFixed, /\{\{provider\}\}/);
  const { geoForPool } = await pull();
  assert.equal(geoForPool({ geo: true, geoPools: ['premium'] }, 'standard'), false);
  assert.equal(geoForPool({ geo: true, geoPools: ['premium'] }, 'premium'), true);
  assert.equal(geoForPool({ geo: true }, 'anything'), true);
  // The hint names the API host, not the proxy host.
  assert.match(hint('en', 'proxy302'), /Open API \(proxy302\.com\)/);
  assert.doesNotMatch(hint('en', 'proxy302') + hint('es', 'proxy302'), /proxy\.proxy302\.com/);
});

test('Proxy302: a refused Premium rotating purchase says which choice to change', async () => {
  const t = transport({
    'https://proxy302.com/open_api/v3/user/users/token': JSON.stringify({ code: 0, data: { token: 'Basic x' } }),
    'https://proxy302.com/open_api/v3/proxy/api/proxy/dynamic/traffic': JSON.stringify({ code: 40001, msg: 'rotating needs s=3 or 4' })
  });
  const { fetchProxy302Pool } = lift(`${CORE}\n${between('// ---- Proxy302 (dynamic residential', '// ---- Databay (residential')}`, { ...U, httpRequestText: t.httpRequestText }, ['fetchProxy302Pool']);
  await assert.rejects(fetchProxy302Pool({ username: 'kid', password: 'ksecret', poolType: 'premium', life: 'rotating', count: '1' }),
    (e) => /refused a rotating proxy on the Premium line/.test(e.message) && /rotating needs s=3 or 4/.test(e.message) && !/ksecret/.test(e.message));
  const purchase = new URL(t.calls[1].url);
  assert.deepEqual([purchase.searchParams.get('s'), purchase.searchParams.get('session_mode')], ['1', 'rotating']);
});

// ---- 62 IPFoxy, 64 IP Burger, 65 Decodo, 66 MangoProxy -------------------------------------------------------------

test('IPFoxy offers 30 and 60 minutes only', async () => {
  const { lifeOptionsFor } = await pull();
  assert.deepEqual(lifeOptionsFor({ lifeOptions: [30, 60] }, ''), [30, 60]);
  assert.match(providerLine('ipfoxy'), /lifeOptions: \[30, 60\]/);
});

test('IP Burger hint names no host that does not resolve', () => {
  for (const text of [hint('en', 'ipburger'), hint('es', 'ipburger'), UI]) assert.doesNotMatch(text, /res\.ipb\.cloud/);
  assert.match(hint('en', 'ipburger'), /How many above 1, a session name or a Keep same IP time mints sticky IPs/);
});

test('Decodo is called Decodo, and a search for either name finds it; the key stays smartproxy', () => {
  assert.match(providerLine('smartproxy'), /key: 'smartproxy', name: 'Decodo \(Smartproxy\)'/);
  assert.match(IPC, /smartproxy: 'Decodo'/);
  const name = /name: '([^']+)'/.exec(providerLine('smartproxy'))[1];
  const matches = (q) => name.toLowerCase().includes(q) || 'smartproxy'.includes(q);
  assert.equal(matches('decodo'), true);
  assert.equal(matches('smartproxy'), true);
  assert.match(PAGE, /r\.p\.name\.toLowerCase\(\)\.includes\(q\) \|\| r\.p\.key\.includes\(q\)/);
  // eslint-disable-next-line no-new-func
  const deriveProvider = new Function(`${fnSrc('deriveProvider')}\nreturn deriveProvider;`)();
  assert.equal(deriveProvider({ name: 'Decodo • US • sticky abc' }), 'smartproxy');
  assert.equal(deriveProvider({ name: 'Smartproxy • US' }), 'smartproxy');
  assert.match(fnSrc('fetchSmartproxyPool'), /'Decodo: a proxy username is required to sync\.'/);
});

test('MangoProxy: State, City and ASN only for the pools that take them', async () => {
  assert.match(providerLine('mangoproxy'), /geo: true, asn: true, geoPools: \['residential', 'isp'\]/);
  assert.match(UI, /\{\(geoOn \|\| provider\.geoSync\.usState\) && \(/);
  assert.match(UI, /\{provider\.geoSync\.asn && geoOn && \(/);
  const geo = UI.slice(UI.indexOf('async function handleGeoSync'), UI.indexOf('async function handleLookup'));
  assert.match(geo, /state: placeOn \? form\.state\.trim\(\) : ''/);
  assert.match(geo, /asn: placeOn \? form\.asn\.trim\(\) : ''/);
  const t = transport({ 'https://backend.mangoproxy.com/public-api/v1/': () => '[]' });
  const { fetchMangoProxyPool } = lift(`${CORE}\n${between('const MANGOPROXY_API = ', '// Countries the chosen pool can target')}`, { ...U, httpRequestText: t.httpRequestText }, ['fetchMangoProxyPool']);
  for (const poolType of ['residential_light', 'datacenter']) {
    await assert.rejects(fetchMangoProxyPool({ token: 'mk', username: 'sub', poolType, country: 'US', state: 'Texas' }), /targets a country only/);
    await assert.rejects(fetchMangoProxyPool({ token: 'mk', username: 'sub', poolType, country: 'US', asn: '7922' }), /targets a country only/);
  }
  assert.equal(t.calls.length, 0, 'refused before any API call');
});

// ---- Every string this lane touched -------------------------------------------------------------------------------

test('every hint and string this lane changed exists in English and Spanish, without dashes', () => {
  const keys = ['apify', 'shopsocks5', 'anyip', 'proxyseller', 'novada', 'froxy', 'nodemaven', 'marsproxies', 'proxidize', 'liveproxies', 'ipfoxy', 'mangoproxy', 'ipburger', 'proxy302'];
  for (const lang of ['en', 'es']) {
    for (const k of keys) {
      assert.equal(typeof hint(lang, k), 'string', `${lang} ${k}`);
      assert.doesNotMatch(hint(lang, k), /[–—]/, `${lang} ${k}`);
      assert.doesNotMatch(hint(lang, k), /Softglaze/);
    }
    const g = LOCALES[lang].proxyProviders.geo;
    for (const k of ['perProxyUsernameLabel', 'lifeVendorFixed', 'stickySessionDigitsPlaceholder', 'sessionDigitsError']) {
      assert.equal(typeof g[k], 'string', `${lang} ${k}`);
      assert.doesNotMatch(g[k], /[–—]/);
    }
    assert.doesNotMatch(LOCALES[lang].proxyProviders.apiSync.geoHintCode, /[–—]/);
    for (const k of ['hostLabel', 'psHostEurope', 'psHostUs', 'psHostAsia', 'hostHint']) assert.doesNotMatch(LOCALES[lang].proxyProviders.ps[k], /[–—]/);
  }
  assert.deepEqual(Object.keys(LOCALES.en.proxyProviders.geoHints).sort(), Object.keys(LOCALES.es.proxyProviders.geoHints).sort());
});
