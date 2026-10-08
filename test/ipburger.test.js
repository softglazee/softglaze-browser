'use strict';
// IP Burger connector: username grammar verified against IPBurger's own residential product
// page (ipburger.com/residential-proxies, fetched 2026-10-07). Verbatim examples:
//   customer-a1b2c3d4e5-cc-US
//   customer-a1b2c3d4e5-city-washington-sessid-cFNk-sesstime-30
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('ipBurgerBaseUser: keeps the customer-<id> base from a full username', () => {
  assert.equal(U.ipBurgerBaseUser('customer-a1b2c3d4e5-city-washington-sessid-cFNk-sesstime-30'), 'customer-a1b2c3d4e5');
  assert.equal(U.ipBurgerBaseUser('customer-a1b2c3d4e5'), 'customer-a1b2c3d4e5');
  assert.equal(U.ipBurgerBaseUser('a1b2c3d4e5'), 'customer-a1b2c3d4e5', 'a bare id is prefixed');
  assert.equal(U.ipBurgerBaseUser(''), '');
});

test('ipBurgerUsername: country-wide uses cc, matching the documented example', () => {
  assert.equal(U.ipBurgerUsername('customer-a1b2c3d4e5', { country: 'US' }), 'customer-a1b2c3d4e5-cc-US');
  assert.equal(U.ipBurgerUsername('customer-x', { country: 'USA' }), 'customer-x', 'a non-2-letter country is dropped');
});

test('ipBurgerUsername: a city or state narrows and replaces cc, and needs a country', () => {
  assert.equal(U.ipBurgerUsername('customer-a1b2c3d4e5', { country: 'US', city: 'Washington' }), 'customer-a1b2c3d4e5-city-washington');
  assert.equal(U.ipBurgerUsername('customer-x', { country: 'GB', state: 'England' }), 'customer-x-state-england');
  assert.equal(U.ipBurgerUsername('customer-x', { city: 'Washington' }), 'customer-x', 'a city without a country is dropped');
});

test('ipBurgerUsername: sticky grammar matches the documented example, sesstime capped at 30', () => {
  assert.equal(
    U.ipBurgerUsername('customer-a1b2c3d4e5', { country: 'US', city: 'Washington', session: 'cFNk', sesstimeMin: 30 }),
    'customer-a1b2c3d4e5-city-washington-sessid-cFNk-sesstime-30');
  assert.equal(U.ipBurgerUsername('customer-x', { session: 'a', sesstimeMin: 999 }), 'customer-x-sessid-a-sesstime-30');
  assert.equal(U.ipBurgerUsername(''), '');
});

test('IP Burger is wired: adapter, gateway, registry and panel entry', () => {
  assert.match(IPC, /async function fetchIpBurgerPool\(/);
  assert.match(IPC, /ipburger: fetchIpBurgerPool/);
  assert.match(IPC, /ipburger: 'IP Burger'/);
  assert.match(IPC, /host: 'residential\.ipb\.cloud', port: 7777/);
  assert.match(UI, /key: 'ipburger'.*creds: \['username', 'password'\].*geo: true.*session: true.*maxLife: 30.*gateway: true/);
  assert.doesNotMatch(UI, /key: 'ipburger', name: 'IP Burger', unavailable: true/);
});
