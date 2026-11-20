'use strict';
// Black Friday 2026 / Christmas 2026 offer banner (lib/promoBanner.mjs, components/PromoBanner.jsx):
// unpaid licences only (Free, trial, grace, ended), inside the offer's UTC window, dismissible per offer,
// links to the website's /black-friday page, and drawn by AppShell in the page flow next to the licence notice.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const R = path.join(__dirname, '..', 'src', 'renderer');
const load = () => import(pathToFileURL(path.join(R, 'lib', 'promoBanner.mjs')).href);

const L = {
  paid: { type: 'paid', isPaid: true },
  exempt: { type: 'source-owner', isPaid: true, isExempt: true },
  trial: { type: 'trial', isTrial: true, daysLeftTrial: 5 },
  grace: { type: 'trial', isGrace: true, daysLeftGrace: 2 },
  ended: { type: 'trial', isBanned: true },
  free: { type: 'free', isFree: true, isPaid: false },
  otherPc: { type: 'trial', isTrial: true, reason: 'machine_mismatch' }
};
const at = (s) => Date.parse(s);

test('only inside the UTC windows: 24 Nov 00:00 to 1 Dec 23:59:59, then 20 to 31 Dec', async () => {
  const { pickPromo } = await load();
  assert.equal(pickPromo(L.trial, { now: at('2026-11-23T23:59:59Z') }), null);
  assert.equal(pickPromo(L.trial, { now: at('2026-11-24T00:00:00Z') }).id, 'bf-2026');
  assert.equal(pickPromo(L.trial, { now: at('2026-12-01T23:59:59Z') }).id, 'bf-2026');
  assert.equal(pickPromo(L.trial, { now: at('2026-12-02T00:00:00Z') }), null);
  assert.equal(pickPromo(L.trial, { now: at('2026-12-20T00:00:00Z') }).id, 'xmas-2026');
  assert.equal(pickPromo(L.trial, { now: at('2026-12-31T23:59:59Z') }).id, 'xmas-2026');
  assert.equal(pickPromo(L.trial, { now: at('2027-01-01T00:00:00Z') }), null);
});

test('unpaid licences see it; paid, exempt, another computer and no licence do not', async () => {
  const { pickPromo } = await load();
  const now = at('2026-11-27T12:00:00Z');
  for (const k of ['trial', 'grace', 'ended', 'free']) assert.ok(pickPromo(L[k], { now }), k);
  for (const k of ['paid', 'exempt', 'otherPc']) assert.equal(pickPromo(L[k], { now }), null, k);
  assert.equal(pickPromo(null, { now }), null);
  assert.equal(pickPromo(L.trial, { now, path: '/billing' }), null, 'not on Billing');
});

test('dismissal is kept per offer, and storage errors never throw', async () => {
  const { pickPromo, isPromoDismissed, dismissPromo } = await load();
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  dismissPromo('bf-2026', storage);
  assert.equal(isPromoDismissed('bf-2026', storage), true);
  assert.equal(isPromoDismissed('xmas-2026', storage), false);
  const dismissed = (id) => isPromoDismissed(id, storage);
  assert.equal(pickPromo(L.trial, { now: at('2026-11-27T00:00:00Z'), dismissed }), null);
  assert.ok(pickPromo(L.trial, { now: at('2026-12-21T00:00:00Z'), dismissed }), 'the Christmas offer shows again');
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(isPromoDismissed('bf-2026', broken), false);
  assert.doesNotThrow(() => dismissPromo('bf-2026', broken));
});

test('the words come from the common namespace in every language; English fallback; store-safe wording', async () => {
  const { pickPromo, PROMOS } = await load();
  const bundle = (lang) => JSON.parse(fs.readFileSync(path.join(R, 'i18n', 'locales', lang, 'common.json'), 'utf8')).promo;
  const tFor = (lang) => (key, { defaultValue } = {}) => key.split('.').slice(1).reduce((o, k) => (o ? o[k] : undefined), bundle(lang)) ?? defaultValue;
  const now = at('2026-11-25T00:00:00Z');
  assert.ok(!pickPromo(L.free, { now, t: tFor('es') }).text.includes('{{'), 'prices filled in');
  const plain = pickPromo(L.free, { now });
  assert.match(plain.text, /US\$49/);
  assert.equal(plain.cta, 'See the offer');
  const en = pickPromo(L.free, { now, t: tFor('en') });
  assert.equal(en.text, plain.text, 'the English locale matches the fallback');
  const es = pickPromo(L.free, { now, t: tFor('es') });
  assert.match(es.text, /US\$249/);
  assert.equal(es.cta, 'Ver la oferta');
  assert.match(en.url, /^https:\/\/browser\.softglaze\.com\/black-friday\?/);
  const langs = fs.readdirSync(path.join(R, 'i18n', 'locales'));
  for (const lang of langs) {
    const b = bundle(lang);
    assert.ok(b && b.bf2026 && b.xmas2026 && b.cta && b.dismiss, `${lang} has the promo texts`);
    for (const k of ['bf2026', 'xmas2026']) {
      assert.match(b[k].text, /\{\{pro\}\}/, `${lang} ${k} Pro price`);
      assert.match(b[k].text, /\{\{enterprise\}\}/, `${lang} ${k} Enterprise price`);
      assert.doesNotMatch(b[k].text, /\d\d\$|\$\d/, `${lang} ${k}: no price written in the locale`);
    }
  }
  const all = JSON.stringify(PROMOS) + JSON.stringify(langs.map(bundle));
  assert.ok(!/[–—]/.test(all), 'no en or em dashes');
  assert.ok(!/antidetect|undetectable|bypass|evade|spoof|stealth|\bban\b|fake|anonymous/i.test(all));
});

test('AppShell draws the banner in the page flow and lets it replace the trial-ending banner', () => {
  const shell = fs.readFileSync(path.join(R, 'components', 'AppShell.jsx'), 'utf8');
  assert.match(shell, /<PromoBanner promo=\{promo\}/);
  assert.match(shell, /rawLicenseNotice\.kind === 'trialEnding' \? null/);
  const comp = fs.readFileSync(path.join(R, 'components', 'PromoBanner.jsx'), 'utf8');
  assert.match(comp, /target="_blank"/);
  assert.ok(!/fixed|absolute/.test(comp.replace(/^\s*\/\/.*$/gm, '')), 'never over the page');
});
