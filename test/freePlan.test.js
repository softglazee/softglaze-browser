'use strict';
// Free forever plan (1.0.27): the pure rules (freePlan.js, partnerDeals.js, tierPolicy.js), the real licence and
// limit functions from ipcHandlers.js run through the licence harness (trial -> Free, revoked / refunded lock,
// profile cap, one running profile, choose which profiles open, Continue on Free, the day 8 screen), the AI action
// quota in the tool registry, the phone bridge refusal and the source wiring of every enforcement point.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');

const { publicKey } = generateKeyPairSync('ed25519');
process.env.SG_TENANT_ID = 'tenant_test';
process.env.SG_API_BASE_URL = 'http://127.0.0.1:9';
process.env.SG_TENANT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const freePlan = require('../src/main/freePlan');
const partnerDeals = require('../src/main/partnerDeals');
const tierPolicy = require('../src/main/tierPolicy');
const planCatalog = require('../src/main/planCatalog');
const { buildMain } = require('./helpers/licenseHarness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const DAY = 86400000;
const plain = (v) => JSON.parse(JSON.stringify(v));
const OWNER = () => ({ id: 1, name: 'Ada Owner', email: 'ada@example.com', role: 'OWNER', status: 'active', createdAt: new Date() });
const ENDED_TRIAL = () => ({ id: 2, ownerMemberId: 1, type: 'trial', tier: 'enterprise', status: 'active', trialEndsAt: new Date(Date.now() - DAY), createdAt: new Date(Date.now() - 8 * DAY) });
const CUTOVER = { tenantTrialCutover: { v: 1, at: new Date(Date.now() - 9 * DAY).toISOString(), legacy: {} } };
const profiles = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

function onFree(over = {}) {
  return buildMain({ tenant: true, members: [OWNER()], activeMemberId: 1, licenses: [ENDED_TRIAL()], ...over, settings: { ...CUTOVER, ...(over.settings || {}) } });
}

// ---- pure rules --------------------------------------------------------------------------------

test('Free limits: 25 profiles, 1 running, 1 seat, 1 PC, 25 AI actions a day, no sync or phone control, deals shown', () => {
  assert.deepEqual(plain(freePlan.FREE_LIMITS), {
    tier: 'free', seats: 1, maxParallel: 1, auditExport: false, profiles: 25, devices: 1, aiActionsPerDay: 25, sync: false, phoneControl: false, partnerDeals: true
  });
  const l = tierPolicy.limitsForLicense({ type: 'free' });
  assert.equal(l.tier, 'free');
  assert.equal(l.seats, 1);
  assert.equal(l.profiles, 25);
  assert.equal(l.runningCap, 1);
  assert.equal(l.aiActionsPerDay, 25);
  assert.equal(l.sync, false);
  assert.equal(l.phoneControl, false);
  assert.equal(l.partnerDeals, true);
  // Pro, Enterprise and the trial have none of those caps and never see the deals card.
  for (const lic of [{ type: 'paid', tier: 'pro' }, { type: 'paid', tier: 'enterprise' }, { type: 'trial', tier: 'enterprise' }]) {
    const p = tierPolicy.limitsForLicense(lic);
    assert.equal(p.profiles, null);
    assert.equal(p.aiActionsPerDay, null);
    assert.equal(p.runningCap, null);
    assert.equal(p.sync, true);
    assert.equal(p.phoneControl, true);
    assert.equal(p.partnerDeals, false);
  }
});

test('server limits override the built-in Free limits, but junk never loosens them', () => {
  assert.equal(freePlan.normalizeFreeLimits({ profiles: 30, aiActionsPerDay: 40 }).profiles, 30);
  const junk = freePlan.normalizeFreeLimits({ profiles: -1, maxParallel: 'lots', sync: 'yes', seats: 0, extra: 9 });
  assert.equal(junk.profiles, 25);
  assert.equal(junk.maxParallel, 1);
  assert.equal(junk.sync, false);
  assert.equal(junk.seats, 1);
  assert.equal(junk.extra, undefined);
  assert.equal(tierPolicy.limitsForLicense({ type: 'free', freeLimits: { profiles: 30 } }).profiles, 30);
});

test('the server answer: free, lock reasons and usage flags', () => {
  assert.deepEqual(plain(freePlan.stateFromServer({ lease: null, free: true, limits: { profiles: 25 } }, 5)).free, true);
  assert.equal(freePlan.stateFromServer({ lease: null, free: false, lockReason: 'revoked' }).lockReason, 'revoked');
  assert.equal(freePlan.stateFromServer({ lease: null, free: false, lockReason: 'refunded' }).lockReason, 'refunded');
  assert.equal(freePlan.stateFromServer({ lease: null, lockReason: 'something' }).lockReason, null);
  assert.deepEqual(freePlan.stateFromServer({ usageFlags: ['ai_over_limit', 3] }).usageFlags, ['ai_over_limit']);
  assert.equal(freePlan.lockReasonOf(null), null);
});

test('profile capacity: the 26th profile is refused, unlimited plans always pass', () => {
  assert.equal(freePlan.profileCapacity({ limit: 25, used: 24 }).allowed, true);
  assert.equal(freePlan.profileCapacity({ limit: 25, used: 25 }).allowed, false);
  assert.equal(freePlan.profileCapacity({ limit: 25, used: 20, want: 6 }).allowed, false);
  assert.equal(freePlan.profileCapacity({ limit: 25, used: 20, want: 5 }).remaining, 5);
  assert.equal(freePlan.profileCapacity({ limit: null, used: 9999 }).allowed, true);
});

test('AI actions: 25 a day on Free, a new day starts at 0, unlimited plans still count', () => {
  let state = null;
  const now = new Date(2026, 10, 20, 10).getTime();
  for (let i = 1; i <= 25; i += 1) {
    const r = freePlan.takeAiAction(state, { limit: 25, nowMs: now });
    assert.equal(r.allowed, true);
    state = r.next;
  }
  const refused = freePlan.takeAiAction(state, { limit: 25, nowMs: now });
  assert.equal(refused.allowed, false);
  assert.equal(refused.used, 25);
  assert.equal(freePlan.takeAiAction(state, { limit: 25, nowMs: now + DAY }).allowed, true, 'tomorrow starts fresh');
  assert.equal(freePlan.aiActionsUsed(state, now), 25);
  assert.equal(freePlan.aiActionsUsed(state, now + DAY), 0);
  const pro = freePlan.takeAiAction({ day: freePlan.dayKey(now), count: 500 }, { limit: null, nowMs: now });
  assert.equal(pro.allowed, true);
  assert.equal(pro.next.count, 501);
});

test('coming down from Pro: every profile is kept, only the chosen 25 open', () => {
  const ids = Array.from({ length: 40 }, (_, i) => i + 1);
  assert.deepEqual(freePlan.canOpenProfile({ profileId: 3, profileIds: ids.slice(0, 25), chosen: [], limit: 25 }), { allowed: true, needsChoice: false }, '25 or fewer: all open');
  assert.deepEqual(freePlan.canOpenProfile({ profileId: 3, profileIds: ids, chosen: [], limit: 25 }), { allowed: false, needsChoice: true }, 'more than 25 and no choice yet');
  assert.equal(freePlan.canOpenProfile({ profileId: 3, profileIds: ids, chosen: [3, 4], limit: 25 }).allowed, true);
  assert.equal(freePlan.canOpenProfile({ profileId: 30, profileIds: ids, chosen: [3, 4], limit: 25 }).allowed, false);
  assert.deepEqual(freePlan.chosenOpenable([99, 3, 3, '4'], ids, 25), [3, 4], 'deleted and duplicate ids are dropped');
  assert.equal(freePlan.chosenOpenable(ids, ids, 25).length, 25, 'never more than the limit');
});

test('plan limit errors carry PLAN_LIMIT and what the upgrade prompt needs, with no blocked words', () => {
  for (const kind of ['profiles', 'running', 'openable', 'seats', 'ai', 'sync', 'phone']) {
    const e = freePlan.planLimitError(kind, { limit: 25, used: 25 });
    assert.equal(e.code, 'PLAN_LIMIT');
    assert.equal(e.planLimit.kind, kind);
    assert.doesNotMatch(e.message, /antidetect|undetectable|bypass|evade|spoof|stealth|\bban|fake|anonymous/i);
  }
});

test('partner deals: https only, at most 6, three a day rotating, with the disclosure', () => {
  const raw = { deals: [
    { id: 'a', title: 'Deal A', url: 'https://vendor.example/a?ref=sg', code: 'SG10', badge: '10% off' },
    { id: 'b', title: 'Deal B', url: 'http://vendor.example/b' },
    { id: 'c', title: '', url: 'https://vendor.example/c' },
    { id: 'd', title: 'Deal D', url: 'https://user:pw@vendor.example/d' },
    { id: 'a', title: 'Dup', url: 'https://vendor.example/a' },
    ...['e', 'f', 'g', 'h', 'i', 'j'].map((id) => ({ id, title: `Deal ${id}`, url: `https://vendor.example/${id}`, logoUrl: 'javascript:alert(1)' }))
  ] };
  const deals = partnerDeals.normalizeDeals(raw);
  assert.equal(deals.length, 6);
  assert.deepEqual(deals.map((d) => d.id), ['a', 'e', 'f', 'g', 'h', 'i']);
  assert.equal(deals[0].code, 'SG10');
  assert.equal(deals[1].logoUrl, null);
  const today = partnerDeals.pickDeals(deals, { count: 3, seed: '2026-11-20' });
  assert.equal(today.length, 3);
  assert.deepEqual(partnerDeals.pickDeals(deals, { count: 3, seed: '2026-11-20' }), today, 'stable within a day');
  assert.deepEqual(partnerDeals.normalizeDeals({ deals: [] }), []);
  assert.equal(partnerDeals.DISCLOSURE, 'Partner offer. SoftGlaze may earn a commission.');
});

test('the server Free plan is not a card to buy in the app', () => {
  const plans = planCatalog.plansFromServer([
    { key: 'free', name: 'Free', tier: 'free', amount: 0, interval: 'month', months: 1 },
    { key: 'pro', name: 'Pro', tier: 'pro', amount: 500, interval: 'month', months: 1 }
  ]);
  assert.deepEqual(plans.map((p) => p.id), ['pro']);
});

// ---- licence: trial ends into Free, never a lock -----------------------------------------------

test('day 8: an ended trial is Free at once, with the Free limits and the welcome screen once', async () => {
  const m = onFree();
  const lic = await m.fns.getLicense();
  assert.equal(lic.type, 'free');
  assert.equal(lic.isFree, true);
  assert.equal(lic.isBanned, false);
  assert.equal(lic.needsPlan, false);
  assert.equal(lic.endedFrom, 'trial');
  assert.equal(lic.limits.profiles, 25);
  await m.fns.assertNotBanned();
  const usage = await m.fns.getPlanUsage();
  assert.equal(usage.isFree, true);
  assert.equal(usage.showFreeWelcome, true);
  await m.fns.ackFreeWelcome();
  assert.equal((await m.fns.getPlanUsage()).showFreeWelcome, false, 'shown once');
});

test('a paid term that ended keeps its grace days, then goes to Free (not a lock)', async () => {
  const lic = { id: 3, ownerMemberId: 1, type: 'paid', tier: 'pro', status: 'active', trialEndsAt: new Date(Date.now() - DAY), createdAt: new Date(Date.now() - 40 * DAY) };
  const m = buildMain({ tenant: true, members: [OWNER()], activeMemberId: 1, licenses: [lic], settings: CUTOVER });
  assert.equal((await m.fns.getLicense()).isGrace, true, 'renewal grace stays for paid terms');
  m.db.licenses[0].trialEndsAt = new Date(Date.now() - 10 * DAY);
  const after = await m.fns.getLicense();
  assert.equal(after.type, 'free');
  assert.equal(after.endedFrom, 'paid');
  assert.equal(after.isBanned, false);
});

test('a licence the server reports revoked or refunded stays locked (no Free)', async () => {
  for (const lockReason of ['revoked', 'refunded']) {
    const m = onFree({ settings: { freePlanState: { free: false, lockReason, limits: null, at: Date.now() } } });
    const lic = await m.fns.getLicense();
    assert.equal(lic.isBanned, true, lockReason);
    assert.equal(lic.isFree, false);
    assert.equal(lic.lockReason, lockReason);
    await assert.rejects(m.fns.assertNotBanned(), (e) => e.code === 'LICENSE_BANNED');
  }
});

test('a machine mismatch locks Free too', async () => {
  const m = onFree({ licenseIssue: () => ({ reason: 'machine_mismatch' }) });
  const lic = await m.fns.getLicense();
  assert.equal(lic.isBanned, true);
  assert.equal(lic.isFree, false);
});

test('the licence refresh stores the server\'s Free answer and sends usage', async () => {
  const m = onFree({ api: { license: async () => ({ lease: null, status: 'none', free: true, plan: 'free', tier: 'free', limits: { profiles: 30, aiActionsPerDay: 40 } }) } });
  await m.fns.refreshBackendLease();
  const st = m.settings.get('freePlanState');
  assert.equal(st.free, true);
  assert.equal(st.limits.profiles, 30);
  const lic = await m.fns.getLicense();
  assert.equal(lic.limits.profiles, 30, 'the server limits drive the app');
  assert.equal(lic.limits.aiActionsPerDay, 40);
  const locked = onFree({ api: { license: async () => ({ lease: null, status: 'canceled', free: false, lockReason: 'refunded' }) } });
  await locked.fns.refreshBackendLease();
  assert.equal((await locked.fns.getLicense()).isBanned, true);
});

test('the plan step: "Continue on Free" without a trial, Owner only', async () => {
  const m = buildMain({ tenant: true, members: [OWNER()], activeMemberId: 1 });
  assert.equal((await m.fns.getLicense()).needsPlan, true, 'a fresh workspace still sees the plan step (trial first)');
  const lic = await m.fns.chooseFreePlan();
  assert.equal(lic.type, 'free');
  assert.equal(lic.endedFrom, null, 'no day 8 screen for someone who chose Free');
  assert.equal((await m.fns.getPlanUsage()).showFreeWelcome, false);
  const op = buildMain({ tenant: true, members: [OWNER(), { id: 2, name: 'Op', role: 'OPERATOR', status: 'active', parentMemberId: 1 }], activeMemberId: 2 });
  await assert.rejects(op.fns.chooseFreePlan(), (e) => e.code === 'FORBIDDEN');
});

// ---- enforcement -------------------------------------------------------------------------------

test('profile create: the 26th profile is refused on Free with PLAN_LIMIT, never on Pro or the trial', async () => {
  const m = onFree({ profiles: profiles(25) });
  await assert.rejects(m.fns.assertPlanProfileCapacity(1), (e) => e.code === 'PLAN_LIMIT' && e.planLimit.kind === 'profiles' && e.planLimit.limit === 25 && e.limitKind === 'profile');
  const room = onFree({ profiles: profiles(24) });
  await room.fns.assertPlanProfileCapacity(1);
  await assert.rejects(room.fns.assertPlanProfileCapacity(2), (e) => e.code === 'PLAN_LIMIT', 'a batch past the cap is refused');
  const counters = await m.fns.getPlanUsage();
  assert.deepEqual(plain(counters.profiles), { used: 25, limit: 25 });
  const legacyTrial = buildMain({ tenant: true, members: [OWNER()], activeMemberId: 1, profiles: profiles(200),
    licenses: [{ id: 1, ownerMemberId: 1, type: 'trial', tier: 'enterprise', status: 'active', trialEndsAt: new Date(Date.now() + 3 * DAY), createdAt: new Date() }] });
  await legacyTrial.fns.assertPlanProfileCapacity(1);
});

test('launch: a second profile while one runs is refused on Free; the open one is never refused', async () => {
  const m = onFree({ profiles: profiles(3), sessions: [1] });
  await assert.rejects(m.fns.assertPlanCanLaunch(2), (e) => e.code === 'PLAN_LIMIT' && e.planLimit.kind === 'running' && e.planLimit.limit === 1);
  await m.fns.assertPlanCanLaunch(1);
  const idle = onFree({ profiles: profiles(3), sessions: [] });
  await idle.fns.assertPlanCanLaunch(2);
  const usage = await m.fns.getPlanUsage();
  assert.deepEqual(plain(usage.running), { used: 1, limit: 1 });
});

test('launch: with more than 25 profiles on Free the owner chooses which 25 open', async () => {
  const m = onFree({ profiles: profiles(40) });
  await assert.rejects(m.fns.assertPlanCanLaunch(5), (e) => e.code === 'PLAN_LIMIT' && e.planLimit.kind === 'openable' && e.planLimit.needsChoice === true);
  assert.equal((await m.fns.getPlanUsage()).openable.needsChoice, true);
  await assert.rejects(m.fns.setFreeOpenableProfiles({ ids: profiles(26).map((p) => p.id) }), /at most 25/);
  const r = await m.fns.setFreeOpenableProfiles({ ids: [5, 6, 7] });
  assert.deepEqual(plain(r.chosen), [5, 6, 7]);
  await m.fns.assertPlanCanLaunch(5);
  await assert.rejects(m.fns.assertPlanCanLaunch(30), (e) => e.planLimit.kind === 'openable' && e.planLimit.needsChoice === false);
  assert.equal(m.db.licenses.length, 1, 'nothing is deleted');
});

test('sync and phone control are Pro features', async () => {
  const m = onFree();
  await assert.rejects(m.fns.assertPlanAllows('sync'), (e) => e.code === 'PLAN_LIMIT' && e.planLimit.kind === 'sync');
  assert.equal(await m.fns.planAllows('phoneControl'), false);
  const pro = buildMain({ tenant: false, members: [OWNER()], activeMemberId: 1,
    licenses: [{ id: 1, ownerMemberId: 1, type: 'paid', tier: 'pro', status: 'active', trialEndsAt: new Date(Date.now() + 30 * DAY), createdAt: new Date() }] });
  assert.equal(await pro.fns.planAllows('sync'), true);
  assert.equal(await pro.fns.planAllows('phoneControl'), true);
});

test('AI actions: the registry refuses past the plan quota with PLAN_LIMIT before the tool runs', async () => {
  const reg = require('../src/main/ai/toolRegistry');
  const { ApprovalManager } = require('../src/main/ai/approvals');
  const aiSettings = require('../src/main/ai/aiSettings');
  const memories = require('../src/main/ai/memories');
  const { createFakeApp } = require('./helpers/aiFakes');
  const app = createFakeApp();
  let left = 2;
  const settings = aiSettings.normalizeStored({ enabled: true });
  const audit = [];
  const registry = new reg.ToolRegistry({
    deps: app.toolDeps,
    inlineWaitMs: 300,
    services: {
      settings: () => settings, isEnabled: () => true, approvals: new ApprovalManager({ timeoutMs: 1000, emit: () => {} }),
      audit: { record: async (e) => { audit.push(e); } },
      memory: memories.createMemoryStore({ read: async (_k, f) => f, write: async () => {} }),
      tracker: new reg.AiTracker(), jobs: new reg.JobStore({ inlineMs: 200 }), limiter: new reg.RateLimiter(),
      quota: { take: async () => (left-- > 0 ? { ok: true } : { ok: false, error: 'The Free plan includes 25 AI actions a day.' }) }
    }
  });
  const token = { id: 1, name: 'T', kind: 'ai', scope: 'operate', groupIds: [], preApproved: null, memberId: 1 };
  const call = () => registry.call('list_profiles', {}, { token, clientName: 'Test', transport: 'mcp' });
  assert.equal((await call()).ok, true);
  assert.equal((await call()).ok, true);
  const refused = await call();
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'PLAN_LIMIT');
  assert.match(refused.error, /25 AI actions a day/);
  assert.equal(audit.at(-1).outcome, 'denied');
});

