'use strict';
// ResiProx connector. Fixtures follow the field names of the OpenAPI 3.1 "ResiProx API Documentation"
// 0.1 (dashboard.resiprox.com/docs/v1, read 2026-11-10). The docs give no example of a generated proxy
// string, so the strings are the shapes the shared parser accepts, with placeholder logins. Never checked
// against a live account; no test reaches ResiProx.
const test = require('node:test');
const assert = require('node:assert/strict');
const { IPC, LOCALES, U, between, fnSrc, httpError, load, providerLine } = require('./helpers/connectorHarness');
const pa = require('../src/main/providerAccount');

const TOKEN = '42|resiprox-test-token-0123456789';
const ME = {
  user: { data: {
    residential: { user: 'example-resi', pass: 'example-pass', bandwidth: { total: '20000000000', used: '1500000000', remaining: '18500000000' } },
    mobile: null
  } },
  message: 'ok'
};
const ME_BOTH = { user: { data: { ...ME.user.data, mobile: { user: 'example-mob', pass: 'example-pass', bandwidth: { total: '10000000000', used: '0', remaining: '10000000000' } } } } };

const section = { from: '// ---- ResiProx (residential', to: '// ---- SimplyNode (residential', names: ['fetchResiProxPool', 'lookupResiProx'] };
// Each generator call returns a new sticky session (a different password), or the same rotating string.
const router = ({ me = ME, sticky = true, form = (i) => `http://example-resi:sess${i}@go.resiprox.com:5000`, countries } = {}) => {
  let n = 0;
  return (call) => {
    if (call.url.endsWith('/user/me')) return me;
    if (call.url.includes('/generate-proxy-string?')) { n += 1; return { proxy_string: form(sticky ? n : 0) }; }
    if (call.url.endsWith('/countries')) return countries;
    throw new Error(`no route for ${call.url}`);
  };
};

test('the pool login and its traffic come from /user/me (bytes as strings); a missing pool is null', () => {
  assert.deepEqual(U.resiProxPool(ME, 'residential'), { user: 'example-resi', pass: 'example-pass', totalBytes: 2e10, usedBytes: 1.5e9, remainingBytes: 1.85e10 });
  assert.equal(U.resiProxPool(ME, 'mobile'), null);
  assert.equal(U.resiProxPool('<html>', 'residential'), null);
});

test('a generated string becomes a row on a resiprox.com host; anything else is refused', () => {
  const r = U.resiProxRow('http://example-resi:sess1@go.resiprox.com:5000', { pool: 'mobile', country: 'us', index: 2, sticky: true }).row;
  assert.deepEqual([r.type, r.host, r.port, r.username, r.password, r.country, r.dedupeOnPassword], ['HTTP', 'go.resiprox.com', 5000, 'example-resi', 'sess1', 'US', true]);
  assert.equal(r.label, 'ResiProx • Mobile • US • #2');
  const s = U.resiProxRow('go.resiprox.com:5000:example-resi:sess1', { socks: true }).row;
  assert.deepEqual([s.type, s.port, s.label], ['SOCKS5', 5000, 'ResiProx • Residential • Any country • rotating'], 'SOCKS5 on the same host and port (inferred)');
  assert.deepEqual(U.resiProxRow('http://u:p@pr.ResiProx.io:7777'), { row: null, reason: 'host', host: 'pr.ResiProx.io' }, 'the dead template host');
  assert.equal(U.resiProxRow('go.resiprox.com:5000').reason, 'noLogin');
  assert.equal(U.resiProxRow('nonsense').reason, 'unreadable');
});

test('the country list is read whatever its undocumented shape', () => {
  assert.deepEqual(U.resiProxCountries({ countries: ['us', 'DE', 'xx1'] }).map((c) => c.key), ['US', 'DE']);
  assert.deepEqual(U.resiProxCountries({ countries: [{ code: 'fr', name: 'France' }, { country_code: 'BR', country_name: 'Brazil' }] }), [{ key: 'FR', label: 'France' }, { key: 'BR', label: 'Brazil' }]);
  assert.deepEqual(U.resiProxCountries({ countries: { GB: 'United Kingdom', JP: { name: 'Japan' } } }), [{ key: 'GB', label: 'United Kingdom' }, { key: 'JP', label: 'Japan' }]);
  assert.deepEqual(U.resiProxCountries('<html>'), []);
});

