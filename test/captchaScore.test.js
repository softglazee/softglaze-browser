'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { scoreProfile, ipTypeOf, pickReplacementProxy, bestReplacement, PROFILE_FIELD_FIXES } = require('../src/main/captchaScore');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src/main/ipcHandlers.js'), 'utf8');
const NOW = Date.parse('2026-11-03T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const goodProxy = (over = {}) => ({
  id: 1, name: 'Vendor • Residential • US', host: 'gw.example', port: 8000, provider: 'vendor',
  lastStatus: 'ok', lastLatencyMs: 420, lastCountry: 'US', lastBlacklisted: false,
  lastCheckedAt: new Date(NOW - DAY), lastIsp: 'AS7922 Comcast Cable Communications', ...over
});
const goodProfile = (over = {}) => ({
  id: 7, systemProxyBehavior: 'PROFILE_PROXY', browserCore: 'Chromium', os: 'Windows', deviceClass: 'desktop',
  webrtc: 'Forward', timezoneType: 'Based on IP', languageType: 'Based on IP', locationType: 'Based on IP',
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  launchCount: 12, createdAt: new Date(NOW - 40 * DAY), ...over
});
const ctx = (over = {}) => ({ proxy: goodProxy(), sharedWith: 0, settings: { blockThirdPartyCookies: false }, hostOs: 'Windows', cookieBytes: 300 * 1024, now: NOW, ...over });
const factor = (r, key) => r.factors.find((f) => f.key === key);

test('a well set-up profile scores 100 with nothing to fix', () => {
  const r = scoreProfile(goodProfile(), ctx());
  assert.equal(r.score, 100);
  assert.equal(r.level, 'low');
  assert.deepEqual(r.fixes, []);
  assert.ok(r.factors.every((f) => f.status === 'pass'));
});

test('no proxy is a risk with a fix, and the host timezone is then fine', () => {
  const r = scoreProfile(goodProfile({ systemProxyBehavior: 'DIRECT', timezoneType: 'Real' }), ctx({ proxy: null }));
  assert.equal(factor(r, 'proxy').status, 'warn');
  assert.equal(factor(r, 'proxy').fix, 'assign-proxy');
  assert.equal(factor(r, 'timezone').status, 'pass');
  assert.equal(factor(r, 'blocklist'), undefined, 'no proxy, no proxy checks');
});

test('proxy problems sink the score and offer a spare proxy', () => {
  const failed = scoreProfile(goodProfile(), ctx({ proxy: goodProxy({ lastStatus: 'fail', lastError: 'timeout' }) }));
  assert.equal(factor(failed, 'proxyHealth').status, 'fail');
  assert.equal(factor(failed, 'proxyHealth').fix, 'swap-proxy');
  assert.equal(failed.score, 60);

  const listed = scoreProfile(goodProfile(), ctx({ proxy: goodProxy({ lastBlacklisted: true }) }));
  assert.equal(factor(listed, 'blocklist').status, 'fail');

  const free = scoreProfile(goodProfile(), ctx({ proxy: goodProxy({ provider: 'free' }) }));
  assert.equal(factor(free, 'freeProxy').status, 'fail');
  assert.deepEqual(free.fixes, ['swap-proxy']);
});

test('an unchecked or stale proxy asks for a check', () => {
  const never = scoreProfile(goodProfile(), ctx({ proxy: goodProxy({ lastCheckedAt: null, lastBlacklisted: null }) }));
  assert.equal(factor(never, 'proxyHealth').fix, 'check-proxy');
  assert.equal(factor(never, 'proxyHealth').params.never, true);
  assert.equal(factor(never, 'blocklist').status, 'warn');

  const stale = scoreProfile(goodProfile(), ctx({ proxy: goodProxy({ lastCheckedAt: new Date(NOW - 10 * DAY) }) }));
  assert.equal(factor(stale, 'proxyHealth').params.days, 10);
});

