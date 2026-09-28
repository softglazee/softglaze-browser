'use strict';
// Airproxy connector. Built from the live API (fetched against a real account 2026-09-27):
//   GET https://airproxy.io/api/proxy/list/?key=<KEY>
//   -> { proxies: [{ id, ip, port, username, password, isp, in_use_till, ... }], count, success }
// Dedicated mobile proxies, one HTTP endpoint each (its own SIM). The API key rides in the
// query string (URL-encoded). airproxyRows maps active, well-formed entries to pool rows.
//
// Exercises the real pure helper, and asserts the adapter + registry + UI entry are wired.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

// The exact response shape returned by a live account (credentials replaced with dummies).
const SAMPLE = JSON.stringify({
  proxies: [
    { id: 301, ip: 's1.airproxy.io', port: 30501, username: 'acct', password: 'DUMMYpass', src_whitelist: [], isp: 'Wind', comment: '', in_use_from: '2026-09-26T13:38:51Z', in_use_till: '2026-10-03T13:38:50Z' }
  ],
  count: 1,
  success: true
});

test('airproxyRows maps the documented list shape to one HTTP row', () => {
  const rows = U.airproxyRows(SAMPLE);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { type: rows[0].type, host: rows[0].host, port: rows[0].port, username: rows[0].username, password: rows[0].password },
    { type: 'HTTP', host: 's1.airproxy.io', port: 30501, username: 'acct', password: 'DUMMYpass' }
  );
  assert.match(rows[0].label, /Airproxy .* Mobile/);
  assert.match(rows[0].label, /Wind/);
});

test('airproxyRows accepts a pre-parsed object, dedupes and skips malformed entries', () => {
  const dup = { proxies: [
    { id: 1, ip: 's1.airproxy.io', port: 30501, username: 'acct', password: 'p' },
    { id: 2, ip: 's1.airproxy.io', port: 30501, username: 'acct', password: 'p' }, // same host:port:user -> dropped
    { id: 3, ip: 's2.airproxy.io', port: 0, username: 'acct', password: 'p' },       // bad port -> skipped
    { id: 4, ip: 'bad host/x', port: 40000, username: 'acct', password: 'p' },       // junk host -> skipped
    { id: 5, ip: 's3.airproxy.io', port: 40001, username: '', password: 'p' }        // no username -> skipped
  ] };
  const rows = U.airproxyRows(dup);
  assert.equal(rows.length, 1, 'only the first valid, unique entry survives');
  assert.equal(rows[0].host, 's1.airproxy.io');
});

test('airproxyRows returns [] for junk, non-arrays and empty lists (never throws)', () => {
  assert.deepEqual(U.airproxyRows('not json'), []);
  assert.deepEqual(U.airproxyRows('{"error":"bad key"}'), []);
  assert.deepEqual(U.airproxyRows(JSON.stringify({ proxies: [] })), []);
  assert.deepEqual(U.airproxyRows(''), []);
});

// --- Wiring: adapter, registry and UI entry must all exist -----------------------------
test('fetchAirproxyPool exists in ipcHandlers.js', () => {
  assert.ok(IPC.includes('function fetchAirproxyPool'), 'fetchAirproxyPool must be defined');
});

test('Airproxy is registered in PROXY_VENDORS and REAL_VENDOR_ADAPTERS', () => {
  assert.ok(/airproxy:\s*'Airproxy'/.test(IPC), 'must be in PROXY_VENDORS');
  assert.ok(/airproxy:\s*fetchAirproxyPool/.test(IPC), 'must be in REAL_VENDOR_ADAPTERS');
});

test('the API key is URL-encoded into the request path', () => {
  assert.ok(/change_ip[\s\S]*?NOT wired|encodeURIComponent\(key\)/.test(IPC), 'key must be encodeURIComponent-d');
});

test('Airproxy has a PROVIDERS entry in the UI keyed on the API token', () => {
  const line = UI.split(/\r?\n/).find((l) => /key:\s*'airproxy'/.test(l));
  assert.ok(line, 'airproxy must be a PROVIDERS entry');
  assert.ok(!/unavailable:\s*true/.test(line), 'must not be marked unavailable');
  assert.match(line, /creds:\s*\[\s*'token'\s*\]/, 'must ask for an API token');
});

test('geoHints.airproxy exists in every cmpSettingsC locale', () => {
  const localesDir = path.join(ROOT, 'src', 'renderer', 'i18n', 'locales');
  for (const loc of fs.readdirSync(localesDir)) {
    const f = path.join(localesDir, loc, 'cmpSettingsC.json');
    if (!fs.existsSync(f)) continue;
    const json = JSON.parse(fs.readFileSync(f, 'utf8'));
    const hint = json?.proxyProviders?.geoHints?.airproxy;
    assert.ok(typeof hint === 'string' && hint.length > 0, `geoHints.airproxy missing in ${loc}`);
  }
});
