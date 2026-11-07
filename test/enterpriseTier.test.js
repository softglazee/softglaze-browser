'use strict';
// Pro vs Enterprise (1.0.21). tierPolicy.js is the one source of the plan limits:
//   Pro 3 team members, 3 profiles at once, no audit-log export;
//   Enterprise 25, 10, export; the trial runs as Enterprise but keeps 3 seats.
// Main enforces them (seats, parallel cap, export gate) and the plan cards describe them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const tierPolicy = require('../src/main/tierPolicy.js');
const teamPolicy = require('../src/main/teamPolicy.js');
const { runParallelMacro } = require('../src/main/parallelRunner.js');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const MEMBERS_PAGE = read('src', 'renderer', 'pages', 'MembersPage.jsx');
const AUTOMATION_PAGE = read('src', 'renderer', 'pages', 'AutomationPage.jsx');
const BILLING_PAGE = read('src', 'renderer', 'pages', 'BillingPage.jsx');
const locale = (lang, ns) => JSON.parse(read('src', 'renderer', 'i18n', 'locales', lang, `${ns}.json`));

// Body of a top-level function in ipcHandlers.js, up to the next top-level function.
function fnBody(signature) {
  const start = IPC.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const ends = [IPC.indexOf('\nasync function ', start + signature.length), IPC.indexOf('\nfunction ', start + signature.length)]
    .filter((i) => i > 0);
  return IPC.slice(start, ends.length ? Math.min(...ends) : undefined);
}

const PRO = { type: 'paid', tier: 'pro' };
const ENTERPRISE = { type: 'paid', tier: 'enterprise' };
const TRIAL = { type: 'trial', tier: 'enterprise' };
const pick = (l) => ({ tier: l.tier, seats: l.seats, maxParallel: l.maxParallel, auditExport: l.auditExport });

// ---- tier helper -----------------------------------------------------------------------------

test('Pro, Enterprise and the trial get the agreed limits', () => {
  assert.deepEqual(pick(tierPolicy.limitsForLicense(PRO)), { tier: 'pro', seats: 3, maxParallel: 3, auditExport: false });
  assert.deepEqual(pick(tierPolicy.limitsForLicense(ENTERPRISE)), { tier: 'enterprise', seats: 25, maxParallel: 10, auditExport: true });
  assert.deepEqual(pick(tierPolicy.limitsForLicense(TRIAL)), { tier: 'enterprise', seats: 3, maxParallel: 10, auditExport: true });
});

test('the certified Super Admin exemption gets Enterprise limits', () => {
  const l = tierPolicy.limitsForLicense({ type: 'source-owner', tier: 'enterprise', isExempt: true });
  assert.deepEqual(pick(l), { tier: 'enterprise', seats: 25, maxParallel: 10, auditExport: true });
  assert.equal(l.exempt, true);
  // Only main sets isExempt; a type string alone never claims the exemption.
  const claimed = tierPolicy.limitsForLicense({ type: 'source-owner', tier: 'enterprise' });
  assert.equal(claimed.exempt, false);
  assert.deepEqual(pick(claimed), { tier: 'pro', seats: 3, maxParallel: 3, auditExport: false });
});

test('a missing, unknown or tierless licence falls back to Pro limits (the old 3-seat default)', () => {
  for (const lic of [null, undefined, {}, { type: 'weird', tier: 'enterprise' }, { type: 'paid' }, { type: 'paid', tier: null }]) {
    assert.deepEqual(pick(tierPolicy.limitsForLicense(lic)), { tier: 'pro', seats: 3, maxParallel: 3, auditExport: false }, JSON.stringify(lic));
  }
  // Case does not matter; anything that is not enterprise is Pro.
  assert.equal(tierPolicy.limitsForLicense({ type: 'PAID', tier: 'Enterprise' }).seats, 25);
  assert.equal(tierPolicy.limitsForLicense({ type: 'paid', tier: 'gold' }).tier, 'pro');
  // A trial set to the Pro tier keeps 3 seats and gets the Pro run cap and no export.
  assert.deepEqual(pick(tierPolicy.limitsForLicense({ type: 'trial', tier: 'pro' })), { tier: 'pro', seats: 3, maxParallel: 3, auditExport: false });
});

test('limits follow type and tier, not state: grace and ended licences keep their plan limits', () => {
  for (const state of ['paid', 'grace', 'banned']) {
    assert.equal(tierPolicy.limitsForLicense({ ...ENTERPRISE, state }).seats, 25, state);
    assert.equal(tierPolicy.limitsForLicense({ ...PRO, state }).seats, 3, state);
  }
  // A verified backend lease view (licenseViewFromLease) is type paid with the lease tier.
  assert.equal(tierPolicy.limitsForLicense({ type: 'paid', tier: 'enterprise', source: 'backend', isExempt: false }).maxParallel, 10);
});

