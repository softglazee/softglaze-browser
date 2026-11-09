'use strict';
// "Copy for SoftGlaze Proxy" (9 Nov 2026): the Proxies page copies the selected proxies as lines
// the SoftGlaze Proxy browser extension's Bulk import reads, scheme://user:pass@host:port.
//
// - The scheme is always written, so a SOCKS5 proxy is never read as HTTP (host:1080:user:pass was).
// - Usernames and passwords are percent-encoded; the extension decodes them.
// - Logins go along only when asked and only for roles that may see proxy credentials
//   (`proxies.reveal`), checked in the main process before any proxy row is read.
// - The main process writes the clipboard and returns counts only, so passwords never reach the
//   renderer; the clipboard is cleared after 2 minutes if it still holds the list.
// - One activity-log row per copy: the count and whether logins went along. No hosts or passwords.
//
// Electron, the database and the clipboard are stubs; nothing here opens a socket.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const json = (...p) => JSON.parse(read(...p).replace(/^﻿/, ''));

const exp = require('../src/main/proxyExtensionExport');
const permissions = require('../src/main/permissions');
const IPC = read('src', 'main', 'ipcHandlers.js');

// The extension's documented reading of a scheme://user:pass@host:port line (SoftGlaze Proxy
// src/lib/parse.js parseProxyLine): the login ends at the LAST '@', the username ends at the FIRST
// ':', and a field holding %XX is percent-decoded. A copy of that rule, so this repo's tests do not
// need the extension's source. (The PR was also checked against the extension's real parser.)
function readLikeExtension(line) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(line);
  assert.ok(m, `no scheme in ${line}`);
  const rest = m[2];
  const decode = (v) => { if (!/%[0-9a-fA-F]{2}/.test(v)) return v; try { return decodeURIComponent(v); } catch (e) { return v; } };
  const at = rest.lastIndexOf('@');
  let username = '';
  let password = '';
  let hostPort = rest;
  if (at !== -1) {
    const info = rest.slice(0, at);
    const sep = info.indexOf(':');
    username = decode(sep === -1 ? info : info.slice(0, sep));
    password = sep === -1 ? '' : decode(info.slice(sep + 1));
    hostPort = rest.slice(at + 1);
  }
  let host;
  let port;
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    host = hostPort.slice(1, close);
    port = hostPort.slice(close + 2);
  } else {
    const i = hostPort.lastIndexOf(':');
    host = hostPort.slice(0, i);
    port = hostPort.slice(i + 1);
  }
  return { scheme: m[1], host, port: Number(port), username, password };
}

// ---- the line formatter -----------------------------------------------------------------------

test('every app proxy type is written with its scheme', () => {
  const base = { host: '203.0.113.7', port: 1080, username: '', password: '' };
  const cases = [
    ['HTTP', 'http'], ['http', 'http'], ['HTTPS', 'https'],
    ['SOCKS5', 'socks5'], ['SOCKS', 'socks5'], ['SOCKS5H', 'socks5'],
    ['SOCKS4', 'socks4'], ['SOCKS4A', 'socks4']
  ];
  for (const [type, scheme] of cases) {
    assert.equal(exp.formatExtensionLine({ ...base, type }), `${scheme}://203.0.113.7:1080`, type);
  }
});

test('a SOCKS5 proxy on port 1080 with a login is never written in the ambiguous colon form', () => {
  const line = exp.formatExtensionLine({ type: 'SOCKS5', host: 'socks-s1.example.net', port: 1080, username: 'user', password: 'pass' }, { includeCredentials: true });
  assert.equal(line, 'socks5://user:pass@socks-s1.example.net:1080');
  assert.doesNotMatch(line, /:1080:user:pass/);
  // An HTTP proxy on a "SOCKS-looking" port says http, so the extension does not guess SOCKS5.
  assert.equal(exp.formatExtensionLine({ type: 'HTTP', host: 'gw.example.net', port: 1080 }), 'http://gw.example.net:1080');
});

test('without the box ticked no username or password is written', () => {
  const p = { type: 'HTTP', host: 'gw.example.net', port: 8080, username: 'alice', password: 's3cret' };
  assert.equal(exp.formatExtensionLine(p), 'http://gw.example.net:8080');
  assert.equal(exp.formatExtensionLine(p, { includeCredentials: false }), 'http://gw.example.net:8080');
  const all = exp.buildExtensionExport([p, { ...p, type: 'SOCKS5' }]);
  assert.doesNotMatch(all.text, /alice|s3cret|@/);
});

