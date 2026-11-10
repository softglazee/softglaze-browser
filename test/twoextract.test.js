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

test('ZIP and ASN follow the documented examples and rules', () => {
  assert.equal(U.twoExtractUsername(BASE, { country: 'us', zip: '90210' }), `${BASE}-country-us-zip-90210`);
  assert.equal(U.twoExtractUsername(BASE, { country: 'us', state: 'il', city: 'springfield', zip: '62701' }), `${BASE}-country-us-state-il-city-springfield-zip-62701`);
  assert.equal(U.twoExtractUsername(BASE, { asn: '7922' }), `${BASE}-asn-7922`);
  assert.equal(U.twoExtractUsername(BASE, { asn: 'AS7922', session: 'x1', timeMin: 30 }), `${BASE}-asn-7922-session-x1-time-30`);
  assert.throws(() => U.twoExtractUsername(BASE, { country: 'us', asn: '7922' }), /cannot be combined/);
  assert.throws(() => U.twoExtractUsername(BASE, { asn: '7922', zip: '90210' }), /cannot be combined/);
  assert.throws(() => U.twoExtractUsername(BASE, { zip: '90210' }), /needs a country/);
  assert.throws(() => U.twoExtractUsername(BASE, { asn: 'comcast' }), /not an ASN/);
});

// The catalog's documented country list (docs.2extract.com/data/countries), as the picker shows it.
const catalogLine = /key: 'twoextract'.*/.exec(UI)[0];
const pickerCodes = /countries: '([A-Z ]+)'\.split\(' '\)/.exec(catalogLine)[1].split(' ');

test('the picker offers exactly the documented 2extract countries', () => {
  assert.equal(pickerCodes.length, 248);
  assert.equal(new Set(pickerCodes).size, pickerCodes.length);
  for (const c of pickerCodes) assert.ok(U.twoExtractCountry(c), `${c} must be accepted`);
  // Rows from the docs table, including the non-ISO Kosovo code; Saint Helena is not listed.
  for (const c of ['AX', 'XK', 'SX', 'BQ', 'US', 'GB', 'DE']) assert.ok(pickerCodes.includes(c), c);
  assert.equal(pickerCodes.includes('SH'), false);
  // "en" (England) is documented but is no ISO code, so only the username builder takes it.
  assert.equal(pickerCodes.includes('EN'), false);
  assert.equal(U.twoExtractCountry('en'), 'en');
  // The builder and the picker agree on every other two-letter code.
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of A) for (const b of A) {
    const code = a + b;
    if (code === 'EN') continue;
    assert.equal(Boolean(U.twoExtractCountry(code)), pickerCodes.includes(code), code);
  }
});

// Runs the real adapter with the shared mint helper, so the cap is checked end to end.
function ipcFunction(name) {
  return new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`).exec(IPC)[0];
}
const fetchTwoExtractPool = new Function(
  'crypto', 'twoExtractBaseUser', 'twoExtractUsername', 'TWOEXTRACT_GATEWAY', 'MINTED_PULL_MAX',
  `${['normCountryCode', 'clampPoolCount', 'gatewayPullPlan', 'gatewayOverride', 'mintGatewayRows', 'fetchTwoExtractPool'].map(ipcFunction).join('\n')}\nreturn fetchTwoExtractPool;`
)(require('crypto'), U.twoExtractBaseUser, U.twoExtractUsername, { host: 'proxy.2extract.net', port: 5555 }, Number(/const MINTED_PULL_MAX = (\d+);/.exec(IPC)[1]));

test('a pull mints up to MINTED_PULL_MAX sticky rows, each with its own session', async () => {
  const rows = await fetchTwoExtractPool({ username: BASE, password: 'pw', country: 'DE', count: '750' });
  assert.equal(rows.length, 750);
  assert.equal(new Set(rows.map((r) => r.username)).size, 750);
  assert.match(rows[0].username, new RegExp(`^${BASE}-country-de-session-sg[0-9a-f]{6}1$`));
  assert.equal((await fetchTwoExtractPool({ username: BASE, password: 'pw', count: '5000' })).length, 1000);
  const one = await fetchTwoExtractPool({ username: BASE, password: 'pw', count: '1' });
  assert.deepEqual(one.map((r) => r.username), [BASE], 'one row with no session rotates');
});

test('2extract is wired: adapter, registry, panel entry and hints', () => {
  assert.match(IPC, /async function fetchTwoExtractPool\(/);
  assert.match(IPC, /twoextract: fetchTwoExtractPool/);
  assert.match(IPC, /twoextract: '2extract'/);
  assert.match(IPC, /host: 'proxy\.2extract\.net', port: 5555/);
  assert.match(UI, /key: 'twoextract'.*creds: \['username', 'password'\].*geo: true, zip: true, asn: true.*proto: true/);
  for (const loc of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', loc, 'cmpSettingsC.json'), 'utf8'));
    assert.equal(typeof json.proxyProviders.geoHints.twoextract, 'string', loc);
    assert.doesNotMatch(json.proxyProviders.geoHints.twoextract, /[–—]/, 'no em or en dashes');
  }
});
