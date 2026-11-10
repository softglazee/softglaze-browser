'use strict';
// WEPROXY connector, v1 (SPEC-weproxy.md section 3): no customer API, so one rotating login is built on
// the published gateway gw.weproxy.com.tr:8989 from the panel's proxy user, with the package, country
// and city in the username (the published sample USER-package-residential-country-de-city-berlin).
// State, Sticky session and Keep same IP are refused until WEPROXY publishes those tokens. No test
// reaches WEPROXY and no real credential is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');
const pa = require('../src/main/providerAccount');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lang, 'cmpSettingsC.json'), 'utf8'));

const between = (from, to) => {
  const a = IPC.indexOf(from);
  const b = IPC.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `section ${from} .. ${to} must exist`);
  return IPC.slice(a, b);
};
const fnSrc = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};
const SECTION = between('// ---- WEPROXY (Premium Rotating Residential', '// ---- IPFoxy (rotating residential');
// eslint-disable-next-line no-new-func
const fetchWeProxyPool = new Function(
  'weProxyBaseUser', 'weProxyUsername',
  `${['normCountryCode', 'gatewayOverride'].map(fnSrc).join('\n')}\n${SECTION}\nreturn fetchWeProxyPool;`
)(U.weProxyBaseUser, U.weProxyUsername);

const base = { username: 'wpuser123', password: 'TEST-pass-0000' };

// ---- The username ----

test('the username: the package, then the country in lower case and the city without spaces', () => {
  assert.equal(U.weProxyUsername('wpuser123', {}), 'wpuser123-package-residential');
  assert.equal(U.weProxyUsername('wpuser123', { country: 'DE', city: 'Berlin' }), 'wpuser123-package-residential-country-de-city-berlin', 'the published sample');
  assert.equal(U.weProxyUsername('wpuser123', { country: 'us', city: 'New York' }), 'wpuser123-package-residential-country-us-city-newyork');
  assert.equal(U.weProxyUsername('wpuser123', { country: 'US', city: 'Winston-Salem' }), 'wpuser123-package-residential-country-us-city-winstonsalem', 'a dash cannot split the username');
  assert.equal(U.weProxyUsername('wpuser123', { country: 'USA' }), 'wpuser123-package-residential', 'only a two-letter code');
  // A login pasted with its targeting is cut at -package-, so the form decides the targeting.
  assert.equal(U.weProxyBaseUser(' wpuser123-package-residential-country-fr-city-paris '), 'wpuser123');
  assert.equal(U.weProxyBaseUser('wpuser123-PACKAGE-mobile'), 'wpuser123');
  assert.equal(U.weProxyUsername('wpuser123-package-residential-country-fr', { country: 'DE' }), 'wpuser123-package-residential-country-de');
});

// ---- The pull ----

test('a pull adds one rotating proxy on gw.weproxy.com.tr:8989, HTTP or SOCKS5 on the same port', async () => {
  const rows = await fetchWeProxyPool({ ...base, country: 'US', city: 'New York', count: '5' });
  assert.deepEqual(rows, [{
    type: 'HTTP', host: 'gw.weproxy.com.tr', port: 8989,
    username: 'wpuser123-package-residential-country-us-city-newyork', password: 'TEST-pass-0000',
    label: 'WEPROXY • Premium Residential • US • rotating', country: 'US', dedupeOnPassword: true
  }], 'one row even when How many says more: v1 is rotating only');
  const socks = await fetchWeProxyPool({ ...base, proxyType: 'socks5' });
  assert.equal(socks.length, 1);
  assert.deepEqual([socks[0].type, socks[0].port, socks[0].country, socks[0].label], ['SOCKS5', 8989, null, 'WEPROXY • Premium Residential • Any country • rotating']);
  const over = await fetchWeProxyPool({ ...base, host: 'gw2.weproxy.example', port: '443' });
  assert.deepEqual([over[0].host, over[0].port], ['gw2.weproxy.example', 443], 'the host and port override');
  await assert.rejects(fetchWeProxyPool({ ...base, host: 'http://gw.weproxy.com.tr:8989' }), /WEPROXY: the gateway host must be a hostname/);
});

test('the spec\'s refusals: a login email or a malformed user, an empty password, State, session or Keep same IP', async () => {
  const userMsg = /WEPROXY: enter the proxy username from the WEPROXY panel, not your login email\.$/;
  for (const username of ['', '   ', 'me@example.com', 'user name', 'user:pass']) {
    await assert.rejects(fetchWeProxyPool({ ...base, username }), userMsg, JSON.stringify(username));
  }
  await assert.rejects(fetchWeProxyPool({ ...base, password: '' }), /WEPROXY: enter the proxy password from the panel\.$/);
  const sticky = /WEPROXY has not published how to target a state or keep a sticky IP yet\. Leave State, Sticky session and Keep same IP empty\.$/;
  await assert.rejects(fetchWeProxyPool({ ...base, state: 'California' }), sticky);
  await assert.rejects(fetchWeProxyPool({ ...base, session: 'abc' }), sticky);
  await assert.rejects(fetchWeProxyPool({ ...base, life: '30' }), sticky);
  assert.equal((await fetchWeProxyPool({ ...base, life: '' })).length, 1, 'Keep same IP blank is fine');
});

// ---- Wiring and strings ----

test('WEPROXY is wired: registry, adapter, dashboard link and the v1 PROVIDERS entry', () => {
  assert.match(IPC, /\n {2}weproxy: 'WEPROXY',\r?\n/);
  assert.match(IPC, /\n {2}weproxy: fetchWeProxyPool\r?\n\}\);/);
  assert.match(IPC, /const WEPROXY_GATEWAY = Object\.freeze\(\{ host: 'gw\.weproxy\.com\.tr', port: 8989 \}\);/);
  assert.equal(pa.dashboardUrlFor('weproxy'), 'https://my.weproxy.io/');
  assert.equal(pa.accountAdapterFor('weproxy'), null, 'no account API');
  const line = UI.split(/\r?\n/).find((l) => l.startsWith("  { key: 'weproxy', "));
  assert.ok(line, 'PROVIDERS entry');
  assert.match(line, /name: 'WEPROXY', initials: 'WP', color: '#e11d48', referral: 'https:\/\/weproxy\.io\/', gateway: \{ host: 'gw\.weproxy\.com\.tr', port: 8989, type: 'HTTP' \}/);
  assert.match(line, /geoSync: \{ creds: \['username', 'password'\], geo: true, noSession: true, proto: true, gateway: true \} \}/);
  // v1: no How many (one rotating proxy per pull), no Sticky session, no Keep same IP.
  assert.doesNotMatch(line, /count: true|session: true|life: true/);
});

test('the WEPROXY hint exists in English and Spanish, as the spec words it', () => {
  const en = locale('en').proxyProviders.geoHints.weproxy;
  const es = locale('es').proxyProviders.geoHints.weproxy;
  assert.match(en, /^WEPROXY has no customer API, so the app builds the login on its gateway, gw\.weproxy\.com\.tr:8989,/);
  assert.match(en, /Each pull adds one rotating proxy with a new IP on every request\. Sticky IPs are not available in the app yet\./);
  assert.match(es, /^WEPROXY no tiene API para clientes,/);
  assert.match(es, /Cada extracción añade un proxy rotativo con una IP nueva en cada petición\./);
  for (const h of [en, es]) assert.doesNotMatch(h, /[–—]|Softglaze/);
});
