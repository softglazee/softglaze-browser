'use strict';
// Country groups made by auto-grouping go away with their last proxy. Groups a person made stay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const IPC = read('src/main/ipcHandlers.js');
const body = (name) => {
  const start = IPC.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, name);
  return IPC.slice(start, IPC.indexOf('\nasync function ', start + 10));
};

test('only auto groups with no proxies are removed', () => {
  assert.match(body('pruneEmptyAutoGroups'), /deleteMany\(\{ where: \{ autoCreated: true, proxies: \{ none: \{\} \} \} \}\)/);
});

test('every way of removing a proxy from a group cleans up', () => {
  for (const name of ['deleteProxy', 'bulkDeleteProxies', 'autoGroupProxies', 'assignProxiesToGroup', 'afterDbReady']) {
    assert.match(body(name), /pruneEmptyAutoGroups\(/, name);
  }
});

test('auto grouping marks the groups it makes; the manual create does not', () => {
  assert.match(body('autoGroupProxies'), /autoCreated: true/);
  assert.doesNotMatch(body('createProxyGroup'), /autoCreated/);
});

test('the migration marks old country groups and leaves other names alone', () => {
  const sql = read('prisma/migrations/20261102000000_proxy_group_auto_created/migration.sql');
  assert.match(sql, /ADD COLUMN "autoCreated" BOOLEAN NOT NULL DEFAULT 0/);
  for (const name of Object.values({ a: 'United States', b: 'Japan', c: 'New Zealand' })) assert.ok(sql.includes(`'${name}'`), name);
  assert.match(sql, /GLOB '\[A-Z\]\[A-Z\]'/, 'two-letter country codes');
  assert.doesNotMatch(sql, /WHERE 1|DELETE FROM/i, 'marks rows only, deletes nothing');
});

test('the pool page refreshes its groups and leaves a filter for a group that is gone', () => {
  const page = read('src/renderer/pages/ProxyPoolPage.jsx');
  const i = page.indexOf('softglazeApi.proxies.delete(proxy.id);');
  assert.match(page.slice(i, i + 200), /loadGroups\(\)/);
  assert.match(page, /groups\.some\(\(g\) => String\(g\.id\) === String\(activeGroup\)\)\) setActiveGroup\('all'\)/);
});
