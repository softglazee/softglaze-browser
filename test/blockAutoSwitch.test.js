'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const blockDetect = require('../src/main/blockDetect');
const { classifyBlock, retryUrlFor, siteOf, recentSwitches, withinSwitchBudget, planBlockResponse, blockedProxyContext } = blockDetect;
const { bestReplacement } = require('../src/main/captchaScore');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const IPC = read('src/main/ipcHandlers.js');
const ENGINE = read('src/main/browserEngine.js');
const FIREFOX = read('src/main/firefoxEngine.js');
const PRELOAD = read('src/preload/preload.js');
const between = (src, from, to) => {
  const a = src.indexOf(from);
  assert.notEqual(a, -1, `missing: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.notEqual(b, -1, `missing: ${to}`);
  return src.slice(a, b);
};

// ---- Classification ----

test("Google's /sorry/ page is a hard block on every Google domain", () => {
  const sorry = 'https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dshoes&q=EgQ';
  assert.deepEqual(classifyBlock({ url: sorry, status: 429 }), { blocked: true, kind: 'googleSorry', hard: true });
  assert.equal(classifyBlock({ url: 'https://ipv4.google.com/sorry/index?q=x', status: 200 }).kind, 'googleSorry');
  assert.equal(classifyBlock({ url: 'https://www.google.co.uk/sorry/', status: 429 }).hard, true);
  assert.equal(classifyBlock({ url: 'https://notgoogle.com/sorry/index', status: 200 }).blocked, false, 'not a Google host');
  assert.equal(classifyBlock({ url: 'https://www.google.com/sorryabc', status: 200 }).blocked, false);
});

test('HTTP 429 on the main document is a block that may clear', () => {
  assert.deepEqual(classifyBlock({ url: 'https://shop.example/item', status: 429 }), { blocked: true, kind: 'rateLimit', hard: false });
});

test('a Cloudflare challenge is recognised by its header or its titles', () => {
  const hit = { blocked: true, kind: 'cloudflare', hard: false };
  assert.deepEqual(classifyBlock({ url: 'https://a.example/', status: 403, headers: { 'cf-mitigated': 'challenge' } }), hit);
  assert.deepEqual(classifyBlock({ url: 'https://a.example/', status: 403, headers: { 'CF-Mitigated': 'challenge' } }), hit, 'header names in any case');
  assert.deepEqual(classifyBlock({ url: 'https://a.example/', status: 200, title: 'Just a moment...' }), hit);
  assert.deepEqual(classifyBlock({ url: 'https://a.example/', status: 200, title: 'Just a moment\u2026' }), hit);
  assert.deepEqual(classifyBlock({ url: 'https://a.example/', status: 403, title: 'Attention Required! | Cloudflare' }), hit);
  assert.equal(classifyBlock({ url: 'https://a.example/', status: 200, title: 'Just a moment with our CEO' }).blocked, false);
  assert.equal(classifyBlock({ url: 'https://a.example/', status: 200, headers: { 'cf-ray': 'abc', server: 'cloudflare' } }).blocked, false, 'a site behind Cloudflare is not blocked');
});

test('DataDome counts only on a 403 with its header', () => {
  const hit = { blocked: true, kind: 'datadome', hard: false };
  assert.deepEqual(classifyBlock({ url: 'https://b.example/', status: 403, headers: { 'x-datadome': 'protected' } }), hit);
  assert.deepEqual(classifyBlock({ url: 'https://b.example/', status: 403, headers: { 'x-dd-b': '1' } }), hit);
  assert.equal(classifyBlock({ url: 'https://b.example/', status: 200, headers: { 'x-datadome': 'protected' } }).blocked, false, 'every page of a protected site carries the header');
});

test('Akamai / Imperva "Access Denied" counts only on a 403', () => {
  assert.deepEqual(classifyBlock({ url: 'https://c.example/', status: 403, title: 'Access Denied' }), { blocked: true, kind: 'accessDenied', hard: false });
  assert.equal(classifyBlock({ url: 'https://c.example/', status: 200, title: 'Access Denied' }).blocked, false);
});

test('PerimeterX is recognised by its title or a px-captcha URL', () => {
  assert.equal(classifyBlock({ url: 'https://d.example/', status: 403, title: 'Access to this page has been denied' }).kind, 'perimeterx');
  assert.equal(classifyBlock({ url: 'https://d.example/blocked?url=x&px-captcha=1', status: 200 }).kind, 'perimeterx');
});

test('normal pages, CAPTCHA widgets inside pages and non-web URLs are not blocks', () => {
  const none = { blocked: false, kind: null, hard: false };
  assert.deepEqual(classifyBlock({ url: 'https://news.example/', status: 200, headers: {}, title: 'Today' }), none);
  // A login form with reCAPTCHA: the page itself is a normal document, and the widget's own frame
  // URL is no block either (only main-frame documents are classified at all; see the engine test).
  assert.deepEqual(classifyBlock({ url: 'https://accounts.example/login', status: 200, title: 'Sign in' }), none);
  assert.deepEqual(classifyBlock({ url: 'https://www.google.com/recaptcha/api2/anchor?k=abc', status: 200, title: 'reCAPTCHA' }), none);
  assert.deepEqual(classifyBlock({ url: 'https://example.com/404', status: 404, title: 'Not found' }), none);
  assert.deepEqual(classifyBlock({ url: 'file:///C:/start.html', status: 429 }), none);
  assert.deepEqual(classifyBlock({}), none);
});

test('only the Google page is hard; everything else waits for the re-check', () => {
  const samples = [
    { url: 'https://e.example/', status: 429 },
    { url: 'https://e.example/', status: 403, headers: { 'cf-mitigated': 'challenge' } },
    { url: 'https://e.example/', status: 403, headers: { 'x-datadome': '1' } },
    { url: 'https://e.example/', status: 403, title: 'Access Denied' },
    { url: 'https://e.example/', status: 403, title: 'Access to this page has been denied.' }
  ];
  for (const s of samples) {
    const v = classifyBlock(s);
    assert.equal(v.blocked, true, JSON.stringify(s));
    assert.equal(v.hard, false, `${v.kind} must get the grace period`);
  }
  assert.ok(blockDetect.GRACE_MS >= 15000 && blockDetect.GRACE_MS <= 30000, 'about 20 seconds');
});

test('the engine re-checks a non-hard block after the grace period before reporting it', () => {
  const watch = between(ENGINE, 'function watchPageForBlocks(', '// Opens a blocked page again');
  const graceAt = watch.indexOf('if (!verdict.hard)');
  const sleepAt = watch.indexOf('await sleep(blockDetect.GRACE_MS)');
  const recheckAt = watch.indexOf('blockDetect.classifyBlock({ url: page.url()');
  const emitAt = watch.indexOf("emitSessionEvent({ type: 'blocked'");
  assert.ok(graceAt !== -1 && graceAt < sleepAt && sleepAt < recheckAt && recheckAt < emitAt, 'grace, then re-check, then report');
  assert.match(watch, /if \(!again\.blocked\) \{ state\.seen\.delete\(doc\.url\); return; \}/, 'a cleared challenge is not reported');
  assert.match(watch, /state\.seen\.has\(doc\.url\)/, 'one report per tab per blocked URL');
  assert.match(watch, /req\.isNavigationRequest\(\) \|\| req\.frame\(\) !== page\.mainFrame\(\)/, 'main-frame documents only');
  assert.doesNotMatch(watch, /page\.title\(|page\.evaluate\(/, 'no script runs in the page to read the title');
  assert.match(ENGINE, /Page\.getNavigationHistory/);
});

test('the engine watches the first tab and every new tab of a Chrome session', () => {
  const launch = between(ENGINE, 'async function launchProfileSessionNow(', '// Navigate a running session');
  assert.match(launch, /watchPageForBlocks\(page, profileId, sessionProxyId\)/);
  assert.match(launch, /watchPageForBlocks\(newPage, profileId, sessionProxyId\)/);
  assert.match(launch, /openTab: hOpenTab/);
  assert.doesNotMatch(FIREFOX, /blockDetect|type: 'blocked'/, 'Firefox sessions are not watched');
});

// ---- Retry target ----

test('the retry opens the search Google interrupted, or the blocked page itself', () => {
  assert.equal(retryUrlFor('https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dshoes&q=EgQ'), 'https://www.google.com/search?q=shoes');
  assert.equal(retryUrlFor('https://www.google.com/sorry/index?continue=https://evil.example/'), 'https://www.google.com/', 'never leaves Google');
  assert.equal(retryUrlFor('https://www.google.de/sorry/index'), 'https://www.google.de/');
  assert.equal(retryUrlFor('https://shop.example/item?id=3'), 'https://shop.example/item?id=3');
  assert.equal(retryUrlFor('chrome://newtab'), null);
  assert.equal(siteOf('https://www.shop.example/a'), 'shop.example');
  assert.equal(siteOf('nonsense'), '');
});

// ---- Loop guard ----

test('at most two automatic changes per profile per hour', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const hour = 60 * 60 * 1000;
  assert.equal(blockDetect.SWITCH_LIMIT, 2);
  assert.equal(blockDetect.SWITCH_WINDOW_MS, hour);
  assert.equal(withinSwitchBudget([], now), true);
  assert.equal(withinSwitchBudget(undefined, now), true);
  assert.equal(withinSwitchBudget([now - 1000], now), true);
  assert.equal(withinSwitchBudget([now - 2000, now - 1000], now), false);
  assert.equal(withinSwitchBudget([now - hour - 1, now - 1000], now), true, 'older changes fall out of the window');
  assert.deepEqual(recentSwitches([now - hour - 5, now - 10, NaN], now), [now - 10]);
  assert.equal(withinSwitchBudget([now - 10], now, { limit: 1 }), false);
});

test('the plan: off, no proxy, busy and over the limit only log; rotate before swap', () => {
  const base = { enabled: true, hasProxy: true, busy: false, withinBudget: true, canRotate: false, poolInUse: false };
  assert.deepEqual(planBlockResponse({ ...base, enabled: false }), { steps: [], reason: 'disabled' });
  assert.deepEqual(planBlockResponse({ ...base, hasProxy: false }), { steps: [], reason: 'noProxy' });
  assert.deepEqual(planBlockResponse({ ...base, busy: true }), { steps: [], reason: 'busy' });
  assert.deepEqual(planBlockResponse({ ...base, withinBudget: false }), { steps: [], reason: 'limit' });
  assert.deepEqual(planBlockResponse(base), { steps: ['swap'], reason: null });
  assert.deepEqual(planBlockResponse({ ...base, canRotate: true }), { steps: ['rotate', 'swap'], reason: null });
  assert.deepEqual(planBlockResponse({ ...base, canRotate: true, poolInUse: true }), { steps: ['rotate'], reason: null });
  assert.deepEqual(planBlockResponse({ ...base, poolInUse: true }), { steps: [], reason: 'proxyPool' });
});

// ---- Spare proxy choice ----

const NOW = Date.parse('2026-11-03T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const proxy = (over = {}) => ({
  id: 1, name: 'Vendor • Residential • US', host: 'gw.example', port: 8000, provider: 'vendor',
  lastStatus: 'ok', lastLatencyMs: 420, lastCountry: 'US', lastBlacklisted: false,
  lastCheckedAt: new Date(NOW - DAY), lastIsp: 'AS7922 Comcast Cable Communications', ...over
});
const profile = {
  id: 7, systemProxyBehavior: 'PROFILE_PROXY', browserCore: 'Chromium', os: 'Windows', deviceClass: 'desktop',
  webrtc: 'Forward', timezoneType: 'Based on IP', languageType: 'Based on IP', locationType: 'Based on IP',
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  launchCount: 12, createdAt: new Date(NOW - 40 * DAY)
};
const ctx = { proxy: proxy(), sharedWith: 0, settings: { blockThirdPartyCookies: false }, hostOs: 'Windows', cookieBytes: 300 * 1024, now: NOW };

test('a blocked proxy counts as failing, so a well set-up profile can still move', () => {
  const spares = [proxy({ id: 20, name: 'Spare DC', lastIsp: 'AS16509 Amazon.com, Inc.' }), proxy({ id: 21, name: 'Spare home' })];
  assert.equal(bestReplacement(profile, ctx, spares), null, 'without the block, nothing beats a perfect score');
  const best = bestReplacement(profile, blockedProxyContext(ctx), spares);
  assert.equal(best.proxy.id, 21, 'a home IP before a datacenter one');
  assert.equal(ctx.proxy.lastStatus, 'ok', 'the stored context is not changed');
  assert.equal(bestReplacement(profile, blockedProxyContext(ctx), [proxy({ id: 1 })]), null, 'never the proxy that was blocked');
  assert.deepEqual(blockedProxyContext({ proxy: null }), { proxy: null });
});

// ---- Handler wiring ----

test('the setting exists and is on by default', () => {
  const defaults = between(IPC, 'const GLOBAL_SETTINGS_DEFAULTS = Object.freeze({', 'function deepMergeSettings(');
  const browser = between(defaults, 'browser: {', 'onStartup: {');
  assert.match(browser, /switchProxyOnBlock: true,/);
});

test('every block is logged with the proxy, vendor, site, kind and action', () => {
  const handler = between(IPC, 'async function onSessionBlocked(', 'async function respondToBlock(');
  assert.match(handler, /logAudit\('proxy\.blocked', \{/);
  for (const key of ['proxyId: proxy ? proxy.id : null', 'provider: proxy ? deriveProvider(proxy) : null', 'site,', 'kind,', 'action: outcome.action']) {
    assert.ok(handler.includes(key), `detail carries ${key}`);
  }
  assert.ok(handler.indexOf("logAudit('proxy.blocked'") < handler.indexOf('emitSessionBlocked('), 'logged, then shown');
  assert.match(IPC, /if \(evt\.type === 'blocked'\) \{ onSessionBlocked\(evt\)\.catch\(\(\) => \{\}\); return; \}/);
});

test('Firefox profiles are skipped', () => {
  const handler = between(IPC, 'async function onSessionBlocked(', 'async function respondToBlock(');
  const skip = handler.indexOf('normalizeBrowserCore(profile.browserCore) === BROWSER_CORE.FIREFOX) return;');
  assert.notEqual(skip, -1);
  assert.ok(skip < handler.indexOf('respondToBlock('), 'before anything is changed');
});

test('the switch reads the setting, the loop guard and the automation guard', () => {
  const respond = between(IPC, 'async function respondToBlock(', 'async function swapProxyAfterBlock(');
  assert.match(respond, /settings\.browser\.switchProxyOnBlock === false/);
  assert.match(respond, /blockDetect\.withinSwitchBudget\(times, now\)/);
  assert.match(respond, /busy: profileDrivenByAutomation\(id\)/);
  assert.match(respond, /authGate\.decide\(CHANNELS\.PROFILE_LAUNCH, await ipcAuthState\(\)\)/, 'nothing changes while signed out or locked');
  assert.match(respond, /rotateProxyIp\(\{ id: proxy\.id, profileId: id \}\)/, 'rotation goes through the gated handler, for the profile that met the block');
  assert.match(respond, /canRotate: proxyCanRotate\(proxy\)/, 'a link, or a vendor API that rotates (apiRotationProvider)');
  const busy = between(IPC, 'function profileDrivenByAutomation(', 'async function profileUsesRotationPool(');
  for (const src of ['apiDrivenProfiles', 'profilesInParallelRun()', 'macroRuns.values()', 'warmerRuns.values()', 'isRecordingMacro(']) {
    assert.ok(busy.includes(src), `busy check covers ${src}`);
  }
  assert.match(IPC, /const control = \{ paused: false, aborted: false, profileId, ownerMemberId: actingMemberId\(\) \};/, 'macro runs record their profile');
  assert.match(IPC, /apiDrivenProfiles\.add\(Number\(payload\.id\)\)/, 'Local API and AI launches are tracked');
});

test('a swap uses the CAPTCHA score\'s spare-proxy choice and permission checks', () => {
  const swap = between(IPC, 'async function swapProxyAfterBlock(', '// Restore candidates:');
  assert.match(swap, /captchaScore\.bestReplacement\(profile, ctx, candidates\)/);
  assert.match(swap, /blockDetect\.blockedProxyContext\(\(await captchaContexts\(db, \[profile\]\)\)\.get\(id\)\)/);
  assert.match(swap, /scopedProxyWhere\(\{ lastStatus: 'ok', profiles: \{ none: \{\} \} \}\)/);
  assert.ok(swap.indexOf("requirePermission('profiles.edit')") < swap.indexOf('db.profile.update'));
  assert.match(swap, /assertCanAccessProfile\(id, \{ requireEdit: true \}\)/);
  assert.ok(swap.indexOf('db.profile.update') < swap.indexOf('closeAnySession(evt.sessionId)'));
  assert.ok(swap.indexOf('closeAnySession(evt.sessionId)') < swap.indexOf('launchProfileById(id'));
  assert.match(swap, /retryBlockedPage\(session\.sessionId, null, retryUrl\)/, 'the blocked page opens again');
});

test('the renderer is told on its own push channel', () => {
  assert.match(IPC, /SESSION_BLOCKED: 'session:blocked'/);
  assert.match(PRELOAD, /SESSION_BLOCKED: 'session:blocked'/);
  assert.match(IPC, /w\.webContents\.send\(CHANNELS\.SESSION_BLOCKED, data\)/);
  assert.match(PRELOAD, /onBlocked: \(callback\) => \{/);
  assert.match(read('src/renderer/lib/softglazeApi.js'), /onBlocked: \(cb\) => getSoftglazeApi\(\)\.sessions\.onBlocked\(cb\)/);
  assert.match(read('src/renderer/components/ResilienceToasts.jsx'), /softglazeApi\.sessions\.onBlocked\(/);
  assert.match(read('src/renderer/components/AppShell.jsx'), /<ResilienceToasts \/>/, 'the notice shows on every page, not only the Dashboard');
});

test('the Settings page has the switch', () => {
  const page = read('src/renderer/pages/SettingsPage.jsx');
  assert.match(page, /tx\('browser\.switchProxyOnBlock\.title'\)/);
  assert.match(page, /checked=\{s\.browser\.switchProxyOnBlock !== false\}/);
  assert.match(page, /apply\(\{ browser: \{ switchProxyOnBlock: v \} \}\)/);
});

// ---- i18n ----

test('English and Spanish have the same keys, with text for every kind and outcome', () => {
  const en = JSON.parse(read('src/renderer/i18n/locales/en/settingsExtra.json'));
  const es = JSON.parse(read('src/renderer/i18n/locales/es/settingsExtra.json'));
  const keys = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${pre}${k}.`) : [`${pre}${k}`]));
  assert.deepEqual(keys(es).sort(), keys(en).sort(), 'Spanish has exactly the English keys');
  const s = en.browser.switchProxyOnBlock;
  assert.ok(s.title && s.desc);
  for (const k of ['blocked', 'rotated', 'switched', 'notReopened']) assert.ok(s.toast[k], `toast.${k}`);
  for (const kind of ['googleSorry', 'rateLimit', 'cloudflare', 'datadome', 'accessDenied', 'perimeterx', 'unknown']) {
    assert.ok(s.toast.kind[kind], `kind.${kind}`);
  }
  const reasons = ['disabled', 'noProxy', 'busy', 'limit', 'proxyPool', 'noSpare', 'noPermission', 'signedOut', 'inProgress', 'failed'];
  for (const r of reasons) assert.ok(s.toast.none[r], `none.${r}`);
  // Every reason the code can produce has text.
  const section = between(IPC, '// ---- Switch proxy when a site blocks a profile ----', '// Restore candidates:');
  const produced = [...section.matchAll(/reason(?::|\s*=)\s*'(\w+)'/g)].map((m) => m[1])
    .concat([...fs.readFileSync(path.join(ROOT, 'src/main/blockDetect.js'), 'utf8').matchAll(/reason: '(\w+)'/g)].map((m) => m[1]));
  for (const r of new Set(produced)) {
    if (r === 'notReopened') continue; // shown as its own line, not a "nothing changed" reason
    assert.ok(s.toast.none[r], `reason "${r}" has text`);
  }
  assert.match(s.toast.blocked, /\{\{site\}\}/);
  assert.match(s.toast.blocked, /\{\{profile\}\}/);
});
