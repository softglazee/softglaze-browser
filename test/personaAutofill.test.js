'use strict';
// Regression tests for the Data-Vault autofill path.
//
// Background: there were ZERO tests over this code, which is how a one-line
// `hasPassword: true -> false` regression shipped and silently disabled every
// password fill. These lock in the contracts that broke:
//
//   1. hasPassword survives BOTH persona strips (ipcHandlers' and browserEngine's).
//   2. The field matcher distinguishes a company NAME from a company ADDRESS.
//   3. Profile.startupUrls parses back into the tabs to open at launch.
//
// They read the real source rather than duplicating it, so they fail if the shipped
// logic changes. Nothing here launches Electron or a browser.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');

// Pull a top-level `function NAME(...) { ... }` out of a source file by matching braces.
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `could not find function ${name} in source`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// Pull a top-level `const NAME = <literal>;` so an extracted function's constants
// come with it rather than throwing ReferenceError in the sandbox.
function extractConst(source, name) {
  const m = new RegExp(`^const ${name}\\s*=\\s*[^;]+;`, 'm').exec(source);
  return m ? m[0] : '';
}

function evalFunction(source, name, deps = []) {
  const ctx = { module: {}, exports: {} };
  vm.createContext(ctx);
  const preamble = deps.map((d) => extractConst(source, d)).filter(Boolean).join('\n');
  vm.runInContext(`${preamble}\n${extractFunction(source, name)}; module.exports = ${name};`, ctx);
  return ctx.module.exports;
}

// --- 1) the password strip -------------------------------------------------

test('hasPassword survives both persona strips', () => {
  // The two strips are applied in sequence on the Chromium bridge:
  // ipcHandlers.getAvailablePersonasForUrl -> browserEngine.hPersonaList.
  const stripSource = evalFunction(SRC('main/ipcHandlers.js'), 'toPublicPersona');
  const stripBridge = evalFunction(SRC('main/browserEngine.js'), 'toPublicPersona');

  const persona = { id: 'p1', firstName: 'Jane', email: 'j@example.com', password: 'S3cret!' };
  const once = stripSource(persona);
  const twice = stripBridge(once);

  assert.equal(once.hasPassword, true, 'first strip must flag the password');
  assert.equal(twice.hasPassword, true,
    'second strip must NOT clobber hasPassword — the password key is already gone, so ' +
    'recomputing Boolean(password) yields false and the widget never offers a password fill');
});

test('both persona strips remove the plaintext password', () => {
  const stripSource = evalFunction(SRC('main/ipcHandlers.js'), 'toPublicPersona');
  const stripBridge = evalFunction(SRC('main/browserEngine.js'), 'toPublicPersona');
  const out = stripBridge(stripSource({ id: 'p1', password: 'S3cret!' }));
  assert.equal('password' in out, false, 'plaintext must never reach page JS');
});

test('a persona with no password reports hasPassword false', () => {
  const stripSource = evalFunction(SRC('main/ipcHandlers.js'), 'toPublicPersona');
  const stripBridge = evalFunction(SRC('main/browserEngine.js'), 'toPublicPersona');
  const out = stripBridge(stripSource({ id: 'p1', firstName: 'Bob' }));
  assert.equal(out.hasPassword, false, 'must not fabricate a password flag');
});

// --- 2) the field matcher --------------------------------------------------

