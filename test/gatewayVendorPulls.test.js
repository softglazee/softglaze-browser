'use strict';
// Pull size, session and targeting rules for Bright Data, Oxylabs, Smartproxy (Decodo), Apify,
// AnyIP, ShopSocks5, DataImpulse, Proxy-Seller and IPRoyal.
//
// Username examples come from the vendors' docs: docs.brightdata.com (proxy-networks/config-options),
// developers.oxylabs.io (residential location-settings, session-control), help.decodo.com
// (residential-proxy-user-pass-requests), docs.apify.com (platform/proxy), anyip.io/docs
// (configuration, location-targeting), shopsocks5.com/document (swagger.json),
// docs.dataimpulse.com (types-of-connections), docs.proxy-seller.com (api-v2, retrieve active proxy)
// and resi-api.iproyal.com/docs (OpenAPI).
//
// The adapters live in ipcHandlers.js, which pulls in electron, so each test lifts the adapter's
// own section out of the file and runs it against a stubbed transport, with no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lang, 'cmpSettingsC.json'), 'utf8'));

function section(from, to) {
  const a = IPC.indexOf(from);
  const b = IPC.indexOf(to, a + 1);
  assert.ok(a > -1 && b > a, `section ${from} .. ${to} must exist`);
  return IPC.slice(a, b);
}

// Runs `code` with the given names in scope and returns the named functions.
function lift(code, scope, names) {
  const keys = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, `${code}\nreturn { ${names.join(', ')} };`)(...keys.map((k) => scope[k]));
}

const clampPoolCount = (value, def = 5, max = 500) => {
  const n = Number.parseInt(String(value), 10);
  return !Number.isFinite(n) || n < 1 ? def : Math.min(n, max);
};
const normCountryCode = (v) => { const s = String(v || '').trim().toUpperCase(); return /^[A-Z]{2}$/.test(s) ? s : ''; };

// ---- pure helpers ----------------------------------------------------------------------------

test('Oxylabs usernames follow the documented examples', () => {
  assert.equal(U.oxylabsBaseUser('USERNAME'), 'customer-USERNAME', 'the customer- prefix is added');
  assert.equal(U.oxylabsBaseUser('customer-USERNAME-cc-DE-sessid-abcd1234-sesstime-30'), 'customer-USERNAME', 'pasted flags are dropped');
  assert.equal(U.oxylabsBaseUser('customer-USERNAME-ipversion-6'), 'customer-USERNAME-ipversion-6', 'IPv6 survives');
  const base = 'customer-USERNAME';
  assert.equal(U.oxylabsUsername(base, { country: 'de' }), 'customer-USERNAME-cc-DE');
  assert.equal(U.oxylabsUsername(base, { country: 'US', city: 'Los Angeles' }), 'customer-USERNAME-cc-US-city-los_angeles');
  assert.equal(U.oxylabsUsername(base, { state: 'California' }), 'customer-USERNAME-st-us_california');
  assert.equal(U.oxylabsUsername(base, { country: 'DE', session: 'abcd1234', minutes: 30 }), 'customer-USERNAME-cc-DE-sessid-abcd1234-sesstime-30');
  assert.equal(U.oxylabsUsername(base, { session: 'x1', minutes: 9999 }), 'customer-USERNAME-sessid-x1-sesstime-1440', 'sesstime tops out at 1440');
  assert.equal(U.oxylabsUsername(base, { city: 'Paris' }), 'customer-USERNAME', 'a city needs cc');
});

test('Decodo (Smartproxy) usernames follow the documented examples', () => {
  assert.equal(U.decodoBaseUser('username'), 'user-username');
  assert.equal(U.decodoBaseUser('user-username-country-us-session-old-sessionduration-10'), 'user-username');
  const base = 'user-username';
  assert.equal(U.decodoUsername(base, { country: 'US' }), 'user-username-country-us');
  assert.equal(U.decodoUsername(base, { country: 'us', city: 'New York' }), 'user-username-country-us-city-new_york');
  assert.equal(U.decodoUsername(base, { country: 'US', city: 'chicago', session: 'example1', minutes: 90 }),
    'user-username-country-us-city-chicago-session-example1-sessionduration-90');
  assert.equal(U.decodoUsername(base, { country: 'US', state: 'new york' }), 'user-username-country-us-state-us_new_york');
  assert.equal(U.decodoUsername(base, { country: 'DE', state: 'Bavaria' }), 'user-username-country-de', 'state is US only');
});

