'use strict';
// IPRoyal residential connector.
//
// Spec: the OpenAPI document IPRoyal serves at https://resi-api.iproyal.com/docs
// (v1, "IPRoyal residential API documentation"). Rules these tests hold the code to:
//  1. Proxy lines are requested as {hostname}:{port}:{username}:{password}; the password
//     carries targeting and the sticky session, so it is everything after the third colon.
//  2. Sticky rows share host, port and username and differ only by password, so the pool's
//     dedupe must include the password or every row after the first reads as "existing".
//  3. Random rotation appends nothing, so every line is the same endpoint: ask for one.
//  4. Port is a NAME from GET /access/entry-nodes, not a number.
//  5. Sub-user passwords never reach the renderer; the generate call takes the hash.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseIpRoyalLine, ipRoyalLifetime, ipRoyalLocation, pickIpRoyalPort, ipRoyalCountriesView, ipRoyalErrorMessage
} = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

function fnBody(name) {
  const m = new RegExp(`async function ${name}\\(([\\s\\S]*?)\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist in ipcHandlers.js`);
  return m[0];
}

test('parses the spec example line and keeps the targeting in the password', () => {
  const r = parseIpRoyalLine('geo.iproyal.com:12321:sub_alpha:pass1234_country-kh_session-a1b2c3d4_lifetime-10m');
  assert.deepEqual(r, {
    host: 'geo.iproyal.com', port: 12321, username: 'sub_alpha',
    password: 'pass1234_country-kh_session-a1b2c3d4_lifetime-10m', session: 'a1b2c3d4'
  });
  assert.equal(parseIpRoyalLine('geo.iproyal.com:12321:u:p').session, null, 'random rotation has no session');
  for (const bad of ['', 'geo.iproyal.com:12321:user', 'host:abc:u:p', 'host:0:u:p', ':12321:u:p', 'host:12321::p']) {
    assert.equal(parseIpRoyalLine(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('lifetime follows the spec format and falls back to the 24h default', () => {
  for (const ok of ['1s', '59s', '1m', '30m', '59m', '1h', '24h', '99h', '100h', '168h']) assert.equal(ipRoyalLifetime(ok), ok);
  for (const bad of ['0m', '60m', '169h', '7d', '10', '', 'abc']) assert.equal(ipRoyalLifetime(bad), '24h', bad);
});

test('location strings use the documented prefixes and drop junk', () => {
  assert.equal(ipRoyalLocation({ country: 'KH', state: 'svaayrieng', city: 'bavet' }), '_country-kh_state-svaayrieng_city-bavet');
  assert.equal(ipRoyalLocation({ country: 'us' }), '_country-us');
  assert.equal(ipRoyalLocation({ country: '' , state: 'iowa' }), '', 'a state without a country is not a location');
  assert.equal(ipRoyalLocation({ country: 'usa' }), '');
  assert.equal(ipRoyalLocation({ country: 'us', city: 'new_york;drop' }), '_country-us_city-newyorkdrop');
});

test('the port NAME for the protocol comes from the entry nodes', () => {
  const nodes = [{ dns: 'geo.iproyal.com', ips: ['203.0.113.10'], ports: [{ name: 'http', port: 12321, alternative_ports: [] }, { name: 'socks5', port: 32325, alternative_ports: [] }] }];
  assert.deepEqual(pickIpRoyalPort(nodes, false), { name: 'http', port: 12321, dns: 'geo.iproyal.com' });
  assert.equal(pickIpRoyalPort(nodes, true).name, 'socks5');
  assert.equal(pickIpRoyalPort([], true), null);
});

test('the countries tree becomes a country list, then states with cities', () => {
  const data = {
    prefix: '_country-',
    countries: [{
      code: 'kh', name: 'Cambodia',
      cities: { prefix: '_city-', options: [{ code: 'phnompenh', name: 'Phnom Penh' }] },
      states: { prefix: '_state-', options: [{ code: 'svaayrieng', name: 'Svay Rieng', cities: { prefix: '_city-', options: [{ code: 'bavet', name: 'Bavet' }] } }] }
    }]
  };
  assert.deepEqual(ipRoyalCountriesView(data, ''), { countries: [{ key: 'kh', label: 'Cambodia' }] });
  const kh = ipRoyalCountriesView(data, 'KH');
  assert.deepEqual(kh.states, [{ key: 'svaayrieng', label: 'Svay Rieng', cities: [{ key: 'bavet', label: 'Bavet' }] }]);
  assert.deepEqual(kh.cities, [{ key: 'phnompenh', label: 'Phnom Penh' }]);
});

test('vendor errors become readable messages', () => {
  assert.match(ipRoyalErrorMessage('HTTP 401 {"error":{"code":"x","message":"Unauthenticated"}}'), /token was rejected/);
  assert.match(ipRoyalErrorMessage('HTTP 429 {}'), /rate limit/);
  assert.equal(ipRoyalErrorMessage('HTTP 422 {"error":{"code":"failed_validation","message":"The location is invalid."}}'), 'The location is invalid.');
  assert.equal(ipRoyalErrorMessage('socket hang up'), null);
});

test('IPRoyal is a known vendor with an adapter and a lookup', () => {
  assert.match(IPC, /iproyal: 'IPRoyal'/);
  assert.match(/const REAL_VENDOR_ADAPTERS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(IPC)[1], /iproyal:\s*fetchIpRoyalPool/);
  assert.match(/const VENDOR_LOOKUPS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(IPC)[1], /iproyal:\s*lookupIpRoyal/);
});

test('the adapter follows the documented generate call', () => {
  const body = fnBody('fetchIpRoyalPool');
  assert.ok(body.indexOf("'/residential/me'") < body.indexOf("'/access/generate-proxy-list'"), 'check the balance before generating');
  assert.match(body, /no residential traffic left/);
  assert.match(body, /format: '\{hostname\}:\{port\}:\{username\}:\{password\}'/);
  assert.match(body, /rotation: sticky \? 'sticky' : 'random'/);
  assert.match(body, /proxy_count: sticky \? n : 1/, 'random rotation is one endpoint');
  assert.match(body, /port: port\.name/, 'the port is sent by name');
  assert.match(body, /if \(sticky\) body\.lifetime = lifetime/);
  assert.match(body, /body\.subuser_hash = hash/);
  assert.match(body, /dedupeOnPassword: true/);
});

test('the pool compares the password when a row asks for it', () => {
  const fn = /async function syncVendorPool\([\s\S]*?\n}\r?\n/.exec(IPC);
  assert.match(fn[0], /row\.dedupeOnPassword \? \{ password: row\.password \} : \{\}/);
});

test('the token is scrubbed from transport errors and sub-user passwords stay in main', () => {
  assert.match(fnBody('iprCall'), /raw\.split\(t\)\.join\('\*\*\*'\)/);
  const lookup = fnBody('lookupIpRoyal');
  const mapped = /subusers: \(subs[\s\S]*?\}\)\),/.exec(lookup);
  assert.ok(mapped, 'the sub-user mapping must exist');
  assert.ok(!/password/.test(mapped[0]), 'sub-user passwords must not be returned to the renderer');
});

test('the UI offers IPRoyal with its own panel and every string exists', () => {
  const line = UI.split(/\r?\n/).find((l) => /\{ key: 'iproyal'/.test(l));
  assert.ok(line && /ipr: true/.test(line) && !/unavailable:\s*true/.test(line));
  assert.match(UI, /provider\.geoSync && provider\.geoSync\.ipr \? \(\s*renderIpRoyal\(\)/);
  const used = new Set();
  const re = /t\('(proxyProviders\.ipr\.[A-Za-z]+)'/g;
  let m;
  while ((m = re.exec(UI))) used.add(m[1]);
  assert.ok(used.size >= 12, `expected the ipr keys to be used, found ${used.size}`);
  for (const locale of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', locale, 'cmpSettingsC.json'), 'utf8'));
    for (const key of used) {
      const val = key.split('.').reduce((o, k) => (o == null ? o : o[k]), json);
      assert.ok(typeof val === 'string' && val.trim(), `${locale} is missing ${key}`);
    }
    assert.ok(json.proxyProviders.geoHints.iproyal, `${locale} geoHints.iproyal`);
  }
});
