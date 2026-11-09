'use strict';
// The Gate's sign-up and trial flow (src/renderer/lib/signupFlow.mjs + Gate.jsx) in tenant and base
// builds: what is sent, where each licence state leads, the consent box, and that no price is
// written into the UI.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const R = path.join(ROOT, 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8');
const locale = (lang, ns) => JSON.parse(read('i18n', 'locales', lang, `${ns}.json`));
const get = (o, k) => k.split('.').reduce((c, p) => (c == null ? c : c[p]), o);
const load = () => import(pathToFileURL(path.join(R, 'lib', 'signupFlow.mjs')).href);
const GATE = read('components', 'Gate.jsx');

test('sign-up flow states: base sends only the email; tenant adds name, consent and language', async () => {
  const f = await load();
  assert.equal(f.otpExtras({ tenant: false, firstName: 'A', lastName: 'B', consent: true, lang: 'es' }), undefined);
  assert.deepEqual(f.otpExtras({ tenant: true, firstName: ' Ada ', lastName: ' Owner ', consent: false, lang: 'es' }), { firstName: 'Ada', lastName: 'Owner', consentMarketing: false, lang: 'es' });
  assert.equal(f.otpExtras({ tenant: true, consent: 'true' }).consentMarketing, false, 'only a real tick counts');
  assert.equal(f.otpExtras({ tenant: true }).lang, 'en');
});

test('after license:get: no plan -> plan step, ended -> blocking screen, else the app', async () => {
  const f = await load();
  assert.equal(f.phaseForLicense({ needsPlan: true, isBanned: true }), 'plan');
  assert.equal(f.phaseForLicense({ isBanned: true }), 'banned');
  assert.equal(f.phaseForLicense({ isTrial: true }), 'ready');
  assert.equal(f.phaseForLicense(null), 'ready');
});

test('trial start: the code box opens only when the server asks, and the code is sent only then', async () => {
  const f = await load();
  assert.equal(f.trialNeedsCode({ code: 'TRIAL_VERIFY_EMAIL' }), true);
  assert.equal(f.trialNeedsCode({ code: 'TRIAL_USED' }), false);
  assert.equal(f.trialPayload({ codeFor: '', code: '123456' }), undefined);
  assert.deepEqual(f.trialPayload({ codeFor: 'a@b.co', code: '12 34 56' }), { code: '123456' });
  assert.equal(f.trialPayload({ codeFor: 'a@b.co', code: '123' }), undefined);
});

test('error text: known server codes are translated, anything else keeps its message', async () => {
  const f = await load();
  const t = (k) => `T(${k})`;
  assert.equal(f.errorText(t, { code: 'SIGNUP_DISPOSABLE_EMAIL', message: 'x' }, 'errors.fallback'), 'T(serverErrors.SIGNUP_DISPOSABLE_EMAIL)');
  assert.equal(f.errorText(t, { code: 'TRIAL_USED' }, 'errors.fallback'), 'T(serverErrors.TRIAL_USED)');
  assert.equal(f.errorText(t, { code: 'ALREADY_SETUP', message: 'This workspace is already set up' }, 'errors.fallback'), 'This workspace is already set up');
  assert.equal(f.errorText(t, {}, 'errors.fallback'), 'T(errors.fallback)');
});

test('plan step: paid plans only, highlighted one picked first, prices formatted as on Billing', async () => {
  const f = await load();
  const plans = f.paidPlans({ plans: [{ id: 'free-trial', kind: 'trial' }, { id: 'pro', kind: 'paid', amount: '5' }, { id: 'ent', kind: 'paid', highlight: true, amount: '29' }, { id: 'old', kind: 'paid', active: false }] });
  assert.deepEqual(plans.map((p) => p.id), ['pro', 'ent']);
  assert.equal(f.defaultPlanId(plans), 'ent');
  assert.equal(f.defaultPlanId([]), null);
  assert.equal(f.formatPrice('29', 'USD'), '$29');
  assert.equal(f.formatPrice('19.99', 'EUR'), '19.99 EUR');
});