test('Bright Data usernames keep the zone login and set their own targeting', () => {
  assert.equal(U.brightDataZoneUser('myuser'), null);
  const z = U.brightDataZoneUser('brd-customer-hl_12ab-zone-res1-country-de-session-old-os-windows');
  assert.deepEqual(z, { base: 'brd-customer-hl_12ab-zone-res1-os-windows', zone: 'res1' });
  assert.equal(U.brightDataUsername(z.base, { country: 'US', state: 'NY' }), 'brd-customer-hl_12ab-zone-res1-os-windows-country-us-state-ny');
  assert.equal(U.brightDataUsername('brd-customer-c-zone-z', { country: 'us', city: 'San Francisco', session: 'mystring12345' }),
    'brd-customer-c-zone-z-country-us-city-sanfrancisco-session-mystring12345');
  assert.equal(U.brightDataUsername('brd-customer-c-zone-z', { state: 'ny' }), 'brd-customer-c-zone-z', 'state needs the US country');
});

test('Bright Data route_ips reads both the plain list and the list_countries JSON', () => {
  assert.deepEqual(U.brightDataRouteIps('1.1.1.1\n2.2.2.2\r\n1.1.1.1\nnot-an-ip\n'), [{ ip: '1.1.1.1', country: null }, { ip: '2.2.2.2', country: null }]);
  assert.deepEqual(U.brightDataRouteIps('[{"ip":"3.3.3.3","country":"us"},{"ip":"bad"}]'), [{ ip: '3.3.3.3', country: 'US' }]);
  // The docs example, trailing comma included.
  assert.deepEqual(U.brightDataRouteIps('[\n  {"ip": "1.1.1.1", "country": "us"},\n  {"ip": "1.1.2.2", "country": "hk"},\n]'),
    [{ ip: '1.1.1.1', country: 'US' }, { ip: '1.1.2.2', country: 'HK' }]);
  assert.deepEqual(U.brightDataRouteIps('1.1.1.1\n\n1.1.2.2\n\n10.0.0.0'), [{ ip: '1.1.1.1', country: null }, { ip: '1.1.2.2', country: null }, { ip: '10.0.0.0', country: null }]);
  assert.deepEqual(U.brightDataRouteIps(''), []);
});

test('Apify usernames use country-XX and country-US_CA, with a clean session name', () => {
  assert.equal(U.apifyUsername({ country: 'jp' }), 'groups-RESIDENTIAL,country-JP');
  assert.equal(U.apifyUsername({ country: 'US', state: 'ca' }), 'groups-RESIDENTIAL,country-US_CA');
  assert.equal(U.apifyUsername({ country: 'DE', state: 'by' }), 'groups-RESIDENTIAL,country-DE', 'a state is US only');
  const long = U.apifyUsername({ session: `a/b c~d.e_${'x'.repeat(80)}` });
  assert.match(long, /^groups-RESIDENTIAL,session-abc~d\.e_x+$/);
  assert.equal(long.length, 'groups-RESIDENTIAL,session-'.length + 50, 'session names stop at 50 characters');
});

test('AnyIP place names match the values its location API returns', () => {
  // dashboard.anyip.io/api/data/region/US lists {"name":"District of Columbia","value":"districtofcolumbia"}.
  assert.equal(U.anyIpPlace('District of Columbia'), 'districtofcolumbia');
  assert.equal(U.anyIpPlace('New York'), 'newyork');
  assert.equal(U.anyIpPlace('Texas'), 'texas');
  assert.equal(U.placeToken('São Paulo'), 'sao_paulo');
});

test('ShopSocks5 uses the documented all_plan route and keeps the older plan routes', () => {
  const all = U.shopSocks5Request({ user: 'me', token: 't', qty: 1000, country: 'us', state: 'California', sockType: 'cellular' });
  assert.equal(all.path, '/socks/all_plan');
  assert.deepEqual(Object.fromEntries(all.form), { user_name: 'me', api_token: 't', qty: '1000', country: 'US', state: 'California', sock_type: 'cellular' });
  assert.equal(U.shopSocks5Request({ plan: 'all', sockType: 'any' }).form.has('sock_type'), false, 'Any type sends no filter');
  const premium = U.shopSocks5Request({ plan: 'premium', qty: 5, proxyType: 'proxy_https' });
  assert.equal(premium.path, '/socks/premium');
  assert.equal(premium.form.get('proxy_type'), 'proxy_https');
  assert.equal(U.shopSocks5Request({ plan: 'daily', qty: 5 }).form.get('sock_type'), 'residential');
  assert.equal(U.shopSocks5Request({ plan: 'nonsense', qty: 5 }).path, '/socks/all_plan');
});

test('IPRoyal reads its proxy_count maximum from the validation message', () => {
  assert.equal(U.ipRoyalMaxCount('IPRoyal proxy list: The proxy count field must not be greater than 100.'), 100);
  assert.equal(U.ipRoyalMaxCount('IPRoyal proxy list: The location is invalid.'), null);
  assert.equal(U.ipRoyalMaxCount(''), null);
});

