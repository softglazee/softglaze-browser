'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const wa = require('../src/main/warmAutopilot');
const { scoreProfile, WARMED_RUNS } = require('../src/main/captchaScore');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const IPC = read('src/main/ipcHandlers.js');
const PRELOAD = read('src/preload/preload.js');
const API = read('src/renderer/lib/softglazeApi.js');
const CARD = read('src/renderer/components/WarmAutopilotCard.jsx');
const BADGE = read('src/renderer/components/ProfileAgeBadge.jsx');
const PROFILES_PAGE = read('src/renderer/pages/ProfilesPage.jsx');
const AUTOMATION_PAGE = read('src/renderer/pages/AutomationPage.jsx');
const fnBody = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\(([\\s\\S]*?)\\r?\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};
const json = (rel) => JSON.parse(read(rel));
const keys = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${pre}${k}.`) : [`${pre}${k}`]));
const get = (o, k) => k.split('.').reduce((x, part) => (x ? x[part] : undefined), o);

const HOUR = 60 * 60 * 1000;
const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime(); // local noon
const on = (over = {}) => wa.normalizeConfig({ enabled: true, ...over });
const row = (id, over = {}) => ({ id, deletedAt: null, groupId: null, ...over });
const warmedAgo = (ms, runs = 1) => ({ runs, lastAt: new Date(NOW - ms).toISOString() });

// ---- Settings ----

test('a missing or empty setting gives the documented defaults', () => {
  for (const input of [null, undefined, {}, 'junk', []]) {
    assert.deepEqual(wa.normalizeConfig(input), {
      enabled: false, target: 'all', groupId: null, runsPerDay: 2, sitesPerRun: 4,
      startHour: 9, endHour: 22, headless: true, maxConcurrent: 1, ownerMemberId: null
    });
  }
});

test('numbers are clamped to their ranges and junk falls back to the default', () => {
  const low = wa.normalizeConfig({ runsPerDay: 0, sitesPerRun: 1, maxConcurrent: 0, startHour: -3, endHour: 0 });
  assert.equal(low.runsPerDay, 1);
  assert.equal(low.sitesPerRun, 2);
  assert.equal(low.maxConcurrent, 1);
  assert.equal(low.startHour, 0);
  assert.equal(low.endHour, 1);
  const high = wa.normalizeConfig({ runsPerDay: 99, sitesPerRun: 50, maxConcurrent: 16, startHour: 30, endHour: 30 });
  assert.equal(high.runsPerDay, 6);
  assert.equal(high.sitesPerRun, 10);
  assert.equal(high.maxConcurrent, 4);
  assert.equal(high.startHour, 23);
  assert.equal(high.endHour, 24);
  const junk = wa.normalizeConfig({ runsPerDay: 'lots', sitesPerRun: null, maxConcurrent: {}, startHour: 'x' });
  assert.equal(junk.runsPerDay, 2);
  assert.equal(junk.sitesPerRun, 4);
  assert.equal(junk.maxConcurrent, 1);
  assert.equal(junk.startHour, 9);
  assert.equal(wa.normalizeConfig({ runsPerDay: '3' }).runsPerDay, 3);
});

test('only a real true turns it on, and headless stays on unless switched off', () => {
  assert.equal(wa.normalizeConfig({ enabled: 'true' }).enabled, false);
  assert.equal(wa.normalizeConfig({ enabled: 1 }).enabled, false);
  assert.equal(wa.normalizeConfig({ enabled: true }).enabled, true);
  assert.equal(wa.normalizeConfig({ headless: 'no' }).headless, true);
  assert.equal(wa.normalizeConfig({ headless: false }).headless, false);
});

test('a group id is kept only for the group target, and a group target needs one', () => {
  assert.equal(wa.normalizeConfig({ target: 'all', groupId: 5 }).groupId, null);
  assert.equal(wa.normalizeConfig({ target: 'everything', groupId: 5 }).target, 'all');
  assert.equal(wa.normalizeConfig({ target: 'group', groupId: '7' }).groupId, 7);
  assert.equal(wa.normalizeConfig({ target: 'group', groupId: -2 }).groupId, null);
  assert.equal(wa.configProblem(wa.normalizeConfig({ target: 'group' })), 'group-required');
  assert.equal(wa.configProblem(wa.normalizeConfig({ target: 'group', groupId: 3 })), null);
  assert.equal(wa.configProblem(wa.normalizeConfig({})), null);
});

test('the owner id survives normalising, the Super Admin id included', () => {
  assert.equal(wa.normalizeConfig({ ownerMemberId: 4 }).ownerMemberId, 4);
  assert.equal(wa.normalizeConfig({ ownerMemberId: -1 }).ownerMemberId, -1);
  assert.equal(wa.normalizeConfig({ ownerMemberId: null }).ownerMemberId, null);
});

// ---- Active hours ----

test('active hours: the end is exclusive, a late end wraps past midnight, equal hours mean all day', () => {
  const day = on({ startHour: 9, endHour: 22 });
  assert.deepEqual([8, 9, 21, 22, 23].map((h) => wa.inWindow(h, day)), [false, true, true, false, false]);
  const night = on({ startHour: 22, endHour: 6 });
  assert.deepEqual([21, 22, 23, 0, 5, 6, 12].map((h) => wa.inWindow(h, night)), [false, true, true, true, true, false, false]);
  const always = on({ startHour: 7, endHour: 7 });
  assert.ok([0, 7, 13, 23].every((h) => wa.inWindow(h, always)));
  assert.equal(wa.inWindow(23, on({ startHour: 0, endHour: 24 })), true);
});

// ---- Who is due ----

test('a profile is due once its last warm-up is older than a day divided by the runs per day', () => {
  assert.equal(wa.intervalMs(2), 12 * HOUR);
  assert.equal(wa.intervalMs(6), 4 * HOUR);
  const cfg = on({ runsPerDay: 2 });
  const stats = { 1: warmedAgo(11 * HOUR), 2: warmedAgo(13 * HOUR) };
  assert.deepEqual(wa.pickDue([row(1), row(2), row(3)], { cfg, stats, now: NOW, hour: 12, slots: 4 }), [3, 2]);
  const often = on({ runsPerDay: 3 }); // every 8 hours
  assert.deepEqual(wa.pickDue([row(1), row(2)], { cfg: often, stats, now: NOW, hour: 12, slots: 4 }), [2, 1]);
});

test('never-warmed profiles go first, then the longest since a warm-up, and slots cap the batch', () => {
  const cfg = on({ runsPerDay: 1 });
  const stats = { 1: warmedAgo(30 * HOUR), 2: warmedAgo(50 * HOUR), 3: warmedAgo(40 * HOUR) };
  const rows = [row(1), row(2), row(3), row(4)];
  assert.deepEqual(wa.pickDue(rows, { cfg, stats, now: NOW, hour: 12, slots: 4 }), [4, 2, 3, 1]);
  assert.deepEqual(wa.pickDue(rows, { cfg, stats, now: NOW, hour: 12, slots: 2 }), [4, 2]);
  assert.deepEqual(wa.pickDue(rows, { cfg, stats, now: NOW, hour: 12, slots: 0 }), []);
});

test('nothing is picked when off or outside the active hours', () => {
  const rows = [row(1)];
  assert.deepEqual(wa.pickDue(rows, { cfg: wa.normalizeConfig({ enabled: false }), now: NOW, hour: 12 }), []);
  assert.deepEqual(wa.pickDue(rows, { cfg: on({ startHour: 9, endHour: 22 }), now: NOW, hour: 23 }), []);
  assert.deepEqual(wa.pickDue(rows, { cfg: on({ startHour: 9, endHour: 22 }), now: NOW, hour: 9 }), [1]);
});

test('open, locked, busy, trashed, retrying and out-of-group profiles are skipped', () => {
  const rows = [row(1), row(2), row(3, { deletedAt: new Date(NOW) }), row(4, { groupId: 9 }), row(5), row(6, { groupId: 8 })];
  const busy = new Set([2]);
  const retryAt = new Map([[5, NOW + HOUR], [1, NOW - 1]]);
  assert.deepEqual(wa.pickDue(rows, { cfg: on(), now: NOW, hour: 12, busy, retryAt, slots: 9 }), [1, 4, 6]);
  const group = on({ target: 'group', groupId: 9 });
  assert.deepEqual(wa.pickDue(rows, { cfg: group, now: NOW, hour: 12, busy, retryAt, slots: 9 }), [4]);
});

// ---- Status line ----

test('the next run is the earliest due time, moved into the active hours', () => {
  const cfg = on({ runsPerDay: 2, startHour: 9, endHour: 22 });
  const stats = { 1: warmedAgo(2 * HOUR), 2: warmedAgo(5 * HOUR) };
  assert.equal(wa.nextRunAt([row(1), row(2)], { cfg, stats, now: NOW }), NOW + 7 * HOUR, 'profile 2 is due at 19:00');
  assert.equal(wa.nextRunAt([row(1), row(3)], { cfg, stats, now: NOW }), NOW, 'a never-warmed profile is due now');
  const late = { 1: warmedAgo(0) }; // just warmed at noon: due at midnight, outside the hours
  const next = wa.nextRunAt([row(1)], { cfg, stats: late, now: NOW });
  assert.equal(next, new Date(2026, 10, 4, 9, 0, 0).getTime(), 'waits for 09:00 the next day');
  assert.equal(wa.nextRunAt([row(3)], { cfg, now: NOW, retryAt: new Map([[3, NOW + HOUR]]) }), NOW + HOUR, 'a failed profile waits for its retry');
  assert.equal(wa.nextRunAt([], { cfg, now: NOW }), null);
  assert.equal(wa.nextRunAt([row(1)], { cfg: wa.normalizeConfig({}), now: NOW }), null);
});

test('stats count each successful warm-up without touching the old object', () => {
  const before = { 7: { runs: 2, lastAt: '2026-11-01T10:00:00.000Z' } };
  const after = wa.withWarmRun(before, 7, NOW);
  assert.deepEqual(after[7], { runs: 3, lastAt: new Date(NOW).toISOString() });
  assert.equal(before[7].runs, 2);
  assert.deepEqual(wa.withWarmRun(null, 8, NOW)['8'], { runs: 1, lastAt: new Date(NOW).toISOString() });
  assert.deepEqual(wa.withWarmRun([], 8, NOW)['8'].runs, 1);
});

test('warmed today counts profiles whose last warm-up was after local midnight', () => {
  const midnight = new Date(2026, 10, 3, 0, 0, 0).getTime();
  const stats = { 1: { runs: 1, lastAt: new Date(midnight + 1000).toISOString() }, 2: { runs: 4, lastAt: new Date(midnight - 1000).toISOString() }, 3: { runs: 1, lastAt: 'bad' } };
  assert.equal(wa.warmedToday(stats, [1, 2, 3, 4], NOW), 1);
});

test('each run visits the asked number of distinct suggested sites with a varied dwell', () => {
  const sites = Array.from({ length: 10 }, (_, i) => ({ url: `https://s${i}.example/`, label: `s${i}`, seconds: 30 }));
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const picked = wa.pickSites(sites, 4, rng);
  assert.equal(picked.length, 4);
  assert.equal(new Set(picked.map((s) => s.url)).size, 4);
  assert.ok(picked.every((s) => sites.some((x) => x.url === s.url)));
  assert.ok(picked.every((s) => s.seconds >= 20 && s.seconds <= 45));
  assert.equal(wa.pickSites(sites, 50, rng).length, 10);
  assert.equal(sites[0].seconds, 30, 'the default list is not changed');
});