test('Gate wiring: tenant sign-up has an unticked consent box and never shows a code in-app', () => {
  assert.match(GATE, /const \[consent, setConsent\] = useState\(false\);/);
  assert.match(GATE, /\{tenant && <ConsentToggle checked=\{consent\} onChange=\{setConsent\} \/>\}/);
  assert.match(GATE, /<input type="checkbox" checked=\{checked\}/, 'a real checkbox');
  assert.match(GATE, /\{devCode && !tenant && \(/, 'the dev-mode code box is base-only');
  // From 1.0.23 the lead details ride along (tenant builds only: otpExtras drops them for base builds).
  assert.match(GATE, /softglazeApi\.account\.sendOtp\(email\.trim\(\)\.toLowerCase\(\), otpExtras\(\{ tenant, firstName, lastName, consent, lang: getStoredLang\(\), lead: leadPayload\(\{ phone, useCase, useCaseOther, company \}\) \}\)\)/);
  assert.match(GATE, /softglazeApi\.license\.backendInfo\(\)\.catch\(\(\) => null\)/);
});

test('Gate wiring: the tenant plan step starts the server trial; base keeps today\'s plan step', () => {
  assert.match(GATE, /if \(!tenant\) \{ setErr\(''\); setPhase\('licensing'\); return; \}/, 'base: trial already created at registration');
  assert.match(GATE, /await softglazeApi\.license\.startTrial\(trialPayload\(\{ codeFor: trialCodeFor, code: trialCode \}\)\);/);
  assert.match(GATE, /\{phase === 'plan' && tenant && \(/);
  assert.match(GATE, /\{phase === 'plan' && !tenant && \(/);
  const tenantStep = GATE.slice(GATE.indexOf("{phase === 'plan' && tenant && ("), GATE.indexOf("{phase === 'plan' && !tenant && ("));
  assert.doesNotMatch(tenantStep, /t\('plan\.skip'\)/, 'no "skip" past the trial in tenant builds');
  // The plans the Microsoft Store sells when it is the only way to pay (yearly plans: storePurchase.sellablePlans).
  assert.match(tenantStep, /<PlanPicker plans=\{offerPlans\}/);
  const baseStep = GATE.slice(GATE.indexOf("{phase === 'plan' && !tenant && ("), GATE.indexOf("{phase === 'login' && ("));
  assert.match(baseStep, /t\('plan\.skip'\)/, 'base still offers skip');
  assert.doesNotMatch(baseStep, /PlanPicker/);
  assert.match(GATE, /setPhase\(phaseForLicense\(lic\)\);/);
  assert.match(GATE, /tenant && selPlanId \? \{ provider: method\.id, planId: selPlanId \} : \{ provider: method\.id \}/, 'base checkout payload unchanged');
});

test('no price is written into the UI strings: prices come from the plan list only', () => {
  for (const lang of ['en', 'es']) {
    for (const ns of ['common', 'gate', 'billing']) {
      const raw = fs.readFileSync(path.join(R, 'i18n', 'locales', lang, `${ns}.json`), 'utf8');
      // "$0 grant" (the Super Admin's free grant note) is not a price.
      assert.doesNotMatch(raw, /\$\s?[1-9]|[1-9]\d*\s?USD|US\$/, `${lang}/${ns}.json`);
    }
  }
  assert.doesNotMatch(GATE, /\$\s?\d/);
});

test('every new string exists in en and es, translated', () => {
  const KEYS = {
    gate: ['register.consent', 'register.consentNote', 'register.checkedByServer', 'verify.checkSpam', 'plan.tenantTitle', 'plan.tenantSubtitle', 'plan.tenantTrialSubtitle', 'plan.choosePlan', 'plan.verifyTitle', 'plan.verifyBody', 'plan.verifyStart', 'errors.trialFailed'],
    billing: ['backend.trialVerified', 'backend.trialEnds']
  };
  for (const [ns, keys] of Object.entries(KEYS)) {
    const en = locale('en', ns); const es = locale('es', ns);
    for (const k of keys) {
      assert.equal(typeof get(en, k), 'string', `en ${ns}:${k}`);
      assert.equal(typeof get(es, k), 'string', `es ${ns}:${k}`);
      assert.notEqual(get(es, k), get(en, k), `es ${ns}:${k} must be translated`);
    }
  }
  assert.equal(locale('en', 'gate').register.consent, 'Email me product news and tips');
  assert.match(locale('en', 'gate').register.consentNote, /trial reminders/);
});
