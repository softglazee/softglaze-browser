'use strict';

// Regression guard for the rekey lockout (C4-adjacent / IPC3-03):
//  1. rekeyEncryptedDb encrypted the LIVE WAL database with no checkpoint, so
//     committed rows still in -wal were missing from the new .enc, and it returned
//     SILENTLY on its guard conditions.
//  2. vaultSetPassword wrote the new vault hash FIRST, then called rekey inside a
//     swallowing try/catch. A failed/skipped rekey left the .enc on the OLD password
//     while the vault expected the NEW one -> permanent lockout that reported success.
//
// Fix: rekey checkpoints the WAL and THROWS on its guards; the caller rekeys BEFORE
// persisting the vault hash and does not swallow the error. Both handlers reach
// through electron/Prisma, so this pins the fix at the source level.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DB_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'database.js'), 'utf8');
const IPC_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipcHandlers.js'), 'utf8');

function functionBody(source, sig) {
  const start = source.indexOf(sig);
  assert.ok(start !== -1, `could not find ${sig}`);
  const open = source.indexOf('{', start);
  let depth = 0, inS = null, inLine = false, inBlock = false;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && source[i + 1] === '/') { inBlock = false; i += 1; } continue; }
    if (inS) { if (c === inS && source[i - 1] !== '\\') inS = null; continue; }
    if (c === '/' && source[i + 1] === '/') { inLine = true; continue; }
    if (c === '/' && source[i + 1] === '*') { inBlock = true; continue; }
    if (c === '\'' || c === '"' || c === '`') { inS = c; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return source.slice(open, i + 1); }
  }
  assert.fail(`unbalanced braces scanning ${sig}`);
}

test('rekeyEncryptedDb checkpoints the WAL before encrypting', () => {
  const body = functionBody(DB_SRC, 'async function rekeyEncryptedDb(');
  const cp = body.indexOf('checkpointAndDisconnect(');
  const enc = body.indexOf('encryptDbFile(');
  assert.ok(cp !== -1, 'rekey must checkpoint the WAL (checkpointAndDisconnect) before re-encrypting');
  assert.ok(enc !== -1, 'rekey must call encryptDbFile');
  assert.ok(cp < enc, 'the WAL checkpoint must run before encryptDbFile, not after');
});

test('rekeyEncryptedDb throws (does not silently return) when it cannot run', () => {
  const body = functionBody(DB_SRC, 'async function rekeyEncryptedDb(');
  assert.match(body, /DB_NOT_UNLOCKED/, 'the not-unlocked guard must throw a coded error, not return silently');
  assert.doesNotMatch(body, /\)\s*return\s*;/, 'no bare guard "return;" should remain in rekeyEncryptedDb');
});

test('vaultSetPassword re-keys the DB BEFORE persisting the new vault hash', () => {
  const body = functionBody(IPC_SRC, 'async function vaultSetPassword(');
  const rekey = body.indexOf('rekeyEncryptedDb(');
  const persist = body.indexOf("writeSetting('vault'");
  assert.ok(rekey !== -1, 'vaultSetPassword must call rekeyEncryptedDb when encryption is on');
  assert.ok(persist !== -1, "vaultSetPassword must persist the vault via writeSetting('vault', ...)");
  assert.ok(rekey < persist, 'rekey must happen before the new vault hash is written, so a failed rekey does not lock the user out');
});