test('special characters in usernames and passwords survive the extension\'s reading', () => {
  const passwords = ['p@ss:w/rd#1 x', 'a@b@c', '::', '/#?', ' lead', '50%off', '%41literal', 'üñí©ødé', 'tab\there', 'plus+and=amp&', "quote'\"`", 'back\\slash'];
  const users = ['user', 'us:er', 'us@er', 'user-zone-res_session-abc', 'u%20x', 'sp ace'];
  for (const type of ['HTTP', 'HTTPS', 'SOCKS5']) {
    for (const username of users) {
      for (const password of passwords) {
        const p = { type, host: 'gw.example.net', port: 8000, username, password };
        const line = exp.formatExtensionLine(p, { includeCredentials: true });
        assert.doesNotMatch(line, /\s/, 'no raw whitespace in a line');
        const r = readLikeExtension(line);
        assert.deepEqual(r, { scheme: exp.extensionScheme(type), host: 'gw.example.net', port: 8000, username, password }, line);
      }
    }
  }
});

test('a username alone, a password alone and IPv6 hosts are written so they read back', () => {
  const userOnly = exp.formatExtensionLine({ type: 'HTTP', host: 'h.example', port: 1, username: 'only', password: '' }, { includeCredentials: true });
  assert.equal(userOnly, 'http://only@h.example:1');
  assert.deepEqual(readLikeExtension(userOnly), { scheme: 'http', host: 'h.example', port: 1, username: 'only', password: '' });
  const passOnly = exp.formatExtensionLine({ type: 'HTTP', host: 'h.example', port: 2, username: null, password: 'p:w' }, { includeCredentials: true });
  assert.equal(passOnly, 'http://:p%3Aw@h.example:2');
  assert.deepEqual(readLikeExtension(passOnly), { scheme: 'http', host: 'h.example', port: 2, username: '', password: 'p:w' });
  const v6 = exp.formatExtensionLine({ type: 'SOCKS5', host: '2001:db8::1', port: 1080, username: 'u', password: 'p@' }, { includeCredentials: true });
  assert.equal(v6, 'socks5://u:p%40@[2001:db8::1]:1080');
  assert.deepEqual(readLikeExtension(v6), { scheme: 'socks5', host: '2001:db8::1', port: 1080, username: 'u', password: 'p@' });
  assert.equal(exp.formatExtensionLine({ type: 'HTTP', host: '[2001:db8::2]', port: 80 }), 'http://[2001:db8::2]:80', 'stored brackets are not doubled');
});

test('SOCKS4 lines never carry a login (the extension refuses one)', () => {
  const p = { type: 'SOCKS4', host: '198.51.100.4', port: 1080, username: 'id', password: 'pw' };
  assert.equal(exp.formatExtensionLine(p, { includeCredentials: true }), 'socks4://198.51.100.4:1080');
  const out = exp.buildExtensionExport([p], { includeCredentials: true });
  assert.equal(out.socks4LoginLeftOut, 1);
  assert.equal(exp.buildExtensionExport([p], { includeCredentials: false }).socks4LoginLeftOut, 0);
});

test('a proxy the extension cannot read is left out and counted', () => {
  const bad = [
    { type: 'FTP', host: 'h.example', port: 21 },
    { type: 'HTTP', host: '', port: 80 },
    { type: 'HTTP', host: 'h.example', port: 0 },
    { type: 'HTTP', host: 'h.example', port: 70000 },
    { type: 'HTTP', host: 'h.example', port: '8080x' },
    { type: 'HTTP', host: 'evil.example/path', port: 80 },
    { type: 'HTTP', host: 'h.example', port: 80, username: 'u', password: '\uD800' } // lone surrogate
  ];
  assert.equal(exp.formatExtensionLine(bad[6]), 'http://h.example:80', 'fine without the login');
  const out = exp.buildExtensionExport([{ type: 'HTTP', host: 'ok.example', port: 80 }, ...bad], { includeCredentials: true });
  assert.equal(out.count, 1);
  assert.equal(out.skipped, 7);
  assert.equal(out.text, 'http://ok.example:80');
  assert.equal(exp.formatExtensionLine(null), null);
});

