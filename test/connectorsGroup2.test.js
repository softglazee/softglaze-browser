'use strict';
// Pull caps, paging and targeting for MarsProxies, NodeMaven, Froxy, Proxidize, Live Proxies,
// PacketStream, Airproxy, CatProxies and RapidProxy, checked against each vendor's docs (3 Nov 2026):
//  - docs.marsproxies.com (generate-proxy-list: proxy_count has no documented maximum)
//  - docs.nodemaven.com/residential-mobile/proxy-string (sticky ttl 60 s to 24 h)
//  - help.froxy.com (ports 9000-9999 by package size; forced rotation 90-3600 s per port)
//  - help.proxidize.com (Per GB username format; GET /perproxy/proxies/{username} is paged)
//  - packetstream.io/docs (sticky label holds while used at least every 60 minutes)
//  - catproxies.com/docs/api (resi lifetime 1-1440 min; mobile ttl 1m..240m only; mobile -region-)
//  - rapidproxy.io (sticky 1-180 minutes)
// ipcHandlers.js pulls in electron, so the adapter sections are lifted out and run with a stubbed
// transport, like proxySellerV2.test.js. Nothing here touches the network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

const between = (from, to) => {
  const a = IPC.indexOf(from);
  const b = IPC.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `section ${from} .. ${to} must exist`);
  return IPC.slice(a, b);
};
const CORE = between('function normCountryCode(', '// ---- Apify Residential');
const SECTIONS = [
  between('const MARS_API = ', '// ---- NodeMaven'),
  between('const NODEMAVEN_GATEWAY = ', '// ---- NOVADA'),
  between('const PROXIDIZE_API = ', 'const VENDOR_LOOKUPS = ')
].join('\n');
const EXPORTS = ['MINTED_PULL_MAX', 'mintGatewayRows', 'fetchMarsProxiesPool', 'fetchNodeMavenPool', 'fetchFroxyPool',
  'fetchPacketStreamPool', 'fetchAirproxyPool', 'fetchCatProxiesPool', 'fetchRapidProxyPool', 'fetchProxidizePool', 'fetchLiveProxiesPool'];

// route(url, options) returns the response text, or throws.
function load(route = () => { throw new Error('no network in this test'); }) {
  const calls = [];
  const httpRequestText = async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined });
    return route(url, options);
  };
  const scoped = { ...U, httpRequestText, crypto: nodeCrypto };
  const names = Object.keys(scoped);
  // eslint-disable-next-line no-new-func
  const api = new Function(...names, `${CORE}\n${SECTIONS}\nreturn { ${EXPORTS.join(', ')} };`)(...names.map((n) => scoped[n]));
  return { ...api, calls };
}

test('MINTED_PULL_MAX is 1000 and the shared minter uses it unless a vendor documents less', () => {
  const a = load();
  assert.equal(a.MINTED_PULL_MAX, 1000);
  const rows = a.mintGatewayRows({ type: 'HTTP', host: 'h', port: 1, password: 'p', session: 's', count: 500, buildUser: (sid) => `u-${sid}`, label: 'X' });
  assert.equal(rows.length, 500, 'a vendor that passes no max gets MINTED_PULL_MAX');
  const more = a.mintGatewayRows({ type: 'HTTP', host: 'h', port: 1, password: 'p', session: 's', count: 1500, buildUser: (sid) => `u-${sid}`, label: 'X', max: a.MINTED_PULL_MAX });
  assert.equal(more.length, 1000);
});

test('gateway vendors mint up to 1000 sticky rows per pull, each distinct', async () => {
  const a = load();
  const pulls = {
    nodemaven: await a.fetchNodeMavenPool({ username: 'nmuser', password: 'pw', country: 'US', count: 1500 }),
    froxy: await a.fetchFroxyPool({ username: 'pkg', password: 'wifi;;;;', country: 'US', count: 1500 }),
    packetstream: await a.fetchPacketStreamPool({ username: 'u', password: 'k', country: 'US', count: 1500 }),
    rapidproxy: await a.fetchRapidProxyPool({ username: 'sub1', password: 'pw', country: 'US', count: 1500 }),
    liveproxies: await a.fetchLiveProxiesPool({ username: 'LV00000', password: 'pw', country: 'US', count: 1500 })
  };
  for (const [vendor, rows] of Object.entries(pulls)) {
    assert.equal(rows.length, 1000, `${vendor} pulls up to 1000`);
    const keys = new Set(rows.map((r) => `${r.host}:${r.port}:${r.username}:${r.password}`));
    assert.equal(keys.size, rows.length, `${vendor} rows are all distinct`);
  }
});

