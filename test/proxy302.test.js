'use strict';
// Proxy302 connector: the Open API flow (token -> area/country[/state/city] -> dynamic/traffic)
// verified against the published docs (proxy302.apifox.cn, fetched 2026-10-07; proxy302.com/llms-full.txt,
// fetched 2026-11-03). Gateway proxy.proxy302.com:2222; every response wraps its payload in
// { code, msg, data }.
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

test('proxy302Row reads the current purchase answer, which names the login `username`', () => {
  // Sample from proxy302.apifox.cn (Buy dynamic traffic proxy, 2026-10).
  const body = JSON.stringify({ code: 0, msg: 'success', data: {
    token_id: 410514, username: 'u9wd5t2r', password: 'Zm4nB7cX', host: 'proxy.proxy302.com', port: 2222,
    protocol: 'http', pool_id: 1190, is_api: 1, is_static: false, direct_mysql: true
  } });
  const row = U.proxy302Row(body, { country: 'US' });
  assert.deepEqual([row.host, row.port, row.username, row.password], ['proxy.proxy302.com', 2222, 'u9wd5t2r', 'Zm4nB7cX']);
  assert.throws(() => U.proxy302Row(JSON.stringify({ code: 401, msg: 'invalid API credential', data: null })), /invalid API credential/);
});

test('proxy302AreaId matches a state or city by name or code, without case or spaces', () => {
  const states = JSON.stringify({ code: 0, msg: 'success', data: { data: [
    { id: 5001, name: 'California', code: 'CA', pid: 233 },
    { id: 5002, name: 'New York', code: null, pid: 233 }
  ] } });
  assert.equal(U.proxy302AreaId(states, 'california'), 5001);
  assert.equal(U.proxy302AreaId(states, 'CA'), 5001);
  assert.equal(U.proxy302AreaId(states, 'NewYork'), 5002);
  assert.equal(U.proxy302AreaId(states, 'Texas'), null, 'an unlisted place returns null so the pull can refuse');
  assert.equal(U.proxy302AreaId(states, ''), 0);
});

test('proxy302PurchaseQuery: premium carries state/city, standard carries the session mode', () => {
  const premium = new URLSearchParams(U.proxy302PurchaseQuery({ countryId: 233, stateId: 5001, cityId: 7, lifeMin: 30 }));
  assert.deepEqual(Object.fromEntries(premium), { s: '1', protocol: 'http', country_id: '233', state_id: '5001', city_id: '7' },
    'premium is sticky with a fixed length, so no session fields');
  const rotating = Object.fromEntries(new URLSearchParams(U.proxy302PurchaseQuery({ line: 'standard', socks: true, countryId: 233, stateId: 5 })));
  assert.deepEqual(rotating, { s: '3', protocol: 'socks5', country_id: '233', state_id: '0', city_id: '0', session_mode: 'rotating' });
  for (const [life, want] of [[5, '10'], [10, '10'], [45, '60'], [120, '120'], [1440, '120']]) {
    const q = Object.fromEntries(new URLSearchParams(U.proxy302PurchaseQuery({ line: 'standard', lifeMin: life })));
    assert.equal(q.session_mode, 'sticky');
    assert.equal(q.session_duration, want, `life ${life}`);
  }
});

test('Proxy302 is wired: adapter, API base, registry and panel entry', () => {
  assert.match(IPC, /async function fetchProxy302Pool\(/);
  assert.match(IPC, /proxy302: fetchProxy302Pool/);
  assert.match(IPC, /proxy302: 'Proxy302'/);
  // The API host is proxy302.com (proxy302.com/llms-full.txt); open.proxy302.com, still named in
  // the Apifox server list, answered 404 on every path on 2026-11-03.
  assert.match(IPC, /PROXY302_API = 'https:\/\/proxy302\.com\/open_api\/v3'/);
  assert.doesNotMatch(IPC, /open\.proxy302\.com/);
  // State and City on Premium only, and Standard's four session times (1.0.27 backlog 61).
  assert.match(UI, /key: 'proxy302'.*creds: \['username', 'password'\].*poolType: \[\['premium', 'Premium line'\], \['standard', 'Standard line'\]\].*count: true.*geo: true, geoPools: \['premium'\].*noSession: true.*lifeOptions: \[10, 30, 60, 120\].*proto: true/);
  assert.doesNotMatch(UI, /key: 'proxy302', name: 'Proxy302', unavailable: true/);
});
