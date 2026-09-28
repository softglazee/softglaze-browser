'use strict';
// MobileProxy.Space connector. Field names from the vendor OpenAPI spec
// (github.com/mobileproxy/api-docs) and a live bad-token probe (2026-09-29):
// GET /api.html?command=get_my_proxy, Bearer token -> { status: 'ok', list: [...] };
// errors are { status: 'err', message }. Numbers may arrive as strings.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

const SAMPLE = JSON.stringify({ status: 'ok', list: [
  { proxy_id: '101', proxy_host_ip: '185.1.2.3', proxy_hostname: 'p1.mobileproxy.space', proxy_http_port: '11001', proxy_socks5_port: '11002', proxy_login: 'lg1', proxy_pass: 'pw1', proxy_geo: 'Moscow', proxy_operator: 'MTS', proxy_exp: '2026-10-30 12:00:00' },
  { proxy_id: 102, proxy_hostname: 'p2.mobileproxy.space', proxy_http_port: 12001, proxy_socks5_port: 12002, proxy_login: 'lg2', proxy_pass: 'pw2' },
  { proxy_id: 103, proxy_host_ip: '185.1.2.9', proxy_http_port: 'x', proxy_login: 'lg3', proxy_pass: 'pw3' },
  { proxy_id: 101, proxy_host_ip: '185.1.2.3', proxy_http_port: '11001', proxy_login: 'lg1', proxy_pass: 'pw1' }
] });

test('mobileProxySpaceRows maps HTTP rows, parses string numbers, skips bad and duplicate entries', () => {
  const { error, rows } = U.mobileProxySpaceRows(SAMPLE);
  assert.equal(error, '');
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].type, rows[0].host, rows[0].port, rows[0].username, rows[0].password], ['HTTP', '185.1.2.3', 11001, 'lg1', 'pw1']);
  assert.match(rows[0].label, /Moscow • MTS • #101 • until 2026-10-30/);
  assert.equal(rows[1].host, 'p2.mobileproxy.space', 'falls back to the hostname when there is no IP');
});

test('mobileProxySpaceRows uses the SOCKS5 port when asked', () => {
  const { rows } = U.mobileProxySpaceRows(SAMPLE, { socks: true });
  assert.deepEqual([rows[0].type, rows[0].port], ['SOCKS5', 11002]);
});

test('mobileProxySpaceRows surfaces the vendor error message', () => {
  const r = U.mobileProxySpaceRows('{"status":"err","message":"Authorization error #3. Wrong token"}');
  assert.equal(r.rows.length, 0);
  assert.match(r.error, /Wrong token/);
  assert.equal(U.mobileProxySpaceRows('oops').error, 'bad-json');
});

test('MobileProxy.Space is wired: adapter, both registries and a UI entry', () => {
  assert.ok(IPC.includes('async function fetchMobileProxySpacePool'));
  assert.match(IPC, /mobileproxyspace:\s*fetchMobileProxySpacePool/);
  assert.match(IPC, /mobileproxyspace:\s*'MobileProxy\.Space'/);
  assert.ok(IPC.includes('?command=get_my_proxy'));
  assert.match(UI, /key:\s*'mobileproxyspace'/);
});
