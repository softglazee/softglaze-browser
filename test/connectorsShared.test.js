'use strict';
// Shared connector fixes (1.0.27 backlog 9, 11, 34, 35, 36, 39, 44, 47, 49, 56, 63, 76, 77, 79 and the
// rotate hook new connectors use). Vendor answers are fixtures built from the documented shapes; no
// test reaches a provider.
//
// The adapters live in ipcHandlers.js, which pulls in electron, so the tests lift the vendor sections
// out of the file and run them with a stubbed transport.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'pages', 'ProxyProvidersPage.jsx'), 'utf8');
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lang, 'cmpSettingsC.json'), 'utf8'));
const LOCALES = { en: locale('en'), es: locale('es') };
const pull = () => import('../src/renderer/lib/gatewayPull.mjs');

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

// The gateway vendors, with the shared helpers, against a stubbed transport.
const CORE = between('function normCountryCode(', '// ---- Apify Residential');
const SECTIONS = [
  between('// anyip.io: one gateway', '// ---- ShopSocks5'),
  between('// ---- NodeMaven (gateway', '// Froxy (SOAX reseller'),
  between('// ---- CatProxies ----', '// Fixed-IP products are imported as a list'),
  between('// Optional host/port override', '// Proxies.sx: the X-API-Key'),
  between('// ---- Proxmint (pay-as-you-go', '// ---- Proxy302 (dynamic residential'),
  between('// ---- Databay (residential', '// ---- Proxidize (api.proxidize.com'),
  between('// ---- 2extract (residential', '// ---- Coronium (dedicated mobile')
].join('\n');
const FETCHERS = ['gatewayPullPlan', 'mintGatewayRows', 'fetchAnyIpPool', 'fetchNodeMavenPool', 'fetchCatProxiesPool', 'fetchRapidProxyPool',
  'fetchNovadaPool', 'fetchProxmintPool', 'fetchIpBurgerPool', 'fetchDatabayPool', 'fetchIpfoxyPool', 'fetchMangoProxyPool',
  'fetchTwoExtractPool', 'fetchGonzoProxyPool', 'fetchSimplyProxiesPool'];

function load() {
  const calls = [];
  const httpRequestText = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, body });
    if (url.startsWith('https://proxmint.com/api/v1/account')) {
      return JSON.stringify({ products: [{ product: 'residential', name: 'Residential', status: 'active', proxy: { host: 'gw.proxmint.example', httpPort: 823, socks5Port: 824, username: 'pm_user', password: 'pm_pass' }, bandwidth: { remainingBytes: 1e9 } }] });
    }
    if (url.startsWith('https://catproxies.com/api/v1/user/orders/')) {
      return JSON.stringify({ payload: { order: { proxy: { username: 'cpuser', password: 'cppass', bandwidth_left: 3 } } } });
    }
    if (url.endsWith('/upstream/json')) {
      // MangoProxy's ProxyUrlDto list: one ready URL per requested line.
      return JSON.stringify(Array.from({ length: body.count }, (_, i) => ({ http: `http://m-${calls.length}-${i}:pw@p2.mangoproxy.com:2334` })));
    }
    throw new Error(`no network in this test: ${url}`);
  };
  const scoped = { ...U, httpRequestText, crypto: nodeCrypto, scrubProxySecrets: (m) => m };
  const names = Object.keys(scoped);
  // eslint-disable-next-line no-new-func
  const api = new Function(...names, `${CORE}\n${SECTIONS}\nreturn { ${FETCHERS.join(', ')} };`)(...names.map((n) => scoped[n]));
  return { ...api, calls };
}

// ---- The shared rule ------------------------------------------------------------------------------

test('gatewayPullPlan: rotating only for one row with no session name and Keep same IP blank', () => {
  const { gatewayPullPlan } = load();
  assert.equal(gatewayPullPlan({ count: '1' }).sticky, false, 'Different IP each time');
  assert.equal(gatewayPullPlan({ count: '' }).sticky, false, 'a blank count is one row');
  assert.equal(gatewayPullPlan({ count: '1', life: '' }).sticky, false);
  assert.equal(gatewayPullPlan({ count: '2' }).sticky, true, 'two rotating rows would be the same login');
  assert.equal(gatewayPullPlan({ count: '1', life: '30' }).sticky, true, 'a Keep same IP time needs a session, even on one row');
  assert.equal(gatewayPullPlan({ count: '1', session: 'mine' }).sticky, true);
  assert.equal(gatewayPullPlan({ count: '1', session: '   ' }).sticky, false, 'spaces are no session name');
  assert.equal(gatewayPullPlan({ count: '1', life: '0' }).sticky, false);
});

