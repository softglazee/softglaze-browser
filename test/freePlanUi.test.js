'use strict';
// Free forever plan (1.0.27), renderer side: the pure helpers (lib/freePlanUi.mjs), the en / es strings (same keys,
// proper Spanish, none of the blocked words, the day 8 text), and that every screen is mounted where it belongs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const json = (lang, ns) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`));
const load = () => import('../src/renderer/lib/freePlanUi.mjs');

function keys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}
function strings(obj) {
  return Object.values(obj).flatMap((v) => (v && typeof v === 'object' ? strings(v) : [String(v)]));
}

test('Pro monthly price for the prompts comes from the server plans', async () => {
  const { proMonthlyPrice } = await load();
  assert.equal(proMonthlyPrice([
    { id: 'pro-yearly', kind: 'paid', tier: 'pro', amount: '50', currency: 'USD', interval: 'year', months: 12 },
    { id: 'pro', kind: 'paid', tier: 'pro', amount: '5', currency: 'USD', interval: 'month', months: 1 },
    { id: 'enterprise', kind: 'paid', tier: 'enterprise', amount: '29', currency: 'USD', interval: 'month', months: 1 }
  ]), 'US$5');
  assert.equal(proMonthlyPrice([{ id: 'pro', kind: 'paid', tier: 'pro', amount: '1500', currency: 'PKR', months: 1 }]), '1500 PKR');
  assert.equal(proMonthlyPrice([]), null);
  assert.equal(proMonthlyPrice(null), null);
});

test('counters: "24 of 25", full at the cap, none on unlimited plans', async () => {
  const { counterOf } = await load();
  assert.deepEqual(counterOf({ used: 24, limit: 25 }), { used: 24, limit: 25, full: false, near: true });
  assert.equal(counterOf({ used: 25, limit: 25 }).full, true);
  assert.equal(counterOf({ used: 3, limit: null }), null);
  assert.equal(counterOf(null), null);
});

test('the upgrade prompt: known kinds, "Choose profiles" only when a choice is needed', async () => {
  const { promptFor } = await load();
  assert.deepEqual(promptFor({ kind: 'running', limit: 1, used: 1 }), { kind: 'running', limit: 1, used: 1, chooseProfiles: false });
  assert.equal(promptFor({ kind: 'openable', limit: 25, needsChoice: true }).chooseProfiles, true);
  assert.equal(promptFor({ kind: 'openable', limit: 25, needsChoice: false }).chooseProfiles, false);
  assert.equal(promptFor({ kind: 'whatever' }).kind, 'generic');
});

test('the Billing comparison table: Free values from the limits, Pro and Enterprise from the plan table', async () => {
  const { comparisonRows } = await load();
  const rows = Object.fromEntries(comparisonRows({ profiles: 25, runningCap: 1, seats: 1, aiActionsPerDay: 25, sync: false }).map((r) => [r.key, r]));
  assert.equal(rows.profiles.free, 25);
  assert.equal(rows.profiles.pro, 'unlimited');
  assert.equal(rows.running.free, 1);
  assert.equal(rows.running.pro, 3);
  assert.equal(rows.running.enterprise, 10);
  assert.equal(rows.seats.enterprise, 25);
  assert.equal(rows.pcs.free, 1);
  assert.deepEqual(rows.ai.free, { count: 25 });
  assert.equal(rows.sync.free, 'no');
  assert.equal(rows.phone.free, 'viewApprove');
  const en = json('en', 'plan');
  for (const r of comparisonRows({})) {
    assert.ok(en.billing.rows[r.key], `row label ${r.key}`);
    for (const v of [r.free, r.pro, r.enterprise]) if (typeof v === 'string') assert.ok(en.billing.values[v], `value ${v}`);
  }
});

test('plan strings: en and es have the same keys, Spanish is translated, no blocked words', async () => {
  const { BLOCKED_WORDS } = await load();
  const en = json('en', 'plan');
  const es = json('es', 'plan');
  assert.deepEqual(keys(es).sort(), keys(en).sort());
  const same = keys(en).filter((k) => k.split('.').reduce((o, p) => o[p], en) === k.split('.').reduce((o, p) => o[p], es)
    && !/colPro|colEnterprise|values\.no$/.test(k));
  assert.deepEqual(same, [], 'every Spanish string is translated');
  for (const lang of ['en', 'es']) {
    for (const s of strings(json(lang, 'plan'))) assert.doesNotMatch(s, BLOCKED_WORDS, s);
    for (const k of ['continueFreeTitle', 'continueFreeSubtitle', 'trialUsedFree']) assert.ok(json(lang, 'gate').plan[k], `${lang} gate.plan.${k}`);
    assert.ok(json(lang, 'billing').status.free);
  }
});

test('the day 8 screen says the spec text with 25 profiles, and the trial no longer threatens a lock', () => {
  const en = json('en', 'plan');
  assert.equal(en.welcome.title, 'Your Pro trial has ended. You are now on the Free plan.');
  assert.equal(en.welcome.keep.replace('{{limit}}', 25), 'All your profiles (25 can be opened), your proxies and fingerprints, the phone and web app.');
  assert.equal(en.welcome.pro.replace('{{price}}', 'US$5'), 'Unlimited profiles, 3 running at once, team seats, cloud sync and unlimited AI actions, for US$5 a month.');
  assert.equal(en.welcome.upgrade, 'Upgrade to Pro');
  assert.equal(en.welcome.stay, 'Continue on Free');
  assert.equal(en.deals.disclosure, 'Partner offer. SoftGlaze may earn a commission.');
  for (const lang of ['en', 'es']) {
    const shell = json(lang, 'common').shell;
    for (const k of ['trialEndingDays_one', 'trialEndingDays_other', 'trialEnded']) assert.doesNotMatch(shell[k], /lock|bloque/i, `${lang} ${k}`);
  }
});

test('every Free plan screen is mounted where it belongs', () => {
  const shell = read('src', 'renderer', 'components', 'AppShell.jsx');
  assert.match(shell, /<PlanLimitPrompt onChooseProfiles=/);
  assert.match(shell, /<FreeWelcomeDialog /);
  assert.match(shell, /<ChooseOpenableDialog /);
  assert.match(read('src', 'renderer', 'pages', 'ProfilesPage.jsx'), /<PlanCounters usage=\{planUsage\} \/>/);
  assert.match(read('src', 'renderer', 'pages', 'BillingPage.jsx'), /<FreePlanBillingSection /);
  assert.match(read('src', 'renderer', 'pages', 'ProxyPoolPage.jsx'), /<PartnerDealsCard /);
  assert.match(read('src', 'renderer', 'pages', 'FreeProxiesPage.jsx'), /<PartnerDealsCard /);
  assert.match(read('src', 'renderer', 'components', 'Gate.jsx'), /softglazeApi\.license\.chooseFree\(\)/);
  const i18n = read('src', 'renderer', 'i18n', 'index.js');
  // i18n/index.js registers every locales/<code>/plan.json (English eager, others lazy).
  assert.match(i18n, /import\.meta\.glob\('\.\/locales\/en\/\*\.json', \{ eager: true/);
  assert.match(i18n, /import\.meta\.glob\(\['\.\/locales\/\*\/\*\.json'/);
  const card = read('src', 'renderer', 'components', 'FreePlan.jsx');
  assert.match(card, /t\('deals\.disclosure'\)/, 'the commission disclosure is always shown');
  assert.match(card, /softglazeApi\.plan\.openPartnerDeal\(d\.id\)/, 'opened by main in the system browser');
  assert.doesNotMatch(card, /<a [^>]*href=\{d\.url\}/, 'never a direct link in the app window');
});
