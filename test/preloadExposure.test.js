'use strict';
// Regression test for the preload bridge actually being exposed.
//
// preload.js is `'use strict'` and `api` is Object.freeze(...). Anything that mutates
// `api` after that literal — e.g. `api.hostOs = ...` — throws a TypeError, the preload
// script dies BEFORE contextBridge.exposeInMainWorld runs, and window.softglaze never
// exists. The whole app then fails closed at the unlock screen with
// "SoftGlaze preload API is unavailable", with no hint that a one-line preload edit
// caused it.
//
// Nothing else in the suite loads preload.js, so a change there was completely
// unguarded. This runs it against a stubbed electron and asserts the bridge is handed
// a usable API.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PRELOAD = path.join(__dirname, '..', 'src', 'preload', 'preload.js');

// Load preload.js with `electron` stubbed, capturing the exposeInMainWorld call.
function loadPreload() {
  const captured = { name: null, api: null, calls: 0 };
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        contextBridge: {
          exposeInMainWorld: (name, api) => { captured.name = name; captured.api = api; captured.calls += 1; }
        },
        ipcRenderer: { invoke: () => {}, on: () => {}, removeListener: () => {}, send: () => {} }
      };
    }
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve(PRELOAD)];
    require(PRELOAD);
  } finally {
    Module._load = orig;
  }
  return captured;
}

test('preload.js runs to completion and exposes the bridge', () => {
  const c = loadPreload();
  assert.equal(c.calls, 1, 'contextBridge.exposeInMainWorld must be called exactly once');
  assert.equal(c.name, 'softglaze', 'the renderer reads window.softglaze');
  assert.ok(c.api && typeof c.api === 'object', 'an API object must be handed to the bridge');
});

test('the exposed API carries the namespaces the app boots against', () => {
  const { api } = loadPreload();
  // A missing namespace here is what the unlock screen reports as
  // "SoftGlaze preload API is unavailable".
  for (const ns of ['system', 'profiles', 'proxies', 'settings', 'db', 'members']) {
    assert.ok(api[ns], `window.softglaze.${ns} must exist`);
  }
});

test('hostOs is exposed as a usable platform string', () => {
  const { api } = loadPreload();
  assert.ok(['Windows', 'macOS', 'Linux'].includes(api.hostOs),
    `hostOs must be one of Windows/macOS/Linux, got ${JSON.stringify(api.hostOs)}`);
});

test('the bulk-queue re-attach channel is reachable from the renderer', () => {
  const { api } = loadPreload();
  assert.equal(typeof api.profiles.bulkLaunchStatus, 'function',
    'without this the Profiles page cannot re-attach to a running queue');
});

test('preload does not mutate the frozen api object after it is created', () => {
  // Belt and braces: catch the mistake by shape as well as by behaviour, since a
  // future edit could add a mutation guarded by a condition this test does not hit.
  const fs = require('node:fs');
  const src = fs.readFileSync(PRELOAD, 'utf8');
  const frozenAt = src.indexOf('const api = Object.freeze(');
  assert.notEqual(frozenAt, -1, 'api is expected to be a frozen literal');
  const after = src.slice(frozenAt);
  assert.equal(/^\s*api\.[A-Za-z_$][\w$]*\s*=/m.test(after), false,
    'assigning to `api` after Object.freeze throws in strict mode and kills the preload — ' +
    'add the property inside the frozen literal instead');
});
