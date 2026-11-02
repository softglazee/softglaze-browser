'use strict';
// Free public proxies (2 Nov 2026 feature): parse the public lists, test each candidate,
// keep only working proxies that do not reveal the user's real IP, honour the limit,
// country, time budget and cancel, and never mix free proxies into Quick generate unless
// they are chosen on purpose.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fp = require('../src/main/freeProxies');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload.js'), 'utf8');
const POOL = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'pages', 'ProxyPoolPage.jsx'), 'utf8');

test('only public IPv4 addresses are accepted (no probing of the user\'s own network)', () => {
  for (const ok of ['8.8.8.8', '137.66.1.45', '203.0.113.9']) assert.equal(fp.isPublicIPv4(ok), true, ok);
  for (const bad of ['10.0.0.1', '127.0.0.1', '192.168.1.5', '172.16.0.1', '172.31.255.1', '169.254.1.1', '100.64.0.1', '0.1.2.3', '224.0.0.1', '999.1.1.1', 'example.com']) {
    assert.equal(fp.isPublicIPv4(bad), false, bad);
  }
});

test('list lines are parsed per protocol, schemes normalised, junk dropped', () => {
  const text = [
    'http://137.66.1.45:80', 'https://85.214.107.177:8080', '154.219.101.12:1081', 'socks5://208.102.51.6:58208',
    'socks4://1.2.3.4:4145', '# comment', 'garbage', '192.168.1.1:8080', '8.8.8.8:99999', ''
  ].join('\n');
  const http = fp.parseProxyLines(text, 'http').map((c) => `${c.type}://${c.host}:${c.port}`);
  assert.deepEqual(http, ['http://137.66.1.45:80', 'http://85.214.107.177:8080', 'http://154.219.101.12:1081']);
  // A bare "ip:port" line takes the list's own protocol (that is how per-protocol lists are published).
  const socks = fp.parseProxyLines(text, 'socks5').map((c) => `${c.host}:${c.port}`);
  assert.deepEqual(socks, ['154.219.101.12:1081', '208.102.51.6:58208']);
  assert.ok(!fp.parseProxyLines(text, 'socks5').some((c) => c.host === '1.2.3.4'), 'socks4 is never offered');
});

test('Geonode rows: transparent and wrong-protocol entries are dropped, country kept', () => {
  const json = { data: [
    { ip: '1.20.101.30', port: '8080', protocols: ['http'], anonymityLevel: 'transparent', country: 'TH' },
    { ip: '41.2.3.4', port: '3128', protocols: ['http'], anonymityLevel: 'elite', country: 'za' },
    { ip: '41.2.3.5', port: '1080', protocols: ['socks5'], anonymityLevel: 'elite', country: 'ZA' }
  ] };
  assert.deepEqual(fp.parseGeonode(json, 'http'), [{ type: 'http', host: '41.2.3.4', port: 3128, country: 'ZA' }]);
});

test('the anonymity judge flags the real IP and proxy headers', () => {
  assert.equal(fp.revealsClient({ Host: 'httpbin.org', 'User-Agent': 'x' }, '182.1.2.3'), false);
  assert.equal(fp.revealsClient({ 'X-Forwarded-For': '182.1.2.3' }, '182.1.2.3'), true);
  assert.equal(fp.revealsClient({ Via: '1.1 squid' }, '182.1.2.3'), true);
  assert.equal(fp.revealsClient({ 'X-Amzn-Trace-Id': 'Root=1', Foo: 'client 182.1.2.3' }, '182.1.2.3'), true);
});

const fakeDeps = (over = {}) => ({
  getRealIp: async () => '182.1.2.3',
  fetchText: async (url) => (url.includes('geonode') ? JSON.stringify({ data: [] }) : ['8.1.1.1:80', '8.1.1.2:80', '8.1.1.3:80', '8.1.1.4:80', '8.1.1.5:80', '8.1.1.6:80'].join('\n')),
  checkExit: async (c) => {
    if (c.host === '8.1.1.1') throw new Error('timeout');
    if (c.host === '8.1.1.2') return { ip: '182.1.2.3', country: 'PK' }; // exits as the user = leak
    return { ip: c.host, country: c.host === '8.1.1.6' ? 'DE' : 'US', latencyMs: 900 };
  },
  judgeHeaders: async (c) => (c.host === '8.1.1.3' ? { 'X-Forwarded-For': '182.1.2.3' } : { Host: 'httpbin.org' }),
  ...over
});