test('the export keeps the order given, one line each, and the summary has counts only', () => {
  const list = [
    { type: 'HTTP', host: 'a.example', port: 1, username: 'u', password: 'p' },
    { type: 'SOCKS5', host: 'b.example', port: 2, username: 'u', password: 'p' },
    { type: 'SOCKS4', host: 'c.example', port: 3, username: 'u', password: '' },
    { type: 'HTTPS', host: 'd.example', port: 4 },
    { type: 'NOPE', host: 'e.example', port: 5 }
  ];
  const out = exp.buildExtensionExport(list, { includeCredentials: true });
  assert.deepEqual(out.text.split('\n'), ['http://u:p@a.example:1', 'socks5://u:p@b.example:2', 'socks4://c.example:3', 'https://d.example:4']);
  assert.equal(out.count, 4);
  const s = exp.summarize(list);
  assert.deepEqual(s, { count: 4, skipped: 1, withLogin: 3, socks5WithLogin: 1, socks4WithLogin: 1 });
  assert.doesNotMatch(JSON.stringify(s), /example|"u"|"p"/);
});

// ---- the clipboard ----------------------------------------------------------------------------

function fakeClipboard(initial = '') {
  let text = initial;
  const calls = [];
  return {
    calls,
    writeText(v) { calls.push(['write', v]); text = v; },
    readText() { calls.push(['read']); return text; },
    clear() { calls.push(['clear']); text = ''; },
    set(v) { text = v; },
    get() { return text; }
  };
}
function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer(fn, ms) { const t = { fn, ms, cancelled: false, unref() { this.unrefd = true; } }; timers.push(t); return t; },
    clearTimer(t) { if (t) t.cancelled = true; },
    runAll() { for (const t of timers.splice(0)) if (!t.cancelled) t.fn(); }
  };
}

test('the clipboard is cleared after 2 minutes when it still holds the copied list', () => {
  const cb = fakeClipboard('old');
  const tm = fakeTimers();
  const guard = exp.createClipboardGuard({ clipboard: cb, setTimer: tm.setTimer, clearTimer: tm.clearTimer });
  const r = guard.write('http://a.example:1');
  assert.equal(r.clearAfterMs, 120000);
  assert.equal(exp.CLEAR_AFTER_MS, 120000);
  assert.equal(cb.get(), 'http://a.example:1');
  assert.equal(tm.timers.length, 1);
  assert.equal(tm.timers[0].ms, 120000);
  assert.equal(tm.timers[0].unrefd, true, 'the timer does not keep the app alive');
  assert.equal(guard.hasPending(), true);
  tm.runAll();
  assert.equal(cb.get(), '');
  assert.equal(guard.hasPending(), false);
});

test('the clipboard is left alone when the user copied something else since', () => {
  const cb = fakeClipboard();
  const tm = fakeTimers();
  const guard = exp.createClipboardGuard({ clipboard: cb, setTimer: tm.setTimer, clearTimer: tm.clearTimer });
  guard.write('http://a.example:1');
  cb.set('something the user copied');
  tm.runAll();
  assert.equal(cb.get(), 'something the user copied');
  assert.ok(!cb.calls.some((c) => c[0] === 'clear'));
});

test('Windows line ends still count as the same text', () => {
  const cb = fakeClipboard();
  const tm = fakeTimers();
  const guard = exp.createClipboardGuard({ clipboard: cb, setTimer: tm.setTimer, clearTimer: tm.clearTimer });
  guard.write('http://a.example:1\nhttp://b.example:2');
  cb.set('http://a.example:1\r\nhttp://b.example:2');
  tm.runAll();
  assert.equal(cb.get(), '');
});

test('a second copy replaces the first one\'s pending clear', () => {
  const cb = fakeClipboard();
  const tm = fakeTimers();
  const guard = exp.createClipboardGuard({ clipboard: cb, setTimer: tm.setTimer, clearTimer: tm.clearTimer });
  guard.write('first');
  const first = tm.timers[0];
  guard.write('second');
  assert.equal(first.cancelled, true);
  tm.runAll();
  assert.equal(cb.get(), '');
  assert.deepEqual(cb.calls.filter((c) => c[0] === 'clear').length, 1);
});

