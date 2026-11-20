'use strict';
// The sign-in and sign-up screens (Gate + SignInPanel + AuthProductPanel): every text the new layout uses exists in
// English and Spanish, the copy follows the house rules (no dashes, no hype words, no made-up proof), and the
// switch between "New account" and "I have an account" only changes words (both doors use the same sign-in).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const R = path.join(__dirname, '..', 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8');
const locale = (lang, ns) => JSON.parse(read('i18n', 'locales', lang, `${ns}.json`));
const get = (o, k) => k.split('.').reduce((c, p) => (c == null ? c : c[p]), o);
const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();

const GATE = read('components', 'Gate.jsx');
const PANEL = read('components', 'AuthProductPanel.jsx');
const SIGNIN = read('components', 'SignInPanel.jsx');

test('product panel and controls: every key exists in en and es, same shape', () => {
  for (const ns of ['gate']) {
    const en = locale('en', ns); const es = locale('es', ns);
    assert.deepEqual(keys(es.panel), keys(en.panel), 'panel: Spanish has every English text');
    assert.deepEqual(keys(es.controls), keys(en.controls), 'controls: Spanish has every English text');
  }
  const en = locale('en', 'gate'); const es = locale('es', 'gate');
  const used = [...PANEL.matchAll(/\bt\('([a-zA-Z.]+)'/g), ...GATE.matchAll(/\bt\('(controls\.[a-zA-Z.]+)'/g)].map((m) => m[1]);
  for (const k of used) { assert.equal(typeof get(en, k), 'string', `en gate.json has ${k}`); assert.equal(typeof get(es, k), 'string', `es gate.json has ${k}`); }
  for (const f of ['fingerprint', 'proxy', 'storage', 'phone']) assert.ok(en.panel.facts[f].term && es.panel.facts[f].detail, f);
  // The panel reuses the Profiles page's own column names and relative times.
  assert.match(PANEL, /tp\('table\.name'\)/);
  assert.match(PANEL, /tp\(`relTime\.\$\{r\.used\[0\]\}`/);
});

test('sign-in copy: no dashes, no hype words, no invented proof', () => {
  const texts = [];
  for (const lang of ['en', 'es']) {
    const g = locale(lang, 'gate'); const s = locale(lang, 'signin');
    texts.push(JSON.stringify(g.panel), JSON.stringify(g.controls), JSON.stringify(s.choose));
  }
  for (const t of texts) {
    assert.ok(!/[–—]/.test(t), 'no em or en dashes');
    assert.ok(!/\b(seamless|elevate|unlock|curated|empower|supercharge|revolutionary|cutting-edge)\b/i.test(t), 'no hype words');
    assert.ok(!/\b(reviews?|rating|trusted by|users worldwide|stars?)\b/i.test(t), 'no ratings or user counts');
    assert.ok(!/\b(get started|learn more|explore)\b/i.test(t), 'no generic calls to action');
  }
  // The example table is labelled as an example, with documentation IP ranges only.
  assert.match(PANEL, /panel\.exampleCaption/);
  for (const ip of PANEL.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g)) assert.match(ip, /^(192\.0\.2|198\.51\.100|203\.0\.113)\./, ip);
});

test('Gate layout: two columns, no carousel, both doors call the same sign-in', () => {
  assert.doesNotMatch(GATE, /CarouselPanel|AuthAura|backdrop-blur|shadow-glow|bg-gradient-to/);
  assert.match(GATE, /<AuthProductPanel variant=\{phase === 'register' \? 'signup' : 'return'\} \/>/);
  assert.match(GATE, /<SignInPanel purpose="signup" info=\{signin\} onDone=\{afterSignIn\} entry=\{entry\} onEntry=\{setEntry\}/);
  assert.match(GATE, /onPasswordLogin=\{\(\) => \{ setPhase\('login'\); setErr\(''\); \}\}/, 'the password screen stays reachable');
  assert.match(GATE, /onMoreOptions=\{\(\) => \{ setStep\('details'\); setErr\(''\); \}\}/, 'the name + password form stays reachable');
  // Both doors start the same provider sign-in with purpose "signup"; the door only picks the words.
  assert.match(SIGNIN, /const returning = purpose === 'signup' && entry === 'returning';/);
  assert.equal((SIGNIN.match(/softglazeApi\.signin\.start\(/g) || []).length, 1);
  assert.match(SIGNIN, /aria-pressed=\{entry === k\}/);
  // Inputs are 16 px and 44 px tall; buttons 44 px. The app's root font is 15 px, so h-11 would be 41 px: exact px.
  assert.match(SIGNIN, /const inputCls = 'w-full h-\[44px\] [^']*text-\[16px\]/);
  assert.match(GATE, /const inputCls = 'w-full h-\[44px\] [^']*text-\[16px\]/);
  assert.match(SIGNIN, /const bigBtn = 'w-full h-\[44px\] /);
  assert.doesNotMatch(SIGNIN + GATE, /\bh-11\b|\bmin-h-11\b/);
});
