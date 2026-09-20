'use strict';
// Profiles-page bulk launch queue.
//
// Two defects were reported from a live run with "Queue, 1 at a time" selected:
//   1. Two browsers opened despite a width of 1.
//   2. Stop left every already-open browser running.
//
// Cause of (1): the worker loop read the MODULE-LEVEL `bulkLaunchState`. Starting a
// second run replaced that object, so the first run's workers began reading the new
// run's flags, could never be aborted, and kept launching beside the new pool. Nothing
// guarded against a second run starting while one was active.
// Cause of (2): 'stop' only set `aborted`, which stops launching MORE profiles. It
// never closed the ones the queue had already opened.
//
// ipcHandlers.js pulls in electron and cannot be required from a test, so these are
// source-level invariants, the same approach ipcParity/vendorGateways use.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipcHandlers.js'), 'utf8');

function slice(startMarker, endMarker) {
  const a = SRC.indexOf(startMarker);
  assert.ok(a !== -1, `missing ${startMarker}`);
  const b = SRC.indexOf(endMarker, a);
  assert.ok(b !== -1, `missing ${endMarker} after ${startMarker}`);
  return SRC.slice(a, b);
}

test('a new run aborts a run already in flight', () => {
  const fn = slice('async function bulkLaunchProfiles', 'async function bulkCloseSessions');
  assert.match(
    fn,
    /if \(bulkLaunchState && bulkLaunchState\.active\)[\s\S]{0,200}aborted = true/,
    'starting a queue while one is active must abort the previous run'
  );
});

test('the run owns its state and the worker never reads the module-level binding', () => {
  const fn = slice('async function bulkLaunchProfiles', 'async function bulkCloseSessions');
  const worker = fn.slice(fn.indexOf('const worker = async'), fn.indexOf('if (isQueueMode)'));
  assert.ok(worker.length > 100, 'worker body not found');
  assert.ok(
    !/bulkLaunchState\./.test(worker),
    'the worker must close over its own run state, not the shared binding that a later run replaces'
  );
  assert.match(worker, /state\.aborted/, 'worker must honour its own abort flag');
  assert.match(worker, /state\.paused/, 'worker must honour its own pause flag');
});

test('queue mode holds the slot against the run\'s own state', () => {
  const fn = slice('async function bulkLaunchProfiles', 'async function bulkCloseSessions');
  assert.match(fn, /waitForSessionClose\(session\.sessionId, state\)/, 'the wait must be scoped to this run');
  const waiter = slice('function waitForSessionClose', 'async function bulkLaunchProfiles');
  assert.ok(!/bulkLaunchState/.test(waiter), 'waitForSessionClose must not read the shared binding');
});

test('completion does not clobber a newer run', () => {
  const fn = slice('async function bulkLaunchProfiles', 'async function bulkCloseSessions');
  const tail = fn.slice(fn.indexOf('if (isQueueMode)'));
  assert.ok(
    !/bulkLaunchState\.active = false/.test(tail),
    'a finishing run must clear ITS OWN active flag, never whatever run is current now'
  );
  assert.match(tail, /state\.active = false/);
});

test('stop closes the browsers the queue opened', () => {
  const fn = slice('async function controlBulkLaunch', 'function waitForSessionClose');
  assert.match(fn, /closeAnySession/, 'stop must actually close sessions');
  assert.match(fn, /closeOpened !== false/, 'closing should be opt-out, not silent');
  assert.match(fn, /reconcileProfileLocks/, 'closing must release the profile locks');
});

test('stop only closes sessions this run started, never ones already open', () => {
  const launch = slice('async function bulkLaunchProfiles', 'async function bulkCloseSessions');
  assert.match(
    launch,
    /if \(!session\.alreadyRunning\) state\.started\.push/,
    'a profile already open before the queue began is the user\'s, not the queue\'s'
  );
  assert.match(launch, /started: \[\]/, 'the run state must carry the started list');
});
