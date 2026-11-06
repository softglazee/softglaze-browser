'use strict';
// Trial / grace / subscription-ended warnings could stack and cover the page: Gate drew a fixed
// banner at the top of the window (z-90) and a fixed trial chip at the bottom right, while AppShell
// drew its own banner in the page flow, so in grace two banners showed (one over the other and over
// the page header), and the Settings and Billing cards repeated the same warning.
// Now one notice is picked by priority (lib/licenseNotice.mjs) and AppShell draws it once, in the
// page flow above the scrolling content; the trial-days chip sits in the sidebar.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const R = path.join(ROOT, 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8');
const loadPicker = () => import(pathToFileURL(path.join(R, 'lib', 'licenseNotice.mjs')).href);

// Licence views as main's license:get returns them (licenseView / getLicense).
const STATES = {
  none: null,
  exempt: { type: 'source-owner', state: 'paid', isPaid: true, isExempt: true },
  paid: { type: 'paid', state: 'paid', isPaid: true, isTrial: false, isGrace: false, isBanned: false },
  trial7: { type: 'trial', state: 'trialing', isTrial: true, daysLeftTrial: 7, daysLeft: 7 },
  trial3: { type: 'trial', state: 'trialing', isTrial: true, daysLeftTrial: 3, daysLeft: 3 },
  trial1: { type: 'trial', state: 'trialing', isTrial: true, daysLeftTrial: 1, daysLeft: 1 },
  trialGrace: { type: 'trial', state: 'grace', isTrial: false, isGrace: true, isExpired: true, daysLeftTrial: 0, daysLeftGrace: 2 },
  paidGrace: { type: 'paid', state: 'grace', isTrial: false, isGrace: true, isExpired: true, daysLeftGrace: 1 },
  banned: { type: 'trial', state: 'banned', isBanned: true, isExpired: true, daysLeftGrace: 0 },
  machineTrial: { type: 'trial', state: 'trialing', isTrial: true, daysLeftTrial: 5, reason: 'machine_mismatch' },
  machineGrace: { type: 'trial', state: 'grace', isGrace: true, daysLeftGrace: 2, reason: 'machine_mismatch' }
};
const EXPECTED = {
  none: null, exempt: null, paid: null,
  trial7: 'trialDays', trial3: 'trialEnding', trial1: 'trialEnding',
  trialGrace: 'grace', paidGrace: 'grace', banned: 'ended',
  machineTrial: 'machine', machineGrace: 'machine'
};

test('exactly one notice per licence state, by a fixed priority', async () => {
  const { pickLicenseNotice, LICENSE_NOTICE_PRIORITY } = await loadPicker();
  assert.deepEqual(LICENSE_NOTICE_PRIORITY, ['machine', 'ended', 'grace', 'trialEnding', 'trialDays']);
  for (const [name, lic] of Object.entries(STATES)) {
    const n = pickLicenseNotice(lic, { path: '/profiles' });
    assert.equal(n ? n.kind : null, EXPECTED[name], name);
  }
});

test('grace says which one ended (a trial in grace is no longer isTrial) and how many days are left', async () => {
  const { pickLicenseNotice } = await loadPicker();
  const trial = pickLicenseNotice(STATES.trialGrace);
  assert.equal(trial.trial, true);
  assert.equal(trial.action, 'subscribe');
  assert.equal(trial.days, 2);
  const paid = pickLicenseNotice(STATES.paidGrace);
  assert.equal(paid.trial, false);
  assert.equal(paid.action, 'renew');
  assert.equal(paid.dismissible, false, 'the app locks when grace ends, so this one stays');
});

test('only the trial-ending banner can be dismissed; the Billing page shows its own status instead', async () => {
  const { pickLicenseNotice } = await loadPicker();
  assert.equal(pickLicenseNotice(STATES.trial3, { dismissed: true }), null);
  assert.equal(pickLicenseNotice(STATES.trialGrace, { dismissed: true }).kind, 'grace');
  assert.equal(pickLicenseNotice(STATES.trialGrace, { path: '/billing' }), null);
  assert.equal(pickLicenseNotice(STATES.trial7, { path: '/billing' }), null);
  assert.equal(pickLicenseNotice(STATES.machineTrial, { path: '/billing' }).kind, 'machine', 'the card does not explain a machine mismatch');
  assert.equal(pickLicenseNotice(STATES.trialGrace, { path: '/billing-history' }).kind, 'grace');
});

