'use strict';
// Regression tests for the DataImpulse adapter.
//
// DataImpulse is the first vendor wired as a REAL list pull rather than a gateway
// mint. GET https://gw.dataimpulse.com:777/api/list returns one proxy per line,
// already rendered as `login:password@hostname:port`, with country/state/city and
// session targeting applied server-side. That shape is why these tests exist:
//
//  1. The host must come from the API response, never from a hardcoded table. Every
//     hardcoded "plausible" gateway in this codebase turned out to be wrong, and six
//     did not resolve in DNS at all (see vendorGateways.test.js).
//  2. The credential check must happen BEFORE the pull. Otherwise a wrong login gives
//     an empty pool instead of an auth error, and an exhausted plan mints rows that
//     die on first use.
//  3. The line parser must split at the LAST '@' and the FIRST ':' of the credential
//     half. Splitting naively is the exact bug that once parsed user:pass@host:port
//     into host="user" with a NaN port, and a proxy password may legitimately contain
//     '@' or ':'.
//
// These are structural assertions on the source, matching vendorGateways.test.js,
// because ipcHandlers.js pulls in electron and cannot be required from a test.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

function adapterBody() {
  const m = /async function fetchDataImpulsePool\(([\s\S]*?)\n\}/.exec(IPC);
  assert.ok(m, 'fetchDataImpulsePool must exist in ipcHandlers.js');
  return m[0];
}

test('DataImpulse is registered as a real adapter', () => {
  const block = /const REAL_VENDOR_ADAPTERS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(IPC);
  assert.ok(block, 'REAL_VENDOR_ADAPTERS must exist');
  assert.match(block[1], /dataimpulse:\s*fetchDataImpulsePool/,
    'dataimpulse must map to its adapter, or syncVendorPool will refuse the pull');
  assert.match(IPC, /dataimpulse:\s*'DataImpulse'/,
    'dataimpulse must be a known vendor in PROXY_VENDORS');
});

test('DataImpulse does NOT carry a hardcoded gateway', () => {
  const block = /const VENDOR_GATEWAYS = Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(IPC);
  assert.ok(block, 'VENDOR_GATEWAYS must exist');
  assert.ok(!/^\s*dataimpulse:/m.test(block[1]),
    'the host must come from /api/list, not from a hardcoded table that nobody verified');
});

test('credentials are verified against /api/stats BEFORE the list is pulled', () => {
  const stats = /async function diPlanStats\([\s\S]*?\n\}/.exec(IPC);
  assert.ok(stats, 'diPlanStats must exist');
  assert.match(stats[0], /\$\{DI_API\}\/stats/, 'diPlanStats must call /api/stats');
  const body = adapterBody();
  const statsAt = body.indexOf('await diPlanStats(');
  const listAt = body.indexOf('/list?');
  assert.ok(statsAt > -1, 'the adapter must verify credentials through diPlanStats');
  assert.ok(listAt > -1, 'the adapter must call /api/list to pull proxies');
  assert.ok(statsAt < listAt,
    'the credential check must come first, so a bad login is an auth error not an empty pool');
});

test('an exhausted plan is refused rather than minting dead rows', () => {
  const body = adapterBody();
  assert.match(body, /traffic_left/, 'the adapter must read traffic_left from /api/stats');
  assert.match(body, /no traffic left/i,
    'a plan with zero traffic must be reported, not silently pulled from');
});

test('the list is parsed by the shared parser, not a local split', () => {
  // The parser itself is exercised for real in proxyVendorUtils.test.js.
  const body = adapterBody();
  assert.match(body, /parseLoginList\(text\)/, 'the adapter must parse /api/list with parseLoginList');
  assert.ok(!/\.split\('@'\)/.test(body),
    "split('@') is the bug that produced host=\"user\" and a NaN port");
});

test('documented query parameters are sent, and session_ttl only when sticky', () => {
  const body = adapterBody();
  for (const p of ['quantity', 'type', 'protocol', 'countries', 'states', 'cities', 'session_ttl']) {
    assert.ok(body.includes(`'${p}'`), `the adapter must send the documented ${p} parameter`);
  }
  assert.match(body, /sticky\s*&&[^\n]*session_ttl/,
    'session_ttl is meaningless for a rotating pull and must be gated on sticky');
});

test('a rotating pull asks for ONE endpoint, not N copies of the same one', () => {
  // Measured against the live API on 15 Sep 2026: quantity=5 with type=rotating returned
  // five IDENTICAL lines, so the pool deduped them and reported "Returned: 5, Added: 1,
  // Existing: 4". DataImpulse's own documented example response is three identical lines
  // too. A rotating gateway is ONE endpoint whose exit IP changes per request, which is
  // exactly how fetchGatewayVerifiedPool treats Oxylabs and Smartproxy.
  const body = adapterBody();
  assert.match(body, /const want = sticky \? n : 1/,
    'rotating must request a single endpoint; asking for N mints N copies of one proxy');
  assert.match(body, /qs\.set\('quantity', String\(want\)\)/,
    'the quantity sent must be the adjusted value, not the raw requested count');
});