test('the form names the same rule (gatewayPull.mjs mirrors gatewayPullPlan)', async () => {
  const { gatewayPullPlan } = load();
  const { gatewayPullIsSticky } = await pull();
  for (const count of ['', '0', '1', '2', '1000']) {
    for (const session of ['', ' ', 'abc']) {
      for (const life of ['', '0', '5', '1440']) {
        assert.equal(gatewayPullIsSticky({ count, session, life }), gatewayPullPlan({ count, session, life }).sticky, JSON.stringify({ count, session, life }));
      }
    }
  }
});

// ---- Every connector with Keep same IP: rotating, sticky by count, sticky by time -----------------

// What a sticky username of each vendor carries, and the session token that must be absent on the
// rotating row.
const VENDORS = [
  ['ipfoxy', 'fetchIpfoxyPool', { username: 'acct', password: 'pw', country: 'US' }, /-sessid-/, '30'],
  ['ipburger', 'fetchIpBurgerPool', { username: 'customer-acct', password: 'pw', country: 'US' }, /-sessid-/, '10'],
  ['novada', 'fetchNovadaPool', { username: 'nvuser', password: 'pw', country: 'US' }, /-session-/, '30'],
  ['rapidproxy', 'fetchRapidProxyPool', { username: 'sub1', password: 'pw', country: 'US' }, /-session-/, '60'],
  ['databay', 'fetchDatabayPool', { username: 'dbuser', password: 'pw', country: 'US' }, /-sessionId-/, '60'],
  ['proxmint', 'fetchProxmintPool', { token: 'pmk_abcdefgh12', country: 'US' }, /sessid\./, '60'],
  ['twoextract', 'fetchTwoExtractPool', { username: '2xt-customer-1-proxy-a', password: 'pw', country: 'US' }, /-session-/, '30'],
  ['gonzoproxy', 'fetchGonzoProxyPool', { username: 'Gz1abc', password: 'pw', country: 'US' }, /_s_/, '360'],
  ['simplyproxies', 'fetchSimplyProxiesPool', { username: 'simple1', password: 'pw' }, /-session-/, '60'],
  ['anyip', 'fetchAnyIpPool', { username: 'user_ab12', password: 'pw', country: 'US' }, /,session_/, '60'],
  ['nodemaven', 'fetchNodeMavenPool', { username: 'nm-login', password: 'pw', country: 'US' }, /-sid-/, '60'],
  ['catproxies', 'fetchCatProxiesPool', { token: 'cp_abcdefgh1234', orderId: 'abcd1234-ef', country: 'US' }, /-session-|-sid-/, '30']
];

for (const [key, fn, base, sessionToken, life] of VENDORS) {
  test(`${key}: "Different IP each time" is one rotating proxy; How many or Keep same IP makes sticky ones`, async () => {
    const a = load();
    const one = await a[fn]({ ...base, count: '1' });
    assert.equal(one.length, 1, 'one row');
    assert.doesNotMatch(one[0].username, sessionToken, 'no session: a new IP on every request');
    const many = await a[fn]({ ...base, count: '3' });
    assert.equal(many.length, 3, 'three rows');
    assert.equal(new Set(many.map((r) => r.username)).size, 3, 'each its own session');
    for (const r of many) assert.match(r.username, sessionToken);
    const kept = await a[fn]({ ...base, count: '1', life });
    assert.equal(kept.length, 1);
    assert.match(kept[0].username, sessionToken, 'Keep same IP makes even one row sticky');
    const { lifeBlankLabel } = await pull();
    assert.deepEqual(lifeBlankLabel(key, { count: '1' }), { key: 'lifeDifferent' }, 'the form says rotating for one row');
    assert.notEqual(lifeBlankLabel(key, { count: '3' }).key, 'lifeDifferent', 'and not for three');
  });
}

