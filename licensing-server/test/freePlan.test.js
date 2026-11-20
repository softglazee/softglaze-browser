'use strict';
// The Free plan (free forever + 7-day reverse trial): plan validation and limits, GET /v1/plans/public with
// and without include=free, checkout refusing Free, the licence answers (Free, trial, paid, locked), the
// usage check, the trial emails, and the metrics block.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
const { TIER_LIMITS, validatePlan, ensureFreePlan } = require('../src/plans/service');
const { revokeForRefund } = require('../src/licensing');
const { AUTOMATIONS, scheduleAutomations } = require('../src/email/automations');
const { builtIn, allDefaultRows, BUILT_IN_KEYS } = require('../src/email/defaults');
const { getSettings } = require('../src/settings');
const { computeMetrics } = require('../src/metrics/compute');

const { db, call, admin } = H;
const DAY = 86400000;
const HOUR = 3600000;
let T;
test.before(async () => { await H.start(); T = (await H.seedTenant()).id; });
test.after(() => H.stop());

const licence = (inst, extra = {}) => call('POST', '/v1/license', { body: { tenantId: T, ...inst, ...extra } });
const FORBIDDEN = /\b(antidetect|anti-detect|undetectable|bypass|evade|spoof\w*|stealth|ban|banned|fake|anonymous)\b/i;

test('plan validation: tier free must cost 0 and not recur; the new limit keys are checked', () => {
  assert.equal(validatePlan({ key: 'free', name: 'Free', tier: 'free', amount: 0 }).errors, null);
  assert.ok(validatePlan({ key: 'free', name: 'Free', tier: 'free', amount: 500 }).errors.amount);
  assert.ok(validatePlan({ key: 'free', name: 'Free', tier: 'free', amount: 0, recurring: true }).errors.recurring);
  assert.ok(validatePlan({ amount: 100 }, { partial: true, current: { tier: 'free', amount: 0 } }).errors.amount, 'PATCH checks the stored tier');
  assert.ok(validatePlan({ key: 'x', name: 'X', tier: 'gold', amount: 1 }).errors.tier);
  const ok = validatePlan({ key: 'p', name: 'P', amount: 500, limits: { profiles: null, aiActionsPerDay: 0, devices: 3, sync: true, phoneControl: false, partnerDeals: false } });
  assert.equal(ok.errors, null);
  for (const bad of [{ devices: 0 }, { devices: 1001 }, { profiles: -1 }, { profiles: 1.5 }, { aiActionsPerDay: '25' }, { sync: 'yes' }, { partnerDeals: 1 }, { colour: 'red' }]) {
    assert.ok(validatePlan({ key: 'p', name: 'P', amount: 500, limits: bad }).errors.limits, JSON.stringify(bad));
  }
  assert.deepEqual(TIER_LIMITS.free, { seats: 1, maxParallel: 1, auditExport: false, profiles: 25, devices: 1, aiActionsPerDay: 25, sync: false, phoneControl: false, partnerDeals: true });
  assert.equal(TIER_LIMITS.pro.devices, 3);
  assert.equal(TIER_LIMITS.enterprise.devices, 10);
  assert.equal(TIER_LIMITS.pro.profiles, null);
  assert.equal(TIER_LIMITS.enterprise.aiActionsPerDay, null);
});

test('admin: a free plan can be created (amount 0), not with a price; the built-in Free features avoid the forbidden words', async () => {
  const bad = await admin('POST', '/plans', { body: { key: 'free', name: 'Free', tier: 'free', amount: 100 } });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.fields.amount);
  const { plan, created } = await ensureFreePlan(db, T);
  assert.equal(created, true);
  assert.deepEqual([plan.key, plan.tier, plan.amount, plan.sortOrder, plan.recurring], ['free', 'free', 0, -100, false]);
  assert.equal((await ensureFreePlan(db, T)).created, false, 'idempotent');
  for (const f of plan.features) assert.ok(!FORBIDDEN.test(f) && !/[–—-]/.test(f), f);
  const g = await admin('GET', '/plans/free');
  assert.deepEqual(g.json.plan.effectiveLimits, TIER_LIMITS.free);
});

