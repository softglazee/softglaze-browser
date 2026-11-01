'use strict';
// 2extract connector: username grammar from docs.2extract.com (Authentication, Geo-Targeting,
// Session Control, Country List; fetched 2026-11-01) on proxy.2extract.net:5555.
// Built from the docs only: never checked against a live account.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');
const BASE = '2xt-customer-a1b2-proxy-my_scraper';

test('twoExtractUsername reproduces the examples in the docs', () => {
  assert.equal(U.twoExtractUsername(BASE), BASE, 'no flags rotates per request');
  assert.equal(U.twoExtractUsername(BASE, { country: 'DE', city: 'berlin' }), `${BASE}-country-de-city-berlin`);
  assert.equal(U.twoExtractUsername(BASE, { country: 'us', state: 'il', city: 'springfield' }), `${BASE}-country-us-state-il-city-springfield`);
  assert.equal(U.twoExtractUsername(BASE, { session: 'user123', timeMin: 30 }), `${BASE}-session-user123-time-30`);
  assert.equal(U.twoExtractUsername(BASE, { country: 'de', session: 'user123' }), `${BASE}-country-de-session-user123`);
});

test('twoExtractUsername lower-cases places and removes spaces, as the docs require', () => {
  assert.equal(U.twoExtractUsername(BASE, { country: 'US', state: 'New York', city: 'San Francisco' }), `${BASE}-country-us-state-newyork-city-sanfrancisco`);
});

test('a pasted username keeps only its base', () => {
  assert.equal(U.twoExtractBaseUser(`${BASE}-country-de-session-x`), BASE);
  assert.equal(U.twoExtractBaseUser('someone@example.com'), '');
  assert.throws(() => U.twoExtractUsername('plainlogin'), /2xt-customer-<id>-proxy-<name>/);
});

test('bad targeting fails instead of being dropped', () => {
  assert.throws(() => U.twoExtractUsername(BASE, { country: 'ZZ' }), /does not list the country "ZZ"/);
  assert.throws(() => U.twoExtractUsername(BASE, { country: 'USA' }), /does not list/);
  assert.throws(() => U.twoExtractUsername(BASE, { city: 'Paris' }), /needs a country/);
  assert.throws(() => U.twoExtractUsername(BASE, { state: 'Texas' }), /needs a country/);
  assert.throws(() => U.twoExtractUsername(BASE, { timeMin: 30 }), /needs a sticky session/);
  assert.throws(() => U.twoExtractUsername(BASE, { session: 'x', timeMin: 'soon' }), /whole number/);
  assert.throws(() => U.twoExtractUsername(BASE, { session: '---' }), /letters or digits/);
});

test('every country in the panel dropdown is one 2extract lists', () => {
  const block = /export const PROXY_COUNTRIES = \[([\s\S]*?)\n\];/.exec(UI)[1];
  const codes = [...block.matchAll(/\['([A-Z]{2})',/g)].map((m) => m[1]);
  assert.ok(codes.length > 30);
  for (const c of codes) assert.ok(U.twoExtractCountry(c), `${c} must be accepted`);
});

test('2extract is wired: adapter, registry, panel entry and hints', () => {
  assert.match(IPC, /async function fetchTwoExtractPool\(/);
  assert.match(IPC, /twoextract: fetchTwoExtractPool/);
  assert.match(IPC, /twoextract: '2extract'/);
  assert.match(IPC, /host: 'proxy\.2extract\.net', port: 5555/);
  assert.match(UI, /key: 'twoextract'.*creds: \['username', 'password'\].*geo: true.*proto: true/);
  for (const loc of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', loc, 'cmpSettingsC.json'), 'utf8'));
    assert.equal(typeof json.proxyProviders.geoHints.twoextract, 'string', loc);
    assert.doesNotMatch(json.proxyProviders.geoHints.twoextract, /[–—]/, 'no em or en dashes');
  }
});
