'use strict';
// Regression tests for the CDP-binding-free page bridge.
//
// Background: every page->main feature (Data-Vault autofill, macro recorder,
// start-page links, session mirroring) rode on page.exposeFunction, i.e.
// Runtime.addBinding. fingerprint-chromium — the native anti-detect engine — keeps
// puppeteer's injected WRAPPER on every document but drops the underlying binding
// after the first navigation, so window.__sgFoo stayed `typeof 'function'` while
// every call threw "globalThis[(prefix + name)] is not a function". Callers that
// swallowed the throw silently did nothing. These tests lock in the client-side
// contract: prefer the native binding, fall back to the RPC channel, and never
// let a dead binding turn into a silent no-op.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { bridgeClientScript, SENTINEL_HOST } = require('../src/main/pageBridge');

const ENDPOINT = 'https://sg-bridge.invalid/deadbeefdeadbeefdeadbeefdeadbeef';

// Run the injected client in a sandbox with a controllable window + fetch.
function makeWindow({ binding, fetchImpl } = {}) {
  const calls = { binding: [], fetch: [] };
  const win = {};
  if (binding) win.__sgPersonaList = (...args) => { calls.binding.push(args); return binding(...args); };
  const sandbox = {
    window: win,
    Promise,
    Object,
    Array,
    Error,
    JSON,
    encodeURIComponent,
    fetch: (url, opts) => {
      calls.fetch.push({ url, opts });
      return (fetchImpl || (() => Promise.resolve({ json: () => Promise.resolve({ result: 'rpc-ok' }) })))(url, opts);
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`(${bridgeClientScript.toString()})(${JSON.stringify(ENDPOINT)});`, sandbox);
  return { win, calls, sandbox };
}

test('the sentinel host is under .invalid so it can never resolve publicly', () => {
  assert.ok(SENTINEL_HOST.endsWith('.invalid'), 'sentinel must use the reserved .invalid TLD');
});

test('the client script serializes to valid standalone JS (it is injected via toString)', () => {
  const src = `(${bridgeClientScript.toString()})("https://x.invalid/t");`;
  assert.doesNotThrow(() => new Function(src));
  // No closure references to module scope, or injection would throw at runtime.
  assert.ok(!/require\(|module\.exports|MAX_BODY_BYTES/.test(bridgeClientScript.toString()));
});

test('installs window.__sgBridge as a non-enumerable property', () => {
  const { win } = makeWindow();
  assert.equal(typeof win.__sgBridge, 'function');
  const desc = Object.getOwnPropertyDescriptor(win, '__sgBridge');
  assert.equal(desc.enumerable, false, 'an enumerable global is trivially fingerprintable');
});

test('a WORKING native binding is preferred and RPC is not used', async () => {
  const { win, calls } = makeWindow({ binding: async () => ['from-binding'] });
  const out = await win.__sgBridge('__sgPersonaList', 'https://site.test/');
  assert.deepEqual(out, ['from-binding']);
  assert.equal(calls.binding.length, 1);
  assert.deepEqual(calls.binding[0], ['https://site.test/']);
  assert.equal(calls.fetch.length, 0, 'the RPC path must stay unused when the binding works');
});

test('a binding that THROWS SYNCHRONOUSLY falls back to RPC (the anti-detect engine case)', async () => {
  const { win, calls } = makeWindow({
    binding: () => { throw new TypeError('globalThis[(prefix + name)] is not a function'); }
  });
  const out = await win.__sgBridge('__sgPersonaList', 'https://site.test/');
  assert.equal(out, 'rpc-ok', 'must not surface the dead binding as a failure');
  assert.equal(calls.fetch.length, 1);
  assert.ok(calls.fetch[0].url.startsWith(ENDPOINT + '/'), 'RPC must target the tokened endpoint');
  assert.equal(calls.fetch[0].url, ENDPOINT + '/__sgPersonaList');
});

test('with NO binding at all it goes straight to RPC', async () => {
  const { win, calls } = makeWindow();
  const out = await win.__sgBridge('__sgPersonaList', 'https://site.test/');
  assert.equal(out, 'rpc-ok');
  assert.equal(calls.fetch.length, 1);
});

test('all arguments are forwarded — markUsed(id,url) and fillPlan(plan,token) take two', async () => {
  const { win, calls } = makeWindow();
  await win.__sgBridge('__sgPersonaMarkUsed', 'persona-1', 'https://site.test/');
  const body = JSON.parse(calls.fetch[0].opts.body);
  assert.deepEqual(body.args, ['persona-1', 'https://site.test/']);
});

test('the RPC request is a CORS SIMPLE request (no Content-Type -> no preflight to fulfil)', async () => {
  const { win, calls } = makeWindow();
  await win.__sgBridge('__sgPersonaList');
  const opts = calls.fetch[0].opts;
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers, undefined, 'setting Content-Type would trigger an OPTIONS preflight');
  assert.equal(opts.credentials, 'omit');
  assert.equal(opts.cache, 'no-store');
});

test('the method name is URL-encoded rather than interpolated raw', async () => {
  const { win, calls } = makeWindow();
  await win.__sgBridge('../../escape attempt');
  assert.ok(!calls.fetch[0].url.includes('../'), 'path traversal must not survive into the URL');
  assert.ok(calls.fetch[0].url.startsWith(ENDPOINT + '/'));
});

test('an error returned by the handler rejects instead of resolving to undefined', async () => {
  const { win } = makeWindow({
    fetchImpl: () => Promise.resolve({ json: () => Promise.resolve({ error: 'vault locked' }) })
  });
  await assert.rejects(() => win.__sgBridge('__sgPersonaList'), /vault locked/);
});

test('re-running the injected script does not replace an existing bridge', () => {
  const { win, sandbox } = makeWindow({ binding: async () => ['first'] });
  const first = win.__sgBridge;
  vm.runInContext(`(${bridgeClientScript.toString()})("https://other.invalid/zzz");`, sandbox);
  assert.equal(win.__sgBridge, first, 'a second injection must be a no-op, not a rebind');
});
