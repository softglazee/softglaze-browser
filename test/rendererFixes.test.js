'use strict';
// Renderer fixes from the 7 Oct audit (U1-U15). The pure helpers in uiGuards.mjs are
// exercised at runtime; the page wiring is asserted on the source, because there is no
// renderer test harness in this repo (same approach as selectionScope.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const R = path.join(__dirname, '..', 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8');
const PAGE = (n) => read('pages', `${n}.jsx`);
const COMP = (n) => read('components', `${n}.jsx`);
const loadGuards = () => import(pathToFileURL(path.join(R, 'lib', 'uiGuards.mjs')).href);

// Body of a named function (up to the next top-level-ish "  async function"/"  function").
function fnBody(src, name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `${name} must exist`);
  const rest = src.slice(i + 1);
  const j = rest.search(/\n  (async )?function \w+\(/);
  return src.slice(i, j < 0 ? undefined : i + 1 + j);
}

// ---- runtime: helpers ----------------------------------------------------------------

test('clampNumber keeps typing possible and clamps only on commit', async () => {
  const { clampNumber } = await loadGuards();
  assert.equal(clampNumber('', { min: 3, max: 600, fallback: 30 }), 30, 'empty falls back');
  assert.equal(clampNumber('abc', { min: 1, fallback: 1 }), 1, 'garbage falls back');
  assert.equal(clampNumber('1', { min: 3, max: 600, fallback: 30 }), 3, 'below min clamps');
  assert.equal(clampNumber('9999', { min: 3, max: 600, fallback: 30 }), 600, 'above max clamps');
  assert.equal(clampNumber(' 45 ', { min: 3, max: 600, fallback: 30 }), 45);
  assert.equal(clampNumber('2.6', { min: 0, fallback: 0 }), 3, 'rounds');
  assert.equal(clampNumber('0', { min: 0, fallback: 7 }), 0, 'a real 0 is not treated as empty');
});

test('intersectSelection drops ids hidden by a filter or search', async () => {
  const { intersectSelection } = await loadGuards();
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(intersectSelection(new Set([3, 1, 99]), rows), [1, 3], 'row order, hidden 99 removed');
  assert.deepEqual(intersectSelection(new Set(), rows), []);
  assert.deepEqual(intersectSelection(new Set([1]), []), [], 'nothing visible -> nothing acted on');
});

test('createSeqGuard only honours the newest ticket', async () => {
  const { createSeqGuard } = await loadGuards();
  const g = createSeqGuard();
  const a = g.next(); const b = g.next();
  assert.equal(g.isLatest(a), false);
  assert.equal(g.isLatest(b), true);
});

// ---- U1 / U2: selection scope --------------------------------------------------------

test('U1 ProfilesPage prunes the selection after a server-side search lands', () => {
  const src = PAGE('ProfilesPage');
  assert.match(src, /setLoadedSearch\(search\);/, 'loadData records which search the rows belong to');
  const prune = /useEffect\(\(\) => \{\s*setSelectedIds[\s\S]*?\}, \[([^\]]*)\]\);/.exec(src);
  assert.match(prune[1], /\bloadedSearch\b/, 'the prune re-runs when search results arrive');
  assert.doesNotMatch(prune[1], /\bprofiles\b/, 'a plain refresh still keeps the selection');
});