// The widget's PLAN table is an array literal inside the injected bootstrap. Pull the
// literal out and evaluate it so the tests exercise the SHIPPED regexes.
function loadPlan() {
  const src = SRC('main/personaAutofill.js');
  const start = src.indexOf('var PLAN = [');
  assert.notEqual(start, -1, 'could not find the PLAN table');
  const open = src.indexOf('[', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.notEqual(end, -1, 'unbalanced brackets in the PLAN table');
  return vm.runInNewContext(`(${src.slice(open, end + 1)})`);
}

// Mirrors the widget's own resolution order: first PLAN entry whose regex matches the
// field's attribute blob wins, and each input is consumed by at most one key.
function firstMatch(plan, attrBlob) {
  for (const [key, rx] of plan) if (rx.test(attrBlob)) return key;
  return null;
}

test('a Company address field maps to companyAddress, not company or addressLine1', () => {
  const plan = loadPlan();
  assert.ok(plan.some((e) => e[0] === 'companyAddress'), 'PLAN must carry a companyAddress rule');
  for (const blob of [
    'company_address company address',
    'companyaddress company address',
    'business_address business address',
    'org_addr organisation address'
  ]) {
    assert.equal(firstMatch(plan, blob), 'companyAddress', `wrong key for: ${blob}`);
  }
});

test('a company NAME field still maps to company', () => {
  const plan = loadPlan();
  for (const blob of ['company company name', 'employer employer name', 'organization org']) {
    assert.equal(firstMatch(plan, blob), 'company', `wrong key for: ${blob}`);
  }
});

test('the company rule cannot swallow an address field', () => {
  const plan = loadPlan();
  const companyRx = plan.find((e) => e[0] === 'company')[1];
  // The old bare /company|organi[sz]ation|.../ matched anything containing "company",
  // so on a form with Company name + Company address it consumed whichever came first
  // in DOM order and left the other permanently blank.
  assert.equal(companyRx.test('company_address company address'), false);
  assert.equal(companyRx.test('business_street business street'), false);
  assert.equal(companyRx.test('company company name'), true);
});

test('companyAddress is ordered before addressLine1', () => {
  const plan = loadPlan();
  const keys = plan.map((e) => e[0]);
  assert.ok(keys.indexOf('companyAddress') < keys.indexOf('addressLine1'),
    'companyAddress must be tested first, or a "Company address" input carrying ' +
    'autocomplete="street-address" or a digit 1 is claimed by addressLine1 and ' +
    'receives the persona\'s HOME street');
});

test('companyAddress claims no autocomplete token', () => {
  const plan = loadPlan();
  const token = plan.find((e) => e[0] === 'companyAddress')[2];
  // HTML has no "company address" token. Borrowing 'street-address' here would steal
  // every ordinary personal address field that declares it.
  assert.ok(!token, 'companyAddress must not declare an autocomplete token');
});

// --- 3) startup URLs -------------------------------------------------------

// Arrays built inside the vm sandbox carry that realm's Array prototype, which
// assert/strict's deepEqual rejects as "same structure but not reference-equal".
// Re-home them into this realm before comparing.
const rehome = (a) => Array.from(a);

test('startupUrls parses back into the tabs to open', () => {
  const parse = evalFunction(SRC('main/ipcHandlers.js'), 'parseStartupUrls', ['MAX_STARTUP_TABS']);
  assert.deepEqual(rehome(parse('https://a.com\nhttps://b.com')), ['https://a.com', 'https://b.com']);
  assert.deepEqual(rehome(parse('https://a.com\r\n\r\nhttps://b.com')), ['https://a.com', 'https://b.com'],
    'blank lines and CRLF must not produce empty tabs');
  assert.deepEqual(rehome(parse('')), []);
  assert.deepEqual(rehome(parse(null)), []);
});

test('startupUrls is capped so a pasted list cannot spawn hundreds of tabs', () => {
  const parse = evalFunction(SRC('main/ipcHandlers.js'), 'parseStartupUrls', ['MAX_STARTUP_TABS']);
  const many = Array.from({ length: 200 }, (_, i) => `https://x${i}.com`).join('\n');
  assert.equal(parse(many).length, 20);
});

test('the startupUrls writer and reader round-trip', () => {
  const src = SRC('main/ipcHandlers.js');
  const write = evalFunction(src, 'normalizeStartupUrls');
  const read = evalFunction(src, 'parseStartupUrls', ['MAX_STARTUP_TABS']);
  // The writer accepts an array and adds a scheme; the reader must return exactly
  // those URLs. These two were written months apart and never met until now.
  assert.deepEqual(rehome(read(write(['a.com', 'https://b.com']))), ['https://a.com', 'https://b.com']);
  assert.deepEqual(rehome(read(write([]))), []);
});

// --- 4) trusted-transport detection ---------------------------------------

test('the widget detects a trusted transport via sgHas, not a raw typeof', () => {
  const src = SRC('main/personaAutofill.js');
  // sgHas() is true when EITHER the CDP binding or the RPC bridge is present, and
  // sgCall routes over whichever is alive. A raw `typeof window.__sgPersonaFillPlan`
  // misses the bridge, so with no binding the widget fell through to the in-page
  // fallback — which types with synthetic KeyboardEvents (isTrusted:false), a bot
  // signal. That is exactly the state "Minimize CDP footprint" produces, so the
  // anti-CAPTCHA setting would have made fills MORE detectable, not less.
  assert.ok(/var trusted = sgHas\('__sgPersonaFillPlan'\)/.test(src),
    'trusted-path detection must be bridge-aware');
  assert.equal(/var trusted = \(typeof window\.__sgPersonaFillPlan === 'function'\)/.test(src), false,
    'the raw typeof check must not come back');
});

test('sgHas accepts the RPC bridge as a trusted transport', () => {
  const src = SRC('main/personaAutofill.js');
  const fn = extractFunction(src, 'sgHas');
  assert.match(fn, /__sgBridge/, 'sgHas must treat the RPC bridge as available');
});
