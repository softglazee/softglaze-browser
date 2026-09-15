'use strict';
// Behavioural tests for the pure helpers the DataImpulse and Proxy-Seller adapters share.
// Unlike the structural tests in dataimpulse.test.js these run the real code.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseLoginLine, parseLoginList, csvFilter, asnList, FILTER_PATTERNS,
  proxySellerRotation, unwrapProxySeller, proxySellerGeoView
} = require('../src/main/proxyVendorUtils');

test('parses the documented login:password@host:port shape', () => {
  assert.deepEqual(parseLoginLine('a18abb7e32f01bdb3806__sessttl.5:secret@gw.dataimpulse.com:10003'), {
    host: 'gw.dataimpulse.com', port: 10003, username: 'a18abb7e32f01bdb3806__sessttl.5', password: 'secret'
  });
});

test("a password containing '@' and ':' survives", () => {
  const row = parseLoginLine('user:p@ss:w0rd@res.proxy-seller.com:10005');
  assert.equal(row.username, 'user');
  assert.equal(row.password, 'p@ss:w0rd');
  assert.equal(row.host, 'res.proxy-seller.com');
  assert.equal(row.port, 10005);
});

test("Proxy-Seller's trailing ';' is tolerated", () => {
  assert.equal(parseLoginLine('login:password@127.0.0.1:80;').port, 80);
});

test('a bracketed IPv6 host is unwrapped', () => {
  const row = parseLoginLine('u:p@[2001:db8::1]:8080');
  assert.equal(row.host, '2001:db8::1');
  assert.equal(row.port, 8080);
});

test('error bodies and malformed lines are rejected, never half-parsed', () => {
  for (const bad of ['', '{"status":"error"}', '<html>', 'user:pass', 'u:p@host', 'u:p@host:abc', 'u:p@host:70000', ':p@host:80']) {
    assert.equal(parseLoginLine(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('a rotating gateway listed several times is one endpoint', () => {
  const body = 'l:p@gw.dataimpulse.com:823\r\nl:p@gw.dataimpulse.com:823\nl:p@gw.dataimpulse.com:823\n';
  assert.equal(parseLoginList(body).length, 1);
});

test('distinct sticky ports stay distinct', () => {
  const body = ['l:p@gw.dataimpulse.com:10000', 'l:p@gw.dataimpulse.com:10001', 'l:p@gw.dataimpulse.com:10002'].join('\n');
  assert.deepEqual(parseLoginList(body).map((r) => r.port), [10000, 10001, 10002]);
});

test('filters keep valid values and drop junk', () => {
  assert.equal(csvFilter('New York, Los Angeles ,, <script>', FILTER_PATTERNS.text), 'New York,Los Angeles');
  assert.equal(csvFilter('10001, 1000 1, ../x', FILTER_PATTERNS.zip), '10001,1000 1');
  assert.equal(csvFilter('us, gbr, de', FILTER_PATTERNS.country), 'us,de');
  assert.equal(asnList('AS7922, 701, ASX'), '7922,701');
});

test('Proxy-Seller rotation maps to the documented values', () => {
  assert.equal(proxySellerRotation('sticky'), -1);
  assert.equal(proxySellerRotation('rotating'), 0);
  assert.equal(proxySellerRotation(''), 0);
  assert.equal(proxySellerRotation('interval', '300'), 300);
  assert.equal(proxySellerRotation('interval', '99999'), 3600, 'the API caps the timer at 3600 seconds');
  assert.equal(proxySellerRotation('interval', ''), 60);
});

test('Proxy-Seller success envelopes unwrap to data', () => {
  assert.deepEqual(unwrapProxySeller('{"status":"success","data":{"items":[]},"errors":[]}', 'x'), { items: [] });
});

test('Proxy-Seller business errors (HTTP 200) become actionable messages', () => {
  const env = (message) => JSON.stringify({ status: 'error', data: null, errors: [{ message, code: 503 }] });
  assert.throws(() => unwrapProxySeller(env('Error api key'), 'x'), /API key was rejected/);
  assert.throws(() => unwrapProxySeller(env('IP not allowed'), 'x'), /whitelisted IPs/);
  assert.throws(() => unwrapProxySeller(env('Tarif not found'), 'x'), /no active residential package/);
  assert.throws(() => unwrapProxySeller(env('Request limit reached'), 'x'), /rate limit/);
  assert.throws(() => unwrapProxySeller(env('Invalid country (region, city, isp) ISO code'), 'list create'), /list create: Invalid country/);
  assert.throws(() => unwrapProxySeller('not json', 'download'), /did not return JSON/);
});

test('the Proxy-Seller geo view lists countries, then regions with their cities', () => {
  const db = [
    { code: 'AD', name: 'Andorra', regions: [{ name: 'Andorra la Vella', code: 118, cities: [{ name: 'Andorra la Vella', isps: ['Andorra Telecom'] }] }] },
    { code: 'US', name: 'United States', regions: [{ name: 'Washington', cities: [{ name: 'Garfield', isps: [] }] }] }
  ];
  assert.deepEqual(proxySellerGeoView(db, ''), [{ key: 'AD', label: 'Andorra' }, { key: 'US', label: 'United States' }]);
  const us = proxySellerGeoView(db, 'us');
  assert.equal(us.length, 1);
  assert.equal(us[0].key, 'Washington');
  assert.deepEqual(us[0].cities.map((c) => c.name), ['Garfield']);
  assert.deepEqual(proxySellerGeoView(db, 'ZZ'), []);
});
