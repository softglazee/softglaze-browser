'use strict';
// Simply Proxies connector: username grammar from simplyproxies.com/docs (fetched 2026-11-01).
// Built from the docs only: never checked against a live account.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('simplyProxiesUsername reproduces every example in the docs', () => {
  assert.equal(U.simplyProxiesUsername('USER'), 'USER');
  assert.equal(U.simplyProxiesUsername('USER', { session: 'myapp1' }), 'USER-session-myapp1');
  assert.equal(U.simplyProxiesUsername('USER', { session: 'myapp1', minutes: 240 }), 'USER-session-myapp1-240');
  assert.equal(U.simplyProxiesUsername('USER', { network: 'ee' }), 'USER-ee');
  assert.equal(U.simplyProxiesUsername('USER', { network: 'three', session: 'myapp1', minutes: 30 }), 'USER-three-session-myapp1-30');
});

test('the network token always sits between the user and the session', () => {
  for (const network of U.SIMPLYPROXIES_NETWORKS) {
    assert.equal(U.simplyProxiesUsername('u', { network, session: 'x' }), `u-${network}-session-x`);
  }
  assert.equal(U.simplyProxiesUsername('u', { network: 'O2' }), 'u-o2', 'case does not matter');
  assert.equal(U.simplyProxiesUsername('u', { network: 'any' }), 'u');
  assert.equal(U.simplyProxiesUsername('u', { network: 'residential' }), 'u', 'the panel default shown as Any');
});

test('a hyphen-digits session id cannot be misread as id plus minutes', () => {
  assert.equal(U.simplyProxiesUsername('u', { session: 'acct-123' }), 'u-session-acct123');
});

test('a pasted suffix is rebuilt, never doubled', () => {
  assert.equal(U.simplyProxiesUsername('u-o2-session-a-30', { network: 'ee' }), 'u-ee');
  assert.equal(U.simplyProxiesUsername('u-vodafone', {}), 'u');
});

test('bad input fails instead of being dropped', () => {
  assert.throws(() => U.simplyProxiesUsername('u', { network: 'tmobile' }), /no network "tmobile"/);
  assert.throws(() => U.simplyProxiesUsername('u', { session: 'a', minutes: 4 }), /5 minutes to 12 hours/);
  assert.throws(() => U.simplyProxiesUsername('u', { session: 'a', minutes: 721 }), /5 minutes to 12 hours/);
  assert.throws(() => U.simplyProxiesUsername('u', { minutes: 30 }), /needs a sticky session/);
  assert.throws(() => U.simplyProxiesUsername('u', { session: '--' }), /letters or digits/);
  assert.throws(() => U.simplyProxiesUsername(''), /proxy username/);
  assert.throws(() => U.simplyProxiesUsername('me@example.com'), /proxy username/);
});

test('rows are SOCKS5 only, because the HTTPS endpoint needs TLS to the proxy', () => {
  const body = /async function fetchSimplyProxiesPool\([\s\S]*?\r?\n\}\r?\n/.exec(IPC)[0];
  assert.match(IPC, /const SIMPLYPROXIES_GATEWAY = Object\.freeze\(\{ host: 'proxy\.simplyproxies\.com', socks: 6890 \}\)/);
  assert.match(body, /type: 'SOCKS5'/);
  assert.doesNotMatch(body, /type: 'HTTP'/);
  assert.doesNotMatch(body + /key: 'simplyproxies'.*/.exec(UI)[0], /6889/);
});

test('a non UK country is refused', () => {
  assert.match(IPC, /Simply Proxies only has UK exits/);
});

// Runs the real adapter with the shared mint helper. The docs set no limit on sessions per pull.
function ipcFunction(name) {
  return new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`).exec(IPC)[0];
}
const fetchSimplyProxiesPool = new Function(
  'crypto', 'simplyProxiesUsername', 'SIMPLYPROXIES_NETWORKS', 'SIMPLYPROXIES_GATEWAY', 'MINTED_PULL_MAX',
  `${['clampPoolCount', 'mintGatewayRows', 'fetchSimplyProxiesPool'].map(ipcFunction).join('\n')}\nreturn fetchSimplyProxiesPool;`
)(require('crypto'), U.simplyProxiesUsername, U.SIMPLYPROXIES_NETWORKS, { host: 'proxy.simplyproxies.com', socks: 6890 }, Number(/const MINTED_PULL_MAX = (\d+);/.exec(IPC)[1]));

test('a pull mints up to MINTED_PULL_MAX sticky SOCKS5 rows', async () => {
  const rows = await fetchSimplyProxiesPool({ username: 'u', password: 'p', poolType: 'ee', count: '400', life: '60' });
  assert.equal(rows.length, 400);
  assert.equal(new Set(rows.map((r) => r.username)).size, 400);
  assert.match(rows[0].username, /^u-ee-session-sg[0-9a-f]{6}1-60$/);
  assert.deepEqual([rows[0].type, rows[0].port, rows[0].country], ['SOCKS5', 6890, 'GB']);
  assert.equal((await fetchSimplyProxiesPool({ username: 'u', password: 'p', count: '5000' })).length, 1000);
});

test('Simply Proxies is wired: adapter, registry, panel entry and hints', () => {
  assert.match(IPC, /simplyproxies: fetchSimplyProxiesPool/);
  assert.match(IPC, /simplyproxies: 'Simply Proxies'/);
  assert.match(UI, /key: 'simplyproxies'.*creds: \['username', 'password'\].*noCountry: true.*session: true.*maxLife: 720/);
  for (const loc of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', loc, 'cmpSettingsC.json'), 'utf8'));
    assert.equal(typeof json.proxyProviders.geoHints.simplyproxies, 'string', loc);
    assert.doesNotMatch(json.proxyProviders.geoHints.simplyproxies, /[–—]/, 'no em or en dashes');
  }
});
