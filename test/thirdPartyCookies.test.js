'use strict';
// 2 Nov 2026: profiles on the anti-detect engine blocked every third-party cookie.
// Checked live on a fresh profile: fingerprint-chromium (ungoogled-chromium 148)
// defaults profile.cookie_controls_mode to 1 (block third-party), while Chrome for
// Testing 157 - like real Chrome - defaults to 2 (block only in Incognito).
// reCAPTCHA / hCaptcha / Turnstile run in third-party frames and use those cookies to
// score the visitor, so blocked cookies meant harder CAPTCHAs. Every Chromium profile
// now gets Chrome's normal default, unless the workspace turns blocking on. Also checked
// live: after the pref is written, fingerprint-chromium reports 2 (and 1 when blocked).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { cookieControlsModeFor, ensureCookiePolicyPref } = require('../src/main/browserEngine');

const ROOT = path.join(__dirname, '..');
const ENGINE = fs.readFileSync(path.join(ROOT, 'src', 'main', 'browserEngine.js'), 'utf8');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const SETTINGS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'pages', 'SettingsPage.jsx'), 'utf8');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sg-3pc-'));
const readPrefs = async (dir) => JSON.parse(await fsp.readFile(path.join(dir, 'Default', 'Preferences'), 'utf8'));

test('default is Chrome\'s normal mode (2); the workspace switch blocks (1)', () => {
  assert.equal(cookieControlsModeFor({}), 2);
  assert.equal(cookieControlsModeFor(undefined), 2);
  assert.equal(cookieControlsModeFor({ blockThirdPartyCookies: false }), 2);
  assert.equal(cookieControlsModeFor({ blockThirdPartyCookies: true }), 1);
});

test('a new profile gets the pref; an existing Preferences file keeps everything else', async () => {
  const fresh = tmpDir();
  await ensureCookiePolicyPref(fresh, {});
  assert.equal((await readPrefs(fresh)).profile.cookie_controls_mode, 2);

  const existing = tmpDir();
  await fsp.mkdir(path.join(existing, 'Default'), { recursive: true });
  await fsp.writeFile(path.join(existing, 'Default', 'Preferences'), JSON.stringify({ profile: { name: 'Person 1', cookie_controls_mode: 1 }, homepage: 'x' }));
  await ensureCookiePolicyPref(existing, {});
  const p = await readPrefs(existing);
  assert.equal(p.profile.cookie_controls_mode, 2);
  assert.equal(p.profile.name, 'Person 1');
  assert.equal(p.homepage, 'x');
});

test('a Preferences file that does not parse is never overwritten', async () => {
  const dir = tmpDir();
  await fsp.mkdir(path.join(dir, 'Default'), { recursive: true });
  const f = path.join(dir, 'Default', 'Preferences');
  await fsp.writeFile(f, '{"profile": {"name": "half-written');
  await ensureCookiePolicyPref(dir, {});
  assert.equal(await fsp.readFile(f, 'utf8'), '{"profile": {"name": "half-written');
});

test('it runs for every Chromium engine before launch, with a workspace setting and a switch', () => {
  assert.match(ENGINE, /\r?\n  await ensureCookiePolicyPref\(userDataDir, browserSettings\);/);
  const prefs = ENGINE.indexOf('await ensureCookiePolicyPref(userDataDir, browserSettings);');
  const launch = ENGINE.indexOf('browser = await engine.launch(launchOptions);');
  assert.ok(prefs > 0 && prefs < launch);
  assert.match(IPC, /blockThirdPartyCookies: false,/);
  assert.match(SETTINGS, /apply\(\{ browser: \{ blockThirdPartyCookies: v \} \}\)/);
  for (const lng of ['en', 'es']) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lng, 'settingsExtra.json'), 'utf8'));
    const hit = JSON.stringify(j).includes('"blockThirdPartyCookies":{"title"');
    assert.ok(hit, `${lng} has the switch text`);
  }
});
