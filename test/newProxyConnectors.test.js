'use strict';
// Connectors added for the newly engaged vendors: MarsProxies, NodeMaven, Froxy, Proxidize.
//
// Each was built from the vendor's LIVE API docs (fetched 2026-09-19), not from memory:
//  - MarsProxies: REST POST /v1/residential/access/generate-proxy-list (Bearer), returns a
//    JSON array of "host:port:user:pass" strings. Residential only.
//  - NodeMaven: no list endpoint; gateway gate.nodemaven.com with targeting in the username
//    ("-country-us-type-mobile-sid-..."). Reaches residential AND mobile.
//  - Froxy: SOAX reseller; gateway proxy.froxy.com:9000 with targeting in the password
//    ("wifi;us;;region;city"; wifi=residential, mobile=mobile, fast=datacenter).
//  - Proxidize: REST api.proxidize.com/api/v1 (Bearer); per-proxy GET /perproxy/proxies/{u}
//    returns ready creds; per-GB builds "USER-co-USA-st-TX-ci-Dallas-s-<session>".
//
// These tests exercise the real pure helpers, and assert the adapters + registry + UI entries
// are wired so a connector can never be half-added again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

// --- Shared host:port parser -----------------------------------------------------------
test('parseHostPort splits plain and bracketed IPv6 endpoints, rejects junk', () => {
  assert.deepEqual(U.parseHostPort('1.2.3.4:8080'), { host: '1.2.3.4', port: 8080 });
  assert.deepEqual(U.parseHostPort('[2001:db8::1]:20000'), { host: '2001:db8::1', port: 20000 });
  for (const bad of ['', 'nohost', '1.2.3.4:abc', '1.2.3.4:0', '1.2.3.4:70000']) {
    assert.equal(U.parseHostPort(bad), null, `reject ${JSON.stringify(bad)}`);
  }
});

// --- MarsProxies -----------------------------------------------------------------------
test('marsProxiesLocation builds the underscore grammar, country wins over region', () => {
  assert.equal(U.marsProxiesLocation({ country: 'US', state: 'Texas', city: 'Dallas' }), '_country-us_state-texas_city-dallas');
  assert.equal(U.marsProxiesLocation({ country: 'US' }), '_country-us');
  assert.equal(U.marsProxiesLocation({ region: 'Europe' }), '_region-europe');
  assert.equal(U.marsProxiesLocation({ state: 'Texas' }), '', 'state without country is dropped');
  assert.equal(U.marsProxiesLocation({}), '');
});

test('parseMarsProxiesList parses the JSON string array and dedupes', () => {
  const body = JSON.stringify([
    'ultra.marsproxies.com:44443:sub1:pass_country-us',
    'ultra.marsproxies.com:44443:sub1:pass_country-us',
    'ultra.marsproxies.com:44443:sub1:other_country-us'
  ]);
  const rows = U.parseMarsProxiesList(body);
  assert.equal(rows.length, 2, 'two distinct passwords, one duplicate dropped');
  assert.deepEqual({ host: rows[0].host, port: rows[0].port, username: rows[0].username },
    { host: 'ultra.marsproxies.com', port: 44443, username: 'sub1' });
  assert.deepEqual(U.parseMarsProxiesList('not json'), []);
  assert.deepEqual(U.parseMarsProxiesList('{"error":"x"}'), [], 'a non-array body yields nothing');
});

// --- NodeMaven -------------------------------------------------------------------------
test('nodeMavenUsername builds the dash grammar with the documented guards', () => {
  assert.equal(U.nodeMavenUsername('pxu', { country: 'US', type: 'mobile', sid: 'abc123' }),
    'pxu-country-us-type-mobile-sid-abc123');
  assert.equal(U.nodeMavenUsername('u', { country: 'US', region: 'Texas', city: 'Dallas' }),
    'u-country-us-region-texas-city-dallas');
  assert.equal(U.nodeMavenUsername('u', { country: 'US', city: 'Dallas' }),
    'u-country-us', 'city without region is dropped (gateway 500s otherwise)');
  assert.equal(U.nodeMavenUsername('u', { country: 'US', sid: 'x', ttl: '10m', filter: 'medium' }),
    'u-country-us-sid-x-ttl-10m-filter-medium');
  assert.equal(U.nodeMavenUsername('u', { country: 'US', ttl: '10m' }), 'u-country-us', 'ttl needs a sid');
  assert.equal(U.nodeMavenUsername('u', { country: 'US', region: 'New-York' }), 'u-country-us',
    "a value with '-' is rejected, the gateway would truncate it");
  assert.equal(U.nodeMavenUsername('', { country: 'US' }), '', 'no login, no username');
});

