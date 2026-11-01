'use strict';
// Behavioural tests for the pure helpers the DataImpulse and Proxy-Seller adapters share.
// Unlike the structural tests in dataimpulse.test.js these run the real code.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseLoginLine, parseLoginList, csvFilter, asnList, FILTER_PATTERNS,
  proxySellerRotation, unwrapProxySeller, proxySellerGeoView,
  maskProxySellerKey, proxySellerListItems, proxySellerListGeo,
  GEOJS_URL, normalizeGeoJs, proxySellerOrderRows, summarizeProxySellerOrders
} = require('../src/main/proxyVendorUtils');

// The item shape documented for GET proxy/list/{type} (docs.proxy-seller.com).
const psItem = (over = {}) => ({
  id: '0678564', order_id: '123456', order_number: '2000096_20240080', ip: '31.6.33.97', ip_only: '31.6.33.97',
  protocol: 'HTTP', port_socks: 12346, port_http: 12345, login: 'ruht5734hg', password: 'gou5h437g',
  country: 'Belgium', country_alpha3: 'BEL', status: 'Active', status_type: 'ACTIVE', date_end: '23.07.2024',
  ...over
});

test('the dual-stack geo fallback reads the fields get.geojs.io actually returns', () => {
  assert.equal(GEOJS_URL, 'https://get.geojs.io/v1/ip/geo.json');
  // Captured live on 15 Sep 2026.
  const live = { accuracy: 200, asn: 136525, city: 'Ghotki', country: 'Pakistan', country_code: 'PK', ip: '182.190.221.29', latitude: '28.0009', longitude: '69.317', organization: 'AS136525 Wancom (Pvt) Ltd.', organization_name: 'Wancom (Pvt) Ltd.', region: 'Sindh', timezone: 'Asia/Karachi' };
  assert.deepEqual(normalizeGeoJs(live), { ip: '182.190.221.29', country: 'PK', region: 'Sindh', city: 'Ghotki', isp: 'Wancom (Pvt) Ltd.', timezone: 'Asia/Karachi', lat: 28.0009, lon: 69.317 });
  assert.equal(normalizeGeoJs({ ip: '2600:1f18::1' }).ip, '2600:1f18::1');
  assert.equal(normalizeGeoJs({}), null);
  assert.equal(normalizeGeoJs(null), null);
});

test('Proxy-Seller order items become one row per IP on the port for the chosen protocol', () => {
  const [http] = proxySellerOrderRows([psItem()], { label: 'Proxy-Seller • IPv6' });
  assert.equal(http.type, 'HTTP');
  assert.equal(http.host, '31.6.33.97');
  assert.equal(http.port, 12345);
  assert.equal(http.username, 'ruht5734hg');
  assert.equal(http.password, 'gou5h437g');
  assert.match(http.label, /Proxy-Seller • IPv6 • BEL • port 12345/);
  const [socks] = proxySellerOrderRows([psItem()], { socks: true });
  assert.equal(socks.type, 'SOCKS5');
  assert.equal(socks.port, 12346);
});

test('inactive, portless and duplicate order items are dropped', () => {
  const rows = proxySellerOrderRows([
    psItem(), psItem(),
    psItem({ port_http: 12347, status_type: 'EXPIRED' }),
    psItem({ port_http: null }),
    psItem({ port_http: 12348, ip_only: '', ip: '' })
  ]);
  assert.equal(rows.length, 1);
});

test('200 IPv6 IPs behind one entry host stay 200 distinct rows', () => {
  const items = Array.from({ length: 200 }, (_, i) => psItem({ id: String(i), port_http: 20000 + i, ip: '195.123.232.19', ip_only: '195.123.232.19', country_alpha3: 'USA', login: 'azhar' }));
  assert.equal(proxySellerOrderRows(items).length, 200);
});

test('the order summary counts active IPs per product and finds the earliest expiry', () => {
  const summary = summarizeProxySellerOrders({
    ipv4: [],
    ipv6: [
      psItem({ order_id: 'A', date_end: '15.10.2026', country_alpha3: 'USA' }),
      psItem({ order_id: 'A', date_end: '15.10.2026', country_alpha3: 'USA', port_http: 2 }),
      psItem({ order_id: 'B', date_end: '01.10.2026', country_alpha3: 'USA', port_http: 3 }),
      psItem({ order_id: 'B', status_type: 'EXPIRED', port_http: 4 })
    ],
    resident: []
  });
  assert.equal(summary.length, 1);
  assert.equal(summary[0].key, 'ipv6');
  assert.equal(summary[0].active, 3);
  assert.equal(summary[0].total, 4);
  assert.deepEqual(summary[0].countries, ['USA']);
  assert.equal(summary[0].expires, '01.10.2026');
  assert.deepEqual(summary[0].orders.map((o) => [o.id, o.count]), [['A', 2], ['B', 1]]);
});

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

