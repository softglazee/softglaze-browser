'use strict';
// Runs the real Proxy-Seller adapter source from ipcHandlers.js against a stubbed transport,
// with no network. ipcHandlers.js pulls in electron and cannot be required, so the adapter's
// own section of the file is lifted out and given stand-ins for the few helpers it uses.
//
// Response fixtures are the examples on docs.proxy-seller.com/api-v2 (read 1 Nov 2026), plus
// the flat resident/lists array the v2 SDK READMEs describe. None of this proves the live API
// behaves the same way: it proves the adapter does the right thing IF it does.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const utils = require('../src/main/proxyVendorUtils');

const IPC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipcHandlers.js'), 'utf8');
const SECTION = IPC.slice(IPC.indexOf('// --- Proxy-Seller: residential lists'), IPC.indexOf('// --- IPRoyal residential'));
const KEY = 'testKey1234567890abc';
const BASE = `https://proxy-seller.com/personal/api/v2/${KEY}`;

const ok = (data) => JSON.stringify({ status: 'success', data, errors: [] });
const fail = (...messages) => JSON.stringify({ status: 'error', data: null, errors: messages.map((message) => ({ message, code: 503, customData: null })) });

const PACKAGE = {
  rotation: 3600, package_key: '064b9fcc7416d9e6f65f', is_active: true, tarif_id: '69e79e532c200df885906f8f',
  is_link_date: false, traffic_limit: '1073741824', traffic_usage: '0', traffic_left: '1073741824',
  traffic_usage_sub: '0', traffic_limit_sub: '0', traffic_left_sub: '0', expired_at: '2026-06-13 23:59:59', auto_renew: false
};
const LIST = {
  id: 20447213, title: 'The list for example', login: 'login', password: 'password', whitelist: '', rotation: 121,
  geo: { country: 'AD', region: 'Andorra La Vella', city: 'Andorra La Vella', isp: 'Andorra Telecom, S.a.u.' },
  export: { ports: 1, ext: 'csv' }
};
const CREATED = {
  id: 21829782, title: 'myList', login: '123123', password: '123123', whitelist: '', rotation: -1,
  geo: [{ country: 'AD', region: 'Andorra la Vella', city: 'Andorra la Vella', isp: 'Andorra Telecom, S.a.u.' }],
  export: { ports: '1', ext: 'csv' }
};
const IPV6_ITEM = {
  id: '69fa4b7f256cae5b70a79478', order_id: '69fa4b795a1f522c7a53d589', order_number: 'TEST_1778011001948-uc_e_UUf2Z3RtGH',
  basket_id: '69fa4b7a5a1f522c7a53d58b', ip: '11.55.11.0', ip_only: '11.55.11.0', protocol: 'HTTP', port_socks: 49453, port_http: 49353,
  login: 'login', password: 'password', auth_ip: '', rotation: null, link_reboot: '#', country: 'Germany', country_alpha3: 'DEU',
  status: 'Active', status_type: 'ACTIVE', can_prolong: true, date_start: '05.05.2026', date_end: '11.06.2026', comment: '',
  auto_renew: 'N', auto_renew_period: '', uptime: false
};
const GEO_DB = [{ code: 'AD', name: 'Andorra', regions: [{ name: 'Andorra la Vella', code: 100, cities: [{ name: 'Santa Coloma', isps: ['Andorra Telecom, S.a.u.'] }] }] }];
const DOWNLOAD = 'login:password@res.example.test:10000;\nlogin:password@res.example.test:10001;\n';

// routes: "METHOD path" (path without base, query included) -> response body or Error.
function adapter(routes) {
  const calls = [];
  const httpRequestText = async (url, options = {}) => {
    const method = options.method || 'GET';
    const rel = url.startsWith(`${BASE}/`) ? url.slice(BASE.length + 1) : url;
    calls.push({ url, method, rel, options, body: options.body ? JSON.parse(options.body) : undefined });
    const route = Object.keys(routes).find((r) => {
      const [m, p] = r.split(' ');
      return m === method && (rel === p || rel.split('?')[0] === p);
    });
    if (!route) throw new Error(`unexpected call ${method} ${url}`);
    const answer = routes[route];
    if (answer instanceof Error) throw answer;
    return options.binary ? Buffer.from(answer) : answer;
  };
  const scoped = {
    httpRequestText,
    fs: fs.promises,
    path,
    os: require('node:os'),
    normCountryCode: (v) => { const s = String(v || '').trim().toUpperCase(); return /^[A-Z]{2}$/.test(s) ? s : ''; },
    clampPoolCount: (value, def = 5, max = 500) => { const n = Number.parseInt(String(value), 10); return !Number.isFinite(n) || n < 1 ? def : Math.min(n, max); },
    ...utils
  };
  const names = Object.keys(scoped);
  // eslint-disable-next-line no-new-func
  const { fetchProxySellerPool, lookupProxySeller } = new Function(...names, `${SECTION}\nreturn { fetchProxySellerPool, lookupProxySeller };`)(...names.map((n) => scoped[n]));
  return { fetchProxySellerPool, lookupProxySeller, calls };
}

