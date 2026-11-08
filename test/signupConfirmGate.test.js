'use strict';
// The Gate side of "Confirm your email" (1.0.23): where the step comes in the flow, what it sends, who
// sees what, and the copy (en and es, plain English, no dashes). Source checks plus the pure helpers.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const R = path.join(ROOT, 'src', 'renderer');
const GATE = fs.readFileSync(path.join(R, 'components', 'Gate.jsx'), 'utf8');
const locale = (lang, ns) => JSON.parse(fs.readFileSync(path.join(R, 'i18n', 'locales', lang, `${ns}.json`), 'utf8'));
const flow = () => import(pathToFileURL(path.join(R, 'lib', 'signupFlow.mjs')).href);

test('confirmPhase: required -> the Owner confirms, anyone else gets the message; otherwise on to the licence', async () => {
  const f = await flow();
  assert.equal(f.confirmPhase({ enabled: true, required: true, canConfirm: true }), 'confirm');
  assert.equal(f.confirmPhase({ enabled: true, required: true, canConfirm: false }), 'confirmMember');
  assert.equal(f.confirmPhase({ enabled: true, required: false, canConfirm: true }), null);
  assert.equal(f.confirmPhase({ enabled: false, required: false }), null, 'base builds');
  assert.equal(f.confirmPhase(null), null, 'a failed status goes on (main still checks launches)');
  assert.equal(f.isOurSideError({ code: 'CONFIRM_OFFLINE' }), true);
  assert.equal(f.isOurSideError({ code: 'SIGNUP_BAD_CODE' }), false);
});

test('otpExtras: tenant sign-up adds the lead details; base builds still send none', async () => {
  const f = await flow();
  const lead = { phone: '+1 202 555 0143', useCase: 'agency' };
  assert.equal(f.otpExtras({ tenant: false, firstName: 'A', lead }), undefined);
  assert.deepEqual(f.otpExtras({ tenant: true, firstName: 'A', lastName: 'B', consent: false, lang: 'en', lead }),
    { firstName: 'A', lastName: 'B', consentMarketing: false, lang: 'en', phone: '+1 202 555 0143', useCase: 'agency' });
});

test('Gate: after sign-in the confirm step comes before the licence, and only when main says so', () => {
  const eff = GATE.slice(GATE.indexOf("if (phase !== 'licensing') return undefined;"), GATE.indexOf('setPhase(phaseForLicense(lic));'));
  const statusAt = eff.indexOf('softglazeApi.account.signupStatus()');
  const licAt = eff.indexOf('softglazeApi.license.get()');
  assert.ok(statusAt > 0 && licAt > statusAt, 'signupStatus is asked before license.get');
  assert.match(eff, /const next = confirmPhase\(st\);/);
  assert.match(eff, /if \(next\) \{ openConfirm\(st\); setBusy\(false\); setPhase\(next\); return; \}/);
  assert.match(GATE, /\{phase === 'confirm' && confirmStep === 'details' && \(/);
  assert.match(GATE, /\{phase === 'confirm' && confirmStep === 'code' && \(/);
  assert.match(GATE, /\{phase === 'confirmMember' && \(/);
});

test('Gate: the confirm step sends the details and lead fields, and offers "Continue for now" only when main allows it', () => {
  assert.match(GATE, /await softglazeApi\.account\.confirmStart\(\{\s*email: email\.trim\(\)\.toLowerCase\(\), firstName: firstName\.trim\(\), lastName: lastName\.trim\(\),\s*consentMarketing: consent === true, lang: getStoredLang\(\), \.\.\.leadPayload\(\{ phone, useCase, useCaseOther, company \}\)/);
  assert.match(GATE, /await softglazeApi\.account\.confirmCheck\(\{ email: email\.trim\(\)\.toLowerCase\(\), code: c,/);
  assert.match(GATE, /setCanDefer\(Boolean\(st && st\.canDefer\)\)/);
  const details = GATE.slice(GATE.indexOf("{phase === 'confirm' && confirmStep === 'details' && ("), GATE.indexOf("{phase === 'confirm' && confirmStep === 'code' && ("));
  assert.match(details, /<LeadFields idPrefix="cf"/);
  assert.match(details, /<ConsentToggle checked=\{consent\} onChange=\{setConsent\} \/>/, 'the marketing box, unticked by default');
  assert.match(details, /\{canDefer && \(/);
  assert.match(details, /onClick=\{signOut\}/);
  const member = GATE.slice(GATE.indexOf("{phase === 'confirmMember' && ("), GATE.indexOf("{phase === 'plan' && tenant && ("));
  assert.doesNotMatch(member, /confirmStart|LeadFields|<input/, 'a member only reads the message');
  assert.match(member, /t\('confirm\.signInAsOwner'\)/);
});

test('Gate: tenant sign-up asks for the lead fields; the base form keeps its required phone', () => {
  assert.match(GATE, /\{tenant\s*\? <LeadFields idPrefix="reg"/);
  const send = GATE.slice(GATE.indexOf('async function sendCode()'), GATE.indexOf('async function resend()'));
  assert.match(send, /if \(tenant\) \{/);
  assert.match(send, /const le = leadError\(\{ phone, useCase, useCaseOther \}\);/);
  assert.ok(send.includes("} else if (phone.replace(/\\D/g, '').length < 6) return setErr(t('errors.validPhone'));"), 'base: phone still required');
  // The select is labelled and required; every option label comes from the locale.
  assert.match(GATE, /<select id=\{id\('usecase'\)\} required aria-required="true"/);
  assert.match(GATE, /USE_CASES\.map\(\(k\) => <option key=\{k\} value=\{k\}/);
});

test('copy: every new string exists in en and es, plain, with no em or en dashes', () => {
  const keys = {
    register: ['phoneOptional', 'phoneIntlPlaceholder', 'phoneHint'],
    lead: ['useCase', 'useCasePlaceholder', 'useCaseOther', 'useCaseOtherPlaceholder', 'company', 'companyPlaceholder'],
    confirm: ['title', 'subtitle', 'sendCode', 'codeTitle', 'codeBody', 'confirmContinue', 'changeDetails', 'dataNote', 'later', 'laterNote', 'memberTitle', 'memberBody', 'signInAsOwner']
  };
  for (const lang of ['en', 'es']) {
    const g = locale(lang, 'gate');
    for (const [ns, list] of Object.entries(keys)) {
      for (const k of list) {
        const v = g[ns] && g[ns][k];
        assert.ok(typeof v === 'string' && v.trim(), `${lang}: ${ns}.${k}`);
        assert.doesNotMatch(v, /[–—]/, `${lang}: ${ns}.${k} has no em or en dash`);
      }
    }
    const all = [...Object.values(g.lead.useCases), ...Object.values(g.confirm), ...Object.values(g.lead)].filter((x) => typeof x === 'string');
    for (const v of all) {
      assert.doesNotMatch(v, /[–—]/);
      assert.doesNotMatch(v, /\b(amazing|seamless|revolutionary|unlock|supercharge|effortless)\b/i, `${lang}: plain words`);
    }
    assert.match(g.confirm.codeBody, /\{\{email\}\}/);
  }
});
