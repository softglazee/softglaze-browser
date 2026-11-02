'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { preLaunchIssues, uaOsFamily, profileOsFamily, screenMismatch } = require('../src/main/launchCheck');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const IPC = read('src/main/ipcHandlers.js');
const PAGE = read('src/renderer/pages/ProfilesPage.jsx');
const NOW = Date.parse('2026-11-03T12:00:00Z');

const proxy = (over = {}) => ({
  id: 1, name: 'Vendor • Residential', host: 'gw', port: 1, provider: 'vendor', lastStatus: 'ok', lastLatencyMs: 300,
  lastCountry: 'US', lastBlacklisted: false, lastCheckedAt: new Date(NOW - 3600e3), lastIsp: 'Comcast', ...over
});
const profile = (over = {}) => ({
  id: 3, systemProxyBehavior: 'PROFILE_PROXY', browserCore: 'Chromium', os: 'Windows', deviceClass: 'desktop',
  userAgent: 'Auto', webrtc: 'Forward', timezoneType: 'Based on IP', languageType: 'Based on IP', locationType: 'Based on IP',
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  resolutionType: 'Random', resolutionW: '1920', resolutionH: '1080', launchCount: 9, ...over
});
const ctx = (over = {}) => ({ proxy: proxy(), sharedWith: 0, settings: {}, hostOs: 'Windows', cookieBytes: 400 * 1024, now: NOW, ...over });
const keys = (issues) => issues.map((i) => i.key).sort();

test('a coherent profile has nothing to stop for', () => {
  assert.deepEqual(preLaunchIssues(profile(), ctx()), []);
});

test('the user agent must name the same system as the profile', () => {
  assert.equal(uaOsFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.equal(uaOsFamily('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), 'android');
  assert.equal(uaOsFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'mac');
  assert.equal(profileOsFamily('macOS'), 'mac');
  const issues = preLaunchIssues(profile({ os: 'macOS', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140' }), ctx());
  const ua = issues.find((i) => i.key === 'uaOs');
  assert.deepEqual(ua.params, { ua: 'windows', os: 'macOS' });
  assert.equal(ua.fix, null, 'changing the user agent is the user\'s call');
  assert.ok(issues.some((i) => i.key === 'gpuOs'), 'a Direct3D GPU on macOS is caught too');
});

test('the screen must fit the device', () => {
  assert.deepEqual(screenMismatch(profile({ deviceClass: 'mobile', os: 'Android', resolutionW: '1920', resolutionH: '1080' })), { width: 1920, height: 1080, device: 'mobile' });
  assert.deepEqual(screenMismatch(profile({ resolutionW: '800', resolutionH: '600' })), { width: 800, height: 600, device: 'desktop' });
  assert.equal(screenMismatch(profile({ deviceClass: 'mobile', os: 'Android', resolutionW: '412', resolutionH: '915' })), null);
  assert.equal(screenMismatch(profile({ resolutionType: 'Real', resolutionW: '640', resolutionH: '480' })), null, 'the real screen is never a mismatch');
});

test('location, WebRTC and a dead proxy come with one-click fixes', () => {
  const issues = preLaunchIssues(
    profile({ languageType: 'Custom', languageCustom: 'de-DE', timezoneType: 'Real', webrtc: 'Real' }),
    ctx({ proxy: proxy({ lastStatus: 'fail' }) })
  );
  assert.deepEqual(keys(issues), ['language', 'proxyDead', 'timezone', 'webrtc']);
  const fix = Object.fromEntries(issues.map((i) => [i.key, i.fix]));
  assert.deepEqual(fix, { language: 'lang-auto', proxyDead: 'swap-proxy', timezone: 'tz-auto', webrtc: 'webrtc-safe' });
  assert.ok(issues.every((i) => i.severity === 'fail'));
});

test('a language that cannot be compared yet does not stop a launch', () => {
  const issues = preLaunchIssues(profile({ languageType: 'Custom', languageCustom: 'de-DE' }), ctx({ proxy: proxy({ lastCountry: null }) }));
  assert.deepEqual(issues, []);
});

test('the handlers are registered, gated and respect the setting', () => {
  assert.match(IPC, /registerHandler\(CHANNELS\.PROFILE_CAPTCHA_FIX_BULK, captchaFixBulk\)/);
  assert.match(IPC, /registerHandler\(CHANNELS\.PROFILE_PRELAUNCH_CHECK, prelaunchCheck\)/);
  assert.match(IPC, /checkBeforeLaunch: true,/, 'on by default');

  const bulk = IPC.slice(IPC.indexOf('async function captchaFixBulk('), IPC.indexOf('async function prelaunchCheck('));
  assert.ok(bulk.indexOf("requirePermission('profiles.edit')") < bulk.indexOf('db.profile.update'));
  assert.match(bulk, /partitionAccessibleProfileIds\(ids, \{ requireEdit: true \}\)/);
  assert.match(bulk, /captchaScore\.PROFILE_FIELD_FIXES\[action\]/);
  assert.match(bulk, /applySpareProxy\(db, profile\)/);
  assert.doesNotMatch(bulk, /deepCheckProxy|startWarmer|setGlobalSettings/, 'slow or workspace-wide fixes stay one click each');

  const check = IPC.slice(IPC.indexOf('async function prelaunchCheck('), IPC.indexOf('// ---- Proxy health: persistence and scheduler ----'));
  assert.match(check, /checkBeforeLaunch === false\) return \{ enabled: false/);
  assert.match(check, /partitionAccessibleProfileIds\(ids\)/);

  const fix = IPC.slice(IPC.indexOf('async function captchaFix('), IPC.indexOf('async function applySpareProxy('));
  assert.match(fix, /applySpareProxy\(db, profile\)/, 'the single and bulk fixes share one swap path');
});

test('the Profiles page checks before every launch and offers the bulk fix', () => {
  const single = PAGE.slice(PAGE.indexOf('async function handleLaunch('), PAGE.indexOf('async function handleClone('));
  assert.ok(single.indexOf('passPreLaunch([profileId])') < single.indexOf('profiles.launch('));
  const bulk = PAGE.slice(PAGE.indexOf('async function handleBulkLaunch('), PAGE.indexOf('async function pauseQueue('));
  assert.ok(bulk.indexOf('passPreLaunch(ids)') < bulk.indexOf('profiles.bulkLaunch('));
  assert.match(PAGE, /onClick=\{handleBulkCaptchaFix\}/);
  assert.match(PAGE, /<option value="fixable">/);
  assert.match(PAGE, /<option value="risk-desc">/);
});

test('every pre-launch issue has English and Spanish text', () => {
  const en = JSON.parse(read('src/renderer/i18n/locales/en/captcha.json'));
  const es = JSON.parse(read('src/renderer/i18n/locales/es/captcha.json'));
  for (const lang of [en, es]) {
    const issue = lang.prelaunch.issue;
    for (const k of ['uaOs', 'gpuOs', 'language', 'timezone', 'webrtc', 'proxyDead']) assert.ok(issue[k], k);
    assert.ok(issue.screen.mobile && issue.screen.desktop);
    assert.ok(lang.bulk.fix && lang.filter.fixable && lang.sort.riskDesc);
  }
  for (const lang of ['en', 'es']) {
    const s = JSON.parse(read(`src/renderer/i18n/locales/${lang}/settingsExtra.json`));
    assert.ok(s.browser.checkBeforeLaunch.title && s.browser.checkBeforeLaunch.desc, lang);
  }
});
