'use strict';
// Singapore Mobile Proxy connector: response shape from singaporemobileproxy.com/api-docs
// (fetched 2026-11-01); the fixture is that page's example row. Built from the docs only: never
// checked against a live account.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

const ROW = {
  uuid: 'db4474ea-1', license_status: 'ACTIVE', package_name: '300GB Singapore', host_domain: 'sg.veerlane.com',
  http_port: 8101, socket_port: 5101, status: 'CONNECTED', rotation_link: 'https://example.net/rotate/SECRET',
  authentication_user: 'proxy_abc123:password123', authorization_ips: ''
};

test('the documented row maps to one usable proxy per protocol', () => {
  const h = U.singaporeMobileProxyRows({ proxyList: [ROW] }).rows[0];
  assert.deepEqual([h.type, h.host, h.port, h.username, h.password], ['HTTP', 'sg.veerlane.com', 8101, 'proxy_abc123', 'password123']);
  const s = U.singaporeMobileProxyRows(JSON.stringify({ proxyList: [ROW] }), { socks: true }).rows[0];
  assert.deepEqual([s.type, s.port], ['SOCKS5', 5101]);
});

test('a password may itself contain a colon', () => {
  const r = U.singaporeMobileProxyRows({ proxyList: [{ ...ROW, authentication_user: 'u:p:q' }] }).rows[0];
  assert.deepEqual([r.username, r.password], ['u', 'p:q']);
});

test('each modem keeps its rotation link for Rotate IP, https only', () => {
  const r = U.singaporeMobileProxyRows({ proxyList: [ROW] }).rows[0];
  assert.equal(r.rotationUrl, 'https://example.net/rotate/SECRET');
  const plain = U.singaporeMobileProxyRows({ proxyList: [{ ...ROW, rotation_link: 'http://example.net/rotate/x' }] }).rows[0];
  assert.equal(plain.rotationUrl, null, 'a link that is not https is not kept');
  assert.equal(U.singaporeMobileProxyRows({ proxyList: [{ ...ROW, rotation_link: '' }] }).rows[0].rotationUrl, null);
});

test('the label shows the data used from the modem allowance', () => {
  const r = U.singaporeMobileProxyRows({ proxyList: [{ ...ROW, bandwidth_used_gb: 45.23, bandwidth_limit_gb: 300 }] }).rows[0];
  assert.match(r.label, /45\.2\/300 GB$/);
  assert.doesNotMatch(U.singaporeMobileProxyRows({ proxyList: [ROW] }).rows[0].label, /GB$/);
});

test('inactive and login-less lines are counted, not imported', () => {
  const r = U.singaporeMobileProxyRows({ proxyList: [{ ...ROW, license_status: 'EXPIRED' }, { ...ROW, authentication_user: '' }] });
  assert.deepEqual([r.rows.length, r.total, r.inactive, r.noLogin], [0, 2, 1, 1]);
});

test('bad bodies give no rows, never invented ones', () => {
  assert.equal(U.singaporeMobileProxyRows('<html>').rows.length, 0);
  assert.equal(U.singaporeMobileProxyRows({}).rows.length, 0);
});

test('a re-pull adds a missing rotation link to a proxy already saved', () => {
  assert.match(IPC, /if \(row\.rotationUrl && !existing\.rotationUrl\) await db\.proxy\.update\(\{ where: \{ id: existing\.id \}, data: \{ rotationUrl: row\.rotationUrl \} \}\)/);
});

test('Singapore Mobile Proxy is wired and never opens the rotation link itself', () => {
  const body = /async function fetchSingaporeMobileProxyPool\([\s\S]*?\r?\n\}\r?\n/.exec(IPC)[0];
  assert.match(body, /'x-api-key': key/);
  assert.doesNotMatch(body, /rotation_link|rotationUrl/, 'the pull only reads the list');
  assert.match(IPC, /https:\/\/singaporemobileproxy\.com\/api\/v1/);
  assert.match(IPC, /singaporemobileproxy: fetchSingaporeMobileProxyPool/);
  assert.match(IPC, /singaporemobileproxy: 'Singapore Mobile Proxy'/);
  assert.match(UI, /key: 'singaporemobileproxy'.*creds: \['token'\].*noCountry: true.*list: true.*proto: true/);
  for (const loc of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', loc, 'cmpSettingsC.json'), 'utf8'));
    assert.equal(typeof json.proxyProviders.geoHints.singaporemobileproxy, 'string', loc);
    assert.doesNotMatch(json.proxyProviders.geoHints.singaporemobileproxy, /[–—]/, 'no em or en dashes');
  }
});