test('Proxy-Seller page info reads the documented paging fields', () => {
  assert.deepEqual(U.proxySellerPageInfo({ items: [], page: 1, per_page: 100, total: 342, total_pages: 4 }), { items: [], page: 1, perPage: 100, totalPages: 4 });
  assert.deepEqual(U.proxySellerPageInfo({ items: [{ id: 1 }] }), { items: [{ id: 1 }], page: null, perPage: null, totalPages: null });
  assert.equal(U.PROXY_SELLER_PAGE_SIZE, 100);
});

// ---- session gateways (lifted from ipcHandlers.js) ---------------------------------------------

const GATEWAYS = lift(/const VENDOR_GATEWAYS = Object\.freeze\(\{[\s\S]*?\n\}\);/.exec(IPC)[0], {}, ['VENDOR_GATEWAYS']).VENDOR_GATEWAYS;
const GATEWAY_SECTION = section('// ---- Session gateways: Bright Data', '// ---- DataImpulse ----');

// settings is the Setting table the AnyIP provisioning store reads and writes (one per test run).
function gateways({ probe = { success: true, ip: '203.0.113.5' }, routes = {}, settings = {} } = {}) {
  const probes = [];
  const calls = [];
  const fns = lift(GATEWAY_SECTION, {
    ...U,
    require,
    VENDOR_GATEWAYS: GATEWAYS,
    testProxyConnectivity: async (row) => { probes.push(row); return probe; },
    scrubProxySecrets: (m) => String(m),
    getPrisma: () => ({}),
    proxySecrets: { hashPassword: async (_db, plain) => `h:${require('node:crypto').createHash('sha256').update(String(plain)).digest('hex')}` },
    secretStore: { seal: (v) => `sealed:${v}`, open: (v) => String(v).replace(/^sealed:/, '') },
    readSetting: async (key, fallback) => (Object.prototype.hasOwnProperty.call(settings, key) ? JSON.parse(JSON.stringify(settings[key])) : fallback),
    writeSetting: async (key, value) => { settings[key] = JSON.parse(JSON.stringify(value)); },
    httpRequestText: async (url, options = {}) => {
      calls.push({ url, options });
      const key = Object.keys(routes).find((r) => url.startsWith(r));
      if (!key) throw new Error(`unexpected call ${url}`);
      const answer = routes[key];
      if (answer instanceof Error) throw answer;
      return typeof answer === 'function' ? answer(url, options) : answer;
    }
  }, ['fetchBrightDataPool', 'fetchOxylabsPool', 'fetchSmartproxyPool', 'fetchApifyPool', 'fetchAnyIpPool', 'fetchShopSocks5Pool', 'MINTED_PULL_MAX']);
  return { ...fns, probes, calls };
}

test('the shared pull cap is 1000', () => {
  assert.equal(gateways().MINTED_PULL_MAX, 1000);
});

test('Oxylabs mints one sticky session per row on pr.oxylabs.io:7777 and checks the first', async () => {
  const g = gateways();
  const rows = await g.fetchOxylabsPool({ username: 'u1', password: 'pw', poolType: 'sticky', country: 'us', city: 'Los Angeles', count: 3, life: '30', proxyType: 'socks5' });
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.deepEqual([r.type, r.host, r.port, r.password, r.country], ['SOCKS5', 'pr.oxylabs.io', 7777, 'pw', 'US']);
    assert.match(r.username, /^customer-u1-cc-US-city-los_angeles-sessid-[a-z0-9]{10}-sesstime-30$/);
  }
  assert.equal(new Set(rows.map((r) => r.username)).size, 3, 'each row has its own session');
  assert.equal(g.probes.length, 1, 'only the first row is checked live');
  assert.equal(g.probes[0], rows[0]);
});

test('Oxylabs rotating is one endpoint, and IPv6 still rides in the username', async () => {
  const rows = await gateways().fetchOxylabsPool({ username: 'u1', password: 'pw', poolType: 'rotating', country: 'DE', count: 50, ipVersion: '6' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, 'customer-u1-ipversion-6-cc-DE');
  assert.equal(rows[0].type, 'HTTP');
});

test('a sticky pull goes past 100 and stops at the shared cap', async () => {
  const g = gateways();
  assert.equal((await g.fetchOxylabsPool({ username: 'u', password: 'p', poolType: 'sticky', count: '750' })).length, 750);
  assert.equal((await g.fetchOxylabsPool({ username: 'u', password: 'p', poolType: 'sticky', count: '9999' })).length, 1000);
  assert.equal((await g.fetchSmartproxyPool({ username: 'u', password: 'p', poolType: 'sticky', count: '9999' })).length, 1000);
  assert.equal((await g.fetchApifyPool({ password: 'p', count: '9999' })).length, 1000);
  assert.equal((await g.fetchAnyIpPool({ username: 'user_1', password: 'p', count: '9999' })).length, 1000);
  assert.equal((await g.fetchBrightDataPool({ username: 'brd-customer-c-zone-z', password: 'p', poolType: 'sticky', count: '9999' })).length, 1000);
});

test('a failed live check fails the pull instead of storing dead rows', async () => {
  const g = gateways({ probe: { success: false, error: 'HTTP 407' } });
  await assert.rejects(g.fetchOxylabsPool({ username: 'u', password: 'bad', poolType: 'sticky', count: 5 }), /Oxylabs credential check failed: HTTP 407/);
});

test('Smartproxy mints on gate.decodo.com:7000 with the user- prefix', async () => {
  const rows = await gateways().fetchSmartproxyPool({ username: 'name', password: 'pw', poolType: 'sticky', country: 'US', state: 'California', count: 2, life: '1440' });
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].host, rows[0].port, rows[0].type], ['gate.decodo.com', 7000, 'HTTP']);
  assert.match(rows[0].username, /^user-name-country-us-state-us_california-session-[a-z0-9]{10}-sessionduration-1440$/);
});

