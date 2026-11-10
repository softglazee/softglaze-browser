'use strict';
// MountProxies connector. Fixtures follow the public Swagger 2.0 spec at api.mountproxies.com/public_docs
// (read 2026-11-10): GET /proxies?output=json (the docs sample, with placeholders), the rotate replies
// { message } with 200, 401 "Invalid API key" and 404 "Invalid ID supplied". Built from the docs only;
// no test reaches MountProxies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/main/proxyVendorUtils');
const pa = require('../src/main/providerAccount');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'ProxyProviders.jsx'), 'utf8');
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lang, 'cmpSettingsC.json'), 'utf8'));

const KEY = 'MPTESTKEY0000example';
const NOW = Date.parse('2026-11-10T12:00:00Z');

const between = (from, to) => {
  const a = IPC.indexOf(from);
  const b = IPC.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `section ${from} .. ${to} must exist`);
  return IPC.slice(a, b);
};
const fnSrc = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};
const SECTION = between('// ---- MountProxies (dedicated', '// ---- Massive (residential');
const httpError = (status, body = '') => Object.assign(new Error(`HTTP ${status} ${body}`.trim()), { status });

// The docs sample row (placeholders as published), with a second modem.
const ROW = {
  proxy_ip: '192.0.2.50', http_port: 8001, username: 'PROXY_USER', password: 'PROXY_PASS',
  modem_key: 'MODEM_KEY_1', subscription_key: 'SUB_KEY_1', api_key: KEY,
  cellular_network: 'USA AT&T', location: 'SampleCity', auto_renew_at: '2026-12-01T00:00:00.000Z',
  expire_at: 'N/A', new_renewal_price: 'N/A', billing_cycle: 'weekly', multilocation_product: 'No'
};
const ROW2 = { ...ROW, proxy_ip: '192.0.2.51', http_port: 8002, username: 'U2', password: 'P2', modem_key: 'MODEM_KEY_2', subscription_key: 'SUB_KEY_2', location: 'Philadelphia', expire_at: '2026-12-20T00:00:00.000Z', billing_cycle: 'monthly' };
const list = (...rows) => JSON.stringify({ success: true, data: rows });

function load(route, saved = { token: KEY }) {
  const calls = [];
  const httpRequestText = async (url, options = {}) => {
    calls.push({ url, headers: options.headers || {} });
    return route(url);
  };
  const scope = {
    ...U,
    httpRequestText,
    mountProxiesRows: (body, opts) => U.mountProxiesRows(body, { ...opts, now: NOW }),
    readSavedProviderCreds: async (provider) => (provider === 'mountproxies' ? saved : null)
  };
  const consts = `const LIST_IMPORT_MAX = ${/const LIST_IMPORT_MAX = (\d+);/.exec(IPC)[1]};`;
  const code = [consts, fnSrc('clampPoolCount'), fnSrc('limitListRows'), SECTION].join('\n');
  // eslint-disable-next-line no-new-func
  const api = new Function(...Object.keys(scope), `${code}\nreturn { fetchMountProxiesPool, rotateMountProxies };`)(...Object.values(scope));
  return { ...api, calls };
}

// ---- The rows ----

test('the docs sample becomes one HTTP row in the US, with none of the account keys', () => {
  const r = U.mountProxiesRows(list(ROW), { now: NOW });
  assert.equal(r.rows.length, 1);
  const row = r.rows[0];
  assert.deepEqual([row.type, row.host, row.port, row.username, row.password, row.country], ['HTTP', '192.0.2.50', 8001, 'PROXY_USER', 'PROXY_PASS', 'US']);
  assert.equal(row.label, 'MountProxies • USA AT&T • SampleCity • 8001');
  assert.equal(row.rotationUrl, undefined, 'no rotation link: it would carry the account key');
  const text = JSON.stringify(r.rows);
  for (const secret of [KEY, 'MODEM_KEY_1', 'SUB_KEY_1']) assert.equal(text.includes(secret), false, secret);
});

test('a past expire_at is skipped, "N/A" is kept, a dated plan says until when; no-login modems are counted', () => {
  const past = { ...ROW2, expire_at: '2026-11-01T00:00:00.000Z' };
  const noLogin = { ...ROW, proxy_ip: '192.0.2.52', username: '', password: '' };
  const r = U.mountProxiesRows(list(ROW, ROW2, past, noLogin), { now: NOW });
  assert.deepEqual(r.rows.map((x) => x.host), ['192.0.2.50', '192.0.2.51']);
  assert.match(r.rows[1].label, / • until 2026-12-20$/);
  assert.deepEqual([r.total, r.expired, r.noLogin], [4, 1, 1]);
  assert.match(U.mountProxiesRows({ success: false, data: [] }).error, /reported a failure/);
  assert.match(U.mountProxiesRows('<html>').error, /reported a failure/);
});

