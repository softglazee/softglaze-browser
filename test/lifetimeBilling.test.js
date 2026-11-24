'use strict';
// Lifetime licences on the Billing and Members pages (Black Friday 2026): a lifetime lease shows
// "Lifetime" instead of "renews <2126 date>", and the plan cards offer no Upgrade / Downgrade for it
// (the licensing server refuses those with 409 lifetime_active: licensing-server/src/plans/lifetimeGuard.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const R = path.join(__dirname, '..', 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8');
const DAY = 86400000;

test('isLifetimeTerm: a -lifetime plan key or a term past 50 years', async () => {
  const { isLifetimeTerm } = await import(pathToFileURL(path.join(R, 'lib', 'planPeriods.mjs')).href);
  const now = Date.parse('2026-11-24T00:00:00Z');
  const in2126 = new Date(now + 36500 * DAY).toISOString();
  assert.equal(isLifetimeTerm({ endsAt: in2126 }, now), true);
  assert.equal(isLifetimeTerm({ planKey: 'pro-lifetime', endsAt: in2126 }, now), true);
  assert.equal(isLifetimeTerm({ planKey: 'enterprise-lifetime', endsAt: new Date(now + 30 * DAY).toISOString() }, now), true);
  assert.equal(isLifetimeTerm({ planKey: 'pro', endsAt: new Date(now + 30 * DAY).toISOString() }, now), false);
  assert.equal(isLifetimeTerm({ planKey: 'pro-yearly', endsAt: new Date(now + 365 * DAY).toISOString() }, now), false);
  assert.equal(isLifetimeTerm({ planKey: 'pro-lifetime', endsAt: new Date(now - DAY).toISOString() }, now), false, 'ended');
  assert.equal(isLifetimeTerm({}, now), false);
});

test('Billing hides Upgrade / Downgrade and the renewal date for a lifetime lease; Members shows Lifetime', () => {
  const billing = read('pages', 'BillingPage.jsx');
  assert.match(billing, /isLifetimeTerm\(\{ planKey: backend\?\.lease\?\.plan, endsAt: backend\?\.lease\?\.currentPeriodEnd \}\)/);
  const cta = billing.slice(billing.indexOf('function planCta'), billing.indexOf('return (', billing.indexOf('function planCta') + 200));
  assert.ok(cta.indexOf("if (isLifetime) return { label: t('cta.lifetimeOwned'), disabled: true") < cta.indexOf("t('cta.upgradeEnterprise')"), 'before Upgrade');
  assert.ok(cta.indexOf('if (isLifetime)') < cta.indexOf("t('cta.downgradePro')"), 'before Downgrade');
  assert.match(billing, /isLifetime \? ` · \$\{t\('backend\.lifetime'\)\}` : backend\.lease\.currentPeriodEnd/);
  const members = read('pages', 'MembersPage.jsx');
  assert.match(members, /isLifetimeTerm\(\{ endsAt: lic\.endsAt \}\) \? t\('backend\.lifetime', \{ ns: 'billing' \}\)/);
});

test('all 18 locales translate backend.lifetime and cta.lifetimeOwned', () => {
  const dir = path.join(R, 'i18n', 'locales');
  const langs = fs.readdirSync(dir).filter((l) => fs.existsSync(path.join(dir, l, 'billing.json')));
  assert.equal(langs.length, 18);
  for (const l of langs) {
    const b = JSON.parse(fs.readFileSync(path.join(dir, l, 'billing.json'), 'utf8'));
    assert.ok(b.backend.lifetime && b.cta.lifetimeOwned, l);
    if (l !== 'en') assert.notEqual(b.cta.lifetimeOwned, 'Lifetime plan active', `${l} is translated`);
  }
});