test('state and city targeting refuse what the vendor docs do not allow', async () => {
  const g = gateways();
  await assert.rejects(g.fetchSmartproxyPool({ username: 'n', password: 'p', poolType: 'sticky', state: 'Texas' }), /US states only/);
  await assert.rejects(g.fetchOxylabsPool({ username: 'n', password: 'p', poolType: 'sticky', city: 'Paris' }), /pick a country to target a city/);
  await assert.rejects(g.fetchBrightDataPool({ username: 'brd-customer-c-zone-z', password: 'p', poolType: 'sticky', country: 'DE', state: 'Bavaria' }), /US states only/);
  const ox = await g.fetchOxylabsPool({ username: 'n', password: 'p', poolType: 'rotating', state: 'Texas' });
  assert.equal(ox[0].username, 'customer-n-st-us_texas', 'Oxylabs takes st on its own');
  assert.equal(ox[0].country, 'US');
});

test('Bright Data sticky sessions need no API token and use port 44445', async () => {
  const g = gateways();
  const rows = await g.fetchBrightDataPool({ username: 'brd-customer-c1-zone-res', password: 'pw', poolType: 'sticky', country: 'us', city: 'New York', count: 2 });
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].host, rows[0].port], ['brd.superproxy.io', 44445]);
  assert.match(rows[0].username, /^brd-customer-c1-zone-res-country-us-city-newyork-session-[a-z0-9]{10}$/);
  assert.equal(g.calls.length, 0, 'no API call for minted sessions');
  await assert.rejects(g.fetchBrightDataPool({ username: 'nope', password: 'pw', poolType: 'sticky' }), /brd-customer-<id>-zone-<name>/);
});

test('Bright Data zone IPs come from route_ips with countries, uncapped below 5000', async () => {
  const ips = Array.from({ length: 300 }, (_, i) => ({ ip: `10.0.${Math.floor(i / 250)}.${i % 250}`, country: 'us' }));
  const g = gateways({ routes: { 'https://api.brightdata.com/zone/route_ips': JSON.stringify(ips) } });
  const rows = await g.fetchBrightDataPool({ token: 'tok', username: 'brd-customer-c1-zone-isp1-country-de', password: 'pw', country: 'US' });
  assert.equal(rows.length, 300, 'the old 200 cap is gone');
  const url = new URL(g.calls[0].url);
  assert.equal(url.searchParams.get('zone'), 'isp1');
  assert.equal(url.searchParams.get('list_countries'), 'true');
  assert.equal(url.searchParams.get('country'), 'us');
  assert.equal(g.calls[0].options.headers.Authorization, 'Bearer tok');
  assert.equal(rows[0].username, 'brd-customer-c1-zone-isp1-ip-10.0.0.0', 'the pasted country flag is dropped before pinning');
  assert.equal(rows[0].country, 'US');
});

test('a residential Bright Data zone with no IPs points to sticky sessions', async () => {
  const g = gateways({ routes: { 'https://api.brightdata.com/zone/route_ips': '' } });
  await assert.rejects(g.fetchBrightDataPool({ token: 'tok', username: 'brd-customer-c1-zone-res', password: 'pw' }), /Sticky sessions/);
});

test('Apify targets a US state by code and refuses a state name', async () => {
  const g = gateways();
  const rows = await g.fetchApifyPool({ password: 'p', country: 'US', state: 'ca', count: 2 });
  assert.match(rows[0].username, /^groups-RESIDENTIAL,country-US_CA,session-[a-z0-9]{8}$/);
  await assert.rejects(g.fetchApifyPool({ password: 'p', country: 'US', state: 'California' }), /two-letter code/);
  await assert.rejects(g.fetchApifyPool({ password: 'p', country: 'DE', state: 'BY' }), /US states only/);
});

