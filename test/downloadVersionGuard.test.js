'use strict';

// Regression guard for DL-1: browserDownloader.startDownload used the caller's
// version string verbatim to build a filesystem path that the fatal-error branch
// recursively removes (fsp.rm(chromeTargetDir(version), {recursive,force})). An IPC
// value like '../../../../../' escaped CHROME_ROOT and deleted an unrelated
// directory, and a network/catalogue failure deleted the resumable partial.
//
// The fix adds a pure predicate isValidVersionKey() and rejects any non-version
// key synchronously, before any fs or network work. We test the predicate
// directly (no side effects, so path-traversal strings are safe to assert here),
// plus that startDownload wires it in for a harmless non-path token.

const test = require('node:test');
const assert = require('node:assert');
const dl = require('../src/main/browserDownloader.js');

test('isValidVersionKey accepts real Chrome version keys', () => {
  for (const v of ['150', '151.0.7258.5', '120', '99.0.0.0']) {
    assert.strictEqual(dl.isValidVersionKey(v), true, `should accept ${v}`);
  }
});

test('isValidVersionKey rejects non-version and path-traversal keys', () => {
  for (const v of ['abc', '1.2.3.4.5', 'latest', 'v150', '150-x', '', '../../../../../', '150/../../etc', 'win64-..', '.']) {
    assert.strictEqual(dl.isValidVersionKey(v), false, `should reject ${JSON.stringify(v)}`);
  }
});

// startDownload must apply the guard: a rejected key fails synchronously with no
// download started. 'abc' is a non-path token, harmless even against old code.
test('startDownload rejects an invalid version synchronously', () => {
  const entry = dl.startDownload('abc');
  assert.strictEqual(entry.state, 'error', `expected synchronous error, got ${entry.state}`);
  assert.match(String(entry.error || ''), /version/i);
});
