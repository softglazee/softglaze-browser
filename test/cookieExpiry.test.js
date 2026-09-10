'use strict';
// Regression tests for cookie import expiry handling.
//
// Background: toSetCookieParam only ever read `c.expires`, but every browser
// cookie-extension export (EditThisCookie, Cookie-Editor, Cookiebro) writes
// `expirationDate` instead. A CDP CookieParam with no `expires` is a SESSION cookie, so
// importing a normal cookie file silently downgraded every persistent login to one that
// dies when the browser closes - the exact opposite of what a profile is for, and
// invisible until the account was found logged out. cookieHealth was blind the same way,
// so it reported the whole import as session cookies and nobody noticed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const IPC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipcHandlers.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `could not find function ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

function build(names) {
  const ctx = { module: {}, exports: {} };
  vm.createContext(ctx);
  const src = names.map((n) => extractFunction(IPC, n)).join('\n');
  vm.runInContext(`${src}; module.exports = { ${names.join(', ')} };`, ctx);
  return ctx.module.exports;
}

const { cookieExpirySeconds, toSetCookieParam, cookieHealth } = build([
  'cookieExpirySeconds', 'toSetCookieParam', 'cookieHealth'
]);

const FUTURE = 1893456000; // 2030-01-01, unix seconds

// --- 1) every dialect an exporter might use --------------------------------

test('CDP `expires` still works', () => {
  assert.equal(cookieExpirySeconds({ expires: FUTURE }), FUTURE);
});

test('extension `expirationDate` is honoured, not ignored', () => {
  assert.equal(cookieExpirySeconds({ expirationDate: FUTURE }), FUTURE,
    'this is the field EditThisCookie and Cookie-Editor actually write');
  assert.equal(cookieExpirySeconds({ expirationDate: FUTURE + 0.5 }), FUTURE + 0.5,
    'a fractional expiry must survive');
});

test('an explicit session flag wins over any date', () => {
  assert.equal(cookieExpirySeconds({ session: true, expirationDate: FUTURE }), 0,
    'exporters mark true session cookies with session:true and a stale date beside it');
});

test('a millisecond value is converted, not treated as seconds', () => {
  assert.equal(cookieExpirySeconds({ expirationDate: FUTURE * 1000 }), FUTURE,
    'left raw this lands ~50000 years out, which some sites reject outright');
});

test('an ISO-8601 string is parsed', () => {
  assert.equal(cookieExpirySeconds({ expires: '2030-01-01T00:00:00Z' }), FUTURE);
});

test('missing, zero, negative and unparseable all mean session', () => {
  for (const c of [{}, { expires: 0 }, { expires: -1 }, { expires: '' }, { expires: 'never' }, { expirationDate: null }]) {
    assert.equal(cookieExpirySeconds(c), 0, `${JSON.stringify(c)} must be a session cookie`);
  }
  assert.equal(cookieExpirySeconds(null), 0);
});

// --- 2) the CDP param actually carries it ----------------------------------

test('toSetCookieParam sets expires from an extension-format cookie', () => {
  const p = toSetCookieParam({ name: 'sid', value: 'x', domain: '.example.com', expirationDate: FUTURE });
  assert.equal(p.expires, FUTURE,
    'without this the cookie is imported as a session cookie and dies on browser close');
});

test('toSetCookieParam leaves a genuine session cookie alone', () => {
  const p = toSetCookieParam({ name: 'sid', value: 'x', domain: '.example.com' });
  assert.equal(p.expires, undefined, 'no expiry means session, which is correct here');
});

test('toSetCookieParam still requires a domain or url, and keeps its other fields', () => {
  assert.equal(toSetCookieParam({ name: 'sid', value: 'x' }), null);
  const p = toSetCookieParam({
    name: 'sid', value: 'x', domain: '.example.com', path: '/app',
    secure: true, httpOnly: true, sameSite: 'Lax', expirationDate: FUTURE
  });
  assert.equal(p.path, '/app');
  assert.equal(p.secure, true);
  assert.equal(p.httpOnly, true);
  assert.equal(p.sameSite, 'Lax');
});

// --- 3) the health summary is no longer blind ------------------------------

test('cookieHealth counts an extension-format cookie as persistent, not session', () => {
  const h = cookieHealth([
    { name: 'a', domain: '.example.com', expirationDate: FUTURE },
    { name: 'b', domain: '.example.com', expires: FUTURE },
    { name: 'c', domain: '.example.com' },
    { name: 'd', domain: '.example.com', expirationDate: 1000 } // long past
  ]);
  assert.equal(h.total, 4);
  assert.equal(h.session, 1, 'only the cookie with no expiry at all is a session cookie');
  assert.equal(h.expired, 1);
});
