'use strict';
// Proxy-Solutions connector, built to the anti-detect contract the vendor sent by email
// (2026-09-28): GET /api/proxies/{provider_key}?format=object&proto=http|socks&page&per_page
// -> { total_pages, proxies: [{ name, location, country_code, dynamic, proto, ip, port, login,
// password, expires_at (epoch ms) }] }. Needs one live key check before the listing goes public.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

const NOW = 1_800_000_000_000;
const PAGE = JSON.stringify({ page: 1, per_page: 200, total_pages: 3, total_proxies: 3, proxies: [
  { name: '55720 Germany: 1', location: 'Germany', country_code: 'DE', dynamic: false, proto: 'socks', ip: '37.139.52.51', port: 8000, login: 'ps55720', password: 'pw', expires_at: NOW + 86_400_000 },
  { name: 'US mobile', country_code: 'us', dynamic: true, proto: 'http', ip: '10.0.0.2', port: '9000', login: 'a', password: 'b', expires_at: NOW - 1 },
  { name: 'bad', ip: '10.0.0.3', port: 70000, login: 'a', password: 'b' }
] });

test('proxySolutionsPage maps live rows, skips expired and malformed ones, reads total_pages', () => {
  const { rows, totalPages } = U.proxySolutionsPage(PAGE, { now: NOW });
  assert.equal(totalPages, 3);
  assert.equal(rows.length, 1, 'expired and bad-port entries are skipped');
  assert.deepEqual([rows[0].type, rows[0].host, rows[0].port, rows[0].username, rows[0].country], ['SOCKS5', '37.139.52.51', 8000, 'ps55720', 'DE']);
  assert.match(rows[0].label, /Proxy-Solutions • 55720 Germany: 1/);
});

test('proxySolutionsPage is safe on junk', () => {
  assert.deepEqual(U.proxySolutionsPage('nope'), { rows: [], totalPages: 0 });
  assert.equal(U.proxySolutionsPage('{"proxies":[]}').totalPages, 1);
});

test('Proxy-Solutions is wired: adapter, both registries and a UI entry', () => {
  assert.ok(IPC.includes('async function fetchProxySolutionsPool'));
  assert.match(IPC, /proxysolutions:\s*fetchProxySolutionsPool/);
  assert.match(IPC, /proxysolutions:\s*'Proxy-Solutions'/);
  assert.match(UI, /key:\s*'proxysolutions'/);
});