// ---- Handlers, gates and wiring ----

test('the settings handlers are gated and owned like the macro schedule', () => {
  assert.match(fnBody('getWarmAutopilot'), /await requirePermission\('automation\.run'\);/);
  const set = fnBody('setWarmAutopilot');
  assert.match(set, /await requirePermission\('automation\.run'\);/);
  assert.match(set, /if \(existing\) await assertCanChangeWarmAutopilot\(existing\.ownerMemberId\);/);
  assert.match(set, /ownerMemberId: actingMemberId\(\) \};/, 'the caller becomes the owner');
  assert.match(set, /warmAutopilot\.configProblem\(cfg\)/);
  assert.match(set, /group\.findUnique\(\{ where: \{ id: cfg\.groupId \}/, 'the group must exist');
  assert.ok(set.indexOf('assertCanChangeWarmAutopilot') < set.indexOf("writeSetting('warmAutopilot'"), 'checked before it is stored');
  const who = fnBody('assertCanChangeWarmAutopilot');
  assert.match(who, /await assertCanControlRun\(ownerMemberId\)/);
  assert.match(who, /await requireOwnerOrSuper\(/, 'only the workspace Owner takes over from a deleted member');
});

test('every tick is checked against the member who turned the autopilot on', () => {
  const scope = fnBody('warmAutopilotProfiles');
  assert.match(scope, /deletedAt: null/);
  assert.match(scope, /owner\.status === 'banned' \|\| owner\.status === 'suspended'/);
  assert.match(scope, /effectivePermissions\(owner\)\.actions\['automation\.run'\] === false/);
  assert.match(scope, /permissions\.profileRowAccessible\(visible, r, false\)/);
  const tick = fnBody('runWarmAutopilotTick');
  assert.match(tick, /const \{ rows, problem \} = await warmAutopilotProfiles\(cfg\);/);
  assert.match(tick, /warmAutopilot\.pickDue\(rows, \{ cfg, stats, now, busy, retryAt: warmAutopilotRetryAt, slots \}\)/);
  assert.match(tick, /const slots = cfg\.maxConcurrent - autopilotWarmerRuns\(\)\.length;/);
});

test('ticks never overlap', () => {
  const tick = fnBody('runWarmAutopilotTick');
  assert.match(tick, /if \(warmAutopilotBusy\) return;\s*warmAutopilotBusy = true;/);
  assert.match(tick, /finally \{\s*warmAutopilotBusy = false;/);
});

test('profiles in use anywhere else are left alone', () => {
  const busy = fnBody('profilesBusyForWarmup');
  for (const src of ['listAllSessions()', 'profileLocks.keys()', 'profileLaunchesInFlight.keys()', 'warmerRuns.values()', 'macroRuns.values()', 'profilesInParallelRun()', 'macroScheduleBusy']) {
    assert.ok(busy.includes(src), src);
  }
  assert.match(fnBody('runMacroOnProfile'), /const control = \{[^}]*\bprofileId\b[^}]*\};/, 'a macro run records its profile');
  assert.match(fnBody('startAutopilotWarm'), /skipOpen: true/, 'a browser opened after the pick is not driven');
  assert.match(fnBody('warmOneProfile'), /if \(alreadyOpen && opts\.skipOpen\)/);
});

test('the Cookie Warmer still streams to its renderer, and autopilot runs stay out of its panel', () => {
  const start = fnBody('startWarmer');
  assert.match(start, /event\.sender\.send\(CHANNELS\.AUTOMATION_WARMER_PROGRESS, frame\)/);
  assert.match(start, /return \{ started: true, runId: run\.id, profileIds: ids, sites: sites\.length, loop: opts\.loop, concurrency \};/);
  const begin = fnBody('beginWarmerRun');
  assert.match(begin, /if \(push\) push\(enriched\);/);
  assert.match(begin, /if \(res && res\.loaded > 0\) await recordWarmRun\(ids\[i\]\);/);
  assert.match(begin, /if \(!autopilot\) await appendWarmerHistory\(\{ type: 'warmer', runId, profileIds: ids, sites: sites\.length, status: 'running'/);
  assert.match(fnBody('listActiveWarmers'), /\.filter\(\(r\) => !r\.autopilot\)/);
  assert.match(fnBody('stopWarmer'), /\[\.\.\.warmerRuns\.values\(\)\]\.filter\(\(r\) => !r\.autopilot\)/);
  assert.match(fnBody('recordWarmRun'), /_warmStatsChain = _warmStatsChain\.then\(/, 'stat writes are serialised');
});

test('turning the autopilot off stops its warm-ups, and the timer starts and stops with the app', () => {
  assert.match(fnBody('setWarmAutopilot'), /if \(!cfg\.enabled\) for \(const run of autopilotWarmerRuns\(\)\) run\.aborted = true;/);
  assert.match(IPC, /startMacroScheduler\(mcfg\.everyMinutes\);\r?\n\s*\} catch \(e\) \{ \/\* ignore \*\/ \}\r?\n\s*startWarmAutopilotTimer\(\);/);
  assert.match(fnBody('shutdownIpcHandlers'), /stopWarmAutopilotTimer\(\);/);
  assert.match(fnBody('startWarmAutopilotTimer'), /WARM_AUTOPILOT_TICK_MS/);
  assert.match(IPC, /const WARM_AUTOPILOT_TICK_MS = 60 \* 1000;/);
});

test('warm-up stats are only returned for profiles the member may see', () => {
  const stats = fnBody('getWarmStats');
  assert.match(stats, /const \{ allowed \} = await partitionAccessibleProfileIds\(ids\);/);
  assert.match(stats, /for \(const id of allowed\)/);
});

test('the channels are wired through main, preload and the renderer API', () => {
  const channels = {
    PROFILE_WARM_STATS: ['profile:warm-stats', 'getWarmStats'],
    AUTOMATION_WARM_AUTOPILOT_GET: ['automation:warm-autopilot-get', 'getWarmAutopilot'],
    AUTOMATION_WARM_AUTOPILOT_SET: ['automation:warm-autopilot-set', 'setWarmAutopilot']
  };
  for (const [key, [value, fn]] of Object.entries(channels)) {
    assert.ok(IPC.includes(`${key}: '${value}'`), `main ${key}`);
    assert.ok(PRELOAD.includes(`${key}: '${value}'`), `preload ${key}`);
    assert.ok(IPC.includes(`registerHandler(CHANNELS.${key}, ${fn});`), `registered ${key}`);
  }
  assert.match(PRELOAD, /warmStats: \(ids\) => invoke\(CHANNELS\.PROFILE_WARM_STATS, \{ ids \}\)/);
  assert.match(PRELOAD, /getWarmAutopilot: \(\) => invoke\(CHANNELS\.AUTOMATION_WARM_AUTOPILOT_GET\)/);
  assert.match(PRELOAD, /setWarmAutopilot: \(payload\) => invoke\(CHANNELS\.AUTOMATION_WARM_AUTOPILOT_SET, payload\)/);
  for (const m of ['warmStats: (ids)', 'getWarmAutopilot: ()', 'setWarmAutopilot: (payload)']) assert.ok(API.includes(m), m);
});

test('the Automation page shows the card and the Profiles list loads stats for the rows on screen', () => {
  assert.match(AUTOMATION_PAGE, /import WarmAutopilotCard from '@\/components\/WarmAutopilotCard\.jsx';/);
  assert.match(AUTOMATION_PAGE, /<WarmAutopilotCard \/>/);
  assert.match(PROFILES_PAGE, /softglazeApi\.profiles\.warmStats\(pagedIdsKey\.split\(','\)\.map\(Number\)\)/);
  assert.match(PROFILES_PAGE, /<ProfileAgeBadge createdAt=\{p\.createdAt\} stat=\{warmStats\[p\.id\]\} formatAgo=\{relTime\} \/>/);
});

// ---- CAPTCHA history ----

test('three warm-ups count as browsing history in the CAPTCHA score', () => {
  const profile = { browserCore: 'Chromium', launchCount: 0, createdAt: new Date(NOW - 2 * 24 * HOUR), systemProxyBehavior: 'DIRECT' };
  const history = (ctx) => scoreProfile(profile, { now: NOW, cookieBytes: 24 * 1024, ...ctx }).factors.find((f) => f.key === 'history');
  assert.equal(history({}).status, 'warn');
  assert.equal(history({ warmRuns: WARMED_RUNS - 1 }).status, 'warn');
  const warmed = history({ warmRuns: WARMED_RUNS });
  assert.equal(warmed.status, 'pass');
  assert.equal(warmed.params.warmRuns, WARMED_RUNS);
  assert.equal(history({ cookieBytes: 400 * 1024 }).params.warmRuns, undefined, 'a big cookie store passes on its own');
  assert.match(fnBody('captchaContexts'), /warmRuns: warmStats\[r\.id\] \? Number\(warmStats\[r\.id\]\.runs\) \|\| 0 : 0/);
});

test('the renderer uses the same warm-up threshold as the score', async () => {
  const age = await import(pathToFileURL(path.join(ROOT, 'src/renderer/lib/profileAge.mjs')).href);
  assert.equal(age.WARMED_RUNS, WARMED_RUNS);
  assert.equal(age.isWarmed({ runs: WARMED_RUNS }), true);
  assert.equal(age.isWarmed({ runs: WARMED_RUNS - 1 }), false);
  assert.equal(age.isWarmed(undefined), false);
});

test('the age badge reads days, then months, then years', async () => {
  const { ageParts } = await import(pathToFileURL(path.join(ROOT, 'src/renderer/lib/profileAge.mjs')).href);
  const DAY = 24 * HOUR;
  assert.deepEqual(ageParts(new Date(NOW - 2 * HOUR), NOW), { unit: 'd', count: 0, days: 0 });
  assert.deepEqual(ageParts(new Date(NOW - 12 * DAY), NOW), { unit: 'd', count: 12, days: 12 });
  assert.deepEqual(ageParts(new Date(NOW - 59 * DAY), NOW), { unit: 'd', count: 59, days: 59 });
  assert.deepEqual(ageParts(new Date(NOW - 130 * DAY), NOW), { unit: 'mo', count: 4, days: 130 });
  assert.deepEqual(ageParts(new Date(NOW - 800 * DAY), NOW), { unit: 'y', count: 2, days: 800 });
  assert.equal(ageParts(null, NOW), null);
  assert.equal(ageParts('not a date', NOW), null);
  assert.equal(ageParts(new Date(NOW + DAY), NOW).count, 0, 'a clock skew never shows a negative age');
});

// ---- Text ----

test('English and Spanish have the same autopilot, age-badge and history texts', () => {
  const en = json('src/renderer/i18n/locales/en/automation.json').autopilot;
  const es = json('src/renderer/i18n/locales/es/automation.json').autopilot;
  assert.ok(en && es, 'autopilot block in both languages');
  assert.deepEqual(keys(es).sort(), keys(en).sort());

  const used = [...CARD.matchAll(/t\('autopilot\.([\w.-]+)'/g)].map((m) => m[1]);
  assert.ok(used.length > 15);
  for (const k of used) assert.ok(get(en, k) !== undefined, `automation autopilot.${k}`);
  // Every problem code main can report has a message.
  const codes = new Set([...IPC.matchAll(/(?:problem|code): '((?:owner|warm|tick)-[a-z-]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...codes].sort(), ['owner-inactive', 'owner-missing', 'owner-no-permission', 'tick-failed', 'warm-failed']);
  for (const c of codes) assert.ok(en.errors[c] && es.errors[c], `errors.${c}`);

  const pen = json('src/renderer/i18n/locales/en/profiles.json');
  const pes = json('src/renderer/i18n/locales/es/profiles.json');
  for (const k of [...BADGE.matchAll(/'(row\.[a-zA-Z]+)'/g)].map((m) => m[1])) {
    const plural = ['row.createdDaysAgo', 'row.warmedTimes'].includes(k);
    for (const [lang, file] of [['en', pen], ['es', pes]]) {
      if (plural) assert.ok(get(file, `${k}_one`) && get(file, `${k}_other`), `${lang} ${k}_one/_other`);
      else assert.ok(get(file, k), `${lang} ${k}`);
    }
  }

  for (const lang of ['en', 'es']) {
    const c = json(`src/renderer/i18n/locales/${lang}/captcha.json`);
    assert.ok(c.factor.history.warmed_one && c.factor.history.warmed_other, `${lang} captcha factor.history.warmed`);
  }
});