test('a clipboard that cannot be read is not cleared, and a missing clipboard is an error', () => {
  const cb = fakeClipboard();
  cb.readText = () => { throw new Error('busy'); };
  const tm = fakeTimers();
  exp.createClipboardGuard({ clipboard: cb, setTimer: tm.setTimer, clearTimer: tm.clearTimer }).write('x');
  assert.doesNotThrow(() => tm.runAll());
  assert.equal(cb.get(), 'x');
  assert.throws(() => exp.createClipboardGuard({}), /No clipboard/);
});

// ---- the IPC handlers and the role check -------------------------------------------------------

// Source of `function name(...) { ... }` (async or not), from the body's opening brace.
function extractFunction(source, name) {
  const m = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(m, `could not find function ${name} in source`);
  let i = source.indexOf(') {', m.index) + 2;
  let depth = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(m.index, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

const ROWS = [
  { id: 1, type: 'HTTP', host: 'gw.example.net', port: 8080, username: 'alice', password: 'p@ss:w/rd#1 x', createdAt: 1 },
  { id: 2, type: 'SOCKS5', host: 'socks.example.net', port: 1080, username: 'bob', password: 'hunter2', createdAt: 2 }
];

// The real handlers and requirePermission from ipcHandlers.js, with a stub member, database,
// clipboard and audit log. member: null (single-user), or { role, status?, permissionsJson? }.
function loadHandlers(member, { accessible = [1, 2] } = {}) {
  const state = { audits: [], writes: [], reads: 0 };
  const ctx = {
    module: {},
    Error, TypeError, Number, String, Math, Array, Promise, JSON,
    permissions,
    PERMISSIONS: permissions.ACTION_MIN_RANK,
    rankOf: permissions.rankOf,
    proxyExtensionExport: exp,
    getActiveMember: async () => member,
    partitionAccessibleProxyIds: async (ids) => ({ allowed: ids.filter((id) => accessible.includes(id)), denied: ids.filter((id) => !accessible.includes(id)) }),
    getPrisma: () => ({ proxy: { findMany: async ({ where }) => { state.reads += 1; return ROWS.filter((r) => where.id.in.includes(r.id)); } } }),
    logAudit: async (action, opts) => { state.audits.push({ action, opts }); },
    extensionClipboard: () => ({ write: (text) => { state.writes.push(text); return { clearAfterMs: 120000 }; } })
  };
  vm.createContext(ctx);
  vm.runInContext([
    extractFunction(IPC, 'requireObject'),
    extractFunction(IPC, 'parseId'),
    extractFunction(IPC, 'parseIdArray'),
    extractFunction(IPC, 'requirePermission'),
    extractFunction(IPC, 'canRevealProxyCredentials'),
    extractFunction(IPC, 'extensionCopyRows'),
    extractFunction(IPC, 'getProxyExtensionCopyInfo'),
    extractFunction(IPC, 'copyProxiesForExtension'),
    'module.exports = { getProxyExtensionCopyInfo, copyProxiesForExtension };'
  ].join('\n'), ctx);
  return { ...ctx.module.exports, state };
}

const MEMBERS = {
  single: null,
  operator: { id: 5, role: 'OPERATOR', status: 'active' },
  manager: { id: 4, role: 'MANAGER', status: 'active' },
  managerRevoked: { id: 6, role: 'MANAGER', status: 'active', permissionsJson: JSON.stringify({ actions: { 'proxies.reveal': false } }) },
  admin: { id: 3, role: 'ADMIN', status: 'active' },
  adminSuspended: { id: 7, role: 'ADMIN', status: 'suspended' },
  owner: { id: 2, role: 'OWNER', status: 'active' },
  superAdmin: { id: -1, role: 'SUPER_ADMIN', status: 'active' }
};
const MAY_REVEAL = new Set(['single', 'manager', 'admin', 'owner', 'superAdmin']);

test('only roles that may see proxy credentials can include them; the rest are refused before any row is read', async () => {
  for (const [name, member] of Object.entries(MEMBERS)) {
    const h = loadHandlers(member);
    if (MAY_REVEAL.has(name)) {
      const r = await h.copyProxiesForExtension({ ids: [1, 2], includeCredentials: true });
      assert.equal(r.includedCredentials, true, name);
      assert.equal(h.state.writes.length, 1, name);
      assert.match(h.state.writes[0], /^http:\/\/alice:p%40ss%3Aw%2Frd%231%20x@gw\.example\.net:8080\nsocks5:\/\/bob:hunter2@socks\.example\.net:1080$/, name);
    } else {
      await assert.rejects(h.copyProxiesForExtension({ ids: [1, 2], includeCredentials: true }), (e) => e.code === 'FORBIDDEN' && /cannot copy proxy usernames and passwords/.test(e.message), name);
      assert.equal(h.state.reads, 0, `${name}: no proxy row read`);
      assert.equal(h.state.writes.length, 0, `${name}: nothing on the clipboard`);
      assert.equal(h.state.audits.length, 0, `${name}: nothing logged`);
    }
  }
});

test('every role can copy without credentials, and then no login is written', async () => {
  for (const [name, member] of Object.entries(MEMBERS)) {
    if (name === 'adminSuspended') continue; // see the next test
    const h = loadHandlers(member);
    const r = await h.copyProxiesForExtension({ ids: [1, 2] });
    assert.equal(r.copied, 2, name);
    assert.equal(r.includedCredentials, false, name);
    assert.equal(h.state.writes[0], 'http://gw.example.net:8080\nsocks5://socks.example.net:1080', name);
  }
});

test('only a real true includes credentials', async () => {
  for (const v of ['true', 1, 'yes', {}, null, undefined]) {
    const h = loadHandlers(MEMBERS.owner);
    const r = await h.copyProxiesForExtension({ ids: [1], includeCredentials: v });
    assert.equal(r.includedCredentials, false, String(v));
    assert.doesNotMatch(h.state.writes[0], /alice|@/, String(v));
  }
});

test('the reply carries counts only: no lines, hosts, usernames or passwords reach the renderer', async () => {
  const h = loadHandlers(MEMBERS.owner);
  const r = await h.copyProxiesForExtension({ ids: [1, 2], includeCredentials: true });
  assert.deepEqual({ ...r }, { copied: 2, skipped: 0, includedCredentials: true, socks4LoginLeftOut: 0, clearAfterSeconds: 120 });
  const info = await h.getProxyExtensionCopyInfo({ ids: [1, 2] });
  assert.deepEqual({ ...info }, { count: 2, skipped: 0, withLogin: 2, socks5WithLogin: 1, socks4WithLogin: 0, canIncludeCredentials: true });
  for (const out of [r, info]) assert.doesNotMatch(JSON.stringify(out), /example|alice|bob|hunter2|p@ss/);
});

test('the dialog info tells each role whether it may include credentials', async () => {
  for (const [name, member] of Object.entries(MEMBERS)) {
    const info = await loadHandlers(member).getProxyExtensionCopyInfo({ ids: [1, 2] });
    assert.equal(info.canIncludeCredentials, MAY_REVEAL.has(name), name);
  }
});

test('one activity-log row per copy: the count and whether logins went along, nothing else', async () => {
  const h = loadHandlers(MEMBERS.manager);
  await h.copyProxiesForExtension({ ids: [1, 2], includeCredentials: true });
  await h.copyProxiesForExtension({ ids: [2] });
  assert.equal(h.state.audits.length, 2);
  assert.equal(h.state.audits[0].action, 'proxy.copied_for_extension');
  assert.deepEqual({ ...h.state.audits[0].opts.detail }, { count: 2, credentials: true });
  assert.deepEqual({ ...h.state.audits[1].opts.detail }, { count: 1, credentials: false });
  assert.doesNotMatch(JSON.stringify(h.state.audits), /example|alice|bob|hunter2|p@ss|8080|1080/);
});

test('only proxies this member may see are copied; none at all is refused', async () => {
  const h = loadHandlers(MEMBERS.manager, { accessible: [2] });
  const r = await h.copyProxiesForExtension({ ids: [1, 2], includeCredentials: true });
  assert.equal(r.copied, 1);
  assert.doesNotMatch(h.state.writes[0], /gw\.example\.net/);
  const none = loadHandlers(MEMBERS.manager, { accessible: [] });
  await assert.rejects(none.copyProxiesForExtension({ ids: [1] }), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(none.getProxyExtensionCopyInfo({ ids: [1] }), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(loadHandlers(null).copyProxiesForExtension({ ids: [] }), /non-empty/);
  await assert.rejects(loadHandlers(null).copyProxiesForExtension(null), /must be an object/);
});

// ---- wiring and the dialog ---------------------------------------------------------------------

test('the channels are registered in main and exposed by the preload, and main writes the clipboard', () => {
  assert.match(IPC, /PROXY_EXTENSION_COPY_INFO: 'proxy:extension-copy-info'/);
  assert.match(IPC, /PROXY_EXTENSION_COPY: 'proxy:extension-copy'/);
  assert.match(IPC, /registerHandler\(CHANNELS\.PROXY_EXTENSION_COPY_INFO, getProxyExtensionCopyInfo\)/);
  assert.match(IPC, /registerHandler\(CHANNELS\.PROXY_EXTENSION_COPY, copyProxiesForExtension\)/);
  assert.match(IPC, /createClipboardGuard\(\{ clipboard: require\('electron'\)\.clipboard \}\)/);
  const preload = read('src', 'preload', 'preload.js');
  assert.match(preload, /extensionCopyInfo: \(ids\) => invoke\(CHANNELS\.PROXY_EXTENSION_COPY_INFO, \{ ids \}\)/);
  assert.match(preload, /copyForExtension: \(ids, includeCredentials\) => invoke\(CHANNELS\.PROXY_EXTENSION_COPY, \{ ids, includeCredentials: includeCredentials === true \}\)/);
  const api = read('src', 'renderer', 'lib', 'softglazeApi.js');
  assert.match(api, /extensionCopyInfo: \(ids\) => getSoftglazeApi\(\)\.proxies\.extensionCopyInfo\(ids\)/);
  assert.match(api, /copyForExtension: \(ids, includeCredentials\) => getSoftglazeApi\(\)\.proxies\.copyForExtension\(ids, includeCredentials\)/);
});

test('the dialog starts unticked, never touches the clipboard itself, and links to the extension', () => {
  const dlg = read('src', 'renderer', 'components', 'CopyForProxyExtensionDialog.jsx');
  assert.match(dlg, /const \[includeCredentials, setIncludeCredentials\] = useState\(false\)/);
  assert.match(dlg, /setIncludeCredentials\(false\);/, 'reset each time it opens');
  assert.match(dlg, /disabled=\{!canInclude \|\| copying\}/, 'disabled for roles that may not see credentials');
  assert.match(dlg, /info\.canIncludeCredentials/);
  assert.match(dlg, /t\('copyForExtension\.credsNoRole'\)/);
  assert.match(dlg, /softglazeApi\.proxies\.copyForExtension\(ids, withCreds\)/);
  assert.doesNotMatch(dlg, /navigator\.clipboard/, 'main writes the clipboard');
  assert.match(dlg, /https:\/\/browser\.softglaze\.com\/proxy-extension/);
  assert.match(dlg, /t\('copyForExtension\.clipboardWarning'\)/);

  const page = read('src', 'renderer', 'pages', 'ProxyPoolPage.jsx');
  assert.match(page, /import CopyForProxyExtensionDialog from '@\/components\/CopyForProxyExtensionDialog\.jsx'/);
  assert.match(page, /onClick=\{openExtensionCopy\}/);
  assert.match(page, /<CopyForProxyExtensionDialog\s+open=\{extensionCopyIds != null\}/);
});

test('every dialog string exists in English and Spanish', () => {
  const dlg = read('src', 'renderer', 'components', 'CopyForProxyExtensionDialog.jsx');
  const used = [...dlg.matchAll(/copyForExtension\.(\w+)/g)].map((m) => m[1]).filter((k, i, a) => a.indexOf(k) === i);
  assert.ok(used.length >= 15, `found ${used.length} keys`);
  for (const lng of ['en', 'es']) {
    const p = json('src', 'renderer', 'i18n', 'locales', lng, 'proxies.json');
    for (const k of used) assert.equal(typeof p.copyForExtension[k], 'string', `${lng} copyForExtension.${k}`);
    assert.equal(typeof p.selection.copyForExtension, 'string', `${lng} selection.copyForExtension`);
    assert.equal(typeof json('src', 'renderer', 'i18n', 'locales', lng, 'members.json').activityActions.proxies_copied_for_extension, 'string');
  }
  const en = json('src', 'renderer', 'i18n', 'locales', 'en', 'proxies.json').copyForExtension;
  assert.equal(en.includeCredentials, 'Include usernames and passwords');
  assert.equal(en.getExtension, 'Get the SoftGlaze Proxy extension');
  assert.match(en.clipboardWarning, /Other programs .* can read the clipboard/);
});