test('the trial-days notice is a sidebar chip; every other notice is a banner', async () => {
  const { pickLicenseNotice } = await loadPicker();
  for (const [name, lic] of Object.entries(STATES)) {
    const n = pickLicenseNotice(lic);
    if (!n) continue;
    assert.equal(n.placement, n.kind === 'trialDays' ? 'sidebar' : 'banner', name);
  }
});

// ---- render the real component for each state ---------------------------------------------

// rolldown (Vite's bundler) turns the JSX into plain JS; the imports are then wired to require().
function loadComponents(t) {
  let transformSync;
  try { ({ transformSync } = require('rolldown/utils')); } catch (e) { /* ESM-only below */ }
  return (async () => {
    if (!transformSync) {
      try { ({ transformSync } = await import('rolldown/utils')); } catch (e) { t.skip('rolldown is not installed'); return null; }
    }
    const file = path.join(R, 'components', 'LicenseNotice.jsx');
    const out = transformSync(file, fs.readFileSync(file, 'utf8'), { jsx: { runtime: 'automatic' } });
    assert.deepEqual(out.errors, []);
    const exported = [];
    const code = out.code
      .replace(/^import \{([^}]*)\} from ["']([^"']+)["'];?$/gm, (_m, names, mod) => `const {${names.replace(/\bas\b/g, ':')}} = __require(${JSON.stringify(mod)});`)
      .replace(/^export function (\w+)/gm, (_m, name) => { exported.push(name); return `function ${name}`; });
    assert.doesNotMatch(code, /^\s*(import|export)\s/m, 'every import and export was rewritten');
    const ctx = { __require: require, module: { exports: {} } };
    vm.createContext(ctx);
    vm.runInContext(`${code}\nmodule.exports = { ${exported.join(', ')} };`, ctx);
    return ctx.module.exports;
  })();
}

function i18nForTests() {
  const i18n = require('i18next').createInstance();
  const { initReactI18next } = require('react-i18next');
  i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { common: JSON.parse(read('i18n', 'locales', 'en', 'common.json')) } },
    defaultNS: 'common',
    ns: ['common'],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initImmediate: false
  });
  return i18n;
}

