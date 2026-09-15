'use strict';
// Regression tests for two silent data-loss bugs in the profile update path.
//
// BUG 1 — adding or removing a single tag chip on the Groups page erased the
// profile's saved platform usernames and passwords and switched its anti-detect
// engine off. GroupsPage called profiles.update({ id, tags }); updateProfile rebuilds
// the whole record through extractFingerprintData(), which is shared with create()
// and therefore maps an ABSENT field to a concrete default (null / false / 'Auto')
// rather than undefined. The scrub that follows only deletes `undefined`, so every
// one of those defaults was written over real data.
//
// BUG 2 — renaming a profile abandoned its on-disk Chromium directory and changed
// its fingerprint. The editor sent `dataDirName: <title>` on every save; nothing in
// the app moves the folder, so the next launch mkdir'd a fresh empty one (all
// cookies, sessions, saved logins gone) and re-seeded the fingerprint, since
// browserEngine derives the seed from that same string.
//
// These read the real source so they fail if the guards are removed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = (rel) => fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `could not find function ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// Evaluate the real extractFingerprintData with a stubbed secretStore (only reached
// when twoFactorSeed is supplied, which these tests never do) and the real engine-name
// normaliser it calls for browserCore.
function loadExtract() {
  const { toStoredBrowserCore } = require('../src/main/importParser');
  const ctx = { module: {}, secretStore: { seal: (x) => `sealed:${x}` }, toStoredBrowserCore };
  vm.createContext(ctx);
  vm.runInContext(
    `${extractFunction(SRC('main/ipcHandlers.js'), 'extractFingerprintData')}
     module.exports = extractFingerprintData;`, ctx);
  return ctx.module.exports;
}