test('harvest keeps only working, anonymous proxies, up to the limit', async () => {
  const r = await fp.harvestFreeProxies({ protocol: 'http', limit: 10, concurrency: 2 }, fakeDeps());
  const hosts = r.found.map((f) => f.host).sort();
  assert.deepEqual(hosts, ['8.1.1.4', '8.1.1.5', '8.1.1.6']);
  assert.equal(r.rejected.dead, 1);
  assert.equal(r.rejected.transparent, 2);
  assert.equal(r.total, 6, 'the duplicate lines from several sources are merged');
  const one = await fp.harvestFreeProxies({ protocol: 'http', limit: 1, concurrency: 1 }, fakeDeps());
  assert.equal(one.found.length, 1);
  assert.equal(one.stopped, 'limit');
});

test('a country filter uses the real exit country', async () => {
  const r = await fp.harvestFreeProxies({ protocol: 'http', country: 'de', limit: 10, concurrency: 3 }, fakeDeps());
  assert.deepEqual(r.found.map((f) => f.host), ['8.1.1.6']);
  assert.ok(r.rejected.country >= 2);
});

test('without the user\'s own IP nothing is kept (the leak check would prove nothing)', async () => {
  const r = await fp.harvestFreeProxies({ protocol: 'http', limit: 5 }, fakeDeps({ getRealIp: async () => null }));
  assert.equal(r.stopped, 'no-real-ip');
  assert.deepEqual(r.found, []);
});

test('cancel and already-known proxies are honoured', async () => {
  const ac = new AbortController(); ac.abort();
  const r = await fp.harvestFreeProxies({ protocol: 'http', limit: 5, signal: ac.signal }, fakeDeps());
  assert.equal(r.stopped, 'cancelled');
  assert.equal(r.checked, 0);
  const ex = await fp.harvestFreeProxies({ protocol: 'http', limit: 10, exclude: new Set(['http://8.1.1.4:80']) }, fakeDeps());
  assert.ok(!ex.found.some((f) => f.host === '8.1.1.4'));
});

test('a source that fails is skipped, the others still count', async () => {
  const deps = fakeDeps({ fetchText: async (url) => { if (url.includes('proxyscrape')) throw new Error('HTTP 503'); return url.includes('geonode') ? '{"data":[]}' : '8.1.1.5:80'; } });
  const r = await fp.harvestFreeProxies({ protocol: 'http', limit: 5 }, deps);
  assert.deepEqual(r.found.map((f) => f.host), ['8.1.1.5']);
  assert.ok(r.sources.some((s) => s.id === 'proxyscrape' && s.ok === false));
});

test('main: gated, one search at a time, free group, audit, and channels wired', () => {
  assert.match(IPC, /async function harvestFreeProxiesHandler\(payload, event\) \{\s*await requirePermission\('proxies\.manage'\);/);
  assert.match(IPC, /if \(freeHarvestRun\) \{ const e = new Error\('A free-proxy search is already running\.'\)/);
  assert.match(IPC, /provider: 'free', proxyGroupId: group \? group\.id : null/);
  assert.match(IPC, /await logAudit\('proxy\.free-harvest'/);
  assert.match(IPC, /registerHandler\(CHANNELS\.PROXY_FREE_HARVEST, harvestFreeProxiesHandler\);/);
  assert.match(IPC, /registerHandler\(CHANNELS\.PROXY_FREE_CANCEL, cancelFreeProxyHarvest\);/);
  assert.match(IPC, /sender\.send\(CHANNELS\.PROXY_FREE_PROGRESS/);
  assert.match(PRELOAD, /freeHarvest: \(payload\) => invoke\(CHANNELS\.PROXY_FREE_HARVEST, payload\),/);
  assert.match(POOL, /<FreeProxiesDialog open=\{freeOpen\} onOpenChange=\{setFreeOpen\} onAdded=\{loadProxies\} \/>/);
});

test('Quick generate never mixes free proxies into "all proxies"', () => {
  // The source filter (src/main/proxyScope.js, tested in freeProxiesPage.test.js) keeps the paid
  // pool free of them and is ANDed with every other Quick generate filter.
  assert.match(IPC, /const sourceWhere = proxyScope\.batchProxySourceWhere\(\{ source: input\.proxySource, proxyGroupId: sourceGroupId, provider: optionalString\(input\.provider\) \}\);/);
  assert.match(IPC, /where: await scopedProxyWhere\(proxyScope\.andWhere\(sourceWhere, filter\)\),/);
});