test('rendered with each licence state, the shell shows at most one notice and never over the page', async (t) => {
  const comps = await loadComponents(t);
  if (!comps) return;
  const { LicenseNoticeBanner, LicenseTrialChip } = comps;
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { I18nextProvider } = require('react-i18next');
  const { pickLicenseNotice } = await loadPicker();
  const i18n = i18nForTests();
  const h = React.createElement;

  // The same structure AppShell uses: the chip in the sidebar, the banner above the page content.
  const Shell = ({ license }) => {
    const notice = pickLicenseNotice(license, { path: '/profiles' });
    return h('div', { 'data-shell': '' },
      h('aside', null, h(LicenseTrialChip, { notice, collapsed: false, onOpen: () => {} })),
      h('main', null,
        h(LicenseNoticeBanner, { notice, onAction: () => {}, onDismiss: () => {} }),
        h('div', { 'data-page-content': '' }, 'page')));
  };

  for (const [name, lic] of Object.entries(STATES)) {
    const html = renderToStaticMarkup(h(I18nextProvider, { i18n }, h(Shell, { license: lic })));
    const kinds = [...html.matchAll(/data-license-notice="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(kinds, EXPECTED[name] ? [EXPECTED[name]] : [], `${name}: ${html}`);
    if (!kinds.length) continue;
    const at = html.indexOf('data-license-notice');
    if (kinds[0] !== 'trialDays') {
      assert.ok(at < html.indexOf('data-page-content'), `${name}: the banner comes before the page, in the flow`);
      assert.ok(html.indexOf('<main') < at, `${name}: the banner is inside the content column, not the window`);
    } else {
      assert.ok(at < html.indexOf('<main'), 'the trial chip is in the sidebar');
    }
    const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at));
    assert.doesNotMatch(tag, /\b(fixed|absolute|sticky)\b|z-\[/, `${name}: no overlay positioning`);
  }

  const grace = renderToStaticMarkup(h(I18nextProvider, { i18n }, h(Shell, { license: STATES.trialGrace })));
  assert.match(grace, /Your free trial has ended\./);
  assert.match(grace, /2 days of grace left\./);
  assert.match(grace, />Subscribe</);
  assert.match(grace, /role="alert"/);
  const renew = renderToStaticMarkup(h(I18nextProvider, { i18n }, h(Shell, { license: STATES.paidGrace })));
  assert.match(renew, /Your subscription has ended\./);
  assert.match(renew, /1 day of grace left\./);
  assert.match(renew, />Renew</);
  const ending = renderToStaticMarkup(h(I18nextProvider, { i18n }, h(Shell, { license: STATES.trial1 })));
  assert.match(ending, /Free trial ends in 1 day\./);
  assert.match(ending, /aria-label="Dismiss"/);
  const chip = renderToStaticMarkup(h(I18nextProvider, { i18n }, h(Shell, { license: STATES.trial7 })));
  assert.match(chip, /Trial · 7 days left/);
});

// ---- the wiring ---------------------------------------------------------------------------

test('Gate no longer draws its own fixed banner or trial chip', () => {
  const gate = read('components', 'Gate.jsx');
  assert.doesNotMatch(gate, /function LicenseBanner/);
  assert.doesNotMatch(gate, /fixed top-0 inset-x-0 z-\[90\]/);
  assert.doesNotMatch(gate, /fixed bottom-4 right-4 z-\[90\]/);
  assert.match(gate, /if \(phase === 'ready'\) return children;/);
});

test('AppShell draws the one notice once, in the column flow above the scrolling page', () => {
  const shell = read('components', 'AppShell.jsx');
  assert.equal((shell.match(/<LicenseNoticeBanner /g) || []).length, 1);
  assert.equal((shell.match(/<LicenseTrialChip /g) || []).length, 1);
  assert.match(shell, /const licenseNotice = pickLicenseNotice\(license, \{ dismissed: bannerDismissed, path: location\.pathname \}\);/);
  assert.match(shell, /<LicenseNoticeBanner notice=\{licenseNotice\}[^\n]*\/>\s*<div className="flex-1 overflow-y-auto/, 'the banner sits right before the scroll container');
  assert.doesNotMatch(shell, /t\('shell\.trialEndingDays'/, 'the old inline banner is gone');
  const comp = read('components', 'LicenseNotice.jsx');
  assert.doesNotMatch(comp, /className="[^"]*\b(fixed|absolute|sticky)\b/, 'nothing in the notice is positioned over the page');
});

test('the Settings billing card no longer repeats the warning; the Billing card keeps one state at a time', () => {
  const card = read('components', 'BillingSettings.jsx');
  assert.doesNotMatch(card, /license\?\.isGrace &&/);
  assert.doesNotMatch(card, /license\?\.isTrial && !license\?\.isGrace &&/);
  const page = read('pages', 'BillingPage.jsx');
  // Mutually exclusive by construction (licenseView: isGrace and isTrial exclude a ban and each other).
  assert.match(page, /\{license\?\.isGrace && \(/);
  assert.match(page, /\{license\?\.isTrial && !license\?\.isGrace && \(/);
});

test('every notice string exists in English and Spanish', () => {
  for (const lang of ['en', 'es']) {
    const shell = JSON.parse(read('i18n', 'locales', lang, 'common.json')).shell;
    for (const k of ['trialEndingDays_one', 'trialEndingDays_other', 'trialEnded', 'subscriptionEnded', 'graceDaysLeft_one', 'graceDaysLeft_other', 'accessEnded', 'licenceOtherComputer', 'trialChip_one', 'trialChip_other', 'renew', 'subscribe', 'dismiss']) {
      assert.ok(shell[k], `${lang} shell.${k}`);
    }
  }
});
