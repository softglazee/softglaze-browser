'use strict';

// Regression guard for the audit-logging gap on IRREVERSIBLE deletes.
//
// The app logged the reversible soft-delete (a profile moved to Trash) but wrote
// nothing when a profile or proxy was permanently destroyed, so a wipe left no
// trace in the activity feed. This test reads the real ipcHandlers.js source,
// brace-matches each permanent-delete function, and asserts it records an audit
// entry. It fails if any of those calls is removed. Source-level on purpose:
// these handlers reach through getPrisma()/requirePermission()/assertCanAccess,
// so a behavioural test would have to stand up the whole main process; the repo
// already uses this brace-matching style (see personaAutofill.test.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'main', 'ipcHandlers.js'),
  'utf8'
);

// Return the body { ... } of `async function <name>(` by matching braces,
// ignoring braces inside strings, template literals, and comments.
function functionBody(source, name) {
  const sig = `async function ${name}(`;
  const start = source.indexOf(sig);
  assert.ok(start !== -1, `could not find ${sig} in ipcHandlers.js`);
  const open = source.indexOf('{', start);
  assert.ok(open !== -1, `no opening brace for ${name}`);

  let depth = 0;
  let inS = null; // ' " ` when inside a string
  let inLine = false; // // comment
  let inBlock = false; // /* */ comment
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    const prev = source[i - 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && source[i + 1] === '/') { inBlock = false; i += 1; } continue; }
    if (inS) { if (c === inS && prev !== '\\') inS = null; continue; }
    if (c === '/' && source[i + 1] === '/') { inLine = true; continue; }
    if (c === '/' && source[i + 1] === '*') { inBlock = true; continue; }
    if (c === '\'' || c === '"' || c === '`') { inS = c; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return source.slice(open, i + 1); }
  }
  assert.fail(`unbalanced braces while scanning ${name}`);
}

const PERMANENT_DELETES = [
  'purgeProfile',
  'bulkPurgeProfiles',
  'deleteProxy',
  'bulkDeleteProxies',
  'deleteProxyGroup'
];

for (const name of PERMANENT_DELETES) {
  test(`${name} writes an audit-log entry`, () => {
    const body = functionBody(SOURCE, name);
    assert.ok(
      /\blogAudit\s*\(/.test(body) || /\blogActivity\s*\(/.test(body),
      `${name} performs an irreversible delete but records no audit entry (no logAudit/logActivity call)`
    );
  });
}

// Control: the reversible soft-delete already logs. If this ever fails the test
// harness itself is wrong (wrong function matched), not the code under test.
test('bulkDeleteProfiles (reversible) still logs, control', () => {
  const body = functionBody(SOURCE, 'bulkDeleteProfiles');
  assert.ok(/\blogActivity\s*\(/.test(body), 'control: soft-delete must keep its logActivity call');
});