test('GET /v1/plans/public: without include=free the old answer; with it, Free first and every limit key', async () => {
  await ensureFreePlan(db, T);
  const old = await call('GET', `/v1/plans/public?tenantId=${T}`);
  assert.equal(old.status, 200);
  assert.deepEqual(old.json.map((p) => p.key), ['pro', 'enterprise'], 'app 1.0.26 never sees the Free plan');
  assert.deepEqual(old.json[0].limits, { seats: 3, maxParallel: 3, auditExport: false }, 'the old limit keys only');
  assert.deepEqual(Object.keys(old.json[0]).sort(), ['amount', 'amountDecimal', 'currency', 'features', 'highlight', 'interval', 'key', 'limits', 'months', 'name', 'tier']);

  const withFree = await call('GET', `/v1/plans/public?tenantId=${T}&include=free`);
  assert.equal(withFree.status, 200);
  assert.deepEqual(withFree.json.map((p) => p.key), ['free', 'pro', 'enterprise']);
  const free = withFree.json[0];
  assert.deepEqual([free.tier, free.amount, free.amountDecimal], ['free', 0, '0.00']);
  assert.deepEqual(free.limits, TIER_LIMITS.free);
  assert.deepEqual(withFree.json[1].limits, TIER_LIMITS.pro);
  // The two variants are cached separately: asking without the parameter again still hides Free.
  assert.deepEqual((await call('GET', `/v1/plans/public?tenantId=${T}`)).json.map((p) => p.key), ['pro', 'enterprise']);
  // An admin change clears both variants at once.
  await admin('PATCH', '/plans/free', { body: { name: 'Free forever' } });
  assert.equal((await call('GET', `/v1/plans/public?tenantId=${T}&include=free`)).json[0].name, 'Free forever');
  await admin('PATCH', '/plans/free', { body: { name: 'Free' } });
});

test('checkout refuses the Free plan, in the app and on the website (409 plan_not_purchasable)', async () => {
  await ensureFreePlan(db, T);
  const inst = await H.newInstall(T, 'free-checkout');
  const app = await call('POST', '/v1/checkout', { body: { tenantId: T, planKey: 'free', installId: inst.installId, provider: 'stripe' } });
  assert.equal(app.status, 409);
  assert.equal(app.json.error, 'plan_not_purchasable');
  const web = await call('POST', '/v1/checkout', { body: { tenantId: T, planKey: 'free', provider: 'safepay', account: 'buyer@example.com' } });
  assert.equal(web.status, 409);
  assert.equal(web.json.error, 'plan_not_purchasable');
  // A paid tier with a US$0 price is refused too.
  await db.plan.create({ data: { tenantId: T, key: 'zero', name: 'Zero', tier: 'pro', amount: 0 } });
  assert.equal((await call('POST', '/v1/checkout', { body: { tenantId: T, planKey: 'zero', installId: inst.installId } })).json.error, 'plan_not_purchasable');
  assert.equal(db.tables.payment.filter((p) => p.plan === 'free' || p.plan === 'zero').length, 0, 'no payment is recorded');
});

test('licence: an install that never had a trial is on Free (no lease, the tenant Free plan limits)', async () => {
  const inst = await H.newInstall(T, 'free-never');
  const r = await licence(inst);
  assert.equal(r.status, 200);
  assert.equal(r.json.lease, null, 'never a signed lease: app 1.0.26 would read it as paid');
  assert.deepEqual([r.json.status, r.json.free, r.json.plan, r.json.tier], ['none', true, 'free', 'free']);
  assert.equal(r.json.trialEndsAt, undefined);
  assert.equal(r.json.lockReason, undefined);
  assert.deepEqual(r.json.limits, TIER_LIMITS.free);
  // The tenant's own Free plan row decides the limits.
  await ensureFreePlan(db, T);
  await admin('PATCH', '/plans/free', { body: { limits: { profiles: 30 } } });
  assert.equal((await licence(inst)).json.limits.profiles, 30);
  await admin('PATCH', '/plans/free', { body: { limits: null } });
  assert.equal((await licence(inst)).json.limits.profiles, 25);
});

test('licence: a running trial carries plan trial and enterprise limits; once it ends the install is on Free', async () => {
  const inst = await H.newInstall(T, 'free-trial');
  const now = Date.now();
  const trial = await db.trial.create({ data: { tenantId: T, installId: inst.installId, machineHash: inst.machineHash, emailKeyHash: 'ek-free-trial', startedAt: new Date(now - DAY), endsAt: new Date(now + 6 * DAY) } });
  const running = await licence(inst);
  assert.equal(running.json.type, 'trial');
  assert.ok(running.json.lease);
  assert.equal(running.json.plan, 'trial');
  assert.deepEqual(running.json.limits, TIER_LIMITS.enterprise);
  assert.equal(running.json.free, undefined);

  db.tables.trial.find((t) => t.id === trial.id).endsAt = new Date(now - HOUR);
  const ended = await licence(inst);
  assert.equal(ended.json.lease, null);
  assert.deepEqual([ended.json.free, ended.json.plan, ended.json.tier], [true, 'free', 'free']);
  assert.equal(new Date(ended.json.trialEndsAt).getTime(), now - HOUR);
  assert.equal(ended.json.lockReason, undefined, 'no lock after a trial');
});

