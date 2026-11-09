'use strict';
// Microsoft Store rating prompt (Store build only): when the Dashboard card may ask (3 different days,
// 5 successful profile launches, Not now spacing and limit, Don't ask again, after Rate, the website
// build never), the in-app dialog with its fallback to the Store's review page, the renderer's
// "normal start" rule, the wiring, and the en / es strings. No real Store call is made.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const rating = require('../src/main/storeRating');
const bridge = require('../src/main/storeBridge');
const loadRendererLib = () => import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', 'storeRating.mjs')).href);

const { createStoreRating, shouldAsk, normalize, REVIEW_URI, STATE_SETTING, MIN_DAYS, MIN_LAUNCHES, SNOOZE_MS, MAX_NOT_NOW } = rating;
const DAY = 86400000;
const T0 = new Date(2026, 10, 9, 10, 0, 0).getTime(); // 9 Nov 2026, 10:00 local

// A fake addon bridge: scripted answer to "rate", every call recorded.
function fakeBridge({ available = true, answer = { ok: true, status: 'Succeeded', wasUpdated: false, extendedError: '0x00000000' } } = {}) {
  const calls = [];
  return {
    calls,
    available: () => available,
    call: async (cmd, opts) => { calls.push({ cmd, opts }); if (answer instanceof Error) throw answer; return typeof answer === 'function' ? answer(opts) : answer; }
  };
}

function harness({ storeBuild = true, settings = {}, bridgeOver, blocked = false, openFails = false } = {}) {
  const store = { ...settings };
  const writes = [];
  const opened = [];
  let clock = T0;
  const b = fakeBridge(bridgeOver);
  const sr = createStoreRating({
    isStoreBuild: () => storeBuild,
    readSetting: async (k, fb) => (k in store ? store[k] : fb),
    writeSetting: async (k, v) => { writes.push(k); store[k] = JSON.parse(JSON.stringify(v)); },
    bridge: b,
    openExternal: async (url) => { opened.push(url); if (openFails) throw new Error('no handler'); },
    promptBlocked: typeof blocked === 'function' ? blocked : async () => blocked,
    now: () => clock
  });
  return {
    sr, b, store, writes, opened,
    state: () => normalize(store[STATE_SETTING]),
    advance: (ms) => { clock += ms; },
    at: (ms) => { clock = ms; }
  };
}

// Use the app on `days` different days with `launches` profile launches on the first of them.
async function use(h, { days = MIN_DAYS, launches = MIN_LAUNCHES } = {}) {
  for (let i = 0; i < launches; i++) await h.sr.noteLaunch();
  for (let d = 1; d < days; d++) { h.advance(DAY); await h.sr.noteUse(); }
}

// ---- when to ask ---------------------------------------------------------------------------------
test('the review URI is the Store ID form for SoftGlaze Browser', () => {
  assert.equal(REVIEW_URI, 'ms-windows-store://review/?ProductId=9NQZMTHN87CB');
  assert.equal(MIN_DAYS, 3);
  assert.equal(MIN_LAUNCHES, 5);
  assert.equal(SNOOZE_MS, 30 * DAY);
  assert.equal(MAX_NOT_NOW, 3, 'the first ask plus at most 2 more');
});

test('not before 3 different days AND 5 successful profile launches', async () => {
  const h = harness();
  assert.deepEqual(await h.sr.status(), { storeBuild: true, ask: false }, 'a new install');

  // Five launches on one day: still only one day.
  for (let i = 0; i < 5; i++) await h.sr.noteLaunch();
  assert.equal(h.state().launches, 5);
  assert.equal(h.state().days.length, 1);
  assert.equal((await h.sr.status()).ask, false);

  // Starting the app again the same day does not add a day.
  await h.sr.noteUse();
  h.advance(2 * 3600000);
  await h.sr.noteUse();
  assert.equal(h.state().days.length, 1);

  h.advance(DAY);
  await h.sr.noteUse();
  assert.equal((await h.sr.status()).ask, false, 'two days');
  h.advance(DAY);
  assert.equal((await h.sr.status()).ask, true, 'a Dashboard visit on the third day counts as use');
  assert.equal(h.state().days.length, 3);
});