// ---- parallel cap ----------------------------------------------------------------------------

test('clampConcurrency caps a run at the plan limit and never above 10', () => {
  const pro = tierPolicy.limitsForLicense(PRO);
  const ent = tierPolicy.limitsForLicense(ENTERPRISE);
  assert.equal(tierPolicy.clampConcurrency(10, pro), 3);
  assert.equal(tierPolicy.clampConcurrency('8', pro), 3);
  assert.equal(tierPolicy.clampConcurrency(2, pro), 2);
  assert.equal(tierPolicy.clampConcurrency(10, ent), 10);
  assert.equal(tierPolicy.clampConcurrency(50, ent), 10);
  assert.equal(tierPolicy.clampConcurrency(undefined, ent), 3, 'default stays 3');
  assert.equal(tierPolicy.clampConcurrency('x', pro), 3);
  assert.equal(tierPolicy.clampConcurrency(-4, ent), 1);
  assert.equal(tierPolicy.clampConcurrency(5, null), 1, 'no limits => one at a time');
});

test('a Pro run never drives more than 3 profiles at once', async () => {
  let live = 0;
  let peak = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deps = {
    isOpen: async () => false,
    launch: async (pid) => ({ sessionId: `s${pid}` }),
    runMacro: async () => { live += 1; peak = Math.max(peak, live); await sleep(5); live -= 1; return { ok: true, ran: 1, total: 1, log: [] }; },
    close: async () => {},
    emit: () => {}
  };
  const items = Array.from({ length: 9 }, (_, i) => ({ profileId: i + 1, profileName: `P${i + 1}` }));
  const concurrency = tierPolicy.clampConcurrency(10, tierPolicy.limitsForLicense(PRO));
  const summary = await runParallelMacro({ runId: 'pro', items, steps: [{ type: 'goto', url: 'x' }], concurrency }, deps);
  assert.equal(summary.passed, 9);
  assert.ok(peak <= 3, `peak ${peak} exceeded the Pro cap of 3`);
});

