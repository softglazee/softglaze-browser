'use strict';
// RapidProxy connector. Built from the vendor's own examples on rapidproxy.io/proxy (2026-09-29):
//  - Rotating residential gateway us.rapidproxy.io:5001; credentials are a dashboard sub-account.
//  - Targeting rides in the USERNAME: <sub>-residential-<CC|global>[-state-X[-city-Y]][-session-id[-stime-min]].
//  - State/City are CamelCase; stime is 1-180 minutes and only applies with a session.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('rapidProxyUsername matches the documented examples', () => {
  assert.equal(U.rapidProxyUsername('acc', { country: 'KR' }), 'acc-residential-KR');
  assert.equal(U.rapidProxyUsername('acc', {}), 'acc-residential-GLOBAL', 'no country = global');
  assert.equal(U.rapidProxyUsername('acc', { country: 'US', state: 'California' }), 'acc-residential-US-state-California');
  assert.equal(U.rapidProxyUsername('acc', { country: 'US', state: 'Mississippi', city: 'Jackson' }), 'acc-residential-US-state-Mississippi-city-Jackson');
  assert.equal(U.rapidProxyUsername('acc', { session: '14675113' }), 'acc-residential-GLOBAL-session-14675113');
  assert.equal(U.rapidProxyUsername('acc', { session: '14675113', lifeMin: 20 }), 'acc-residential-GLOBAL-session-14675113-stime-20');
});

test('rapidProxyUsername normalises places, clamps stime and drops invalid parts', () => {
  assert.equal(U.rapidProxyUsername('acc', { country: 'us', state: 'north carolina', city: 'new-york' }), 'acc-residential-US-state-NorthCarolina-city-NewYork');
  assert.equal(U.rapidProxyUsername('acc', { state: 'Texas' }), 'acc-residential-GLOBAL', 'a state without a country is dropped');
  assert.equal(U.rapidProxyUsername('acc', { country: 'US', city: 'Austin' }), 'acc-residential-US', 'a city without a state is dropped');
  assert.match(U.rapidProxyUsername('acc', { session: 'a1', lifeMin: 1440 }), /^acc-residential-GLOBAL-session-\d{8}-stime-180$/, 'non-numeric session -> 8-digit sid; stime capped at 180');
  assert.equal(U.rapidProxyUsername('acc', { lifeMin: 30 }), 'acc-residential-GLOBAL', 'stime needs a session');
  assert.equal(U.rapidProxySid('a b/c'), U.rapidProxySid('a b/c'), 'stable');
  assert.match(U.rapidProxySid('a b/c'), /^\d{8}$/);
  assert.equal(U.rapidProxySid('56987484'), '56987484', 'numeric ids kept');
});

test('RapidProxy is wired: adapter, both registries and a UI entry', () => {
  assert.ok(IPC.includes('async function fetchRapidProxyPool'));
  assert.match(IPC, /rapidproxy:\s*fetchRapidProxyPool/);
  assert.match(IPC, /rapidproxy:\s*'RapidProxy'/);
  assert.ok(IPC.includes("host: 'us.rapidproxy.io', port: 5001"));
  assert.match(UI, /key:\s*'rapidproxy'/);
});