test('MangoProxy: one row rotates (sessionDuration 0); more rows hold 30 minutes unless Keep same IP is set', async () => {
  const a = load();
  await a.fetchMangoProxyPool({ token: 'mk1', username: 'sub1', count: '1' });
  await a.fetchMangoProxyPool({ token: 'mk1', username: 'sub1', count: '3' });
  await a.fetchMangoProxyPool({ token: 'mk1', username: 'sub1', count: '1', life: '60' });
  assert.deepEqual(a.calls.map((c) => c.body.sessionDuration), [0, 30, 60]);
  const { lifeBlankLabel } = await pull();
  assert.deepEqual(lifeBlankLabel('mangoproxy', { count: '1' }), { key: 'lifeDifferent' });
  assert.deepEqual(lifeBlankLabel('mangoproxy', { count: '3' }), { key: 'lifeDefaultTime', minutes: 30 });
});

test('the blank Keep same IP option names the time main actually sends or the vendor documents', async () => {
  const a = load();
  const { lifeBlankLabel } = await pull();
  const def = (key) => lifeBlankLabel(key, { count: '3' });
  // What main writes into the username with Keep same IP blank.
  assert.match((await a.fetchNovadaPool({ username: 'n', password: 'p', count: '3' }))[0].username, /-sessTime-10$/);
  assert.deepEqual(def('novada'), { key: 'lifeDefaultTime', minutes: 10 });
  assert.match((await a.fetchDatabayPool({ username: 'd', password: 'p', count: '3' }))[0].username, /-sessionLength-30$/);
  assert.deepEqual(def('databay'), { key: 'lifeDefaultTime', minutes: 30 });
  assert.match((await a.fetchIpBurgerPool({ username: 'customer-x', password: 'p', count: '3' }))[0].username, /-sesstime-30$/);
  assert.deepEqual(def('ipburger'), { key: 'lifeDefaultTime', minutes: 30 });
  assert.match((await a.fetchProxmintPool({ token: 'pmk_abcdefgh12', count: '3' }))[0].username, /sessttl\.30$/);
  assert.deepEqual(def('proxmint'), { key: 'lifeDefaultTime', minutes: 30 });
  assert.match((await a.fetchGonzoProxyPool({ username: 'Gz1', password: 'p', country: 'US', count: '3' }))[0].username, /_ttl_72h$/);
  assert.deepEqual(def('gonzoproxy'), { key: 'lifeDefaultTime', minutes: 4320 });
  assert.match((await a.fetchCatProxiesPool({ token: 'cp_abcdefgh1234', orderId: 'abcd1234-ef', count: '3' }))[0].username, /lifetime-30|30m/);
  assert.deepEqual(def('catproxies'), { key: 'lifeDefaultTime', minutes: 30 });
  // Vendor defaults, from their docs: no lifetime is sent.
  const anyip = (await a.fetchAnyIpPool({ username: 'user_1', password: 'p', count: '3' }))[0].username;
  assert.doesNotMatch(anyip, /sesstime_/);
  assert.deepEqual(def('anyip'), { key: 'lifeDefaultTime', minutes: 10080 }, 'AnyIP keeps a session 7 days');
  assert.doesNotMatch((await a.fetchNodeMavenPool({ username: 'nm', password: 'p', count: '3' }))[0].username, /-ttl-/);
  assert.deepEqual(def('nodemaven'), { key: 'lifeDefaultUpTo', minutes: 1440 }, 'NodeMaven holds as long as it can, up to 24 hours');
  assert.doesNotMatch((await a.fetchIpfoxyPool({ username: 'x', password: 'p', count: '3' }))[0].username, /-ttl-/);
  assert.deepEqual(def('ipfoxy'), { key: 'lifeDefaultTime', minutes: 30 });
  assert.doesNotMatch((await a.fetchTwoExtractPool({ username: '2xt-customer-1-proxy-a', password: 'p', count: '3' }))[0].username, /-time-/);
  assert.deepEqual(def('twoextract'), { key: 'lifeDefaultTime', minutes: 10 });
  assert.deepEqual(def('simplyproxies'), { key: 'lifeDefaultTime', minutes: 120 });
  assert.doesNotMatch((await a.fetchRapidProxyPool({ username: 's', password: 'p', count: '3' }))[0].username, /-stime-/);
  assert.deepEqual(def('rapidproxy'), { key: 'lifeProviderDefault' }, 'RapidProxy documents no default');
  assert.deepEqual(lifeBlankLabel('proxy302', { count: '3' }), { key: 'lifeDifferent' }, 'Proxy302 buys one rotating proxy per row');
});

