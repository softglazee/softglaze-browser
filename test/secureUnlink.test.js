'use strict';

// Regression guard for C5: dbCrypto.secureUnlink kept the random overwrite and the
// fsp.unlink inside ONE try/catch. On Windows fsp.open(...,'r+') throws EBUSY/EPERM
// whenever AV, the indexer or another instance holds the handle, and the shared
// catch then swallowed the error AND skipped the unlink, leaving the full plaintext
// DB on disk beside the ciphertext while relock reported success. The fix runs the
// overwrite as best-effort and then ALWAYS attempts the delete in its own try.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const dbCrypto = require('../src/main/dbCrypto.js');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'dbCrypto.js'), 'utf8');

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

test('secureUnlink runs the delete OUTSIDE the overwrite try', () => {
  const body = functionBody(SOURCE, 'async function secureUnlink(');
  const openIdx = body.indexOf('.open(');
  const unlinkIdx = body.indexOf('.unlink(');
  assert.ok(openIdx !== -1 && unlinkIdx !== -1, 'expected both .open and .unlink in secureUnlink');
  const overwriteCatchIdx = body.indexOf('catch', openIdx);
  assert.ok(overwriteCatchIdx !== -1, 'expected a catch after the overwrite open');
  assert.ok(
    unlinkIdx > overwriteCatchIdx,
    'fsp.unlink must sit after the overwrite try/catch so a failed overwrite cannot skip the delete'
  );
});

test('secureUnlink deletes a normal file (happy path unchanged)', async () => {
  const p = path.join(os.tmpdir(), `sg-secureunlink-${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(p, crypto.randomBytes(4096));
  assert.ok(fs.existsSync(p));
  await dbCrypto.secureUnlink(p);
  assert.ok(!fs.existsSync(p), 'secureUnlink should remove a normal writable file');
});