test('Froxy gives one row per port, 9000 to 9999, and no session token', async () => {
  const a = load();
  const rows = await a.fetchFroxyPool({ username: 'pkg', password: 'wifi;;;;', country: 'DE', count: 1000 });
  assert.equal(rows[0].port, 9000);
  assert.equal(rows[999].port, 9999);
  assert.ok(rows.every((r) => r.password === 'wifi;de;;;'), 'the password carries only type and geo');
  assert.doesNotMatch(IPC, /TODO: confirm the sticky-session delimiter/);
});

test('Live Proxies keeps its sticky host per index and digits-only sessions, and never repeats one', async () => {
  const a = load();
  const rows = await a.fetchLiveProxiesPool({ username: 'LV00000', password: 'pw', country: 'GB', count: 1000 });
  assert.equal(rows[0].host, 'b2b-s1.liveproxies.io');
  assert.equal(rows[16].host, 'b2b-s17.liveproxies.io');
  assert.equal(rows[17].host, 'b2b-s1.liveproxies.io');
  const sids = rows.map((r) => /^LV00000-lv_gb-(\d{1,8})$/.exec(r.username)[1]);
  assert.equal(new Set(sids).size, 1000, 'random session ids are unique within a pull');
  const typed = await a.fetchLiveProxiesPool({ username: 'LV00000', password: 'pw', country: 'US', session: '42', count: 1000 });
  assert.equal(typed[0].username, 'LV00000-lv_us-421');
  assert.equal(typed[999].username, 'LV00000-lv_us-421000');
  const one = await a.fetchLiveProxiesPool({ username: 'LV00000', password: 'pw', country: 'US', count: 1 });
  assert.deepEqual({ host: one[0].host, username: one[0].username }, { host: 'b2b.liveproxies.io', username: 'LV00000-lv_us' });
});

test('MarsProxies asks the API for up to 1000 proxies', async () => {
  const a = load((url, options) => {
    if (url.endsWith('/v1/residential/me')) return JSON.stringify({ traffic_available: 5 });
    if (url.endsWith('/generate-proxy-list')) {
      const body = JSON.parse(options.body);
      return JSON.stringify(Array.from({ length: body.proxy_count }, (_, i) => `ultra.marsproxies.com:44443:mr42a1b2:Mxa8Kz7k2_country-us_session-${String(i).padStart(8, 'a')}_lifetime-24h`));
    }
    throw new Error(`unexpected ${url}`);
  });
  const rows = await a.fetchMarsProxiesPool({ token: 't', username: 'mr42a1b2', password: 'Mxa8Kz7k2', country: 'US', count: 1500 });
  const gen = a.calls.find((c) => c.url.endsWith('/generate-proxy-list'));
  assert.equal(gen.body.proxy_count, 1000);
  assert.equal(gen.body.location, '_country-us');
  assert.equal(rows.length, 1000);
});

test('CatProxies mints up to 1000 sticky rows and snaps mobile TTLs to the allowed set', async () => {
  const order = (username) => JSON.stringify({ payload: { order: { proxy: { username, password: 'pw', bandwidth_left: 3 } } } });
  const id = '3b0a7c41-2f18-4d0a-9c33-5a1e77b2c904';
  const resi = load(() => order('ressbI9MCHlD'));
  const rows = await resi.fetchCatProxiesPool({ token: 'cp_abcdefgh12', orderId: id, poolType: 'residential', country: 'US', city: 'Los Angeles', life: '1440', count: 1500 });
  assert.equal(rows.length, 1000);
  assert.equal(rows[0].port, 10000, 'sticky rows use the sticky port range');
  assert.match(rows[0].username, /^ressbI9MCHlD-type-residential-country-us-city-losangeles-lifetime-1440-session-sg[0-9a-f]{6}1$/);
  const mob = load(() => order('m_b49fe9c4ff'));
  const m = await mob.fetchCatProxiesPool({ token: 'cp_abcdefgh12', orderId: id, poolType: 'mobile', country: 'US', state: 'California', city: 'Los Angeles', session: 'ab', life: '360', count: 2 });
  assert.equal(m[0].username, 'm_b49fe9c4ff-country-US-region-california-city-los+angeles-sid-ab1-ttl-240m');
});

test('catProxiesMobileTtl only returns TTLs the mobile gateway accepts', () => {
  assert.deepEqual([...U.CATPROXIES_MOBILE_TTLS], [1, 5, 10, 30, 60, 120, 180, 240]);
  assert.equal(U.catProxiesMobileTtl(30), 30);
  assert.equal(U.catProxiesMobileTtl(45), 30);
  assert.equal(U.catProxiesMobileTtl(360), 240);
  assert.equal(U.catProxiesMobileTtl(1440), 240);
  assert.equal(U.catProxiesMobileTtl(0), 0);
  assert.equal(U.catProxiesMobileTtl(NaN), 0);
  assert.equal(U.catProxiesMobileUsername('m', { country: 'US', region: 'New York', session: 'x', ttlMin: 2 }), 'm-country-US-region-new+york-sid-x-ttl-1m');
  assert.equal(U.catProxiesMobileUsername('m', { region: 'california' }), 'm', 'region without country is dropped');
});

