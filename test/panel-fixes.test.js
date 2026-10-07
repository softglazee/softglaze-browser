'use strict';
// Provider-panel and pull fixes, 29 Sep 2026 (reported while entering vendor keys):
//  - Froxy/PacketStream/IPRoyal rows differ only by password -> "Unique constraint failed
//    on (type,host,port,username)". The unique index now includes the password.
//  - Live Proxies has no list URL; the connector now builds the dashboard's own lines.
//  - "How many: 5" with a blank session returned 1 row on gateway vendors.
//  - Typed keys vanished on tab/provider switch and after a failed pull.
//  - Airproxy / MobileProxy.Space / Proxy-Solutions showed a country picker they cannot use.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
const MIG = fs.readFileSync(path.join(ROOT, 'prisma', 'migrations', '20260929000000_proxy_unique_with_password', 'migration.sql'), 'utf8');

// Same intent since 7 Oct (audit L11): rows that differ only by password still coexist,
// but the password is sealed at rest, so the key uses its keyed hash (passwordHash).
const MIG_HASH = fs.readFileSync(path.join(ROOT, 'prisma', 'migrations', '20261007000000_proxy_password_hash', 'migration.sql'), 'utf8');
test('Proxy unique key covers the password via its hash (schema + migrations agree)', () => {
  assert.match(SCHEMA, /@@unique\(\[type, host, port, username, passwordHash\]\)/);
  assert.doesNotMatch(SCHEMA, /@@unique\(\[type, host, port, username, password\]\)/);
  assert.match(MIG, /DROP INDEX IF EXISTS "Proxy_type_host_port_username_key"/);
  assert.match(MIG_HASH, /DROP INDEX IF EXISTS "Proxy_type_host_port_username_password_key"/);
  assert.match(MIG_HASH, /CREATE UNIQUE INDEX IF NOT EXISTS "Proxy_type_host_port_username_passwordHash_key" ON "Proxy"\("type", "host", "port", "username", "passwordHash"\)/);
});

test('Live Proxies usernames match the dashboard generator', () => {
  assert.equal(U.liveProxiesUsername('LV58712', { country: 'US' }), 'LV58712-lv_us');
  assert.equal(U.liveProxiesUsername('LV58712', { country: 'gb', sid: '1936119' }), 'LV58712-lv_gb-1936119');
  assert.equal(U.liveProxiesUsername('LV58712-lv_us-123', { country: 'CA' }), 'LV58712-lv_ca', 'a pasted full username keeps only the account');
  assert.equal(U.liveProxiesUsername('LV58712', { country: 'US', sid: 'ab123456789' }), 'LV58712-lv_us-12345678', 'sid is digits only, max 8');
  assert.equal(U.liveProxiesUsername('LV58712', {}), '', 'a country is required');
  assert.equal(U.liveProxiesStickyHost(1), 'b2b-s1.liveproxies.io');
  assert.equal(U.liveProxiesStickyHost(10), 'b2b-s10.liveproxies.io');
  assert.equal(U.LIVEPROXIES_GATEWAY.port, 7383);
});

test('Live Proxies adapter uses gateway mode when a username is given', () => {
  assert.match(IPC, /if \(String\(username \|\| ''\)\.trim\(\)\) return mintLiveProxiesRows\(/);
  assert.match(IPC, /host: socks \? LIVEPROXIES_GATEWAY\.socksHost : liveProxiesStickyHost\(i \+ 1\)/);
  assert.match(UI, /key: 'liveproxies'.*creds: \['username', 'password'\], count: true, session: true/);
});

test('blank session + How many > 1 mints sticky sessions on the gateway vendors', () => {
  const hits = IPC.match(/const fixed = String\(session \|\| ''\)\.trim\(\) \|\| \(clampPoolCount\(count, 1, 100\) > 1 \? `sg\$\{crypto\.randomBytes\(3\)\.toString\('hex'\)\}` : ''\);/g) || [];
  assert.equal(hits.length, 4, 'PacketStream, CatProxies, kookeey (session in the password) and the shared gateway minter');
});

test('typed provider fields survive tab/provider switches and failed pulls', () => {
  assert.match(UI, /const FORM_DRAFTS = new Map\(\);/);
  assert.match(UI, /FORM_DRAFTS\.set\(provider\.key, next\)/);
  assert.match(UI, /const draft = FORM_DRAFTS\.get\(provider\.key\);/);
  const pull = UI.slice(UI.indexOf('async function handleGeoSync'), UI.indexOf('async function handleLookup'));
  assert.ok(pull.indexOf('persistCreds();') < pull.indexOf('syncVendorPool('), 'creds are saved before the pull runs');
  assert.match(IPC, /PROXY_CRED_SECRET_FIELDS = \['password', 'token', 'apiToken', 'apiUrl'\]/);
  assert.match(IPC, /PROXY_CRED_PLAIN_FIELDS = \['username', 'zone', 'plan', 'host', 'port', 'orderId'\]/);
});

test('list-only providers without a country on their rows hide the country picker', () => {
  for (const key of ['airproxy', 'mobileproxyspace']) {
    assert.match(UI, new RegExp(`key: '${key}'.*noCountry: true`), key);
  }
  assert.match(UI, /\{!provider\.geoSync\.noCountry && \(/);
});

test('every list-only provider offers How many, and Proxy-Solutions filters by country', () => {
  for (const key of ['airproxy', 'mobileproxyspace', 'proxysolutions']) {
    assert.match(UI, new RegExp(`key: '${key}'.*count: true`), key);
  }
  assert.doesNotMatch(UI, /key: 'proxysolutions'.*noCountry: true/, 'Proxy-Solutions rows carry a country');
  assert.match(UI, /provider\.geoSync\.noCountry && provider\.geoSync\.count && \(/, 'How many must render without the country row');
  for (const fn of ['fetchAirproxyPool', 'fetchMobileProxySpacePool', 'fetchProxySolutionsPool']) {
    const start = IPC.indexOf(`async function ${fn}(`);
    const body = IPC.slice(start, IPC.indexOf('\n}\n', start));
    assert.match(body, /limitListRows\(/, `${fn} must cap the import with How many`);
  }
  const ps = IPC.slice(IPC.indexOf('async function fetchProxySolutionsPool('));
  assert.match(ps.slice(0, 2500), /r\.country === cc/, 'Proxy-Solutions must filter by the chosen country');
});

test('vendors whose adapters take proxyType show the HTTP/SOCKS5 picker', () => {
  for (const key of ['packetstream', 'catproxies', 'froxy', 'nodemaven', 'liveproxies', 'marsproxies', 'proxidize']) {
    assert.match(UI, new RegExp(`key: '${key}'.*proto: true`), key);
  }
  assert.match(UI, /provider\.geoSync\.proto && \(/);
});

test('CatProxies sticky rows use the sticky port range, not the rotating one', () => {
  assert.match(IPC, /stickyHttp: 10000, stickySocks: 12000/);
  assert.match(IPC, /port: stickyPort/);
});
