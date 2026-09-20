'use strict';
// Omnibox search guard.
//
// ungoogled-chromium's default engine is a fake "No Search" whose template is literally
// `http://{searchTerms}` (confirmed by reading a live profile's Default/Web Data: the
// row with prepopulate_id 1). Typing `softglaze` therefore navigates to
// http://softglaze, which through a proxy returns a gateway 502.
//
// The rewrite must be surgical: it may only fire on the shape that broken template
// produces, and must never hijack a real destination the user meant.

const test = require('node:test');
const assert = require('node:assert/strict');

// browserEngine pulls in electron, which cannot be required from a plain test process.
// Load the module's source and evaluate just the pure helper, the same trick the other
// engine-level tests use.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'browserEngine.js'), 'utf8');
const start = SRC.indexOf('const DEFAULT_SEARCH_TEMPLATE');
const end = SRC.indexOf('function attachOmniboxSearchGuard');
assert.ok(start !== -1 && end > start, 'omnibox helper block not found in browserEngine.js');
const ctx = { URL, encodeURIComponent, module: {}, exports: {} };
vm.createContext(ctx);
vm.runInContext(SRC.slice(start, end) + '\n;this.omniboxSearchUrl = omniboxSearchUrl;', ctx);
const omniboxSearchUrl = ctx.omniboxSearchUrl;

test('a single-label http host is rewritten to a search', () => {
  const out = omniboxSearchUrl('http://softglaze/');
  assert.equal(out, 'https://www.google.com/search?q=softglaze');
});

test('what the user typed after the host is preserved', () => {
  assert.equal(omniboxSearchUrl('http://softglaze/browser'), 'https://www.google.com/search?q=softglaze%2Fbrowser');
});

test('a custom search template is honoured', () => {
  assert.equal(
    omniboxSearchUrl('http://softglaze/', 'https://duckduckgo.com/?q={searchTerms}'),
    'https://duckduckgo.com/?q=softglaze'
  );
  // A template missing the placeholder must not produce a broken URL.
  assert.equal(omniboxSearchUrl('http://softglaze/', 'https://example.com/'), 'https://www.google.com/search?q=softglaze');
});

test('real destinations are never hijacked', () => {
  assert.equal(omniboxSearchUrl('http://softglaze.com/'), null, 'a real domain must pass through');
  assert.equal(omniboxSearchUrl('https://softglaze/'), null, 'https single label is deliberate');
  assert.equal(omniboxSearchUrl('http://localhost/'), null, 'localhost is a developer target');
  assert.equal(omniboxSearchUrl('http://intranet.corp/'), null, 'dotted intranet host is real');
  assert.equal(omniboxSearchUrl('http://192.168.1.1/'), null, 'IP literal is a real target');
  assert.equal(omniboxSearchUrl('http://[::1]/'), null, 'IPv6 literal is a real target');
  assert.equal(omniboxSearchUrl('http://router:8080/'), null, 'host:port is a deliberate target');
  assert.equal(omniboxSearchUrl('file:///C:/tmp/start.html'), null, 'the start page must be left alone');
  assert.equal(omniboxSearchUrl('about:blank'), null);
  assert.equal(omniboxSearchUrl('chrome://new-tab-page-third-party/'), null);
  assert.equal(omniboxSearchUrl(''), null);
  assert.equal(omniboxSearchUrl(null), null);
});

test('the rewritten target is not itself rewritten (no redirect loop)', () => {
  const once = omniboxSearchUrl('http://softglaze/');
  assert.ok(once);
  assert.equal(omniboxSearchUrl(once), null, 'the search result URL must pass through untouched');
});

test('the guard is attached to the first tab and to new tabs', () => {
  assert.match(SRC, /const page = pages\[0\][\s\S]{0,260}attachOmniboxSearchGuard\(page/, 'first tab must be guarded');
  assert.match(SRC, /attachOmniboxSearchGuard\(targetPage/, 'new tabs must be guarded');
});

test('new tabs are guarded BEFORE the internal/blank early returns', () => {
  // A tab opened with "+" is blank at targetcreated time and returns early. Attaching
  // the guard after that return meant the one tab a user actually types a search into
  // was never guarded - measured live: http://softglaze stayed on http://softglaze.
  const attachAt = SRC.indexOf('attachOmniboxSearchGuard(targetPage');
  const earlyReturn = SRC.indexOf('if (isNewTab && (isInternal || isBlank)) return;');
  assert.ok(attachAt !== -1 && earlyReturn !== -1, 'both markers must exist');
  assert.ok(attachAt < earlyReturn, 'the guard must be attached before the blank-tab early return');
});

test('the guard cannot attach twice to one page', () => {
  // targetcreated can fire a second pass for the same tab once it navigates somewhere
  // real; without this the page would redirect twice.
  assert.match(SRC, /omniboxGuarded\.has\(page\)/);
  assert.match(SRC, /omniboxGuarded\.add\(page\)/);
});
