'use strict';
// Regression tests: the app must never invent a proxy.
//
// Background: syncVendorPool had a SIMULATION fallback for any vendor without a live
// adapter. It fabricated four rows from a hardcoded VENDOR_GATEWAYS entry, and those
// entries were described in the source itself as "plausible" gateways. They were never
// checked. Six of the eight did not resolve in DNS at all:
//
//   gate.lumiproxy.com  gate.proxy302.com  gate.kookeey.com
//   gate.lunaproxy.com  gate.ipburger.com  gate.tisocks.net
//
// So a user could hit Sync, get four healthy-looking rows, assign them to profiles and
// have every launch fail against a host that does not exist. A fabricated username
// pointed at a real host is worse again, because the row looks plausible.
//
// These tests are structural on purpose. There is no way to unit-test "this hostname is
// real", so instead they enforce the rule that produced the bug: a vendor may only offer
// a pull if code exists to perform it, and a gateway may only be listed if an adapter
// actually reads it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

// Hostnames confirmed NOT to exist in DNS (checked against 8.8.8.8 and 1.1.1.1).
const DEAD_HOSTS = [
  'gate.lumiproxy.com',
  'gate.proxy302.com',
  'gate.kookeey.com',
  'gate.lunaproxy.com',
  'gate.ipburger.com',
  'gate.tisocks.net'
];

function realAdapterKeys() {
  const block = /const REAL_VENDOR_ADAPTERS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(IPC);
  assert.ok(block, 'REAL_VENDOR_ADAPTERS must exist');
  return new Set(Array.from(block[1].matchAll(/^\s*(\w+):\s*fetch/gm), (m) => m[1]));
}

function gatewayKeys() {
  const block = /const VENDOR_GATEWAYS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(IPC);
  assert.ok(block, 'VENDOR_GATEWAYS must exist');
  return new Set(Array.from(block[1].matchAll(/^\s*(\w+):\s*\{/gm), (m) => m[1]));
}

// --- 1) the simulator is gone and must stay gone ---------------------------

test('the vendor simulator no longer exists', () => {
  assert.doesNotMatch(IPC, /simulateVendorProxies/,
    'a fallback that invents proxy rows must never be reintroduced');
});

test('a vendor with no adapter refuses the pull instead of inventing rows', () => {
  const fn = /async function syncVendorPool\([\s\S]*?\n}\r?\n/.exec(IPC);
  assert.ok(fn, 'syncVendorPool must exist');
  assert.match(fn[0], /throw new Error\(/,
    'the no-adapter branch must throw, not fabricate');
  assert.match(fn[0], /is not connected to a live API yet/,
    'and it must say so in words the user can act on');
});

// --- 2) no dead or unverified host may be shipped --------------------------

test('no hostname confirmed dead in DNS appears anywhere in the source', () => {
  for (const host of DEAD_HOSTS) {
    assert.ok(!IPC.includes(host), `${host} does not resolve and must not be in ipcHandlers.js`);
    assert.ok(!UI.includes(host), `${host} does not resolve and must not be in ProxyProviders.jsx`);
  }
});

test('every VENDOR_GATEWAYS entry is actually read by a real adapter', () => {
  const real = realAdapterKeys();
  for (const key of gatewayKeys()) {
    assert.ok(real.has(key),
      `VENDOR_GATEWAYS.${key} has no live adapter, so the host is unverified and must not ship`);
  }
});

// --- 3) the UI cannot offer a pull that the backend will refuse ------------

test('every provider in the UI either has an adapter or is marked unavailable', () => {
  const real = realAdapterKeys();
  const lines = UI.split(/\r?\n/).filter((l) => /^\s*\{ key: '/.test(l));
  assert.ok(lines.length >= 10, 'expected the PROVIDERS list to be found');

  for (const line of lines) {
    const key = /key: '([^']+)'/.exec(line)[1];
    const unavailable = /unavailable:\s*true/.test(line);
    const offersPull = /tokenSync:\s*true|apiSync:\s*true|geoSync:\s*\{/.test(line);

    if (!real.has(key)) {
      assert.ok(unavailable, `${key} has no adapter, so it must be marked unavailable: true`);
      assert.ok(!offersPull, `${key} has no adapter, so it must not offer a sync mechanic`);
    }
  }
});

test('a provider marked unavailable carries no gateway to prefill', () => {
  const lines = UI.split(/\r?\n/).filter((l) => /^\s*\{ key: '/.test(l) && /unavailable:\s*true/.test(l));
  assert.ok(lines.length > 0, 'expected at least one unavailable provider');
  for (const line of lines) {
    const key = /key: '([^']+)'/.exec(line)[1];
    assert.match(line, /gateway: null/,
      `${key} is unavailable, so its gateway must be null rather than an unverified host`);
  }
});

// --- 4) the dereferences that a null gateway would break ------------------

test('the UI never dereferences a null gateway', () => {
  assert.doesNotMatch(UI, /provider\.gateway\.host/,
    'gateway is null for unconnected vendors, so this would throw on select');
  assert.doesNotMatch(UI, /provider\.gateway\.port/, 'same for port');
  assert.doesNotMatch(UI, /^\s*type: provider\.gateway\.type/m, 'same for type');
});
