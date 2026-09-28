'use strict';
// NOVADA connector. Grammar from developer.novada.com location/session pages and the live
// dashboard endpoint generator (2026-09-29): gateway super.novada.pro:7777, a proxy user,
//   <user>-zone-<res|isp|mob>[-region-cc[-st-x][-city-y]][-session-id-sessTime-min] (max 120).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('novadaUsername builds zone, region, state, city and session in order', () => {
  assert.equal(U.novadaUsername('u1', {}), 'u1-zone-res', 'residential is the default zone');
  assert.equal(U.novadaUsername('u1', { poolType: 'isp' }), 'u1-zone-isp');
  assert.equal(U.novadaUsername('u1', { poolType: 'mobile' }), 'u1-zone-mob');
  assert.equal(U.novadaUsername('u1', { country: 'US' }), 'u1-zone-res-region-us');
  assert.equal(U.novadaUsername('u1', { country: 'gb', state: 'England', city: 'London' }), 'u1-zone-res-region-gb-st-england-city-london');
  assert.equal(U.novadaUsername('u1', { country: 'US', city: 'New York' }), 'u1-zone-res-region-us-city-newyork', 'city may be used without a state');
});

test('novadaUsername session: sessTime defaults to 10, caps at 120, needs a session', () => {
  assert.equal(U.novadaUsername('u1', { session: 'abc' }), 'u1-zone-res-session-abc-sessTime-10');
  assert.equal(U.novadaUsername('u1', { session: 'abc', lifeMin: 5 }), 'u1-zone-res-session-abc-sessTime-5');
  assert.equal(U.novadaUsername('u1', { session: 'abc', lifeMin: 1440 }), 'u1-zone-res-session-abc-sessTime-120');
  assert.equal(U.novadaUsername('u1', { lifeMin: 30 }), 'u1-zone-res', 'no session = rotating, no sessTime');
  assert.equal(U.novadaUsername('u1', { state: 'texas' }), 'u1-zone-res', 'state needs a country');
});

test('NOVADA is wired: adapter, both registries and a UI entry', () => {
  assert.ok(IPC.includes('async function fetchNovadaPool'));
  assert.match(IPC, /novada:\s*fetchNovadaPool/);
  assert.match(IPC, /novada:\s*'NOVADA'/);
  assert.ok(IPC.includes("host: 'super.novada.pro', port: 7777"));
  assert.ok(IPC.includes('Your login email does not work here'), 'explains proxy user vs login email');
  assert.match(UI, /key:\s*'novada'/);
});
