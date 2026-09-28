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
  assert.equal(m, 'psx_ab12cd-mbl-us-failover-strict');
  assert.equal(r, 'psx_ab12cd-peer-de-failover-strict');
  for (const u of [m, r]) {
    assert.ok(u.endsWith('-failover-strict'));
    assert.doesNotMatch(u, /-(best|any)-/, 'never a cross-pool fallback pool');
  }
});

test('check 2: sticky rows pin a sid with rot-sticky; rotating rows carry no sid', () => {
  const rotating = U.proxiesSxUsername('psx_ab12cd', { country: 'US' });
  const sticky = U.proxiesSxUsername('psx_ab12cd', { country: 'US', sid: U.proxiesSxSid('shop1') });
  assert.doesNotMatch(rotating, /-sid-|-rot-/);
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

test('Proxies.sx is wired: adapter, both registries and a UI entry', () => {
  assert.ok(IPC.includes('async function fetchProxiesSxPool'));
  assert.match(IPC, /proxiessx:\s*fetchProxiesSxPool/);
  assert.match(IPC, /proxiessx:\s*'Proxies\.sx'/);
  assert.ok(IPC.includes("'X-API-Key': key"), 'authenticates with the X-API-Key header');
  assert.match(UI, /key:\s*'proxiessx'/);
});
