'use strict';
// PacketStream connector. Built from the live dashboard Network Access generator (2026-09-27):
//  - One residential gateway: proxy.packetstream.io:31112 (HTTP/HTTPS), :31113 (SOCKS5).
//  - Auth = account username + a proxy password (NOT the account password).
//  - Country + sticky session are appended to the PASSWORD:
//      <pass>_country-US_session-ab12cd   (2-letter uppercase country; omit = random/rotating).
//  - No API call: the app mints gateway rows locally (like Froxy). A blank session gives one
//    rotating row; a session name mints `count` sticky rows so each profile pins its own IP.
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

// --- packetStreamPassword --------------------------------------------------------------
test('packetStreamPassword appends country then session to the base password', () => {
  assert.equal(U.packetStreamPassword('base', { country: 'US', session: 'ab12' }), 'base_country-US_session-ab12');
  assert.equal(U.packetStreamPassword('base', { country: 'us' }), 'base_country-US', 'country is upper-cased');
  assert.equal(U.packetStreamPassword('base', { session: 'x1' }), 'base_session-x1', 'session without country');
  assert.equal(U.packetStreamPassword('base', {}), 'base', 'no flags = base password verbatim (random + rotating)');
  assert.equal(U.packetStreamPassword('base'), 'base', 'no options object is safe');
});

test('packetStreamPassword rejects malformed country and strips unsafe session chars', () => {
  assert.equal(U.packetStreamPassword('base', { country: 'USA' }), 'base', 'a non-2-letter country is dropped');
  assert.equal(U.packetStreamPassword('base', { country: '1!' }), 'base', 'junk country is dropped');
  assert.equal(U.packetStreamPassword('base', { session: 'a b-c/d' }), 'base_session-abcd', 'session keeps only alphanumerics');
  assert.equal(U.packetStreamPassword('', { country: 'US' }), '_country-US', 'empty base still targets');
});

// --- Wiring: adapter, registry and UI entry must all exist -----------------------------
test('fetchPacketStreamPool exists in ipcHandlers.js', () => {
  assert.ok(IPC.includes('function fetchPacketStreamPool'), 'fetchPacketStreamPool must be defined');
});

test('PacketStream is registered in PROXY_VENDORS and REAL_VENDOR_ADAPTERS', () => {
  assert.ok(/packetstream:\s*'PacketStream'/.test(IPC), 'must be in PROXY_VENDORS');
  assert.ok(/packetstream:\s*fetchPacketStreamPool/.test(IPC), 'must be in REAL_VENDOR_ADAPTERS');
});

test('PacketStream has a PROVIDERS entry in the UI', () => {
  const line = UI.split(/\r?\n/).find((l) => /key:\s*'packetstream'/.test(l));
  assert.ok(line, 'packetstream must be a PROVIDERS entry');
  assert.ok(!/unavailable:\s*true/.test(line), 'must not be marked unavailable');
  assert.match(line, /geoSync:\s*\{[^}]*session:\s*true/, 'sticky-session field must be enabled');
});

test('geoHints.packetstream exists in every cmpSettingsC locale', () => {
  const localesDir = path.join(ROOT, 'src', 'renderer', 'i18n', 'locales');
  for (const loc of fs.readdirSync(localesDir)) {
    const f = path.join(localesDir, loc, 'cmpSettingsC.json');
    if (!fs.existsSync(f)) continue;
    const json = JSON.parse(fs.readFileSync(f, 'utf8'));
    const hint = json?.proxyProviders?.geoHints?.packetstream;
    assert.ok(typeof hint === 'string' && hint.length > 0, `geoHints.packetstream missing in ${loc}`);
  }
});