test('AnyIP adds region and city, replaces a pasted location, and speaks SOCKS5 when asked', async () => {
  const g = gateways();
  const rows = await g.fetchAnyIpPool({ username: 'user_9,country_FR,region_iledefrance,sesstime_30', password: 'p', country: 'US', state: 'New York', city: 'New York', count: 2, proxyType: 'socks5' });
  assert.equal(rows.length, 2);
  assert.match(rows[0].username, /^user_9,sesstime_30,type_residential,country_US,region_newyork,city_newyork,session_[a-z0-9]{8}$/);
  assert.equal(rows[0].type, 'SOCKS5');
  await assert.rejects(g.fetchAnyIpPool({ username: 'user_9', password: 'p', country: 'US', city: 'Dallas' }), /needs its state/);
  await assert.rejects(g.fetchAnyIpPool({ username: 'user_9', password: 'p', state: 'Texas' }), /pick a country/);
});

test('AnyIP provisioning calls dashboard.anyip.io and falls back to the older route', async () => {
  const notFound = Object.assign(new Error('HTTP 404 No route found'), { status: 404 });
  const g = gateways({
    routes: {
      'https://dashboard.anyip.io/api/v1/teams/': notFound,
      'https://dashboard.anyip.io/api/teams/': JSON.stringify({ id: 'a1', username: 'user_srv1' })
    }
  });
  const rows = await g.fetchAnyIpPool({ token: 'key1', teamId: 'team 7', count: 1 });
  assert.deepEqual(g.calls.map((c) => c.url), [
    'https://dashboard.anyip.io/api/v1/teams/team%207/proxy_accounts',
    'https://dashboard.anyip.io/api/teams/team%207/proxy_accounts'
  ]);
  assert.equal(g.calls[0].options.headers['Api-Key'], 'key1');
  const body = JSON.parse(g.calls[0].options.body);
  assert.match(body.password, /^[a-zA-Z0-9_]{6,}$/, 'the documented password rule');
  assert.equal(rows[0].username, 'user_srv1,type_residential', 'one row, no session name, Keep same IP blank: the rotating login');
  assert.equal(rows[0].password, body.password);
  assert.doesNotMatch(IPC, /api\.anyip\.io/, 'api.anyip.io no longer resolves');
});

test('ShopSocks5 posts to all_plan and asks for more than 100', async () => {
  const list = Array.from({ length: 250 }, (_, i) => ({ sock_ip: `198.51.100.${i % 250}:${7000 + i}`, user_name: 'u', password: 'p', proxy_type: 'SOCKS5 Proxy', country_code: 'US' }));
  const g = gateways({ routes: { 'https://shopsocks5.com/socks/': JSON.stringify({ success: true, response: list }) } });
  const rows = await g.fetchShopSocks5Pool({ token: 't', username: 'me', count: '250', country: 'US', poolType: 'residential' });
  assert.equal(g.calls[0].url, 'https://shopsocks5.com/socks/all_plan');
  const form = new URLSearchParams(g.calls[0].options.body);
  assert.equal(form.get('qty'), '250');
  assert.equal(form.get('sock_type'), 'residential');
  assert.equal(rows.length, 250, 'the old 200 slice is gone');
  assert.equal(rows[0].type, 'SOCKS5');
  const g2 = gateways({ routes: { 'https://shopsocks5.com/socks/': JSON.stringify({ success: true, response: [] }) } });
  await assert.rejects(g2.fetchShopSocks5Pool({ token: 't', username: 'me', count: '99999' }), /no usable proxies/);
  assert.equal(new URLSearchParams(g2.calls[0].options.body).get('qty'), '1000');
});

// ---- DataImpulse -----------------------------------------------------------------------------

function dataImpulse(listFor) {
  const calls = [];
  const fns = lift(section('// ---- DataImpulse ----', '// ---- Proxy-Seller ----'), {
    ...U,
    normCountryCode,
    clampPoolCount,
    MINTED_PULL_MAX: 1000,
    scrubProxySecrets: (m) => String(m),
    httpRequestText: async (url) => {
      calls.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith('/stats')) return JSON.stringify({ status: 'ok', traffic_left: 1e9 });
      if (u.pathname.endsWith('/list')) return listFor(Number(u.searchParams.get('quantity')), u);
      if (u.pathname.endsWith('/pool_stats_with_parameters')) return JSON.stringify({ items: [{ key: 'us', label: 'United States', value: 9 }] });
      throw new Error(`unexpected ${url}`);
    }
  }, ['fetchDataImpulsePool', 'lookupDataImpulse']);
  return { ...fns, calls };
}
const stickyLines = (q) => Array.from({ length: q }, (_, i) => `login__cr.us:pw@gw.dataimpulse.com:${10000 + i}`).join('\n');

test('DataImpulse asks for up to 1000 sticky ports per pull', async () => {
  const d = dataImpulse(stickyLines);
  const rows = await d.fetchDataImpulsePool({ username: 'login', password: 'pw', poolType: 'sticky', count: '1500' });
  assert.equal(rows.length, 1000);
  assert.equal(new URL(d.calls[1]).searchParams.get('quantity'), '1000');
});

