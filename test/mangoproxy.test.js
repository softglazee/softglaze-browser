'use strict';
// MangoProxy connector: request rules from the Public API OpenAPI document at
// backend.mangoproxy.com/public-api/docs-json (version 1.58.4): GenerateConnectionDetailsDto caps
// count at 100 per call, sessionDuration at 120, takes state/city as lowercase names (california,
// losangeles) and asn as AS<number> with a country. Built from the docs only: never checked live.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/proxyVendorUtils.js');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');

const line = (i, sid = `s${i}`) => ({
  http: `http://sub1-zone-custom-region-us-session-${sid}-sessTime-30:pw@p2.mangoproxy.com:2334`,
  socks5: `socks5://sub1-zone-custom-region-us-session-${sid}-sessTime-30:pw@p2.mangoproxy.com:2333`
});

test('places are lowercase with no spaces, as in the location lists', () => {
  assert.equal(U.mangoProxyPlace(' Los Angeles '), 'losangeles');
  assert.equal(U.mangoProxyPlace('England'), 'england');
  assert.equal(U.mangoProxyPlace(''), '');
});

test('an ASN is sent as AS<number>', () => {
  assert.equal(U.mangoProxyAsn('61461'), 'AS61461');
  assert.equal(U.mangoProxyAsn('as61461'), 'AS61461');
  assert.equal(U.mangoProxyAsn(''), '');
  assert.throws(() => U.mangoProxyAsn('Comcast'), /not an ASN/);
});

test('mangoProxyCollect asks in batches of 100 until it has enough', async () => {
  const asked = [];
  let next = 0;
  const rows = await U.mangoProxyCollect(250, async (size) => {
    asked.push(size);
    return Array.from({ length: size }, () => line(next += 1));
  });
  assert.deepEqual(asked, [100, 100, 50]);
  assert.equal(rows.length, 250);
  assert.equal(new Set(rows.map((r) => r.username)).size, 250);
  assert.equal(U.MANGOPROXY_BATCH_MAX, 100);
});

test('mangoProxyCollect stops when a call adds nothing new, and after 20 calls at most', async () => {
  let calls = 0;
  const same = await U.mangoProxyCollect(5, async () => { calls += 1; return [line(1, 'fixed')]; });
  assert.deepEqual([same.length, calls], [1, 2], 'a rotating line repeats itself');
  calls = 0;
  let next = 0;
  const trickle = await U.mangoProxyCollect(1000, async () => { calls += 1; return [line(next += 1)]; });
  assert.deepEqual([trickle.length, calls], [20, 20]);
  calls = 0;
  const none = await U.mangoProxyCollect(10, async () => { calls += 1; return { message: 'nope' }; });
  assert.deepEqual([none.length, calls], [0, 1]);
});