test('a session name typed on one row is still one sticky row; AnyIP drops a pasted session when rotating', async () => {
  const a = load();
  const named = await a.fetchAnyIpPool({ username: 'user_1', password: 'p', session: 'fixed1', count: '5' });
  assert.equal(named.length, 1, 'a fixed AnyIP session pins one IP');
  assert.match(named[0].username, /session_fixed1$/);
  const pasted = await a.fetchAnyIpPool({ username: 'user_1,session_old,sesstime_30', password: 'p', count: '1' });
  assert.equal(pasted[0].username, 'user_1,type_residential', 'the rotating row keeps neither the pasted session nor its time');
  const nm = await a.fetchNodeMavenPool({ username: 'nm', password: 'p', session: 'abc', count: '1' });
  // NodeMaven rows also carry the default quality filter and IPv4 only (1.0.27 backlog 31).
  assert.match(nm[0].username, /-sid-abc-filter-medium-ipv4-true$/);
});

// ---- The form: every Keep same IP connector, its options and its texts ----------------------------

const providerLine = (key) => {
  const line = UI.split(/\r?\n/).find((l) => l.includes(`{ key: '${key}',`));
  assert.ok(line, `${key} must be a PROVIDERS entry`);
  return line;
};
const PROVIDER_KEYS = [...UI.matchAll(/^\s*\{ key: '([a-z0-9]+)',/gm)].map((m) => m[1]);

test('every connector with Keep same IP has a blank-option default, and nothing else does', async () => {
  const { LIFE_BLANK_DEFAULTS } = await pull();
  // DataImpulse has its own form, with its own "Default (30 minutes)" option.
  const withLife = PROVIDER_KEYS.filter((k) => /geoSync: \{.*\blife: true/.test(providerLine(k)) && !/\bdi: true/.test(providerLine(k)));
  assert.ok(withLife.length >= 14, 'the gateway connectors');
  assert.deepEqual(Object.keys(LIFE_BLANK_DEFAULTS).sort(), withLife.sort());
});

test('Keep same IP offers the vendor maximum, past 24 hours where the vendor allows it', async () => {
  const { lifeOptionsFor, LIFE_OPTIONS } = await pull();
  assert.deepEqual(lifeOptionsFor({}), [5, 10, 30, 60, 120, 360, 720, 1440], 'unset: up to 24 hours');
  assert.deepEqual(lifeOptionsFor({ maxLife: 120 }), [5, 10, 30, 60, 120]);
  assert.deepEqual(lifeOptionsFor({ maxLife: 10080 }), LIFE_OPTIONS.slice());
  assert.deepEqual(lifeOptionsFor({ lifeOptions: [30, 60] }), [30, 60], 'a vendor list wins');
  for (const key of ['anyip', 'gonzoproxy']) assert.match(providerLine(key), /maxLife: 10080/, `${key} sessions run up to 7 days`);
  for (const lang of ['en', 'es']) {
    const geo = LOCALES[lang].proxyProviders.geo;
    for (const m of LIFE_OPTIONS) assert.equal(typeof geo[`life${m}`], 'string', `${lang} life${m}`);
    assert.doesNotMatch(geo.life1440, /max/i, `${lang}: 24 hours is not every vendor's maximum`);
  }
});

test('the blank option texts exist in English and Spanish, for every default time', async () => {
  const { LIFE_BLANK_DEFAULTS } = await pull();
  for (const lang of ['en', 'es']) {
    const geo = LOCALES[lang].proxyProviders.geo;
    for (const k of ['lifeDifferent', 'lifeDefaultTime', 'lifeDefaultUpTo', 'lifeProviderDefault']) assert.equal(typeof geo[k], 'string', `${lang} ${k}`);
    assert.match(geo.lifeDefaultTime, /\{\{time\}\}/);
    assert.match(geo.lifeDefaultUpTo, /\{\{time\}\}/);
    for (const v of Object.values(LIFE_BLANK_DEFAULTS)) {
      const m = v && typeof v === 'object' ? v.upTo : v;
      if (Number(m) > 0) assert.equal(typeof geo[`life${m}`], 'string', `${lang} life${m}`);
    }
  }
  assert.match(UI, /const lifeBlank = lifeBlankLabel\(provider\.key, \{ count: form\.count, session: showSession \? form\.session : '' \}\);/);
  assert.match(UI, /<option value="">\{lifeBlankText\}<\/option>/);
});

// ---- Credential labels, optional fields ------------------------------------------------------------

test('credential fields use each vendor\'s own name; "(sub-account)" only where the vendor has sub-accounts', () => {
  const want = {
    proxy302: { username: 'apiKeyIdLabel', password: 'apiKeySecretLabel' },
    mangoproxy: { token: 'apiKeyLabel', username: 'usernameSubLabel' },
    rapidproxy: { username: 'usernameSubLabel' },
    marsproxies: { username: 'subUserLabel', password: 'subUserPasswordLabel' },
    packetstream: { password: 'authKeyLabel' },
    proxysolutions: { token: 'integrationTokenLabel' },
    coronium: { token: 'apiKeyLabel' },
    singaporemobileproxy: { token: 'apiKeyLabel' },
    proxybonanza: { token: 'apiKeyLabel' },
    proxy6: { token: 'apiKeyLabel' }
  };
  for (const [key, labels] of Object.entries(want)) {
    const src = `labels: { ${Object.entries(labels).map(([f, k]) => `${f}: '${k}'`).join(', ')} }`;
    assert.ok(providerLine(key).includes(src), `${key}: ${src}`);
  }
  for (const key of ['proxidize', 'liveproxies', 'froxy', 'simplyproxies']) {
    assert.doesNotMatch(providerLine(key), /usernameSubLabel/, `${key} has no sub-accounts`);
  }
  assert.match(UI, /credLabel\('username', 'usernameLabel'\)/, 'the shared username label is plain "Proxy username"');
  assert.match(UI, /credLabel\('token', 'apiTokenLabel'\)/);
  assert.match(UI, /credLabel\('password', 'proxyPasswordLabel'\)/);
  for (const lang of ['en', 'es']) {
    const geo = LOCALES[lang].proxyProviders.geo;
    for (const k of ['usernameLabel', 'usernameSubLabel', 'subUserLabel', 'subUserPasswordLabel', 'apiKeyIdLabel', 'apiKeySecretLabel', 'authKeyLabel',
      'apiKeyLabel', 'apiKeyPlaceholder', 'integrationTokenLabel', 'integrationTokenPlaceholder']) assert.equal(typeof geo[k], 'string', `${lang} ${k}`);
  }
  assert.equal(LOCALES.en.proxyProviders.geo.usernameLabel, 'Proxy username');
  assert.equal(LOCALES.en.proxyProviders.geo.apiKeyLabel, 'API key');
});

test('a username the vendor allows blank is not required: MangoProxy sub-account, Proxidize Per GB', () => {
  for (const key of ['mangoproxy', 'proxidize']) assert.match(providerLine(key), /optional: \['username'\]/, key);
  const geo = UI.slice(UI.indexOf('async function handleGeoSync'), UI.indexOf('async function handleLookup'));
  assert.match(geo, /if \(creds\.includes\('username'\) && !optional\.includes\('username'\) && !form\.username\.trim\(\)\)/);
  // Proxidize: an empty username is the Per GB branch.
  assert.match(fnSrc('fetchProxidizePool'), /username/);
});

// ---- Saved credentials -------------------------------------------------------------------------------

function credStore(initial = {}) {
  let map = JSON.parse(JSON.stringify(initial));
  const src = [
    /const PROXY_CRED_SECRET_FIELDS = [^\n]*/.exec(IPC)[0],
    /const PROXY_CRED_PLAIN_FIELDS = [^\n]*/.exec(IPC)[0],
    /const PROXY_CRED_KEY_FIELDS = [^\n]*/.exec(IPC)[0],
    ...['hasProxyProviderKey', 'readProxyProviderCredMap', 'readSavedProviderCreds', 'getProxyProviderCreds', 'saveProxyProviderCreds'].map(fnSrc)
  ].join('\n');
  const deps = {
    requireOwnerOrSuper: async () => {},
    requireObject: (v) => v,
    requiredString: (v) => String(v),
    readSetting: async () => JSON.parse(JSON.stringify(map)),
    writeSetting: async (_k, v) => { map = JSON.parse(JSON.stringify(v)); },
    secretStore: { seal: (v) => `sealed:${v}`, open: (v) => String(v).replace(/^sealed:/, '') }
  };
  // eslint-disable-next-line no-new-func
  const fns = new Function(...Object.keys(deps), `${src}\nreturn { readSavedProviderCreds, getProxyProviderCreds, saveProxyProviderCreds };`)(...Object.values(deps));
  return { ...fns, map: () => map };
}

test('clearing every key and login removes the saved entry, so the provider is not "Connected"', async () => {
  const s = credStore();
  assert.deepEqual(await s.saveProxyProviderCreds({ provider: 'coronium', token: 'k1' }), { ok: true, saved: true });
  assert.equal((await s.getProxyProviderCreds({ provider: 'coronium' })).found, true);
  const r = await s.saveProxyProviderCreds({ provider: 'coronium', username: '', password: '', token: '', apiToken: '', apiUrl: '', host: '', port: '' });
  assert.deepEqual(r, { ok: true, saved: false });
  assert.equal(Object.prototype.hasOwnProperty.call(s.map(), 'coronium'), false, 'no empty entry is kept');
  assert.deepEqual(await s.getProxyProviderCreds({ provider: 'coronium' }), { found: false });
});

test('an empty or host-only entry saved by an older build counts as nothing saved', async () => {
  const s = credStore({ froxy: {}, novada: { host: 'super.novada.pro', port: '7777' } });
  assert.deepEqual(await s.getProxyProviderCreds({ provider: 'froxy' }), { found: false });
  assert.deepEqual(await s.getProxyProviderCreds({ provider: 'novada' }), { found: false });
  assert.equal(await s.readSavedProviderCreds('novada'), null);
});

test('the AnyIP Team ID and the Protocol / Proxy type select survive a restart', async () => {
  const s = credStore();
  await s.saveProxyProviderCreds({ provider: 'anyip', token: 'key', teamId: 'team-7', proxyType: 'socks5' });
  await s.saveProxyProviderCreds({ provider: 'shopsocks5', username: 'me', token: 't', proxyType: 'proxy_https' });
  const anyip = await s.getProxyProviderCreds({ provider: 'anyip' });
  assert.deepEqual([anyip.token, anyip.teamId, anyip.proxyType], ['key', 'team-7', 'socks5']);
  assert.equal((await s.getProxyProviderCreds({ provider: 'shopsocks5' })).proxyType, 'proxy_https');
  assert.equal(s.map().anyip.token, 'sealed:key', 'the key stays sealed at rest');
  // The form sends and restores both.
  assert.equal((UI.match(/teamId: form\.teamId, proxyType: form\.proxyType/g) || []).length, 2, 'persistCreds and handleSaveCreds');
  assert.match(UI, /\.\.\.\(c\.teamId != null \? \{ teamId: c\.teamId \} : \{\}\)/);
  assert.match(UI, /\.\.\.\(c\.proxyType != null \? \{ proxyType: c\.proxyType \} : \{\}\)/);
});

test('saving refreshes the provider state on the page, and says when the saved credentials were removed', () => {
  const save = UI.slice(UI.indexOf('async function handleSaveCreds'), UI.indexOf('async function handleCheck'));
  assert.match(save, /setCredsSaved\(r && r\.saved === false \? 'cleared' : 'saved'\)/);
  assert.match(save, /onCredsChanged\(provider\.key\)/);
  assert.match(PAGE, /onCredsChanged=\{load\}/);
  for (const lang of ['en', 'es']) assert.equal(typeof LOCALES[lang].proxyProviders.creds.cleared, 'string');
});

// ---- Provider-API rotation hook ------------------------------------------------------------------------

test('rotateProxyIp runs a vendor API rotator from PROVIDER_ROTATORS when the proxy has no link', () => {
  const rotate = fnSrc('rotateProxyIp');
  assert.match(rotate, /const apiVendor = rotationUrl \? '' : apiRotationProvider\(proxy\);/, 'a stored or provided link still wins');
  assert.match(rotate, /await PROVIDER_ROTATORS\[apiVendor\]\(proxy\)/);
  assert.match(rotate, /timeout: rotationLinkTimeoutMs\(proxy\)/);
  assert.match(IPC, /const PROVIDER_ROTATORS = Object\.freeze\(\{\r?\n  dataimpulse: rotateDataImpulseSticky/);
  assert.match(fnSrc('serializeProxy'), /canRotate: proxyCanRotate\(proxy\)/);
});

test('canRotate and the link timeout follow the stored row', () => {
  const deps = { ROTATION_LINK_TIMEOUT_MS: { slowvendor: 65000 } };
  const src = ['isDataImpulseSticky', 'apiRotationProvider', 'proxyCanRotate', 'rotationLinkTimeoutMs'].map(fnSrc).join('\n');
  // eslint-disable-next-line no-new-func
  const f = new Function(...Object.keys(deps), `${src}\nreturn { apiRotationProvider, proxyCanRotate, rotationLinkTimeoutMs };`)(...Object.values(deps));
  const di = { provider: 'dataimpulse', host: 'gw.dataimpulse.com', port: 10001, username: 'u', password: 'p' };
  assert.equal(f.apiRotationProvider(di), 'dataimpulse');
  assert.equal(f.proxyCanRotate(di), true);
  assert.equal(f.proxyCanRotate({ ...di, port: 823 }), false, 'the rotating gateway has nothing to reset');
  assert.equal(f.proxyCanRotate({ provider: 'x', rotationUrl: 'https://r.example/x' }), true);
  assert.equal(f.proxyCanRotate(null), false);
  assert.equal(f.rotationLinkTimeoutMs({ provider: 'SlowVendor' }), 65000);
  assert.equal(f.rotationLinkTimeoutMs({ provider: 'other' }), 20000, 'the default stays 20 seconds');
});

test('a rotator reads the account key from the saved credentials, main-only', async () => {
  const s = credStore();
  await s.saveProxyProviderCreds({ provider: 'somevendor', token: 'acct-key', username: 'u1' });
  assert.deepEqual(await s.readSavedProviderCreds('SomeVendor'), { username: 'u1', token: 'acct-key' });
  assert.equal(await s.readSavedProviderCreds('nothing'), null);
  assert.doesNotMatch(fnSrc('readSavedProviderCreds'), /requireOwnerOrSuper/, 'main calls it for a member who may rotate');
  assert.doesNotMatch(IPC, /readSavedProviderCreds[^\n]*rotationUrl/, 'a key never goes into a rotation link');
});

// ---- Dashboard links and the product name ----------------------------------------------------------------

test('Dashboard buttons carry the owner\'s live affiliate links, and no made-up ref parameter', () => {
  assert.doesNotMatch(UI, /ref=softglaze|fpr=softglaze/);
  const live = {
    dataimpulse: 'https://dataimpulse.com/?aff=e2951081-05fc-4c8e-946b-d92baee174c1',
    proxy302: 'https://proxy302.com/register?ref=0abaab08fed00be49a',
    ipburger: 'https://secure.ipburger.com/aff.php?aff=3283',
    froxy: 'https://froxy.com/?fpr=qwsg97',
    proxidize: 'https://proxidize.com/get/23265/'
  };
  for (const [key, url] of Object.entries(live)) assert.ok(providerLine(key).includes(`referral: '${url}'`), key);
  const plain = { ipfoxy: 'https://app.ipfoxy.com/', brightdata: 'https://brightdata.com/', oxylabs: 'https://oxylabs.io/', smartproxy: 'https://dashboard.decodo.com/',
    mangoproxy: 'https://my.mangoproxy.com/', shopsocks5: 'https://shopsocks5.com/', apify: 'https://apify.com/', anyip: 'https://anyip.io/account',
    marsproxies: 'https://dashboard.marsproxies.com/', nodemaven: 'https://nodemaven.com/' };
  for (const [key, url] of Object.entries(plain)) assert.ok(providerLine(key).includes(`referral: '${url}'`), key);
  assert.doesNotMatch(UI, /TODO: replace the \?ref=softglaze/);
});

test('"SoftGlaze" is spelled with a capital G in the connector texts', () => {
  for (const lang of ['en', 'es']) {
    const raw = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lang, 'cmpSettingsC.json'), 'utf8');
    assert.doesNotMatch(raw, /Softglaze/, lang);
    assert.match(LOCALES[lang].proxyProviders.result.syncedInto, /SoftGlaze Provider Core/);
  }
});
