'use strict';
// Proxy302 connector: the Open API flow (token -> area/country -> dynamic/traffic) verified
// against the published docs (proxy302.apifox.cn, fetched 2026-10-07). Gateway
// proxy.proxy302.com:2222; every response wraps its payload in { code, msg, data }.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('proxy302Token: returns the verbatim Basic token, throws the vendor message otherwise', () => {
  assert.equal(U.proxy302Token(JSON.stringify({ code: 0, msg: 'success', data: { token: 'Basic cHJ123' } })), 'Basic cHJ123');
  assert.throws(() => U.proxy302Token(JSON.stringify({ code: 10001, msg: 'invalid key' })), /invalid key/);
  assert.throws(() => U.proxy302Token('not json'), /did not return JSON/);
});

test('proxy302CountryId: maps ISO code to numeric id, 0 for any, null when unlisted', () => {
  const body = JSON.stringify({ code: 0, msg: 'success', data: { data: [
    { id: 232, name: 'United Kingdom', code: 'GB' },
    { id: 233, name: 'United States', code: 'US' }
  ] } });
  assert.equal(U.proxy302CountryId(body, 'US'), 233);
  assert.equal(U.proxy302CountryId(body, 'gb'), 232);
  assert.equal(U.proxy302CountryId('ignored when no country', ''), 0, 'any = country_id 0, no parse needed');
  assert.equal(U.proxy302CountryId(body, 'FR'), null, 'an unlisted country returns null so the pull can refuse');
});

test('proxy302Row: builds a pool row from the dynamic response, HTTP or SOCKS5', () => {
  const body = JSON.stringify({ code: 0, msg: 'succeed', data: {
    token_id: 3000002, ip: '-', host: 'proxy.proxy302.com', port: 2222, user_name: 'kUser', password: 'pPass', protocol: 'http'
  } });
  assert.deepEqual(U.proxy302Row(body, { country: 'US' }), {
    type: 'HTTP', host: 'proxy.proxy302.com', port: 2222, username: 'kUser', password: 'pPass',
    label: 'Proxy302 • Residential • US', country: 'US'
  });
  assert.equal(U.proxy302Row(body, { socks: true }).type, 'SOCKS5');
  assert.equal(U.proxy302Row(JSON.stringify({ code: 0, data: { host: '', port: 0 } })), null, 'an empty endpoint is rejected');
});

test('Proxy302 is wired: adapter, API base, registry and panel entry', () => {
  assert.match(IPC, /async function fetchProxy302Pool\(/);
  assert.match(IPC, /proxy302: fetchProxy302Pool/);
  assert.match(IPC, /proxy302: 'Proxy302'/);
  assert.match(IPC, /PROXY302_API = 'https:\/\/open\.proxy302\.com\/open_api\/v3'/);
  assert.match(UI, /key: 'proxy302'.*creds: \['username', 'password'\].*count: true.*proto: true/);
  assert.doesNotMatch(UI, /key: 'proxy302', name: 'Proxy302', unavailable: true/);
});