test('phone bridge: open, stop and restart answer "limit" on Free; viewing still works', async () => {
  const { MobileBridge } = require('../src/main/mobile/bridge');
  const started = [];
  const bridge = Object.create(MobileBridge.prototype);
  bridge.host = { remoteControlAllowed: async () => false, startProfile: async (id) => started.push(id) };
  bridge._profiles = async () => ({ ok: true, code: 'ok' });
  for (const name of ['profile.start', 'profile.stop', 'profile.restart']) {
    const r = await bridge._run({}, {}, { name, profileIds: ['p0000001'] });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'limit');
    assert.match(r.message, /Upgrade to Pro to open profiles from your phone/);
  }
  bridge.host.remoteControlAllowed = async () => true;
  assert.equal((await bridge._run({}, {}, { name: 'profile.start', profileIds: ['p0000001'] })).ok, true);
  assert.deepEqual(started, []);
});

// ---- wiring in main ----------------------------------------------------------------------------

function fnBody(sig) {
  const start = IPC.indexOf(sig);
  assert.ok(start > 0, `${sig} exists`);
  let i = IPC.indexOf('{', IPC.indexOf(')', start));
  let depth = 0;
  for (; i < IPC.length; i++) {
    if (IPC[i] === '{') depth++;
    else if (IPC[i] === '}') { depth--; if (depth === 0) return IPC.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
}

test('every enforcement point is wired in main', () => {
  assert.match(fnBody('async function assertWithinLimit('), /if \(kind === 'profiles'\) await assertPlanProfileCapacity\(1\);/, 'create, clone, template, quick generate and import');
  const launch = fnBody('async function launchProfileNow(');
  assert.ok(launch.indexOf('await assertPlanCanLaunch(id)') > launch.indexOf('await assertNotBanned()'), 'launch checks the running cap');
  assert.match(fnBody('async function assertSeatAvailable('), /lic\.type === 'free'\) throw freePlan\.planLimitError\('seats'/);
  assert.match(fnBody('async function syncConfigure('), /await assertPlanAllows\('sync'\)/);
  assert.match(fnBody('async function syncRun('), /await assertPlanAllows\('sync'\)/);
  assert.match(fnBody('async function commitProfileImport('), /error\.code === freePlan\.PLAN_LIMIT_CODE && error\.limitKind === 'profile'/, 'the import stops at the plan cap');
  assert.match(IPC, /remoteControlAllowed: \(\) => planAllows\('phoneControl'\)/);
  assert.match(IPC, /assertPlanAllows: \(feature\) => assertPlanAllows\(feature\)/, 'phone profile sync');
  assert.match(IPC, /quota: \{ take: \(\) => takeAiActionQuota\(\) \}/);
  assert.match(fnBody('function registerHandler('), /emitPlanLimit\(error\.planLimit\)/, 'the upgrade prompt opens at every limit');
  const deals = fnBody('async function openPartnerDeal(');
  assert.match(deals, /shell\.openExternal\(deal\.url\)/, 'deals open in the system browser');
  assert.match(fnBody('async function listPartnerDeals('), /if \(!l\.partnerDeals\) return \{ deals: \[\], shown: false \}/, 'Free only');
});
