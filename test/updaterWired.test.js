'use strict';
// Audit 2 Nov 2026 #9: initAutoUpdater was defined but never called, so no build ever
// checked for updates and "Check for updates" always said "not active". It is now
// started from main.js in the background. The safety gates are unchanged: the updater
// only goes live on a packaged, Authenticode-signed build with an update feed; otherwise
// it records WHY it is off, without nagging the user with a banner.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.js'), 'utf8');
const UPD = fs.readFileSync(path.join(ROOT, 'src', 'main', 'updater.js'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'pages', 'DashboardPage.jsx'), 'utf8');

test('main.js starts the updater after the window, in the background', () => {
  const win = MAIN.indexOf('createMainWindow();\r\n') >= 0 ? MAIN.indexOf('createMainWindow();\r\n') : MAIN.indexOf('createMainWindow();\n');
  const init = MAIN.indexOf("require('./updater').initAutoUpdater(mainWindow)");
  assert.ok(win > 0 && init > win, 'initAutoUpdater is called after the window is created');
  assert.match(MAIN, /setTimeout\(\(\) => \{\s*require\('\.\/updater'\)\.initAutoUpdater\(mainWindow\)\s*\.catch\(/);
});

test('the signature check no longer blocks the main process', () => {
  assert.ok(!/execFileSync\(/.test(UPD), 'no synchronous PowerShell call');
  assert.match(UPD, /async function initAutoUpdater\(mainWindow\)/);
  assert.match(UPD, /if \(!\(await isSignedBuild\(\)\)\) \{/);
});

test('every safety gate is still in place, in order', () => {
  const body = /async function initAutoUpdater\(mainWindow\) \{[\s\S]*?\r?\n\}/.exec(UPD)[0];
  const packaged = body.indexOf("if (!app.isPackaged)");
  const signed = body.indexOf('await isSignedBuild()');
  const feed = body.indexOf('const feed = resolveFeed();');
  const load = body.indexOf("require('electron-updater')");
  assert.ok(packaged > 0 && signed > packaged && feed > signed && load > feed, 'packaged -> signed -> feed -> load');
  assert.match(body, /disable\('unsigned'/);
  assert.match(body, /disable\('no-feed'/);
  assert.match(UPD, /if \(!\/\^https:\\\/\\\/\/i\.test\(url\)\)/, 'https-only feed check kept');
});

test('a disabled updater shows no banner but explains itself on "Check for updates"', () => {
  assert.match(UPD, /sendEvent\(\{ status: 'disabled', disabledReason: reason, error: null, message \}\);/);
  assert.match(UPD, /error: lastState\.message \|\| 'Automatic updates are not enabled in this build\.'/);
  assert.match(DASH, /const actionable = status === 'available' \|\| status === 'downloading' \|\| status === 'downloaded';/);
});
