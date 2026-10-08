'use strict';
// Regression tests for audit E4-E11 (7 Oct): launch races, Firefox session
// lifecycle, geo-lookup failure, and proxy DNS handling.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `could not find function ${name}`);
  // Body brace, not a default-parameter object like (options = {}).
  let i = source.indexOf(') {', start) + 2;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// --- E4: pending profile lock ------------------------------------------------------
const { lockBlocks, PENDING_LOCK, PENDING_LOCK_TTL_MS } = require('../src/main/teamPolicy');

test('E4: a PENDING reservation by another member blocks within its TTL', () => {
  const now = 1_000_000;
  const pending = { memberId: 5, sessionId: PENDING_LOCK, at: now - 1000 };
  assert.equal(lockBlocks(pending, 7, new Set(), now), true, 'a launch in progress must block a second member');
  assert.equal(lockBlocks(pending, 5, new Set(), now), false, 'the launching member itself is not blocked by the lock');
  const expired = { ...pending, at: now - PENDING_LOCK_TTL_MS - 1 };
  assert.equal(lockBlocks(expired, 7, new Set(), now), false, 'a dead launch auto-clears after the TTL');
});

test('E4: live and stale real locks behave as before', () => {
  const lock = { memberId: 5, sessionId: 's5' };
  assert.equal(lockBlocks(lock, 7, new Set(['s5'])), true);
  assert.equal(lockBlocks(lock, 7, new Set()), false);
  assert.equal(lockBlocks(lock, 5, new Set(['s5'])), false);
});

test('E4: launchProfile joins an in-flight launch and releases only its own reservation', () => {
  const src = SRC('main/ipcHandlers.js');
  const launch = extractFunction(src, 'launchProfile');
  assert.match(launch, /if \(profileLaunchesInFlight\.has\(id\)\) return profileLaunchesInFlight\.get\(id\);/);
  assert.match(launch, /await assertCanAccessProfile\(id\);[\s\S]*profileLaunchesInFlight\.has/, 'access is checked before joining');
  assert.match(src, /const reservation = reserveProfileLock\(id, launcher\);/);
  assert.match(src, /releaseReservedLock\(id, reservation\);/);
  assert.match(extractFunction(src, 'releaseReservedLock'), /lock === reservation/);
});

test('E4: releaseReservedLock never drops a lock it does not own', () => {
  const src = SRC('main/ipcHandlers.js');
  const ctx = { profileLocks: new Map(), PENDING_LOCK, currentMemberId: 1 };
  vm.createContext(ctx);
  vm.runInContext(`${extractFunction(src, 'reserveProfileLock')}\n${extractFunction(src, 'releaseReservedLock')}\nthis.reserve = reserveProfileLock; this.release = releaseReservedLock;`, ctx);
  const mine = ctx.reserve(9, { id: 1 });
  const theirs = ctx.reserve(9, { id: 2 }); // a second launch re-reserved
  ctx.release(9, mine);
  assert.equal(ctx.profileLocks.get(9), theirs, 'a failing launch must not clear a newer reservation');
  ctx.release(9, theirs);
  assert.equal(ctx.profileLocks.has(9), false);
});

test('E4: the Chrome engine dedupes a launch that is still starting', () => {
  const src = SRC('main/browserEngine.js');
  const fn = extractFunction(src, 'launchProfileSession');
  assert.match(fn, /chromeLaunching\.has\(key\)\) return chromeLaunching\.get\(key\)/);
  assert.match(fn, /if \(chromeLaunching\.get\(key\) === p\) chromeLaunching\.delete\(key\)/);
});

// --- E5 / E7: Firefox session lifecycle ---------------------------------------------

test('E5: a second Firefox launch for a running or starting profile returns that session', () => {
  const src = SRC('main/firefoxEngine.js');
  const fn = extractFunction(src, 'launchFirefoxProfile');
  assert.match(fn, /const running = ffSessions\.get\(key\);\s*if \(running\) return Promise\.resolve\(\{[^}]*alreadyRunning: true \}\)/);
  assert.match(fn, /if \(ffLaunching\.has\(key\)\) return ffLaunching\.get\(key\);/);
  assert.match(src, /if \(ffSessions\.get\(sessionId\) === session\) ffSessions\.delete\(sessionId\);/,
    'onGone must not delete a newer session registered under the same id');
});

test('E7: Firefox stop is graceful first, forced only after the wait', () => {
  const src = SRC('main/firefoxEngine.js');
  const close = extractFunction(src, 'closeFirefoxSession');
  assert.match(close, /killProcessTree\(session\.proc, false\);\s*const exited = await waitForExit\(session\.proc, FF_GRACEFUL_STOP_MS\);\s*if \(!exited\) killProcessTree\(session\.proc, true\);/);
  assert.match(src, /const FF_GRACEFUL_STOP_MS = 8000;/);
  const kill = extractFunction(src, 'killProcessTree');
  assert.match(kill, /if \(force\) args\.push\('\/F'\);/, 'no /F on the polite attempt');
  assert.match(kill, /proc\.kill\(force \? 'SIGKILL' : 'SIGTERM'\)/);
  assert.match(src, /pref\('browser\.tabs\.warnOnClose', false\);/, 'a close-tabs prompt would block the graceful close');
});

test('E7: waitForExit resolves true on exit and false on timeout', async () => {
  const src = SRC('main/firefoxEngine.js');
  const ctx = { setTimeout, clearTimeout, Promise };
  vm.createContext(ctx);
  vm.runInContext(`${extractFunction(src, 'waitForExit')}\nthis.waitForExit = waitForExit;`, ctx);
  const { EventEmitter } = require('node:events');
  const p1 = new EventEmitter(); p1.exitCode = null; p1.signalCode = null;
  const r1 = ctx.waitForExit(p1, 1000);
  setTimeout(() => p1.emit('exit', 0), 5);
  assert.equal(await r1, true);
  const p2 = new EventEmitter(); p2.exitCode = null; p2.signalCode = null;
  assert.equal(await ctx.waitForExit(p2, 20), false);
  assert.equal(await ctx.waitForExit({ exitCode: 0, signalCode: null }, 20), true, 'already exited');
});