test('every request goes to the v2 base with the key in the path', async () => {
  const a = adapter({ 'GET proxy/list': ok({ ipv6: [IPV6_ITEM], resident: [] }), 'GET resident/package': ok(PACKAGE), 'GET resident/lists': ok([LIST]) });
  await a.lookupProxySeller({ token: KEY });
  assert.deepEqual(a.calls.map((c) => c.url), [`${BASE}/proxy/list`, `${BASE}/resident/package`, `${BASE}/resident/lists`]);
});

test('the lookup reads a flat resident/lists array (v2 SDK READMEs)', async () => {
  const a = adapter({ 'GET proxy/list': ok({ ipv6: [IPV6_ITEM], resident: [] }), 'GET resident/package': ok(PACKAGE), 'GET resident/lists': ok([LIST]) });
  const out = await a.lookupProxySeller({ token: KEY });
  assert.deepEqual(out.lists, [{ id: 20447213, title: 'The list for example', country: 'AD', region: 'Andorra La Vella', city: 'Andorra La Vella', rotation: 'rotates every 121s' }]);
  assert.equal(out.residential, true);
  assert.equal(out.totalBytes, 1073741824);
  assert.equal(out.leftBytes, 1073741824);
  assert.equal(out.expiresAt, '2026-06-13 23:59:59');
  assert.equal(out.products[0].key, 'ipv6');
  assert.equal(out.products[0].orders[0].id, '69fa4b795a1f522c7a53d589');
});

test('the lookup reads resident/lists under items (v2 docs page)', async () => {
  const a = adapter({ 'GET proxy/list': ok({ ipv6: [] }), 'GET resident/package': ok(PACKAGE), 'GET resident/lists': ok({ items: [LIST] }) });
  const out = await a.lookupProxySeller({ token: KEY });
  assert.equal(out.lists.length, 1);
  assert.equal(out.lists[0].id, 20447213);
});

test('an account with no residential package still gets the IPv6 view', async () => {
  const a = adapter({ 'GET proxy/list': ok({ ipv6: [IPV6_ITEM] }), 'GET resident/package': fail('Tarif not found') });
  const out = await a.lookupProxySeller({ token: KEY });
  assert.equal(out.residential, false);
  assert.deepEqual(out.lists, []);
  assert.equal(out.products[0].active, 1);
});

// Live, 2 Nov 2026: an account holding only IPv6 got this v2 wording from resident/package,
// and Load account failed because only the v1 "Tarif not found" was recognised.
test('an IPv6-only account still loads with the v2 "no package" wording', async () => {
  const a = adapter({ 'GET proxy/list': ok({ ipv6: [IPV6_ITEM] }), 'GET resident/package': fail('Make order with resident first') });
  const out = await a.lookupProxySeller({ token: KEY });
  assert.equal(out.residential, false);
  assert.deepEqual(out.lists, []);
  assert.equal(out.products[0].active, 1);
  assert.ok(!a.calls.some((c) => c.rel === 'resident/lists'), 'no list lookup without a package');
});

test('the geo database reads as the v2 JSON envelope (live shape, 2 Nov 2026)', async () => {
  const a = adapter({ 'GET proxy/list': ok({}), 'GET resident/package': fail('Make order with resident first'), 'GET resident/geo': ok(GEO_DB) });
  const out = await a.lookupProxySeller({ token: KEY, groupby: 'country' });
  assert.deepEqual(out.geo, [{ key: 'AD', label: 'Andorra' }]);
});

test('a residential pull without a package names the reason under the v2 wording', async () => {
  const a = adapter({ 'GET resident/package': fail('Make order with resident first') });
  await assert.rejects(a.fetchProxySellerPool({ token: KEY, country: 'US', count: 1 }), /no active residential package/);
  assert.equal(a.calls.length, 1, 'nothing is created');
});