// ---- The pull ----

test('a pull reads the list once, with the key in the query string, and caps How many', async () => {
  const a = load(() => list(ROW, ROW2));
  const rows = await a.fetchMountProxiesPool({ token: KEY, count: '1' });
  assert.equal(a.calls.length, 1);
  assert.equal(a.calls[0].url, `https://api.mountproxies.com/api/proxies?api_key=${KEY}&output=json`);
  assert.equal(rows.length, 1);
  assert.equal((await a.fetchMountProxiesPool({ token: KEY, count: '' })).length, 2, 'blank adds them all');
});

test('every failure is a fixed message that never contains the key or the URL', async () => {
  const cases = [
    [() => { throw httpError(401, 'Unauthorized'); }, /rejected the API key\. Copy it again from your account page\./],
    [() => { throw httpError(429, `slow down ${KEY}`); }, /too many requests\. Wait a minute and pull again\./],
    [() => { throw new Error(`connect ETIMEDOUT https://api.mountproxies.com/api/proxies?api_key=${KEY}`); }, /could not read the proxy list/],
    [() => JSON.stringify({ success: false }), /reported a failure/],
    [() => list(), /no active proxies on this account/],
    [() => list({ ...ROW, username: '', password: '' }), /use IP authorization only/],
    [() => list({ ...ROW, expire_at: '2026-01-01' }), /no active proxies on this account/]
  ];
  for (const [route, want] of cases) {
    await assert.rejects(load(route).fetchMountProxiesPool({ token: KEY }), (e) => want.test(e.message) && !e.message.includes(KEY) && !/api_key=/.test(e.message), String(want));
  }
  await assert.rejects(load(() => list(ROW)).fetchMountProxiesPool({ token: 'short' }), /paste the API key from your account page/);
  assert.doesNotMatch(SECTION, /throw new Error\([^;]*\b(error|e|failed)\.message\b/, 'a transport error is never echoed');
  assert.doesNotMatch(SECTION, /\/(update_credentials|rotation_time|change_location)/, 'no call that changes the modem');
});

// ---- Rotate IP through the provider API ----

test('Rotate IP: the saved key finds the modem\'s subscription_key, then V2 rotates it', async () => {
  const a = load((url) => (url.includes('/proxies?') ? list(ROW, ROW2) : JSON.stringify({ message: 'Your IP will be rotated in ~10 seconds' })));
  const r = await a.rotateMountProxies({ provider: 'mountproxies', host: '192.0.2.51', port: 8002, username: 'U2', password: 'P2' });
  assert.equal(a.calls[1].url, `https://api.mountproxies.com/api/subscription/SUB_KEY_2/rotate_ip?api_key=${KEY}`);
  assert.equal(r.ok, true);
  assert.equal(r.response, 'Your IP will be rotated in ~10 seconds (V2)');
  assert.equal(r.response.includes(KEY), false);
});

test('Rotate IP: a 404 on V2 retries once with the V1 path and the modem_key', async () => {
  const a = load((url) => {
    if (url.includes('/proxies?')) return list(ROW);
    if (url.includes('/subscription/')) throw httpError(404, '{"message":"Invalid ID supplied"}');
    return JSON.stringify({ message: 'ok' });
  });
  const r = await a.rotateMountProxies({ provider: 'mountproxies', host: '192.0.2.50', port: 8001, username: 'PROXY_USER' });
  assert.equal(a.calls[2].url, `https://api.mountproxies.com/api/proxy/MODEM_KEY_1/rotate_ip?api_key=${KEY}`);
  assert.equal(r.response, 'ok (V1)');
});

test('Rotate IP fails clearly: no saved key, a proxy no longer listed, a refusal; never with the key', async () => {
  await assert.rejects(load(() => list(ROW), null).rotateMountProxies({ host: '192.0.2.50', port: 8001, username: 'PROXY_USER' }), /Save it on the Proxy providers page/);
  await assert.rejects(load(() => list(ROW)).rotateMountProxies({ host: '192.0.2.99', port: 8001, username: 'PROXY_USER' }), /no longer on your account/);
  const refusal = load((url) => {
    if (url.includes('/proxies?')) return list(ROW);
    throw httpError(400, `{"message":"Manual IP rotation is a paid add-on for ${KEY}"}`);
  });
  await assert.rejects(refusal.rotateMountProxies({ host: '192.0.2.50', port: 8001, username: 'PROXY_USER' }), (e) => /refused the rotation: Manual IP rotation is a paid add-on for \*\*\*/.test(e.message) && /wait at least one minute/.test(e.message) && !e.message.includes(KEY));
  const both404 = load((url) => { if (url.includes('/proxies?')) return list(ROW); throw httpError(404, '{"message":"Invalid ID supplied"}'); });
  await assert.rejects(both404.rotateMountProxies({ host: '192.0.2.50', port: 8001, username: 'PROXY_USER' }), /could not find this proxy to rotate/);
  const badKey = load(() => { throw httpError(401, 'Unauthorized'); });
  await assert.rejects(badKey.rotateMountProxies({ host: '192.0.2.50', port: 8001, username: 'PROXY_USER' }), /rejected the saved API key/);
  const offline = load((url) => { if (url.includes('/proxies?')) return list(ROW); throw new Error(`socket hang up ${KEY}`); });
  await assert.rejects(offline.rotateMountProxies({ host: '192.0.2.50', port: 8001, username: 'PROXY_USER' }), (e) => /could not reach the API/.test(e.message) && !e.message.includes(KEY));
});

test('the rotate hook: a pulled MountProxies row can rotate with no link; the key never goes in a link', () => {
  const src = ['isDataImpulseSticky', 'apiRotationProvider', 'proxyCanRotate'].map(fnSrc).join('\n');
  // eslint-disable-next-line no-new-func
  const f = new Function(`${src}\nreturn { apiRotationProvider, proxyCanRotate };`)();
  const row = { provider: 'mountproxies', host: '192.0.2.50', port: 8001, username: 'PROXY_USER', password: 'PROXY_PASS', rotationUrl: null };
  assert.equal(f.apiRotationProvider(row), 'mountproxies');
  assert.equal(f.proxyCanRotate(row), true);
  assert.equal(f.proxyCanRotate({ ...row, provider: 'other' }), false);
  assert.equal(f.proxyCanRotate({ ...row, username: '' }), false);
  assert.match(IPC, /const PROVIDER_ROTATORS = Object\.freeze\(\{\r?\n {2}dataimpulse: rotateDataImpulseSticky,[\s\S]*?mountproxies: \(proxy\) => rotateMountProxies\(proxy\)\r?\n\}\);/);
  assert.match(fnSrc('rotateMountProxies'), /readSavedProviderCreds\('mountproxies'\)/);
  assert.doesNotMatch(SECTION, /rotationUrl/, 'no MountProxies row carries a rotation link');
});

// ---- Account check ----

test('account: modem count, the next renewal or expiry, the billing cycles; no traffic figure', async () => {
  const seen = [];
  const r = await pa.checkProviderAccount('mountproxies', { token: KEY }, async (url) => { seen.push(url); return list(ROW, ROW2); }, { now: NOW });
  assert.equal(seen[0], `https://api.mountproxies.com/api/proxies?api_key=${KEY}&output=json`);
  const a = r.account;
  assert.deepEqual([a.status, a.plan, a.expiresAt, a.trafficLeftGb, a.note], ['active', 'weekly, monthly', '2026-12-20T00:00:00.000Z', null, 'firstToExpire']);
  const renew = pa.parsers.mountproxies(list(ROW), { now: NOW });
  assert.equal(renew.expiresAt, '2026-12-01T00:00:00.000Z', 'auto_renew_at when every expire_at is N/A');
  await assert.rejects(pa.checkProviderAccount('mountproxies', { token: KEY }, async (url) => { throw Object.assign(new Error(`HTTP 500 boom ${url}`), { status: 500 }); }), (e) => !e.message.includes(KEY));
  await assert.rejects(pa.checkProviderAccount('mountproxies', { token: KEY }, async () => { throw httpError(401); }), /rejected the saved API key/);
});

// ---- Wiring ----

test('MountProxies is wired: registry, PROVIDERS entry (HTTP only), en and es hint about Rotate IP', () => {
  assert.match(IPC, /mountproxies: 'MountProxies'/);
  assert.match(IPC, /mountproxies: fetchMountProxiesPool/);
  const line = UI.split(/\r?\n/).find((l) => l.includes("{ key: 'mountproxies',"));
  assert.ok(line, 'PROVIDERS entry');
  assert.match(line, /referral: 'https:\/\/mountproxies\.com\/'/);
  assert.match(line, /creds: \['token'\], labels: \{ token: 'apiKeyLabel' \}, noCountry: true, count: true, list: true \}/);
  assert.doesNotMatch(line, /proto: true/, 'the API gives no SOCKS5 port');
  for (const lang of ['en', 'es']) {
    const hint = locale(lang).proxyProviders.geoHints.mountproxies;
    assert.equal(typeof hint, 'string', lang);
    assert.match(hint, lang === 'en' ? /Rotate IP/ : /Rotar IP/);
    assert.doesNotMatch(hint, /[–—]/, 'no em or en dashes');
  }
});