test('datacenter IPs are flagged from the ISP, but a vendor label wins', () => {
  assert.equal(ipTypeOf({ lastIsp: 'AS16509 Amazon.com, Inc.' }), 'datacenter');
  assert.equal(ipTypeOf({ lastIsp: 'AS24940 Hetzner Online GmbH' }), 'datacenter');
  assert.equal(ipTypeOf({ lastIsp: 'AS7922 Comcast Cable Communications' }), 'residential');
  assert.equal(ipTypeOf({ lastIsp: '' }), null);
  assert.equal(ipTypeOf({ name: 'CatProxies • Datacenter', lastIsp: 'Comcast' }), 'datacenter');
  assert.equal(ipTypeOf({ name: 'Proxy-Seller • Residential', lastIsp: 'Amazon' }), 'residential');

  const dc = scoreProfile(goodProfile(), ctx({ proxy: goodProxy({ name: 'My proxy', lastIsp: 'AS14061 DigitalOcean, LLC' }) }));
  assert.equal(factor(dc, 'ipType').status, 'warn');
  assert.equal(factor(dc, 'ipType').params.isp, 'DigitalOcean, LLC');
});

test('sharing a sticky proxy links profiles; a rotating gateway does not', () => {
  assert.equal(factor(scoreProfile(goodProfile(), ctx({ sharedWith: 1 })), 'sharedProxy').status, 'warn');
  assert.equal(factor(scoreProfile(goodProfile(), ctx({ sharedWith: 4 })), 'sharedProxy').status, 'fail');
  const rotating = scoreProfile(goodProfile(), ctx({ sharedWith: 4, proxy: goodProxy({ name: 'Gateway rotating US' }) }));
  assert.equal(factor(rotating, 'sharedProxy'), undefined);
});

test('timezone, language, location and WebRTC must agree with the proxy', () => {
  const r = scoreProfile(goodProfile({ timezoneType: 'Real', languageType: 'Custom', languageCustom: 'de-DE', locationType: 'Custom', webrtc: 'Real' }), ctx());
  assert.equal(factor(r, 'timezone').status, 'fail');
  assert.equal(factor(r, 'timezone').fix, 'tz-auto');
  assert.deepEqual(factor(r, 'language').params, { region: 'DE', country: 'US' });
  assert.equal(factor(r, 'geolocation').fix, 'geo-auto');
  assert.equal(factor(r, 'webrtc').status, 'fail');
  assert.equal(r.factors[0].status, 'fail', 'the worst factors come first');

  const sameRegion = scoreProfile(goodProfile({ languageType: 'Custom', languageCustom: 'en-US' }), ctx());
  assert.equal(factor(sameRegion, 'language').status, 'pass');
  assert.equal(factor(scoreProfile(goodProfile({ webrtc: 'Disabled' }), ctx()), 'webrtc').status, 'warn');
});

test('blocked third-party cookies count for Chromium only', () => {
  const chrome = scoreProfile(goodProfile(), ctx({ settings: { blockThirdPartyCookies: true } }));
  assert.equal(factor(chrome, 'thirdPartyCookies').fix, 'allow-3p-cookies');
  const firefox = scoreProfile(goodProfile({ browserCore: 'Firefox' }), ctx({ settings: { blockThirdPartyCookies: true } }));
  assert.equal(factor(firefox, 'thirdPartyCookies'), undefined);
});

test('little browsing history suggests a warm-up', () => {
  assert.equal(factor(scoreProfile(goodProfile(), ctx({ cookieBytes: 24 * 1024 })), 'history').fix, 'warm-up');
  assert.equal(factor(scoreProfile(goodProfile({ browserCore: 'Firefox' }), ctx({ cookieBytes: 98304 })), 'history').status, 'warn');
  assert.equal(factor(scoreProfile(goodProfile({ browserCore: 'Firefox' }), ctx({ cookieBytes: 400 * 1024 })), 'history').status, 'pass');
  assert.equal(factor(scoreProfile(goodProfile({ launchCount: 5 }), ctx({ cookieBytes: null })), 'history').status, 'pass');
  assert.equal(factor(scoreProfile(goodProfile({ launchCount: 0 }), ctx({ cookieBytes: null })), 'history').status, 'warn');
});

test('three warm-ups count as browsing history, and the text can say how many', () => {
  const thin = ctx({ cookieBytes: 24 * 1024 });
  assert.equal(factor(scoreProfile(goodProfile({ launchCount: 0 }), { ...thin, warmRuns: 2 }), 'history').status, 'warn');
  const warmed = factor(scoreProfile(goodProfile({ launchCount: 0 }), { ...thin, warmRuns: 3 }), 'history');
  assert.equal(warmed.status, 'pass');
  assert.equal(warmed.fix, null);
  assert.equal(warmed.params.warmRuns, 3);
  assert.equal(scoreProfile(goodProfile(), { ...thin, warmRuns: 5 }).score, 100);
});

