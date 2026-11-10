'use strict';
// Proxies.sx connector (built in house; PR #11 was only a reference). Pool gateway
// gw.proxies.sx:7000 HTTP. Username: psx_<acct>-<pool>-<cc>[-sid-<id>-rot-sticky]-failover-strict.
// Their two acceptance checks are asserted here:
//  1. An unavailable country must FAIL, never fall back: a country is required, one pool only
//     (mbl or peer, never best/any), and every row carries failover-strict.
//  2. Keeping a session is distinct from rotating: sticky rows pin a sid with rot-sticky;
//     rotating rows carry no sid; a new session name is an explicit rotate.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('check 1: no country means no proxy, and every row is strict on a single pool', () => {
  assert.equal(U.proxiesSxUsername('psx_ab12cd', { poolType: 'mobile' }), '', 'no country -> nothing is minted');
  assert.equal(U.proxiesSxUsername('psx_ab12cd', { country: 'any' }), '', '"any" is not a country');
  const m = U.proxiesSxUsername('psx_ab12cd', { poolType: 'mobile', country: 'US' });
  const r = U.proxiesSxUsername('psx_ab12cd', { poolType: 'residential', country: 'de' });
  assert.equal(m, 'psx_ab12cd-mbl-us-rot-ondemand-failover-strict');
  // peer mixes residential and mobile devices, so Residential adds the hard -iptype-residential filter.
  assert.equal(r, 'psx_ab12cd-peer-de-iptype-residential-rot-ondemand-failover-strict');
  for (const u of [m, r]) {
    assert.ok(u.endsWith('-failover-strict'));
    assert.doesNotMatch(u, /-(best|any)-/, 'never a cross-pool fallback pool');
  }
});

test('check 2: sticky rows pin a sid with rot-sticky; rotating rows carry no sid', () => {
  const rotating = U.proxiesSxUsername('psx_ab12cd', { country: 'US' });
  const sticky = U.proxiesSxUsername('psx_ab12cd', { country: 'US', sid: U.proxiesSxSid('shop1') });
  // Without a rot token the gateway default is auto10 (a new exit every 10 minutes), so a rotating
  // row names ondemand, a new endpoint per connection (agents.proxies.sx/pool/skill.md, DSL table).
  assert.doesNotMatch(rotating, /-sid-/);
  assert.match(rotating, /-rot-ondemand-/);
  assert.match(sticky, /^psx_ab12cd-mbl-us-sid-[a-z0-9_]{8,64}-rot-sticky-failover-strict$/);
  const a = U.proxiesSxUsername('psx_ab12cd', { country: 'US', sid: U.proxiesSxSid('shop1') });
  const b = U.proxiesSxUsername('psx_ab12cd', { country: 'US', sid: U.proxiesSxSid('shop2') });
  assert.equal(sticky, a, 'the same session name keeps the same username (same IP)');
  assert.notEqual(a, b, 'a new session name is an explicit rotate');
});

test('proxiesSxSid is gateway-safe: lowercase, no hyphens, 8-64 chars', () => {
  for (const [input, idx] of [['a', null], ['Shop-1', 3], ['x'.repeat(90), null], ['', 1]]) {
    const sid = U.proxiesSxSid(input, idx);
    assert.match(sid, /^[a-z0-9_]{8,64}$/, `bad sid for ${input}: ${sid}`);
  }
});

test('proxiesSxProxyCreds reads the documented and alternative shapes', () => {
  assert.deepEqual(U.proxiesSxProxyCreds('{"proxyUsername":"psx_ab12cd","proxyPassword":"secret1"}'), { username: 'psx_ab12cd', password: 'secret1' });
  assert.deepEqual(U.proxiesSxProxyCreds({ data: { username: 'psx_x1', password: 'p' } }), { username: 'psx_x1', password: 'p' });
  assert.deepEqual(U.proxiesSxProxyCreds('not json'), { username: '', password: '' });
});

test('state (2-letter code) and city ride on the Residential pool only', () => {
  assert.equal(
    U.proxiesSxUsername('psx_ab12cd', { poolType: 'residential', country: 'US', state: 'CA', city: 'Los Angeles', sid: 'shop_0001' }),
    'psx_ab12cd-peer-us-iptype-residential-state-ca-city-losangeles-sid-shop_0001-rot-sticky-failover-strict');
  assert.equal(U.proxiesSxUsername('psx_ab12cd', { poolType: 'residential', country: 'US', state: 'California' }),
    'psx_ab12cd-peer-us-iptype-residential-rot-ondemand-failover-strict', 'a full state name is not a region code');
  assert.equal(U.proxiesSxUsername('psx_ab12cd', { poolType: 'mobile', country: 'US', state: 'ca', city: 'x' }),
    'psx_ab12cd-mbl-us-rot-ondemand-failover-strict', 'modems never match state or city');
});

test('proxiesSxStock reads the public stock counts per pool and country', () => {
  const body = JSON.stringify({ pools: { mbl: { us: 27, gb: 20 }, peer: { de: 310, al: 5 } }, totals: { mbl: 47 } });
  assert.equal(U.proxiesSxStock(body, 'mobile', 'US'), 27);
  assert.equal(U.proxiesSxStock(body, 'residential', 'de'), 310);
  assert.equal(U.proxiesSxStock(body, 'mobile', 'DE'), 0, 'a country left out has no stock');
  assert.equal(U.proxiesSxStock('{"totals":{}}', 'mobile', 'US'), null, 'unknown shape skips the check');
  assert.equal(U.proxiesSxStock('nope', 'mobile', 'US'), null);
  assert.deepEqual([...U.PROXIESSX_MOBILE_COUNTRIES], ['US', 'GB', 'FR', 'NL', 'PL', 'GE']);
  assert.equal(U.PROXIESSX_MAX_SESSIONS, 250);
});

test('Proxies.sx is wired: adapter, both registries and a UI entry', () => {
  assert.ok(IPC.includes('async function fetchProxiesSxPool'));
  assert.match(IPC, /proxiessx:\s*fetchProxiesSxPool/);
  assert.match(IPC, /proxiessx:\s*'Proxies\.sx'/);
  assert.ok(IPC.includes("'X-API-Key': key"), 'authenticates with the X-API-Key header');
  // GET /v1/account/proxy-password is documented (scope account:read) next to the PATCH that sets it.
  assert.match(IPC, /httpRequestText\(`\$\{PROXIESSX_API\}\/account\/proxy-password`, \{ headers:/);
  assert.match(UI, /key:\s*'proxiessx'.*poolType: \[\['residential', 'Residential \(peers\)'\], \['mobile'.*geo: true.*proto: true/);
});
