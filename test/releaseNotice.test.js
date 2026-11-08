'use strict';
// 1.0.23: the website installer is not code-signed and has no update feed, so updater.js keeps automatic
// updates off ('unsigned' / 'no-feed') and its users never heard about a new version. It now reads
// https://browser.softglaze.com/release.json at start and every 12 hours and shows a Dashboard notice
// with a Download link for a newer version. Nothing is downloaded or installed by the app; the Store
// package, base builds and signed builds with a feed never get the notice.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rn = require('../src/main/releaseNotice');
const updater = require('../src/main/updater');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const UPD = read('src', 'main', 'updater.js');
const IPC = read('src', 'main', 'ipcHandlers.js');
const PRELOAD = read('src', 'preload', 'preload.js');
const API = read('src', 'renderer', 'lib', 'softglazeApi.js');
const DASH = read('src', 'renderer', 'pages', 'DashboardPage.jsx');

const GOOD = {
  version: '1.0.24',
  releasedOn: '2026-11-20',
  url: 'https://browser.softglaze.com/download',
  sha256: 'A'.repeat(64),
  notes: 'Faster free proxy search.'
};
const json = (o) => JSON.stringify(o);
const tick = () => new Promise((r) => setImmediate(r));

// ---- Versions ----

test('versions compare numerically, part by part', () => {
  assert.equal(rn.compareVersions('1.0.24', '1.0.23'), 1);
  assert.equal(rn.compareVersions('1.0.10', '1.0.9'), 1, '10 > 9, not as text');
  assert.equal(rn.compareVersions('1.1.0', '1.0.99'), 1);
  assert.equal(rn.compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(rn.compareVersions('1.0.23', '1.0.23'), 0);
  assert.equal(rn.compareVersions('1.0.22', '1.0.23'), -1);
  for (const bad of ['1.0', 'v1.0.24', '1.0.24-beta', '1.0.24.1', '', null, undefined, 1024, '1..2']) {
    assert.equal(rn.compareVersions(bad, '1.0.23'), null, String(bad));
    assert.equal(rn.isNewer(bad, '1.0.23'), false, String(bad));
  }
  assert.equal(rn.isNewer('1.0.24', '1.0.23'), true);
  assert.equal(rn.isNewer('1.0.23', '1.0.23'), false);
});

// ---- The release file is data only ----

test('a good release file is read, with every field checked', () => {
  assert.deepEqual(rn.parseRelease(json(GOOD)), {
    version: '1.0.24', url: 'https://browser.softglaze.com/download', releasedOn: '2026-11-20',
    sha256: 'a'.repeat(64), notes: 'Faster free proxy search.'
  });
  // Optional fields that are wrong are dropped, not trusted; a BOM is fine.
  assert.deepEqual(rn.parseRelease('\uFEFF' + json({ ...GOOD, releasedOn: 'soon', sha256: 'xyz', notes: 42 })), {
    version: '1.0.24', url: 'https://browser.softglaze.com/download', releasedOn: null, sha256: null, notes: null
  });
  const notes = rn.parseRelease(json({ ...GOOD, notes: 'Line one\nLine two\u0007\u001b[31m' + 'x'.repeat(2000) })).notes;
  assert.ok(notes.startsWith('Line one\nLine two[31m'), 'control characters removed, line breaks kept');
  assert.ok(notes.length <= 500);
});

test('a download link anywhere but https://browser.softglaze.com/ is refused', () => {
  for (const url of [
    'http://browser.softglaze.com/download',
    'https://evil.example/download',
    'https://browser.softglaze.com.evil.example/download',
    'https://evilbrowser.softglaze.com/download',
    'https://softglaze.com/download',
    'https://user:pw@browser.softglaze.com/download',
    'https://browser.softglaze.com:8443/download',
    'https://browser.softglaze.com',
    'javascript:alert(1)',
    'file:///C:/Windows/System32/calc.exe',
    'https://browser.softglaze.com/' + 'a'.repeat(600),
    42, null
  ]) {
    assert.equal(rn.safeDownloadUrl(url), null, String(url));
    assert.equal(rn.parseRelease(json({ ...GOOD, url })), null, String(url));
  }
  assert.equal(rn.safeDownloadUrl('https://browser.softglaze.com/download?from=app'), 'https://browser.softglaze.com/download?from=app');
  // A path that only looks like another host stays on the website.
  assert.equal(new URL(rn.safeDownloadUrl('https://browser.softglaze.com/@evil.example')).hostname, 'browser.softglaze.com');
});

test('an HTML challenge page, non-JSON, odd JSON or a huge answer is ignored', () => {
  const challenge = '<!DOCTYPE html><html><head><title>Checking your browser</title></head><body>Please wait...</body></html>';
  for (const text of [
    challenge, '', '   ', 'null', '[]', json([GOOD]), '"1.0.24"', '{not json', '{}',
    json({ ...GOOD, version: '1.0' }), json({ ...GOOD, version: 'v1.0.24' }), json({ ...GOOD, version: 1.024 }),
    json({ ...GOOD, url: undefined }), json({ ...GOOD, version: undefined }),
    json({ ...GOOD, notes: 'x'.repeat(rn.MAX_BYTES) }),
    undefined, null, 12, Buffer.from(json(GOOD))
  ]) {
    assert.equal(rn.parseRelease(text), null, String(text).slice(0, 60));
  }
});

test('the release file is fetched over https only, from the website', async () => {
  assert.equal(rn.RELEASE_URL, 'https://browser.softglaze.com/release.json');
  assert.equal(rn.CHECK_EVERY_MS, 12 * 60 * 60 * 1000);
  await assert.rejects(rn.fetchReleaseText('http://browser.softglaze.com/release.json'), /https only/);
  await assert.rejects(rn.fetchReleaseText('not a url'), /bad url/);
  const src = read('src', 'main', 'releaseNotice.js');
  // No cookies, no query, no redirects (https.get follows none), a hard deadline and a size cap.
  assert.match(src, /require\('node:https'\)\.get\(u, \{ headers: \{ 'User-Agent': USER_AGENT, Accept: 'application\/json' \} \}/);
  assert.match(src, /timer = setTimeout\(\(\) => fail\(new Error\('timeout'\)\), timeoutMs\);/);
  assert.match(src, /if \(size > maxBytes\) \{ fail\(new Error\('the release file is too large'\)\); return; \}/);
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /Cookie|getVersion|machine|tenantId|licen[cs]e/i, 'nothing about the user or the install is sent');
});

// ---- Who gets the notice ----

test('only the website installer with automatic updates off gets the notice', () => {
  assert.equal(rn.noticeApplies({ channel: 'website', disabledReason: 'unsigned' }), true);
  assert.equal(rn.noticeApplies({ channel: 'website', disabledReason: 'no-feed' }), true);
  for (const reason of ['unsigned', 'no-feed']) {
    assert.equal(rn.noticeApplies({ channel: 'store', disabledReason: reason }), false, `store ${reason}`);
    assert.equal(rn.noticeApplies({ channel: 'base', disabledReason: reason }), false, `base ${reason}`);
  }
  for (const reason of ['store', 'dev', undefined, null, 'active']) {
    assert.equal(rn.noticeApplies({ channel: 'website', disabledReason: reason }), false, `website ${reason}`);
  }
  assert.equal(rn.noticeApplies(), false);
});

test('updater: the notice starts only after the unsigned / no-feed gates, never for the Store or a signed build with a feed', () => {
  const body = /async function initAutoUpdater\(mainWindow\) \{[\s\S]*?\r?\n\}/.exec(UPD)[0];
  assert.match(body, /disable\('unsigned', [^\n]+\n\s*startReleaseNotice\('unsigned'\);\r?\n\s*return;/);
  assert.match(body, /disable\('no-feed', [^\n]+\n\s*startReleaseNotice\('no-feed'\);\r?\n\s*return;/);
  assert.equal((body.match(/startReleaseNotice\(/g) || []).length, 2, 'not on the store, dev or signed-with-feed paths');
  assert.ok(body.indexOf("disable('store'") < body.indexOf("startReleaseNotice('unsigned')"));
  // Automatic installs stay limited to signed builds: the notice path loads no electron-updater.
  assert.ok(body.indexOf("startReleaseNotice('no-feed')") < body.indexOf("require('electron-updater')"));
  assert.match(UPD, /const channel = deps\.channel \|\| require\('\.\/installChannel'\)\.installChannel\(\);/);
});

// ---- "Later" per version ----

test('"Later" hides that version until restart; a newer version shows again', () => {
  const s = rn.createNoticeState();
  const r24 = rn.parseRelease(json(GOOD));
  const r25 = rn.parseRelease(json({ ...GOOD, version: '1.0.25' }));
  assert.deepEqual(s.offer(r24), { status: 'notice', version: '1.0.24', releaseNotes: GOOD.notes, releasedOn: '2026-11-20', error: null });
  assert.equal(s.downloadUrl(), 'https://browser.softglaze.com/download');
  assert.equal(s.dismiss('1.0.25'), false, 'a stale click for another version changes nothing');
  assert.equal(s.dismiss('1.0.24'), true);
  assert.equal(s.downloadUrl(), null);
  assert.equal(s.offer(r24), null, 'the 12-hour check does not bring it back');
  assert.ok(s.offer(r25), 'a newer version is offered again');
  assert.equal(rn.createNoticeState().offer(r24).version, '1.0.24', 'a restart starts with nothing hidden');
});

test('checks run now and on the interval; a failed or older answer shows nothing', async () => {
  const seen = [];
  let answer = json(GOOD);
  const c = rn.startReleaseChecks({ fetchText: async () => answer, currentVersion: () => '1.0.23', onNotice: (r) => seen.push(r.version) }, { intervalMs: 60 * 60 * 1000 });
  try {
    await c.first;
    assert.deepEqual(seen, ['1.0.24']);
    answer = '<html>Checking your browser</html>';
    assert.equal(await c.checkNow(), null);
    answer = json({ ...GOOD, version: '1.0.23' });
    assert.equal(await c.checkNow(), null, 'the same version is not news');
    answer = json({ ...GOOD, version: '1.0.9' });
    assert.equal(await c.checkNow(), null);
    const failing = rn.startReleaseChecks({ fetchText: async () => { throw new Error('HTTP 503'); }, currentVersion: () => '1.0.23', onNotice: () => seen.push('x') });
    assert.equal(await failing.first, null);
    failing.stop();
    assert.deepEqual(seen, ['1.0.24']);
  } finally {
    c.stop();
  }
});

test('updater state: Store, base and other reasons start nothing; the website build shows, opens and hides the notice', async () => {
  const events = [];
  updater.setEventSink((s) => events.push({ ...s }));
  const fetchText = async () => json(GOOD);
  const currentVersion = () => '1.0.23';
  assert.equal(updater.startReleaseNotice('unsigned', { channel: 'store', fetchText, currentVersion }), false);
  assert.equal(updater.startReleaseNotice('no-feed', { channel: 'base', fetchText, currentVersion }), false);
  assert.equal(updater.startReleaseNotice('store', { channel: 'website', fetchText, currentVersion }), false);
  assert.equal(updater.startReleaseNotice('dev', { channel: 'website', fetchText, currentVersion }), false);
  await tick();
  assert.deepEqual(events, [], 'nothing was shown');
  assert.equal((await updater.openNoticeDownload(async () => { throw new Error('must not open'); })).ok, false);

  assert.equal(updater.startReleaseNotice('unsigned', { channel: 'website', fetchText, currentVersion }), true);
  for (let i = 0; i < 20 && updater.getState().status !== 'notice'; i += 1) await tick();
  const st = updater.getState();
  assert.equal(st.status, 'notice');
  assert.equal(st.version, '1.0.24');
  assert.equal(st.active, false, 'automatic updates stay off');
  assert.equal(st.url, undefined, 'the link stays in main');
  assert.equal(updater.startReleaseNotice('unsigned', { channel: 'website', fetchText, currentVersion }), false, 'started once per run');

  const opened = [];
  assert.deepEqual(await updater.openNoticeDownload(async (u) => { opened.push(u); }), { ok: true });
  assert.deepEqual(opened, ['https://browser.softglaze.com/download']);

  assert.deepEqual(updater.dismissNotice('1.0.24'), { ok: true });
  assert.equal(updater.getState().status, 'disabled');
  assert.equal((await updater.openNoticeDownload(async (u) => opened.push(u))).ok, false);
  assert.equal(opened.length, 1);
  updater.setEventSink(null);
});

// ---- Wiring and text ----

test('IPC: Later carries only the version, Download carries nothing', () => {
  assert.match(IPC, /UPDATER_NOTICE_LATER: 'updater:notice-later',/);
  assert.match(IPC, /UPDATER_NOTICE_DOWNLOAD: 'updater:notice-download'/);
  assert.match(IPC, /registerHandler\(CHANNELS\.UPDATER_NOTICE_LATER, \(payload\) => updater\.dismissNotice\(payload && typeof payload === 'object' \? payload\.version : undefined\)\);/);
  assert.match(IPC, /registerHandler\(CHANNELS\.UPDATER_NOTICE_DOWNLOAD, \(\) => updater\.openNoticeDownload\(\)\);/);
  assert.match(PRELOAD, /UPDATER_NOTICE_LATER: 'updater:notice-later',/);
  assert.match(PRELOAD, /UPDATER_NOTICE_DOWNLOAD: 'updater:notice-download'/);
  assert.match(PRELOAD, /noticeDownload: \(\) => invoke\(CHANNELS\.UPDATER_NOTICE_DOWNLOAD\),/);
  assert.match(API, /noticeLater: \(version\) => getSoftglazeApi\(\)\.updater\.noticeLater\(version\),/);
  assert.match(UPD, /async function openNoticeDownload\(open = \(url\) => shell\.openExternal\(url\)\) \{\s*const url = lastState\.status === 'notice' \? noticeState\.downloadUrl\(\) : null;/);
});

test('Dashboard: the notice reuses the update banner with Download and Later', () => {
  assert.match(DASH, /const notice = status === 'notice' && Boolean\(version\);/);
  assert.match(DASH, /if \(!actionable && !notice && !isError && !isChecking\) return null;/);
  assert.match(DASH, /t\('dashboard\.updateNoticeTitle', \{ version \}\)/);
  assert.match(DASH, /softglazeApi\.updater\.noticeDownload\(\)/);
  assert.match(DASH, /softglazeApi\.updater\.noticeLater\(version\)/);
  for (const lang of ['en', 'es']) {
    const d = JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, 'common.json')).dashboard;
    for (const k of ['updateNoticeTitle', 'updateNoticeDesc', 'updateNoticeDownload', 'updateNoticeLater']) {
      assert.ok(typeof d[k] === 'string' && d[k].trim(), `${lang}.${k}`);
      assert.doesNotMatch(d[k], /[\u2013\u2014]/, `${lang}.${k}: no en or em dash`);
    }
    assert.match(d.updateNoticeTitle, /\{\{version\}\}/);
  }
  const en = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'en', 'common.json')).dashboard;
  assert.equal(en.updateNoticeTitle.replace('{{version}}', '1.0.24'), 'SoftGlaze Browser 1.0.24 is available.');
});
