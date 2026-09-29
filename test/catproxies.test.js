'use strict';
// CatProxies connector (Standard Residential + Rotating Mobile). Built from the live dashboard
// generator (2026-09-27): the cp_ API key + a Plan ID fetch GET /orders/:id, whose
// proxy.{username,password} feed one gateway with the targeting appended to the username.
//   Residential: resi-us.catproxies.com:9000 (HTTP) / :11000 (SOCKS5),
//                username <base>-type-residential[-country-<cc>...][-lifetime-N-session-id]
//   Mobile:      mobile-us.catproxies.com:5000 (HTTP),
//                username <base>[-country-<CC>][-sid-id[-ttl-Nm]]
//
// Exercises the real pure helpers, and asserts the adapter + registry + UI entry are wired.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('catProxiesResiUsername matches the dashboard grammar (rotating vs sticky)', () => {
  assert.equal(U.catProxiesResiUsername('ressbI9MCHlD', {}), 'ressbI9MCHlD-type-residential', 'rotating worldwide = bare base + type');
  assert.equal(U.catProxiesResiUsername('u', { country: 'US' }), 'u-type-residential-country-us', 'country is lowercased');
  assert.equal(U.catProxiesResiUsername('u', { country: 'US', state: 'California', city: 'Los Angeles' }),
    'u-type-residential-country-us-state-california-city-losangeles');
  assert.equal(U.catProxiesResiUsername('u', { state: 'Texas' }), 'u-type-residential', 'state without country dropped');
  assert.equal(U.catProxiesResiUsername('u', { country: 'US', session: 'ab12', lifetimeMin: 30 }),
    'u-type-residential-country-us-lifetime-30-session-ab12', 'sticky adds lifetime+session');
  assert.equal(U.catProxiesResiUsername('u', { session: 'ab12' }), 'u-type-residential', 'session without lifetime dropped');
});

test('catProxiesMobileUsername matches the dashboard grammar (rotating vs sticky)', () => {
  assert.equal(U.catProxiesMobileUsername('m_b49fe9c4ff', {}), 'm_b49fe9c4ff', 'rotating worldwide = bare base');
  assert.equal(U.catProxiesMobileUsername('m', { country: 'us' }), 'm-country-US', 'country is UPPER-cased');
  assert.equal(U.catProxiesMobileUsername('m', { country: 'US', session: 'ab12', ttlMin: 30 }), 'm-country-US-sid-ab12-ttl-30m');
  assert.equal(U.catProxiesMobileUsername('m', { session: 'ab12' }), 'm-sid-ab12', 'sticky without ttl = sid only');
  assert.equal(U.catProxiesMobileUsername('m', { city: 'Rome' }), 'm', 'city without country dropped');
});

test('catProxiesCreds reads the documented payload.order.proxy nesting and fallbacks', () => {
  const doc = { payload: { order: { proxy: { username: 'ressbI9MCHlD', password: '7aa28b33-uuid', bandwidth_left: 3 } } } };
  assert.deepEqual(U.catProxiesCreds(doc), { username: 'ressbI9MCHlD', password: '7aa28b33-uuid', bandwidthLeft: 3 });
  assert.deepEqual(U.catProxiesCreds({ proxy: { username: 'u', password: 'p' } }), { username: 'u', password: 'p', bandwidthLeft: null });
  assert.deepEqual(U.catProxiesCreds({}), { username: '', password: '', bandwidthLeft: null });
  assert.equal(U.catProxiesCreds({ payload: { order: { proxy: { username: 'u', password: 'p', bandwidth_left: 0 } } } }).bandwidthLeft, 0, 'zero bandwidth is preserved, not nulled');
});

// --- Wiring: adapter, registry and UI entry must all exist -----------------------------
test('fetchCatProxiesPool exists in ipcHandlers.js', () => {
  assert.ok(IPC.includes('function fetchCatProxiesPool'), 'fetchCatProxiesPool must be defined');
});

test('CatProxies is registered in PROXY_VENDORS and REAL_VENDOR_ADAPTERS', () => {
  assert.ok(/catproxies:\s*'CatProxies'/.test(IPC), 'must be in PROXY_VENDORS');
  assert.ok(/catproxies:\s*fetchCatProxiesPool/.test(IPC), 'must be in REAL_VENDOR_ADAPTERS');
});

test('the cp_ API key is sent as a Bearer header, not in the URL', () => {
  const m = /async function fetchCatProxiesPool\(([\s\S]*?)\n\}/.exec(IPC);
  assert.ok(m, 'adapter body must be found');
  assert.match(m[0], /Authorization: `Bearer \$\{key\}`/, 'key must ride in the Authorization header');
  assert.ok(!/orders\/\$\{encodeURIComponent\(id\)\}\?[^`]*key=/.test(m[0]), 'key must not be in the query string');
});

test('CatProxies has a PROVIDERS entry that asks for a token + Plan ID', () => {
  const line = UI.split(/\r?\n/).find((l) => /key:\s*'catproxies'/.test(l));
  assert.ok(line, 'catproxies must be a PROVIDERS entry');
  assert.ok(!/unavailable:\s*true/.test(line), 'must not be marked unavailable');
  assert.match(line, /creds:\s*\[\s*'token'\s*\]/, 'must ask for an API token');
  assert.match(line, /planId:\s*true/, 'must show the Plan ID field');
});

test('the generic form renders the Plan ID input and handleGeoSync forwards it', () => {
  assert.match(UI, /provider\.geoSync\.planId &&[\s\S]*?set\('orderId'/, 'Plan ID input bound to orderId');
  assert.match(UI, /\|\|\s*g\.planId\s*\?\s*form\.orderId/, 'orderId forwarded for planId vendors');
});

test('geoHints.catproxies and geo.planIdLabel exist in every cmpSettingsC locale', () => {
  const localesDir = path.join(ROOT, 'src', 'renderer', 'i18n', 'locales');
  for (const loc of fs.readdirSync(localesDir)) {
    const f = path.join(localesDir, loc, 'cmpSettingsC.json');
    if (!fs.existsSync(f)) continue;
    const json = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.ok(typeof json?.proxyProviders?.geoHints?.catproxies === 'string', `geoHints.catproxies missing in ${loc}`);
    assert.ok(typeof json?.proxyProviders?.geo?.planIdLabel === 'string', `geo.planIdLabel missing in ${loc}`);
  }
});