// Runs the real adapter against a fake transport that records each request body.
function ipcFunction(name) {
  return new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`).exec(IPC)[0];
}
function adapter() {
  const bodies = [];
  let next = 0;
  const httpRequestText = async (url, opts = {}) => {
    if (url.endsWith('/accounts')) return JSON.stringify([{ id: 1, username: 'sub1' }]);
    const body = JSON.parse(opts.body);
    bodies.push(body);
    return JSON.stringify(Array.from({ length: body.count }, () => line(next += 1)));
  };
  const fn = new Function(
    'httpRequestText', 'MANGOPROXY_API', 'MANGOPROXY_TRAFFIC', 'MINTED_PULL_MAX', 'mangoProxyPlace', 'mangoProxyAsn', 'mangoProxyCollect',
    `${['normCountryCode', 'clampPoolCount', 'mangoCall', 'fetchMangoProxyPool'].map(ipcFunction).join('\n')}\nreturn fetchMangoProxyPool;`
  )(httpRequestText, 'https://backend.mangoproxy.com/public-api/v1', ['residential', 'residential_light', 'datacenter', 'isp'],
    Number(/const MINTED_PULL_MAX = (\d+);/.exec(IPC)[1]), U.mangoProxyPlace, U.mangoProxyAsn, U.mangoProxyCollect);
  return { fetchMangoProxyPool: fn, bodies };
}

test('a big pull is split into calls of at most 100 and capped at MINTED_PULL_MAX', async () => {
  const a = adapter();
  const rows = await a.fetchMangoProxyPool({ token: 'k', country: 'US', count: '250' });
  assert.deepEqual(a.bodies.map((b) => b.count), [100, 100, 50]);
  assert.equal(rows.length, 250);
  assert.equal(new Set(rows.map((r) => r.username)).size, 250);
  assert.ok(a.bodies.every((b) => b.sessionDuration === 30 && b.subAccountUsername === 'sub1'));
  const b = adapter();
  assert.equal((await b.fetchMangoProxyPool({ token: 'k', count: '5000' })).length, 1000);
  assert.ok(b.bodies.every((x) => x.count <= 100));
});

test('state, city and ASN are sent in the documented forms', async () => {
  const a = adapter();
  await a.fetchMangoProxyPool({ token: 'k', country: 'us', state: 'New York', city: 'Los Angeles', asn: '7922', count: '1' });
  const [body] = a.bodies;
  assert.deepEqual([body.country, body.state, body.city, body.asn, body.sessionDuration], ['US', 'newyork', 'losangeles', 'AS7922', 0]);
  await assert.rejects(adapter().fetchMangoProxyPool({ token: 'k', asn: '7922' }), /ASN targeting needs a country/);
});

test('a country page reads code and title, and meta says whether more follow', () => {
  // The OpenAPI examples: ListCountryItemDto and PaginationMetaDto.
  const page = U.mangoProxyCountryPage({ data: [{ id: 1, code: 'US', title: 'United States', server: 'EU' }, { id: 2, code: 'x' }], meta: { total: 100, perPage: 10, currentPage: 1, lastPage: 10, next: 2 } });
  assert.deepEqual(page, { countries: [{ key: 'US', label: 'United States' }], more: true });
  assert.equal(U.mangoProxyCountryPage({ data: [], meta: { currentPage: 3, lastPage: 3 } }).more, false);
  assert.deepEqual(U.mangoProxyCountryPage(null), { countries: [], more: false });
});

test('the country lookup pages through the chosen pool and sorts by name', async () => {
  const urls = [];
  const pages = {
    1: { data: [{ code: 'US', title: 'United States' }, { code: 'DE', title: 'Germany' }], meta: { currentPage: 1, lastPage: 2 } },
    2: { data: [{ code: 'BR', title: 'Brazil' }, { code: 'DE', title: 'Germany' }], meta: { currentPage: 2, lastPage: 2 } }
  };
  const httpRequestText = async (url) => {
    urls.push(url);
    return JSON.stringify(pages[Number(/&page=(\d+)$/.exec(url)[1])]);
  };
  const lookupMangoProxy = new Function('httpRequestText', 'MANGOPROXY_API', 'MANGOPROXY_TRAFFIC', 'mangoProxyCountryPage',
    `const MANGOPROXY_COUNTRY_PAGE = ${/const MANGOPROXY_COUNTRY_PAGE = (\d+);/.exec(IPC)[1]};\n${['mangoCall', 'lookupMangoProxy'].map(ipcFunction).join('\n')}\nreturn lookupMangoProxy;`
  )(httpRequestText, 'https://backend.mangoproxy.com/public-api/v1', ['residential', 'residential_light', 'datacenter', 'isp'], U.mangoProxyCountryPage);
  const r = await lookupMangoProxy({ token: 'k', groupby: 'country', poolType: 'isp' });
  assert.deepEqual(r.geo.map((c) => c.key), ['BR', 'DE', 'US']);
  assert.equal(r.provider, 'mangoproxy');
  assert.deepEqual(urls, [1, 2].map((p) => `https://backend.mangoproxy.com/public-api/v1/locations/countries?trafficType=isp&limit=100&page=${p}`));
  await assert.rejects(lookupMangoProxy({ token: 'k', groupby: 'region' }), /only the country list/);
});

test('the lookup is gated, registered and offered on the panel', () => {
  const lookup = /async function vendorLookup\([\s\S]*?\r?\n\}\r?\n/.exec(IPC)[0];
  assert.match(lookup, /await requirePermission\('proxies\.manage'\)/);
  assert.match(lookup, /poolType: optionalString\(input\.poolType\)/);
  assert.match(IPC, /mangoproxy: lookupMangoProxy/);
  assert.match(UI, /key: 'mangoproxy'.*countryLookup: true/);
  assert.match(UI, /countryOptions\(provider, i18n\.language, geoOptions\.country\)/);
  assert.match(UI, /provider\.geoSync\.countryLookup && \(\r?\n\s*<button type="button" onClick=\{\(\) => handleLookup\('country'\)\}/);
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', 'en', 'cmpSettingsC.json'), 'utf8'));
  const es = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', 'es', 'cmpSettingsC.json'), 'utf8'));
  for (const k of ['countriesLoaded', 'countriesLoaded_one', 'countriesLoaded_other', 'zipOneLabel', 'asnOneLabel']) {
    assert.equal(typeof en.proxyProviders.geo[k], 'string', k);
    assert.equal(typeof es.proxyProviders.geo[k], 'string', k);
  }
});

test('MangoProxy is wired with an ASN field and hints that state the new cap', () => {
  assert.match(UI, /key: 'mangoproxy'.*geo: true, asn: true/);
  for (const loc of ['en', 'es']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', loc, 'cmpSettingsC.json'), 'utf8'));
    assert.match(json.proxyProviders.geoHints.mangoproxy, /1000/, loc);
    assert.doesNotMatch(json.proxyProviders.geoHints.mangoproxy, /[–—]|hasta 100\)|up to 100\)/, loc);
    assert.equal(typeof json.proxyProviders.geo.asnOneLabel, 'string', loc);
    assert.equal(typeof json.proxyProviders.geo.zipOneLabel, 'string', loc);
  }
});
