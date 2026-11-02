'use strict';
// Audit 2 Nov 2026 #10: closing a profile window with its own X (or a script closing it
// over CDP) was reported as a CRASH: a crash toast, crashCount +1, a "restore" offer on
// the next start, and with auto-restart on the profile reopened 1.5 s later. Both
// engines now look at how the browser process ended; exit code 0 is a normal close.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { classifyBrowserExit, waitForProcessExit } = require('../src/main/browserEngine');

const ROOT = path.join(__dirname, '..');
const ENGINE = fs.readFileSync(path.join(ROOT, 'src', 'main', 'browserEngine.js'), 'utf8');
const FF = fs.readFileSync(path.join(ROOT, 'src', 'main', 'firefoxEngine.js'), 'utf8');

test('a normal exit is a close; a bad exit or an unseen end is still a crash', () => {
  assert.equal(classifyBrowserExit({ exit: { code: 0, signal: null } }), 'window-closed');
  assert.equal(classifyBrowserExit({ exit: { code: 1, signal: null } }), 'crash');
  assert.equal(classifyBrowserExit({ exit: { code: -1073741819, signal: null } }), 'crash', '0xC0000005 access violation');
  assert.equal(classifyBrowserExit({ exit: { code: null, signal: 'SIGKILL' } }), 'crash');
  assert.equal(classifyBrowserExit({ exit: null }), 'crash', 'connection lost while the process kept running');
  assert.equal(classifyBrowserExit({ shuttingDown: true, exit: { code: 1 } }), 'shutdown');
  assert.equal(classifyBrowserExit({ intentional: true, exit: null }), 'user');
});

test('waitForProcessExit reads an exit that already happened, a later one, or times out', async () => {
  assert.deepEqual(await waitForProcessExit({ exitCode: 0, signalCode: null }), { code: 0, signal: null });
  const later = new EventEmitter(); later.exitCode = null; later.signalCode = null;
  setTimeout(() => later.emit('exit', 0, null), 20);
  assert.deepEqual(await waitForProcessExit(later, 1000), { code: 0, signal: null });
  const stuck = new EventEmitter(); stuck.exitCode = null; stuck.signalCode = null;
  assert.equal(await waitForProcessExit(stuck, 30), null);
  assert.equal(await waitForProcessExit(null), null);
});

test('Chrome: the disconnect handler classifies by the process exit', () => {
  assert.match(ENGINE, /const reason = classifyBrowserExit\(\{ shuttingDown, intentional, exit \}\);/);
  assert.match(ENGINE, /waitForProcessExit\(sessionProcess, 3000\)\.then\(emit, \(\) => emit\(null\)\);/);
  assert.match(ENGINE, /if \(shuttingDown \|\| intentional\) \{ emit\(null\); return; \}/, 'app shutdown / Stop stay immediate');
  assert.ok(!/let reason = 'crash';\s*if \(shuttingDown\) reason = 'shutdown';/.test(ENGINE), 'the old always-crash default is gone');
});

test('Firefox: exit code reaches the same classifier', () => {
  assert.match(FF, /proc\.on\('exit', \(code, signal\) => onGone\(\{ code, signal \}\)\);/);
  assert.match(FF, /proc\.on\('error', \(\) => onGone\(null\)\);/);
  assert.match(FF, /classifyBrowserExit\(\{ shuttingDown: ffShuttingDown, intentional, exit \}\)/);
});