test('How many 1 is one rotating proxy (sticky=0); more are that many sticky ones (sticky=1), Bearer token', async () => {
  const one = load({ ...section, route: router({ sticky: false }) });
  const rot = await one.fetchResiProxPool({ token: TOKEN, poolType: 'residential', count: '1' });
  assert.equal(rot.length, 1);
  assert.match(rot[0].label, /rotating$/);
  const gen = one.calls.filter((c) => c.url.includes('generate-proxy-string'));
  assert.deepEqual(gen.map((c) => c.url), ['https://dashboard.resiprox.com/api/v1/generate-proxy-string?connection_type=residential&sticky=0']);
  assert.ok(one.calls.every((c) => c.headers.Authorization === `Bearer ${TOKEN}` && !c.url.includes(TOKEN)));
  const many = load({ ...section, route: router() });
  const rows = await many.fetchResiProxPool({ token: TOKEN, poolType: 'residential', country: 'us', state: 'California', city: 'Los Angeles', count: '5', proxyType: 'socks5' });
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map((r) => r.password)).size, 5);
  assert.ok(rows.every((r) => r.type === 'SOCKS5' && r.country === 'US'));
  assert.equal(many.calls.filter((c) => c.url.includes('generate-proxy-string')).length, 5);
  assert.match(many.calls[1].url, /\?connection_type=residential&country_code=US&region=California&city=Los\+Angeles&sticky=1$/);
});

test('a sticky pull stops at 50, and early when ResiProx repeats a string', async () => {
  const big = load({ ...section, route: router() });
  assert.equal((await big.fetchResiProxPool({ token: TOKEN, count: '500' })).length, 50);
  const same = load({ ...section, route: router({ sticky: false }) });
  const rows = await same.fetchResiProxPool({ token: TOKEN, count: '4' });
  assert.equal(rows.length, 1);
  assert.match(rows[0].label, /\(1 of 4\)$/);
});

test('the pull stops before generating when the pool is missing or empty, and explains every refusal', async () => {
  const run = (route, args = {}) => load({ ...section, route }).fetchResiProxPool({ token: TOKEN, ...args });
  await assert.rejects(load({ ...section, route: router() }).fetchResiProxPool({ token: '' }), /paste the API token from your dashboard\./);
  await assert.rejects(run(router(), { poolType: 'mobile' }), /this account has no Mobile package\. Pick the other pool, or buy one on resiprox\.com\./);
  const dry = { user: { data: { residential: { ...ME.user.data.residential, bandwidth: { total: '1', used: '1', remaining: '0' } } } } };
  await assert.rejects(run(router({ me: dry })), /the Residential package has no traffic left, so its proxies would fail on first use\./);
  await assert.rejects(run(router(), { state: 'California' }), /pick a country to target a state or city/);
  await assert.rejects(run(router({ form: () => 'http://u:p@pr.ResiProx.io:7777' })), /not a ResiProx host/);
  await assert.rejects(run(router({ form: () => 'go.resiprox.com:5000' })), /without a username and password/);
  await assert.rejects(run(router({ form: () => '<!doctype html>' })), /returned a proxy string the app cannot read\. Send the support team its format \(without the password\)\./);
  const fail = (status, body) => run(() => { throw httpError(status, body); });
  await assert.rejects(fail(401, { message: 'Unauthenticated.' }), /ResiProx rejected the API token\. Create a new one in your dashboard and paste it again\./);
  await assert.rejects(fail(403, { error: 'Nice try...' }), /refused the request for this account/);
  await assert.rejects(fail(422, { message: 'The given data was invalid.', errors: { country_code: ['The selected country code is invalid.'] } }), /ResiProx refused the location: The selected country code is invalid\./);
  await assert.rejects(fail(429, {}), /too many requests\. Wait a minute and pull again\./);
  await assert.rejects(fail(502, `bad gateway ${TOKEN}`), (e) => /could not reach the API/.test(e.message) && !e.message.includes(TOKEN));
});

