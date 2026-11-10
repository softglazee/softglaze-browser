'use strict';
// IPFoxy and MangoProxy connectors, built from each vendor's own docs on 2026-10-07.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');
const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('ipfoxyUsername follows the documented grammar', () => {
  assert.equal(U.ipfoxyUsername('userName'), 'customer-userName');
  assert.equal(U.ipfoxyUsername('customer-userName', { country: 'us', state: 'Florida', city: 'Miami', session: '1691658980_10013' }), 'customer-userName-cc-US-st-Florida-city-Miami-sessid-1691658980_10013');
  assert.equal(U.ipfoxyUsername('customer-authuser', { country: 'US', session: 'x1', ttlMin: 60 }), 'customer-authuser-cc-US-sessid-x1-ttl-60', 'ttl last, only with a session');
  assert.equal(U.ipfoxyUsername('customer-a', { ttlMin: 60 }), 'customer-a', 'no ttl without a session');
  assert.equal(U.ipfoxyUsername('customer-a', { country: 'US', city: 'Los Angeles' }), 'customer-a-cc-US-city-LosAngeles');
});

test('IPFoxy sticky time is 30 or 60 minutes, so other picks snap to one of them', () => {
  // ipfoxy.com/help/docs/session-time: ttl-30 (the default) or ttl-60.
  for (const [ttl, want] of [[5, 30], [10, 30], [30, 30], [45, 60], [60, 60], [120, 60]]) {
    assert.equal(U.ipfoxyUsername('customer-a', { session: 's1', ttlMin: ttl }), `customer-a-sessid-s1-ttl-${want}`, `ttl ${ttl}`);
  }
  assert.equal(U.ipfoxyUsername('customer-a', { session: 's1' }), 'customer-a-sessid-s1', 'no ttl keeps the 30 minute default');
  // The form offers only those two, so 5 or 10 minutes is never picked and turned into 30 (backlog 62).
  assert.match(UI, /key: 'ipfoxy'.*life: true, lifeOptions: \[30, 60\]/);
});

test('mangoProxyRows parses the ProxyUrlDto array', () => {
  const json = [{ http: 'http://a1-zone-custom:pw%40x@p2.mangoproxy.com:2334', socks5: 'socks5://a1-zone-custom:pw%40x@p3.mangoproxy.com:2333' }, { http: 'not a url' }];
  assert.deepEqual(U.mangoProxyRows(json), [{ type: 'HTTP', host: 'p2.mangoproxy.com', port: 2334, username: 'a1-zone-custom', password: 'pw@x' }]);
  assert.deepEqual(U.mangoProxyRows(json, { socks: true }), [{ type: 'SOCKS5', host: 'p3.mangoproxy.com', port: 2333, username: 'a1-zone-custom', password: 'pw@x' }]);
  assert.deepEqual(U.mangoProxyRows(null), []);
});

test('both are wired and Luna Proxy / TiSocks are gone', () => {
  for (const k of ['ipfoxy', 'mangoproxy']) {
    assert.match(IPC, new RegExp(`${k}: fetch\\w+Pool`), k);
    assert.doesNotMatch(UI, new RegExp(`key: '${k}'[^\\n]*unavailable: true`), `${k} is no longer a placeholder`);
  }
  assert.match(IPC, /\/upstream\/json/);
  assert.doesNotMatch(UI, /key: 'luna'|key: 'tisocks'/, 'IPIDEA brand and scanned-SOCKS vendor removed');
  assert.doesNotMatch(IPC, /luna: 'Luna Proxy'|tisocks: 'TiSocks'/);
});
