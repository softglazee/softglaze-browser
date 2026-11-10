'use strict';
// Massive connector. The username grammar, gateways and ports follow docs.joinmassive.com (read
// 2026-11-10); the Reporting API fixture uses its documented used_bytes field. No API call is made for a
// pull, and no test reaches Massive.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const U = require('../src/main/proxyVendorUtils');
const pa = require('../src/main/providerAccount');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lang, 'cmpSettingsC.json'), 'utf8'));
const pull = () => import('../src/renderer/lib/gatewayPull.mjs');

const USER = 'owner@example.com';
const TOKEN = 'mv_TEST_token_0000';

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
const SECTION = between('// ---- Massive (residential', '// Vendors wired to live API calls');

const fetchMassivePool = new Function(
  'crypto', 'massiveBaseUser', 'massiveUsername', 'MINTED_PULL_MAX',
  `${['normCountryCode', 'clampPoolCount', 'gatewayPullPlan', 'gatewayOverride', 'mintGatewayRows'].map(fnSrc).join('\n')}\n${SECTION}\nreturn fetchMassivePool;`
)(nodeCrypto, U.massiveBaseUser, U.massiveUsername, Number(/const MINTED_PULL_MAX = (\d+);/.exec(IPC)[1]));

const base = { username: USER, password: TOKEN, host: 'network.joinmassive.com', port: '65534' };

// ---- The username ----

test('the username grammar: country upper case, city URL-encoded, ZIP drops the city, sessionttl up to 1440', () => {
  assert.equal(U.massiveUsername('u', { country: 'us', subdivision: 'ny', city: 'New York', session: 'abc123', ttlMin: 60 }), 'u-country-US-subdivision-NY-city-New%20York-session-abc123-sessionttl-60');
  assert.equal(U.massiveUsername('u', { country: 'US', city: 'Austin', zip: '73301' }), 'u-country-US-zipcode-73301', 'with a ZIP code the city is not sent');
  assert.equal(U.massiveUsername('u', { country: 'US', city: 'Winston-Salem' }), 'u-country-US-city-Winston%2DSalem', 'a dash cannot split the username');
  assert.equal(U.massiveUsername('u', { country: 'US', asn: 'AS7922', type: 'mobile' }), 'u-country-US-asn-7922-type-mobile');
  assert.equal(U.massiveUsername('u', { session: 's1', ttlMin: 5000 }), 'u-session-s1-sessionttl-1440', 'sessionttl clamps to 1440');
  assert.equal(U.massiveUsername('u', { session: '', ttlMin: 60 }), 'u', 'no session, no sessionttl');
  assert.equal(U.massiveUsername('u', { city: 'Paris' }), 'u', 'geo keys need a country');
  assert.equal(U.massiveBaseUser('me@example.com-country-US-session-x'), 'me@example.com', 'pasted targeting is stripped');
  assert.equal(U.massiveBaseUser(' me@example.com-subaccount-a '), 'me@example.com');
});

// ---- The pull ----

test('How many 1 with no session rotates; more rows are sticky; Keep same IP makes one row sticky', async () => {
  const one = await fetchMassivePool({ ...base, country: 'US', count: '1' });
  assert.equal(one.length, 1);
  assert.equal(one[0].username, `${USER}-country-US`);
  assert.deepEqual([one[0].host, one[0].port, one[0].type, one[0].password, one[0].country, one[0].dedupeOnPassword], ['network.joinmassive.com', 65534, 'HTTP', TOKEN, 'US', true]);
  assert.match(one[0].label, /^Massive • Residential • US • rotating$/);
  const many = await fetchMassivePool({ ...base, country: 'US', state: 'NY', city: 'New York', count: '5', life: '60' });
  assert.equal(many.length, 5);
  assert.equal(new Set(many.map((r) => r.username)).size, 5);
  assert.match(many[0].username, /^owner@example\.com-country-US-subdivision-NY-city-New%20York-session-sg[0-9a-f]{6}1-sessionttl-60$/);
  const blankLife = await fetchMassivePool({ ...base, count: '3' });
  assert.doesNotMatch(blankLife[0].username, /sessionttl/, 'blank Keep same IP leaves Massive\'s default of 15 minutes');
  const kept = await fetchMassivePool({ ...base, count: '1', life: '30' });
  assert.match(kept[0].username, /-session-sg[0-9a-f]{6}-sessionttl-30$/);
  assert.equal((await fetchMassivePool({ ...base, count: '5000' })).length, 1000, 'up to MINTED_PULL_MAX');
  const mobile = await fetchMassivePool({ ...base, poolType: 'residential_mobile', country: 'US', count: '2' });
  assert.match(mobile[0].username, /-country-US-type-mobile-session-/);
});

test('the port follows the protocol unless another one was typed; ISP always uses isp.joinmassive.com:8000', async () => {
  const socks = await fetchMassivePool({ ...base, proxyType: 'socks5', count: '1' });
  assert.deepEqual([socks[0].type, socks[0].host, socks[0].port], ['SOCKS5', 'network.joinmassive.com', 65533]);
  const back = await fetchMassivePool({ ...base, port: '65533', proxyType: 'http', count: '1' });
  assert.equal(back[0].port, 65534);
  const typed = await fetchMassivePool({ ...base, host: 'us-network.joinmassive.com', port: '1080', count: '1' });
  assert.deepEqual([typed[0].host, typed[0].port], ['us-network.joinmassive.com', 1080]);
  const isp = await fetchMassivePool({ ...base, poolType: 'isp', proxyType: 'socks5', count: '3', life: '60' });
  assert.deepEqual([isp[0].host, isp[0].port, isp[0].type], ['isp.joinmassive.com', 8000, 'SOCKS5']);
  assert.doesNotMatch(isp[0].username, /sessionttl/, 'ISP sessions do not expire');
  assert.match(isp[0].label, /^Massive • ISP • Any country • sticky /);
});