test('a rate limit part way keeps the proxies already generated', async () => {
  let n = 0;
  const p = load({ ...section, route: (call) => {
    if (call.url.endsWith('/user/me')) return ME;
    n += 1;
    if (n > 3) throw httpError(429, {});
    return { proxy_string: `example-resi:sess${n}@go.resiprox.com:5000` };
  } });
  const rows = await p.fetchResiProxPool({ token: TOKEN, count: '6' });
  assert.equal(rows.length, 3);
  assert.match(rows[0].label, /\(3 of 6: ResiProx: too many requests/);
});

test('Load countries: GET /countries, sorted by name', async () => {
  const p = load({ ...section, route: router({ countries: { countries: [{ code: 'us', name: 'United States' }, { code: 'br', name: 'Brazil' }] } }) });
  const r = await p.lookupResiProx({ token: TOKEN, groupby: 'country' });
  assert.deepEqual(r, { provider: 'resiprox', geo: [{ key: 'BR', label: 'Brazil' }, { key: 'US', label: 'United States' }] });
  await assert.rejects(p.lookupResiProx({ token: TOKEN, groupby: 'city' }), /only the country list/);
  await assert.rejects(load({ ...section, route: router({ countries: { countries: 'n/a' } }) }).lookupResiProx({ token: TOKEN, groupby: 'country' }), /no countries the app can read/);
});

test('account check: /user/me in decimal GB (1 GB = 1e9 bytes), both pools summed', async () => {
  const seen = [];
  const r = await pa.checkProviderAccount('resiprox', { token: TOKEN }, async (url, opts = {}) => { seen.push({ url, headers: opts.headers }); return JSON.stringify(ME_BOTH); });
  assert.equal(seen[0].url, 'https://dashboard.resiprox.com/api/v1/user/me');
  assert.equal(seen[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual([r.account.status, r.account.plan, r.account.trafficTotalGb, r.account.trafficUsedGb, r.account.trafficLeftGb, r.account.note],
    ['active', 'Residential, Mobile', 30, 1.5, 28.5, 'summedPlans']);
  const one = await pa.checkProviderAccount('resiprox', { token: TOKEN }, async () => JSON.stringify(ME));
  assert.deepEqual([one.account.trafficLeftGb, one.account.note], [18.5, null], 'not 17.23, which 1024^3 would give');
  assert.equal(r.dashboardUrl, 'https://dashboard.resiprox.com/');
});

test('ResiProx is wired with its live affiliate link, only reads, and has its strings', () => {
  const sec = between('// ---- ResiProx (residential', '// ---- SimplyNode (residential');
  assert.doesNotMatch(sec, /\/users|\/sub-users|\/packages|method:\s*'(POST|PUT|PATCH|DELETE)'/);
  assert.match(IPC, /resiprox: fetchResiProxPool/);
  assert.match(IPC, /resiprox: lookupResiProx/);
  assert.match(IPC, /resiprox: 'ResiProx'/);
  assert.match(IPC, /const RESIPROX_PULL_MAX = 50;/);
  assert.match(fnSrc('fetchResiProxPool'), /gatewayPullPlan\(\{ count \}\)/);
  const line = providerLine('resiprox');
  assert.match(line, /referral: 'https:\/\/resiprox\.com\?ref=n2m3ztm'/, 'the owner\'s live affiliate link');
  assert.match(line, /creds: \['token'\], poolType: \[\['residential', 'Residential'\], \['mobile', 'Mobile'\]\], count: true, geo: true, countryLookup: true, noSession: true, proto: true/);
  assert.doesNotMatch(line, /life: true/, 'the API takes no TTL');
  for (const lang of ['en', 'es']) {
    const hint = LOCALES[lang].proxyProviders.geoHints.resiprox;
    assert.equal(typeof hint, 'string', lang);
    assert.doesNotMatch(hint, /[–—]/, `${lang}: no em or en dashes`);
  }
});
