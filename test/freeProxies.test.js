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
  // httpbin /get: a transparent proxy's X-Forwarded-For shows up only in `origin`.
  judgeEcho: async (c) => (c.host === '8.1.1.3'
    ? { headers: { Host: 'httpbin.org' }, origin: `182.1.2.3, ${c.host}` }
    : { headers: { Host: 'httpbin.org' }, origin: c.host }),
  ...over
});

// Fake httpbin /get answers for one proxy (8.1.1.4), the way httpbin.org shapes them: X-Forwarded-For,
// Via and X-Real-Ip are never in `headers`; a forwarded chain is folded into `origin`.
const echoDeps = (realIp, echo) => fakeDeps({
  getRealIp: async () => realIp,
  fetchText: async (url) => (url.includes('geonode') ? '{"data":[]}' : '8.1.1.4:80'),
  checkExit: async (c) => ({ ip: c.host, country: 'US', latencyMs: 500 }),
  judgeEcho: async () => echo
});
const harvestOne = async (realIp, echo) => fp.harvestFreeProxies({ protocol: 'http', limit: 5 }, echoDeps(realIp, echo));

test('IP addresses match whole, never as part of a longer address', () => {
  // 1.2.3.4 is not inside 11.2.3.45, 1.2.3.45 or 21.2.3.4.
  for (const other of ['11.2.3.45', '1.2.3.45', '21.2.3.4', '1.2.3.40', 'host1.2.3.4.example.net']) {
    assert.equal(fp.containsIp(other, '1.2.3.4'), false, other);
    assert.equal(fp.revealsClient({ 'X-Client-IP': other }, '1.2.3.4'), false, other);
  }
  for (const v of ['1.2.3.4', '1.2.3.4, 10.0.0.1', '10.0.0.1,1.2.3.4', 'for=1.2.3.4;proto=http', '1.2.3.4:51234', 'client 1.2.3.4.', '::ffff:1.2.3.4']) {
    assert.equal(fp.containsIp(v, '1.2.3.4'), true, v);
  }
  // IPv6: one written form per address, brackets, ports and zones allowed, prefixes never match.
  assert.equal(fp.containsIp('for="[2001:db8::1]:4711"', '2001:DB8:0:0:0:0:0:1'), true);
  assert.equal(fp.containsIp('2001:db8::1, 8.8.8.8', '2001:db8::1'), true);
  assert.equal(fp.containsIp('2001:db8::10, 8.8.8.8', '2001:db8::1'), false);
  assert.equal(fp.containsIp('2001:db8::1:5', '2001:db8::1'), false);
  assert.equal(fp.canonicalIp('[2001:DB8::1]'), '2001:db8::1');
  assert.equal(fp.canonicalIp('::FFFF:0102:0304'), '1.2.3.4');
  assert.equal(fp.canonicalIp('1.2.3'), null);
  assert.equal(fp.canonicalIp('example.com'), null);
});

test('httpbin echo: the real IP in origin means a transparent proxy', async () => {
  const echo = { headers: { Host: 'httpbin.org', 'User-Agent': 'x' }, origin: '182.1.2.3, 8.1.1.4' };
  assert.equal(fp.echoRevealsClient(echo, '182.1.2.3'), true);
  const r = await harvestOne('182.1.2.3', echo);
  assert.deepEqual(r.found, []);
  assert.equal(r.rejected.transparent, 1);
  // No space after the comma (the live httpbin.org form), and an IPv6 user behind the proxy.
  assert.equal(fp.echoRevealsClient({ headers: {}, origin: '182.1.2.3,8.1.1.4' }, '182.1.2.3'), true);
  assert.equal(fp.echoRevealsClient({ headers: {}, origin: '2001:db8::7, 8.1.1.4' }, '2001:DB8::7'), true);
});

test('httpbin echo: forwarding headers it does show still reject the proxy', async () => {
  for (const headers of [
    { Host: 'httpbin.org', Forwarded: 'for=182.1.2.3' },
    { Host: 'httpbin.org', Forwarded: 'for=unknown' },
    { Host: 'httpbin.org', 'X-Proxy-Id': '12345' },
    { Host: 'httpbin.org', 'Proxy-Connection': 'keep-alive' },
    { Host: 'httpbin.org', 'X-Client-Ip': '182.1.2.3' }
  ]) {
    const r = await harvestOne('182.1.2.3', { headers, origin: '8.1.1.4' });
    assert.deepEqual(r.found, [], JSON.stringify(headers));
    assert.equal(r.rejected.transparent, 1, JSON.stringify(headers));
  }
});

