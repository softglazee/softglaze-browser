'use strict';
// Proxy providers page: the provider list scrolls inside the detail card's height, trial tracking
// stays with the Super Admin, and the Account section reads plan, expiry, traffic and balance from
// each vendor's documented account endpoint.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAGE = read('src/renderer/pages/ProxyProvidersPage.jsx');

test('the provider list scrolls inside the row the detail card sets', () => {
  assert.match(PAGE, /items-start xl:items-stretch/);
  // Size containment keeps the list out of the row height; the list region takes the rest and scrolls.
  assert.match(PAGE, /<Card className="overflow-hidden flex flex-col xl:\[contain:size\] xl:min-h-\[480px\]">/);
  assert.match(PAGE, /<div ref=\{listRef\} className="flex-1 min-h-0 overflow-auto max-h-\[60vh\] xl:max-h-none">/);
  assert.match(PAGE, /<thead className="sticky top-0 /);
  // Columns are unchanged.
  for (const col of ['colProvider', 'colState', 'colPool', 'colKind']) assert.match(PAGE, new RegExp(`t\\('table\\.${col}'\\)`), col);
});

const IPC = read('src/main/ipcHandlers.js');

// Body of a top-level function in a source file, up to the next top-level declaration.
function fnBody(src, name) {
  const start = src.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} not found`);
  const rest = src.slice(start + 1);
  const end = rest.search(/\r?\n(?:async function|function|const|let|module\.exports)\b/);
  return end < 0 ? rest : rest.slice(0, end);
}

test('trial tracking: the IPC read hides it and the IPC write refuses it below Super Admin', () => {
  assert.match(IPC, /const SUPER_ONLY_GLOBAL_KEYS = Object\.freeze\(\['proxyProviderTrials'\]\);/);
  assert.match(fnBody(IPC, 'activeIsSuperAdmin'), /m && m\.role === 'SUPER_ADMIN'/);
  assert.match(fnBody(IPC, 'getGlobalSettingsForActor'), /activeIsSuperAdmin\(\)\) \? all : withoutSuperOnlyKeys\(all\)/);
  const set = fnBody(IPC, 'setGlobalSettingsForActor');
  assert.match(set, /if \(!isSuper && SUPER_ONLY_GLOBAL_KEYS\.some/);
  assert.match(set, /err\.code = 'FORBIDDEN'/);
  assert.ok(set.indexOf("'FORBIDDEN'") < set.indexOf('setGlobalSettings(input)'), 'refused before anything is written');
  assert.match(IPC, /registerHandler\(CHANNELS\.SETTINGS_GET_GLOBAL, getGlobalSettingsForActor\);/);
  assert.match(IPC, /registerHandler\(CHANNELS\.SETTINGS_SET_GLOBAL, setGlobalSettingsForActor\);/);
});

test('trial tracking: the Trial row and its button render only for the Super Admin', () => {
  const panel = PAGE.slice(PAGE.indexOf('function DetailPanel('));
  const open = panel.indexOf('{!p.unavailable && isSuper && (');
  assert.ok(open > 0, 'trial row is gated on isSuper');
  const close = panel.indexOf('</Row>', open);
  const gated = panel.slice(open, close);
  assert.match(gated, /t\('detail\.trial'\)/);
  assert.match(gated, /t\('detail\.trialMark'\)/);
  const outside = panel.slice(0, open) + panel.slice(close);
  assert.doesNotMatch(outside, /detail\.trial|setTrialEdit\(\{/, 'no trial text or control outside the gate');
});

// ---------------------------------------------------------------------------------------------
// Account adapters, against the response samples in each vendor's API docs.
const pa = require('../src/main/providerAccount');

const at = (iso) => Date.parse(iso);
const final = (raw, now) => pa.finalizeAccount(raw, { now });

test('PROXY6: balance + currency from every reply, expiry from the active proxies', () => {
  // proxy6.net/en/developers, getproxy sample (object keyed by id; nokey gives an array).
  const sample = { status: 'yes', user_id: '1', balance: '48.80', currency: 'RUB', list_count: 4, list: { 11: { id: '11', version: '6', ip: '2a00:1838:32:19f:45fb:2640::330', host: '185.22.134.250', port: '7330', user: '5svBNZ', pass: 'iagn2d', type: 'auto', country: 'ru', date: '2016-06-19 16:32:39', date_end: '2016-07-12 11:50:41', unixtime: 1466379159, unixtime_end: 1468349441, descr: '', active: '1' } } };
  const now = at('2016-06-20T00:00:00Z');
  const a = final(pa.parsers.proxy6(JSON.stringify(sample), { now }), now);
  assert.equal(a.status, 'active');
  assert.equal(a.balance, 48.8);
  assert.equal(a.currency, 'RUB');
  assert.equal(a.expiresAt, '2016-07-12T18:50:41.000Z');
  assert.equal(a.trafficLeftGb, null);
  assert.equal(JSON.stringify(a).includes('iagn2d'), false, 'proxy password never copied');
  const arr = pa.parsers.proxy6({ ...sample, list: Object.values(sample.list) }, { now });
  assert.equal(arr.expiresAt, '2016-07-12T18:50:41.000Z');
  assert.throws(() => pa.parsers.proxy6('{ "status": "no", "error_id": 100, "error": "Error key"}'), /rejected the saved API key/);
});

test('Proxmint: balance in USD and bandwidth in bytes per product', () => {
  // proxmint.com/docs/api, GET /api/v1/account sample.
  const sample = { balance: { cents: 1250, usd: '12.50' }, products: [{ id: 'cm1q2w3e4r5t6y7u8i9o0p', product: 'residential', name: 'Residential', status: 'active', billing: 'pack', bandwidth: { limitBytes: 5368709120, usedBytes: 1073741824, remainingBytes: 4294967296, syncedAt: '2026-10-01T09:45:00.000Z' }, proxy: { host: 'gw.proxmint.com', httpPort: 823, socks5Port: 824, username: 'PROXY_USER', password: 'PROXY_PASS' } }] };
  const a = final(pa.parsers.proxmint(JSON.stringify(sample)));
  assert.deepEqual(
    { status: a.status, plan: a.plan, left: a.trafficLeftGb, used: a.trafficUsedGb, total: a.trafficTotalGb, balance: a.balance, currency: a.currency, expiresAt: a.expiresAt },
    { status: 'active', plan: 'Residential', left: 4, used: 1, total: 5, balance: 12.5, currency: 'USD', expiresAt: null }
  );
  assert.equal(JSON.stringify(a).includes('PROXY_PASS'), false);
  assert.equal(final(pa.parsers.proxmint({ products: [{ name: 'Mobile', status: 'expired' }] })).status, 'expired');
  assert.throws(() => pa.parsers.proxmint('{"error":"Invalid API key"}'), /Proxmint: Invalid API key/);
});

test('CatProxies: account balance plus the saved plan (GB figures, ISO expiry)', () => {
  // catproxies.com/docs/api: GET /account and GET /orders/:id samples.
  const account = { type: 'response', message: 'success', payload: { email: 'you@example.com', displayName: 'Alex', country: 'Germany', balance: 42.5, currency: 'USD', pricing: 'retail', totalOrders: 12, activeOrders: 3, rateLimits: { requestsPerHour: 1000 } } };
  const order = { type: 'response', message: 'success', payload: { order: { id: '3b0a7c41-2f18-4d0a-9c33-5a1e77b2c904', package_title: 'Standard Resi 1GB V2', package_proxyType: 'v2resi', package_bandwidth: 1, status: 'CONFIRMED', expire: '2026-12-03T12:00:00.000Z', locked: false, extend_retired: false, proxy: { server_ip: null, username: 'mtpeqbcevnemewc201120', password: 'jonxybfeuu', used_bandwidth: 0.13, bandwidth_left: 0.87, whitelist_ip: [], expired_at: '2026-12-03T12:00:00.000Z', isLiveData: true } } } };
  const now = at('2026-11-03T00:00:00Z');
  const a = final(pa.parsers.catproxies(JSON.stringify(account), JSON.stringify(order), { now }), now);
  assert.equal(a.status, 'active');
  assert.equal(a.plan, 'Standard Resi 1GB V2');
  assert.equal(a.expiresAt, '2026-12-03T12:00:00.000Z');
  assert.equal(a.trafficLeftGb, 0.87);
  assert.equal(a.trafficUsedGb, 0.13);
  assert.equal(a.trafficTotalGb, 1);
  assert.equal(a.balance, 42.5);
  assert.equal(a.currency, 'USD');
  assert.equal(JSON.stringify(a).includes('jonxybfeuu'), false);
  // GET /orders list form, and a locked (run out) plan.
  const list = { type: 'response', message: 'success', payload: { orders: [{ ...order.payload.order, locked: true }] } };
  assert.equal(final(pa.parsers.catproxies(account, list, { now }), now).status, 'expired');
  assert.throws(() => pa.parsers.catproxies('{ "type": "error", "message": "No invoice available for this order" }', order), /No invoice available/);
});

test('MobileProxy.Space: get_balance and the per-proxy proxy_exp (array or { list })', () => {
  // mobileproxy.space/en/user.html?api samples (get_balance; get_my_proxy, trimmed to its documented fields).
  const balance = '{\n  "status": "ok",\n  "balance": 1500.00\n}';
  const proxy = { proxy_id: 123, proxy_exp: '2025-12-31 23:59:59', proxy_login: 'abc123', proxy_pass: 'xyz789', proxy_hostname: 's1.example.com', proxy_host_ip: '1.2.3.4', proxy_operator: 'MTS', proxy_geo: 'Moscow, Russia', proxy_auto_renewal: 1, proxy_testing: 0, proxy_comment: 'My proxy' };
  const now = at('2025-12-01T00:00:00Z');
  const a = final(pa.parsers.mobileproxyspace(balance, JSON.stringify([proxy]), { now }), now);
  assert.equal(a.status, 'active');
  assert.equal(a.balance, 1500);
  assert.equal(a.currency, null, 'the docs name no currency');
  assert.equal(a.expiresAt, '2025-12-31');
  assert.equal(pa.parsers.mobileproxyspace(balance, { status: 'ok', list: [proxy] }, { now }).expiresAt, '2025-12-31');
  assert.equal(JSON.stringify(a).includes('xyz789'), false);
  assert.throws(() => pa.parsers.mobileproxyspace('{ "status": "err", "message": "Too many same requests" }', '[]'), /Too many same requests/);
});

test('Proxy Bonanza: plan name, expiry and plan size; the ambiguous bandwidth figure is not shown', () => {
  // proxybonanza.com/en/articles/api-reference-1, GET userpackages.json sample.
  const sample = { success: true, data: [{ id: 123456, custom_name: null, login: 'login11', password: 'secretpass', expires: '2027-09-17T09:59:00+02:00', bandwidth: 4772417328398, last_ip_change: '2026-05-29T14:03:00+02:00', low_banwidth_notification_percent: 25, ipstack: 'mixed', ipstackorder: 'v4v6', package: { name: 'Exclusive Plan', bandwidth: 10737418240, price: { amount: '10', currency: 'USD' }, howmany_ips: 20, price_per_gig: { amount: '1', currency: 'USD' }, package_type: 'exclusive', howmany_authips: 10, price_user_formatted: '$10.00' }, bandwidth_gb: 4772.42, additional_bandwidth_gb: 1, bandwidth_percent_left_human: '6734.04%', expiration_date_human: '334 days', name: 'Exclusive Plan' }] };
  const now = at('2026-11-03T00:00:00Z');
  const a = final(pa.parsers.proxybonanza(JSON.stringify(sample), { now }), now);
  assert.equal(a.status, 'active');
  assert.equal(a.plan, 'Exclusive Plan');
  assert.equal(a.expiresAt, '2027-09-17T07:59:00.000Z');
  assert.equal(a.trafficTotalGb, 10);
  assert.equal(a.trafficLeftGb, null);
  assert.equal(a.trafficUsedGb, null);
  assert.equal(a.note, 'planSizeOnly');
  assert.equal(JSON.stringify(a).includes('secretpass'), false);
  const err = { success: false, data: { message: 'Authentication is required to continue', url: '/api/v1/userpackages.json', code: 401 } };
  assert.throws(() => pa.parsers.proxybonanza(err), /Authentication is required to continue/);
});

test('Proxies.sx: wallet and traffic of the active subscriptions (GB)', () => {
  // proxies.sx/docs, GET /v1/account sample.
  const sample = { user: { _id: '6935a45d04523391208cc33c', email: 'user@example.com', role: 'customer', isActive: true }, wallet: { totalDeposited: 100.00, totalSpent: 50.00, availableBalance: 50.00, currency: 'USD' }, tier: { current: 'Bronze', cumulativeGB: 25.5, nextTier: 'Silver', nextTierAt: 25, slots: { shared: { total: 10, used: 2, available: 8 }, private: { total: 2, used: 0, available: 2 } } }, subscription: { shared: { active: true, traffic: { purchasedGB: 10, usedGB: 2.5, availableGB: 7.5 }, trafficNeverExpires: true }, private: { active: false, traffic: { purchasedGB: 0, usedGB: 0, availableGB: 0 }, trafficNeverExpires: true } }, status: { hasActiveSubscription: true, hasAvailableTraffic: true, lowBalance: false, lowTraffic: false } };
  const a = final(pa.parsers.proxiessx(JSON.stringify(sample)));
  assert.deepEqual(
    { status: a.status, plan: a.plan, left: a.trafficLeftGb, used: a.trafficUsedGb, total: a.trafficTotalGb, balance: a.balance, currency: a.currency },
    { status: 'active', plan: 'Shared', left: 7.5, used: 2.5, total: 10, balance: 50, currency: 'USD' }
  );
  assert.equal(final(pa.parsers.proxiessx({ ...sample, user: { isActive: false } })).status, 'suspended');
});

test('Coronium: USD balance (USDT + account credit) and the next line to expire (epoch ms)', () => {
  // api.coronium.io/openapi.json: GET /account example and the Proxy fields of GET /account/proxies.
  const account = '{"_id":"6987f409458ab900818330f3","name":"Acme Proxies","login":"reseller@example.com","btc":{"balance":0},"usdt":{"balance":10},"accountCredit":1,"proxyCount":2}';
  const proxies = { data: [{ rotation_interval: 300, rotated_at: 1771604488277, isOnline: true, tariff_expired_at: 1772182221484, tariff_id: '6519b2ed5df31c2dd5405810' }] };
  const now = at('2026-02-01T00:00:00Z');
  const a = final(pa.parsers.coronium(account, JSON.stringify(proxies), { now }), now);
  assert.equal(a.status, 'active');
  assert.equal(a.balance, 11);
  assert.equal(a.currency, 'USD');
  assert.equal(a.expiresAt, '2026-02-27T08:50:21.484Z');
  // Every line past its end reads as expired.
  const later = at('2026-03-01T00:00:00Z');
  assert.equal(final(pa.parsers.coronium(account, proxies, { now: later }), later).status, 'expired');
  assert.throws(() => pa.parsers.coronium('{"error":"Not authenticated","code":"auth_required"}', proxies), /Not authenticated/);
});

test('Singapore Mobile Proxy: plan, licence, ISO expiry, GB limit/used and credits', () => {
  // singaporemobileproxy.com/api-docs: GET /proxies/my and GET /account/balance samples.
  const proxies = { proxyList: [{ uuid: 'db4474ea-...', license_status: 'ACTIVE', package_name: '300GB Singapore', host_domain: 'sg.veerlane.com', http_port: 8101, socket_port: 5101, start_date: '2026-03-01T00:00:00Z', expired_date: '2026-04-01T00:00:00Z', m_type: 'PROXYSMART', status: 'CONNECTED', rotation_link: 'https://...', min_time_change_ip: 5, authentication_user: 'proxy_abc123:password123', authorization_ips: '', dl_bytes: '0', bandwidth_limit_gb: 300, bandwidth_used_gb: 45.2, auto_extend: false }] };
  const balance = { credits: 15.00, transactions: [{ id: '...', amount: 15.00, balance_after: 15.00, type: 'promotion', description: 'welcome bonus', created_at: '2026-03-20T10:00:00Z' }] };
  const now = at('2026-03-25T00:00:00Z');
  const a = final(pa.parsers.singaporemobileproxy(JSON.stringify(proxies), JSON.stringify(balance), { now }), now);
  assert.deepEqual(
    { status: a.status, plan: a.plan, expiresAt: a.expiresAt, left: a.trafficLeftGb, used: a.trafficUsedGb, total: a.trafficTotalGb, balance: a.balance, currency: a.currency },
    { status: 'active', plan: '300GB Singapore', expiresAt: '2026-04-01T00:00:00.000Z', left: 254.8, used: 45.2, total: 300, balance: 15, currency: null }
  );
  assert.equal(JSON.stringify(a).includes('password123'), false);
  assert.throws(() => pa.parsers.singaporemobileproxy('{"detail": {"message": "Invalid API key"}}', balance), /Invalid API key/);
});

test('MarsProxies, IPRoyal and Proxidize: traffic figures only', () => {
  // docs.marsproxies.com ResidentialUserResource (schema only: traffic_available in GB).
  const mars = final(pa.parsers.marsproxies('{"traffic_available": 12.5, "subusers_count": 2, "hash": "abc"}'));
  assert.equal(mars.trafficLeftGb, 12.5);
  assert.equal(mars.status, 'active');
  assert.throws(() => pa.parsers.marsproxies('{"error":{"code":"forbidden","message":"Residential API is not enabled for this account","trace_id":"x"}}'), /not enabled/);
  // docs.iproyal.com residential /me sample.
  const ipr = final(pa.parsers.iproyal('{"available_traffic": 32.6, "subusers_count": 13, "residential_user_hash": "01H7YCG0R9GYY1YCPS2S4QA6WB"}'));
  assert.equal(ipr.trafficLeftGb, 32.6);
  assert.equal(ipr.plan, 'Residential');
  // help.proxidize.com user-info schema (bytes_used / bytes_available; the reply carries a password).
  const pdz = final(pa.parsers.proxidize([JSON.stringify({ id: 1, username: 'u', password: 'pdzsecret', enabled: true, bytes_used: 1073741824, bytes_available: 4294967296, type: 'mobile' })]));
  assert.equal(pdz.trafficUsedGb, 1);
  assert.equal(pdz.trafficLeftGb, 4);
  assert.equal(pdz.status, 'active');
  assert.equal(JSON.stringify(pdz).includes('pdzsecret'), false);
});

test('Proxy-Seller: residential package (bytes as strings) and balance/get', () => {
  // docs.proxy-seller.com api-v2: resident/package and balance samples.
  const pkg = { status: 'success', data: { rotation: 3600, package_key: '064b9fcc7416d9e6f65f', is_active: true, tarif_id: '69e79e532c200df885906f8f', is_link_date: false, traffic_limit: '1073741824', traffic_usage: '0', traffic_left: '1073741824', traffic_usage_sub: '0', traffic_limit_sub: '0', traffic_left_sub: '0', expired_at: '2026-06-13 23:59:59', auto_renew: false }, errors: [] };
  const balance = { status: 'success', data: { summ: 10 }, errors: [] };
  const now = at('2026-06-01T00:00:00Z');
  const a = final(pa.parsers.proxyseller(JSON.stringify(pkg), JSON.stringify(balance)), now);
  assert.deepEqual(
    { status: a.status, plan: a.plan, expiresAt: a.expiresAt, left: a.trafficLeftGb, used: a.trafficUsedGb, total: a.trafficTotalGb, balance: a.balance, currency: a.currency },
    { status: 'active', plan: 'Residential', expiresAt: '2026-06-13', left: 1, used: 0, total: 1, balance: 10, currency: null }
  );
  // The SDK README's dd.MM.yyyy HH:mm:ss form reads as the same day.
  const sdk = { ...pkg, data: { ...pkg.data, expired_at: '13.06.2026 23:59:59' } };
  assert.equal(final(pa.parsers.proxyseller(JSON.stringify(sdk), JSON.stringify(balance)), now).expiresAt, '2026-06-13');
  // No residential package: the balance still shows.
  const none = { status: 'error', data: null, errors: [{ message: 'Tarif not found', code: 0, customData: null }] };
  const b = final(pa.parsers.proxyseller(JSON.stringify(none), JSON.stringify(balance)), now);
  assert.equal(b.balance, 10);
  assert.equal(b.note, 'noActivePlans');
  const denied = { status: 'error', data: null, errors: [{ message: 'Error api key', code: 503, customData: null }, { message: 'IP not allowed', code: 503, customData: null }, { message: 'Request limit reached', code: 503, customData: null }] };
  assert.throws(() => pa.parsers.proxyseller(JSON.stringify(pkg), JSON.stringify(denied)), /refused this request/);
});

test('Bright Data: balance in USD from /customer/balance', () => {
  // docs.brightdata.com Get_total_balance_through_API (OpenAPI examples).
  const a = final(pa.parsers.brightdata('{"balance": 220, "credit": 0, "prepayment": 0, "pending_costs": 0}'));
  assert.equal(a.balance, 220);
  assert.equal(a.currency, 'USD');
  assert.equal(a.status, 'unknown');
});

test('Gsocks: balance and residential/mobile volume in GB', () => {
  // help.gsocks.net API documentation: /client/balance and /proxy/residential-volume samples.
  const a = final(pa.parsers.gsocks('{\n  "balance": "25.50"\n}', ['{\n  "have_traffic": true,\n  "rest_volume": "7.35",\n  "volume": "10.00"\n}']));
  assert.deepEqual(
    { status: a.status, left: a.trafficLeftGb, used: a.trafficUsedGb, total: a.trafficTotalGb, balance: a.balance, currency: a.currency },
    { status: 'active', left: 7.35, used: 2.65, total: 10, balance: 25.5, currency: null }
  );
});

test('MangoProxy: balance in USD and traffic in MB per type (OpenAPI schema)', () => {
  // backend.mangoproxy.com/public-api/docs-json: BalanceDto and TrafficDto.
  const traffic = { totalResidentialMB: 10240, usedResidentialMB: 2048, availableResidentialMB: 8192, totalDatacenterMB: 0, usedDatacenterMB: 0, availableDatacenterMB: 0, totalIspMB: 0, usedIspMB: 0, availableIspMB: 0, totalResidentialLightMB: 0, usedResidentialLightMB: 0, availableResidentialLightMB: 0 };
  const a = final(pa.parsers.mangoproxy('{"balanceUSD": 7.5}', JSON.stringify(traffic)));
  assert.deepEqual(
    { status: a.status, plan: a.plan, left: a.trafficLeftGb, used: a.trafficUsedGb, total: a.trafficTotalGb, balance: a.balance, currency: a.currency },
    { status: 'active', plan: 'Residential', left: 8, used: 2, total: 10, balance: 7.5, currency: 'USD' }
  );
});

test('parsers survive empty, odd and hostile payloads', () => {
  const bodies = ['', 'null', '[]', '{}', 'not json', '{"products":"x","balance":"lots"}', '{"proxyList":[null,1,"x"]}', '{"data":[{"expires":"soon","package":{"bandwidth":"-5"}}],"success":true}'];
  const twoArg = ['catproxies', 'mobileproxyspace', 'coronium', 'singaporemobileproxy', 'proxyseller', 'mangoproxy'];
  for (const [key, parse] of Object.entries(pa.parsers)) {
    for (const body of bodies) {
      let raw = null;
      try {
        if (twoArg.includes(key)) raw = parse(body, body);
        else if (key === 'proxidize') raw = parse([body]);
        else if (key === 'gsocks') raw = parse(body, [body]);
        else raw = parse(body);
      } catch (e) {
        assert.ok(e instanceof Error && typeof e.message === 'string', `${key} throws a plain Error on ${JSON.stringify(body)}`);
        continue;
      }
      const a = final(raw);
      for (const k of ['trafficLeftGb', 'trafficUsedGb', 'trafficTotalGb', 'balance']) assert.ok(a[k] === null || Number.isFinite(a[k]), `${key}.${k}`);
      assert.ok(['active', 'expired', 'suspended', 'unknown'].includes(a.status), `${key}.status`);
      assert.ok(a.trafficTotalGb === null || a.trafficTotalGb >= 0, `${key} clamps negatives`);
    }
  }
});

test('finalizeAccount: fixed shape, typed fields, past expiry reads as expired', () => {
  const keys = ['status', 'plan', 'expiresAt', 'trafficLeftGb', 'trafficUsedGb', 'trafficTotalGb', 'balance', 'currency', 'dashboardUrl', 'note'];
  const a = pa.finalizeAccount({ status: 'weird', plan: { x: 1 }, expiresAt: '2020-01-01', balance: '5', currency: 'usd', note: 'free text from a vendor', extra: 'dropped' }, { now: at('2026-01-01T00:00:00Z') });
  assert.deepEqual(Object.keys(a).sort(), keys.sort());
  assert.equal(a.status, 'expired');
  assert.equal(a.plan, null);
  assert.equal(a.balance, 5);
  assert.equal(a.currency, 'USD');
  assert.equal(a.note, null, 'only known note codes pass');
  assert.equal(pa.normDate('2026-02-30'), null);
  assert.equal(pa.normDate(0), null);
  assert.equal(pa.nextExpiry(['2026-01-01', '2026-05-01', '2026-03-01'], at('2026-02-01T00:00:00Z')), '2026-03-01');
});

// ---------------------------------------------------------------------------------------------
// Registry: fallback, credentials, secrets.

test('registry: providers without a confirmed account API fall back with their dashboard link', async () => {
  let calls = 0;
  const get = async () => { calls += 1; return '{}'; };
  for (const key of ['dataimpulse', 'airproxy', 'proxysolutions', 'proxy302', 'shopsocks5', 'ipfoxy', 'nodemaven', 'oxylabs', 'no-such-vendor']) {
    const r = await pa.checkProviderAccount(key, { token: 'abcdefgh', username: 'u', password: 'p' }, get);
    assert.equal(r.supported, false, key);
    assert.equal(r.account, null, key);
  }
  assert.equal(calls, 0, 'no vendor call without an adapter');
  assert.equal((await pa.checkProviderAccount('dataimpulse', {}, get)).dashboardUrl, 'https://app.dataimpulse.com/');
  assert.equal(pa.dashboardUrlFor('no-such-vendor'), null);
  for (const [key, a] of Object.entries(pa.ADAPTERS)) {
    assert.ok(a.name && Array.isArray(a.needs) && a.needs.length && a.needsLabel && typeof a.fetch === 'function', key);
    assert.ok(a.dashboardUrl === null || /^https:\/\//.test(a.dashboardUrl), key);
    assert.ok(!Object.prototype.hasOwnProperty.call(pa.DASHBOARD_URLS, key), `${key} keeps its link on the adapter`);
  }
  for (const url of Object.values(pa.DASHBOARD_URLS)) assert.match(url, /^https:\/\//);
});

test('registry: a missing saved key stops before any vendor call', async () => {
  let calls = 0;
  await assert.rejects(pa.checkProviderAccount('proxmint', {}, async () => { calls += 1; return '{}'; }), /no saved API key/);
  await assert.rejects(pa.checkProviderAccount('brightdata', { token: 'x' }, async () => { calls += 1; return '{}'; }), /no saved API token/);
  assert.equal(calls, 0);
});

test('registry: requests go to the documented endpoint with the documented auth', async () => {
  const seen = [];
  const get = (body) => async (url, opts = {}) => { seen.push({ url, headers: opts.headers || {} }); return typeof body === 'function' ? body(url) : body; };
  const r = await pa.checkProviderAccount('proxmint', { token: 'pmk_abcdefgh123' }, get('{"balance":{"cents":0},"products":[]}'));
  assert.equal(r.supported, true);
  assert.equal(seen[0].url, 'https://proxmint.com/api/v1/account');
  assert.equal(seen[0].headers.Authorization, 'Bearer pmk_abcdefgh123');
  seen.length = 0;
  await pa.checkProviderAccount('proxyseller', { token: 'abcd1234efgh' }, get((u) => (u.endsWith('balance/get') ? '{"status":"success","data":{"summ":1},"errors":[]}' : '{"status":"success","data":{"is_active":true},"errors":[]}')));
  assert.deepEqual(seen.map((s) => s.url), ['https://proxy-seller.com/personal/api/v2/abcd1234efgh/resident/package', 'https://proxy-seller.com/personal/api/v2/abcd1234efgh/balance/get']);
  seen.length = 0;
  await pa.checkProviderAccount('catproxies', { token: 'cp_abcdefgh12', orderId: '3b0a7c41-2f18-4d0a-9c33-5a1e77b2c904' }, get('{"type":"response","payload":{}}'));
  assert.deepEqual(seen.map((s) => s.url), ['https://catproxies.com/api/v1/user/account', 'https://catproxies.com/api/v1/user/orders/3b0a7c41-2f18-4d0a-9c33-5a1e77b2c904']);
  seen.length = 0;
  await pa.checkProviderAccount('proxiessx', { token: 'psx_key123' }, get('{}'));
  assert.equal(seen[0].url, 'https://api.proxies.sx/v1/account');
  assert.equal(seen[0].headers['X-API-Key'], 'psx_key123');
  seen.length = 0;
  await pa.checkProviderAccount('brightdata', { apiToken: 'bd-token-123' }, get('{"balance":1}'));
  assert.equal(seen[0].url, 'https://api.brightdata.com/customer/balance');
  assert.equal(seen[0].headers.Authorization, 'Bearer bd-token-123');
  seen.length = 0;
  await pa.checkProviderAccount('gsocks', { token: 'gskey123' }, get('{"balance":"1"}'));
  assert.deepEqual(seen.map((s) => s.url), ['https://api.gsocks.net/client/balance', 'https://api.gsocks.net/proxy/residential-volume', 'https://api.gsocks.net/proxy/mobile-volume']);
  assert.equal(seen[0].headers.authorization, 'key gskey123');
});

test('no secret in a result or an error', async () => {
  const token = 'pmk_SuperSecretKey99';
  // A vendor echoing the key back in a plan name.
  const r = await pa.checkProviderAccount('proxmint', { token }, async () => JSON.stringify({ products: [{ name: `Plan ${token}`, status: 'active' }] }));
  assert.equal(JSON.stringify(r).includes(token), false);
  // An error body that echoes a key, raw and URL-encoded.
  const key = 'abc/def?';
  assert.equal(pa.scrubSecrets(`HTTP 500 Unknown action /v2/${encodeURIComponent(key)}/x and ${key}`, [key]).includes('abc'), false);
  const psKey = 'PsKey12345678';
  await assert.rejects(
    pa.checkProviderAccount('proxyseller', { token: psKey }, async (url) => { throw Object.assign(new Error(`HTTP 500 Unknown action ${url}`), { status: 500 }); }),
    (e) => !e.message.includes(psKey) && /Proxy-Seller account check failed/.test(e.message)
  );
  await assert.rejects(
    pa.checkProviderAccount('marsproxies', { token: 'mars-token-xyz' }, async () => { throw Object.assign(new Error('HTTP 401'), { status: 401 }); }),
    (e) => /rejected the saved key/.test(e.message) && !e.message.includes('mars-token-xyz')
  );
  // Basic auth and userinfo forms.
  const basic = Buffer.from('loginname:pa55word').toString('base64');
  const msg = pa.scrubSecrets(`Authorization: Basic ${basic} http://loginname:pa55word@host`, pa.secretsOf({ username: 'loginname', password: 'pa55word' }));
  assert.equal(/pa55word|loginname/.test(msg) || msg.includes(basic), false);
  assert.ok(pa.secretsOf({ username: 'u', password: 'secret', token: 'tok1', apiToken: 'tok2' }).includes('tok2'));
});

