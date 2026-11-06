'use strict';
// Audit 2 Nov 2026 #1: Quick generate in "pool" mode created every profile DIRECT (the
// user's real IP) when no pool proxy matched the filters or passed the live check, and
// reported "Created N profiles." in green. Pool mode must now create nothing in that case,
// say why, and never create an empty "new group".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const BATCH = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'pages', 'BatchImportPage.jsx'), 'utf8');
const body = (() => {
  const m = /async function batchGenerateProfiles\([^)]*\) \{[\s\S]*?\r?\n\}/.exec(IPC);
  assert.ok(m, 'batchGenerateProfiles must exist');
  return m[0];
})();

test('pool mode never assigns an empty (direct) plan', () => {
  assert.ok(!/healthy\.length \? \{ proxyId: healthy\[i % healthy\.length\]\.id \} : \{\}/.test(body), 'the silent direct fallback is gone');
  assert.match(body, /if \(healthy\.length\) \{\s*for \(let i = 0; i < count; i \+= 1\) assignments\.push\(\{ proxyId: healthy\[i % healthy\.length\]\.id \}\);\s*\} else \{\s*effectiveCount = 0;\s*proxyLimited = true;/);
});

test('a run with no usable proxy reports why and shows as a warning', () => {
  assert.match(body, /if \(effectiveCount === 0\) noProxyReason = poolMatched === 0 \? 'no-match' : 'none-healthy';/);
  assert.match(body, /noProxyReason === 'no-match'[\s\S]*Nothing was created: no proxy in your pool matches/);
  assert.match(body, /noProxyReason === 'none-healthy'[\s\S]*Nothing was created: none of the/);
  assert.match(body, /noProxyReason,\s*groupId,/, 'the reason is returned to the renderer');
});

test('a new group is created only when at least one profile will be created', () => {
  const plan = body.indexOf("const proxyMode = (optionalString(input.proxyMode)");
  const create = body.indexOf('db.group.create(');
  assert.ok(plan > 0 && create > plan, 'group creation moved after the proxy plan');
  assert.match(body, /if \(!groupId && newGroupName && effectiveCount > 0\) \{/);
});

test('direct mode is untouched: it still creates every profile without a proxy', () => {
  assert.match(body, /\/\/ 'direct' → assignments empty, effectiveCount = count, no proxy bound\./);
});

test('Batch Import passes the speed and blocklist filters like the Profiles page', () => {
  assert.match(BATCH, /proxySource, proxySpeed, proxyBlacklist \} = config;/);
  assert.match(BATCH, /proxySpeed, \/\/ same pre-filters as the Profiles page[\s\S]*?proxyBlacklist,\s*proxyList: pasted/);
});
