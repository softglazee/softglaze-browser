'use strict';
// SimplyNode connector. Fixtures follow the OpenAPI 3.1 file SimplyNode emailed on 2026-11-02
// (Subaccount, GetProxyStringRequest, targets and session:reset). The file does not document the
// generated proxy string, so the strings are the two gateway formats on SimplyNode's public pages,
// with placeholder logins. Never checked against a live account; no test reaches SimplyNode.
const test = require('node:test');
const assert = require('node:assert/strict');
const { IPC, UI, LOCALES, U, between, fnSrc, httpError, load, loadRotation, providerLine } = require('./helpers/connectorHarness');
const pa = require('../src/main/providerAccount');

const KEY = 'sn-test-key-0123456789abcdef';
const gb = (value) => ({ unit: 'GB', value });
const SUB = { subaccountLogin: 'm123qWerTy', status: 'active', productType: 'residential', rotation: 0, whitelistedIps: [], trafficOverall: gb(10), trafficSpent: gb(2), trafficAvailable: gb(8), trafficOverspent: gb(0), createdAt: '2026-11-02T00:00:00Z' };
const EMPTY = { ...SUB, subaccountLogin: 'm000Empty1', trafficAvailable: gb(0), trafficSpent: gb(10) };
// Port format (help centre): one sticky session per port; flag format (FAQ): flags in the password.
const portForm = (i) => `m123qWerTy:wifi;us;;;@proxy.simplynode.io:${9000 + i}`;
const flagForm = (i) => `http://m123qWerTy:country-us-session-s${i}-ttl-1800@ip.simplynode.io:9003`;

const section = { from: '// ---- SimplyNode (residential', to: '// Vendors wired to live API calls', names: ['fetchSimplyNodePool', 'lookupSimplyNode', 'rotateSimplyNodeSession'] };
const router = ({ items = [SUB], next = null, form = flagForm, sticky = true, extra = {} } = {}) => {
  let n = 0;
  return (call) => {
    for (const [prefix, fn] of Object.entries(extra)) if (call.url.startsWith(prefix)) return fn(call);
    if (call.url.startsWith('https://app.simplynode.io/api/subaccounts?')) return { count: items.length, prevToken: null, nextToken: next, items };
    if (call.url === 'https://app.simplynode.io/api/proxy') { n += 1; return { 'proxy-string': form(sticky ? n : 0) }; }
    throw new Error(`no route for ${call.url}`);
  };
};
const posts = (p) => p.calls.filter((c) => c.url.endsWith('/api/proxy')).map((c) => JSON.parse(c.body));

test('the request body: rotating is sticky false with ttl 0; sticky holds minutes as seconds; places lowercase', () => {
  assert.deepEqual(U.simplyNodeProxyBody({ login: 'm1' }), { login: 'm1', auth: 'login', protocol: 'http', sticky: false, ttl: 0 });
  assert.deepEqual(U.simplyNodeProxyBody({ login: 'm1', socks: true, country: 'US', region: 'CA', city: 'Abbot  Village', sticky: true, ttlMin: 30 }),
    { login: 'm1', auth: 'login', protocol: 'socks5', country: 'us', region: 'ca', city: 'abbot village', sticky: true, ttl: 1800 });
  assert.deepEqual(Object.keys(U.simplyNodeProxyBody({ login: 'm1', region: 'ca', city: 'x' })), ['login', 'auth', 'protocol', 'sticky', 'ttl'], 'no region or city without a country');
});

test('the first sub-account with traffic is picked; an empty or plainly off one is skipped', () => {
  assert.equal(U.simplyNodeSubaccountPick([EMPTY, { ...SUB, status: 'disabled' }, SUB]), SUB);
  assert.equal(U.simplyNodeSubaccountPick([EMPTY]), null);
  assert.equal(U.simplyNodeSubaccountPick([{ ...SUB, subaccountLogin: '../x' }]), null);
});

test('the country list keeps SimplyNode\'s own codes (uk, not gb); a UK row is stored as GB', () => {
  assert.deepEqual(U.simplyNodeCountries({ items: [{ code: 'us', name: 'United States' }, { code: 'uk', name: 'United Kingdom' }] }), [{ key: 'US', label: 'United States' }, { key: 'UK', label: 'United Kingdom' }]);
  const r = U.simplyNodeRow(flagForm(1), { country: 'UK', kind: 'Core', index: 1, sticky: true }).row;
  assert.deepEqual([r.country, r.label, r.dedupeOnPassword], ['GB', 'SimplyNode • Core • GB • #1', true]);
  assert.equal(U.simplyNodeRow('http://u:p@evil.example:80').reason, 'host');
});

