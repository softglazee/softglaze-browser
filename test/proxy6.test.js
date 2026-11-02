'use strict';
// PROXY6 connector: response shape from proxy6.net/en/developers (fetched 2026-11-01); the fixture
// is that page's example row. Built from the docs only: never checked against a live account.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');
const NOW = 1735700000000;

const ROW = {
  id: '101', version: '6', ip: '2001:db8::1', host: '192.0.2.10', port: '8080', user: 'exampleUser', pass: 'examplePass',
  type: 'auto', country: 'ru', unixtime: 1735689600, unixtime_end: 1738368000, active: '1'
};
const ok = (list) => ({ status: 'yes', list_count: list.length, list });

test('the documented row connects to host, not the exit ip', () => {
  const r = U.proxy6Page(ok({ 101: ROW }), { now: NOW });
  const row = r.rows[0];
  assert.deepEqual([row.type, row.host, row.port, row.username, row.password, row.country], ['HTTP', '192.0.2.10', 8080, 'exampleUser', 'examplePass', 'RU']);
  assert.match(row.label, /PROXY6 • IPv6 • RU • #101/);
  assert.equal(r.listCount, 1);
});

test('both the keyed list and the nokey array parse', () => {
  assert.equal(U.proxy6Page(ok({ 101: ROW }), { now: NOW }).rows.length, 1);
  assert.equal(U.proxy6Page(JSON.stringify(ok([ROW])), { now: NOW }).rows.length, 1);
});

test('the protocol of a line is honoured; auto serves both', () => {
  assert.equal(U.proxy6Page(ok([ROW]), { socks: true, now: NOW }).rows[0].type, 'SOCKS5');
  const http = { ...ROW, type: 'http' };
  const r = U.proxy6Page(ok([http]), { socks: true, now: NOW });
  assert.deepEqual([r.rows.length, r.skippedProtocol], [0, 1], 'an http line is not relabelled as SOCKS5');
  assert.equal(U.proxy6Page(ok([{ ...ROW, type: 'socks' }]), { now: NOW }).rows.length, 0);
  assert.equal(U.proxy6Page(ok([{ ...ROW, type: 'socks' }]), { socks: true, now: NOW }).rows.length, 1);
});

test('MTProto, inactive and expired lines are left out', () => {
  assert.equal(U.proxy6Page(ok([{ ...ROW, version: '5' }]), { now: NOW }).rows.length, 0);
  assert.equal(U.proxy6Page(ok([{ ...ROW, active: '0' }]), { now: NOW }).rows.length, 0);
  assert.equal(U.proxy6Page(ok([{ ...ROW, unixtime_end: 1 }]), { now: NOW }).rows.length, 0);
});

test('a status "no" reply with HTTP 200 becomes a clear error', () => {
  assert.match(U.proxy6Page({ status: 'no', error_id: 100, error: 'Error key' }).error, /rejected the API key/);
  assert.match(U.proxy6Page({ status: 'no', error_id: 105, error: 'Error ip' }).error, /IP restriction/);
  assert.match(U.proxy6Page({ status: 'no', error_id: 30, error: 'Error unknown' }).error, /Error unknown \(code 30\)/);
  assert.match(U.proxy6Page('<html>').error, /did not return JSON/);
});

// Runs the real adapter against a fake account of `pages` (proxies per page; 1000 is a full page).
function ipcFunction(name) {
  return new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`).exec(IPC)[0];
}
function adapter(pages, countryOf = () => 'us') {
  const urls = [];
  const sleeps = [];
  let id = 0;
  const httpRequestText = async (url) => {
    urls.push(url);
    const page = Number(/&page=(\d+)$/.exec(url)[1]);
    const list = Array.from({ length: pages[page - 1] || 0 }, () => {
      id += 1;
      return { ...ROW, id: String(id), port: String(10000 + id), country: countryOf(id) };
    });
    return JSON.stringify(ok(list));
  };
  const constant = (name) => new RegExp(`^const ${name} = (.+?);`, 'm').exec(IPC)[1];
  const fn = new Function(
    'httpRequestText', 'proxy6Page', 'sleepMs',
    `const PROXY6_API = ${constant('PROXY6_API')};\nconst PROXY6_PAGE_SIZE = ${constant('PROXY6_PAGE_SIZE')};\nconst PROXY6_PAGE_GAP_MS = ${constant('PROXY6_PAGE_GAP_MS')};\n`
    + `${['normCountryCode', 'clampPoolCount', 'limitListRows', 'fetchProxy6Pool'].map(ipcFunction).join('\n')}\nreturn fetchProxy6Pool;`
  )(httpRequestText, (body, opts) => U.proxy6Page(body, { ...opts, now: NOW }), async (ms) => { sleeps.push(ms); });
  return { fetchProxy6Pool: fn, urls, sleeps };
}

test('pages of 1000 are followed to the end, with a pause for the 3-a-second limit', async () => {
  const a = adapter([1000, 1000, 300]);
  const rows = await a.fetchProxy6Pool({ token: 'abcdef12', count: '' });
  assert.equal(rows.length, 2300);
  assert.equal(a.urls.length, 3);
  assert.ok(a.urls.every((u) => /limit=1000&page=\d$/.test(u)));
  assert.deepEqual(a.sleeps, [350, 350], 'no more than 3 requests a second');
});

test('paging stops once How many is reached, counting only the chosen country', async () => {
  const a = adapter([1000, 1000, 300]);
  assert.equal((await a.fetchProxy6Pool({ token: 'abcdef12', count: '1200' })).length, 1200);
  assert.equal(a.urls.length, 2);
  const b = adapter([1000, 1000, 300]);
  assert.equal((await b.fetchProxy6Pool({ token: 'abcdef12', count: '750' })).length, 750, 'no 500 cap');
  assert.equal(b.urls.length, 1);
  const c = adapter([1000, 1000, 300], (i) => (i % 100 === 0 ? 'de' : 'us'));
  const de = await c.fetchProxy6Pool({ token: 'abcdef12', country: 'DE', count: '15' });
  assert.deepEqual([de.length, c.urls.length], [15, 2]);
  assert.ok(de.every((r) => r.country === 'DE'));
});

test('PROXY6 is wired, read-only, and uses the documented method', () => {
  const body = /async function fetchProxy6Pool\([\s\S]*?\r?\n\}\r?\n/.exec(IPC)[0];
  assert.match(body, /\/getproxy\/\?state=active&nokey&limit=/);
  assert.doesNotMatch(body, /\/(buy|prolong|delete|settype|setdescr)\b/);
  assert.doesNotMatch(body, /error\.message/, 'the key is in the URL, so a transport error is never echoed');
  assert.match(IPC, /const PROXY6_API = 'https:\/\/px6\.link\/api'/);
  assert.match(IPC, /proxy6: fetchProxy6Pool/);
  assert.match(IPC, /proxy6: 'PROXY6'/);
  assert.match(UI, /key: 'proxy6'.*creds: \['token'\].*list: true.*proto: true/);
  for (const loc of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', loc, 'cmpSettingsC.json'), 'utf8'));
    assert.equal(typeof json.proxyProviders.geoHints.proxy6, 'string', loc);
    assert.doesNotMatch(json.proxyProviders.geoHints.proxy6, /[–—]/, 'no em or en dashes');
  }
});