test('the Proxy-Seller access-denied triple does not blame the key alone', () => {
  // Body shape captured from both /personal/api/v1 and /v2 with a fake key on 1 Nov 2026.
  const triple = JSON.stringify({ status: 'error', data: null, errors: [
    { message: 'Error api key', code: 503, customData: null },
    { message: 'IP not allowed 203.0.113.9', code: 503, customData: null },
    { message: 'Request limit reached', code: 503, customData: null }
  ] });
  assert.throws(() => unwrapProxySeller(triple, 'x'), (e) => {
    assert.match(e.message, /API key is wrong/);
    assert.match(e.message, /whitelist/);
    assert.match(e.message, /rate limit/);
    assert.ok(!e.message.includes('203.0.113.9'));
    assert.ok(![0x2013, 0x2014].some((code) => e.message.includes(String.fromCharCode(code))), 'no em or en dashes in user-facing text');
    return true;
  });
});

test('the Proxy-Seller key is masked wherever an error echoes it', () => {
  const key = 'Abc123.Key+Secret';
  assert.equal(maskProxySellerKey(`GET /personal/api/v2/${key}/proxy/list`, key), 'GET /personal/api/v2/***/proxy/list');
  assert.equal(maskProxySellerKey(`/v2/${key.toLowerCase()}/x`, key), '/v2/***/x', 'any letter case');
  assert.equal(maskProxySellerKey(`/v2/${encodeURIComponent(key)}/x`, key), '/v2/***/x', 'URL-encoded');
  assert.equal(maskProxySellerKey('no key here', key), 'no key here');
  assert.equal(maskProxySellerKey('text', ''), 'text');
  const echoed = JSON.stringify({ status: 'error', data: null, errors: [{ message: `Unknown action /personal/api/v2/${key}/proxy/list`, code: 0 }] });
  assert.throws(() => unwrapProxySeller(echoed, 'proxy list', key), (e) => {
    assert.ok(!e.message.includes(key), 'the key must not survive in the thrown message');
    assert.match(e.message, /Unknown action \/personal\/api\/v2\/\*\*\*\/proxy\/list/);
    return true;
  });
});

test('Proxy-Seller resident lists read as a flat array or under items', () => {
  const list = { id: 20447213, title: 'The list for example', rotation: 121 };
  assert.deepEqual(proxySellerListItems([list]), [list], 'the v2 SDK READMEs: flat array');
  assert.deepEqual(proxySellerListItems({ items: [list] }), [list], 'the v2 docs page: data.items');
  assert.deepEqual(proxySellerListItems([]), []);
  assert.deepEqual(proxySellerListItems(null), []);
  assert.deepEqual(proxySellerListItems({ items: 'nope' }), []);
});

test('Proxy-Seller list geo reads as an object or the one-item array list/add returns', () => {
  const geo = { country: 'AD', region: 'Andorra la Vella', city: 'Andorra la Vella', isp: 'Andorra Telecom, S.a.u.' };
  assert.deepEqual(proxySellerListGeo(geo), geo, 'GET resident/lists');
  assert.deepEqual(proxySellerListGeo([geo]), geo, 'POST resident/list/add in the v2 docs');
  assert.deepEqual(proxySellerListGeo([]), {}, 'a list with no geo target');
  assert.deepEqual(proxySellerListGeo(undefined), {});
  assert.deepEqual(proxySellerListGeo('US'), {});
});

test('Proxy-Seller v2 per-IP items keep their ObjectId order ids intact', () => {
  // Field values from the v2 docs example for GET proxy/list/{type}.
  const item = psItem({ id: '69fa4b7f256cae5b70a79478', order_id: '69fa4b795a1f522c7a53d589', order_number: 'TEST_1778011001948-uc_e_UUf2Z3RtGH', uptime: false });
  const [row] = proxySellerOrderRows([item]);
  assert.equal(row.orderId, '69fa4b795a1f522c7a53d589');
  const [summary] = summarizeProxySellerOrders({ ipv6: [item], resident: [] });
  assert.equal(summary.key, 'ipv6');
  assert.equal(summary.orders[0].id, '69fa4b795a1f522c7a53d589');
  assert.equal(summary.orders[0].number, 'TEST_1778011001948-uc_e_UUf2Z3RtGH');
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
