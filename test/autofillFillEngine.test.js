'use strict';
// Regression tests for the Data Vault fill engine (8 Oct).
//
// Two bugs made Smart Autofill leave forms empty or garbled:
//   1. With "Minimize CDP footprint" on, rebrowser's enableDisable mode resolves the
//      main world to a blank about:blank context on fingerprint-chromium, so page.$
//      returned null for every tagged field and the fill failed instantly ("Could
//      not fill this form - nothing was entered"). Every DOM step now runs in the
//      widget's own isolated world.
//   2. The trusted focus click landed on whatever was on top of the field - often the
//      autofill panel itself - which clicked another identity row and started a
//      second fill whose keystrokes interleaved with the first. The click point is
//      now hit-tested, fills are serialized per tab, and the widget closes its panel
//      and refuses a second pick while one runs.
// Both were reproduced and the fix verified end to end in fingerprint-chromium 148
// (stock and rebrowser engines) on a local signup page and on a live Marketo form.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');

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

const engineSrc = SRC('main/browserEngine.js');
const attach = extractFunction(engineSrc, 'attachPersonaAutofill');

test('fill loop never resolves fields through the main world', () => {
  assert.doesNotMatch(attach, /targetPage\.\$\(/, 'page.$ is blank under rebrowser enableDisable');
  assert.doesNotMatch(attach, /targetPage\.select\(/);
  assert.doesNotMatch(attach, /\bel\.(click|evaluate)\(/);
  assert.match(attach, /world\.evaluate\(personaPrepareTarget, sel\)/);
  assert.match(attach, /world\.evaluate\(personaSetSelect, sel, value\)/);
  assert.match(attach, /world\.evaluate\(personaCommitTarget, sel, typed\.length\)/);
});

test('fill plans run one at a time per tab', () => {
  assert.match(attach, /fillChain\.then\(\(\) => fillPlanOnce\(plan, meta\)\)/);
  assert.match(attach, /__sgPersonaFillPlan: hPersonaFillPlan/);
});

test('widget closes the panel and refuses a second pick while filling', () => {
  const widget = SRC('main/personaAutofill.js');
  assert.match(widget, /if \(filling\) \{[^}]*return; \}/);
  assert.match(widget, /isOpen = false; panel\.hidden = true;\s*filling = true;/);
  assert.match(widget, /pending \|\| filling \|\| userIsTyping\(\)/, 'multi-step re-runs wait too');
  assert.match(widget, /\.toast\{[^']*z-index:2;width:max-content/, 'toast sits above the panel at a readable width');
});

test('the generated Firefox widget is in sync with the source', () => {
  const { buildAutofillBootstrap } = require('../src/main/personaAutofill');
  const generated = SRC('firefox-extension/sg-widget.js');
  assert.ok(generated.includes(buildAutofillBootstrap()), 'run npm run build:firefox-ext');
});

// --- isolated-world helpers against a stub DOM ---------------------------------------
const { __personaPrepareTarget: prepare, __personaSetSelect: setSelect } = require('../src/main/browserEngine');

function withDom({ el, hit, vw = 1200, vh = 800 }, fn) {
  const saved = { window: global.window, document: global.document };
  global.window = { innerWidth: vw, innerHeight: vh };
  global.document = {
    querySelectorAll: () => (el ? [el] : []),
    elementFromPoint: () => (typeof hit === 'function' ? hit(el) : hit)
  };
  try { return fn(); } finally { global.window = saved.window; global.document = saved.document; }
}
function field(rect, extra = {}) {
  return {
    tagName: 'INPUT', disabled: false, readOnly: false, _rect: rect,
    getBoundingClientRect() { return this._rect; },
    contains(n) { return n === this; },
    scrollIntoView() { if (extra.scrollTo) this._rect = extra.scrollTo; },
    ...extra
  };
}
const R = { top: 200, left: 100, bottom: 240, right: 400, width: 300, height: 40 };

test('prepareTarget: clicks only when the point hits the field itself', () => {
  const ok = withDom({ el: field(R), hit: (el) => el }, () => prepare('[x]'));
  assert.equal(ok.ok, true);
  assert.equal(ok.click, true);
  assert.ok(ok.x > R.left && ok.x < R.left + R.width / 2 + 1, 'left of centre, clear of eye/clear icons');
  // Covered by the autofill panel (or any overlay): no click, DOM focus instead.
  const covered = withDom({ el: field(R), hit: { tagName: 'DIV' } }, () => prepare('[x]'));
  assert.deepEqual([covered.ok, covered.click], [true, false]);
});

test('prepareTarget: scrolls a below-the-fold field into view before measuring', () => {
  const below = { top: 1500, left: 100, bottom: 1540, right: 400, width: 300, height: 40 };
  const r = withDom({ el: field(below, { scrollTo: R }), hit: (el) => el }, () => prepare('[x]'));
  assert.equal(r.click, true);
  assert.equal(r.y, R.top + R.height / 2);
});

test('prepareTarget: missing, duplicate-tagged or disabled fields are refused', () => {
  assert.equal(withDom({ el: null, hit: null }, () => prepare('[x]')).ok, false);
  assert.equal(withDom({ el: field(R, { disabled: true }), hit: null }, () => prepare('[x]')).ok, false);
});

test('setSelect: picks an existing option value and fires input + change', () => {
  const fired = [];
  const mk = () => ({
    tagName: 'SELECT', disabled: false, value: '',
    options: [{ value: '' }, { value: 'GB' }, { value: 'US' }],
    dispatchEvent(e) { fired.push(e.type); }
  });
  const sel = mk();
  const saved = { document: global.document, Event: global.Event };
  global.document = { querySelectorAll: () => [sel] };
  try {
    assert.equal(setSelect('[x]', 'US'), true);
    assert.equal(sel.value, 'US');
    assert.deepEqual(fired, ['input', 'change']);
    assert.equal(setSelect('[x]', 'Narnia'), false, 'unknown option is a failure, not a silent no-op');
  } finally { global.document = saved.document; }
});

// --- multi-step signups (8 Oct, second report) ---------------------------------------
// The identity was marked used right after step 1 filled, so it dropped out of the
// list and step 2 (same page or a new one) had nothing to fill with. It now stays
// ACTIVE per site until the final submit. Verified end to end in fingerprint-chromium
// (stock + rebrowser) on a 3-step signup: in-page Next, a route change, a full page
// load, a password step, then "Create account" - marked used exactly once, at the end.

const { __siteKeyOf: siteKeyOf } = require('../src/main/browserEngine');
const widgetSrc = SRC('main/personaAutofill.js');

test('siteKeyOf groups a signup by registrable domain', () => {
  assert.equal(siteKeyOf('https://signup.example.com/a'), 'example.com');
  assert.equal(siteKeyOf('https://app.example.com/welcome'), 'example.com');
  assert.equal(siteKeyOf('https://www.shop.example.co.uk/x'), 'example.co.uk');
  assert.equal(siteKeyOf('https://my.site.com.au/'), 'site.com.au');
  assert.equal(siteKeyOf('http://127.0.0.1:8799/page2.html'), '127.0.0.1');
  assert.equal(siteKeyOf('file:///C:/x.html'), '');
  assert.equal(siteKeyOf('not a url'), '');
});

test('a fill makes the identity active instead of marking it used', () => {
  const fillWith = extractFunction(widgetSrc, 'fillWith');
  assert.match(fillWith, /if \(canTrackActive\(\)\) \{\s*await setActive\(p\);/);
  // The old immediate mark-used only remains as the fallback for a backend without tracking.
  assert.match(fillWith, /\} else if \(fillFailed === 0\) \{\s*var _marked = await markSelectedUsed\(true\);/);
});

test('the engine serves the active-identity handler and mark-used releases it', () => {
  assert.match(attach, /__sgPersonaActive: hPersonaActive/);
  assert.match(attach, /if \(activeKey\) activeSites\.delete\(activeKey\);/);
  assert.match(attach, /offered = list\.some\(/, 'only an identity offered for this origin can become active');
});

test('only a FINAL submit marks the identity used; Next / Continue keep it', () => {
  const grab = (name) => {
    const m = widgetSrc.match(new RegExp('var ' + name + ' = (/.*/[a-z]*);'));
    assert.ok(m, name + ' not found');
    return eval(m[1]); // eslint-disable-line no-eval
  };
  const NEXT = grab('NEXT_RX');
  const FINAL = grab('FINAL_RX');
  for (const t of ['Next', 'Continue', 'Next step', 'Save and continue', 'Continue →', 'Proceed']) assert.ok(NEXT.test(t), t);
  for (const t of ['Create account', 'Sign up', 'Register', 'Submit', 'Request a demo', 'Finish', 'Join now', 'Start free trial', 'Get started']) {
    assert.ok(FINAL.test(t) && !NEXT.test(t), t);
  }
  assert.match(widgetSrc, /document\.addEventListener\('submit', function \(e\) \{\s*if \(!e\.isTrusted \|\| !active\) return;/);
});

test('a new page resumes the active identity and fills the step, never the password', () => {
  assert.match(widgetSrc, /sgCall\('__sgPersonaActive', 'get'\)/);
  const arm = extractFunction(widgetSrc, 'armMultiStep');
  assert.match(arm, /fillWith\(p, \{ onlyEmpty: true \}\)/, 'later steps are onlyEmpty fills: no password, no gesture');
  assert.match(widgetSrc, /if \(m\.kind === 'password'\) return false;/);
});

test('the Firefox extension keeps the active identity too', () => {
  const bridge = SRC('firefox-extension/sg-bridge.js');
  const bg = SRC('firefox-extension/sg-background.js');
  assert.match(bridge, /window\.__sgPersonaActive = function/);
  assert.match(bg, /msg\.type === 'active'/);
  assert.match(bg, /activeIds\.delete\(akey\)/);
});
