'use strict';
// Structural tests for the Proxy-Seller residential adapter. ipcHandlers.js pulls in
// electron and cannot be required, so these assert the rules on the source, in the same
// style as dataimpulse.test.js. The parsing and error mapping are exercised for real in
// proxyVendorUtils.test.js.
//
// The rules, all from Proxy-Seller's own docs (docs.proxy-seller.com, API v1):
//  1. The API key lives in the URL PATH, so it must never reach an error message.
//  2. Business errors come back as HTTP 200 with status "error", so every JSON call goes
//     through the envelope check.
//  3. The package is checked before a list is created, so an account with no traffic or
//     no residential package is refused instead of creating a list that cannot carry load.
//  4. Hosts and ports come from the downloaded list, never from a hardcoded gateway.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

function fnBody(name) {
  const m = new RegExp(`async function ${name}\\(([\\s\\S]*?)\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist in ipcHandlers.js`);
  return m[0];
}

test('Proxy-Seller is a known vendor with a real adapter and a lookup', () => {
  assert.match(IPC, /proxyseller:\s*'Proxy-Seller'/, 'proxyseller must be in PROXY_VENDORS');
  const adapters = /const REAL_VENDOR_ADAPTERS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(IPC);
  assert.match(adapters[1], /proxyseller:\s*fetchProxySellerPool/);
  const lookups = /const VENDOR_LOOKUPS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(IPC);
  assert.ok(lookups, 'VENDOR_LOOKUPS must exist');
  assert.match(lookups[1], /proxyseller:\s*lookupProxySeller/);
  assert.match(lookups[1], /dataimpulse:\s*lookupDataImpulse/);
});

test('Proxy-Seller carries no hardcoded gateway', () => {
  const block = /const VENDOR_GATEWAYS = Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(IPC);
  assert.ok(!/^\s*proxyseller:/m.test(block[1]), 'hosts must come from the downloaded list');
  assert.ok(!/res\.proxy-seller\.com/.test(fnBody('fetchProxySellerPool')), 'the adapter must not build rows from a guessed gateway');
});

test('the API key is scrubbed from transport errors', () => {
  const body = fnBody('psRequest');
  assert.match(body, /\.split\(key\)\.join\('\*\*\*'\)/, 'a failed request must not echo the key-bearing URL');
});

test('JSON calls go through the envelope check', () => {
  assert.match(fnBody('psCall'), /unwrapProxySeller\(/);
});

test('the package is checked before a list is created', () => {
  const body = fnBody('fetchProxySellerPool');
  const pkgAt = body.indexOf('await psPackage(key)');
  const createAt = body.indexOf("'resident/list/add'");
  assert.ok(pkgAt > -1 && createAt > -1);
  assert.ok(pkgAt < createAt, 'check the package first');
  assert.match(body, /traffic_left/);
  assert.match(body, /no traffic left/i);
});

test('a new list authorises by login, not by IP whitelist', () => {
  assert.match(fnBody('fetchProxySellerPool'), /whitelist: ''/,
    'a whitelist would tie the list to this machine instead of the profile using it');
});

test('ports are capped at the documented 1000 per list', () => {
  assert.match(IPC, /const PS_MAX_PORTS = 1000;/);
  assert.match(fnBody('fetchProxySellerPool'), /clampPoolCount\(count, 5, PS_MAX_PORTS\)/);
});

test('the download asks for the protocol that was chosen and rows are typed from it', () => {
  const body = fnBody('fetchProxySellerPool');
  assert.match(body, /proto: socks \? 'socks5' : 'https'/);
  assert.match(body, /type: socks \? 'SOCKS5' : 'HTTP'/);
  assert.match(body, /parseLoginList\(text\)/);
});

test('IPv6 and the other per-IP products pull from existing orders, not the residential package', () => {
  const body = fnBody('fetchProxySellerPool');
  const branchAt = body.indexOf('PROXY_SELLER_ORDER_TYPES[product]');
  const pkgAt = body.indexOf('await psPackage(key)');
  assert.ok(branchAt > -1, 'the adapter must branch on the per-IP product types');
  assert.ok(branchAt < pkgAt, 'per-IP products must not require a residential package');
  const orders = fnBody('fetchProxySellerOrderPool');
  assert.match(orders, /proxy\/list\/\$\{product\}/, 'per-IP proxies come from GET proxy/list/{type}');
  assert.match(orders, /proxySellerOrderRows\(/);
  assert.ok(!/resident\/list\/add/.test(orders), 'nothing is created for a per-IP product');
});

test('an account with no residential package still gets a lookup', () => {
  const body = fnBody('lookupProxySeller');
  assert.match(body, /psCall\(key, 'GET', 'proxy\/list', 'proxy list'\)/);
  assert.match(body, /no active residential package/i, 'a missing package must not fail the whole lookup');
  assert.match(body, /summarizeProxySellerOrders\(all\)/);
});

test('a healthy IPv6-only proxy is not reported dead by the health check', () => {
  // ipinfo.io and ip-api.com publish no AAAA record (checked 15 Sep 2026), so an IPv6 exit
  // cannot reach either. The check and the launch geo lookup must fall back to a dual-stack service.
  const check = fnBody('testProxyConnectivity');
  assert.match(check, /httpGetJson\(GEOJS_URL, agent, 15000\)/);
  const engine = fs.readFileSync(path.join(ROOT, 'src', 'main', 'browserEngine.js'), 'utf8');
  assert.match(engine, /require\('\.\/proxyVendorUtils'\)/);
  assert.match(engine, /attempt\(GEOJS_URL,/, 'lookupProxyGeoNode must retry on the dual-stack service');
  assert.match(engine, /page\.goto\(GEOJS_URL,/, 'lookupProxyGeo must retry on the dual-stack service');
});

test('the lookup channel is gated and wired on both sides', () => {
  assert.match(fnBody('vendorLookup'), /await requirePermission\('proxies\.manage'\)/);
  assert.match(IPC, /registerHandler\(CHANNELS\.PROXY_VENDOR_LOOKUP, vendorLookup\)/);
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload.js'), 'utf8');
  assert.match(preload, /vendorLookup: \(payload\) => invoke\(CHANNELS\.PROXY_VENDOR_LOOKUP, payload\)/);
});

test('the UI offers Proxy-Seller with its own panel', () => {
  const line = UI.split(/\r?\n/).find((l) => /\{ key: 'proxyseller'/.test(l));
  assert.ok(line, 'Proxy-Seller must appear in the PROVIDERS list');
  assert.ok(!/unavailable:\s*true/.test(line));
  assert.match(line, /geoSync:\s*\{[^}]*ps: true/);
  assert.match(UI, /provider\.geoSync && provider\.geoSync\.ps \? \(\s*renderProxySeller\(\)/);
});

test('every Proxy-Seller and account string exists in every locale', () => {
  const used = new Set();
  const re = /t\('(proxyProviders\.(?:ps|account)\.[A-Za-z]+)'/g;
  let m;
  while ((m = re.exec(UI))) used.add(m[1]);
  assert.ok(used.size >= 20, `expected the ps/account keys to be used, found ${used.size}`);
  for (const locale of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', locale, 'cmpSettingsC.json'), 'utf8'));
    for (const key of used) {
      const val = key.split('.').reduce((o, k) => (o == null ? o : o[k]), json);
      assert.ok(typeof val === 'string' && val.trim(), `${locale}/cmpSettingsC.json is missing ${key}`);
    }
    assert.ok(json.proxyProviders.geoHints.proxyseller, `${locale} must carry geoHints.proxyseller`);
  }
});