// --- E6: geo lookup failure ---------------------------------------------------------
const be = require('../src/main/browserEngine');

test('E6: the last geo a proxy resolved to is remembered per proxy (credentials included)', () => {
  const a = { type: 'HTTP', host: 'gw.example', port: 8000, username: 'user-country-de', password: 'x' };
  const b = { ...a, username: 'user-country-fr' };
  be.rememberProxyGeo(a, { timezone: 'Europe/Berlin', countryCode: 'DE' });
  assert.equal(be.lastKnownProxyGeo(a).timezone, 'Europe/Berlin');
  assert.equal(be.lastKnownProxyGeo(b), null, 'a different sticky session must not inherit it');
  be.rememberProxyGeo(b, { countryCode: 'FR' }); // no timezone -> not worth remembering
  assert.equal(be.lastKnownProxyGeo(b), null);
});

test('E6: a failed lookup falls back to the last known geo, else the launch reports geoWarning', () => {
  const src = SRC('main/browserEngine.js');
  assert.match(src, /if \(geoApplies && !timezoneId\) \{\s*const lk = lastKnownProxyGeo\(resolvedProxy\);/);
  assert.match(src, /const geoWarning = \(geoApplies && !timezoneId\) \? GEO_DEGRADED_WARNING : null;/);
  assert.match(src, /injectionOk: !injectionDegraded, geoDegraded: Boolean\(geoWarning\), geoWarning \}/);
  const ff = SRC('main/firefoxEngine.js');
  assert.match(ff, /proxyGeo = require\('\.\/browserEngine'\)\.lastKnownProxyGeo\(proxy\)/);
  assert.match(ff, /geoDegraded: Boolean\(geoWarning\), geoWarning \}/);
});

// --- E8 / E9 / E10: proxy DNS --------------------------------------------------------

test('E8: a SOCKS4 proxy on Chrome is refused with the DNS-leak reason', () => {
  const src = SRC('main/browserEngine.js');
  assert.match(src, /if \(proxyTypeLc === 'socks4'\) \{\s*const e = new Error\('This profile uses a SOCKS4 proxy\. Chrome cannot send DNS lookups through SOCKS4/);
  assert.match(src, /e\.code = 'SOCKS4_DNS_LEAK';/);
  assert.doesNotMatch(src, /resolves hostnames PROXY-SIDE \(HTTP CONNECT and SOCKS5\s*\/\/\s*remote DNS\)/, 'the misleading comment is gone');
  // The scheme mapper itself stays exact (the proxy checker and tests rely on it).
  assert.equal(be.buildProxyServerArgument({ type: 'SOCKS4', host: '1.2.3.4', port: 1080 }), 'socks4://1.2.3.4:1080');
});

test('E9/E10: one proxy-agent scheme mapper - socks5h for SOCKS5, socks4 kept as socks4', () => {
  const src = SRC('main/ipcHandlers.js');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${extractFunction(src, 'proxyAgentScheme')}\nthis.f = proxyAgentScheme;`, ctx);
  assert.equal(ctx.f('SOCKS5'), 'socks5h', 'remote DNS through the proxy');
  assert.equal(ctx.f('SOCKS4'), 'socks4', 'the deep check used to send SOCKS4 as http');
  assert.equal(ctx.f('HTTP'), 'http');
  assert.match(extractFunction(src, 'testProxyConnectivity'), /const scheme = proxyAgentScheme\(proxy\.type\);/);
  assert.match(extractFunction(src, 'buildProxyAgent'), /const scheme = proxyAgentScheme\(proxy\.type\);/);
  assert.match(SRC('main/browserEngine.js'), /const scheme = schemeLc === 'socks5' \? 'socks5h' :/, 'the launch geo lookup too');
});

// --- E11: parallel macro runs --------------------------------------------------------
const { runParallelMacro } = require('../src/main/parallelRunner');

test('E11: a profile listed twice runs once', async () => {
  const launched = [];
  const summary = await runParallelMacro({
    runId: 'r', steps: [{ type: 'goto', url: 'https://a' }], concurrency: 3,
    items: [{ profileId: 1 }, { profileId: 2 }, { profileId: 1 }]
  }, {
    isOpen: () => false,
    launch: async (pid) => { launched.push(pid); return { sessionId: String(pid) }; },
    runMacro: async () => ({ ok: true, ran: 1, total: 1, log: [] }),
    close: async () => {},
    emit: () => {}
  });
  assert.deepEqual(launched.sort(), [1, 2]);
  assert.equal(summary.total, 2);
});

test('E11: a launch that found the profile already running is never closed by the run', async () => {
  const closed = [];
  await runParallelMacro({
    runId: 'r2', steps: [{ type: 'goto', url: 'https://a' }], concurrency: 2, closeWhenDone: true,
    items: [{ profileId: 1 }, { profileId: 2 }]
  }, {
    isOpen: () => false, // e.g. a Firefox session the Chrome-only isOpen cannot see
    launch: async (pid) => ({ sessionId: String(pid), alreadyRunning: pid === 1 }),
    runMacro: async () => ({ ok: true, ran: 1, total: 1, log: [] }),
    close: async (sid) => { closed.push(sid); },
    emit: () => {}
  });
  assert.deepEqual(closed, ['2'], 'only the session this run started is closed');
});
