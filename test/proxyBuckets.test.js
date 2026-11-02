'use strict';
// Reported from live use: dead proxies showed as Fast, because a server name that does not exist
// fails in about 30 ms, and speed values changed between a check run and a reload.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const load = () => import('../src/renderer/lib/proxyBuckets.mjs');

const ok = (id, ms, extra = {}) => ({ id, lastStatus: 'ok', lastLatencyMs: ms, ...extra });
const dead = (id, ms, extra = {}) => ({ id, lastStatus: 'fail', lastLatencyMs: ms, ...extra });

test('a failed proxy is neither fast nor slow, whatever its stored time says', async () => {
  const { speedOf } = await load();
  assert.equal(speedOf(dead(1, 33)), 'unknown');
  assert.equal(speedOf(dead(2, 30014)), 'unknown');
  assert.equal(speedOf(ok(3, 33), { 3: { success: false, latencyMs: 40 } }), 'unknown', 'a fresh failure wins');
});

test('a working proxy is fast at 2000 ms or under, slow above', async () => {
  const { speedOf } = await load();
  assert.equal(speedOf(ok(1, 2000)), 'fast');
  assert.equal(speedOf(ok(2, 2001)), 'slow');
  assert.equal(speedOf({ id: 3 }), 'unknown', 'never checked');
  assert.equal(speedOf(dead(4, 33), { 4: { success: true, latencyMs: 900 } }), 'fast', 'a fresh pass wins');
});

test('the speed shown live is the number that gets saved, not the deep check average', async () => {
  const { measuredMs, speedOf } = await load();
  const live = { 1: { success: true, latencyMs: 1200, avgMs: 2600 } };
  assert.equal(measuredMs(ok(1, 900), live), 1200);
  assert.equal(speedOf(ok(1, 900), live), 'fast');
  assert.equal(speedOf(ok(1, 1200)), 'fast', 'same answer after a reload');
});

test('a failed proxy is not listed as clean or blacklisted', async () => {
  const { blacklistOf } = await load();
  assert.equal(blacklistOf(dead(1, 33, { lastBlacklisted: false })), 'unknown');
  assert.equal(blacklistOf(ok(2, 900, { lastBlacklisted: false })), 'clean');
  assert.equal(blacklistOf(ok(3, 900, { lastBlacklisted: true })), 'blacklisted');
  assert.equal(blacklistOf(ok(4, 900), { 4: { success: true, blacklist: { checked: true, listed: true } } }), 'blacklisted');
  assert.equal(blacklistOf(ok(5, 900)), 'unknown', 'never checked');
});

test('sorting puts unmeasured and failed proxies last, in both directions', async () => {
  const { sortByLatency } = await load();
  const list = [dead(1, 5), ok(2, 2000), { id: 3 }, ok(4, 800)];
  const ids = (a) => a.map((p) => p.id);
  assert.deepEqual(ids(sortByLatency(list)).slice(0, 2), [4, 2]);
  assert.deepEqual(ids(sortByLatency(list, {}, true)).slice(0, 2), [2, 4]);
});

test('the counts always add up: fast + slow = working proxies with a time', async () => {
  const { countBuckets } = await load();
  const pool = [ok(1, 900), ok(2, 1400), ok(3, 2500), dead(4, 33), dead(5, 30014), { id: 6 }];
  const c = countBuckets(pool);
  assert.equal(c.verified, 3);
  assert.equal(c.failed, 2);
  assert.equal(c.unknown, 1);
  assert.equal(c.fast + c.slow, c.verified);
  assert.deepEqual([c.fast, c.slow], [2, 1]);
});

test('the pool page and Quick generate use these rules', () => {
  const page = read('src/renderer/pages/ProxyPoolPage.jsx');
  assert.match(page, /from '@\/lib\/proxyBuckets\.mjs'/);
  assert.doesNotMatch(page, /function speedOf|function proxyHealthOf|function blacklistOf/);
  assert.doesNotMatch(page, /r\.avgMs/, 'the row shows the same number that is saved');
  assert.match(read('src/renderer/components/QuickGenerateModal.jsx'), /countBuckets\(/);
});

test('a failed check saves no time, and the Fast or Clean filter only takes working proxies', () => {
  const ipc = read('src/main/ipcHandlers.js');
  assert.match(ipc, /lastLatencyMs: speedMs,/);
  assert.match(ipc, /const speedMs = result\.success && typeof rawMs === 'number'/);
  assert.match(ipc, /if \(speedSel !== 'any' \|\| blSel !== 'any'\) filter\.lastStatus = 'ok';/);
});

test('speed is the median of the last three passing checks, so one odd reading does not flip it', () => {
  const { medianMs } = require('../src/main/proxyVendorUtils');
  assert.equal(medianMs([1400]), 1400);
  assert.equal(medianMs([1400, 1600]), 1500);
  assert.equal(medianMs([1400, 29984, 1600]), 1600, 'a one-off spike is ignored');
  assert.equal(medianMs([]), null);
  assert.equal(medianMs([null, 'x']), null);
});

test('the quick generate speed filter uses the same line as the pool page', () => {
  const ipc = read('src/main/ipcHandlers.js');
  assert.match(ipc, /speedSel === 'fast'\) filter\.lastLatencyMs = \{ lte: 2000 \}/);
  assert.match(ipc, /speedSel === 'slow'\) filter\.lastLatencyMs = \{ gt: 2000 \}/);
});