test('the pull refuses what Massive would reject, with the spec\'s messages', async () => {
  await assert.rejects(fetchMassivePool({ ...base, username: '' }), /enter the proxy username from your Massive dashboard \(Profile\)/);
  await assert.rejects(fetchMassivePool({ ...base, password: '' }), /enter your Massive API token as the proxy password/);
  await assert.rejects(fetchMassivePool({ ...base, username: 'me:x' }), /no spaces or colons/);
  for (const extra of [{ state: 'NY' }, { city: 'Paris' }, { zip: '10001' }, { asn: '7922' }]) {
    await assert.rejects(fetchMassivePool({ ...base, ...extra }), /pick a country before a state, city, ZIP or ASN/);
    await assert.rejects(fetchMassivePool({ ...base, poolType: 'isp', country: 'US', ...extra }), /ISP proxies take no location/);
  }
  await assert.rejects(fetchMassivePool({ ...base, poolType: 'isp', country: 'US' }), /ISP proxies take no location/);
  await assert.rejects(fetchMassivePool({ ...base, country: 'US', asn: 'Comcast' }), /ASN is digits only/);
  await assert.rejects(fetchMassivePool({ ...base, session: 'a-b' }), /letters, digits and _ only/);
  assert.doesNotMatch(SECTION, /httpRequestText/, 'a pull makes no API call');
});

// ---- Account check ----

test('account: GB used in the last 7 days from the Reporting API (10^9 bytes a GB); nothing left or expiry', async () => {
  const seen = [];
  const r = await pa.checkProviderAccount('massive', { username: USER, password: TOKEN }, async (url, opts) => { seen.push({ url, headers: opts.headers }); return JSON.stringify([{ date: '2026-11-09', used_bytes: 1500000000 }, { date: '2026-11-10', used_bytes: 500000000 }]); });
  assert.equal(seen[0].url, 'https://api-network.joinmassive.com/reporting/v1/usage');
  assert.equal(seen[0].headers['x-api-key'], TOKEN);
  assert.deepEqual([r.account.trafficUsedGb, r.account.trafficLeftGb, r.account.trafficTotalGb, r.account.expiresAt, r.account.note], [2, null, null, null, 'usedLast7Days']);
  assert.equal(pa.parsers.massive({ data: [{ used_bytes: 3e9 }] }).trafficUsedGb, 3);
  assert.equal(pa.parsers.massive({ used_bytes: '1000000000' }).trafficUsedGb, 1);
  assert.equal(pa.parsers.massive({}).trafficUsedGb, null);
  await assert.rejects(pa.checkProviderAccount('massive', { username: USER }, async () => '{}'), /no saved API token/);
  await assert.rejects(pa.checkProviderAccount('massive', { username: USER, password: TOKEN }, async () => { throw Object.assign(new Error('HTTP 401'), { status: 401 }); }), (e) => /rejected the saved API token/.test(e.message) && !e.message.includes(TOKEN));
  for (const lang of ['en', 'es']) {
    const note = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lang, 'proxies.json'), 'utf8')).providerAccount.note.usedLast7Days;
    assert.equal(typeof note, 'string', lang);
    assert.doesNotMatch(note, /[–—]/);
  }
});

// ---- Wiring ----

test('Massive is wired: registry, PROVIDERS entry, Keep same IP up to 24 hours with a 15 minute default', async () => {
  assert.match(IPC, /massive: 'Massive'/);
  assert.match(IPC, /massive: fetchMassivePool/);
  const line = UI.split(/\r?\n/).find((l) => l.includes("{ key: 'massive',"));
  assert.ok(line, 'PROVIDERS entry');
  assert.match(line, /referral: 'https:\/\/www\.joinmassive\.com\/'/);
  assert.match(line, /gateway: \{ host: 'network\.joinmassive\.com', port: 65534, type: 'HTTP' \}/);
  assert.match(line, /creds: \['username', 'password'\], labels: \{ password: 'apiTokenPasswordLabel' \}/);
  assert.match(line, /session: true, life: true, maxLife: 1440, proto: true, gateway: true/);
  const { LIFE_BLANK_DEFAULTS, lifeBlankLabel } = await pull();
  assert.equal(LIFE_BLANK_DEFAULTS.massive, 15);
  assert.deepEqual(lifeBlankLabel('massive', { count: '3' }), { key: 'lifeDefaultTime', minutes: 15 });
  assert.deepEqual(lifeBlankLabel('massive', { count: '1' }), { key: 'lifeDifferent' });
  for (const lang of ['en', 'es']) {
    const loc = locale(lang).proxyProviders;
    assert.equal(typeof loc.geo.life15, 'string', `${lang} life15`);
    assert.equal(typeof loc.geo.apiTokenPasswordLabel, 'string', `${lang} apiTokenPasswordLabel`);
    const hint = loc.geoHints.massive;
    assert.equal(typeof hint, 'string', lang);
    assert.match(hint, /65534/);
    assert.doesNotMatch(hint, /[–—]/, 'no em or en dashes');
  }
});