test('CatProxies residential takes a city without a state and caps the lifetime at 1440', () => {
  assert.equal(U.catProxiesResiUsername('u', { country: 'US', city: 'Dallas' }), 'u-type-residential-country-us-city-dallas');
  assert.equal(U.catProxiesResiUsername('u', { city: 'Dallas' }), 'u-type-residential', 'city without country is dropped');
  assert.equal(U.catProxiesResiUsername('u', { session: 'a1', lifetimeMin: 5000 }), 'u-type-residential-lifetime-1440-session-a1');
});

// The Proxidize docs' own username examples, built from their parts.
test('proxidizePerGbUsername reproduces the documented examples', () => {
  assert.equal(U.proxidizePerGbUsername('USERID_myproject', { country: 'US' }), 'USERID_myproject-co-US');
  assert.equal(U.proxidizePerGbUsername('USERID_myproject', { session: 'job42', country: 'US', state: 'California' }), 'USERID_myproject-s-job42-co-US-st-California');
  assert.equal(U.proxidizePerGbUsername('USERID_myproject', { country: 'FR', residential: true }), 'USERID_myproject-co-FR-type-residential');
  assert.equal(U.proxidizePerGbUsername('USERID_myproject', { session: 'job42', country: 'US', state: 'Texas', residential: true }), 'USERID_myproject-s-job42-co-US-st-Texas-type-residential');
  assert.equal(U.proxidizePerGbUsername('USERID-type-residential', { residential: true }), 'USERID-type-residential', 'never doubled');
  assert.equal(U.proxidizeGeoToken({ country: 'BR', city: 'São Paulo' }), '-co-BR-ci-SaoPaulo', 'accents and spaces dropped');
  assert.equal(U.proxidizePerGbUsername('u', { session: 'a-b_c d' }), 'u-s-abcd', 'session is letters and digits only');
});

const pdzItem = (i) => ({ session_id: `s${i}`, proxy: `1.2.3.4:${20000 + i}`, username: `u${i}`, password: 'p', ip: `9.9.9.${i % 250}`, rotate_url: 'https://api.proxidize.com/api/v1/perproxy/rotate-url/x' });
const pdzPage = (page, perPage, total) => ({ perPage, page, total, data: Array.from({ length: Math.max(0, Math.min(perPage, total - (page - 1) * perPage)) }, (_, i) => pdzItem((page - 1) * perPage + i)) });

test('proxidizeNextPage follows perPage/total and stops on a short or unpaged reply', () => {
  assert.equal(U.proxidizeNextPage(pdzPage(1, 100, 250), 1), 2);
  assert.equal(U.proxidizeNextPage(pdzPage(3, 100, 250), 3), 0, 'last page');
  assert.equal(U.proxidizeNextPage(pdzPage(1, 100, 100), 1), 0, 'exactly one page');
  assert.equal(U.proxidizeNextPage({ data: [pdzItem(1)] }, 1), 0, 'no paging fields = one page');
  assert.equal(U.proxidizeNextPage([pdzItem(1)], 1), 0, 'a bare array is one page');
  assert.equal(U.proxidizeNextPage({ perPage: 100, data: [] }, 1), 0);
  assert.equal(U.proxidizeNextPage(null, 1), 0);
});

test('Proxidize Per-Proxy pulls every page, or stops once How many is reached', async () => {
  const route = (url) => {
    const m = /\/perproxy\/proxies\/acct\?page=(\d+)&page_size=100$/.exec(url);
    if (!m) throw new Error(`unexpected ${url}`);
    return JSON.stringify(pdzPage(Number(m[1]), 100, 250));
  };
  const all = load(route);
  const rows = await all.fetchProxidizePool({ token: 't', username: 'acct', count: '' });
  assert.equal(rows.length, 250);
  assert.equal(all.calls.length, 3);
  assert.equal(rows[0].rotationUrl, 'https://api.proxidize.com/api/v1/perproxy/rotate-url/x');
  const some = load(route);
  const capped = await some.fetchProxidizePool({ token: 't', username: 'acct', count: '120' });
  assert.equal(capped.length, 120);
  assert.equal(some.calls.length, 2, 'no page past the one that filled the request');
  await assert.rejects(load(route).fetchProxidizePool({ token: 't', username: 'acct', country: 'US' }), /Per-Proxy modems are fixed/);
});