test('licence: a paid licence carries its plan and limits; after its term or a cancelled subscription, Free', async () => {
  const inst = await H.newInstall(T, 'free-paid');
  const lic = await db.license.create({ data: { tenantId: T, installId: inst.installId, tier: 'pro', plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 20 * DAY) } });
  const paid = await licence(inst);
  assert.equal(paid.json.type, 'paid');
  assert.ok(paid.json.lease);
  assert.equal(paid.json.plan, 'pro');
  assert.deepEqual(paid.json.limits, TIER_LIMITS.pro);
  // Plan limits override the tier's.
  await admin('PATCH', '/plans/pro', { body: { limits: { seats: 5 } } });
  assert.equal((await licence(inst)).json.limits.seats, 5);
  await admin('PATCH', '/plans/pro', { body: { limits: null } });

  db.tables.license.find((l) => l.id === lic.id).status = 'expired';
  const after = await licence(inst);
  assert.deepEqual([after.json.lease, after.json.status, after.json.free, after.json.plan], [null, 'expired', true, 'free']);
  db.tables.license.find((l) => l.id === lic.id).status = 'active';
  db.tables.license.find((l) => l.id === lic.id).currentPeriodEnd = new Date(Date.now() - DAY);
  assert.equal((await licence(inst)).json.free, true, 'a term that ran out is Free, not a lock');
});

test('licence: an admin revoke locks with lockReason revoked; a refund with lockReason refunded', async () => {
  const a = await H.newInstall(T, 'free-revoked');
  const lic = await db.license.create({ data: { tenantId: T, installId: a.installId, tier: 'pro', plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 20 * DAY) } });
  const rv = await admin('POST', `/licenses/${lic.id}/revoke`, { body: { reason: 'chargeback abuse' } });
  assert.equal(rv.status, 200);
  const r1 = await licence(a);
  assert.deepEqual([r1.json.lease, r1.json.status, r1.json.free, r1.json.lockReason], [null, 'canceled', false, 'revoked']);
  assert.equal(r1.json.limits, undefined);
  assert.equal(r1.json.plan, undefined);

  const b = await H.newInstall(T, 'free-refunded');
  await db.payment.create({ data: { tenantId: T, provider: 'stripe', providerRef: 'cs_free_refund', amount: 500, status: 'paid', plan: 'pro', installId: b.installId } });
  await db.license.create({ data: { tenantId: T, installId: b.installId, tier: 'pro', plan: 'pro', status: 'active', providerRef: 'cs_free_refund', currentPeriodEnd: new Date(Date.now() + 20 * DAY) } });
  const tenant = db.tables.tenant.find((t) => t.id === T);
  assert.deepEqual(await revokeForRefund(tenant, { provider: 'stripe', sessionRef: 'cs_free_refund' }, db), { changed: true });
  const r2 = await licence(b);
  assert.deepEqual([r2.json.lease, r2.json.free, r2.json.lockReason], [null, false, 'refunded']);

  // A Microsoft Store licence that moved to another PC is not a lock; a Store refund is.
  const c = await H.newInstall(T, 'free-store');
  const st = await db.license.create({ data: { tenantId: T, installId: c.installId, tier: 'pro', status: 'canceled', source: 'microsoft_store', revokedAt: new Date(), revokedReason: 'Microsoft Store: moved', currentPeriodEnd: new Date() } });
  assert.equal((await licence(c)).json.free, true);
  db.tables.license.find((l) => l.id === st.id).revokedReason = 'Microsoft Store: refunded';
  assert.equal((await licence(c)).json.lockReason, 'refunded');
});