test('3 days of use without 5 launches does not ask; the fifth launch does', async () => {
  const h = harness();
  await use(h, { days: 3, launches: 4 });
  assert.equal((await h.sr.status()).ask, false, '4 launches');
  await h.sr.noteLaunch();
  assert.equal((await h.sr.status()).ask, true);
});

test('days are calendar days: two starts either side of midnight are two days, gaps between days are fine', async () => {
  const h = harness();
  h.at(new Date(2026, 10, 9, 23, 50).getTime());
  await h.sr.noteUse();
  h.at(new Date(2026, 10, 10, 0, 10).getTime());
  await h.sr.noteUse();
  h.at(new Date(2026, 11, 1, 9, 0).getTime());
  await h.sr.noteUse();
  assert.deepEqual(h.state().days, ['2026-11-09', '2026-11-10', '2026-12-01']);
});

test('launches started together are all counted, and counting stops once the thresholds are met', async () => {
  const h = harness();
  await Promise.all(Array.from({ length: 5 }, () => h.sr.noteLaunch()));
  assert.equal(h.state().launches, 5);
  await use(h, { days: 3, launches: 0 });
  const before = h.writes.length;
  await h.sr.noteLaunch();
  await h.sr.noteUse();
  assert.equal(h.writes.length, before, 'nothing more is written once both are met');
});

test('"Not now" waits 30 days, at most 2 more times, then never again', async () => {
  const h = harness();
  await use(h);
  assert.equal((await h.sr.status()).ask, true, 'first ask');
  for (let round = 1; round <= MAX_NOT_NOW; round++) {
    await h.sr.choose('notNow');
    assert.equal((await h.sr.status()).ask, false, `hidden right after Not now #${round}`);
    h.advance(29 * DAY);
    assert.equal((await h.sr.status()).ask, false, `still hidden 29 days after Not now #${round}`);
    h.advance(DAY + 1000);
    const again = (await h.sr.status()).ask;
    if (round < MAX_NOT_NOW) assert.equal(again, true, `asked again 30 days after Not now #${round}`);
    else assert.equal(again, false, 'after the third Not now it never asks again');
  }
  h.advance(400 * DAY);
  assert.equal((await h.sr.status()).ask, false);
  assert.equal(h.state().notNow, 3);
});

test('"Don\'t ask again" means never, but the Settings entry stays', async () => {
  const h = harness();
  await use(h);
  assert.equal((await h.sr.status()).ask, true);
  assert.deepEqual(await h.sr.choose('never'), { storeBuild: true, ask: false });
  h.advance(1000 * DAY);
  assert.deepEqual(await h.sr.status(), { storeBuild: true, ask: false }, 'storeBuild keeps the Settings entry');
  assert.equal(h.state().done, 'never');
});

test('after "Rate" (card or Settings) it never asks again', async () => {
  const h = harness();
  await use(h);
  assert.equal((await h.sr.status()).ask, true);
  const r = await h.sr.rate('4242');
  assert.equal(r.ok, true);
  h.advance(1000 * DAY);
  assert.equal((await h.sr.status()).ask, false);
  assert.equal(h.state().done, 'rated');

  // From Settings before the card was ever due: the card never comes.
  const h2 = harness();
  await h2.sr.rate('4242');
  await use(h2);
  assert.equal((await h2.sr.status()).ask, false);
});

test('an unknown choice is refused and changes nothing', async () => {
  const h = harness();
  await use(h);
  await assert.rejects(() => h.sr.choose('rate'), /Unknown choice/, '"Rate" only through rate(), which opens the Store');
  await assert.rejects(() => h.sr.choose('yes'), /Unknown choice/);
  assert.equal((await h.sr.status()).ask, true);
});

