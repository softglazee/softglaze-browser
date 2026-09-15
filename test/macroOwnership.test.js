'use strict';
// Audit T2-5: macros were global and ungated. Any member could read every recorded login
// macro (typed values, passwords included), rewrite another member's macro, or delete the
// workspace's macros, and delete reported success even when it failed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
const fnBody = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\(([\\s\\S]*?)\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};

test('all three macro channels require automation.run', () => {
  for (const fn of ['getMacros', 'saveMacro', 'deleteMacro']) {
    assert.match(fnBody(fn), /await requirePermission\('automation\.run'\)/, `${fn} must be gated`);
  }
});

test('the list is scoped to macros the member may see', () => {
  const body = fnBody('getMacros');
  assert.match(body, /const scope = await macroScope\(\)/);
  assert.match(body, /\.filter\(\(r\) => macroVisible\(scope, r\)\)/);
});

test('visibility follows the owner subtree, and ownerless macros stay with owners and admins', () => {
  const body = fnBody('macroVisible');
  assert.match(body, /if \(!scope \|\| !row\) return Boolean\(row\);/, 'single-user mode is unrestricted');
  assert.match(body, /scope\.visible\.has\(row\.ownerMemberId\)/);
  assert.match(body, /permissions\.rankOf\(scope\.member\.role\) >= permissions\.ROLE_RANK\.ADMIN/);
});

test('updates and deletes check access to that macro first', () => {
  const save = fnBody('saveMacro');
  assert.ok(save.indexOf('await loadAccessibleMacro(id)') < save.indexOf('db.macro.update('), 'check before update');
  const del = fnBody('deleteMacro');
  assert.ok(del.indexOf('await loadAccessibleMacro(id)') < del.indexOf('macro.delete('), 'check before delete');
});

test('delete no longer swallows failures, and it is audited', () => {
  const del = fnBody('deleteMacro');
  assert.ok(!/\.catch\(\(\) => \{\}\)/.test(del), 'a failed delete must surface');
  assert.match(del, /logAudit\('macro\.deleted'/);
});

test('new and recorded macros are stamped with their creator', () => {
  assert.match(fnBody('saveMacro'), /db\.macro\.create\(\{ data: \{ name, description, stepsJson, ownerMemberId: ownerStampId\(\) \} \}\)/);
  assert.match(IPC, /stepsJson: JSON\.stringify\(steps\), ownerMemberId: ownerStampId\(\)/);
});

test('the schema and a migration add the owner column', () => {
  const model = /model Macro \{[\s\S]*?\n\}/.exec(SCHEMA)[0];
  assert.match(model, /ownerMemberId Int\?/);
  assert.match(model, /@@index\(\[ownerMemberId\]\)/);
  const sql = fs.readFileSync(path.join(ROOT, 'prisma', 'migrations', '20260915000000_macro_owner', 'migration.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE "Macro" ADD COLUMN "ownerMemberId" INTEGER;/);
});