test('a new list is created as documented and its array geo still labels the rows', async () => {
  const a = adapter({ 'GET resident/package': ok(PACKAGE), 'POST resident/list/add': ok(CREATED), 'GET proxy/download/resident': DOWNLOAD });
  const rows = await a.fetchProxySellerPool({ token: KEY, country: 'ad', state: 'Andorra la Vella', city: 'Andorra la Vella', count: 2, poolType: 'sticky' });
  const post = a.calls.find((c) => c.method === 'POST');
  assert.equal(post.url, `${BASE}/resident/list/add`);
  assert.deepEqual(post.body.geo, { country: 'AD', region: 'Andorra la Vella', city: 'Andorra la Vella' }, 'the request geo is an object');
  assert.equal(post.body.whitelist, '');
  assert.equal(post.body.rotation, -1);
  assert.deepEqual(post.body.export, { ports: 2, ext: 'txt' });
  const dl = new URL(a.calls.at(-1).url);
  assert.equal(dl.searchParams.get('listId'), '21829782');
  assert.equal(dl.searchParams.get('ext'), '%login%:%password%@%ip%:%port%');
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].host, rows[0].port, rows[0].username, rows[0].password, rows[0].type], ['res.example.test', 10000, 'login', 'password', 'HTTP']);
  assert.equal(rows[0].country, 'AD', 'the array geo must not fall back to Global');
  assert.match(rows[0].label, /Residential • AD Andorra la Vella • sticky • port 10000/);
});

for (const [shape, body] of [['a flat array', [LIST]], ['items', { items: [LIST] }]]) {
  test(`pulling an existing list by id works when resident/lists is ${shape}, and creates nothing`, async () => {
    const a = adapter({ 'GET resident/package': ok(PACKAGE), 'GET resident/lists': ok(body), 'GET proxy/download/resident': DOWNLOAD });
    const rows = await a.fetchProxySellerPool({ token: KEY, listId: '20447213', proxyType: 'socks5' });
    assert.ok(!a.calls.some((c) => c.method === 'POST'));
    const dl = new URL(a.calls.at(-1).url);
    assert.equal(dl.searchParams.get('listId'), '20447213');
    assert.equal(rows[0].type, 'SOCKS5');
    assert.equal(rows[0].country, 'AD');
  });
}

test('a list id that is gone says so', async () => {
  const a = adapter({ 'GET resident/package': ok(PACKAGE), 'GET resident/lists': ok([LIST]) });
  await assert.rejects(a.fetchProxySellerPool({ token: KEY, listId: '999' }), /no longer on the account/);
});

test('an ended residential package refuses before creating a list', async () => {
  const a = adapter({ 'GET resident/package': ok({ ...PACKAGE, is_active: false, traffic_left: '0' }) });
  await assert.rejects(a.fetchProxySellerPool({ token: KEY, country: 'US', count: 1 }), /not active/);
  assert.equal(a.calls.length, 1);
});

test('an IPv6 pull filters by a v2 ObjectId order and never touches the residential package', async () => {
  const a = adapter({ 'GET proxy/list/ipv6': ok({ items: [IPV6_ITEM] }) });
  const rows = await a.fetchProxySellerPool({ token: KEY, plan: 'ipv6', orderId: '69fa4b795a1f522c7a53d589', count: 5 });
  assert.equal(a.calls.length, 1);
  assert.equal(a.calls[0].url, `${BASE}/proxy/list/ipv6?orderId=69fa4b795a1f522c7a53d589`);
  assert.deepEqual([rows[0].host, rows[0].port, rows[0].username, rows[0].type], ['11.55.11.0', 49353, 'login', 'HTTP']);
});

test('an IPv6 pull can filter by the numeric order id or the order number', async () => {
  for (const orderId of ['5264240', 'TEST_1778011001948-uc_e_UUf2Z3RtGH']) {
    const a = adapter({ 'GET proxy/list/ipv6': ok({ items: [IPV6_ITEM] }) });
    await a.fetchProxySellerPool({ token: KEY, plan: 'ipv6', orderId, proxyType: 'socks5' });
    assert.equal(a.calls[0].url, `${BASE}/proxy/list/ipv6?orderId=${orderId}`);
  }
});

// Live shape, 2 Nov 2026: an IPv6 order bought as HTTPS. Ports are strings and port_socks is empty.
const HTTPS_ONLY_ITEM = { ...IPV6_ITEM, ip: '11.55.11.0:10385', protocol: 'HTTPS', port_socks: '', port_http: '10385' };

