'use strict';
// Pull limits and request flow for NOVADA, Proxies.sx, MobileProxy.Space, Proxy-Solutions, Proxmint,
// Databay, Proxy302, IP Burger and IPFoxy. The adapters are built from ipcHandlers.js source with a
// stubbed httpRequestText, so the real loops run without the network.
//   - Gateways that mint sessions stop at MINTED_PULL_MAX (1000; NOVADA's own generator also stops
//     at 1000). Proxies.sx stops at 250, its per-account session limit (E_SESSION_LIMIT).
//   - List pulls return as many rows as asked, read page by page until that many are found.
//   - Proxy302 buys one proxy per call, a few calls at a time, up to MINTED_PULL_MAX.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const U = require('../src/main/proxyVendorUtils');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');

const fnSrc = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\(([\\s\\S]*?)\\r?\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};
const constSrc = (name) => {
  const m = new RegExp(`const ${name} = [^\\r\\n]*`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};
// Compile the named functions and constants with `deps` in scope; returns the functions.
function build(fns, consts, deps) {
  const src = [...consts.map(constSrc), ...fns.map(fnSrc)].join('\n');
  const names = Object.keys(deps);
  return new Function(...names, `${src}\nreturn { ${fns.join(', ')} };`)(...names.map((k) => deps[k]));
}
const SHARED_FNS = ['normCountryCode', 'clampPoolCount', 'gatewayPullPlan', 'gatewayOverride', 'mintGatewayRows', 'limitListRows'];
const SHARED_CONSTS = ['MINTED_PULL_MAX', 'LIST_IMPORT_MAX'];
const httpError = (status, body = '') => Object.assign(new Error(`HTTP ${status} ${body}`.trim()), { status });

test('shared caps: minted gateways stop at MINTED_PULL_MAX, list pulls return what was asked', () => {
  const A = build(SHARED_FNS, SHARED_CONSTS, { crypto });
  const mint = (count, extra = {}) => A.mintGatewayRows({ type: 'HTTP', host: 'h', port: 1, password: 'p', session: '', count, buildUser: (sid) => `u-${sid}`, label: 'X', ...extra });
  assert.equal(mint(1000).length, 1000);
  assert.equal(mint(5000).length, 1000);
  assert.equal(mint(400, { max: 250 }).length, 250, 'a documented vendor limit wins');
  assert.equal(mint(1).length, 1);
  assert.match(mint(1)[0].label, /rotating/);
  const list = Array.from({ length: 1200 }, (_, i) => ({ host: `10.0.${i >> 8}.${i & 255}`, port: 80 }));
  assert.equal(A.limitListRows(list, '800').length, 800, 'no 500 cap on a list already fetched');
  assert.equal(A.limitListRows(list, '').length, 1200, 'blank keeps the whole list');
  assert.equal(A.limitListRows(list, '5000').length, 1200);
});

test('NOVADA, Proxmint, Databay, IP Burger and IPFoxy mint up to 1000 sticky rows per pull', async () => {
  const A = build([...SHARED_FNS, 'fetchNovadaPool', 'fetchProxmintPool', 'fetchDatabayPool', 'fetchIpBurgerPool', 'fetchIpfoxyPool'],
    [...SHARED_CONSTS, 'NOVADA_GATEWAY', 'PROXMINT_API', 'DATABAY_GATEWAY', 'IPBURGER_GATEWAY', 'IPFOXY_GATEWAY'], {
      crypto, ...U,
      httpRequestText: async () => JSON.stringify({ products: [{ product: 'premium-residential', name: 'Premium Residential', status: 'active', bandwidth: { remainingBytes: 5 }, proxy: { host: 'gw.proxmint.com', httpPort: 823, socks5Port: 824, username: 'pu', password: 'pp' } }] })
    });
  const runs = [
    ['NOVADA', A.fetchNovadaPool({ username: 'u1', password: 'p', country: 'US', count: 1500 })],
    ['Proxmint', A.fetchProxmintPool({ token: 'pmk_abcdefgh123', poolType: 'residential_premium', country: 'DE', count: 1500 })],
    ['Databay', A.fetchDatabayPool({ username: 'u1', password: 'p', poolType: 'residential_flex', country: 'US', life: 120, count: 1500 })],
    ['IP Burger', A.fetchIpBurgerPool({ username: 'customer-abc', password: 'p', country: 'US', count: 1500 })],
    ['IPFoxy', A.fetchIpfoxyPool({ username: 'acct', password: 'p', country: 'US', life: 45, count: 1500 })]
  ];
  for (const [name, run] of runs) {
    const rows = await run;
    assert.equal(rows.length, 1000, name);
    assert.equal(new Set(rows.map((r) => r.username)).size, 1000, `${name}: every row is its own session`);
  }
  const db = await A.fetchDatabayPool({ username: 'u1', password: 'p', poolType: 'residential_flex', country: 'US', life: 120, count: 2 });
  assert.match(db[0].username, /^u1-zone-residential_FLEX-countryCode-US-sessionId-sg[0-9a-f]+1-sessionLength-30$/);
  assert.match(db[0].label, /Databay • Residential Flex • US/);
  const fox = await A.fetchIpfoxyPool({ username: 'acct', password: 'p', country: 'US', life: 45, count: 2 });
  assert.match(fox[0].username, /-ttl-60$/);
});

function proxiesSx(overrides = {}) {
  const calls = [];
  const stock = JSON.stringify({ pools: { mbl: { us: 27, gb: 20 }, peer: { de: 310, us: 40 } } });
  const http = overrides.http || (async (url) => {
    if (/\/gateway\/pool\/stock$/.test(url)) return stock;
    if (/\/account\/proxy-password$/.test(url)) return JSON.stringify({ proxyUsername: 'psx_ab12cd', proxyPassword: 'secret1' });
    throw new Error(`unexpected ${url}`);
  });
  const A = build([...SHARED_FNS, 'fetchProxiesSxPool'], [...SHARED_CONSTS, 'PROXIESSX_API', 'PROXIESSX_GATEWAY', 'PROXIESSX_DEFAULT_TTL_MIN'],
    { crypto, ...U, httpRequestText: async (url, opts) => { calls.push(url); return http(url, opts); } });
  return { fetch: A.fetchProxiesSxPool, calls };
}

test('Proxies.sx: up to 250 sticky rows (its session limit), rotating rows ask for ondemand', async () => {
  const { fetch } = proxiesSx();
  const many = await fetch({ token: 'psx_key', poolType: 'residential', country: 'DE', count: 1000 });
  assert.equal(many.length, 250);
  assert.equal(new Set(many.map((r) => r.username)).size, 250);
  // Residential is the peer network filtered to residential devices; Keep same IP blank is a 24-hour session record.
  assert.match(many[0].username, /^psx_ab12cd-peer-de-iptype-residential-sid-[a-z0-9_]{8,64}-ttl-86400-rot-sticky-failover-strict$/);
  assert.deepEqual([many[0].type, many[0].host, many[0].port], ['HTTP', 'gw.proxies.sx', 7000]);
  const one = await fetch({ token: 'psx_key', poolType: 'mobile', country: 'US', count: 1, proxyType: 'socks5' });
  assert.equal(one.length, 1);
  assert.equal(one[0].username, 'psx_ab12cd-mbl-us-rot-ondemand-failover-strict');
  assert.deepEqual([one[0].type, one[0].port], ['SOCKS5', 7001]);
});

test('Proxies.sx: refuses Mobile outside its six countries, state names, and countries with no stock', async () => {
  const { fetch, calls } = proxiesSx();
  await assert.rejects(fetch({ token: 'psx_key', poolType: 'mobile', country: 'DE', count: 3 }), /Mobile pool runs only in US, GB, FR, NL, PL, GE/);
  await assert.rejects(fetch({ token: 'psx_key', poolType: 'mobile', country: 'US', state: 'CA', count: 3 }), /Residential pool only/);
  await assert.rejects(fetch({ token: 'psx_key', poolType: 'residential', country: 'US', state: 'California', count: 3 }), /2-letter region code/);
  assert.equal(calls.length, 0, 'nothing is sent for a form error');
  await assert.rejects(fetch({ token: 'psx_key', poolType: 'residential', country: 'FR', count: 3 }), /no Residential stock in FR/);
  await assert.rejects(fetch({ token: 'psx_key', poolType: 'mobile', country: 'NL', count: 3 }), /no Mobile stock in NL/);
  const rows = await fetch({ token: 'psx_key', poolType: 'residential', country: 'US', state: 'ny', city: 'New York', count: 2 });
  assert.match(rows[0].username, /^psx_ab12cd-peer-us-iptype-residential-state-ny-city-newyork-sid-/);
});

test('Proxies.sx: a failed stock read does not block the pull', async () => {
  const { fetch } = proxiesSx({ http: async (url) => {
    if (/stock/.test(url)) throw httpError(503);
    return JSON.stringify({ proxyUsername: 'psx_ab12cd', proxyPassword: 'secret1' });
  } });
  assert.equal((await fetch({ token: 'psx_key', poolType: 'residential', country: 'FR', count: 3 })).length, 3);
});

test('MobileProxy.Space: the whole list in one call, How many above 500 is honoured', async () => {
  const list = Array.from({ length: 700 }, (_, i) => ({ proxy_id: i + 1, proxy_host_ip: `10.1.${i >> 8}.${i & 255}`, proxy_http_port: 5000, proxy_socks5_port: 5001, proxy_login: `l${i}`, proxy_pass: 'p' }));
  const seen = [];
  const MPS_FNS = [...SHARED_FNS, 'protocolChoice', 'mobileProxySpaceGet', 'fetchMobileProxySpacePool'];
  const MPS_CONSTS = [...SHARED_CONSTS, 'MOBILEPROXYSPACE_API'];
  const A = build(MPS_FNS, MPS_CONSTS,
    { crypto, ...U, httpRequestText: async (url) => { seen.push(url); return JSON.stringify({ status: 'ok', list }); } });
  assert.equal((await A.fetchMobileProxySpacePool({ token: 'tok', count: '600' })).length, 600);
  assert.equal((await A.fetchMobileProxySpacePool({ token: 'tok', count: '' })).length, 700);
  // One list call per pull (these rows carry no id_country, so no country table is asked for).
  assert.deepEqual(seen, ['https://mpsapi.com/api.html?command=get_my_proxy', 'https://mpsapi.com/api.html?command=get_my_proxy']);
  const B = build(MPS_FNS, MPS_CONSTS,
    { crypto, ...U, httpRequestText: async () => { throw httpError(429, '{"status":"err","message":"Too many same requests, wait 3 seconds"}'); } });
  await assert.rejects(B.fetchMobileProxySpacePool({ token: 'tok' }), /too many requests/);
});

function proxySolutions(totalPages, countryOf = () => 'DE') {
  const pages = [];
  const A = build([...SHARED_FNS, 'protocolChoice', 'fetchProxySolutionsPool'], [...SHARED_CONSTS, 'PROXYSOLUTIONS_API', 'PROXYSOLUTIONS_MAX_PAGES'], {
    crypto, ...U,
    httpRequestText: async (url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      assert.equal(new URL(url).searchParams.get('per_page'), '200');
      pages.push(page);
      const proxies = Array.from({ length: 200 }, (_, i) => {
        const n = (page - 1) * 200 + i;
        return { name: `p${n}`, country_code: countryOf(n), proto: 'http', ip: `10.2.${n >> 8}.${n & 255}`, port: 8000, login: `l${n}`, password: 'p', expires_at: Date.now() + 86_400_000 };
      });
      return JSON.stringify({ page, per_page: 200, total_pages: totalPages, proxies });
    }
  });
  return { fetch: A.fetchProxySolutionsPool, pages };
}

test('Proxy-Solutions: pages of 200 are read until How many is met, or the list ends', async () => {
  let s = proxySolutions(10);
  assert.equal((await s.fetch({ token: 'abcdef123', count: '250' })).length, 250);
  assert.deepEqual(s.pages, [1, 2], 'stops once enough rows are in');
  s = proxySolutions(10);
  assert.equal((await s.fetch({ token: 'abcdef123', count: '' })).length, 2000);
  assert.equal(s.pages.length, 10, 'blank reads the whole list');
  s = proxySolutions(40);
  assert.equal((await s.fetch({ token: 'abcdef123' })).length, 5000);
  assert.equal(s.pages.length, 25, 'never more than 25 pages');
  // Only every fourth proxy is in the US, so 120 US proxies need three pages.
  s = proxySolutions(10, (n) => (n % 4 === 0 ? 'US' : 'DE'));
  const us = await s.fetch({ token: 'abcdef123', country: 'US', count: '120' });
  assert.equal(us.length, 120);
  assert.ok(us.every((r) => r.country === 'US'));
  assert.deepEqual(s.pages, [1, 2, 3]);
});

function proxy302({ purchase, failAfter = Infinity } = {}) {
  const urls = [];
  let bought = 0;
  let inFlight = 0;
  let peak = 0;
  const ok = (data) => JSON.stringify({ code: 0, msg: 'success', data });
  const A = build(['normCountryCode', 'clampPoolCount', 'proxy302Failure', 'fetchProxy302Pool'], [...SHARED_CONSTS, 'PROXY302_API', 'PROXY302_PARALLEL'], {
    ...U,
    httpRequestText: async (url, opts = {}) => {
      urls.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith('/user/users/token')) return ok({ token: 'Basic a2V5OnNlY3JldA==' });
      if (u.pathname.endsWith('/proxy/area/country')) return ok({ data: [{ id: 233, name: 'United States', code: 'US' }] });
      if (u.pathname.endsWith('/proxy/area/state')) return ok({ data: [{ id: 5001, name: 'California', code: 'CA', pid: 233 }] });
      if (u.pathname.endsWith('/proxy/area/city')) return ok({ data: [{ id: 9001, name: 'Los Angeles', code: null, pid: 5001 }] });
      if (u.pathname.endsWith('/proxy/api/proxy/dynamic/traffic')) {
        assert.equal(opts.method, 'POST');
        assert.equal(opts.headers.Authorization, 'Basic a2V5OnNlY3JldA==');
        inFlight += 1; peak = Math.max(peak, inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight -= 1;
        bought += 1;
        if (bought > failAfter) return JSON.stringify({ code: 50301, msg: 'insufficient balance', data: null });
        return purchase ? purchase(bought) : ok({ token_id: bought, username: `u${bought}`, password: 'pw', host: 'proxy.proxy302.com', port: 2222, protocol: 'http' });
      }
      throw new Error(`unexpected ${url}`);
    }
  });
  return { fetch: A.fetchProxy302Pool, urls, stats: () => ({ bought, peak }) };
}

test('Proxy302: signs in on proxy302.com and buys up to 1000 proxies, a few calls at a time', async () => {
  const p = proxy302();
  const rows = await p.fetch({ username: 'key', password: 'secret', country: 'US', count: 1500 });
  assert.equal(rows.length, 1000);
  assert.equal(new Set(rows.map((r) => r.username)).size, 1000);
  assert.ok(p.urls.every((u) => u.startsWith('https://proxy302.com/open_api/v3/')));
  const buy = new URL(p.urls.find((u) => /dynamic\/traffic/.test(u)));
  assert.deepEqual(Object.fromEntries(buy.searchParams), { s: '1', protocol: 'http', country_id: '233', state_id: '0', city_id: '0' });
  assert.ok(p.stats().peak > 1 && p.stats().peak <= 4, `parallel calls: ${p.stats().peak}`);
});

test('Proxy302: premium resolves state and city ids; standard sends the session mode', async () => {
  let p = proxy302();
  await p.fetch({ username: 'key', password: 'secret', country: 'US', state: 'california', city: 'Los Angeles', count: 2 });
  let buy = new URL(p.urls.find((u) => /dynamic\/traffic/.test(u)));
  assert.equal(buy.searchParams.get('state_id'), '5001');
  assert.equal(buy.searchParams.get('city_id'), '9001');
  assert.ok(p.urls.some((u) => /\/proxy\/area\/city\?pid=5001$/.test(u)));
  p = proxy302();
  await p.fetch({ username: 'key', password: 'secret', poolType: 'standard', country: 'US', life: '30', proxyType: 'socks5', count: 2 });
  buy = new URL(p.urls.find((u) => /dynamic\/traffic/.test(u)));
  assert.deepEqual(Object.fromEntries(buy.searchParams), { s: '3', protocol: 'socks5', country_id: '233', state_id: '0', city_id: '0', session_mode: 'sticky', session_duration: '30' });
  await assert.rejects(proxy302().fetch({ username: 'key', password: 'secret', poolType: 'standard', country: 'US', state: 'CA' }), /Premium line only/);
  await assert.rejects(proxy302().fetch({ username: 'key', password: 'secret', country: 'US', city: 'Los Angeles' }), /needs its state/);
  await assert.rejects(proxy302().fetch({ username: 'key', password: 'secret', country: 'US', state: 'Texas' }), /does not list the state "Texas" in US/);
});

test('Proxy302: a failure keeps what was bought; a first failure or bad key explains itself', async () => {
  const partial = await proxy302({ failAfter: 7 }).fetch({ username: 'key', password: 'secret', count: 50 });
  assert.ok(partial.length >= 7 - 3 && partial.length <= 7, `kept ${partial.length}`);
  await assert.rejects(proxy302({ failAfter: 0 }).fetch({ username: 'key', password: 'secret', count: 5 }), /insufficient balance/);
  const denied = proxy302({ purchase: () => JSON.stringify({ code: 401, msg: 'invalid API credential', data: null }) });
  await assert.rejects(denied.fetch({ username: 'key', password: 'secret', count: 5 }), /rejected the API key/);
});
