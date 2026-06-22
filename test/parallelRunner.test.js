'use strict';
// Parallel macro runner (src/main/parallelRunner.js). Pure — no Electron, no
// real browser; all side-effects are injected. Verifies the concurrency cap,
// data-driven variable substitution, the pass/fail tally + terminator frame, and
// — most importantly — that no step value or row secret can leak into the live
// stream that the relay fans out.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runParallelMacro, applyVariables } = require('../src/main/parallelRunner.js');
const { RemoteRelay } = require('../src/main/remoteRelay.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const okResult = (n = 1) => ({ ok: true, ran: n, total: n, log: [] });

test('applyVariables substitutes {{key}} in url/value and never mutates originals', () => {
  const steps = [
    { type: 'goto', url: 'https://site/{{path}}' },
    { type: 'type', selector: '#email', value: '{{Account Email}}' }, // header with a space
    { type: 'click', selector: '#go' }
  ];
  const out = applyVariables(steps, { path: 'login', 'Account Email': 'a@b.com' });
  assert.equal(out[0].url, 'https://site/login');
  assert.equal(out[1].value, 'a@b.com');
  assert.equal(out[2].selector, '#go');
  // unknown placeholders collapse to empty string, originals stay intact
  assert.equal(applyVariables([{ type: 'type', value: '{{missing}}' }], {})[0].value, '');
  assert.equal(steps[0].url, 'https://site/{{path}}');
  assert.equal(steps[1].value, '{{Account Email}}');
});

test('runParallelMacro never exceeds the concurrency cap', async () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ profileId: i + 1, profileName: `P${i + 1}`, vars: null }));
  let active = 0;
  let peak = 0;
  const deps = {
    isOpen: () => false,
    // Bracket the whole per-profile lifecycle: ++ at launch, -- at close.
    launch: async (pid) => { active += 1; peak = Math.max(peak, active); await sleep(10); return { sessionId: `s${pid}` }; },
    runMacro: async () => { await sleep(10); return okResult(1); },
    close: async () => { active -= 1; },
    emit: () => {}
  };
  const summary = await runParallelMacro({ runId: 'r1', items, steps: [{ type: 'goto', url: 'x' }], concurrency: 3 }, deps);
  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded the cap of 3`);
  assert.equal(summary.total, 9);
  assert.equal(summary.passed, 9);
  assert.equal(summary.failed, 0);
});

test('runParallelMacro tallies pass/fail and emits one run-level done frame', async () => {
  const relay = new RemoteRelay();
  const dones = [];
  relay.on('frame', (f) => { if (f.payload && f.payload.state === 'done' && f.payload.profileId == null) dones.push(f.payload); });
  const items = [
    { profileId: 1, profileName: 'A', vars: null },
    { profileId: 2, profileName: 'B', vars: null }
  ];
  const deps = {
    isOpen: () => false,
    launch: async (pid) => ({ sessionId: `s${pid}` }),
    runMacro: async (sid) => (sid === 's2'
      ? { ok: false, ran: 0, total: 1, log: [{ index: 0, type: 'goto', ok: false, error: 'navigation failed' }] }
      : okResult(1)),
    close: async () => {},
    emit: (key, type, payload) => relay.emitFrame(key, type, payload)
  };
  const summary = await runParallelMacro({ runId: 'rT', items, steps: [{ type: 'goto', url: 'x' }], concurrency: 2 }, deps);
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(dones.length, 1);
  assert.equal(dones[0].total, 2);
  assert.equal(dones[0].failed, 1);
});

test('no step value or row secret ever appears in the streamed frames', async () => {
  const relay = new RemoteRelay();
  const frames = [];
  relay.on('frame', (f) => frames.push(f));

  const SECRET = 'hunter2-SUPER-SECRET';
  const COOKIE = 'sid=abc.LEAKED-COOKIE';
  const steps = [
    { type: 'type', selector: '#pw', value: '{{password}}' },     // substituted from row
    { type: 'type', selector: '#tok', value: `static-${SECRET}` } // literal secret in the macro
  ];
  const items = [{ profileId: 7, profileName: 'Acct', vars: { password: SECRET, cookie: COOKIE } }];

  let receivedFirstValue = null;
  const deps = {
    isOpen: () => false,
    launch: async () => ({ sessionId: 's7' }),
    // The browser layer DOES receive the real (substituted) value...
    runMacro: async (_sid, s) => { receivedFirstValue = s[0].value; return okResult(2); },
    close: async () => {},
    emit: (key, type, payload) => relay.emitFrame(key, type, payload)
  };

  await runParallelMacro({ runId: 'rSecret', items, steps, concurrency: 1 }, deps);

  // Substitution genuinely happened (the secret reached the macro runner)...
  assert.equal(receivedFirstValue, SECRET);
  // ...but it must NEVER appear in any frame that the relay fanned out.
  assert.ok(frames.length > 0, 'expected progress frames to be emitted');
  const blob = JSON.stringify(frames);
  assert.ok(!blob.includes(SECRET), 'a secret step value leaked into the live stream');
  assert.ok(!blob.includes(COOKIE), 'a row cookie leaked into the live stream');
});
