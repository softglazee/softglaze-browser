'use strict';
// The SoftGlaze AI migration on a real SQLite database: every migration applied in order the way
// the runtime runner does it, with a Developer API token made before this release.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = path.join(__dirname, '..', 'prisma', 'migrations');
const AI_MIGRATION = '20261108000000_ai_tokens_audit';

// Same comment stripping + statement split as src/main/database.js applyMigrations.
function statementsOf(sql) {
  const cleaned = sql.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');
  const out = [];
  let buf = '';
  let inStr = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      buf += ch;
      if (ch === "'") { if (cleaned[i + 1] === "'") buf += cleaned[++i]; else inStr = false; }
      continue;
    }
    if (ch === "'") { inStr = true; buf += ch; continue; }
    if (ch === ';') { if (buf.trim()) out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

test('the AI migration extends ApiToken, keeps old tokens working and adds the audit table', (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { t.skip('node:sqlite is not available in this Node build'); return; }
  const db = new DatabaseSync(':memory:');
  const folders = fs.readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name)).map((d) => d.name).sort();
  assert.ok(folders.includes(AI_MIGRATION));
  for (const folder of folders) {
    if (folder === AI_MIGRATION) {
      db.exec(`INSERT INTO "ApiToken" ("name", "tokenHash") VALUES ('Old script', 'abc123')`);
    }
    for (const statement of statementsOf(fs.readFileSync(path.join(MIGRATIONS, folder, 'migration.sql'), 'utf8'))) db.exec(`${statement};`);
  }
  const cols = db.prepare('PRAGMA table_info("ApiToken")').all().map((c) => c.name);
  for (const c of ['kind', 'memberId', 'scope', 'groupIdsJson', 'expiresAt', 'revokedAt', 'lastClientName', 'createdById', 'preApprovedJson']) assert.ok(cols.includes(c), c);
  const old = db.prepare('SELECT "kind", "scope", "memberId", "revokedAt" FROM "ApiToken" WHERE "tokenHash" = ?').get('abc123');
  assert.deepEqual({ ...old }, { kind: 'api', scope: 'operate', memberId: null, revokedAt: null }, 'an older Developer API token keeps start/stop');
  db.exec(`INSERT INTO "ApiToken" ("name", "tokenHash", "kind") VALUES ('New AI', 'def456', 'ai')`);
  assert.equal(db.prepare('SELECT "scope" FROM "ApiToken" WHERE "tokenHash" = ?').get('def456').scope, 'read', 'new tokens default to read');
  db.exec(`INSERT INTO "AiAuditLog" ("tool", "outcome") VALUES ('list_profiles', 'ok')`);
  const row = db.prepare('SELECT * FROM "AiAuditLog"').get();
  assert.equal(row.tool, 'list_profiles');
  assert.equal(row.durationMs, 0);
  assert.ok(row.at);
});