test('U1 every ProfilesPage bulk handler acts on the visible selection only', () => {
  const src = PAGE('ProfilesPage');
  assert.match(src, /function visibleSelectedIds\(\) \{\s*return intersectSelection\(selectedIds, filteredProfiles\);/);
  for (const fn of ['handleBulkLaunch', 'handleBulkClose', 'handleBulkDelete', 'handleTagAssign', 'handleBulkRename', 'handleReassignProxy', 'handleSynchronize']) {
    const body = fnBody(src, fn);
    assert.match(body, /visibleSelectedIds\(\)/, `${fn} must intersect with the visible rows`);
    assert.doesNotMatch(body, /\[\.\.\.selectedIds\]/, `${fn} must not send the raw selection`);
  }
  assert.match(src, /<ShareProfileModal profileIds=\{visibleSelectedIds\(\)\}/);
});

test('U1 handleBulkDelete reports its {trashed, errors} result', () => {
  const body = fnBody(PAGE('ProfilesPage'), 'handleBulkDelete');
  assert.match(body, /const res = await softglazeApi\.profiles\.bulkDelete\(ids\);/);
  assert.match(body, /res\.errors/);
  assert.match(body, /t\('bulkDeleteResult\.partial'/);
});

test('U2 PersonasPage prunes on search/usage filter and intersects at action time', () => {
  const src = PAGE('PersonasPage');
  assert.match(src, /visiblePersonaIdsRef\.current = filtered;/);
  const prune = /useEffect\(\(\) => \{\s*setSelectedIds[\s\S]*?\}, \[([^\]]*)\]\);/.exec(src);
  assert.ok(prune, 'PersonasPage must have a prune effect');
  assert.match(prune[1], /search/); assert.match(prune[1], /usageFilter/);
  for (const fn of ['handleDeleteSelected', 'handleResetSelected']) {
    const body = fnBody(src, fn);
    assert.match(body, /const ids = visibleSelectedIds\(\);/, `${fn} must intersect`);
    assert.doesNotMatch(body, /Array\.from\(selectedIds\)/);
  }
});

// ---- U3 / U4: confirmations ----------------------------------------------------------

test('U3 MembersPage confirms Reset trial and Block like Terminate', () => {
  const src = PAGE('MembersPage');
  assert.match(fnBody(src, 'resetTrial'), /window\.confirm\(t\('license\.confirm\.resetTrial'/);
  assert.match(fnBody(src, 'block'), /window\.confirm\(t\('license\.confirm\.block'/);
  assert.match(src, /onClick=\{\(\) => resetTrial\(r\)\}/);
  assert.match(src, /onClick=\{\(\) => block\(r\)\}/);
  assert.doesNotMatch(src, /onClick=\{\(\) => act\(r\.ownerId, \(\) => softglazeApi\.license\.reset/);
});

test('U4 macro delete and API-key revoke ask first', () => {
  assert.match(fnBody(PAGE('AutomationPage'), 'remove'), /window\.confirm\(t\('macros\.deleteConfirm'/);
  assert.match(fnBody(COMP('DeveloperApiSettings'), 'revoke'), /window\.confirm\(t\('developerApi\.keys\.revokeConfirm'/);
});

// ---- U5: settings apply() ------------------------------------------------------------

test('U5 GlobalPreferences.apply guards stale responses, reverts on failure, tracks in-flight', () => {
  const src = PAGE('SettingsPage');
  const i = src.indexOf('const apply = useCallback((patch) => {');
  assert.ok(i > 0);
  const body = src.slice(i, src.indexOf('}, []);', i));
  assert.match(body, /const seq = \+\+applySeq\.current;/);
  assert.match(body, /if \(seq === applySeq\.current\) setS\(v\);/, 'only the newest response replaces state');
  assert.match(body, /failedSinceIdle\.current = true;/);
  assert.match(body, /if \(confirmed\.current\.value\) setS\(confirmed\.current\.value\);/, 'failure reverts to confirmed settings');
  assert.match(body, /if \(inFlight\.current !== 0\) return;\s*setSaving\(false\);/, 'saving clears only when idle');
});

test('U5 the captcha API key is not persisted per keystroke', () => {
  const src = PAGE('SettingsPage');
  assert.doesNotMatch(src, /onChange=\{\(e\) => apply\(\{ captcha: \{ apiKey/);
  assert.match(src, /<DraftTextInput\s+id="set-captcha-apikey"/);
  assert.match(src, /onCommit=\{\(v\) => apply\(\{ captcha: \{ apiKey: v \} \}\)\}/);
  assert.match(src, /onBlur=\{\(\) => \{ focused\.current = false; commit\(draft\); \}\}/);
  assert.doesNotMatch(src, /onChange=\{\(e\) => apply\(\{ \w+: \{ \w+: (Math\.max\()?Number\(e\.target\.value\)/,
    'no number field persists (and clamps) on every keystroke');
});

// ---- U6: window.prompt ---------------------------------------------------------------

test('U6 no window.prompt() calls remain in the renderer', () => {
  for (const f of ['ProfilesPage', 'AutomationPage']) {
    assert.doesNotMatch(PAGE(f).replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, ''), /window\.prompt\(/, f);
    assert.match(PAGE(f), /<NameDialog/, `${f} uses the in-app name dialog`);
  }
  const dlg = COMP('NameDialog');
  assert.match(dlg, /useDialog\(\{ onClose \}\)/);
  assert.match(dlg, /role="dialog" aria-modal="true"/);
});

// ---- U7 / U8 / U12: Proxy Pool -------------------------------------------------------

test('U7 group counts refresh after check runs, deletes, batch add and provider pulls', () => {
  const src = PAGE('ProxyPoolPage');
  for (const fn of ['handleDeleteFiltered', 'handleBulkDelete', 'handleBatchAdd', 'handleDelete']) {
    assert.match(fnBody(src, fn), /Promise\.all\(\[loadProxies\(\), loadGroups\(\)\]\)/, fn);
  }
  assert.match(src, /if \(data\.finished\) \{[^}]*loadGroups\(\);/, 'check-run finish');
  // Provider pulls moved to the Proxy providers page: the pool links there, and that page
  // reloads its pool counts after every pull (the pool page reloads on mount).
  assert.match(src, /<Link to="\/proxy-providers"/, 'pool links to the providers page');
  const providers = PAGE('ProxyProvidersPage');
  assert.match(providers, /<ProxyProviders embedded selectedKey=\{p\.key\} onSynced=\{onSynced\} \/>/, 'provider pull');
  assert.match(fnBody(providers, 'handleSynced'), /await load\(\);/, 'provider pull refreshes counts');
});

test('U8 Delete-filtered button and confirm share one scope label', () => {
  const src = PAGE('ProxyPoolPage');
  const scope = fnBody(src, 'deleteFilteredScopeLabel');
  assert.match(scope, /blacklistFilter !== 'all'/);
  assert.match(scope, /speedFilter !== 'all'/);
  assert.match(fnBody(src, 'handleDeleteFiltered'), /const scopeLabel = deleteFilteredScopeLabel\(\);/);
  assert.match(src, /t\('deleteFiltered\.button', \{ scope: deleteFilteredScopeLabel\(\)/);
});

test('U12 dead drag/geo/history state and row drag affordance are gone', () => {
  const src = PAGE('ProxyPoolPage');
  for (const dead of ['showGeo', 'showHistoryCards', 'dragOverKey', 'onGroupDrop', 'onRowDragStart', 'cursor-grab']) {
    assert.doesNotMatch(src, new RegExp(dead), dead);
  }
  assert.doesNotMatch(src, /<tr key=\{proxy\.id\} draggable/);
});

// ---- U9: number inputs ---------------------------------------------------------------

test('U9 listed number inputs keep raw text and commit on blur', () => {
  const ni = read('components', 'ui', 'NumberInput.jsx');
  assert.match(ni, /onChange=\{\(e\) => setRaw\(e\.target\.value\)\}/, 'typing only updates the draft');
  assert.match(ni, /onBlur=\{commit\}/);
  const pool = PAGE('ProxyPoolPage');
  assert.match(pool, /<NumberInput min=\{0\} fallback=\{0\} value=\{policyDetail\.failoverMaxLatencyMs\}/);
  assert.match(pool, /<NumberInput min=\{1\} fallback=\{1\} value=\{policyDetail\.latencyTopN\}/);
  assert.match(pool, /<NumberInput min=\{1\} fallback=\{30\} value=\{scheduler\.minutes\}/);
  const auto = PAGE('AutomationPage');
  assert.match(auto, /<NumberInput min=\{3\} max=\{600\} fallback=\{30\} value=\{addSeconds\} onCommit=\{setAddSeconds\}/);
  assert.match(auto, /<NumberInput min=\{2\} max=\{16\} fallback=\{2\} value=\{parallelCount\} onCommit=\{setParallelCount\}/);
});

// ---- U10: password fields ------------------------------------------------------------

test('U10 proxy and persona passwords are masked with a show/hide toggle', () => {
  const prof = PAGE('ProfilesPage');
  assert.match(prof, /type=\{showProxyPass \? 'text' : 'password'\}[^>]*value=\{pd\.proxyPass\}/);
  assert.match(prof, /aria-label=\{showProxyPass \? t\('proxy\.hidePassword'\) : t\('proxy\.showPassword'\)\}/);
  const per = PAGE('PersonasPage');
  assert.match(per, /type=\{showFormPassword \? 'text' : 'password'\}/);
  assert.match(per, /aria-label=\{showFormPassword \? t\('form\.hidePassword'\) : t\('form\.showPassword'\)\}/);
});

// ---- U11: provider switch ------------------------------------------------------------

test('U11 provider pulls are tagged and a switch resets syncing', () => {
  const src = COMP('ProxyProviders');
  assert.match(src, /activeKeyRef\.current = provider\.key;/);
  assert.match(src, /setSyncResult\(null\);\s*setSyncing\(false\);\s*setErr\(''\);\s*\}, \[provider\]\);/);
  for (const fn of ['handleSync', 'handleApiSync', 'handleGeoSync']) {
    const body = fnBody(src, fn);
    assert.match(body, /const pullKey = provider\.key;/, fn);
    assert.match(body, /if \(activeKeyRef\.current === pullKey\) setSyncResult\(r\);/, fn);
    assert.match(body, /finally \{ if \(activeKeyRef\.current === pullKey\) setSyncing\(false\); \}/, fn);
  }
});

// ---- U14 / U15 -----------------------------------------------------------------------

test('U14 Start Links: load errors block Save and dropped rows are named', () => {
  const src = PAGE('StartLinksPage');
  assert.match(src, /\.catch\(\(e\) => \{ if \(live\) setLoadErr\(/, 'a failed load is surfaced, not swallowed');
  assert.match(src, /disabled=\{saving \|\| !dirty \|\| loading \|\| !!loadErr\}/);
  assert.match(src, /if \(loading \|\| loadErr\) return;/);
  assert.match(src, /setDropped\(bad\);/);
  assert.match(src, /t\('startLinks\.droppedRows'/);
});

test('U15 PaymentGatewayCard stops spinning when its load fails', () => {
  const src = COMP('BillingSettings');
  assert.match(src, /err\s*\?\s*<div className="mt-3"><button type="button" onClick=\{load\}/);
});

// ---- U13: locale parity for every key added here --------------------------------------

test('U13 new and previously default-only keys exist in en and es', () => {
  const loc = (lg, ns) => JSON.parse(read('i18n', 'locales', lg, `${ns}.json`));
  const get = (o, k) => k.split('.').reduce((c, p) => (c == null ? c : c[p]), o);
  const KEYS = {
    proxies: ['actions.checkNew', 'actions.checkNewTooltip'],
    cmpSettingsC: ['proxyProviders.apiSync.ipv6Label', 'proxyProviders.apiSync.ipv6Help', 'proxyProviders.errors.anyipCredsOrApi'],
    trash: ['pager.showing', 'pager.prev', 'pager.next'],
    profiles: ['bulk.pause', 'bulk.resume', 'bulk.stop', 'bulk.launchPaused', 'general.engine', 'general.antidetectLabel', 'general.antidetectHelp', 'advanced.loadExtensions', 'bulkDeleteResult.partial', 'proxy.showPassword', 'proxy.hidePassword', 'filters.cancel'],
    browsers: ['browsers.showAll', 'browsers.showLess'],
    personas: ['table.reuse', 'form.showPassword', 'form.hidePassword'],
    automation: ['warmer.queueTitle', 'warmer.queueMode', 'warmer.parallelTitle', 'warmer.parallelLabel', 'macros.deleteConfirm'],
    settingsExtra: ['browser.antidetectEngine.title', 'browser.antidetectEngine.desc'],
    common: ['startLinks.title', 'startLinks.desc', 'startLinks.loadFailed', 'startLinks.loadError', 'startLinks.retry', 'startLinks.droppedRows_one', 'startLinks.droppedRows_other'],
    gate: ['remember.unavailable'],
    members: ['license.confirm.resetTrial', 'license.confirm.block'],
    cmpSettingsA: ['billing.gateway.retry', 'developerApi.keys.revokeConfirm']
  };
  for (const [ns, keys] of Object.entries(KEYS)) {
    const en = loc('en', ns); const es = loc('es', ns);
    for (const k of keys) {
      assert.equal(typeof get(en, k), 'string', `en ${ns}:${k}`);
      assert.equal(typeof get(es, k), 'string', `es ${ns}:${k}`);
      assert.notEqual(get(es, k), get(en, k), `es ${ns}:${k} must be translated`);
    }
  }
});
