'use strict';
// Audit 2 Nov 2026 #11: the Parallel runs panel showed "finished" 1.5 s after starting.
// The main handler is fire-and-forget and returns at once, and a 1.5 s timer then
// cleared "Running" while the run was still going. Run was enabled again, a second
// click started an overlapping run on the same browsers, the logs mixed, and
// closeWhenDone closed browsers the other run still used.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload.js'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'lib', 'softglazeApi.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'pages', 'AutomationPage.jsx'), 'utf8');
const fnBody = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\(([\\s\\S]*?)\\r?\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};

test('the 1.5 s "finished" timer is gone', () => {
  assert.ok(!/setTimeout\(\(\) => setRunning\(false\), 1500\)/.test(PAGE));
});

test('the panel only applies frames of its own run, holding early frames until the runId is known', () => {
  assert.match(PAGE, /if \(pendingFramesRef\.current\) \{ pendingFramesRef\.current\.push\(frame\); return; \}/);
  assert.match(PAGE, /if \(!runIdRef\.current \|\| frame\.payload\.runId !== runIdRef\.current\) return;/);
  assert.match(PAGE, /runIdRef\.current = res && res\.runId \? String\(res\.runId\) : null;/);
  assert.match(PAGE, /for \(const f of held\) if \(f\.payload && f\.payload\.runId === runIdRef\.current\) applyFrame\(f\);/);
});

test('while running, the panel asks main whether the run really ended', () => {
  assert.match(PAGE, /const st = await softglazeApi\.automation\.parallelStatus\(id\);/);
  assert.match(PAGE, /if \(!st \|\| !st\.running\) \{\s*setRunning\(false\);/);
  assert.match(PAGE, /\}, 5000\);\s*return \(\) => clearInterval\(timer\);\s*\}, \[running\]\);/);
});

test('main tracks parallel runs, answers the status call, and refuses overlapping runs', () => {
  const h = fnBody('runParallelMacroHandler');
  assert.match(h, /const busy = profileIds\.filter\(\(pid\) => profilesInParallelRun\(\)\.has\(pid\)\);/);
  assert.match(h, /RUN_IN_PROGRESS/);
  assert.match(h, /parallelRuns\.set\(runId, \{ runId, ownerMemberId: currentMemberId, profileIds, startedAt: Date\.now\(\), done: false, summary: null \}\);/);
  assert.match(h, /finally \{[\s\S]*?finishParallelRun\(runId, summary \|\| /);
  const st = fnBody('getParallelRunStatus');
  assert.match(st, /await requirePermission\('automation\.run'\);/);
  assert.match(st, /await assertCanControlRun\(r\.ownerMemberId\);/);
  assert.match(st, /return \{ known: true, running: !r\.done, summary: r\.summary/);
  assert.match(fnBody('finishParallelRun'), /PARALLEL_DONE_KEEP_MS/, 'finished runs are pruned');
});

test('the new channel is wired end to end', () => {
  assert.match(IPC, /AUTOMATION_PARALLEL_STATUS: 'automation:parallel-status',/);
  assert.match(IPC, /registerHandler\(CHANNELS\.AUTOMATION_PARALLEL_STATUS, getParallelRunStatus\);/);
  assert.match(PRELOAD, /AUTOMATION_PARALLEL_STATUS: 'automation:parallel-status',/);
  assert.match(PRELOAD, /parallelStatus: \(runId\) => invoke\(CHANNELS\.AUTOMATION_PARALLEL_STATUS, \{ runId \}\),/);
  assert.match(API, /parallelStatus: \(runId\) => getSoftglazeApi\(\)\.automation\.parallelStatus\(runId\),/);
});
