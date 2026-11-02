'use strict';
// Proxy Bonanza connector: response shape from proxybonanza.com/en/articles/api-reference-1
// (fetched 2026-11-01); the fixture is that page's example. Built from the docs only: never
// checked against a live account.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

const ROW = {
  ip: '203.0.113.10', outgoing_ip: '203.0.113.10', port_http: 8080, port_socks: 1080, login: 'login11', password: 'secretpass',
  countrycode: 'PL', georegion_name: 'Warsaw', userpackage_id: 123456, country_name: 'Poland'
};

test('the documented row maps to one proxy per protocol', () => {
  const h = U.proxyBonanzaRows({ success: true, data: [ROW] }).rows[0];
  assert.deepEqual([h.type, h.host, h.port, h.username, h.password, h.country], ['HTTP', '203.0.113.10', 8080, 'login11', 'secretpass', 'PL']);
  assert.match(h.label, /Proxy Bonanza • Warsaw, PL/);
  const s = U.proxyBonanzaRows(JSON.stringify({ success: true, data: [ROW] }), { socks: true }).rows[0];
  assert.deepEqual([s.type, s.port], ['SOCKS5', 1080]);
});

test('the documented error envelope surfaces its message', () => {
  const r = U.proxyBonanzaRows({ success: false, data: { message: 'Authentication is required to continue', code: 401 } });
  assert.deepEqual(r.rows, []);
  assert.equal(r.error, 'Authentication is required to continue');
});

test('bad bodies give an error or no rows, never invented ones', () => {
  assert.match(U.proxyBonanzaRows('<html>').error, /did not return JSON/);
  assert.equal(U.proxyBonanzaRows({ success: true, data: [{ ip: '1.2.3.4' }] }).rows.length, 0);
  assert.equal(U.proxyBonanzaRows({ success: true, data: [{ ...ROW, port_socks: null }] }, { socks: true }).rows.length, 0, 'no fallback to the HTTP port');
});

test('an unavailable country is an error that names what the account has', () => {
  const body = /async function fetchProxyBonanzaPool\([\s\S]*?\r?\n\}\r?\n/.exec(IPC)[0];
  assert.match(body, /no proxies in \$\{cc\} on your plans/);
  assert.match(body, /is not a country code/);
});

// The documented list is not paginated, so How many only trims it.
test('How many trims the plan list with no 500 cap, after the country filter', async () => {
  const ipcFunction = (name) => new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`).exec(IPC)[0];
  const data = Array.from({ length: 800 }, (_, i) => ({ ...ROW, ip: `203.0.${Math.floor(i / 250)}.${i % 250}`, countrycode: i % 2 ? 'PL' : 'DE' }));
  const fetchProxyBonanzaPool = new Function('httpRequestText', 'proxyBonanzaRows', 'PROXYBONANZA_API',
    `${['normCountryCode', 'clampPoolCount', 'limitListRows', 'fetchProxyBonanzaPool'].map(ipcFunction).join('\n')}\nreturn fetchProxyBonanzaPool;`
  )(async () => JSON.stringify({ success: true, data }), U.proxyBonanzaRows, 'https://proxybonanza.com/api/v1');
  const key = `${'a'.repeat(50)}!42`;
  assert.equal((await fetchProxyBonanzaPool({ token: key, count: '750' })).length, 750);
  assert.equal((await fetchProxyBonanzaPool({ token: key, count: '' })).length, 800);
  const pl = await fetchProxyBonanzaPool({ token: key, country: 'PL', count: '' });
  assert.deepEqual([pl.length, pl.every((r) => r.country === 'PL')], [400, true]);
});

test('Proxy Bonanza is wired: key in the header, adapter, registry, panel entry and hints', () => {
  const body = /async function fetchProxyBonanzaPool\([\s\S]*?\r?\n\}\r?\n/.exec(IPC)[0];
  assert.match(body, /Authorization: key/);
  assert.doesNotMatch(body, /method: '/, 'read-only');
  assert.match(IPC, /const PROXYBONANZA_API = 'https:\/\/proxybonanza\.com\/api\/v1'/);
  assert.match(IPC, /proxybonanza: fetchProxyBonanzaPool/);
  assert.match(IPC, /proxybonanza: 'Proxy Bonanza'/);
  assert.match(UI, /key: 'proxybonanza'.*creds: \['token'\].*list: true.*proto: true/);
  for (const loc of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', loc, 'cmpSettingsC.json'), 'utf8'));
    assert.equal(typeof json.proxyProviders.geoHints.proxybonanza, 'string', loc);
    assert.doesNotMatch(json.proxyProviders.geoHints.proxybonanza, /[–—]/, 'no em or en dashes');
  }
});
