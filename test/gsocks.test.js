'use strict';
// Gsocks connector: endpoints from help.gsocks.net/en/articles/9847111-api-documentation (fetched
// 2026-11-01). The docs show the line format but no sample list body and no proxy object, so the
// fixtures below are shaped from the prose. Built from the docs only: never checked live.
// Auth: the Authorization section and every header table say "authorization: key {api_key}", while the
// curl samples send "session eyJ...". Unsettled until a live key is tried, so the adapter sends the rule
// first (session first for a key that is itself a JWT) and tries the other form once on 401/403.
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

// Runs the real adapter against a fake account: 45 residential lists of 30 lines each.
function ipcFunction(name) {
  return new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`).exec(IPC)[0];
}
function adapter(total = 45, perList = 30) {
  const urls = [];
  const headers = [];
  const httpRequestText = async (url, opts = {}) => {
    urls.push(url);
    headers.push(opts.headers || {});
    const page = /\/proxy\?type=residential&active=active&limit=(\d+)&page=(\d+)$/.exec(url);
    if (page) {
      const size = Number(page[1]);
      const from = (Number(page[2]) - 1) * size;
      const ids = Array.from({ length: Math.max(0, Math.min(size, total - from)) }, (_, i) => ({ id: from + i + 1 }));
      return JSON.stringify({ proxies: ids, count: total });
    }
    const list = /\/proxy\/residential-proxy-list\/(\d+)$/.exec(url);
    if (list) return Array.from({ length: perList }, (_, i) => `residential.gsocks.net:${8000 + i}:u${list[1]}:p${i}`).join('\n');
    throw Object.assign(new Error('unexpected'), { status: 404 });
  };
  const constant = (name) => new RegExp(`^const ${name} = (.+?);`, 'm').exec(IPC)[1];
  const fn = new Function(
    'httpRequestText', 'gsocksProxyIds', 'gsocksListRows', 'gsocksAuthSchemes',
    `const GSOCKS_API = ${constant('GSOCKS_API')};\nconst GSOCKS_POOLS = ${/const GSOCKS_POOLS = (Object\.freeze\(\{[\s\S]*?\}\));/.exec(IPC)[1]};\n`
    + `const GSOCKS_PAGE_SIZE = ${constant('GSOCKS_PAGE_SIZE')};\nconst GSOCKS_MAX_PAGES = ${constant('GSOCKS_MAX_PAGES')};\n`
    + `${['clampPoolCount', 'limitListRows', 'fetchGsocksPool'].map(ipcFunction).join('\n')}\nreturn fetchGsocksPool;`
  )(httpRequestText, U.gsocksProxyIds, U.gsocksListRows, U.gsocksAuthSchemes);
  return { fetchGsocksPool: fn, urls, headers };
}

test('Gsocks pages through every list with the documented page size and key header', async () => {
  const a = adapter();
  const rows = await a.fetchGsocksPool({ token: 'K1', poolType: 'residential', count: '' });
  assert.equal(rows.length, 45 * 30, 'blank How many imports every line');
  const pages = a.urls.filter((u) => u.includes('/proxy?'));
  assert.deepEqual(pages.map((u) => /limit=(\d+)&page=(\d+)/.exec(u).slice(1).join('/')), ['20/1', '20/2', '20/3']);
  assert.ok(a.headers.every((h) => h.authorization === 'key K1'));
});

test('How many stops fetching lists once enough lines are in, with no 500 cap', async () => {
  const a = adapter();
  const rows = await a.fetchGsocksPool({ token: 'K1', poolType: 'residential', count: '75' });
  assert.equal(rows.length, 75);
  assert.equal(a.urls.filter((u) => u.includes('-proxy-list/')).length, 3);
  const b = adapter();
  assert.equal((await b.fetchGsocksPool({ token: 'K1', poolType: 'residential', count: '900' })).length, 900);
});

test('Gsocks is wired and only ever reads', () => {
  const body = /async function fetchGsocksPool\([\s\S]*?\r?\n\}\r?\n/.exec(IPC)[0];
  assert.match(body, /authorization: `\$\{schemes\[0\]\} \$\{key\}`/);
  assert.deepEqual(U.gsocksAuthSchemes('K1'), ['key', 'session'], 'the documented rule first');
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