test('main caps parallel concurrency by the plan of the effective licence', () => {
  const h = fnBody('async function runParallelMacroHandler(');
  assert.match(h, /const concurrency = tierPolicy\.clampConcurrency\(input\.concurrency, tierPolicy\.limitsForLicense\(await getLicense\(\)\)\);/);
  assert.doesNotMatch(h, /Math\.min\(10, Number\.parseInt\(input\.concurrency/);
  // The runner keeps the absolute ceiling from the same module.
  assert.match(read('src', 'main', 'parallelRunner.js'), /const cap = Math\.max\(1, Math\.min\(MAX_PARALLEL, Number\(o\.concurrency\) \|\| 1\)\);/);
  assert.equal(tierPolicy.MAX_PARALLEL, 10);
});

// ---- seats -----------------------------------------------------------------------------------

const team = (n, extra = []) => [
  { id: 1, status: 'active', parentMemberId: null },
  ...Array.from({ length: n - 1 }, (_, i) => ({ id: i + 2, status: 'active', parentMemberId: 1 })),
  ...extra
];

test('the seat check refuses a 4th Pro member and allows the 4th Enterprise member', () => {
  const three = team(3); // owner + 2
  assert.deepEqual(teamPolicy.canTakeSeat(team(2), 1, PRO).ok, true);
  const pro = teamPolicy.canTakeSeat(three, 1, PRO);
  assert.equal(pro.ok, false);
  assert.deepEqual({ used: pro.usage.used, total: pro.usage.total, tier: pro.usage.tier }, { used: 3, total: 3, tier: 'pro' });
  assert.equal(teamPolicy.canTakeSeat(three, 1, ENTERPRISE).ok, true);
  assert.equal(teamPolicy.canTakeSeat(three, 1, TRIAL).ok, false, 'the trial keeps 3 seats');
  assert.equal(teamPolicy.canTakeSeat(team(25), 1, ENTERPRISE).ok, false);
  assert.equal(teamPolicy.canTakeSeat(team(24), 1, ENTERPRISE).ok, true);
});

test('after a downgrade nobody is removed or suspended; only new seats are refused', () => {
  const members = team(5); // Enterprise team of 5, now on Pro
  const before = JSON.stringify(members);
  const r = teamPolicy.canTakeSeat(members, 1, PRO);
  assert.equal(r.ok, false);
  assert.equal(r.usage.used, 5, 'all five still hold their seats');
  assert.equal(r.usage.total, 3);
  assert.equal(r.usage.remaining, 0);
  assert.equal(JSON.stringify(members), before, 'the check never changes the member list');
  // Reactivating a suspended member is a new seat, so it is refused while over the limit...
  const withSuspended = team(3, [{ id: 9, status: 'suspended', parentMemberId: 1 }]);
  assert.equal(teamPolicy.canTakeSeat(withSuspended, 1, PRO, { reactivateId: 9 }).ok, false);
  // ...and allowed with a free seat.
  assert.equal(teamPolicy.canTakeSeat(team(2, [{ id: 9, status: 'suspended', parentMemberId: 1 }]), 1, PRO, { reactivateId: 9 }).ok, true);
  // A member who already holds a seat, or who sits in another owner's tree, takes no new seat.
  assert.equal(teamPolicy.canTakeSeat(team(5), 1, PRO, { reactivateId: 2 }).ok, true);
  const otherTree = team(3, [{ id: 50, status: 'active', parentMemberId: null }, { id: 51, status: 'suspended', parentMemberId: 50 }]);
  assert.equal(teamPolicy.canTakeSeat(otherTree, 1, PRO, { reactivateId: 51 }).ok, true);
});

test('main checks seats against the effective licence on create and on reactivation', () => {
  const assertSeat = fnBody('async function assertSeatAvailable(reactivateId)');
  assert.match(assertSeat, /if \(!m \|\| await isCertifiedSuperAdmin\(m\)\) return;/, 'Super Admin and single-user mode stay exempt');
  assert.match(assertSeat, /const lic = await getLicense\(\);/);
  assert.match(assertSeat, /teamPolicy\.canTakeSeat\(members, ownerId, lic, \{ reactivateId \}\)/);
  assert.match(assertSeat, /e\.code = 'SEAT_LIMIT';/);
  assert.match(fnBody('async function getSeatUsage()'), /const lic = await getLicense\(\);/);
  assert.match(fnBody('async function createMember('), /await assertSeatAvailable\(\);/);
  assert.match(fnBody('async function updateMember('), /if \(data\.status === 'active' && target\.status === 'suspended'\) await assertSeatAvailable\(id\);/);
  const status = fnBody('async function setMemberStatus(');
  assert.match(status, /if \(target\.status === 'suspended' && status !== 'suspended'\) await assertSeatAvailable\(id\);/);
  assert.ok(status.indexOf('assertSeatAvailable(id)') < status.indexOf('db.member.update('), 'checked before the write');
  // Nothing in the seat code suspends, bans or deletes members.
  assert.doesNotMatch(assertSeat + fnBody('async function getSeatUsage()'), /member\.(update|delete|deleteMany|updateMany)\(/);
});

test('the seat-limit message names the limit and how to get more', () => {
  const src = fnBody('function seatLimitMessage(');
  const seatLimitMessage = new Function('tierPolicy', `${src}\nreturn seatLimitMessage;`)(tierPolicy);
  const pro = seatLimitMessage({ used: 3, total: 3, type: 'paid', tier: 'pro' });
  assert.match(pro, /up to 3 team members \(the owner counts as one\), and 3 are in use/);
  assert.match(pro, /Enterprise includes up to 25 team members/);
  const ent = seatLimitMessage({ used: 25, total: 25, type: 'paid', tier: 'enterprise' });
  assert.match(ent, /up to 25 team members/);
  assert.doesNotMatch(ent, /upgrade/i);
});

// ---- audit-log export ------------------------------------------------------------------------

test('audit-log export is Enterprise only, refused in main before the save dialog', () => {
  assert.equal(tierPolicy.limitsForLicense(PRO).auditExport, false);
  assert.equal(tierPolicy.limitsForLicense(ENTERPRISE).auditExport, true);
  assert.equal(tierPolicy.limitsForLicense(TRIAL).auditExport, true);
  const body = fnBody('async function exportTeamActivity(');
  const gate = body.indexOf('if (!tierPolicy.limitsForLicense(await getLicense()).auditExport)');
  assert.ok(gate > 0, 'export checks the plan');
  assert.ok(gate < body.indexOf('db.activityLog.findMany'), 'before reading the log');
  assert.ok(gate < body.indexOf('dialog.showSaveDialog'), 'before the save dialog');
  assert.match(body, /e\.code = 'ENTERPRISE_REQUIRED';/);
  // Viewing the activity log stays open to every plan.
  assert.doesNotMatch(fnBody('async function getTeamActivity('), /tierPolicy|auditExport|ENTERPRISE_REQUIRED/);
});

test('license:get carries the plan limits on every path', () => {
  const body = fnBody('async function getLicense()');
  assert.equal((body.match(/return withPlanLimits\(/g) || []).length, 3, 'exempt, backend lease and local licence');
  const src = fnBody('function withPlanLimits(');
  const withPlanLimits = new Function('tierPolicy', `${src}\nreturn withPlanLimits;`)(tierPolicy);
  assert.deepEqual(withPlanLimits({ type: 'paid', tier: 'pro', state: 'paid' }).limits, { tier: 'pro', seats: 3, maxParallel: 3, auditExport: false });
  assert.deepEqual(withPlanLimits({ type: 'source-owner', tier: 'enterprise', isExempt: true }).limits, { tier: 'enterprise', seats: 25, maxParallel: 10, auditExport: true });
});

// ---- plan cards ------------------------------------------------------------------------------

function defaultPlans() {
  const start = IPC.indexOf('const TRIAL_DAYS = ');
  const end = IPC.indexOf(']);', IPC.indexOf('const DEFAULT_BILLING_PLANS = ')) + 3;
  assert.ok(start > 0 && end > start, 'billing constants must exist');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${IPC.slice(start, end)}\nthis.plans = DEFAULT_BILLING_PLANS;`, ctx);
  return JSON.parse(JSON.stringify(ctx.plans));
}

test('the plan cards describe the real split and drop the sync claim', () => {
  const byId = Object.fromEntries(defaultPlans().map((p) => [p.id, p]));
  assert.ok(byId.pro.features.includes('Up to 3 team members'));
  assert.ok(byId.pro.features.includes('Parallel runner, up to 3 profiles at once, with live run console'));
  assert.ok(byId.pro.features.includes('Full at-rest database encryption'), 'database encryption is in both plans');
  assert.deepEqual(byId.enterprise.features, [
    'Everything in Pro, plus:',
    'Up to 25 team members',
    'Parallel runner, up to 10 profiles at once, with live run console',
    'Audit-log export (CSV / JSON)',
    'Priority email support'
  ]);
  assert.equal(byId.enterprise.amount, '29');
  const text = JSON.stringify(byId);
  assert.doesNotMatch(text, /server you host|self-hosted|sync/i);
  // Every Pro feature is listed on Pro, so "Everything in Pro" covers it on Enterprise.
  assert.ok(!byId.enterprise.features.includes('Full at-rest database encryption'));
});

test('every built-in plan tagline and feature has an English and a Spanish card string', () => {
  const en = locale('en', 'billing').planText;
  const es = locale('es', 'billing').planText;
  const enTexts = new Set(Object.values(en));
  for (const p of defaultPlans()) {
    for (const s of [p.tagline, ...p.features]) assert.ok(enTexts.has(s), `no billing.planText entry for "${s}"`);
  }
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const k of Object.keys(es)) assert.ok(es[k] && es[k] !== en[k], `es planText.${k} is translated`);
  assert.match(BILLING_PAGE, /\{planText\(t, plan\.tagline\)\}/);
  assert.match(BILLING_PAGE, /<span>\{planText\(t, f\)\}<\/span>/);
});

// ---- UI --------------------------------------------------------------------------------------

test('the new UI strings exist in English and Spanish', () => {
  const need = {
    members: ['seats.usage', 'seats.fullNotice', 'seats.fullNoticeTop', 'seats.overNotice', 'seats.seeBilling', 'seats.limitError',
      'activity.enterpriseFeature', 'activity.seeBilling', 'activity.exportEnterpriseOnly'],
    automation: ['parallel.concurrencyCap', 'parallel.concurrencyCapUpgrade']
  };
  const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o);
  for (const [ns, keys] of Object.entries(need)) {
    for (const lang of ['en', 'es']) {
      const json = locale(lang, ns);
      for (const k of keys) assert.ok(typeof get(json, k) === 'string' && get(json, k).trim(), `${lang}/${ns}.json ${k}`);
    }
  }
});

test('the Members page shows the seat cap and the Enterprise export hint', () => {
  assert.match(MEMBERS_PAGE, /softglazeApi\.team\.seatUsage\(\)\.catch\(\(\) => null\)/);
  assert.match(MEMBERS_PAGE, /t\('seats\.usage', \{ used: seats\.used, total: seats\.total \}\)/);
  assert.match(MEMBERS_PAGE, /disabled=\{!canInvite\}/);
  assert.match(MEMBERS_PAGE, /disabled=\{!!exporting \|\| !exportAllowed\}/);
  assert.match(MEMBERS_PAGE, /t\('activity\.enterpriseFeature'\)/);
  assert.match(MEMBERS_PAGE, /navigate\('\/billing'\)/);
  assert.match(MEMBERS_PAGE, /e\.code === 'SEAT_LIMIT'/);
});

test('the parallel runner input is capped by the plan', () => {
  assert.match(AUTOMATION_PAGE, /lic && lic\.limits && lic\.limits\.maxParallel/);
  assert.match(AUTOMATION_PAGE, /max=\{maxParallel\}/);
  assert.match(AUTOMATION_PAGE, /concurrency: clampConcurrency\(concurrency\),/);
  assert.doesNotMatch(AUTOMATION_PAGE, /max=\{10\} value=\{concurrency\}/);
});
