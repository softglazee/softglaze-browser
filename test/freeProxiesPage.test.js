'use strict';
// Free proxies get their own page and never mix with the paid pool: every paid view and count leaves
// out provider 'free' proxies, Quick generate uses them only when its "Free proxies" source is chosen
// (and then only working ones), and the profile editor lists them in their own group.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const scope = require('../src/main/proxyScope');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const loadFree = () => import('../src/renderer/lib/freeProxies.mjs');

// The body of a top-level `async function name(` in the main handlers.
function body(name) {
  const m = new RegExp(`async function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\r?\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
}

// Enough of Prisma's where semantics for these filters. `not` follows SQL: NULL <> 'free' is not true,
// which is why the paid filter needs its own NULL branch.
function matches(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return v.every((w) => matches(row, w));
    if (k === 'OR') return v.some((w) => matches(row, w));
    const val = row[k] === undefined ? null : row[k];
    if (v === null) return val === null;
    if (v && typeof v === 'object') {
      if ('not' in v) return val !== null && val !== v.not;
      if ('in' in v) return v.in.includes(val);
      throw new Error(`unsupported filter on ${k}`);
    }
    return val === v;
  });
}

const ROWS = [
  { id: 1, provider: null, lastStatus: 'ok', proxyGroupId: null },
  { id: 2, provider: 'iproyal', lastStatus: 'fail', proxyGroupId: 7 },
  { id: 3, provider: 'free', lastStatus: 'ok', proxyGroupId: 9 },
  { id: 4, provider: 'free', lastStatus: 'fail', proxyGroupId: 9 },
  { id: 5, provider: 'free', lastStatus: null, proxyGroupId: 9 },
  { id: 6, provider: 'dataimpulse', lastStatus: 'ok', proxyGroupId: 7 }
];
const ids = (where) => ROWS.filter((r) => matches(r, where)).map((r) => r.id);

// ---- main: the scope filters -------------------------------------------------------

test('the paid scope keeps hand-added and vendor proxies and leaves out every free one', () => {
  assert.deepEqual(ids(scope.proxyScopeWhere('paid')), [1, 2, 6]);
  assert.deepEqual(ids(scope.proxyScopeWhere(undefined)), [1, 2, 6], 'no scope means paid');
  assert.deepEqual(ids(scope.proxyScopeWhere('nonsense')), [1, 2, 6], 'an unknown scope means paid');
  assert.deepEqual(ids(scope.proxyScopeWhere('free')), [3, 4, 5]);
  assert.equal(scope.proxyScopeWhere('all'), undefined);
  assert.deepEqual(ids(scope.withProxyScope({ proxyGroupId: 7 }, 'paid')), [2, 6]);
  assert.deepEqual(ids(scope.withProxyScope(undefined, 'free')), [3, 4, 5]);
});

test('andWhere drops empty parts', () => {
  assert.equal(scope.andWhere(undefined, null, {}), undefined);
  assert.deepEqual(scope.andWhere({ a: 1 }, {}), { a: 1 });
  assert.deepEqual(scope.andWhere({ a: 1 }, { b: 2 }), { AND: [{ a: 1 }, { b: 2 }] });
});

test('Quick generate: the default source is the paid pool, free only when chosen and only working ones', () => {
  assert.deepEqual(ids(scope.batchProxySourceWhere({})), [1, 2, 6], 'default = paid, no free proxy');
  assert.deepEqual(ids(scope.batchProxySourceWhere({ source: 'paid' })), [1, 2, 6]);
  assert.deepEqual(ids(scope.batchProxySourceWhere({ source: 'free' })), [3], 'healthy free proxies only');
  assert.deepEqual(ids(scope.batchProxySourceWhere({ provider: 'FREE' })), [3], 'the older provider pick means the free source');
  assert.deepEqual(ids(scope.batchProxySourceWhere({ proxyGroupId: 9 })), [], 'the free group is not a paid source');
  assert.deepEqual(ids(scope.batchProxySourceWhere({ proxyGroupId: 7 })), [2, 6]);
  assert.deepEqual(ids(scope.batchProxySourceWhere({ provider: 'iproyal' })), [2]);
});

test('Batch import auto-bind: the paid pool by default, working free proxies when chosen', () => {
  assert.deepEqual(ids(scope.autoBindPoolWhere(undefined)), [1, 2, 6]);
  assert.deepEqual(ids(scope.autoBindPoolWhere('free')), [3]);
});

test('the paid group list hides the free group and counts only paid proxies', () => {
  const groups = [
    { id: 7, name: 'United States', autoCreated: true, proxyCount: 3 },
    { id: 9, name: 'Free proxies', autoCreated: true, proxyCount: 3 },
    { id: 10, name: 'Mixed', autoCreated: false, proxyCount: 4 },
    { id: 11, name: 'Only free', autoCreated: false, proxyCount: 2 },
    { id: 12, name: 'Empty', autoCreated: false, proxyCount: 0 },
    { id: 13, name: 'Free proxies', autoCreated: true, proxyCount: 0 }
  ];
  const view = scope.paidGroupView(groups, { 7: 0, 9: 3, 10: 1, 11: 2 });
  assert.deepEqual(view.map((g) => [g.id, g.proxyCount]), [[7, 3], [10, 3], [12, 0]]);
  assert.equal(scope.isFreeProxyGroup({ name: 'Free proxies', autoCreated: false }), false, 'a group a person named so stays');
  assert.equal(scope.isFreeProxy({ provider: 'Free' }), true);
  assert.equal(scope.isFreeProxy({ provider: null }), false);
});

// ---- main: every paid view and count goes through the paid scope ---------------------

test('the list handler takes a scope and defaults to paid', () => {
  const list = body('listProxies');
  assert.match(list, /const scopeWhere = proxyScope\.proxyScopeWhere\(payload\.scope\);/);
  assert.match(list, /if \(scopeWhere\) clauses\.push\(scopeWhere\);/);
  assert.match(list, /where: await scopedProxyWhere\(where\)/, 'member scoping is kept');
});

test('dashboard, rotation, checks, grouping, health cards and reassign use the paid pool only', () => {
  assert.match(body('getDashboardStats'), /const proxyWhere = await scopedProxyWhere\(proxyScope\.proxyScopeWhere\('paid'\)\);/);
  assert.match(body('getProxyRotation'), /where: await scopedProxyWhere\(proxyScope\.proxyScopeWhere\('paid'\)\),/);
  assert.match(body('setProxyRotation'), /if \(accessible\.some\(\(p\) => proxyScope\.isFreeProxy\(p\)\)\) throw new Error\('Free proxies cannot join a rotation pool\.'\);/);
  assert.match(body('pickRotationProxy'), /proxyScope\.withProxyScope\(\{ id: \{ in: cfg\.proxyIds \} \}, 'paid'\)/);
  assert.match(body('runProxyCheckStream'), /proxies = await db\.proxy\.findMany\(\{ where: await scopedProxyWhere\(proxyScope\.proxyScopeWhere\('paid'\)\), orderBy: \{ createdAt: 'asc' \} \}\);/, '"Check all" with no ids');
  assert.match(body('runProxyHealthSweepConcurrent'), /db\.proxy\.findMany\(\{ where: proxyScope\.proxyScopeWhere\('paid'\) \}\)/, 'Test all and the scheduled sweep');
  assert.match(body('autoGroupProxies'), /scopedProxyWhere\(proxyScope\.withProxyScope\(base, 'paid'\)\)/);
  assert.match(body('getRecentProxyHealth'), /scopedProxyWhere\(proxyScope\.proxyScopeWhere\('paid'\)\)/);
  assert.match(body('bulkAssignProxies'), /scopedProxyWhere\(proxyScope\.withProxyScope\(Object\.keys\(filter\)\.length \? filter : undefined, 'paid'\)\)/);
  assert.match(body('listProxyGroups'), /return proxyScope\.paidGroupView\(/);
  assert.match(body('commitProfileImport'), /db\.proxy\.findMany\(\{ where: proxyScope\.autoBindPoolWhere\(input\.autoBindSource\) \}\)/);
});

test('a spare proxy picked automatically is never a free one', () => {
  for (const name of ['swapProxyAfterBlock', 'applySpareProxy']) {
    assert.match(body(name), /\.filter\(\(p\) => !proxyScope\.isFreeProxy\(p\)\)/, name);
  }
});

test('Quick generate: the free source always gets the live check and has its own message', () => {
  const gen = body('batchGenerateProfiles');
  assert.match(gen, /freeSource = sourceWhere\.provider === proxyScope\.FREE_PROVIDER;/);
  assert.match(gen, /const verify = input\.verifyProxies !== false \|\| freeSource;/);
  assert.match(gen, /if \(proxyMode === 'unique'\) filter\.profiles = \{ none: \{ deletedAt: null \} \};/, 'unique = one per profile');
  assert.match(gen, /noProxyReason === 'no-match' && freeSource[\s\S]*there is no working free proxy/);
});

test('the free page\'s actions stay behind the proxy permission', () => {
  assert.match(body('harvestFreeProxiesHandler'), /^async function harvestFreeProxiesHandler\(payload, event\) \{\s*await requirePermission\('proxies\.manage'\);/);
  assert.match(body('deleteProxy'), /await requirePermission\('proxies\.manage'\);[\s\S]*await assertCanAccessProxy\(id\);/);
  assert.match(body('bulkDeleteProxies'), /await requirePermission\('proxies\.manage'\);[\s\S]*partitionAccessibleProxyIds\(ids\)/);
  assert.match(body('cancelFreeProxyHarvest'), /await requirePermission\('proxies\.manage'\);/);
});

// ---- renderer helpers ------------------------------------------------------------------

test('free proxy status, filters and the dead list', async () => {
  const fp = await loadFree();
  const list = [
    { id: 1, provider: 'free', type: 'HTTP', lastStatus: 'ok', lastCountry: 'US' },
    { id: 2, provider: 'free', type: 'SOCKS5', lastStatus: 'fail', lastCountry: 'DE' },
    { id: 3, provider: 'free', type: 'HTTP', lastStatus: null, lastCountry: null },
    { id: 4, provider: 'free', type: 'HTTP', lastStatus: 'ok', lastCountry: 'us' }
  ];
  assert.equal(fp.freeStatusOf(list[0]), 'working');
  assert.equal(fp.freeStatusOf(list[1]), 'dead');
  assert.equal(fp.freeStatusOf(list[2]), 'unchecked');
  assert.equal(fp.freeStatusOf(list[0], { 1: { success: false } }), 'dead', 'a fresh check wins');
  const f = (o, live) => fp.filterFreeProxies(list, o, live).map((p) => p.id);
  assert.deepEqual(f({ protocol: 'SOCKS5' }), [2]);
  assert.deepEqual(f({ country: 'US' }), [1, 4]);
  assert.deepEqual(f({ country: 'unknown' }), [3]);
  assert.deepEqual(f({ status: 'working' }), [1, 4]);
  assert.deepEqual(f({ status: 'working' }, { 4: { success: false } }), [1]);
  assert.deepEqual(f({}), [1, 2, 3, 4]);
  assert.deepEqual(fp.deadFreeIds(list), [2]);
  assert.deepEqual(fp.deadFreeIds(list, { 1: { success: false } }), [1, 2]);
  assert.deepEqual(fp.freeCountryCounts(list), [['US', 2], ['DE', 1]]);
});

test('Quick generate counts only working free proxies and maps its source choice', async () => {
  const fp = await loadFree();
  const list = [
    { id: 1, provider: 'free', lastStatus: 'ok' },
    { id: 2, provider: 'free', lastStatus: 'fail' },
    { id: 3, provider: 'free', lastStatus: null },
    { id: 4, provider: 'iproyal', lastStatus: 'ok' }
  ];
  assert.deepEqual(fp.healthyFreeProxies(list).map((p) => p.id), [1]);
  assert.deepEqual(fp.quickGenProxyFields(''), { proxySource: 'paid', proxyGroupId: undefined, provider: undefined });
  assert.deepEqual(fp.quickGenProxyFields('free'), { proxySource: 'free', proxyGroupId: undefined, provider: undefined });
  assert.deepEqual(fp.quickGenProxyFields('group:7'), { proxySource: 'paid', proxyGroupId: '7', provider: undefined });
  assert.deepEqual(fp.quickGenProxyFields('provider:iproyal'), { proxySource: 'paid', proxyGroupId: undefined, provider: 'iproyal' });
});

// ---- renderer wiring -----------------------------------------------------------------

test('the page has a route and a sidebar item under Proxy pool', () => {
  const app = read('src', 'renderer', 'App.jsx');
  assert.match(app, /const FreeProxiesPage = lazy\(\(\) => import\('@\/pages\/FreeProxiesPage\.jsx'\)\);/);
  assert.match(app, /<Route path="\/free-proxies" element=\{<FreeProxiesPage \/>\} \/>/);
  const shell = read('src', 'renderer', 'components', 'AppShell.jsx');
  assert.match(shell, /\{ path: '\/proxies', labelKey: 'nav\.proxies', icon: Globe, featureKey: 'proxies' \},\r?\n\s*\{ path: '\/free-proxies', labelKey: 'nav\.freeProxies', icon: Gift, featureKey: 'proxies' \},/);
  assert.match(read('src', 'renderer', 'components', 'CommandPalette.jsx'), /\{ path: '\/free-proxies', labelKey: 'palette\.nav\.freeProxies', icon: Gift \}/);
});

test('the page lists only free proxies, warns, searches, checks and deletes', () => {
  const page = read('src', 'renderer', 'pages', 'FreeProxiesPage.jsx');
  assert.match(page, /softglazeApi\.proxies\.list\(\{ scope: 'free' \}\)/);
  for (const k of ['free.warn.strangers', 'free.warn.quality', 'free.warn.legal']) assert.ok(page.includes(`t('${k}')`), k);
  assert.match(page, /<FreeProxySearch onAdded=\{load\} \/>/);
  assert.match(page, /softglazeApi\.proxies\.check\(\{ id: p\.id \}\)/, 'check now');
  assert.match(page, /softglazeApi\.proxies\.checkStream\(\{ ids, concurrency: 12 \}\)/, 'check selected / shown');
  assert.match(page, /removeIds\(deadIds, t\('freePage\.confirm\.deleteDead'/, 'delete the dead ones');
  assert.match(page, /softglazeApi\.proxies\.bulkDelete\(ids\)/);
  assert.match(page, /d\.runId !== runIdRef\.current\) return;/, 'only its own check run is followed');
  assert.match(page, /<EmptyState title=\{t\('freePage\.empty\.title'\)\}/);
  assert.doesNotMatch(page, /<table className="[^"]*min-w-/, 'no fixed table width that could scroll the page');
  assert.match(page, /<div className="overflow-x-auto">\s*<table className="w-full/, 'a narrow window scrolls the table, not the page');
  const search = read('src', 'renderer', 'components', 'FreeProxySearch.jsx');
  assert.match(search, /softglazeApi\.proxies\.freeHarvest\(/);
  assert.match(search, /softglazeApi\.proxies\.freeCancel\(\)/);
  assert.match(search, /softglazeApi\.proxies\.onFreeProgress\(/);
});

test('the pool page shows the paid pool only and links to the free page', () => {
  const pool = read('src', 'renderer', 'pages', 'ProxyPoolPage.jsx');
  assert.equal((pool.match(/softglazeApi\.proxies\.list\(\{ scope: 'paid' \}\)/g) || []).length, 2);
  assert.doesNotMatch(pool, /proxies\.list\(\{\}\)/);
  assert.doesNotMatch(pool, /freeOpen|FreeProxiesDialog/);
  assert.match(pool, /<Link to="\/free-proxies"/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'components', 'FreeProxiesDialog.jsx')), 'the old dialog is gone');
});

test('Quick generate: "Free proxies" is its own source, never the default', () => {
  const modal = read('src', 'renderer', 'components', 'QuickGenerateModal.jsx');
  assert.match(modal, /const \[proxyMode, setProxyMode\] = useState\('none'\);/);
  assert.match(modal, /\{ id: 'free', label: t\('quickGenerate\.proxyModeFree', \{ count: healthyFree\.length \}\), icon: Gift \}/);
  assert.match(modal, /proxySource: proxyMode === 'pool' \? proxySource : \(proxyMode === 'free' \? 'free' : ''\),/);
  assert.match(modal, /if \(proxyMode === 'free' && healthyFree\.length === 0\) return setErr/);
  assert.match(modal, /\{proxyMode === 'free' && \([\s\S]*?t\('quickGenerate\.freeWarn'\)/);
  for (const p of ['ProfilesPage', 'BatchImportPage']) {
    const src = read('src', 'renderer', 'pages', `${p}.jsx`);
    assert.match(src, /const \{ proxySource: source, proxyGroupId, provider \} = quickGenProxyFields\(proxySource\);/, p);
    assert.match(src, /proxySource: source, \/\/ 'paid' \| 'free'/, p);
    assert.match(src, /freeProxies=\{freeProxies\}/, p);
    assert.match(src, /softglazeApi\.proxies\.list\(\{ scope: 'free' \}\)/, p);
  }
});

test('the profile editor lists free proxies in their own group and warns when one is picked', () => {
  const src = read('src', 'renderer', 'pages', 'ProfilesPage.jsx');
  assert.match(src, /<optgroup label=\{t\('proxy\.optgroupPaid'\)\}>/);
  assert.match(src, /<optgroup label=\{t\('proxy\.optgroupFree'\)\}>\s*\{freeProxies\.map\(p => <option key=\{p\.id\} value=\{p\.id\}>/);
  assert.match(src, /freeProxies\.some\(p => String\(p\.id\) === String\(pd\.selectedSavedProxy\)\) && \([\s\S]*?t\('proxy\.freeWarning'\)/);
  assert.match(src, /<ProxyReassignModal[\s\S]*?allProxies=\{allProxies\}/, 'the bulk reassign picker gets the paid pool only');
});

test('Batch import auto-bind defaults to the paid pool and can use free proxies', () => {
  const src = read('src', 'renderer', 'pages', 'BatchImportPage.jsx');
  assert.match(src, /const \[autoBindSource, setAutoBindSource\] = useState\('paid'\);/);
  assert.match(src, /commitProfileImport\(previewData\.token, \{ autoBindByCountry: autoBind, autoBindSource \}\)/);
  assert.match(read('src', 'preload', 'preload.js'), /autoBindSource: options\.autoBindSource === 'free' \? 'free' : 'paid'/);
});

// ---- i18n ------------------------------------------------------------------------------

test('en and es have the same keys, including the new ones', () => {
  const keys = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${pre}${k}.`) : [`${pre}${k}`]));
  const loc = (lang, ns) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`));
  for (const ns of ['proxies', 'common', 'cmpModalsC', 'profiles', 'batchImport', 'cmpOverlays']) {
    assert.deepEqual(keys(loc('es', ns)).sort(), keys(loc('en', ns)).sort(), ns);
  }
  const en = keys(loc('en', 'proxies'));
  for (const k of ['freePage.title', 'freePage.table.usedByCount_one', 'freePage.actions.deleteDead', 'freePage.confirm.deleteDead_other', 'freePage.empty.title']) {
    assert.ok(en.includes(k), k);
  }
  assert.ok(keys(loc('en', 'common')).includes('nav.freeProxies'));
  assert.ok(keys(loc('en', 'cmpModalsC')).includes('quickGenerate.proxyModeFree'));
  assert.ok(keys(loc('en', 'profiles')).includes('proxy.freeWarning'));
});