// ---------------------------------------------------------------------------------------------
// IPC wiring and the gate.

const PRELOAD = read('src/preload/preload.js');
const API = read('src/renderer/lib/softglazeApi.js');

test('handler: gated on proxies.manage, cache readable only through it, no secrets returned', () => {
  const body = fnBody(IPC, 'getProviderAccount');
  assert.match(body, /^async function getProviderAccount\(payload\) \{\r?\n {2}await requirePermission\('proxies\.manage'\);/);
  assert.match(body, /input\.cachedOnly/);
  assert.match(body, /writeSetting\('providerAccountCache'/);
  assert.match(body, /return \{ provider, supported: true, dashboardUrl, account \};/);
  assert.doesNotMatch(body, /return [^\n]*creds/, 'credentials never returned');
  // The cache key is read in one place, and only the gated handler calls it.
  assert.equal((IPC.match(/'providerAccountCache'/g) || []).length, 2, 'one read, one write');
  assert.match(fnBody(IPC, 'readProviderAccountCache'), /readSetting\('providerAccountCache'/);
  const callers = IPC.split(/\r?\n/).filter((l) => /readProviderAccountCache\(\)/.test(l) && !/async function/.test(l));
  assert.ok(callers.length >= 1 && callers.every((l) => body.includes(l.trim())), 'cache read only inside getProviderAccount');
  assert.match(IPC, /PROXY_PROVIDER_ACCOUNT: 'proxy:provider-account',/);
  assert.match(IPC, /registerHandler\(CHANNELS\.PROXY_PROVIDER_ACCOUNT, getProviderAccount\);/);
  assert.match(PRELOAD, /PROXY_PROVIDER_ACCOUNT: 'proxy:provider-account',/);
  assert.match(PRELOAD, /providerAccount: \(payload\) => invoke\(CHANNELS\.PROXY_PROVIDER_ACCOUNT, payload\)/);
  assert.match(API, /providerAccount: \(payload\) => getSoftglazeApi\(\)\.proxies\.providerAccount\(payload\)/);
});

test('renderer: the Account section sits on the right card for every live provider', () => {
  assert.match(PAGE, /import ProviderAccount from '@\/components\/ProviderAccount\.jsx';/);
  assert.match(PAGE, /\{!p\.unavailable && <ProviderAccount providerKey=\{p\.key\} \/>\}/);
  const cmp = read('src/renderer/components/ProviderAccount.jsx');
  assert.match(cmp, /providerAccount\(\{ provider: providerKey, cachedOnly: true \}\)/);
  assert.match(cmp, /providerAccount\(\{ provider: key \}\)/);
  assert.match(cmp, /t\('providerAccount\.notSupported'\)/);
});

// ---------------------------------------------------------------------------------------------
// Display rules and strings.

test('view: expiry warns inside 7 days, turns destructive once past; 0 GB left is destructive', async () => {
  const v = await import(require('node:url').pathToFileURL(path.join(ROOT, 'src/renderer/lib/providerAccountView.mjs')).href);
  const now = new Date(2026, 10, 3, 15, 0, 0);
  assert.equal(v.daysLeft('2026-11-03', now), 0);
  assert.equal(v.expiryTone('2026-11-10', now), 'warning');
  assert.equal(v.expiryTone('2026-11-11', now), null);
  assert.equal(v.expiryTone('2026-11-02', now), 'destructive');
  assert.equal(v.expiryTone(null, now), null);
  assert.equal(v.trafficTone(0), 'destructive');
  assert.equal(v.trafficTone(0.5), null);
  assert.equal(v.trafficTone(null), null);
  assert.equal(v.statusTone('expired'), 'destructive');
  assert.equal(v.statusTone('suspended'), 'destructive');
  assert.equal(v.statusTone('active'), 'success');
  assert.equal(v.TONE_CLASS.warning, 'text-warning');
  assert.equal(v.TONE_CLASS.destructive, 'text-destructive');
  assert.equal(v.formatGb(4, 'en'), '4 GB');
  assert.equal(v.formatGb(0.871, 'en'), '0.87 GB');
  assert.equal(v.formatMoney(12.5, 'USD', 'en'), '$12.50');
  assert.equal(v.formatMoney(1500, null, 'en'), '1,500');
  assert.deepEqual(v.accountRows({ plan: 'P', expiresAt: '2026-01-01', trafficLeftGb: 1, balance: 0 }), ['plan', 'expires', 'traffic', 'balance']);
  assert.deepEqual(v.accountRows({ status: 'unknown', plan: null, expiresAt: null, trafficLeftGb: null, trafficUsedGb: null, trafficTotalGb: null, balance: null }), []);
});

test('en and es have the same Account strings, covering every status and note code', () => {
  const en = JSON.parse(read('src/renderer/i18n/locales/en/proxies.json')).providerAccount;
  const es = JSON.parse(read('src/renderer/i18n/locales/es/proxies.json')).providerAccount;
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepEqual(flat(en), flat(es));
  for (const k of ['statusActive', 'statusExpired', 'statusSuspended', 'statusUnknown', 'notSupported', 'check']) assert.ok(en[k] && es[k], k);
  for (const code of pa.NOTE_CODES) assert.ok(en.note[code] && es.note[code], code);
  const cmp = read('src/renderer/components/ProviderAccount.jsx');
  for (const [, key] of cmp.matchAll(/t\('providerAccount\.([A-Za-z]+)'/g)) assert.ok(en[key] !== undefined || en[`${key}_one`] !== undefined, key);
});