test('httpbin echo: a clean elite proxy is kept', async () => {
  const r = await harvestOne('182.1.2.3', { headers: { Accept: 'application/json', Host: 'httpbin.org', 'User-Agent': 'SoftGlaze-ProxyCheck/1.0' }, origin: '8.1.1.4' });
  assert.deepEqual(r.found.map((f) => f.host), ['8.1.1.4']);
  assert.equal(r.rejected.transparent, 0);
});

test('a real IP of 1.2.3.4 does not reject a proxy whose echo shows 11.2.3.45', async () => {
  const r = await harvestOne('1.2.3.4', { headers: { Host: 'httpbin.org', 'X-Client-Ip': '11.2.3.45' }, origin: '11.2.3.45' });
  assert.deepEqual(r.found.map((f) => f.host), ['8.1.1.4']);
  // The old substring match ('11.2.3.45'.includes('1.2.3.4')) rejected it; the same IP still does.
  const leak = await harvestOne('1.2.3.4', { headers: { Host: 'httpbin.org' }, origin: '1.2.3.4, 11.2.3.45' });
  assert.deepEqual(leak.found, []);
});

test('an echo without origin proves nothing, so the proxy is not kept', async () => {
  for (const echo of [{ headers: { Host: 'httpbin.org' } }, { headers: { Host: 'httpbin.org' }, origin: '' }, { Host: 'httpbin.org' }, null]) {
    const r = await harvestOne('182.1.2.3', echo);
    assert.deepEqual(r.found, [], JSON.stringify(echo));
    assert.equal(r.rejected['judge-failed'], 1, JSON.stringify(echo));
  }
});

test('the exit IP is compared as an address and a junk real IP stops the search', async () => {
  const sameUser = fakeDeps({ getRealIp: async () => '::ffff:182.1.2.3', fetchText: async (u) => (u.includes('geonode') ? '{"data":[]}' : '8.1.1.2:80') });
  const r = await fp.harvestFreeProxies({ protocol: 'http', limit: 5 }, sameUser);
  assert.deepEqual(r.found, []);
  assert.equal(r.rejected.transparent, 1, 'exits as the user (182.1.2.3)');
  const junk = await fp.harvestFreeProxies({ protocol: 'http', limit: 5 }, fakeDeps({ getRealIp: async () => 'not an ip' }));
  assert.equal(junk.stopped, 'no-real-ip');
});

test('main: the judge asks httpbin /get and passes origin on', () => {
  const judge = /judgeEcho: async \(c\) => \{[\s\S]*?\n    \}/.exec(IPC);
  assert.ok(judge, 'judgeEcho dep is wired');
  assert.match(judge[0], /httpGetJson\('http:\/\/httpbin\.org\/get', agent, 8000\)/);
  assert.match(judge[0], /typeof d\.origin !== 'string'\) throw new Error\('no echo'\)/);
  assert.match(judge[0], /return \{ headers: d\.headers, origin: d\.origin \};/);
  assert.doesNotMatch(IPC, /httpbin\.org\/headers/);
  assert.doesNotMatch(IPC, /judgeHeaders/);
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
  // The search moved to its own page; the pool only links there.
  assert.match(POOL, /<Link to="\/free-proxies"/);
  assert.doesNotMatch(POOL, /FreeProxiesDialog/);
});

test('Quick generate never mixes free proxies into "all proxies"', () => {
  // The source filter (src/main/proxyScope.js, tested in freeProxiesPage.test.js) keeps the paid
  // pool free of them and is ANDed with every other Quick generate filter.
  assert.match(IPC, /const sourceWhere = proxyScope\.batchProxySourceWhere\(\{ source: input\.proxySource, proxyGroupId: sourceGroupId, provider: optionalString\(input\.provider\) \}\);/);
  assert.match(IPC, /where: await scopedProxyWhere\(proxyScope\.andWhere\(sourceWhere, filter\)\),/);
});
