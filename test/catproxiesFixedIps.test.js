'use strict';
// CatProxies ISP and Datacenter plans: from catproxies.com/docs/api (fetched 2026-11-01). Line
// fields come from the docs' own examples; the array key and the ip_list layout are not shown
// there, so both readable layouts are covered. Built from the docs only: never checked live.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

const DEDICATED = { host: '203.0.113.24', port_http: 61234, port_socks: 62234, login: 'ded_4f21ba', password: 'Kq7ZmTx2' };
const CUSTOM = { host: 'us-east.isp.catproxies.com', port_http: 1337, port_socks: 1337, login: 'cpx8f31a2-203.0.113.24', password: 'Rk4pX9wq', ip: '203.0.113.24' };

test('Dedicated ISP uses each line\'s own ports: SOCKS5 is a different number', () => {
  const h = U.catProxiesIspRows({ payload: { lines: [DEDICATED] } }).rows[0];
  assert.deepEqual([h.type, h.host, h.port, h.username, h.password], ['HTTP', '203.0.113.24', 61234, 'ded_4f21ba', 'Kq7ZmTx2']);
  const s = U.catProxiesIspRows({ payload: { lines: [DEDICATED] } }, { socks: true }).rows[0];
  assert.deepEqual([s.type, s.port], ['SOCKS5', 62234]);
});

test('Custom ISP keeps every line, since only the login differs on one host and port', () => {
  const second = { ...CUSTOM, login: 'cpx8f31a2-203.0.113.25', ip: '203.0.113.25' };
  const { rows } = U.catProxiesIspRows({ payload: { proxies: [CUSTOM, second], stale: false, connection_regions: ['us-east'] } });
  assert.equal(rows.length, 2);
  assert.match(rows[1].label, /CatProxies • ISP • 203\.0\.113\.25/);
});

test('the line array is found whatever key holds it, and a bare array works', () => {
  assert.equal(U.catProxiesIspRows([DEDICATED]).rows.length, 1);
  assert.equal(U.catProxiesIspRows({ anything: [DEDICATED], connection_regions: ['a', 'b'] }).rows.length, 1);
});

test('a plan still being set up reports pending instead of no proxies', () => {
  assert.deepEqual(U.catProxiesIspRows({ pending: true }), { rows: [], pending: true });
  assert.deepEqual(U.catProxiesIspRows({ payload: { pending: true } }), { rows: [], pending: true });
});

test('ISP lines without usable details give no rows', () => {
  assert.equal(U.catProxiesIspRows({}).rows.length, 0);
  assert.equal(U.catProxiesIspRows({ lines: [{ ...DEDICATED, login: '' }] }).rows.length, 0);
  assert.equal(U.catProxiesIspRows({ lines: [{ ...DEDICATED, port_socks: null }] }, { socks: true }).rows.length, 0, 'never falls back to the HTTP port');
});

const proxy = { username: 'dcuser482913', password: 'dcpass91827', bandwidth_left: 10 };
const asArray = { payload: { order: { proxy, ip_list: [
  { country: 'US', cities: [{ city: 'Dallas', ips: ['203.0.113.24', '203.0.113.57'] }] },
  { country: 'DE', cities: [{ city: 'Berlin', ips: ['198.51.100.9'] }] }
] } } };

test('Datacenter flattens cities[].ips onto the documented ports', () => {
  const rows = U.catProxiesDatacenterRows(asArray);
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].type, rows[0].host, rows[0].port, rows[0].username, rows[0].password, rows[0].country],
    ['HTTP', '203.0.113.24', 1338, 'dcuser482913', 'dcpass91827', 'US']);
  assert.equal(rows[2].country, 'DE');
  const s = U.catProxiesDatacenterRows(asArray, { socks: true })[0];
  assert.deepEqual([s.type, s.port], ['SOCKS5', 1339]);
});

test('Datacenter also reads an ip_list keyed by country', () => {
  const rows = U.catProxiesDatacenterRows({ payload: { order: { proxy, ip_list: { GB: { cities: [{ ips: ['192.0.2.7'] }] } } } } });
  assert.deepEqual([rows.length, rows[0].host, rows[0].country], [1, '192.0.2.7', 'GB']);
});

test('Datacenter never uses the rotating gateways or proxy.server_ip as a host', () => {
  const rows = U.catProxiesDatacenterRows({ payload: { order: { proxy: { ...proxy, server_ip: '9.9.9.9', rotating: { endpoints: { US: 'dcus.catproxies.com' } } }, ip_list: asArray.payload.order.ip_list } } });
  for (const r of rows) assert.doesNotMatch(r.host, /9\.9\.9\.9|catproxies\.com/);
  assert.equal(U.catProxiesDatacenterRows({ payload: { order: { proxy: {}, ip_list: asArray.payload.order.ip_list } } }).length, 0, 'no credentials, no rows');
  assert.equal(U.catProxiesDatacenterRows({ payload: { order: { proxy } } }).length, 0, 'no IP list, no rows');
});

test('the adapter routes ISP and Datacenter pools and refuses targeting they cannot honour', () => {
  const main = /async function fetchCatProxiesPool\([\s\S]*?\r?\n\}\r?\n/.exec(IPC)[0];
  assert.match(main, /pool === 'isp' \|\| pool === 'datacenter'/);
  const body = /async function fetchCatProxiesFixedIps\([\s\S]*?\r?\n\}\r?\n/.exec(IPC)[0];
  assert.match(body, /\/generator\/isp\?orderId=/);
  assert.match(body, /Authorization: `Bearer \$\{key\}`/);
  assert.match(body, /ISP IPs are fixed when you buy them/);
  assert.match(body, /only Country applies/);
  assert.match(body, /no IPs in \$\{cc\} on that plan/);
  assert.match(body, /still being set up/);
  assert.doesNotMatch(body, /method: '/, 'read-only: a pull never buys or renews');
});

test('the panel offers the new pools and both locales explain them', () => {
  assert.match(UI, /key: 'catproxies'.*\['isp', 'Dedicated or Custom ISP'\], \['datacenter', 'Datacenter'\]/);
  for (const loc of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', loc, 'cmpSettingsC.json'), 'utf8'));
    assert.match(json.proxyProviders.geoHints.catproxies, /Datacenter.*ISP|ISP.*Datacenter/);
    assert.doesNotMatch(json.proxyProviders.geoHints.catproxies, /[–—]/, 'no em or en dashes');
  }
});
