'use strict';
// Audit 2 Nov 2026 #7: team members could run other members' macros and see their
// recorded steps, typed passwords included.
//   - run-macro / run-parallel loaded any macro by id (no ownership check) and streamed
//     each step, with its typed value, to the caller;
//   - the macro schedule had no checks and later ran as whoever was signed in (or
//     nobody, which passes every check), and overlapping passes piled up;
//   - stop-recording took any sessionId with no checks and returned the captured steps;
//   - pause/stop of macro runs and warm-ups were open to every member.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const fnBody = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\(([\\s\\S]*?)\\r?\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};

const redact = new Function(`${fnBody('redactStepForProgress')}; ${fnBody('redactProgressEvent')}; return { redactStepForProgress, redactProgressEvent };`)();

test('typed values never leave main in a progress frame', () => {
  const ev = { index: 2, status: 'running', step: { type: 'type', selector: '#pass', value: 'hunter2' } };
  const out = redact.redactProgressEvent(ev);
  assert.equal(out.step.value, '••••••');
  assert.equal(out.step.selector, '#pass');
  assert.equal(ev.step.value, 'hunter2', 'the step that actually runs is untouched');
  assert.equal(redact.redactProgressEvent({ step: { type: 'select', value: 'US' } }).step.value, 'US', 'non-secret values stay readable');
  assert.equal(redact.redactProgressEvent({ index: 1, status: 'ok' }).status, 'ok');
  assert.match(fnBody('runMacroOnProfile'), /send\(\{ runId, kind: 'step', \.\.\.redactProgressEvent\(ev\), ts: Date\.now\(\) \}\)/);
});

test('single and parallel runs use the macro-ownership check', () => {
  assert.match(fnBody('runMacroOnProfile'), /const macro = await loadAccessibleMacro\(macroId\);/);
  assert.match(fnBody('runParallelMacroHandler'), /const macro = await loadAccessibleMacro\(macroId\);/);
  assert.ok(!/db\.macro\.findUnique\(\{ where: \{ id: macroId \} \}\)/.test(IPC), 'no unchecked macro load by id remains');
});

test('the schedule is gated, owned, and re-checked against its owner on every run', () => {
  const set = fnBody('setMacroSchedule');
  assert.match(set, /await requirePermission\('automation\.run'\);/);
  assert.match(set, /if \(existing && existing\.ownerMemberId != null\) await assertCanControlRun\(existing\.ownerMemberId\);/);
  assert.match(set, /if \(macroId\) await loadAccessibleMacro\(macroId\);/);
  assert.match(set, /for \(const pid of profileIds\) await assertCanAccessProfile\(pid\);/);
  assert.match(set, /ownerMemberId: currentMemberId \};/);
  const due = fnBody('runDueMacroSchedule');
  assert.match(due, /const \{ allowed, reason \} = await scheduleAllowedProfiles\(cfg\);/);
  assert.match(due, /for \(const pid of allowed\)/);
  const allowed = fnBody('scheduleAllowedProfiles');
  assert.match(allowed, /owner\.status === 'banned' \|\| owner\.status === 'suspended'/);
  assert.match(allowed, /macroVisible\(\{ member: owner, visible \}, macro\)/);
  assert.match(allowed, /permissions\.profileRowAccessible\(visible, r, false\)/);
});

test('scheduled passes never overlap', () => {
  const due = fnBody('runDueMacroSchedule');
  assert.match(due, /if \(macroScheduleBusy\) return;\s*macroScheduleBusy = true;/);
  assert.match(due, /finally \{\s*macroScheduleBusy = false;/);
});

test('recording start/stop are gated and stop only returns the profile\'s own recording', () => {
  assert.match(fnBody('startMacroRecordingOnProfile'), /await requirePermission\('automation\.run'\);/);
  const stop = fnBody('stopMacroRecordingOnProfile');
  assert.match(stop, /await requirePermission\('automation\.run'\);/);
  assert.match(stop, /await assertCanAccessProfile\(profileId\);/);
  assert.match(stop, /const sessionId = String\(profileId\);/);
  assert.match(stop, /That recording belongs to a different profile/);
});

test('pause/stop of macro runs and warm-ups are limited to who may control them', () => {
  const ctl = fnBody('controlMacro');
  assert.match(ctl, /await requirePermission\('automation\.run'\);/);
  assert.match(ctl, /await assertCanControlRun\(control\.ownerMemberId\);/);
  assert.match(fnBody('runMacroOnProfile'), /ownerMemberId: currentMemberId \};/);
  const stop = fnBody('stopWarmer');
  assert.match(stop, /await requirePermission\('automation\.run'\);/);
  assert.match(stop, /await assertCanControlRun\(run\.ownerMemberId\)/);
  assert.match(IPC, /ownerMemberId: currentMemberId \/\/ who may stop \/ force-close it/);
  const who = fnBody('assertCanControlRun');
  assert.match(who, /permissions\.visibleMemberIds\(all, me\)\.has\(Number\(ownerMemberId\)\)/);
});