test('DataImpulse never asks past the last sticky port', async () => {
  const d = dataImpulse(stickyLines);
  const held = new Set(Array.from({ length: 9990 }, (_, i) => 10000 + i));
  const rows = await d.fetchDataImpulsePool({ username: 'login', password: 'pw', poolType: 'sticky', count: '50', existingPorts: async () => held });
  assert.equal(new URL(d.calls.at(-1)).searchParams.get('quantity'), '10001');
  assert.equal(rows.length, 11, 'only ports 19990 to 20000 are left');
  const full = new Set(Array.from({ length: 10001 }, (_, i) => 10000 + i));
  await assert.rejects(dataImpulse(stickyLines).fetchDataImpulsePool({ username: 'login', password: 'pw', poolType: 'sticky', count: '5', existingPorts: async () => full }), /holds them all/);
});

test('DataImpulse caps the sticky lifetime at the documented 120 minutes', async () => {
  const d = dataImpulse(stickyLines);
  await d.fetchDataImpulsePool({ username: 'login', password: 'pw', poolType: 'sticky', count: '1', life: '600' });
  assert.equal(new URL(d.calls[1]).searchParams.get('session_ttl'), '120');
});

test('the DataImpulse country list covers the whole pool even with a country picked', async () => {
  const d = dataImpulse(stickyLines);
  const out = await d.lookupDataImpulse({ username: 'login', password: 'pw', country: 'DE', groupby: 'country' });
  const url = new URL(d.calls.at(-1));
  assert.equal(url.searchParams.get('groupby'), 'country');
  assert.equal(url.searchParams.has('countries'), false);
  assert.deepEqual(out.geo, [{ key: 'us', label: 'United States', count: 9 }]);
  await d.lookupDataImpulse({ username: 'login', password: 'pw', country: 'DE', groupby: 'state' });
  assert.equal(new URL(d.calls.at(-1)).searchParams.get('countries'), 'de', 'states still narrow to the country');
});

// ---- Proxy-Seller order paging -----------------------------------------------------------------

const PS_KEY = 'testKey1234567890abc';
const PS_BASE = `https://proxy-seller.com/personal/api/v2/${PS_KEY}/`;
const psItem = (i) => ({
  id: `id${i}`, order_id: 'o1', ip: `11.0.${Math.floor(i / 250)}.${i % 250}`, ip_only: `11.0.${Math.floor(i / 250)}.${i % 250}`,
  protocol: 'HTTP', port_http: 20000 + i, port_socks: 30000 + i, login: 'l', password: 'p', status_type: 'ACTIVE', country_alpha3: 'DEU'
});
const psOk = (data) => JSON.stringify({ status: 'success', data, errors: [] });

function proxySeller(pageFor) {
  const calls = [];
  const fns = lift(section('const PS_API = ', 'const IPR_API = '), {
    ...U,
    fs: fs.promises,
    path,
    os: require('node:os'),
    normCountryCode,
    clampPoolCount,
    httpRequestText: async (url) => {
      calls.push(url);
      assert.ok(url.startsWith(`${PS_BASE}proxy/list/ipv4`), `unexpected ${url}`);
      const u = new URL(url);
      return psOk(pageFor(u.searchParams.has('page') ? Number(u.searchParams.get('page')) : 0, u));
    }
  }, ['fetchProxySellerPool']);
  return { ...fns, calls };
}
const range = (a, b) => Array.from({ length: b - a }, (_, i) => psItem(a + i));

test('Proxy-Seller follows total_pages past the first 100 addresses', async () => {
  const p = proxySeller((page) => ({ items: range((Math.max(page, 1) - 1) * 100, Math.min(Math.max(page, 1) * 100, 250)), page: Math.max(page, 1), per_page: 100, total: 250, total_pages: 3 }));
  const rows = await p.fetchProxySellerPool({ token: PS_KEY, plan: 'ipv4' });
  assert.equal(rows.length, 250);
  assert.equal(p.calls.length, 3);
  assert.equal(p.calls[0], `${PS_BASE}proxy/list/ipv4`, 'the first request is unchanged');
  assert.equal(p.calls[1], `${PS_BASE}proxy/list/ipv4?page=2&per_page=100`);
});

test('Proxy-Seller asks for page 2 when an unpaged reply is exactly one default page', async () => {
  const p = proxySeller((page) => ({ items: page === 0 ? range(0, 100) : page === 2 ? range(100, 140) : [] }));
  const rows = await p.fetchProxySellerPool({ token: PS_KEY, plan: 'ipv4', orderId: 'o1' });
  assert.equal(rows.length, 140);
  assert.equal(p.calls[1], `${PS_BASE}proxy/list/ipv4?orderId=o1&page=2&per_page=100`);
  assert.equal(p.calls.length, 2, 'a short page ends the list');
});

