'use strict';
// GonzoProxy connector: login grammar from the published examples on help.gonzoproxy.com/ru
// (Dolphin Anty and Octo Browser setup pages, residential guide; fetched 2026-11-01), plus
// help.gonzoproxy.com/instructions/gonzoproxy-residential-proxies (lifetime "in seconds, minutes or
// hours, up to 7 days") and gonzoproxy.com/countries/united-states (LOGIN_c_us with no session for a
// new IP per request; _s_a91f_ttl_30m). Built from the docs only: never checked against a live account.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('gonzoProxyUsername reproduces the published login examples', () => {
  assert.equal(U.gonzoProxyUsername('Gonzoj9CiIi', { country: 'US', session: '204976RWZ' }), 'Gonzoj9CiIi_c_US_s_204976RWZ_ttl_72h');
  assert.equal(U.gonzoProxyUsername('Gonzoj9CiIi', { country: 'US', state: '443', session: '663698TEC' }), 'Gonzoj9CiIi_c_US_sd_443_s_663698TEC_ttl_72h');
});

test('the city token matches the documented city_Los-Angeles form', () => {
  assert.equal(U.gonzoProxyUsername('L1', { country: 'us', city: 'los angeles', session: 'a' }), 'L1_c_US_city_Los-Angeles_s_a_ttl_72h');
});

test('a pasted full login keeps only its base', () => {
  assert.equal(U.gonzoProxyBaseLogin('Gonzoj9CiIi_c_US_sd_443_s_663698TEC_ttl_72h'), 'Gonzoj9CiIi');
  assert.equal(U.gonzoProxyBaseLogin('me@example.com'), '');
});

test('bad input fails instead of being dropped', () => {
  assert.throws(() => U.gonzoProxyUsername('me@example.com', { country: 'US', session: 'a' }), /login from Proxy Setup/);
  assert.throws(() => U.gonzoProxyUsername('L1', { session: 'a' }), /pick a country/);
  assert.throws(() => U.gonzoProxyUsername('L1', { country: 'USA', session: 'a' }), /pick a country/);
  assert.throws(() => U.gonzoProxyUsername('L1', { country: 'US', state: 'California', session: 'a' }), /numeric region code/);
  assert.throws(() => U.gonzoProxyUsername('L1', { country: 'US', session: '---' }), /letters or digits/);
  assert.throws(() => U.gonzoProxyUsername('L1', { country: 'US', ttlMin: 30 }), /needs a sticky session/);
  assert.throws(() => U.gonzoProxyUsername('L1', { country: 'US', session: 'a', ttlMin: 10081 }), /1 minute to 7 days/);
  assert.throws(() => U.gonzoProxyUsername('L1', { country: 'US', session: 'a', ttlMin: 'soon' }), /1 minute to 7 days/);
});

test('no session gives the rotating login; a lifetime follows the published _ttl_ forms', () => {
  assert.equal(U.gonzoProxyUsername('LOGIN', { country: 'us' }), 'LOGIN_c_US');
  assert.equal(U.gonzoProxyUsername('gz7kd2', { country: 'us', session: 'a91f', ttlMin: 30 }), 'gz7kd2_c_US_s_a91f_ttl_30m');
  assert.equal(U.gonzoProxyTtl(''), '72h', 'the dashboard default');
  assert.equal(U.gonzoProxyTtl(120), '2h');
  assert.equal(U.gonzoProxyTtl(1440), '24h');
  assert.equal(U.gonzoProxyTtl(10080), '168h', 'the 7-day maximum');
});

// Runs the real adapter with the shared mint helper.
function ipcFunction(name) {
  return new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`).exec(IPC)[0];
}
const fetchGonzoProxyPool = new Function(
  'crypto', 'gonzoProxyBaseLogin', 'gonzoProxyUsername', 'GONZOPROXY_GATEWAY', 'MINTED_PULL_MAX',
  `${['normCountryCode', 'clampPoolCount', 'gatewayPullPlan', 'gatewayOverride', 'mintGatewayRows', 'fetchGonzoProxyPool'].map(ipcFunction).join('\n')}\nreturn fetchGonzoProxyPool;`
)(require('crypto'), U.gonzoProxyBaseLogin, U.gonzoProxyUsername, { host: 'connect.gonzoproxy.app', port: 10000 }, Number(/const MINTED_PULL_MAX = (\d+);/.exec(IPC)[1]));

test('a pull rotates for one row, mints up to MINTED_PULL_MAX sticky rows, and honours Keep same IP', async () => {
  const one = await fetchGonzoProxyPool({ username: 'L1', password: 'pw', country: 'US', count: '1' });
  assert.deepEqual(one.map((r) => r.username), ['L1_c_US']);
  const many = await fetchGonzoProxyPool({ username: 'L1', password: 'pw', country: 'US', count: '600' });
  assert.equal(many.length, 600);
  assert.equal(new Set(many.map((r) => r.username)).size, 600);
  assert.match(many[0].username, /^L1_c_US_s_sg[0-9a-f]{6}1_ttl_72h$/);
  assert.equal((await fetchGonzoProxyPool({ username: 'L1', password: 'pw', country: 'US', count: '5000' })).length, 1000);
  const kept = await fetchGonzoProxyPool({ username: 'L1', password: 'pw', country: 'US', count: '1', life: '360' });
  assert.match(kept[0].username, /^L1_c_US_s_sg[0-9a-f]{6}_ttl_6h$/, 'Keep same IP makes even one row sticky');
});

test('GonzoProxy is wired: adapter, registry, panel entry and hints', () => {
  assert.match(IPC, /async function fetchGonzoProxyPool\(/);
  assert.match(IPC, /gonzoproxy: fetchGonzoProxyPool/);
  assert.match(IPC, /gonzoproxy: 'GonzoProxy'/);
  assert.match(IPC, /host: 'connect\.gonzoproxy\.app', port: 10000/);
  assert.match(UI, /key: 'gonzoproxy'.*creds: \['username', 'password'\].*geo: true.*session: true, life: true.*proto: true/);
  assert.match(/key: 'gonzoproxy'.*/.exec(UI)[0], /maxLife: 10080/, 'Keep same IP offers up to 7 days, the vendor maximum');
  for (const loc of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', loc, 'cmpSettingsC.json'), 'utf8'));
    assert.equal(typeof json.proxyProviders.geoHints.gonzoproxy, 'string', loc);
    assert.doesNotMatch(json.proxyProviders.geoHints.gonzoproxy, /[–—]/, 'no em or en dashes');
  }
});