test('main holds it back while the first-run wizard or a licence screen is up, and when that check fails', async () => {
  const blocked = harness({ blocked: true });
  await use(blocked);
  assert.deepEqual(await blocked.sr.status(), { storeBuild: true, ask: false });

  const broken = harness({ blocked: async () => { throw new Error('db gone'); } });
  await use(broken);
  assert.equal((await broken.sr.status()).ask, false, 'fails closed');

  const L = rating.licenceBlocksAsk;
  assert.equal(L({ isTrial: true, daysLeftTrial: 9 }), false, 'a trial in progress is a normal state');
  assert.equal(L({ isPaid: true }), false);
  assert.equal(L({ needsPlan: true }), true, 'trial ended, plan step');
  assert.equal(L({ isGrace: true }), true);
  assert.equal(L({ isBanned: true }), true);
  assert.equal(L({ isExpired: true }), true);
  assert.equal(L({ isPaid: true, reason: 'machine_mismatch' }), true);
  assert.equal(L(null), true);
});

test('the website and base builds never count, never ask and never open anything', async () => {
  const h = harness({ storeBuild: false, bridgeOver: { available: true } });
  for (let i = 0; i < 10; i++) { await h.sr.noteLaunch(); await h.sr.noteUse(); h.advance(DAY); }
  assert.deepEqual(h.writes, [], 'nothing stored');
  assert.deepEqual(await h.sr.status(), { storeBuild: false, ask: false });
  assert.deepEqual(await h.sr.choose('never'), { storeBuild: false, ask: false });
  assert.deepEqual(await h.sr.rate('4242'), { ok: false, error: 'not_store_build' });
  assert.deepEqual(h.b.calls, [], 'the Store addon is never called');
  assert.deepEqual(h.opened, [], 'the Store is never opened');
  assert.equal(shouldAsk({ days: ['a', 'b', 'c'], launches: 99 }, { storeBuild: false, now: T0 }), false);
});

test('a damaged saved state is read safely', () => {
  assert.deepEqual(normalize(null), { days: [], launches: 0, notNow: 0, snoozedUntil: 0, done: null });
  assert.deepEqual(normalize({ days: ['2026-11-09', '2026-11-09', 'x', 5], launches: -3, notNow: 'two', done: 'maybe' }),
    { days: ['2026-11-09'], launches: 0, notNow: 0, snoozedUntil: 0, done: null });
  assert.equal(normalize({ launches: 500 }).launches, MIN_LAUNCHES);
});

// ---- rating: the Store dialog, else the Store's review page -------------------------------------------
test('rate: the Store\'s in-app dialog with the app window as owner; no Store page when it showed', async () => {
  for (const status of ['Succeeded', 'CanceledByUser']) {
    const h = harness({ bridgeOver: { answer: { ok: true, status, wasUpdated: false, extendedError: '0x00000000' } } });
    const r = await h.sr.rate('123456');
    assert.deepEqual(r, { ok: true, via: 'dialog', status });
    assert.deepEqual(h.b.calls, [{ cmd: 'rate', opts: { hwnd: '123456' } }]);
    assert.deepEqual(h.opened, [], `${status}: the review page is not opened as well`);
  }
  // Still open when the bridge stops waiting: do not open a second review screen on top.
  const slow = harness({ bridgeOver: { answer: { ok: false, error: 'timeout' } } });
  assert.equal((await slow.sr.rate('1')).via, 'dialog');
  assert.deepEqual(slow.opened, []);
});

test('rate falls back to the Store\'s review page when the dialog is unavailable or fails', async () => {
  const cases = [
    ['addon missing (Store package built without the addon)', { bridgeOver: { available: false } }, '77', 'addon_unavailable'],
    ['no app window', {}, '', 'no_window'],
    ['no package identity', { bridgeOver: { answer: { ok: false, error: 'no_package_identity' } } }, '77', 'no_package_identity'],
    ['an older addon without "rate"', { bridgeOver: { answer: { ok: false, error: 'unknown_command' } } }, '77', 'unknown_command'],
    ['Store network error', { bridgeOver: { answer: { ok: true, status: 'NetworkError' } } }, '77', 'NetworkError'],
    ['Store error (for example an elevated app)', { bridgeOver: { answer: { ok: true, status: 'Error' } } }, '77', 'Error'],
    ['the bridge throws', { bridgeOver: { answer: new Error('boom') } }, '77', 'bridge_error'],
    ['a broken reply', { bridgeOver: { answer: null } }, '77', 'store_error']
  ];
  for (const [label, opts, hwnd, reason] of cases) {
    const h = harness(opts);
    const r = await h.sr.rate(hwnd);
    assert.deepEqual(r, { ok: true, via: 'store_page', reason }, label);
    assert.deepEqual(h.opened, ['ms-windows-store://review/?ProductId=9NQZMTHN87CB'], label);
    assert.equal(h.state().done, 'rated', `${label}: never asked again`);
  }
});

