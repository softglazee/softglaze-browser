'use strict';
// LumiProxy connector: username grammar verified against LumiProxy's own docs/blog
// (lumiproxy.com "How to use lumiproxy", fetched 2026-10-07). Verbatim sticky example:
//   eu.lumiproxy.com:5888:lumi-gdskfh45_area-US_city-Bessemer_life-10_session-u9sBvMSOLO:XXXXXX
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('lumiProxyUsername: bare login rotates worldwide', () => {
  assert.equal(U.lumiProxyUsername('lumi-gdskfh45'), 'lumi-gdskfh45');
  assert.equal(U.lumiProxyUsername(''), '');
});

test('lumiProxyUsername: country is the upper-case area flag after an underscore', () => {
  assert.equal(U.lumiProxyUsername('lumi-x', { country: 'DE' }), 'lumi-x_area-DE');
  assert.equal(U.lumiProxyUsername('lumi-x', { country: 'USA' }), 'lumi-x', 'a non-2-letter country is dropped');
});

test('lumiProxyUsername: state and city are CamelCase and need a country', () => {
  assert.equal(U.lumiProxyUsername('lumi-x', { country: 'us', state: 'California', city: 'Los Angeles' }),
    'lumi-x_area-US_state-California_city-LosAngeles');
  assert.equal(U.lumiProxyUsername('lumi-x', { city: 'Bessemer' }), 'lumi-x', 'city without a country is dropped');
});

test('lumiProxyUsername: sticky grammar matches the documented example exactly', () => {
  assert.equal(
    U.lumiProxyUsername('lumi-gdskfh45', { country: 'US', city: 'Bessemer', session: 'u9sBvMSOLO', lifeMin: 10 }),
    'lumi-gdskfh45_area-US_city-Bessemer_life-10_session-u9sBvMSOLO');
  assert.equal(U.lumiProxyUsername('lumi-x', { session: 'abc' }), 'lumi-x_session-abc', 'session works without a country');
  assert.equal(U.lumiProxyUsername('lumi-x', { session: 'abc', lifeMin: 500 }), 'lumi-x_session-abc', 'an out-of-range life is dropped, not clamped silently');
});

test('LumiProxy is wired: adapter, gateway, registry and panel entry', () => {
  assert.match(IPC, /async function fetchLumiProxyPool\(/);
  assert.match(IPC, /lumiproxy: fetchLumiProxyPool/);
  assert.match(IPC, /lumiproxy: 'LumiProxy'/);
  assert.match(IPC, /host: 'as\.lumiproxy\.com', port: 5888/);
  assert.match(UI, /key: 'lumiproxy'.*creds: \['username', 'password'\].*geo: true.*proto: true.*gateway: true/);
  assert.doesNotMatch(UI, /key: 'lumiproxy', name: 'LumiProxy', unavailable: true/);
});
