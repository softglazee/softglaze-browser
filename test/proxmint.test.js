'use strict';
// Proxmint connector: username grammar verified against the live gateway 2026-10-07
// (gw.proxmint.com:823 HTTP / 824 SOCKS5) and the account-response product picker.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('proxmintUsername: bare login rotates worldwide', () => {
  assert.equal(U.proxmintUsername('abc'), 'abc');
  assert.equal(U.proxmintUsername(''), '');
});

test('proxmintUsername: country is lower-case after a double underscore', () => {
  assert.equal(U.proxmintUsername('abc', { country: 'DE' }), 'abc__cr.de');
  assert.equal(U.proxmintUsername('abc', { country: 'USA' }), 'abc', 'a non-2-letter country is dropped');
});

test('proxmintUsername: state words are joined, city wins over state', () => {
  assert.equal(U.proxmintUsername('abc', { country: 'us', state: 'New York' }), 'abc__cr.us;state.newyork');
  assert.equal(U.proxmintUsername('abc', { country: 'us', state: 'Texas', city: 'Los Angeles' }), 'abc__cr.us;city.losangeles');
  assert.equal(U.proxmintUsername('abc', { state: 'Texas' }), 'abc', 'state/city need a country');
});

test('proxmintUsername: sticky session with clamped ttl, with or without country', () => {
  assert.equal(U.proxmintUsername('abc', { session: 's-1' }), 'abc__sessid.s1;sessttl.30');
  assert.equal(U.proxmintUsername('abc', { country: 'us', session: 'x', ttlMin: 500 }), 'abc__cr.us;sessid.x;sessttl.120');
  assert.equal(U.proxmintUsername('abc', { session: 'x', ttlMin: 0 }), 'abc__sessid.x;sessttl.30');
});

test('proxmintPickProduct: returns the gateway and login of the wanted active product', () => {
  const json = { products: [
    { product: 'residential', name: 'Residential', status: 'active', bandwidth: { remainingBytes: 10 }, proxy: { host: 'gw.proxmint.com', httpPort: 823, socks5Port: 824, username: 'u', password: 'p' } },
    { product: 'mobile', name: 'Mobile', status: 'expired', proxy: {} }
  ] };
  const r = U.proxmintPickProduct(json, 'residential');
  assert.equal(r.host, 'gw.proxmint.com'); assert.equal(r.httpPort, 823); assert.equal(r.socksPort, 824);
  assert.equal(r.username, 'u'); assert.equal(r.password, 'p'); assert.equal(r.remainingBytes, 10);
  assert.throws(() => U.proxmintPickProduct(json, 'mobile'), /no active mobile product.*Mobile \(expired\)/);
  assert.throws(() => U.proxmintPickProduct({ products: [] }, 'residential'), /no products yet/);
});

test('Proxmint is wired: adapter, registry and panel entry', () => {
  assert.match(IPC, /async function fetchProxmintPool\(/);
  assert.match(IPC, /proxmint: fetchProxmintPool/);
  assert.match(IPC, /proxmint: 'Proxmint'/);
  assert.match(IPC, /\^pmk_/, 'the key format is validated before any request');
  assert.match(UI, /key: 'proxmint'.*creds: \['token'\].*geo: true.*proto: true/);
});