test('rate: when the Store cannot be opened at all, it says so instead of throwing', async () => {
  const h = harness({ bridgeOver: { available: false }, openFails: true });
  assert.deepEqual(await h.sr.rate('1'), { ok: false, error: 'open_failed', reason: 'addon_unavailable' });
});

test('rate still opens the Store when saving the choice fails', async () => {
  const h = harness({ bridgeOver: { available: false } });
  const sr = createStoreRating({
    isStoreBuild: () => true,
    readSetting: async () => null,
    writeSetting: async () => { throw new Error('disk full'); },
    bridge: h.b,
    openExternal: async (url) => { h.opened.push(url); }
  });
  assert.equal((await sr.rate('1')).via, 'store_page');
  assert.deepEqual(h.opened, [REVIEW_URI]);
});

test('bridge: the rating dialog gets minutes, not seconds, and only runs in the Store package', async () => {
  assert.ok(bridge.TIMEOUT_MS.rate >= 10 * 60000);
  bridge._setForTests({ isStoreInstall: false });
  assert.equal((await bridge.call('rate', { hwnd: '1' })).error, 'not_store_build');
  bridge._setForTests({ isStoreInstall: true, addon: { call: async (cmd, opts) => JSON.stringify({ ok: true, status: 'CanceledByUser', wasUpdated: false, seen: [cmd, opts.hwnd] }) } });
  assert.deepEqual((await bridge.call('rate', { hwnd: '9' })).seen, ['rate', '9']);
  bridge._setForTests(null);
});

// ---- renderer: only after a normal start -------------------------------------------------------------
test('renderer: the card shows only after a normal start; the Settings entry in every Store build', async () => {
  const r = await loadRendererLib();
  r._resetForTests();
  const due = { storeBuild: true, ask: true };
  assert.equal(r.normalStart(), true);
  for (const phase of ['loading', 'login', 'pick', 'licensing', 'ready']) r.noteGatePhase(phase);
  assert.equal(r.showRatingCard(due), true, 'unlock, sign in and member picker are a normal start');
  assert.equal(r.showRatingCard({ storeBuild: true, ask: false }), false);
  assert.equal(r.showRatingCard({ storeBuild: false, ask: true }), false);
  assert.equal(r.showRatingCard(null), false);

  for (const phase of ['register', 'confirm', 'confirmMember', 'plan', 'banned', 'super']) {
    r._resetForTests();
    r.noteGatePhase(phase);
    r.noteGatePhase('ready');
    assert.equal(r.showRatingCard(due), false, `not in a run that showed "${phase}"`);
  }
  r._resetForTests();
  assert.equal(r.showRatingEntry({ storeBuild: true, ask: false }), true);
  assert.equal(r.showRatingEntry({ storeBuild: false, ask: false }), false);
  assert.equal(r.showRatingEntry(undefined), false);
});

