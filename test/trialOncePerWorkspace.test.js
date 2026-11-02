'use strict';
// Audit 2 Nov 2026 #6: the free trial could be restarted forever. startTrial reset the
// licence to a fresh 7-day enterprise trial for anyone whose plan was not currently
// paid (an expired trial, a lapsed paid term, even a running trial), from any role, and
// its audit row never saved (logActivity with a null profileId on a NOT NULL column).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const BILLING = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'pages', 'BillingPage.jsx'), 'utf8');
const fnBody = (name) => {
  const m = new RegExp(`(?:async )?function ${name}\\(([\\s\\S]*?)\\r?\\n\\}`).exec(IPC);
  assert.ok(m, `${name} must exist`);
  return m[0];
};

// Behavioural check of the rule, evaluated from the real source.
const licenseTrialUsed = new Function(`${fnBody('licenseTrialUsed')}; return licenseTrialUsed;`)();

test('a licence that had its trial or a paid term counts as used', () => {
  assert.equal(licenseTrialUsed(null), false);
  assert.equal(licenseTrialUsed({ type: 'trial', trialEndsAt: null }), false, 'never given a trial');
  assert.equal(licenseTrialUsed({ type: 'trial', trialEndsAt: new Date() }), true, 'trial given at creation');
  assert.equal(licenseTrialUsed({ type: 'paid', trialEndsAt: new Date() }), true);
  assert.equal(licenseTrialUsed({ type: 'trial', trialEndsAt: null, purchaseCode: 'SGP-X' }), true);
});

test('only the Owner (or the certified Super Admin) may start it', () => {
  const body = fnBody('startTrial');
  assert.match(body, /if \(!isSuper && me && me\.role !== 'OWNER'\) \{[\s\S]*?Only the workspace Owner can start the free trial/);
});

test('a running trial is never extended and a used trial is refused', () => {
  const body = fnBody('startTrial');
  const used = body.indexOf('if (!isSuper && licenseTrialUsed(lic))');
  const running = body.indexOf('if (!isSuper && view.isTrial) return view;');
  const update = body.indexOf('getPrisma().license.update(');
  assert.ok(running > 0 && used > running && update > used, 'checks run before the licence is changed');
  assert.match(body, /TRIAL_USED/);
});

test('the Super Admin can still grant a fresh trial to an owner', () => {
  const body = fnBody('startTrial');
  assert.match(body, /if \(isSuper && \(input\.ownerId == null \|\| input\.ownerId === ''\)\)/);
  assert.ok(!/if \(licenseTrialUsed\(lic\)\)/.test(body), 'the used-check is skipped for the Super Admin');
});

test('trial starts and terminations are now audited', () => {
  assert.match(fnBody('startTrial'), /await logAudit\('license\.trial-start'/);
  assert.match(fnBody('terminateLicense'), /await logAudit\('license\.terminate'/);
  assert.ok(!/logActivity\(getPrisma\(\), null,/.test(IPC), 'no audit insert with a null profileId remains');
});

test('the Billing page shows "Free trial used" instead of a button that would be refused', () => {
  assert.match(fnBody('licenseView'), /trialUsed: licenseTrialUsed\(lic\),/);
  assert.match(BILLING, /if \(license\?\.trialUsed\) return \{ label: t\('cta\.trialUsed'\), disabled: true/);
  for (const lng of ['en', 'es']) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', lng, 'billing.json'), 'utf8'));
    assert.ok(j.cta && j.cta.trialUsed, `${lng} has cta.trialUsed`);
  }
});