test('device and OS mismatches are advice only, never an automatic change', () => {
  const r = scoreProfile(goodProfile({ os: 'macOS' }), ctx());
  assert.equal(factor(r, 'device').status, 'fail', 'Direct3D on macOS');
  assert.equal(factor(r, 'device').fix, null);
  assert.equal(factor(r, 'osMismatch').fix, null);
  assert.equal(factor(scoreProfile(goodProfile({ os: 'Android', deviceClass: 'mobile', webglRenderer: 'Adreno (TM) 730' }), ctx()), 'osMismatch'), undefined);
});

test('the score never drops below 0 and each fix is listed once', () => {
  const r = scoreProfile(
    goodProfile({ timezoneType: 'Real', webrtc: 'Real', os: 'macOS', launchCount: 0 }),
    ctx({ proxy: goodProxy({ lastStatus: 'fail', lastBlacklisted: true, provider: 'free', lastIsp: 'OVH SAS' }), sharedWith: 5, cookieBytes: 0, settings: { blockThirdPartyCookies: true } })
  );
  assert.equal(r.score, 0);
  assert.equal(r.level, 'veryHigh');
  assert.equal(new Set(r.fixes).size, r.fixes.length);
});

test('a spare proxy is working, clean, unused and close to the old one', () => {
  const current = goodProxy({ id: 1, lastCountry: 'US' });
  const pool = [
    goodProxy({ id: 2, lastCountry: 'DE', lastLatencyMs: 100 }),
    goodProxy({ id: 3, lastCountry: 'US', lastLatencyMs: 900, lastIsp: 'Amazon' , name: 'x' }),
    goodProxy({ id: 4, lastCountry: 'US', lastLatencyMs: 700 }),
    goodProxy({ id: 5, lastCountry: 'US', lastLatencyMs: 50, lastStatus: 'fail' }),
    goodProxy({ id: 6, lastCountry: 'US', lastLatencyMs: 50, lastBlacklisted: true }),
    goodProxy({ id: 7, lastCountry: 'US', lastLatencyMs: 50, provider: 'free' }),
    current
  ];
  assert.equal(pickReplacementProxy(pool, current).id, 4, 'same country, residential, then fastest');
  assert.equal(pickReplacementProxy([goodProxy({ id: 2, lastCountry: 'DE' })], current).id, 2, 'any country beats none');
  assert.equal(pickReplacementProxy([current], current), null);
  assert.equal(pickReplacementProxy(pool.slice(0, 1), null).id, 2);
});

test('a proxy swap must lower the risk, never raise it', () => {
  const shared = ctx({ sharedWith: 1 });
  const datacenterOnly = [goodProxy({ id: 9, name: 'Spare', lastIsp: 'AS16509 Amazon.com, Inc.' })];
  assert.equal(bestReplacement(goodProfile(), shared, datacenterOnly), null, 'a datacenter IP is worse than sharing a home one');
  const best = bestReplacement(goodProfile(), shared, [...datacenterOnly, goodProxy({ id: 10, name: 'Home spare' })]);
  assert.equal(best.proxy.id, 10);
  assert.ok(best.score > scoreProfile(goodProfile(), shared).score);
  assert.deepEqual(best.profileFields, {});
});

test('a first proxy also makes the timezone follow it', () => {
  const direct = goodProfile({ systemProxyBehavior: 'DIRECT', timezoneType: 'Real' });
  const best = bestReplacement(direct, ctx({ proxy: null }), [goodProxy({ id: 11, name: 'Home spare' })]);
  assert.equal(best.proxy.id, 11);
  assert.deepEqual(best.profileFields, { timezoneType: 'Based on IP' });
});

test('a hand-set language cannot be judged before the proxy country is known', () => {
  const r = scoreProfile(goodProfile({ languageType: 'Custom', languageCustom: 'de-DE' }), ctx({ proxy: goodProxy({ lastCountry: null }) }));
  assert.equal(factor(r, 'language').status, 'warn');
  assert.equal(factor(r, 'language').params.unverified, true);
  assert.equal(factor(r, 'language').fix, 'lang-auto');
});

test('profile fixes change only the matching setting', () => {
  assert.deepEqual(PROFILE_FIELD_FIXES['tz-auto'], { timezoneType: 'Based on IP' });
  assert.deepEqual(PROFILE_FIELD_FIXES['webrtc-safe'], { webrtc: 'Forward' });
  assert.ok(Object.isFrozen(PROFILE_FIELD_FIXES));
});

