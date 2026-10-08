'use strict';
// E6 display (7 Oct): a launch whose proxy geo lookup failed now returns
// geoDegraded / geoWarning instead of a silent success. The Profiles page shows it as
// a non-blocking warning for both a single launch and a bulk launch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'pages', 'ProfilesPage.jsx'), 'utf8');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const locale = (l) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', l, 'profiles.json'), 'utf8'));

test('bulk launch forwards geoDegraded in its result and its progress frames', () => {
  const fn = /async function bulkLaunchProfiles\([\s\S]*?\n}\r?\n/.exec(IPC)[0];
  assert.match(fn, /session && session\.geoDegraded \? \{ geoDegraded: true, geoWarning: session\.geoWarning \|\| null \} : \{\}/);
  assert.match(fn, /result\.launched\.push\(\{ id, sessionId: session\.sessionId, \.\.\.geo \}\)/);
  assert.match(fn, /emitBulkLaunchProgress\(\{ phase: 'launched', id, total, done: done \+ 1, ok: true, \.\.\.geo \}\)/);
});

test('single and bulk launches raise a non-blocking warning on the Profiles page', () => {
  const single = /async function handleLaunch\([\s\S]*?\n {2}}\r?\n/.exec(PAGE)[0];
  assert.match(single, /const res = await softglazeApi\.profiles\.launch\(/);
  assert.match(single, /res && res\.geoDegraded/);
  assert.doesNotMatch(single, /setError\([^)]*geo/i, 'a warning, not an error');
  assert.match(PAGE, /if \(p\.ok && p\.geoDegraded && p\.id != null\) setGeoWarnings/);
  assert.match(PAGE, /role="status"[\s\S]{0,200}amber/);
  assert.match(PAGE, /t\('launchWarnings\.geo', \{ name:/);
  assert.match(PAGE, /onClick=\{\(\) => setGeoWarnings\(\{\}\)\}>\{t\('launchWarnings\.dismiss'\)\}/);
});

test('the warning text exists in English and Spanish', () => {
  for (const l of ['en', 'es']) {
    const j = locale(l);
    assert.ok(j.launchWarnings, l);
    assert.match(j.launchWarnings.geo, /\{\{name\}\}/, l);
    assert.ok(j.launchWarnings.dismiss, l);
  }
});