test('no login typed: the pool\'s sub-accounts are listed (x-api-key header), the first with traffic is used', async () => {
  const p = load({ ...section, route: router({ items: [EMPTY, SUB] }) });
  const rows = await p.fetchSimplyNodePool({ token: KEY, poolType: 'residential_core', count: '1' });
  assert.equal(rows.length, 1);
  assert.equal(p.calls[0].url, 'https://app.simplynode.io/api/subaccounts?product_type=residential&limit=50&solution=core');
  assert.ok(p.calls.every((c) => c.headers['x-api-key'] === KEY && !c.url.includes(KEY)), 'the key is a header, never in a URL');
  assert.equal(posts(p)[0].login, 'm123qWerTy');
  const mob = load({ ...section, route: router({ items: [{ ...SUB, productType: 'mobile' }] }) });
  const m = await mob.fetchSimplyNodePool({ token: KEY, poolType: 'mobile', count: '1' });
  assert.equal(mob.calls[0].url, 'https://app.simplynode.io/api/subaccounts?product_type=mobile&limit=50', 'Mobile has no solution filter');
  assert.match(m[0].label, /^SimplyNode • Mobile • /);
  const paged = load({ ...section, route: (call) => {
    if (call.url.includes('next_token=t2')) return { items: [SUB], nextToken: null };
    if (call.url.includes('/subaccounts?')) return { items: [EMPTY], nextToken: 't2' };
    return { 'proxy-string': flagForm(1) };
  } });
  await paged.fetchSimplyNodePool({ token: KEY, count: '1' });
  assert.match(paged.calls[1].url, /&next_token=t2$/);
});

