'use strict';

// Regression guard for C4: configureDatabaseEnv learned the at-rest encryption
// state ONLY from the plaintext sidecar (db-encryption.json), and readSidecar()
// fails OPEN ({enabled:false}) on a missing/corrupt sidecar. So losing the sidecar
// while softglaze.sqlite.enc still exists made the app boot a fresh empty DB with
// encryption silently off; the crash-leftover branch then re-encrypted that empty
// file over the good .enc. Unrecoverable. The fix makes the .enc presence
// authoritative: if the ciphertext exists, the workspace is encrypted (fail closed,
// require unlock) regardless of the sidecar.
//
// configureDatabaseEnv needs electron's app to run, so this pins the fix at the
// source level, which is precise enough: the enabled assignment must OR in the
// existence of runtime.encPath.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'database.js'), 'utf8');

function functionBody(source, sig) {
  const start = source.indexOf(sig);
  assert.ok(start !== -1, `could not find ${sig}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(open, i + 1); }
  }
  assert.fail('unbalanced braces');
}

test('configureDatabaseEnv treats .enc presence as authoritative for encryption state', () => {
  const body = functionBody(SOURCE, 'function configureDatabaseEnv(');
  const m = body.match(/dbEnc\.enabled\s*=\s*([^\n;]+);/);
  assert.ok(m, 'expected a dbEnc.enabled = ... assignment in configureDatabaseEnv');
  const rhs = m[1];
  assert.match(rhs, /readSidecar\(\)\.enabled/, 'sidecar must still be consulted');
  assert.match(
    rhs,
    /existsSync\(\s*runtime\.encPath\s*\)/,
    'C4: a present .enc must force encryption on even when the sidecar is missing/corrupt'
  );
});