test('licence usage: Free over its AI actions gets usageFlags and one event per install per day; junk is ignored', async () => {
  const inst = await H.newInstall(T, 'free-usage');
  const cust = await db.customer.create({ data: { tenantId: T, email: 'usage@example.com', emailKey: 'usage@example.com', emailVerifiedAt: new Date() } });
  db.tables.install.find((i) => i.id === inst.installId).customerId = cust.id;
  const events = () => db.tables.customerEvent.filter((e) => e.customerId === cust.id && e.type === 'free_limit_exceeded');

  const under = await licence(inst, { usage: { aiActionsToday: 25, profiles: 25, running: 1 } });
  assert.equal(under.json.usageFlags, undefined);
  const over = await licence(inst, { usage: { aiActionsToday: 26, profiles: 3, running: 1 } });
  assert.deepEqual(over.json.usageFlags, ['ai_over_limit']);
  await licence(inst, { usage: { aiActionsToday: 40 } });
  assert.equal(events().length, 1, 'one event per install per UTC day');
  assert.deepEqual([events()[0].data.installId, events()[0].data.allowed, events()[0].data.reported], [inst.installId, 25, 26]);

  for (const junk of [{ aiActionsToday: '99' }, { aiActionsToday: -1 }, { aiActionsToday: 1.5 }, [1, 2], 'lots', null]) {
    const r = await licence(inst, { usage: junk });
    assert.equal(r.status, 200);
    assert.equal(r.json.usageFlags, undefined, JSON.stringify(junk));
  }
  // Trial and paid installs are not flagged (their limit is unlimited).
  const t = await H.newInstall(T, 'free-usage-trial');
  await db.trial.create({ data: { tenantId: T, installId: t.installId, machineHash: t.machineHash, emailKeyHash: 'ek-usage', startedAt: new Date(), endsAt: new Date(Date.now() + DAY) } });
  assert.equal((await licence(t, { usage: { aiActionsToday: 500 } })).json.usageFlags, undefined);
});

test('emails: trial emails speak of Free, never of a lock; locks_tomorrow is no automation; free_plan_launch is manual only', async () => {
  for (const lang of ['en', 'es']) {
    for (const key of ['trial_ending', 'trial_ended']) {
      const t = builtIn(key, lang);
      const all = `${t.subject}\n${t.html}\n${t.text}`;
      assert.ok(!/\block|stops opening|will not open|grace|bloque(a|ar)\b|deja de abrir|no abrirá/i.test(all.replace(/No se bloquea nada|Nothing is locked/g, '')), `${key}/${lang}`);
      assert.match(all, lang === 'en' ? /Free plan/ : /plan gratuito/);
    }
  }
  assert.match(builtIn('trial_ended', 'en').text, /You are now on the Free plan/);
  assert.match(builtIn('trial_ended', 'en').text, /25 can be opened/);
  assert.match(builtIn('trial_ended', 'en').text, /US\$5 a month/);

  const keys = AUTOMATIONS.map((a) => a.key);
  assert.ok(!keys.includes('locks_tomorrow'));
  assert.ok(!keys.includes('free_plan_launch'));
  assert.equal(builtIn('free_plan_launch', 'en').subject, 'Good news: SoftGlaze now has a free plan');
  assert.equal(builtIn('free_plan_launch', 'es').subject, 'Buenas noticias: SoftGlaze ya tiene un plan gratuito');
  assert.equal(builtIn('free_plan_launch', 'es').lang, 'es');
  assert.equal(builtIn('free_plan_launch', 'en').category, 'marketing');
  assert.ok(BUILT_IN_KEYS.includes('free_plan_launch'));

  // Every built-in email: no forbidden word, no dashes.
  for (const r of allDefaultRows()) {
    const all = `${r.subject}\n${r.html}\n${r.text}`;
    assert.ok(!FORBIDDEN.test(all), `${r.key}/${r.lang}: forbidden word`);
    assert.ok(!/[–—]/.test(all), `${r.key}/${r.lang}: no em/en dash`);
  }

  // An ended trial: day 7 says "you are on Free", nothing is queued at the old end-of-grace time.
  const start = Date.now() - 10 * DAY;
  const c = await db.customer.create({ data: { tenantId: T, email: 'ended@example.com', emailKey: 'ended@example.com', emailVerifiedAt: new Date(start), lang: 'en' } });
  const tr = await db.trial.create({ data: { tenantId: T, customerId: c.id, machineHash: 'm-ended', emailKeyHash: 'e-ended', startedAt: new Date(start), endsAt: new Date(start + 7 * DAY) } });
  const settings = await getSettings(db, T);
  const tenant = db.tables.tenant.find((t) => t.id === T);
  await scheduleAutomations(db, tenant, { now: tr.endsAt.getTime() + HOUR, settings });
  await scheduleAutomations(db, tenant, { now: tr.endsAt.getTime() + 49 * HOUR, settings });
  const queued = db.tables.emailOutbox.filter((o) => o.customerId === c.id).map((o) => o.templateKey);
  assert.ok(queued.includes('trial_ended'));
  assert.ok(!queued.includes('locks_tomorrow'));
  assert.ok(!queued.includes('free_plan_launch'));
  assert.match(db.tables.emailOutbox.find((o) => o.customerId === c.id && o.templateKey === 'trial_ended').subject, /Free plan/);

  // Older admin clients that send the whole automations object still validate.
  assert.equal((await admin('PATCH', '/settings', { body: { automations: { locks_tomorrow: { enabled: false } } } })).status, 200);
  assert.ok(!(await admin('GET', '/email/automations')).json.items.some((a) => a.key === 'locks_tomorrow'));
});