// ---- wiring --------------------------------------------------------------------------------------------
test('wiring: Store build only, visible launches counted, the Gate reports its screens, the card is on the Dashboard', () => {
  const main = read('src', 'main', 'ipcHandlers.js');
  assert.match(main, /isStoreBuild: \(\) => installChannel\(\) === 'store'/);
  assert.match(main, /openExternal: \(url\) => require\('electron'\)\.shell\.openExternal\(url\)/);
  assert.match(main, /if \(input && input\.headless\) return;/, 'headless warm-ups are not counted');
  assert.equal((main.match(/noteStoreRatingLaunch\(input\);/g) || []).length, 2, 'both engines count a successful launch');
  assert.match(main, /getStoreRating\(\)\.noteUse\(\)\.catch/);
  assert.match(main, /g\.onboardingDone === true/);
  assert.match(main, /return getStoreRating\(\)\.rate\(storeWindowHandle\(event\)\);/, 'owner window = the asking app window');
  for (const ch of ['store:rating-status', 'store:rating-choose', 'store:rating-rate']) {
    assert.ok(main.includes(`'${ch}'`) && read('src', 'preload', 'preload.js').includes(`'${ch}'`), ch);
  }

  const gate = read('src', 'renderer', 'components', 'Gate.jsx');
  assert.match(gate, /useEffect\(\(\) => \{ noteGatePhase\(phase\); \}, \[phase\]\);/);
  const dash = read('src', 'renderer', 'pages', 'DashboardPage.jsx');
  assert.match(dash, /<StoreRatingCard \/>/);
  assert.match(dash, /if \(!normalStart\(\)\) return undefined;/);
  assert.match(dash, /choose\('notNow'\)/);
  assert.match(dash, /choose\('never'\)/);
  const settings = read('src', 'renderer', 'pages', 'SettingsPage.jsx');
  assert.match(settings, /<StoreRatingEntry \/>/);
  assert.match(settings, /showRatingEntry\(s\)/);

  const cpp = read('native', 'store-addon', 'store_addon.cpp');
  assert.match(cpp, /cmd != "keys" && cmd != "rate"/, 'the addon allows the rate command');
  assert.match(cpp, /ctx\.RequestRateAndReviewAppAsync\(\)/);
  assert.match(read('scripts', 'build-store-native.js'), /a\.call\('rate', \{\}\)/, 'the addon check calls rate outside a package');
});

test('nothing is offered for a rating and nobody is filtered: no reward words, no happy-only gate', () => {
  const src = read('src', 'main', 'storeRating.js');
  assert.ok(!/require\(/.test(src), 'no dependencies of its own: no licence, trial or server code');
  const en = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'en', 'common.json')).storeRating;
  for (const v of Object.values(en)) {
    assert.ok(!/discount|free|reward|unlock|trial|bonus|coupon|stars?\b|5\b|five/i.test(v), `no incentive or star hint: ${v}`);
  }
  const dash = read('src', 'renderer', 'pages', 'DashboardPage.jsx');
  const card = dash.slice(dash.indexOf('function StoreRatingCard'), dash.indexOf('function SectionLabel'));
  assert.ok(!/mailto:|feedback|support@/i.test(card), 'no "unhappy? email us" branch');
});

test('strings: en and es have the same keys, plain English without dashes between clauses', () => {
  const en = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'en', 'common.json')).storeRating;
  const es = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'es', 'common.json')).storeRating;
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  assert.equal(en.cardTitle, 'Enjoying SoftGlaze Browser?');
  assert.equal(en.cardBody, 'A rating in the Microsoft Store helps other teams find it.');
  assert.equal(en.rate, 'Rate in Microsoft Store');
  assert.equal(en.notNow, 'Not now');
  assert.equal(en.never, "Don't ask again");
  assert.equal(en.entryTitle, 'Rate SoftGlaze Browser');
  for (const v of [...Object.values(en), ...Object.values(es)]) {
    assert.ok(!/ [-–—] |—|–/.test(v), `no dash between clauses: ${v}`);
    assert.ok(v.trim().length > 0);
  }
  const used = new Set();
  for (const file of [['src', 'renderer', 'pages', 'DashboardPage.jsx'], ['src', 'renderer', 'pages', 'SettingsPage.jsx']]) {
    for (const m of read(...file).matchAll(/\bt\('storeRating\.(\w+)'/g)) { used.add(m[1]); assert.equal(typeof en[m[1]], 'string', m[1]); }
  }
  assert.deepEqual([...used].sort(), Object.keys(en).sort(), 'every string is used, none is missing');
});