test('a server that ignores the page parameter cannot loop the pull', async () => {
  let calls = 0;
  const rows = await U.collectProxidizePerProxy(async () => { calls += 1; return pdzPage(1, 100, 1000); });
  assert.equal(rows.length, 100);
  assert.equal(calls, 2, 'the second, identical page adds nothing and ends the walk');
});

test('Proxidize Per-GB builds documented usernames on pg.proxi.es', async () => {
  const route = (url) => {
    if (url.endsWith('/user-info')) return JSON.stringify({ id: 1, username: 'u', enabled: true, bytes_available: 1 });
    if (url.endsWith('/access-point')) return JSON.stringify([{ id: 1, username: 'USERID_myproject', password: 'PASSWORD', enabled: true }]);
    throw new Error(`unexpected ${url}`);
  };
  const a = load(route);
  const rows = await a.fetchProxidizePool({ token: 't', poolType: 'residential', country: 'DE', state: 'Bavaria', session: 'job', count: 1500, proxyType: 'socks5' });
  assert.equal(rows.length, 1000);
  assert.deepEqual({ host: rows[0].host, port: rows[0].port, type: rows[0].type }, { host: 'pg.proxi.es', port: 20002, type: 'SOCKS5' });
  assert.equal(rows[0].username, 'USERID_myproject-s-job0-co-DE-st-Bavaria-type-residential');
  assert.equal(rows[0].country, 'DE');
  assert.ok(a.calls.some((c) => c.url.endsWith('/pergb/residential/access-point')));
  const mobile = await load(route).fetchProxidizePool({ token: 't', poolType: 'mobile', country: 'US', count: 1 });
  assert.match(mobile[0].username, /^USERID_myproject-s-[0-9a-f]{10}-co-US$/, 'mobile has no -type- segment');
  assert.equal(mobile[0].port, 20000);
  await assert.rejects(load(route).fetchProxidizePool({ token: 't', poolType: 'mobile', country: 'DE' }), /United States only/);
  await assert.rejects(load(route).fetchProxidizePool({ token: 't', poolType: 'residential', state: 'Texas' }), /pick a country/);
});

test('Airproxy imports the dedicated proxies on the account, capped by How many', async () => {
  const list = { proxies: Array.from({ length: 3 }, (_, i) => ({ id: i + 1, ip: `s${i + 1}.airproxy.io`, port: 30500 + i, username: 'acct', password: 'p', isp: 'Wind' })), count: 3, success: true };
  const a = load(() => JSON.stringify(list));
  assert.equal((await a.fetchAirproxyPool({ token: 'key', count: '' })).length, 3, 'blank = all');
  assert.equal((await a.fetchAirproxyPool({ token: 'key', count: '2' })).length, 2);
});

test('the PacketStream picker lists exactly the countries its password can name', () => {
  const m = /const PACKETSTREAM_COUNTRY_CODES = \[([\s\S]*?)\];/.exec(UI);
  assert.ok(m, 'PACKETSTREAM_COUNTRY_CODES must exist');
  const codes = m[1].match(/'([A-Z]{2})'/g).map((s) => s.slice(1, 3));
  assert.deepEqual([...codes].sort(), Object.keys(U.PACKETSTREAM_COUNTRIES).sort());
  assert.match(UI, /key: 'packetstream'.*countries: PACKETSTREAM_COUNTRY_CODES/);
});

test('catalog flags match what the adapters read', () => {
  assert.match(UI, /key: 'proxidize'.*geo: true/, 'Proxidize Per-GB takes country, state, city and a session');
  assert.doesNotMatch(UI, /key: 'proxidize'.*noCountry: true/);
  // The provider page shows the SOCKS5 port too (socksPort, 1.0.27 backlog 12).
  assert.match(UI, /key: 'proxidize'.*gateway: \{ host: 'pg\.proxi\.es', port: 20000, type: 'HTTP', socksPort: 20002 \}/, 'the Per-GB host field starts on the documented gateway');
  assert.match(UI, /key: 'froxy'.*noSession: true/, 'Froxy sessions are ports, not a typed name');
});

test('every hint this group touched exists in English and Spanish, without dashes', () => {
  const readHints = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lang, 'cmpSettingsC.json'), 'utf8')).proxyProviders.geoHints;
  const en = readHints('en');
  const es = readHints('es');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  for (const key of ['marsproxies', 'nodemaven', 'froxy', 'proxidize', 'liveproxies', 'packetstream', 'airproxy', 'catproxies', 'rapidproxy']) {
    for (const [lang, hints] of [['en', en], ['es', es]]) {
      assert.equal(typeof hints[key], 'string', `${lang} ${key}`);
      assert.doesNotMatch(hints[key], /[–—]/, `${lang} ${key} has no em or en dash`);
    }
  }
  assert.match(en.proxidize, /pg\.proxi\.es/);
  assert.match(en.froxy, /9999/);
});
