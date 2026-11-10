'use strict';
// 1.0.26 round 9, the last app items of the 1.0.27 backlog before the rebuild:
//  - "Smartproxy" labels outside the connector say "Decodo (Smartproxy)", as the connector does;
//  - 14. SoftGlaze AI tools: canRotate from main's rule, Firefox WebRTC fixes, rotate_proxy_ip and
//    "use only" shares within a token's groups, the legacy rotation-link pass;
//  - MarsProxies 404 and 409 replies, CatProxies ISP and Datacenter, the How many placeholder,
//    Airproxy's paid-until date, the AnyIP note, the Proxy pool at 375 px;
//  - 17 and 18 (Spanish) leftovers.
// ShopSocks5's removal is in removed-vendors.test.js, the affiliate links in connectorsShared.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { createFakePrisma } = require('./helpers/fakePrisma');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const UI = read('src', 'renderer', 'components', 'ProxyProviders.jsx');
const importLib = (name) => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', name)).href);
const loc = (lang, ns) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`));

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `could not find function ${name}`);
  let i = source.indexOf(') {', start) + 2;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}
function extractConst(source, name) {
  const start = source.indexOf(`\nconst ${name} = `);
  assert.notEqual(start, -1, `could not find const ${name}`);
  let depth = 0;
  let quote = null;
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return source.slice(start + 1, i + 1);
  }
  throw new Error(`unterminated const ${name}`);
}
function loadMain(names, deps, consts = []) {
  const src = [...consts.map((c) => extractConst(IPC, c)), ...names.map((n) => extractFunction(IPC, n))].join('\n');
  const k = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...k, `${src}\nreturn { ${names.join(', ')} };`)(...k.map((x) => deps[x]));
}

// ---- Decodo (Smartproxy) ----

test('Decodo: the pool, Quick generate and the editor no longer call it "Smartproxy"', () => {
  const pool = read('src', 'renderer', 'pages', 'ProxyPoolPage.jsx');
  const quick = read('src', 'renderer', 'components', 'QuickGenerateModal.jsx');
  const profiles = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
  for (const [name, src] of [['ProxyPoolPage', pool], ['QuickGenerateModal', quick], ['ProfilesPage', profiles]]) {
    // A comment may name the old brand next to the new one; a label may not stand alone.
    assert.doesNotMatch(src.replace(/Decodo \(Smartproxy\)/g, ''), /'Smartproxy'/, name);
  }
  // Both name a provider tag from the connector catalog, where smartproxy is "Decodo (Smartproxy)".
  for (const src of [pool, quick]) assert.match(src, /const PROVIDER_NAMES = \{ \.\.\.Object\.fromEntries\(PROVIDERS\.map\(\(p\) => \[p\.key, p\.name\]\)\), apify: 'Apify', custom: 'Custom' \};/);
  assert.match(UI, /key: 'smartproxy', name: 'Decodo \(Smartproxy\)'/);
  // The editor's unused proxyProvider default ('Smartproxy') is gone; main never read it.
  assert.doesNotMatch(profiles, /proxyProvider:|proxyApiKey:/);
});

test('Decodo: the Super Admin\'s IP providers keep the stored row, show Decodo (Smartproxy) and Decodo\'s dashboard', async () => {
  const db = { rows: [{ id: 3, name: 'Smartproxy', referralLink: 'https://dashboard.smartproxy.com/', apiKey: 'enc', secretKey: null, status: 'ENABLED' }, { id: 4, name: 'Oxylabs', referralLink: 'https://my.example/oxy', status: 'DISABLED' }] };
  const fake = {
    ipProvider: {
      findUnique: async ({ where }) => db.rows.find((r) => r.name === where.name) || null,
      create: async ({ data }) => { const row = { id: db.rows.length + 10, ...data }; db.rows.push(row); return row; },
      update: async ({ where, data }) => { const row = db.rows.find((r) => r.id === where.id); Object.assign(row, data); return row; }
    }
  };
  const fns = loadMain(['ensureIpProviders', 'ipProviderLabel', 'serializeIpProvider', 'maskSecret'], {
    secretStore: { open: (v) => `opened-${v}` }
  }, ['DEFAULT_IP_PROVIDERS']);
  await fns.ensureIpProviders(fake);
  const smart = db.rows.find((r) => r.name === 'Smartproxy');
  assert.equal(smart.referralLink, 'https://dashboard.decodo.com/', 'the old default link moved to Decodo');
  assert.equal(smart.status, 'ENABLED', 'the row and its keys stay');
  assert.equal(db.rows.filter((r) => /smartproxy|decodo/i.test(r.name)).length, 1, 'no second row');
  assert.equal(db.rows.find((r) => r.name === 'Oxylabs').referralLink, 'https://my.example/oxy', 'a link someone set is kept');
  const view = fns.serializeIpProvider(smart);
  assert.equal(view.name, 'Smartproxy');
  assert.equal(view.label, 'Decodo (Smartproxy)');
  assert.equal(fns.serializeIpProvider(db.rows.find((r) => r.name === 'Oxylabs')).label, 'Oxylabs');
  await fns.ensureIpProviders(fake);
  assert.equal(smart.referralLink, 'https://dashboard.decodo.com/', 'idempotent');
  const card = read('src', 'renderer', 'components', 'IpProvidersSettings.jsx');
  assert.match(card, /const shownName = provider\.label \|\| provider\.name;/);
  assert.doesNotMatch(card, /\{provider\.name\}|provider: provider\.name/);
});

// ---- 14. SoftGlaze AI tools ----

const tools = require('../src/main/ai/tools');
const rotation = () => loadMain(['isDataImpulseSticky', 'apiRotationProvider', 'proxyCanRotate'], {});

test('14: the AI views say canRotate by main\'s own rule, provider-API rotators included', () => {
  const { proxyCanRotate } = rotation();
  const rows = [
    { id: 1, provider: 'dataimpulse', host: 'gw.dataimpulse.com', port: 10001, username: 'plan__cr.us', password: 'p' },
    { id: 2, provider: 'proxyudp', host: '203.0.113.9', port: 31001, username: 'u', password: 'p' },
    { id: 3, provider: 'simplynode', host: 'proxy.simplynode.io', port: 9100, username: 'sub-1', password: 'p' },
    { id: 4, provider: 'mountproxies', host: '198.51.100.4', port: 8000, username: 'u', password: 'p' },
    { id: 5, provider: 'other', host: 'gw.example', port: 1, username: 'u', password: 'p', rotationUrl: 'https://rot.example/?key=SECRET' },
    { id: 6, provider: 'dataimpulse', host: 'gw.dataimpulse.com', port: 823, username: 'plan', password: 'p' },
    { id: 7, provider: 'novada', host: 'super.novada.pro', port: 7777, username: 'u', password: 'p' }
  ];
  const expected = [true, true, true, true, true, false, false];
  rows.forEach((r, i) => {
    const view = tools.compactProxy(r, proxyCanRotate);
    assert.equal(view.canRotate, expected[i], `row ${r.id}`);
    assert.equal(view.canRotate, proxyCanRotate(r), `row ${r.id} matches main`);
    assert.doesNotMatch(JSON.stringify(view), /SECRET|plan__|"p"/);
  });
  // A profile's proxy summary says it too, so a profile shared "use only" knows it may rotate by profile.
  const profile = tools.compactProfile({ id: 9, title: 'P', proxy: rows[1], systemProxyBehavior: 'PROFILE_PROXY' }, new Set(), proxyCanRotate);
  assert.equal(profile.proxy.canRotate, true);
  assert.equal(tools.compactProfile({ id: 9, title: 'P', proxy: rows[6] }, new Set(), proxyCanRotate).proxy.canRotate, false);
  assert.doesNotMatch(JSON.stringify(tools.detailedProfile({ id: 9, title: 'P', proxy: rows[4] }, new Set(), proxyCanRotate)), /SECRET|rotationUrl/);
  // Every view in tools.js is given main's rule, and main hands it over.
  const src = read('src', 'main', 'ai', 'tools.js');
  for (const fn of ['compactProxy', 'compactProfile', 'detailedProfile']) {
    // Each call, to the end of its line, outside the function's own definition.
    const calls = src.split(/\r?\n/).filter((line) => new RegExp(`[^\\w]${fn}\\(`).test(line) && !new RegExp(`function ${fn}\\(`).test(line));
    assert.ok(calls.length > 0, fn);
    for (const line of calls) assert.match(line, new RegExp(`${fn}\\([^\\n]*(canRotate|ctx\\.deps\\.proxyCanRotate)`), line.trim());
  }
  assert.doesNotMatch(src, /function isDataImpulseSticky/, 'no second copy of the rule');
  assert.match(extractFunction(IPC, 'buildAiToolDeps'), /\n\s{4}proxyCanRotate, /);
  assert.ok(require('../src/main/ai/toolRegistry').ALLOWED_DEPS.includes('proxyCanRotate'));
});

test('14: update_profile does not report webrtc-safe as applied on a Firefox profile', async () => {
  const tool = tools.TOOLS.find((t) => t.name === 'update_profile');
  const db = createFakePrisma({
    profile: [
      { id: 1, title: 'FF', browserCore: 'Firefox', webrtc: 'Real', deletedAt: null },
      { id: 2, title: 'CR', browserCore: 'Chromium', webrtc: 'Real', deletedAt: null }
    ]
  });
  const updates = [];
  const ctx = {
    db,
    assertProfiles: async () => {},
    userError: (m) => Object.assign(new Error(m), { code: 'USER' }),
    runningProfileIds: async () => new Set(),
    deps: {
      updateProfile: async (p) => { updates.push(p); const { id, ...rest } = p; return db.profile.update({ where: { id }, data: rest }); },
      listAllSessions: () => [],
      proxyCanRotate: () => false
    }
  };
  await assert.rejects(tool.handler({ id: 1, fixes: ['webrtc-safe'] }, ctx), /Firefox profiles always run with WebRTC off, so webrtc-safe does not apply/);
  assert.equal(updates.length, 0, 'nothing changed');
  const out = await tool.handler({ id: 1, fixes: ['tz-auto', 'webrtc-safe'] }, ctx);
  assert.equal(updates[0].webrtc, undefined, 'the saved WebRTC setting is left alone');
  assert.equal(updates[0].timezoneType, 'Based on IP');
  assert.match(out.summary, /webrtc-safe was not applied: Firefox profiles always run with WebRTC off\./);
  assert.deepEqual(out.data.notApplied, ['webrtc-safe']);
  assert.match(out.data.location.webrtc, /^Off \(Firefox profiles always run with WebRTC off; saved setting Real applies on Chromium\)$/);
  const cr = await tool.handler({ id: 2, fixes: ['webrtc-safe'] }, ctx);
  assert.equal(updates[1].webrtc, 'Forward', 'Chromium gets the fix');
  assert.equal(cr.data.notApplied, undefined);
  assert.doesNotMatch(cr.summary, /not applied/);
});

test('14: rotate_proxy_ip by profile stays inside a token\'s groups and follows the window\'s Visible features', async () => {
  const tool = tools.TOOLS.find((t) => t.name === 'rotate_proxy_ip');
  assert.equal(tool.feature({ profileId: 104 }), 'profiles', 'Rotate IP on a profile row is a Profiles action (profile:rotate-ip)');
  assert.equal(tool.feature({ proxyId: 20 }), 'proxies', 'on the Proxy pool a Proxies one (proxy:rotate-ip)');
  const db = createFakePrisma({
    profile: [
      { id: 104, title: 'Shared', groupId: 1, proxyId: 20, deletedAt: null },
      { id: 105, title: 'Owner other', groupId: 9, proxyId: 20, deletedAt: null },
      { id: 106, title: 'Mine', groupId: 1, proxyId: 21, deletedAt: null }
    ]
  });
  const calls = [];
  const ctx = (groupIds) => ({
    db,
    token: { groupIds },
    userError: (m) => Object.assign(new Error(m), { code: 'USER' }),
    denied: (m) => Object.assign(new Error(m), { code: 'DENIED' }),
    assertProxy: async () => { throw Object.assign(new Error('You do not have access to this proxy.'), { code: 'DENIED' }); },
    profileWhere: async (base) => ({ AND: [base, { id: { in: [104, 106] } }] }),
    deps: { rotateProfileProxyIp: async (p) => { calls.push(p); return { ok: true, status: 200, latencyMs: 9 }; } }
  });
  // A token limited to group 1 may not change the IP of a proxy that group 9's profile uses.
  await assert.rejects(tool.handler({ profileId: 104 }, ctx([1])), (e) => e.code === 'DENIED' && /also used by profiles outside the groups this token may use/.test(e.message));
  assert.equal(calls.length, 0);
  assert.equal((await tool.handler({ profileId: 106 }, ctx([1]))).data.ok, true, 'a proxy only its groups use');
  assert.equal((await tool.handler({ profileId: 104 }, ctx([]))).data.ok, true, 'an unlimited token');
  // By proxy id, a shared profile's proxy is refused as before, and the error says how to rotate it.
  await assert.rejects(tool.handler({ proxyId: 20 }, ctx([])), (e) => e.code === 'DENIED' && /You do not have access to this proxy\. It is the proxy of profile #104: call rotate_proxy_ip with profileId 104\./.test(e.message));
  await assert.rejects(tool.handler({ proxyId: 99 }, ctx([])), (e) => e.message === 'You do not have access to this proxy.', 'no hint when no visible profile uses it');
});

test('14: the registry asks Visible features for the page the arguments name', async () => {
  const reg = require('../src/main/ai/toolRegistry');
  const { ApprovalManager } = require('../src/main/ai/approvals');
  const aiSettings = require('../src/main/ai/aiSettings');
  const memories = require('../src/main/ai/memories');
  const featureGate = require('../src/main/featureGate');
  const { createFakeApp } = require('./helpers/aiFakes');
  const app = createFakeApp();
  const store = new Map();
  const services = {
    settings: () => aiSettings.normalizeStored({ enabled: true }),
    isEnabled: () => true,
    approvals: new ApprovalManager({ timeoutMs: 2000, emit: () => {} }),
    audit: { record: async () => {} },
    memory: memories.createMemoryStore({ read: async (k, f) => (store.has(k) ? store.get(k) : f), write: async (k, v) => store.set(k, v) }),
    tracker: new reg.AiTracker(),
    jobs: new reg.JobStore({ inlineMs: 200 }),
    limiter: new reg.RateLimiter()
  };
  const asked = [];
  const deps = { ...app.toolDeps, assertFeature: async (f) => { asked.push(f); if (f === 'proxies') throw featureGate.featureOffError(f); } };
  const registry = new reg.ToolRegistry({ deps, services, inlineWaitMs: 300 });
  const token = { id: 1, name: 'T', kind: 'ai', scope: 'operate', groupIds: [], preApproved: null, memberId: 1 };
  const byProxy = await registry.call('rotate_proxy_ip', { proxyId: 1 }, { token, clientName: 'Test', transport: 'mcp' });
  assert.equal(byProxy.code, 'FORBIDDEN', 'Proxies hidden: no rotation from the pool');
  const byProfile = await registry.call('rotate_proxy_ip', { profileId: 1 }, { token, clientName: 'Test', transport: 'mcp' });
  assert.notEqual(byProfile.code, 'FORBIDDEN', 'Profiles visible: the profile row\'s Rotate IP is allowed (it goes on to approval)');
  assert.deepEqual(asked, ['proxies', 'profiles']);
});

test('14: the legacy rotation-link pass stops when a restore swaps the database under it', async () => {
  let db = createFakePrisma({
    proxy: [{ id: 70, name: 'Shop 7 Proxy', ownerMemberId: 1, rotationUrl: null, createdAt: new Date('2026-10-01T10:00:00Z') }],
    profile: [{ id: 7, title: 'Shop 7', ownerMemberId: 1, proxyId: 70, createdAt: new Date('2026-10-01T10:00:05Z') }]
  });
  const store = new Map([['profileRotationUrls', { 7: 'https://rotate.example/api?key=K7', 8: 'https://rotate.example/api?key=K8' }]]);
  const restored = createFakePrisma({});
  const fns = loadMain(['importedRotationUrl', 'attachImportedRotationUrl', 'proxyMadeForImportedRow', 'adoptImportedRotationLinks'], {
    getPrisma: () => db,
    readSetting: async (k, d) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : d),
    writeSetting: async (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))); },
    logAudit: async () => {},
    rotationLinksAdoptedThisRun: false
  }, ['ROTATION_LINKS_ADOPTED_SETTING']);
  // The restore swaps the database while the pass looks at its first link.
  const findUnique = db.profile.findUnique.bind(db.profile);
  db.profile.findUnique = async (q) => { const r = await findUnique(q); db = restored; return r; };
  const res = await fns.adoptImportedRotationLinks();
  assert.equal(res.interrupted, true);
  assert.equal(store.has('profileRotationUrlsAdopted'), false, 'the old database\'s record is not written into the restored one');
  // The flag stays off, so the restore's own pass runs on the restored database.
  const again = await fns.adoptImportedRotationLinks();
  assert.equal(again.interrupted, undefined);
  assert.deepEqual(Object.keys(store.get('profileRotationUrlsAdopted').done).sort(), ['7', '8']);
  assert.match(extractFunction(IPC, 'workspaceRestore'), /rotationLinksAdoptedThisRun = false;\s*await afterDbReady\(\);/);
});

// ---- MarsProxies 404 and 409 ----

test('MarsProxies: 404 and 409 from generate-proxy-list are clear, coded and translated', async () => {
  const fail = (status, body) => async () => { throw Object.assign(new Error(`HTTP ${status} ${body}`), { status }); };
  const load = (httpRequestText) => loadMain(['marsCall'], { httpRequestText, MARS_API: 'https://api.marsproxies.example' });
  const list = (fn) => load(fn).marsCall('tok-123', 'POST', '/v1/residential/access/generate-proxy-list', 'proxy list', { a: 1 }, true);
  await assert.rejects(list(fail(404, '{"message":"subuser credentials not found"}')), (e) => e.code === 'MARSPROXIES_SUBUSER_NOT_FOUND'
    && /no sub-user with that username and password/.test(e.message) && /before the first underscore/.test(e.message));
  await assert.rejects(list(fail(409, '{"message":"location segment, username or password does not match"}')), (e) => e.code === 'MARSPROXIES_MISMATCH'
    && /location, or the sub-user username and password, do not match/.test(e.message));
  // Elsewhere a 404 keeps the vendor's own text; the token never shows.
  await assert.rejects(load(fail(404, '{"message":"not here tok-123"}')).marsCall('tok-123', 'GET', '/v1/residential/me', 'account check'), (e) => !e.code && /MarsProxies account check: not here \*\*\*/.test(e.message));
  // A status only in the message text (no e.status) is read too.
  await assert.rejects(list(async () => { throw new Error('HTTP 409 {}'); }), (e) => e.code === 'MARSPROXIES_MISMATCH');
  // The form shows the code in the window's language.
  assert.match(UI, /const PULL_ERROR_KEYS = \{ MARSPROXIES_SUBUSER_NOT_FOUND: 'marsSubuserNotFound', MARSPROXIES_MISMATCH: 'marsMismatch' \};/);
  const geo = extractFunction(UI, 'handleGeoSync');
  assert.match(geo, /const coded = e && PULL_ERROR_KEYS\[e\.code\];\s*setErr\(coded \? t\(`proxyProviders\.errors\.\$\{coded\}`\) : \(e\.message \|\| t\('proxyProviders\.errors\.pull'\)\)\);/);
  for (const key of ['marsSubuserNotFound', 'marsMismatch']) {
    const en = loc('en', 'cmpSettingsC').proxyProviders.errors[key];
    const es = loc('es', 'cmpSettingsC').proxyProviders.errors[key];
    assert.equal(typeof en, 'string', key);
    assert.equal(typeof es, 'string', key);
    assert.notEqual(en, es, key);
    assert.doesNotMatch(en + es, /[–—]/);
  }
  assert.match(IPC, new RegExp(loc('en', 'cmpSettingsC').proxyProviders.errors.marsMismatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the English text is main\'s');
});

// ---- CatProxies ISP and Datacenter, and the How many placeholder ----

const providerLine = (key) => {
  const line = UI.split(/\r?\n/).find((l) => l.startsWith(`  { key: '${key}', `));
  assert.ok(line, key);
  return line;
};

test('CatProxies: ISP and Datacenter hide Sticky session and Keep same IP (and ISP its Country), and send none of them', async () => {
  const { stickyForPool, countryForPool, geoForPool } = await importLib('gatewayPull.mjs');
  const line = providerLine('catproxies');
  const minting = ['residential', 'residential_premium', 'mobile'];
  for (const k of ['geoPools', 'stickyPools']) assert.match(line, new RegExp(`${k}: \\['residential', 'residential_premium', 'mobile'\\]`), k);
  assert.match(line, /listPools: \['isp', 'datacenter'\], noCountryPools: \['isp'\]/);
  const g = { geo: true, geoPools: minting, stickyPools: minting, listPools: ['isp', 'datacenter'], noCountryPools: ['isp'] };
  for (const pool of minting) assert.deepEqual([stickyForPool(g, pool), geoForPool(g, pool), countryForPool(g, pool)], [true, true, true], pool);
  assert.deepEqual([stickyForPool(g, 'isp'), geoForPool(g, 'isp'), countryForPool(g, 'isp')], [false, false, false]);
  assert.deepEqual([stickyForPool(g, 'datacenter'), geoForPool(g, 'datacenter'), countryForPool(g, 'datacenter')], [false, false, true], 'Datacenter filters by country');
  // A connector without the lists keeps every field, as before.
  assert.deepEqual([stickyForPool({}, 'x'), countryForPool({}, 'x'), countryForPool({ noCountry: true }, 'x')], [true, true, false]);
  // The form hides them and the pull sends none of them (main refuses them on these pools).
  assert.match(UI, /const showSession = Boolean\(provider\.geoSync && !provider\.geoSync\.noSession && \(provider\.geoSync\.session \|\| provider\.geoSync\.geo\)\) && stickyOn;/);
  assert.match(UI, /\{provider\.geoSync\.life && stickyOn && \(/);
  const geo = extractFunction(UI, 'handleGeoSync');
  assert.match(geo, /const sessionText = stickyOn \? form\.session\.trim\(\) : '';/);
  assert.match(geo, /country: countryOn \? form\.country : '',/);
  assert.match(geo, /life: stickyOn \? form\.life : '',/);
  assert.match(geo, /state: placeOn \? form\.state\.trim\(\) : '',/);
  assert.match(extractFunction(IPC, 'fetchCatProxiesFixedIps'), /Clear Country, State, City and Sticky session/, 'what main refuses on those pools');
  for (const lang of ['en', 'es']) assert.doesNotMatch(loc(lang, 'cmpSettingsC').proxyProviders.geoHints.catproxies, /leave State, City and Sticky session blank|deja en blanco Estado, Ciudad y Sesión fija/, lang);
});

test('How many: the placeholder and title say what a blank How many adds, as main does', async () => {
  const { countBlankFor } = await importLib('gatewayPull.mjs');
  assert.equal(countBlankFor({ list: true }), 'all');
  assert.equal(countBlankFor({ listPools: ['isp'] }, { poolType: 'isp' }), 'all');
  assert.equal(countBlankFor({ listPools: ['isp'] }, { poolType: 'residential' }), 1);
  assert.equal(countBlankFor({ listByUsername: true }, { username: ' per-proxy-1 ' }), 'all', 'Proxidize Per-Proxy lists the modems');
  assert.equal(countBlankFor({ listByUsername: true }, { username: '' }), 1, 'Proxidize Per GB mints one');
  assert.equal(countBlankFor({ countBlank: 5 }), 5);
  assert.equal(countBlankFor({}), 1);
  assert.match(UI, /placeholder=\{countBlank === 'all' \? t\('proxyProviders\.geo\.howManyAll', 'All'\) : String\(countBlank\)\} title=\{countBlank === 'all' \? t\('proxyProviders\.geo\.howManyListTitle'\) : t\('proxyProviders\.geo\.howManyCapTitle', \{ n: countBlank \}\)\}/);
  assert.doesNotMatch(UI, /: '5'\} title=\{provider\.geoSync\.list/);
  for (const lang of ['en', 'es']) assert.match(loc(lang, 'cmpSettingsC').proxyProviders.geo.howManyCapTitle, /\{\{n\}\}/, lang);
  // Each shared-form connector's blank default matches its adapter in main: 5 where the adapter
  // defaults a blank count to 5 (clampPoolCount(count, 5, ...)), else 1.
  const adapters = Object.fromEntries([...extractConst(IPC, 'REAL_VENDOR_ADAPTERS').matchAll(/^\s+(\w+): (fetch\w+),?$/gm)].map((m) => [m[1], m[2]]));
  const keys = [...UI.matchAll(/^ {2}\{ key: '(\w+)', [^\n]*geoSync: \{[^\n]*count: true/gm)].map((m) => m[1]);
  assert.ok(keys.length > 30, keys.join(','));
  for (const key of keys) {
    const line = providerLine(key);
    if (/di: true|ps: true|ipr: true|list: true/.test(line)) continue; // own panels, or a list
    assert.ok(adapters[key], `${key} has an adapter`);
    const five = /clampPoolCount\(count, 5\b/.test(extractFunction(IPC, adapters[key]));
    assert.equal(/countBlank: 5\b/.test(line), five, `${key}: placeholder ${five ? 5 : 1}`);
  }
  // List pools: Node4's Static Datacenter and CatProxies' fixed-IP plans import everything when blank.
  assert.match(providerLine('node4'), /listPools: \['static'\]/);
  assert.match(extractFunction(IPC, 'fetchNode4Pool'), /return limitListRows\(picked, count, Infinity\);/);
  assert.match(providerLine('proxidize'), /listByUsername: true/);
});

// ---- Airproxy paid-until date, AnyIP wording ----

test('Airproxy: each proxy shows the date it is paid until, as the other list connectors do', () => {
  const U = require('../src/main/proxyVendorUtils');
  const body = { proxies: [
    { id: 301, ip: 's1.airproxy.io', port: 30501, username: 'acct', password: 'DUMMYpass', isp: 'Wind', in_use_till: '2026-12-03T13:38:50Z' },
    { id: 302, ip: 's2.airproxy.io', port: 30502, username: 'acct', password: 'DUMMYpass', isp: 'TIM' },
    { id: 303, ip: 's3.airproxy.io', port: 30503, username: 'acct', password: 'DUMMYpass', in_use_till: 'soon' }
  ] };
  const rows = U.airproxyRows(body);
  assert.equal(rows[0].label, 'Airproxy • Mobile • IT • Wind • #301 • until 2026-12-03');
  assert.equal(rows[1].label, 'Airproxy • Mobile • IT • TIM • #302', 'no date, no "until"');
  assert.equal(rows[2].label, 'Airproxy • Mobile • IT • #303', 'an unreadable date is left out');
  // The same " • until YYYY-MM-DD" ProxyBrazil, ProxyUDP and Zokol labels end with.
  assert.match(read('src', 'main', 'proxyVendorUtils.js'), /until \? `until \$\{until\}` : ''/);
});

test('AnyIP: the note follows Dashboard V2 (a proxy profile\'s proxy details), not "Get Proxy Details"', () => {
  for (const lang of ['en', 'es']) {
    const note = loc(lang, 'cmpSettingsC').proxyProviders.geo.anyipApiNote;
    assert.doesNotMatch(note, /Get Proxy Details/, lang);
    assert.match(note, lang === 'en' ? /open a proxy profile and scroll to its proxy details/ : /abre un perfil de proxy y baja hasta sus datos de proxy/, lang);
  }
  assert.doesNotMatch(UI, /Get Proxy Details/, 'the fallback text too');
  assert.equal(UI.includes(loc('en', 'cmpSettingsC').proxyProviders.geo.anyipApiNote), true, 'the fallback is the English text');
});

// ---- 17 and 18: Spanish leftovers ----

test('17: a footer stored by an older build (its default then) reads in the window\'s language too', () => {
  const lib = read('src', 'renderer', 'lib', 'footerText.jsx');
  const src = ['DEFAULT_FOOTER_TEXT', 'LEGACY_DEFAULT_FOOTER_TEXTS'].map((name) => {
    const m = new RegExp(`export const ${name} = [\\s\\S]*?;\\r?\\n`).exec(lib);
    assert.ok(m, name);
    return m[0].replace(/^export /, '');
  }).join('\n') + /export (function footerTextFor[\s\S]*?\n\})/.exec(lib)[1];
  // eslint-disable-next-line no-new-func
  const { footerTextFor, LEGACY_DEFAULT_FOOTER_TEXTS, DEFAULT_FOOTER_TEXT } = new Function(`${src}\nreturn { footerTextFor, LEGACY_DEFAULT_FOOTER_TEXTS, DEFAULT_FOOTER_TEXT };`)();
  const es = loc('es', 'common').shell.footerDefault;
  const t = (key, opts) => (key === 'shell.footerDefault' ? es : opts.defaultValue);
  // The defaults main seeded before 1.0.7, with an em dash (June to September 2026).
  const old = [
    '© {year} SoftGlaze — Built by the SoftGlaze Team (https://softglaze.com) · Developed by Azhar Ali (https://azhar.softglaze.com)',
    '© {year} SoftGlaze — Built by the [SoftGlaze Team](https://softglaze.com) · Developed by [Azhar Ali](https://azhar.softglaze.com)'
  ];
  assert.deepEqual([...LEGACY_DEFAULT_FOOTER_TEXTS], old);
  for (const text of [DEFAULT_FOOTER_TEXT, ...old]) assert.equal(footerTextFor(text, t), es, text);
  assert.equal(footerTextFor('© {year} Acme Ltd', t), '© {year} Acme Ltd', 'a footer someone wrote is shown as written');
  assert.equal(footerTextFor(old[0], (k, o) => o.defaultValue), DEFAULT_FOOTER_TEXT, 'without a translation: today\'s default');
});

test('18: the Batch import page and the app\'s proxy pool use the Store listing\'s Spanish terms', () => {
  assert.equal(loc('es', 'batchImport').header.title, 'Creación masiva de perfiles', 'like the sidebar\'s "Importación masiva"');
  assert.equal(loc('es', 'common').nav.sectionAdmin, 'Administración');
  const c = JSON.stringify(loc('es', 'cmpSettingsC'));
  for (const s of ['varios productos en el pool', 'cuando el pool ya tiene', 'los puertos que el pool aún no tiene', 'las IP que el pool aún no tiene']) {
    assert.equal(c.includes(s), false, s);
  }
  assert.match(c, /el grupo de proxies ya tiene 5/);
  assert.match(c, /pools en connect\.gonzoproxy\.app/, 'a vendor\'s own pools stay "pools"');
  for (const ns of ['batchImport', 'common', 'cmpSettingsC']) assert.doesNotMatch(JSON.stringify(loc('es', ns)), /perfiles por lotes|Importación por lotes/, ns);
});
