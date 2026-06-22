'use strict';
// IPC channel parity smoke test. PURE — parses source text instead of requiring
// the modules (both pull in Electron). Catches the "half-wired channel" bug: a
// channel defined on one side but not the other, an orphan with no handler, or a
// handler referencing a channel key that doesn't exist.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN = path.join(__dirname, '..', 'src', 'main', 'ipcHandlers.js');
const PRELOAD = path.join(__dirname, '..', 'src', 'preload', 'preload.js');

// Extract the `const CHANNELS = Object.freeze({ … })` map as { KEY: 'value' }.
function parseChannels(source, label) {
  const block = source.match(/const CHANNELS = Object\.freeze\(\{([\s\S]*?)\}\)/);
  if (!block) throw new Error(`CHANNELS block not found in ${label}`);
  const map = {};
  const re = /(\w+)\s*:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block[1])) !== null) map[m[1]] = m[2];
  return map;
}

// Collect the CHANNELS.<KEY> referenced by a given call pattern.
function keysFrom(source, re) {
  const set = new Set();
  let m;
  while ((m = re.exec(source)) !== null) set.add(m[1]);
  return set;
}

const mainSrc = fs.readFileSync(MAIN, 'utf8');
const preloadSrc = fs.readFileSync(PRELOAD, 'utf8');

const mainChannels = parseChannels(mainSrc, 'ipcHandlers.js');
const preloadChannels = parseChannels(preloadSrc, 'preload.js');
const registered = keysFrom(mainSrc, /registerHandler\(\s*CHANNELS\.(\w+)/g);
const emitted = keysFrom(mainSrc, /\.send\(\s*CHANNELS\.(\w+)/g); // event channels

test('a healthy number of channels is defined', () => {
  const n = Object.keys(mainChannels).length;
  assert.ok(n >= 100, `expected ≥100 channels, parsed ${n}`);
});

test('main and preload expose identical channel value sets', () => {
  const mainVals = new Set(Object.values(mainChannels));
  const preVals = new Set(Object.values(preloadChannels));
  const mainOnly = [...mainVals].filter((v) => !preVals.has(v));
  const preOnly = [...preVals].filter((v) => !mainVals.has(v));
  assert.deepEqual(mainOnly, [], `defined in main but missing from preload: ${mainOnly.join(', ')}`);
  assert.deepEqual(preOnly, [], `present in preload but missing from main: ${preOnly.join(', ')}`);
});

test('every main channel is handled or emitted (no orphans)', () => {
  const covered = new Set([...registered, ...emitted]);
  const orphans = Object.keys(mainChannels).filter((k) => !covered.has(k));
  assert.deepEqual(orphans, [], `defined but neither registered nor emitted: ${orphans.join(', ')}`);
});

test('no handler/emit references an undefined channel key', () => {
  const phantom = [...registered, ...emitted].filter((k) => !(k in mainChannels));
  assert.deepEqual(phantom, [], `registerHandler/.send references unknown keys: ${phantom.join(', ')}`);
});