test('an HTTPS-only order pulls over HTTP with string ports', async () => {
  const a = adapter({ 'GET proxy/list/ipv6': ok({ items: [HTTPS_ONLY_ITEM] }) });
  const rows = await a.fetchProxySellerPool({ token: KEY, plan: 'ipv6', count: 5, proxyType: 'http' });
  assert.deepEqual([rows[0].host, rows[0].port, rows[0].type], ['11.55.11.0', 10385, 'HTTP']);
});

test('a SOCKS5 pull of an HTTPS-only order names the protocol instead of "no proxies"', async () => {
  const a = adapter({ 'GET proxy/list/ipv6': ok({ items: [HTTPS_ONLY_ITEM] }) });
  await assert.rejects(
    a.fetchProxySellerPool({ token: KEY, plan: 'ipv6', count: 5, proxyType: 'socks5' }),
    (e) => /no SOCKS5 port/.test(e.message) && /protocol is HTTPS/.test(e.message) && /Pull them as HTTP/.test(e.message) && !/no active/.test(e.message)
  );
});

test('an HTTP pull of a SOCKS5-only order points the other way', async () => {
  const a = adapter({ 'GET proxy/list/ipv6': ok({ items: [{ ...IPV6_ITEM, protocol: 'SOCKS5', port_http: '' }] }) });
  await assert.rejects(a.fetchProxySellerPool({ token: KEY, plan: 'ipv6', proxyType: 'http' }), /no HTTP port.*Pull them as SOCKS5/);
});

test('an order that returns nothing is reported, not imported as blank', async () => {
  const a = adapter({ 'GET proxy/list/ipv6': ok({ items: [] }) });
  await assert.rejects(a.fetchProxySellerPool({ token: KEY, plan: 'ipv6', orderId: 'nosuchorder' }), /no active IPv6 proxies in that order/);
});

test('the geo database reads as a plain JSON file (v2 SDK READMEs)', async () => {
  const a = adapter({ 'GET proxy/list': ok({}), 'GET resident/package': fail('Tarif not found'), 'GET resident/geo': JSON.stringify(GEO_DB) });
  const out = await a.lookupProxySeller({ token: KEY, groupby: 'country' });
  assert.deepEqual(out.geo, [{ key: 'AD', label: 'Andorra' }]);
  assert.equal(a.calls.at(-1).url, `${BASE}/resident/geo`);
  assert.equal(a.calls.at(-1).options.binary, true, 'a ZIP answer must survive, so the body stays bytes');
});

test('the key never survives into an error, whichever way it comes back', async () => {
  const seen = [];
  const grab = (p) => p.then(() => assert.fail('should have thrown'), (e) => seen.push(e.message));

  const http = new Error(`HTTP 404 {"path":"/personal/api/v2/${KEY}/proxy/list"}`);
  await grab(adapter({ 'GET proxy/list': http }).lookupProxySeller({ token: KEY }));

  const envelope = fail(`Unknown action /personal/api/v2/${KEY}/proxy/list`);
  await grab(adapter({ 'GET proxy/list': envelope }).lookupProxySeller({ token: KEY }));

  const a = adapter({ 'GET resident/package': ok(PACKAGE), 'GET resident/lists': ok([LIST]), 'GET proxy/download/resident': fail(`Unknown action /personal/api/v2/${KEY.toLowerCase()}/proxy/download/resident`) });
  await grab(a.fetchProxySellerPool({ token: KEY, listId: '20447213' }));

  await grab(adapter({ 'GET proxy/list': ok({}), 'GET resident/package': fail('Tarif not found'), 'GET resident/geo': fail(`Unknown action /personal/api/v2/${KEY}/resident/geo`) }).lookupProxySeller({ token: KEY, groupby: 'country' }));

  assert.equal(seen.length, 4);
  for (const message of seen) {
    assert.ok(!message.toLowerCase().includes(KEY.toLowerCase()), `leaked: ${message}`);
    assert.match(message, /\*\*\*/);
  }
});

test('a refused key reports all three possible causes', async () => {
  const a = adapter({ 'GET proxy/list': fail('Error api key', 'IP not allowed 203.0.113.9', 'Request limit reached') });
  await assert.rejects(a.lookupProxySeller({ token: KEY }), (e) => {
    assert.match(e.message, /API key is wrong/);
    assert.match(e.message, /whitelist/);
    assert.match(e.message, /rate limit/);
    return true;
  });
});
