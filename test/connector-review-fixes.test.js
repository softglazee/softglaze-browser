'use strict';
// Regression tests for the 7 Oct 2026 connector review (Froxy dedupe, Live Proxies and
// Proxies.sx session ids, Bright Data port + login, CatProxies mobile SOCKS5, panel flags).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');
const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('Proxies.sx: short session names never pad into the same id', () => {
  const ids = new Set();
  for (let i = 1; i <= 100; i++) ids.add(U.proxiesSxSid('ab', i));
  assert.equal(ids.size, 100, 'every index gets its own sid');
  assert.notEqual(U.proxiesSxSid('ab', 1), U.proxiesSxSid('ab', 10));
  for (const id of ids) assert.ok(id.length >= 8);
  // The adapter numbers sessions itself (mintGatewayRows: 'ab1'..'ab100') before calling this.
  const minted = new Set(Array.from({ length: 100 }, (_, i) => U.proxiesSxSid(`ab${i + 1}`)));
  assert.equal(minted.size, 100, 'pre-numbered short sessions stay distinct');
});

test('Froxy rows dedupe on the password, where country and pool type live', () => {
  const body = IPC.slice(IPC.indexOf('async function fetchFroxyPool('), IPC.indexOf('// --- PacketStream'));
  assert.match(body, /dedupeOnPassword: true/);
});

// 1.0.27 backlog 28: a typed session is used as typed on one row; one that would run past 8 digits
// with the row number is refused with a message instead of being cut (test/connectorsVendors1.test.js
// runs it).
test('Live Proxies never cuts a typed session to fit the index', () => {
  assert.doesNotMatch(IPC, /typed\.slice\(0, Math\.max\(1, 8 - String\(n\)\.length\)\)/);
  assert.doesNotMatch(IPC, /`\$\{typed\}\$\{i \+ 1\}`\.slice\(0, 8\)/);
  assert.match(IPC, /const sid = typed \? \(n > 1 \? `\$\{typed\}\$\{i \+ 1\}` : typed\) : randomSid\(\);/);
});

test('Bright Data uses port 44445 and refuses a login without the customer id', () => {
  assert.doesNotMatch(IPC + UI, /port: (22225|33335)\b/, 'ports 22225/33335 were retired on 25 Sep 2026');
  assert.match(IPC, /port: 44445/);
  // The login check moved into brightDataZoneUser; the adapter refuses when it returns null.
  assert.equal(U.brightDataZoneUser('brd-zone-residential'), null);
  assert.equal(U.brightDataZoneUser('myuser'), null);
  assert.equal(U.brightDataZoneUser('brd-customer-hl_1234-zone-isp1').base, 'brd-customer-hl_1234-zone-isp1');
  assert.match(IPC, /if \(!zoneUser\) throw new Error\('Bright Data: enter the proxy username from the zone/);
});

test('CatProxies Rotating Mobile refuses SOCKS5 instead of returning HTTP rows', () => {
  assert.match(IPC, /Rotating Mobile is HTTP only/);
});

test('panel flags match what the adapters read', () => {
  assert.match(UI, /key: 'shopsocks5'.*noSession: true/, 'ShopSocks5 never reads a session');
  // Per-GB usernames carry -co-/-st-/-ci- (help.proxidize.com), so Proxidize now shows the geo fields.
  assert.doesNotMatch(UI, /key: 'proxidize'.*noCountry: true/, 'Proxidize Per-GB reads country/state/city');
  assert.match(UI, /key: 'proxidize'.*geo: true/);
  for (const k of ['airproxy', 'mobileproxyspace', 'proxysolutions']) assert.match(UI, new RegExp(`key: '${k}'.*list: true`), k);
  for (const [k, m] of [['novada', 120], ['rapidproxy', 180], ['proxmint', 120], ['databay', 120]]) assert.match(UI, new RegExp(`key: '${k}'.*maxLife: ${m}`), k);
  // The options follow the chosen pool as well (maxLifeByPool: NOVADA's Rotating ISP), 1.0.27 backlog 11.
  assert.match(UI, /lifeOptionsFor\(provider\.geoSync \|\| \{\}, poolType\)/, 'Keep same IP offers only what the vendor accepts (src/renderer/lib/gatewayPull.mjs)');
  assert.match(UI, /\{lifeValuesFor\(form\.poolType\)\.map\(/);
  assert.doesNotMatch(UI, /up to 500/, 'no promise the adapters do not keep');
});
