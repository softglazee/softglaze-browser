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
  // Every slide has a title (8 words at most), a body and an image description, in both languages.
  const slideKeys = [...PANEL.matchAll(/\{ key: '([a-z]+)', kind:/g)].map((m) => m[1]);
  assert.deepEqual(slideKeys, ['free', 'fingerprint', 'ai', 'phone', 'team']);
  for (const k of slideKeys) {
    for (const loc of [en, es]) for (const part of ['title', 'body', 'alt']) assert.equal(typeof loc.panel.slides[k][part], 'string', `${k}.${part}`);
    assert.ok(en.panel.slides[k].title.split(/\s+/).length <= 8, `${k}: short title`);
  }
});

test('slider: real screenshots in both themes, small, lazy, accessible, calm', () => {
  const dir = path.join(R, 'assets', 'signin');
  let total = 0;
  for (const k of ['profiles', 'fingerprint', 'ai', 'phone', 'team']) for (const t of ['dark', 'light']) {
    const file = path.join(dir, `${k}-${t}.webp`);
    assert.ok(fs.existsSync(file), file);
    assert.match(PANEL, new RegExp(`import ${k}${t[0].toUpperCase()}${t.slice(1)} from '@/assets/signin/${k}-${t}\\.webp'`));
    total += fs.statSync(file).size;
  }
  assert.ok(total < 2.5 * 1024 * 1024, `slider images ${total} bytes`);
  assert.match(PANEL, /export const SLIDE_MS = 6000;/);
  assert.match(PANEL, /const running = !reduced && !stopped && !hover && !focusIn && !away;/, 'pauses on hover, focus, background window, Pause, reduced motion');
  assert.match(PANEL, /useState\(\(\) => new Set\(\[0, 1\]\)\)/, 'only the first two slides load at once');
  assert.match(PANEL, /aria-roledescription=\{t\('panel\.carousel'\)\}/);
  assert.match(PANEL, /aria-roledescription=\{t\('panel\.slide'\)\}/);
  assert.match(PANEL, /aria-live=\{running \? 'off' : 'polite'\}/);
  assert.match(PANEL, /aria-label=\{t\('panel\.prev'\)\}/);
  assert.match(PANEL, /aria-label=\{t\('panel\.next'\)\}/);
  assert.match(PANEL, /\[height:44px\]/);
  assert.match(PANEL, /motion-reduce:transition-none/);
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
    assert.ok(!/(antidetect|anti-detect|undetectable|bypass|evade|spoof|stealth|\bban\b|\bfake\b|anonymous)/i.test(t), 'no words the stores and the owner rule out');
    assert.ok(!/!/.test(t.replace(/"[^"]*":/g, '')), 'no exclamation marks');
  }
});

test('Gate layout: two columns, no carousel, both doors call the same sign-in', () => {
  assert.doesNotMatch(GATE, /CarouselPanel|AuthAura|backdrop-blur|shadow-glow|bg-gradient-to/);
  assert.match(GATE, /<AuthProductPanel \/>/);
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
