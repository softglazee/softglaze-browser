'use strict';
// Gsocks connector: endpoints from help.gsocks.net/en/articles/9847111-api-documentation (fetched
// 2026-11-01). The docs show the line format but no sample list body and no proxy object, so the
// fixtures below are shaped from the prose. Built from the docs only: never checked live.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

test('gsocksProxyIds reads ids and the total', () => {
  assert.deepEqual(U.gsocksProxyIds({ proxies: [{ id: 12345 }, { id: '77' }], count: 9 }), { ids: ['12345', '77'], listed: 2, total: 9 });
  assert.deepEqual(U.gsocksProxyIds('{"proxies":[{"id":1}]}'), { ids: ['1'], listed: 1, total: 1 });
});

test('a proxy with no readable id is counted but yields no id, so the adapter can say so', () => {
  assert.deepEqual(U.gsocksProxyIds({ proxies: [{ name: 'x' }, { id: 'a/b' }], count: 2 }), { ids: [], listed: 2, total: 2 });
  assert.deepEqual(U.gsocksProxyIds('nope'), { ids: [], listed: 0, total: 0 });
});

test('gsocksListRows parses host:port:user:pass lines', () => {
  const rows = U.gsocksListRows('residential.gsocks.net:8000:u1:p1\nresidential.gsocks.net:8001:u1:p:with:colons\n', { kind: 'Residential', id: '12345' });
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].type, rows[0].host, rows[0].port, rows[0].username, rows[0].password], ['HTTP', 'residential.gsocks.net', 8000, 'u1', 'p1']);
  assert.equal(rows[1].password, 'p:with:colons');
  assert.match(rows[0].label, /Gsocks • Residential • #12345/);
});

test('a <br> separated list, and a wrapped list, parse the same', () => {
  assert.equal(U.gsocksListRows('h.example.net:1:u:p<br>h.example.net:2:u:p').length, 2);
  assert.equal(U.gsocksListRows('{"List":"h.example.net:1:u:p\\nh.example.net:2:u:p"}').length, 2);
  assert.equal(U.gsocksListRows({ List: 'h.example.net:1:u:p' }).length, 1);
});

test('duplicate lines collapse, and rows that differ only by password stay apart', () => {
  assert.equal(U.gsocksListRows('h.example.net:1:u:p\nh.example.net:1:u:p').length, 1);
  const rows = U.gsocksListRows('h.example.net:1:u:p1\nh.example.net:1:u:p2');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dedupeOnPassword, true);
});

test('anything that is not the documented line format gives no row', () => {
  assert.equal(U.gsocksListRows('<html>error</html>').length, 0);
  assert.equal(U.gsocksListRows('h.example.net:80').length, 0);
  assert.equal(U.gsocksListRows('u:p@h.example.net:80').length, 0);
  assert.equal(U.gsocksListRows('h.example.net:notaport:u:p').length, 0);
  assert.equal(U.gsocksListRows('{"error":"x"}').length, 0);
});

test('Gsocks is wired and only ever reads', () => {
  const body = /async function fetchGsocksPool\([\s\S]*?\r?\n\}\r?\n/.exec(IPC)[0];
  assert.match(body, /authorization: `key \$\{key\}`/);
  assert.doesNotMatch(body, /method: 'POST'/, 'a pull must never create or buy a proxy');
  assert.match(IPC, /gsocks: fetchGsocksPool/);
  assert.match(IPC, /gsocks: 'Gsocks'/);
  assert.match(UI, /key: 'gsocks'.*creds: \['token'\].*list: true.*\['residential', 'Residential'\], \['mobile', 'Mobile'\]/);
  for (const loc of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', loc, 'cmpSettingsC.json'), 'utf8'));
    assert.equal(typeof json.proxyProviders.geoHints.gsocks, 'string', loc);
    assert.doesNotMatch(json.proxyProviders.geoHints.gsocks, /[–—]/, 'no em or en dashes');
  }
});