test('Proxy-Seller stops paging once How many is reached, or when a page repeats', async () => {
  const p = proxySeller((page) => ({ items: range((Math.max(page, 1) - 1) * 100, Math.max(page, 1) * 100), page: Math.max(page, 1), per_page: 100, total_pages: 9 }));
  const rows = await p.fetchProxySellerPool({ token: PS_KEY, plan: 'ipv4', count: '150' });
  assert.equal(rows.length, 150);
  assert.equal(p.calls.length, 2);
  const same = proxySeller(() => ({ items: range(0, 100) }));
  assert.equal((await same.fetchProxySellerPool({ token: PS_KEY, plan: 'ipv4' })).length, 100);
  assert.equal(same.calls.length, 2, 'a server that ignores paging is asked once more, then left alone');
});

test('Proxy-Seller skips pooled ports across pages', async () => {
  const p = proxySeller((page) => ({ items: range((Math.max(page, 1) - 1) * 100, Math.max(page, 1) * 100), page: Math.max(page, 1), per_page: 100, total_pages: 2 }));
  const held = new Set(Array.from({ length: 120 }, (_, i) => 20000 + i));
  const rows = await p.fetchProxySellerPool({ token: PS_KEY, plan: 'ipv4', count: '30', existingPorts: async () => held });
  assert.deepEqual(rows.map((r) => r.port), Array.from({ length: 30 }, (_, i) => 20120 + i));
});

// ---- IPRoyal batches and sub-user pages -------------------------------------------------------

function ipRoyal({ max = Infinity, subuserPages = 1 } = {}) {
  const calls = [];
  let n = 0;
  const fns = lift(section('const IPR_API = ', '// ---- MarsProxies'), {
    ...U,
    normCountryCode,
    clampPoolCount,
    MINTED_PULL_MAX: 1000,
    httpRequestText: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url, body });
      const u = new URL(url);
      if (u.pathname.endsWith('/residential/me')) return JSON.stringify({ available_traffic: 5, subusers_count: subuserPages * 2 });
      if (u.pathname.endsWith('/access/entry-nodes')) return JSON.stringify([{ dns: 'geo.iproyal.com', ports: [{ name: 'http', port: 12321 }, { name: 'socks5', port: 32325 }] }]);
      if (u.pathname.endsWith('/residential-subusers')) {
        const page = Number(u.searchParams.get('page'));
        const hash = (k) => `${String(page)}${k}`.padEnd(26, 'a');
        return JSON.stringify({ data: [{ hash: hash('x'), username: `s${page}x` }, { hash: hash('y'), username: `s${page}y` }], meta: { current_page: page, last_page: subuserPages } });
      }
      if (u.pathname.endsWith('/access/generate-proxy-list')) {
        if (body.proxy_count > max) {
          throw Object.assign(new Error(`HTTP 422 {"error":{"code":"failed_validation","message":"The proxy count field must not be greater than ${max}."}}`), { status: 422 });
        }
        return JSON.stringify(Array.from({ length: body.proxy_count }, () => { n += 1; return `geo.iproyal.com:12321:sub:pw_country-us_session-s${n}_lifetime-24h`; }));
      }
      throw new Error(`unexpected ${url}`);
    }
  }, ['fetchIpRoyalPool', 'lookupIpRoyal']);
  return { ...fns, calls };
}
const IPR_TOKEN = 'tok';
const IPR_HASH = 'abcdefghijklmnopqrstuvwxyz';

test('IPRoyal generates a large sticky pull in batches of 500', async () => {
  const r = ipRoyal();
  const rows = await r.fetchIpRoyalPool({ token: IPR_TOKEN, subuserHash: IPR_HASH, country: 'us', count: '1000', poolType: 'sticky' });
  assert.equal(rows.length, 1000);
  const gens = r.calls.filter((c) => c.url.endsWith('/access/generate-proxy-list'));
  assert.deepEqual(gens.map((c) => c.body.proxy_count), [500, 500]);
  assert.equal(new Set(rows.map((x) => x.password)).size, 1000);
});

test('IPRoyal drops to the maximum the server names', async () => {
  const r = ipRoyal({ max: 100 });
  const rows = await r.fetchIpRoyalPool({ token: IPR_TOKEN, subuserHash: IPR_HASH, count: '250', poolType: 'sticky' });
  assert.equal(rows.length, 250);
  const gens = r.calls.filter((c) => c.url.endsWith('/access/generate-proxy-list')).map((c) => c.body.proxy_count);
  assert.deepEqual(gens, [250, 100, 100, 50]);
});

test('IPRoyal rotating is still one endpoint', async () => {
  const r = ipRoyal();
  const rows = await r.fetchIpRoyalPool({ token: IPR_TOKEN, subuserHash: IPR_HASH, count: '900', poolType: 'rotating' });
  assert.equal(rows.length, 1);
});

