'use strict';
// Databay connector: hyphen-separated username grammar from docs.databay.com (Connection
// String, Ports, Location Control, Sticky Sessions) on gw.databay.co:8888.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('databayUsername: zone is always present, residential by default', () => {
  assert.equal(U.databayUsername('u1'), 'u1-zone-residential');
  assert.equal(U.databayUsername('u1', { zone: 'mobile' }), 'u1-zone-mobile');
  assert.equal(U.databayUsername('u1', { zone: 'bogus' }), 'u1-zone-residential');
  assert.equal(U.databayUsername('u1-zone-mobile', { zone: 'datacenter' }), 'u1-zone-datacenter', 'a pasted zone suffix is replaced');
});

test('databayUsername: one location filter, the most specific', () => {
  assert.equal(U.databayUsername('u1', { country: 'us' }), 'u1-zone-residential-countryCode-US');
  assert.equal(U.databayUsername('u1', { country: 'US', state: 'California' }), 'u1-zone-residential-stateName-California');
  assert.equal(U.databayUsername('u1', { country: 'US', state: 'CA', city: 'Los Angeles' }), 'u1-zone-residential-cityName-Los Angeles');
  assert.equal(U.databayUsername('u1', { country: 'FR', city: 'Aix-en-Provence' }), 'u1-zone-residential-cityName-Aix en Provence', 'hyphens never leak into a value');
});

test('databayUsername: mobile and datacenter take country only', () => {
  assert.equal(U.databayUsername('u1', { zone: 'mobile', country: 'gb', city: 'London' }), 'u1-zone-mobile-countryCode-GB');
  assert.equal(U.databayUsername('u1', { zone: 'datacenter', country: 'de', state: 'Berlin' }), 'u1-zone-datacenter-countryCode-DE');
});

test('databayUsername: sticky session, length capped at 120', () => {
  assert.equal(U.databayUsername('u1', { session: 'cart-42' }), 'u1-zone-residential-sessionId-cart42-sessionLength-30');
  assert.equal(U.databayUsername('u1', { country: 'US', session: 'a', lengthMin: 999 }), 'u1-zone-residential-countryCode-US-sessionId-a-sessionLength-120');
});

test('Databay is wired: adapter, gateway, registry and panel entry', () => {
  assert.match(IPC, /async function fetchDatabayPool\(/);
  assert.match(IPC, /databay: fetchDatabayPool/);
  assert.match(IPC, /databay: 'Databay'/);
  assert.match(IPC, /host: 'gw\.databay\.co', port: 8888/);
  assert.match(UI, /key: 'databay'.*creds: \['username', 'password'\].*geo: true.*proto: true/);
});
