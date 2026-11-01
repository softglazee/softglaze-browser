'use strict';
// GonzoProxy connector: login grammar from the published examples on help.gonzoproxy.com/ru
// (Dolphin Anty and Octo Browser setup pages, residential guide; fetched 2026-11-01).
// Built from the docs only: never checked against a live account.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('gonzoProxyUsername reproduces the published login examples', () => {
  assert.equal(U.gonzoProxyUsername('Gonzoj9CiIi', { country: 'US', session: '204976RWZ' }), 'Gonzoj9CiIi_c_US_s_204976RWZ_ttl_72h');
  assert.equal(U.gonzoProxyUsername('Gonzoj9CiIi', { country: 'US', state: '443', session: '663698TEC' }), 'Gonzoj9CiIi_c_US_sd_443_s_663698TEC_ttl_72h');
});

test('the city token matches the documented city_Los-Angeles form', () => {
  assert.equal(U.gonzoProxyUsername('L1', { country: 'us', city: 'los angeles', session: 'a' }), 'L1_c_US_city_Los-Angeles_s_a_ttl_72h');
});

test('a pasted full login keeps only its base', () => {
  assert.equal(U.gonzoProxyBaseLogin('Gonzoj9CiIi_c_US_sd_443_s_663698TEC_ttl_72h'), 'Gonzoj9CiIi');
  assert.equal(U.gonzoProxyBaseLogin('me@example.com'), '');
});

test('bad input fails instead of being dropped', () => {
  assert.throws(() => U.gonzoProxyUsername('me@example.com', { country: 'US', session: 'a' }), /login from Proxy Setup/);
  assert.throws(() => U.gonzoProxyUsername('L1', { session: 'a' }), /pick a country/);
  assert.throws(() => U.gonzoProxyUsername('L1', { country: 'USA', session: 'a' }), /pick a country/);
  assert.throws(() => U.gonzoProxyUsername('L1', { country: 'US', state: 'California', session: 'a' }), /numeric region code/);
  assert.throws(() => U.gonzoProxyUsername('L1', { country: 'US', session: '---' }), /letters or digits/);
});

test('rows are always sticky, because only that login form is published', () => {
  const body = /async function fetchGonzoProxyPool\([\s\S]*?\r?\n\}\r?\n/.exec(IPC)[0];
  assert.match(body, /session: String\(session \|\| ''\)\.trim\(\) \|\| `sg/);
});

test('GonzoProxy is wired: adapter, registry, panel entry and hints', () => {
  assert.match(IPC, /async function fetchGonzoProxyPool\(/);
  assert.match(IPC, /gonzoproxy: fetchGonzoProxyPool/);
  assert.match(IPC, /gonzoproxy: 'GonzoProxy'/);
  assert.match(IPC, /host: 'connect\.gonzoproxy\.app', port: 10000/);
  assert.match(UI, /key: 'gonzoproxy'.*creds: \['username', 'password'\].*geo: true.*session: true.*proto: true/);
  assert.doesNotMatch(/key: 'gonzoproxy'.*/.exec(UI)[0], /life: true/, 'the only published lifetime is 72h');
  for (const loc of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', loc, 'cmpSettingsC.json'), 'utf8'));
    assert.equal(typeof json.proxyProviders.geoHints.gonzoproxy, 'string', loc);
    assert.doesNotMatch(json.proxyProviders.geoHints.gonzoproxy, /[–—]/, 'no em or en dashes');
  }
});