test('IPRoyal lists every page of sub-users', async () => {
  const r = ipRoyal({ subuserPages: 3 });
  const out = await r.lookupIpRoyal({ token: IPR_TOKEN });
  assert.equal(out.subusers.length, 6);
  const pages = r.calls.filter((c) => c.url.includes('/residential-subusers')).map((c) => new URL(c.url).searchParams.get('page'));
  assert.deepEqual(pages, ['1', '2', '3']);
});

// ---- the panel -------------------------------------------------------------------------------

const providerLine = (key) => UI.split(/\r?\n/).find((l) => l.includes(`{ key: '${key}'`));

test('the catalog lines carry the documented targeting', () => {
  assert.match(providerLine('smartproxy'), /gateway: \{ host: 'gate\.decodo\.com', port: 7000/);
  assert.match(IPC, /smartproxy: \{ host: 'gate\.decodo\.com', port: 7000, type: 'HTTP' \}/);
  for (const k of ['brightdata', 'oxylabs', 'smartproxy']) assert.match(providerLine(k), /apiMint: \{/, k);
  // stateCode: Bright Data takes a US state as its two-letter code (1.0.27 backlog 57).
  assert.match(providerLine('brightdata'), /apiMint: \{ zone: true, stateCode: true \}/);
  assert.match(providerLine('apify'), /usState: true/);
  assert.match(providerLine('anyip'), /geo: true/);
  assert.match(providerLine('anyip'), /proto: true/);
  assert.match(providerLine('shopsocks5'), /\['cellular', 'Cellular'\]/);
  const anyip = /countries: \[([^\]]+)\]/.exec(providerLine('anyip'));
  const codes = anyip[1].match(/'([A-Z]{2})'/g).map((s) => s.slice(1, 3));
  assert.ok(codes.length > 100 && codes.includes('US') && codes.includes('XK'), 'the AnyIP reference list');
  assert.equal(new Set(codes).size, codes.length);
});

test('pull counts accept four digits wherever a pull can reach 1000', () => {
  // A three-digit field turns a typed 1000 into 100.
  const inputs = UI.split(/\r?\n/).filter((l) => /set\('count'/.test(l));
  for (const marker of ['geo.diCountTitle', 'ipr.countTitle', 'apiSync.countTitle', 'geo.howManyCapTitle', 'ps.portsTitle']) {
    const line = inputs.find((l) => l.includes(marker));
    assert.ok(line, marker);
    assert.match(line, /\.slice\(0, 4\)\)/, marker);
  }
});

test('the API Sync pull sends the mode, location and count', () => {
  const m = /async function handleApiSync\(\) \{[\s\S]*?\n {2}\}/.exec(UI);
  assert.ok(m);
  for (const field of ['poolType: mode', 'country: form.country', "count: mode === 'sticky' ? form.count : ''", 'life:', 'proxyType:']) {
    assert.ok(m[0].includes(field), field);
  }
  assert.match(m[0], /if \(mode === 'zone' && !form\.apiToken\.trim\(\)\)/, 'only the zone list needs the token');
});

test('the DataImpulse panel can load the live country list', () => {
  const panel = UI.slice(UI.indexOf('const renderDataImpulse = '), UI.indexOf('const renderProxySeller = '));
  assert.match(panel, /handleLookup\('country'\)[^\n]*proxyProviders\.ps\.loadCountries/);
  assert.match(panel, /countryOptions\(provider, i18n\.language, diCountries\)/);
});

test('new strings exist in English and Spanish', () => {
  const en = locale('en').proxyProviders;
  const es = locale('es').proxyProviders;
  const keys = [
    'apiSync.modeLabel', 'apiSync.modeZone', 'apiSync.modeSticky', 'apiSync.modeRotating', 'apiSync.modeZoneHelp',
    'apiSync.modeStickyHelp', 'apiSync.modeRotatingHelp', 'apiSync.countTitle', 'apiSync.lifeDefault', 'apiSync.geoHint',
    'geo.planAll', 'geo.diCountTitle', 'ipr.countTitle'
  ];
  const get = (o, k) => k.split('.').reduce((c, p) => (c == null ? c : c[p]), o);
  for (const k of keys) {
    assert.equal(typeof get(en, k), 'string', `en ${k}`);
    assert.equal(typeof get(es, k), 'string', `es ${k}`);
    assert.notEqual(get(en, k), get(es, k), `es ${k} is translated`);
  }
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  assert.deepEqual(flat(es).sort(), flat(en).sort(), 'en and es carry the same keys');
});

test('the pull and lookup handlers stay behind proxies.manage', () => {
  for (const fn of ['syncVendorPool', 'vendorLookup']) {
    const m = new RegExp(`async function ${fn}\\(payload\\) \\{\\r?\\n\\s*await requirePermission\\('proxies\\.manage'\\)`).exec(IPC);
    assert.ok(m, `${fn} must check proxies.manage first`);
  }
});
