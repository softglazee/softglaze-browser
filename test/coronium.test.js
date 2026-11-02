'use strict';
// Coronium connector: response shape from the published OpenAPI document at
// api.coronium.io/api-docs (3.3.10, fetched 2026-11-01). The fixture below is that document's own
// example row. Built from the docs only: never checked against a live account.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');
const NOW = 1772000000000;

const CLASSIC = {
  _id: '6731f5e97aa0d9ab4e66585c', name: 'dongle695_pl', proxy_login: 'example_login', proxy_password: 'example_password',
  http_port: '8695', socks_port: '5695', ext_ip: '198.51.100.38', isOnline: true, tariff_expired_at: 1772182221484,
  ip_address: '203.0.113.10', connection_ip: '203.0.113.10',
  restartByToken: 'https://api.coronium.io/api/v3/modems/rotate-modem-by-token/SECRET_TOKEN',
  statusByToken: 'https://api.coronium.io/api/v3/modems/get-rotating-modem-status-by-token/SECRET_TOKEN',
  restartToken: 'SECRET_TOKEN'
};

test('a classic row connects to ip_address, not the exit IP', () => {
  const { rows } = U.coroniumRows({ data: [CLASSIC] }, { now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].host, '203.0.113.10');
  assert.equal(rows[0].port, 8695);
  assert.equal(rows[0].type, 'HTTP');
  assert.equal(rows[0].username, 'example_login');
  assert.equal(rows[0].password, 'example_password');
  const socks = U.coroniumRows(JSON.stringify({ data: [CLASSIC] }), { socks: true, now: NOW }).rows[0];
  assert.equal(socks.port, 5695);
  assert.equal(socks.type, 'SOCKS5');
});

test('no rotation link or token ever leaves the parser', () => {
  const { rows } = U.coroniumRows({ data: [CLASSIC] }, { now: NOW });
  const out = JSON.stringify(rows);
  assert.doesNotMatch(out, /SECRET_TOKEN|rotate-modem|rotationUrl/);
  assert.equal('rotationUrl' in rows[0], false);
});

test('proxyEndpoints wins, with its per-protocol login', () => {
  const row = { ...CLASSIC, proxyEndpoints: {
    credentials: 'separate-protocol-v1',
    http: { host: 'h.example.net', port: 9001, username: 'hu', password: 'hp' },
    socks5: { host: 's.example.net', port: 9002, username: 'su', password: 'sp' }
  } };
  const h = U.coroniumRows({ data: [row] }, { now: NOW }).rows[0];
  assert.deepEqual([h.host, h.port, h.username, h.password], ['h.example.net', 9001, 'hu', 'hp']);
  const s = U.coroniumRows({ data: [row] }, { socks: true, now: NOW }).rows[0];
  assert.deepEqual([s.host, s.port, s.username, s.password], ['s.example.net', 9002, 'su', 'sp']);
});

test('a row missing the requested protocol is left out rather than sent to the wrong port', () => {
  const row = { ...CLASSIC, proxyEndpoints: { http: { host: 'h.example.net', port: 9001, username: 'u', password: 'p' } } };
  assert.equal(U.coroniumRows({ data: [row] }, { socks: true, now: NOW }).rows.length, 0);
});

test('expired lines are skipped and counted', () => {
  const r = U.coroniumRows({ data: [{ ...CLASSIC, tariff_expired_at: NOW - 1 }] }, { now: NOW });
  assert.deepEqual([r.rows.length, r.total, r.expired], [0, 1, 1]);
});

test('an offline line stays visible in the label', () => {
  assert.match(U.coroniumRows({ data: [{ ...CLASSIC, isOnline: false }] }, { now: NOW }).rows[0].label, /offline/);
});

test('bad bodies give no rows, never invented ones', () => {
  assert.deepEqual(U.coroniumRows('not json'), { rows: [], total: 0, expired: 0 });
  assert.equal(U.coroniumRows({ data: [{ name: 'x' }] }, { now: NOW }).rows.length, 0);
});

test('Coronium is wired, reads only the documented endpoint and stores no rotation link', () => {
  const body = /async function fetchCoroniumPool\([\s\S]*?\r?\n\}\r?\n/.exec(IPC)[0];
  assert.match(body, /Authorization: `Bearer \$\{key\}`/);
  assert.doesNotMatch(body, /auth_token=/, 'the key never rides in a URL');
  assert.doesNotMatch(body, /modems\/|restart|rotationUrl/);
  assert.match(IPC, /const CORONIUM_API = 'https:\/\/api\.coronium\.io\/api\/v3'/);
  assert.match(IPC, /coronium: fetchCoroniumPool/);
  assert.match(IPC, /coronium: 'Coronium'/);
  assert.match(UI, /key: 'coronium'.*creds: \['token'\].*noCountry: true.*list: true.*proto: true/);
  for (const loc of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', loc, 'cmpSettingsC.json'), 'utf8'));
    assert.equal(typeof json.proxyProviders.geoHints.coronium, 'string', loc);
    assert.doesNotMatch(json.proxyProviders.geoHints.coronium, /[–—]/, 'no em or en dashes');
  }
});