// Pull the PATCH_SAFE table out of updateProfile.
function loadPatchSafe() {
  const src = SRC('main/ipcHandlers.js');
  const start = src.indexOf('const PATCH_SAFE = [');
  assert.notEqual(start, -1,
    'updateProfile must carry a PATCH_SAFE table — without it a partial payload ' +
    'silently overwrites saved credentials and per-profile settings');
  const open = src.indexOf('[', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  return vm.runInNewContext(`(${src.slice(open, end + 1)})`);
}

// --- BUG 1: a partial update must not destroy data ------------------------

test('extractFingerprintData maps absent fields to destructive defaults', () => {
  // This is the hazard the guard exists for. If this ever stops being true the guard
  // is redundant — but until then, absence is NOT neutral here.
  const out = loadExtract()({});
  assert.equal(out.platformAccounts, null);
  assert.equal(out.browserSettingsJson, null);
  assert.equal(out.userAgent, 'Auto');
  assert.equal(out.antidetectEngine, false);
});

test('the update guard strips every destructive default from a partial payload', () => {
  const extract = loadExtract();
  const patchSafe = loadPatchSafe();

  // Exactly what GroupsPage used to send: a tag-only patch.
  const input = { id: 7, tags: ['blue'] };
  const data = { ...extract(input) };
  for (const [dataKey, inputKey] of patchSafe) {
    if (input[inputKey] === undefined) delete data[dataKey];
  }

  for (const field of [
    'platformAccounts',   // saved usernames + passwords
    'browserSettingsJson',
    'syncItemsJson',
    'userAgent',
    'enableQuic',
    'antidetectEngine',
    'randomFingerprint'
  ]) {
    assert.equal(field in data, false,
      `${field} must be absent from a partial update — writing it overwrites real data`);
  }
});

test('a full payload still writes every field', () => {
  const extract = loadExtract();
  const patchSafe = loadPatchSafe();
  const input = {
    id: 7,
    platformAccounts: [{ site: 'x', user: 'u' }],
    browserSettings: { mode: 'blank' },
    syncItems: ['cookies'],
    userAgent: 'Mozilla/5.0 custom',
    enableQuic: true,
    antidetectEngine: true,
    randomFingerprint: true
  };
  const data = { ...extract(input) };
  for (const [dataKey, inputKey] of patchSafe) {
    if (input[inputKey] === undefined) delete data[dataKey];
  }
  assert.equal(data.userAgent, 'Mozilla/5.0 custom');
  assert.equal(data.antidetectEngine, true);
  assert.equal(data.enableQuic, true);
  assert.ok(data.platformAccounts, 'a supplied value must still be written');
});

test('the guard covers every destructive field extractFingerprintData produces', () => {
  // Catches a NEW field being added to extractFingerprintData with a concrete
  // default but not added to PATCH_SAFE — the exact way this bug class returns.
  const bare = loadExtract()({});
  const covered = new Set(loadPatchSafe().map(([dataKey]) => dataKey));
  const NON_DESTRUCTIVE = new Set(['tags']); // written explicitly by updateProfile
  const uncovered = Object.keys(bare).filter((k) => {
    if (covered.has(k) || NON_DESTRUCTIVE.has(k)) return false;
    const v = bare[k];
    // undefined is already dropped by the scrub; anything else would be written.
    return v !== undefined;
  });
  assert.deepEqual(uncovered, [],
    `these fields get a concrete value from an EMPTY payload but are not in ` +
    `PATCH_SAFE, so a partial update would overwrite them: ${uncovered.join(', ')}`);
});

// Strip // and /* */ comments so a source assertion cannot be satisfied — or, as
// happened here, falsely tripped — by prose in a comment.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('GroupsPage edits tags through the tags-only handler', () => {
  const page = stripComments(
    fs.readFileSync(path.join(ROOT, 'src/renderer/pages/GroupsPage.jsx'), 'utf8'));
  assert.ok(/profiles\.tagAssign\(/.test(page), 'GroupsPage must use profiles.tagAssign');
  assert.equal(/await\s+softglazeApi\.profiles\.update\(/.test(page), false,
    'GroupsPage must NOT call profiles.update — a partial payload there wipes ' +
    'saved platform credentials and the anti-detect toggle');
});

// --- BUG 2: dataDirName is immutable --------------------------------------

test('updateProfile never assigns a new dataDirName', () => {
  const body = extractFunction(SRC('main/ipcHandlers.js'), 'updateProfile');
  assert.equal(/data\.dataDirName\s*=/.test(body), false,
    'updateProfile must not change dataDirName: nothing moves the on-disk folder, ' +
    'so the profile loses every cookie and session, and browserEngine re-seeds the ' +
    'fingerprint from that same string');
});

test('the profile editor does not send dataDirName on update', () => {
  const page = fs.readFileSync(path.join(ROOT, 'src/renderer/pages/ProfilesPage.jsx'), 'utf8');
  assert.ok(/const \{ dataDirName, \.\.\.updatePayload \} = payload/.test(page),
    'the editor must strip dataDirName before profiles.update — renaming a profile ' +
    'otherwise abandons its browser data and changes its fingerprint');
});

test('the fingerprint seed still derives from dataDirName', () => {
  // The reason dataDirName must stay immutable. If this stops being true the
  // constraint can be relaxed — until then it is load-bearing.
  const engine = SRC('main/browserEngine.js');
  assert.ok(/seedFromString\(safeDirName\)/.test(engine),
    'fingerprint seed is expected to derive from the data-dir name');
});

// --- AnyIP username builder: never emit a duplicate flag ------------------

test('a pasted full AnyIP username does not produce duplicate session flags', () => {
  // Operators paste their whole gateway username into the Username field, e.g.
  // "user_x,sesstime_10080,session_abc". The builder used to append its own flags on
  // top, emitting session_ TWICE. Which one the gateway honours is undefined —
  // measured today AnyIP takes the last, so each profile did get its own exit IP, but
  // one parser change away every identity collapses onto a single shared IP.
  const src = fs.readFileSync(path.join(ROOT, 'src/main/ipcHandlers.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function fetchAnyIpPool'));
  assert.ok(/const userSegs = user\.split\(','\)/.test(fn),
    'the builder must split flags the operator embedded in the username');
  assert.ok(/own\.delete\('session'\)/.test(fn),
    'session must be re-set so it is emitted once, and last');
  assert.equal(/const parts = \[user, `type_\$\{ptype\}`\]/.test(fn), false,
    'the old append-onto-raw-username form must not come back');
});

test('the builder emits each AnyIP flag exactly once', () => {
  // Mirrors the shipped logic so the invariant is exercised, not just asserted.
  const build = (user, cc, lifeMin, ptype, sess) => {
    const segs = user.split(',').map((s) => s.trim()).filter(Boolean);
    const base = segs.shift() || user;
    const flags = new Map();
    for (const s of segs) { const k = s.split('_')[0]; if (k) flags.set(k, s); }
    const own = new Map(flags);
    own.set('type', `type_${ptype}`);
    if (cc) own.set('country', `country_${cc}`);
    if (lifeMin) own.set('sesstime', `sesstime_${lifeMin}`);
    own.delete('session');
    own.set('session', `session_${sess}`);
    return [base, ...own.values()].join(',');
  };
  const out = build('user_4a497e,sesstime_10080,session_shared', 'US', 0, 'residential', 'uniq1');
  assert.equal((out.match(/session_/g) || []).length, 1, 'exactly one session flag');
  assert.match(out, /,session_uniq1$/, 'session is last and is the generated one');
  assert.match(out, /sesstime_10080/, "the operator's own sesstime survives");
  assert.equal((out.match(/sesstime_/g) || []).length, 1, 'exactly one sesstime flag');
});