test('nodeMavenTtl validates the {n}s/m/h shape', () => {
  assert.equal(U.nodeMavenTtl('10m'), '10m');
  assert.equal(U.nodeMavenTtl('24h'), '24h');
  // The gateway rejects an uppercase '10M' (407), so the helper normalizes to the valid form
  // rather than passing it through.
  assert.equal(U.nodeMavenTtl('10M'), '10m', 'normalized to the valid lowercase form');
  assert.equal(U.nodeMavenTtl('nonsense'), '');
});

// --- Froxy -----------------------------------------------------------------------------
test('froxyPassword builds the SOAX-style targeting string', () => {
  assert.equal(U.froxyPassword({ poolType: 'residential', country: 'US', region: 'South Carolina', city: 'Myrtle Beach' }),
    'wifi;us;;south+carolina;myrtle+beach');
  assert.equal(U.froxyPassword({ poolType: 'mobile', country: 'US' }), 'mobile;us;;;');
  assert.equal(U.froxyPassword({}), 'wifi;;;;');
  assert.equal(U.froxyType('mobile'), 'mobile');
  assert.equal(U.froxyType('datacenter'), 'fast');
  assert.equal(U.froxyType('anything'), 'wifi');
  assert.equal(U.froxyPassword({ poolType: 'datacenter', country: 'us' }), 'fast;us;;;', 'datacenter -> fast');
  assert.equal(U.froxyPassword({ country: 'us', session: 'abc' }), 'wifi;us;;;;sessionid;abc');
});

// --- Proxidize -------------------------------------------------------------------------
test('parseProxidizePerProxy maps the per-proxy list to pool rows', () => {
  const data = { data: [
    { proxy: '1.2.3.4:20000', username: 'u1', password: 'p1', rotate_url: 'https://api.proxidize.com/x', ip: '9.9.9.9', session_id: 's1' },
    { proxy: '1.2.3.4:20000', username: 'u1', password: 'p1', session_id: 's1' },
    { proxy: 'bad', username: 'u2', password: 'p2' }
  ] };
  const rows = U.parseProxidizePerProxy(data);
  assert.equal(rows.length, 1, 'duplicate dropped, unparseable endpoint skipped');
  assert.deepEqual(
    { type: rows[0].type, host: rows[0].host, port: rows[0].port, username: rows[0].username, password: rows[0].password, rotationUrl: rows[0].rotationUrl },
    { type: 'HTTP', host: '1.2.3.4', port: 20000, username: 'u1', password: 'p1', rotationUrl: 'https://api.proxidize.com/x' });
  assert.equal(U.parseProxidizePerProxy(data, { socks: true })[0].type, 'SOCKS5');
});

test('proxidize per-GB username carries the geo + sticky tokens', () => {
  assert.equal(U.proxidizeGeoToken({ country: 'USA', state: 'TX', city: 'Dallas' }), '-co-USA-st-TX-ci-Dallas');
  assert.equal(U.proxidizeGeoToken({ country: 'usa' }), '-co-USA');
  assert.equal(U.proxidizeGeoToken({ state: 'TX' }), '', 'state without country is dropped');
  assert.equal(U.proxidizePerGbUsername('user', { country: 'USA', state: 'TX', city: 'Dallas', session: 'abc' }),
    'user-co-USA-st-TX-ci-Dallas-s-abc');
  assert.equal(U.proxidizePerGbUsername('', { country: 'USA' }), '');
});

// --- Wiring: adapters, registry and UI entries must all exist --------------------------
test('all four adapters exist in ipcHandlers.js', () => {
  for (const fn of ['fetchMarsProxiesPool', 'fetchNodeMavenPool', 'fetchFroxyPool', 'fetchProxidizePool']) {
    assert.ok(IPC.includes(`function ${fn}`), `${fn} must be defined`);
  }
});

test('all four vendors are registered in PROXY_VENDORS and REAL_VENDOR_ADAPTERS', () => {
  for (const key of ['marsproxies', 'nodemaven', 'froxy', 'proxidize']) {
    assert.ok(new RegExp(`${key}\\s*:`).test(IPC), `${key} must be in the backend registries`);
  }
  assert.ok(/marsproxies:\s*fetchMarsProxiesPool/.test(IPC));
  assert.ok(/nodemaven:\s*fetchNodeMavenPool/.test(IPC));
  assert.ok(/froxy:\s*fetchFroxyPool/.test(IPC));
  assert.ok(/proxidize:\s*fetchProxidizePool/.test(IPC));
});

test('all four vendors have a PROVIDERS entry in the UI', () => {
  for (const key of ['marsproxies', 'nodemaven', 'froxy', 'proxidize']) {
    assert.ok(new RegExp(`key:\\s*'${key}'`).test(UI), `${key} must be a PROVIDERS entry`);
  }
});