test('account summaries report the plan: free after a trial, trial during one', async () => {
  const { accountPlan } = require('../src/auth/accountApi');
  assert.equal(accountPlan({ status: 'trial_expired', tier: null }), 'free');
  assert.equal(accountPlan({ status: 'lead', tier: null }), 'free');
  assert.equal(accountPlan({ status: 'trial', tier: 'enterprise' }), 'trial');
  assert.equal(accountPlan({ status: 'paid', tier: 'pro' }), 'pro');
});

test('metrics: the free block counts Free users, weekly active, free to paid, deal clicks and 12-month inactive', async () => {
  const M = 'tenantMetrics';
  await H.seedTenant(M);
  const now = Date.now();
  const cust = (email, extra = {}) => db.customer.create({ data: { tenantId: M, email, emailKey: email, ...extra } });
  // Free: verified, seen today.
  await cust('f1@example.com', { emailVerifiedAt: new Date(now - 30 * DAY), lastSeenAt: new Date(now - HOUR) });
  // Free: not verified but has an install; seen 20 days ago.
  const f2 = await cust('f2@example.com', { lastSeenAt: new Date(now - 20 * DAY) });
  await db.install.create({ data: { tenantId: M, machineId: 'm-f2', customerId: f2.id } });
  // Free and gone for more than a year: an archive candidate.
  await cust('f3@example.com', { emailVerifiedAt: new Date(now - 500 * DAY), lastSeenAt: new Date(now - 400 * DAY) });
  // Not Free: unverified, no install.
  await cust('lead@example.com');
  // Not Free: a running trial.
  const t1 = await cust('t1@example.com', { emailVerifiedAt: new Date(), lastSeenAt: new Date() });
  await db.trial.create({ data: { tenantId: M, customerId: t1.id, machineHash: 'mt1', emailKeyHash: 'et1', startedAt: new Date(now - DAY), endsAt: new Date(now + 6 * DAY) } });
  // Not Free: paid after a trial ended (free to paid).
  const p1 = await cust('p1@example.com', { emailVerifiedAt: new Date(), lastSeenAt: new Date(), paidSince: new Date(now - 5 * DAY) });
  await db.trial.create({ data: { tenantId: M, customerId: p1.id, machineHash: 'mp1', emailKeyHash: 'ep1', startedAt: new Date(now - 20 * DAY), endsAt: new Date(now - 13 * DAY) } });
  await db.license.create({ data: { tenantId: M, customerId: p1.id, tier: 'pro', plan: 'pro', status: 'active', currentPeriodEnd: new Date(now + 25 * DAY) } });
  // Deleted: never counted.
  await cust('gone@example.com', { emailVerifiedAt: new Date(), deletedAt: new Date() });
  await db.partnerDeal.create({ data: { tenantId: M, title: 'A', vendor: 'V', url: 'https://a.example', clicks: 3 } });
  await db.partnerDeal.create({ data: { tenantId: M, title: 'B', vendor: 'V', url: 'https://b.example', clicks: 4 } });
  await db.partnerDeal.create({ data: { tenantId: T, title: 'Other tenant', vendor: 'V', url: 'https://c.example', clicks: 100 } });

  const m = await computeMetrics(db, M, { now });
  assert.deepEqual(m.free, { freeUsers: 3, activeFree7d: 1, freeToPaid: 1, freeToPaidWindowDays: 30, dealClicks: 7, freeInactive12m: 1 });
  const viaApi = await admin('GET', '/metrics?days=3');
  assert.equal(viaApi.status, 200);
  assert.equal(viaApi.json.free.freeToPaidWindowDays, 3);
});