test('the handlers are registered and gated', () => {
  assert.match(IPC, /PROFILE_CAPTCHA_SCORES: 'profile:captcha-scores'/);
  assert.match(IPC, /registerHandler\(CHANNELS\.PROFILE_CAPTCHA_SCORES, captchaScores\)/);
  assert.match(IPC, /registerHandler\(CHANNELS\.PROFILE_CAPTCHA_FIX, captchaFix\)/);
  const scores = IPC.slice(IPC.indexOf('async function captchaContexts('), IPC.indexOf('async function captchaFix('));
  assert.match(scores, /partitionAccessibleProfileIds\(ids\)/, 'only profiles the member may see');
  assert.match(scores, /deletedAt: null/, 'trashed profiles do not count as sharing a proxy');
  const fix = IPC.slice(IPC.indexOf('async function captchaFix('), IPC.indexOf('// ---- Proxy health: persistence and scheduler ----'));
  assert.ok(fix.indexOf("requireOwnerOrSuper(") < fix.indexOf('setGlobalSettings('), 'the workspace cookie switch is Owner-only');
  assert.ok(fix.indexOf("requirePermission('profiles.edit')") < fix.indexOf('db.profile.update'), 'edits need the edit permission');
  assert.match(fix, /assertCanAccessProfile\(id, \{ requireEdit: true \}\)/);
  assert.match(fix, /assertCanAccessProxy\(profile\.proxy\.id\)/);
  assert.match(fix, /captchaScore\.bestReplacement\(profile, ctx, candidates\)/, 'a swap is scored before it happens');
  assert.match(fix, /scopedProxyWhere\(\{ lastStatus: 'ok', profiles: \{ none: \{\} \} \}\)/, 'a spare comes from this member\'s unused proxies');
});

test('the proxy check stores the exit network owner', () => {
  assert.match(IPC, /if \(result\.success && result\.isp\) data\.lastIsp = /);
  assert.match(fs.readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8'), /lastIsp\s+String\?/);
  const sql = fs.readFileSync(path.join(ROOT, 'prisma/migrations/20261103000000_proxy_last_isp/migration.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE "Proxy" ADD COLUMN "lastIsp" TEXT;/);
});

test('every factor, status and fix has English and Spanish text', () => {
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/i18n/locales/en/captcha.json'), 'utf8'));
  const es = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/i18n/locales/es/captcha.json'), 'utf8'));
  const keys = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${pre}${k}.`) : [`${pre}${k}`]));
  assert.deepEqual(keys(es).sort(), keys(en).sort(), 'Spanish has exactly the English keys');
  const has = (k) => k.split('.').reduce((o, part) => (o ? o[part] : undefined), en) !== undefined;

  const scenarios = [
    [goodProfile(), ctx()],
    [goodProfile({ systemProxyBehavior: 'DIRECT' }), ctx({ proxy: null })],
    [goodProfile({ timezoneType: 'Real', languageType: 'Custom', languageCustom: 'de-DE', locationType: 'Custom', webrtc: 'Real', os: 'macOS', launchCount: 0 }),
      ctx({ proxy: goodProxy({ lastStatus: 'fail', lastBlacklisted: true, provider: 'free', lastIsp: 'OVH' }), sharedWith: 2, cookieBytes: 0, settings: { blockThirdPartyCookies: true } })],
    [goodProfile({ timezoneType: 'Custom', webrtc: 'Disabled', webglRenderer: 'Mali-G78', languageType: 'Custom', languageCustom: 'fr-FR' }), ctx({ proxy: goodProxy({ lastCheckedAt: null, lastBlacklisted: null, lastCountry: null }) })]
  ];
  for (const [p, c] of scenarios) {
    for (const f of scoreProfile(p, c).factors) {
      assert.ok(has(`label.${f.key}`), `label.${f.key}`);
      if (f.key === 'sharedProxy') assert.ok(has('factor.sharedProxy.msg_one') && has('factor.sharedProxy.msg_other'));
      else if (f.key === 'language' && f.params.unverified) assert.ok(has('factor.language.unverified'));
      else if (f.key === 'proxyHealth' && f.status === 'warn') assert.ok(has('factor.proxyHealth.never') && has('factor.proxyHealth.stale'));
      else assert.ok(has(`factor.${f.key}.${f.status}`), `factor.${f.key}.${f.status}`);
      if (f.fix) assert.ok(has(`fix.${f.fix}`), `fix.${f.fix}`);
    }
  }
});