test('a typed login is read directly; a wrong one says so', async () => {
  const p = load({ ...section, route: router({ extra: { 'https://app.simplynode.io/api/subaccounts/m123qWerTy': () => SUB } }) });
  await p.fetchSimplyNodePool({ token: KEY, username: 'm123qWerTy', count: '1' });
  assert.equal(p.calls[0].url, 'https://app.simplynode.io/api/subaccounts/m123qWerTy');
  const miss = load({ ...section, route: () => { throw httpError(404, '{}'); } });
  await assert.rejects(miss.fetchSimplyNodePool({ token: KEY, username: 'm999' }), /no sub-account with that login\. Copy it again from the dashboard, or leave it empty\./);
  const other = load({ ...section, route: () => { throw httpError(403, '{}'); } });
  await assert.rejects(other.fetchSimplyNodePool({ token: KEY, username: 'm999' }), /that sub-account does not belong to this API key's account/);
  await assert.rejects(load({ ...section, route: router() }).fetchSimplyNodePool({ token: KEY, username: 'm1/../x' }), /that is not a sub-account login/);
});

test('How many and Keep same IP: one rotating proxy, or sticky ones held 30 minutes (blank) up to 60', async () => {
  const one = load({ ...section, route: router({ sticky: false }) });
  const r1 = await one.fetchSimplyNodePool({ token: KEY, count: '1', life: '' });
  assert.match(r1[0].label, /rotating$/);
  assert.deepEqual(posts(one).map((b) => [b.sticky, b.ttl]), [[false, 0]]);
  const five = load({ ...section, route: router() });
  const r5 = await five.fetchSimplyNodePool({ token: KEY, country: 'us', state: 'California', city: 'Los Angeles', count: '5', proxyType: 'socks5' });
  assert.equal(r5.length, 5);
  assert.ok(r5.every((r) => r.type === 'SOCKS5' && r.country === 'US'));
  assert.deepEqual(posts(five)[0], { login: 'm123qWerTy', auth: 'login', protocol: 'socks5', country: 'us', region: 'california', city: 'los angeles', sticky: true, ttl: 1800 });
  const held = load({ ...section, route: router() });
  await held.fetchSimplyNodePool({ token: KEY, count: '1', life: '60' });
  assert.deepEqual(posts(held).map((b) => [b.sticky, b.ttl]), [[true, 3600]], 'a Keep same IP time makes one row sticky');
  const capped = load({ ...section, route: router() });
  await capped.fetchSimplyNodePool({ token: KEY, count: '2', life: '360' });
  assert.ok(posts(capped).every((b) => b.ttl === 3600), 'ttl stops at 60 minutes until SimplyNode confirms more');
  const max = load({ ...section, route: router() });
  assert.equal((await max.fetchSimplyNodePool({ token: KEY, count: '999' })).length, 50);
});

test('both published gateway formats import; the port format keeps its semicolon password', async () => {
  const p = load({ ...section, route: router({ form: portForm }) });
  const rows = await p.fetchSimplyNodePool({ token: KEY, count: '3' });
  assert.deepEqual(rows.map((r) => [r.host, r.port, r.username, r.password]), [
    ['proxy.simplynode.io', 9001, 'm123qWerTy', 'wifi;us;;;'], ['proxy.simplynode.io', 9002, 'm123qWerTy', 'wifi;us;;;'], ['proxy.simplynode.io', 9003, 'm123qWerTy', 'wifi;us;;;']]);
});

test('the pull explains every refusal and never echoes the key', async () => {
  const run = (route, args = {}) => load({ ...section, route }).fetchSimplyNodePool({ token: KEY, count: '1', ...args });
  await assert.rejects(load({ ...section, route: router() }).fetchSimplyNodePool({ token: '' }), /paste the API key from your dashboard \(profile Settings\)\./);
  await assert.rejects(run(router({ items: [EMPTY] }), { poolType: 'residential_essential' }), /no Residential Essential sub-account with traffic on this account\. Create one in the dashboard, then pull again\./);
  await assert.rejects(run(router({ extra: { 'https://app.simplynode.io/api/subaccounts/m000Empty1': () => EMPTY } }), { username: 'm000Empty1' }), /that sub-account has no traffic left, so its proxies would fail on first use\./);
  await assert.rejects(run(router({ form: () => 'proxy.simplynode.io:9000' })), /returned a proxy without a login\. Its IP whitelist mode is not supported/);
  await assert.rejects(run(router({ form: () => 'garbage' })), /returned a proxy string the app cannot read\. Send the support team the format \(without the password\)\./);
  await assert.rejects(run(router({ form: () => 'http://u:p@other.example:80' })), /not a SimplyNode host/);
  await assert.rejects(run(router(), { city: 'Paris' }), /pick a country to target a state or city/);
  const at = (status, body) => run(router({ extra: { 'https://app.simplynode.io/api/proxy': () => { throw httpError(status, body); } } }));
  await assert.rejects(at(400, { error: `Unknown city for ${KEY}` }), (e) => /SimplyNode refused the request\. Check the country, region and city \(pick the country from Load countries\)\. SimplyNode said: Unknown city for \*\*\*\./.test(e.message) && !e.message.includes(KEY));
  await assert.rejects(at(401, {}), /SimplyNode rejected the API key\. Copy it again from profile Settings in your dashboard\./);
  await assert.rejects(at(429, {}), /too many requests\. Wait a minute and pull again\./);
  await assert.rejects(at(503, KEY), (e) => /could not reach the API/.test(e.message) && !e.message.includes(KEY));
});

test('Load countries asks for the chosen pool\'s product type', async () => {
  const p = load({ ...section, route: (call) => (call.url.includes('/targets/countries') ? { items: [{ code: 'us', name: 'United States' }, { code: 'de', name: 'Germany' }] } : null) });
  const r = await p.lookupSimplyNode({ token: KEY, groupby: 'country', poolType: 'mobile' });
  assert.equal(p.calls[0].url, 'https://app.simplynode.io/api/targets/countries?product_type=mobile');
  assert.deepEqual(r.geo.map((g) => g.key), ['DE', 'US']);
  await assert.rejects(p.lookupSimplyNode({ token: KEY, groupby: 'state' }), /only the country list/);
});

test('Rotate IP: a port-format row resets its session with the saved key; other rows cannot rotate', async () => {
  const r = loadRotation();
  const row = { provider: 'simplynode', host: 'proxy.simplynode.io', port: 9001, username: 'm123qWerTy', password: 'wifi;us;;;' };
  assert.equal(r.apiRotationProvider(row), 'simplynode');
  assert.equal(r.proxyCanRotate(row), true);
  assert.equal(typeof r.PROVIDER_ROTATORS.simplynode, 'function');
  assert.equal(r.apiRotationProvider({ ...row, host: 'ip.simplynode.io', port: 9003 }), '', 'the flag format has no port session');
  assert.equal(r.apiRotationProvider({ ...row, port: 19000 }), '', 'outside the API file\'s 9000 to 18999');
  assert.equal(r.apiRotationProvider({ ...row, provider: 'froxy' }), '');
  assert.equal(U.SIMPLYNODE_RESET_PORTS.min, 9000);
  assert.equal(U.SIMPLYNODE_RESET_PORTS.max, 18999);
  const none = load({ ...section, route: () => '' });
  await assert.rejects(none.rotateSimplyNodeSession(row), /Rotate IP needs the API key saved on the Proxy providers page/);
  assert.equal(none.calls.length, 0);
  const ok = load({ ...section, saved: { simplynode: { token: KEY } }, route: () => '' });
  const res = await ok.rotateSimplyNodeSession(row);
  assert.deepEqual([res.ok, res.provider], [true, 'simplynode']);
  assert.equal(ok.calls[0].url, 'https://app.simplynode.io/api/subaccounts/m123qWerTy/session:reset?ports=9001');
  assert.equal(ok.calls[0].headers['x-api-key'], KEY);
  const gone = load({ ...section, saved: { simplynode: { token: KEY } }, route: () => { throw httpError(404, `{"error":"${KEY}"}`); } });
  await assert.rejects(gone.rotateSimplyNodeSession(row), (e) => /no sub-account with this proxy's login/.test(e.message) && !e.message.includes(KEY));
});

test('account check: every sub-account\'s traffic, converted by its unit', async () => {
  const seen = [];
  const items = [SUB, { ...SUB, subaccountLogin: 'm2', productType: 'mobile', trafficOverall: { unit: 'MB', value: 2048 }, trafficSpent: { unit: 'MB', value: 1024 }, trafficAvailable: { unit: 'MB', value: 1024 } }];
  const r = await pa.checkProviderAccount('simplynode', { token: KEY }, async (url, opts = {}) => { seen.push({ url, headers: opts.headers }); return JSON.stringify({ count: 2, nextToken: null, items }); });
  assert.equal(seen[0].url, 'https://app.simplynode.io/api/subaccounts?limit=50');
  assert.equal(seen[0].headers['x-api-key'], KEY);
  assert.deepEqual([r.account.status, r.account.plan, r.account.trafficLeftGb, r.account.trafficUsedGb, r.account.trafficTotalGb, r.account.note],
    ['active', 'Residential, Mobile', 9, 3, 12, 'summedPlans']);
  const credits = { unit: 'credits', value: 5 };
  const odd = await pa.checkProviderAccount('simplynode', { token: KEY }, async () => JSON.stringify({ items: [{ ...SUB, trafficOverall: credits, trafficSpent: credits, trafficAvailable: credits }] }));
  assert.deepEqual([odd.account.trafficLeftGb, odd.account.trafficTotalGb, odd.account.status], [null, null, 'unknown'], 'an undocumented unit shows nothing rather than a wrong figure');
  assert.equal(r.dashboardUrl, 'https://app.simplynode.io/');
});

test('SimplyNode is wired: optional sub-account login, Keep same IP up to 60 minutes, strings in both languages', async () => {
  const sec = between('// ---- SimplyNode (residential', '// Vendors wired to live API calls');
  const code = sec.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /\/rotation'|traffic:add|ip:attach|ip:detach|traffic-usage|'POST', `\/subaccounts/);
  assert.equal((code.match(/'POST'/g) || []).length, 1, 'POST /proxy is the only write');
  assert.match(IPC, /simplynode: fetchSimplyNodePool/);
  assert.match(IPC, /simplynode: lookupSimplyNode/);
  assert.match(IPC, /simplynode: \(proxy\) => rotateSimplyNodeSession\(proxy\)/);
  assert.match(IPC, /simplynode: 'SimplyNode'/);
  const line = providerLine('simplynode');
  assert.match(line, /creds: \['token', 'username'\], optional: \['username'\], labels: \{ token: 'apiKeyLabel', username: 'subaccountLabel' \}/);
  assert.match(line, /poolType: \[\['residential_essential', 'Residential Essential'\], \['residential_core', 'Residential Core'\], \['mobile', 'Mobile'\]\]/);
  assert.match(line, /noSession: true, life: true, maxLife: 60, proto: true/);
  assert.match(UI, /const USERNAME_PLACEHOLDERS = \{ subaccountLabel: 'subaccountPlaceholder' \};/);
  const { LIFE_BLANK_DEFAULTS, lifeBlankLabel } = await import('../src/renderer/lib/gatewayPull.mjs');
  assert.equal(LIFE_BLANK_DEFAULTS.simplynode, 30);
  assert.deepEqual(lifeBlankLabel('simplynode', { count: '1' }), { key: 'lifeDifferent' });
  assert.deepEqual(lifeBlankLabel('simplynode', { count: '5' }), { key: 'lifeDefaultTime', minutes: 30 });
  for (const lang of ['en', 'es']) {
    const p = LOCALES[lang].proxyProviders;
    for (const k of ['subaccountLabel', 'subaccountPlaceholder']) assert.equal(typeof p.geo[k], 'string', `${lang} ${k}`);
    assert.equal(typeof p.geoHints.simplynode, 'string', lang);
    for (const s of [p.geoHints.simplynode, p.geo.subaccountLabel, p.geo.subaccountPlaceholder]) assert.doesNotMatch(s, /[–—]/, `${lang}: no em or en dashes`);
  }
  assert.equal(LOCALES.en.proxyProviders.geo.subaccountLabel, 'Sub-account login');
});
