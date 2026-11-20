'use strict';
// Settings > Billing card on the Free plan (1.0.27): main's freeView() returns state 'free', and the card's
// status pill had no 'free' case, so it fell through to the default and showed an amber "Trial · d left".
// The pill now comes from lib/licenseStatus.mjs and says the Billing page's "Free plan" (billing.json
// status.free) in every language. The other screens that read the licence state are checked for the
// same gap: the licence notice / sidebar chip (nothing for Free), the Super Admin owners list (Free, not
// Trial) and the Billing page (its own 'free' case).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const R = path.join(ROOT, 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8');
const LOCALES = path.join(R, 'i18n', 'locales');
const json = (lang, ns) => JSON.parse(fs.readFileSync(path.join(LOCALES, lang, `${ns}.json`), 'utf8'));
const loadStatus = () => import(pathToFileURL(path.join(R, 'lib', 'licenseStatus.mjs')).href);
const loadNotice = () => import(pathToFileURL(path.join(R, 'lib', 'licenseNotice.mjs')).href);

// The view main's freePlan.freeView() returns (the fields the renderer reads).
const FREE = {
  type: 'free', tier: 'free', state: 'free', status: 'active', endsAt: null,
  daysLeft: null, daysLeftTrial: null, daysLeftGrace: null,
  isExpired: false, isTrial: false, isPaid: false, isGrace: false, isBanned: false, isFree: true, isExempt: false,
  needsPlan: false, trialUsed: true, endedFrom: 'trial'
};

// A stand-in translator: returns "ns:key" plus the interpolation values, so the test sees which key was used.
const fakeT = (key, opts = {}) => `${opts.ns || 'cmpSettingsA'}:${key}${'count' in opts ? `#${opts.count}` : ''}`;

test('the Free plan view maps to the Free pill, never a trial', async () => {
  const { licenseStatusKind, settingsStatusTone, LICENSE_TONE_COLORS } = await loadStatus();
  assert.equal(licenseStatusKind(FREE), 'free');
  const tone = settingsStatusTone(FREE, fakeT);
  assert.equal(tone.kind, 'free');
  assert.equal(tone.label, 'billing:status.free');
  assert.equal(tone.color, '#3b82f6', 'the same blue the Billing page uses for Free');
  assert.equal(tone.color, LICENSE_TONE_COLORS.free);
  assert.notEqual(tone.color, '#f59e0b', 'not the amber trial/grace warning colour');
  // Partial views (only isFree, or only type) still read as Free.
  assert.equal(licenseStatusKind({ isFree: true }), 'free');
  assert.equal(licenseStatusKind({ type: 'free', isPaid: false }), 'free');
});

test('every other licence state keeps its pill', async () => {
  const { licenseStatusKind, settingsStatusTone } = await loadStatus();
  assert.equal(licenseStatusKind(null), 'loading');
  assert.equal(licenseStatusKind({ isExempt: true, state: 'paid', isPaid: true }), 'sourceOwner');
  assert.equal(licenseStatusKind({ state: 'paid', isPaid: true }), 'paid');
  assert.equal(licenseStatusKind({ state: 'trialing', isTrial: true, daysLeftTrial: 5 }), 'trialing');
  assert.equal(licenseStatusKind({ state: 'grace', isGrace: true, daysLeftGrace: 2 }), 'grace');
  assert.equal(licenseStatusKind({ state: 'banned', isBanned: true }), 'banned');
  assert.equal(licenseStatusKind({ isPaid: true }), 'active');
  assert.equal(licenseStatusKind({ isPaid: false, daysLeft: 4 }), 'trial');

  assert.equal(settingsStatusTone(null, fakeT).label, 'cmpSettingsA:billing.status.loading');
  assert.equal(settingsStatusTone({ state: 'trialing', daysLeftTrial: 5 }, fakeT).label, 'cmpSettingsA:billing.status.trialDaysLeft#5');
  assert.equal(settingsStatusTone({ state: 'grace', daysLeftGrace: 2 }, fakeT).label, 'cmpSettingsA:billing.status.graceDaysLeft#2');
  assert.equal(settingsStatusTone({ state: 'banned' }, fakeT).label, 'cmpSettingsA:billing.status.subscriptionEnded');
  assert.equal(settingsStatusTone({ state: 'paid', isPaid: true }, fakeT).label, 'cmpSettingsA:billing.status.active');
  assert.equal(settingsStatusTone({ state: 'paid', isPaid: true, endsAt: '2027-01-15T00:00:00.000Z' }, fakeT).color, '#10b981');
});

test('the Free pill resolves to "Free plan" in all 18 languages with real i18next', async () => {
  const i18next = (await import('i18next')).default;
  const { settingsStatusTone } = await loadStatus();
  const langs = fs.readdirSync(LOCALES).filter((d) => fs.existsSync(path.join(LOCALES, d, 'billing.json')));
  assert.equal(langs.length, 18);
  const resources = {};
  for (const lang of langs) resources[lang] = { cmpSettingsA: json(lang, 'cmpSettingsA'), billing: json(lang, 'billing') };
  const i18n = i18next.createInstance();
  await i18n.init({ resources, lng: 'en', fallbackLng: 'en', ns: ['cmpSettingsA', 'billing'], defaultNS: 'cmpSettingsA', interpolation: { escapeValue: false } });
  for (const lang of langs) {
    const t = i18n.getFixedT(lang, 'cmpSettingsA');
    const want = json(lang, 'billing').status.free;
    assert.ok(want && want.trim(), `${lang}: billing.status.free exists`);
    const label = settingsStatusTone(FREE, t).label;
    assert.equal(label, want, `${lang}: the card says the Billing page's Free plan label`);
    const trialPrefix = json(lang, 'cmpSettingsA').billing.status.trialDaysLeft_other.split('{{')[0].trim();
    assert.ok(!label.includes(trialPrefix) || label === want, `${lang}: no trial wording on Free`);
  }
});

test('the Settings > Billing card uses the shared pill (no local switch without Free)', () => {
  const src = read('components', 'BillingSettings.jsx');
  assert.match(src, /import \{ settingsStatusTone \} from '@\/lib\/licenseStatus\.mjs';/);
  assert.match(src, /const tone = settingsStatusTone\(license, t\);/);
  assert.doesNotMatch(src, /function statusTone\(/);
  assert.match(src, /data-license-status=\{tone\.kind\}/);
});

test('the Billing page already has its own Free case', () => {
  const src = read('pages', 'BillingPage.jsx');
  assert.match(src, /case 'free': return \{ color: '#3b82f6', label: t\('status\.free'\) \};/);
});

test('the licence notice and the sidebar trial chip show nothing on Free', async () => {
  const { pickLicenseNotice } = await loadNotice();
  assert.equal(pickLicenseNotice(FREE), null);
  assert.equal(pickLicenseNotice(FREE, { path: '/profiles' }), null);
  assert.equal(pickLicenseNotice({ ...FREE, endedFrom: 'paid', type: 'free' }), null);
});

test('the Super Admin owners list shows Free, not Trial, for a Free workspace', () => {
  const src = read('pages', 'MembersPage.jsx');
  assert.match(src, /free: \{ c: '#3b82f6', label: 'Free plan' \}/);
  assert.match(src, /lic\.state === 'free' \? t\('status\.free', \{ ns: 'billing' \}\)/);
});