test('a second sticky pull adds NEW ports instead of returning the same ones', () => {
  // Measured live on 15 Sep 2026: quantity=5 twice returned ports 10000-10004 both times,
  // so the second pull added nothing. The adapter must ask for have + n and keep only the
  // ports the pool does not already hold.
  const body = adapterBody();
  assert.match(body, /existingPorts\(\{ host: first\.host, login: first\.username\.split\('__'\)\[0\] \}\)/,
    'the lookup must key on the BASE login, so a different country or lifetime never reuses a held port');
  assert.match(body, /qs\.set\('quantity', String\(have\.size \+ n\)\)/,
    'the re-pull must ask for what the pool holds plus the new amount');
  assert.match(body, /filter\(\(r\) => !have\.has\(r\.port\)\)/,
    'ports already in the pool must be dropped before rows are returned');

  const fn = /async function syncVendorPool\([\s\S]*?\n}\r?\n/.exec(IPC);
  assert.ok(fn, 'syncVendorPool must exist');
  assert.match(fn[0], /existingPorts: async \(\{ host, login \}\)/,
    'syncVendorPool must hand the adapter a lookup of existing ports');
  assert.match(fn[0], /startsWith: `\$\{login\}__`/,
    'rows carrying a targeting suffix on the same login must count as held');
});

test('rows are typed from the protocol that was actually requested', () => {
  const body = adapterBody();
  assert.match(body, /socks\s*\?\s*'SOCKS5'\s*:\s*'HTTP'/,
    'a SOCKS5 pull must be stored as SOCKS5, or the engine will speak the wrong protocol to it');
});

test('the UI offers DataImpulse a pull and does not mark it unavailable', () => {
  const line = UI.split(/\r?\n/).find((l) => /\{ key: 'dataimpulse'/.test(l));
  assert.ok(line, 'DataImpulse must appear in the PROVIDERS list');
  assert.ok(!/unavailable:\s*true/.test(line), 'DataImpulse has a live adapter, so it is available');
  assert.match(line, /geoSync:\s*\{/, 'DataImpulse must offer the geo pull mechanic');
  assert.match(line, /di:\s*true/, 'the di flag drives the product/session/protocol controls');
});

test('the DataImpulse selects are seeded with values its own options carry', () => {
  // The shared defaults are plan:'premium', proxyType:'proxy_sock_5', poolType:'residential'.
  // None of those is a DataImpulse option value, so without a provider-aware reset the
  // three selects render with nothing selected.
  assert.match(UI, /const di = provider\.key === 'dataimpulse'/,
    'the form reset must know which provider it is priming');
  assert.match(UI, /plan: di \? 'residential' : 'premium'/, 'product must default to residential');
  assert.match(UI, /proxyType: di \? 'http' : 'proxy_sock_5'/, 'protocol must default to http');
  // Sticky, because a profile needs an exit IP that stays put and rotating adds one proxy.
  assert.match(UI, /poolType: di \? 'sticky' : 'residential'/, 'session must default to sticky');
});

test('the documented extra filters reach /api/list', () => {
  const body = adapterBody();
  for (const p of ['zipcodes', 'asns', 'exclude_countries', 'exclude_asns']) {
    assert.ok(body.includes(`'${p}'`), `the adapter must send the documented ${p} parameter`);
  }
});

test('the panel no longer renders a raw geoHints key for DataImpulse', () => {
  // GEO_HINTS had no dataimpulse entry, so t() fell back to printing the key itself.
  for (const locale of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', locale, 'cmpSettingsC.json'), 'utf8'));
    assert.ok(json.proxyProviders.geoHints.dataimpulse, `${locale} must carry geoHints.dataimpulse`);
  }
});

test('every DataImpulse translation key exists in every locale', () => {
  const used = new Set();
  const re = /t\('(proxyProviders\.geo\.di[A-Za-z]+)'/g;
  let m;
  while ((m = re.exec(UI))) used.add(m[1]);
  assert.ok(used.size >= 8, `expected the di* keys to be used, found ${used.size}`);

  const dir = path.join(ROOT, 'src', 'renderer', 'i18n', 'locales');
  for (const lang of fs.readdirSync(dir)) {
    const file = path.join(dir, lang, 'cmpSettingsC.json');
    if (!fs.existsSync(file)) continue;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of used) {
      const val = key.split('.').reduce((o, k) => (o == null ? o : o[k]), json);
      assert.ok(typeof val === 'string' && val.trim(),
        `${lang}/cmpSettingsC.json is missing ${key}`);
    }
  }
});
