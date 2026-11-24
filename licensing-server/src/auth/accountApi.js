'use strict';
// What the phone and web apps read and change about the signed-in account (Bearer session, src/auth/sessions.js):
//   me             { account: { id, email, name, tier, status, plan, lifetime, planEndsAt }, methods }
//   sessions       every desktop, phone and web sign-in of the account, newest first (never a token or hash)
//   revoke         ends one of them (it must belong to this account)
//   signOutAll     ends all of them, this one included
//   deleteRequest  records "please delete my account" (a customer event) and emails the support mailbox; the
//                  deletion itself stays a human step through the admin (src/customers/erase.js), because
//                  paid licences and invoices have legal retention rules
//   licence        the licence summary the apps show
// The phone and web clients have no tenant id in their requests: they belong to the tenant in ACCOUNT_TENANT_ID,
// or, when that is not set, to the only active tenant (the SoftGlaze install has exactly one).
const { liveEnv } = require('../env');
const { ms } = require('../util/time');
const { addEvent } = require('../customers/sync');
const { enqueue } = require('../email/outbox');
const { methodsFor } = require('./accounts');
const { revokeSession, revokeAll, publicSession, isLive } = require('./sessions');
const { isLifetimeLicence, LIFETIME_AFTER_MS, TIER_RANK } = require('../plans/lifetimeGuard');

const err = (status, error, message, extra = {}) => ({ status, body: { error, message, ...extra } });

// The tenant of the phone and web clients, or null when it cannot be decided (then the routes answer 503).
async function accountTenant(db) {
  const id = liveEnv('ACCOUNT_TENANT_ID');
  if (id) {
    const t = await db.tenant.findUnique({ where: { id: String(id).trim() } });
    return t && t.status === 'active' ? t : null;
  }
  const list = await db.tenant.findMany({ where: { status: 'active' }, take: 2 });
  return list.length === 1 ? list[0] : null;
}

const DAY = 86400000;
const PAID_GRACE_DAYS = 3; // settings.billing.renewalGraceDays default: the same grace that keeps statusAuto 'paid'

// Has the customer's paid (or complimentary) period run out? customer.tier is only recomputed by recomputeCustomer
// (after an event) and by the 15-minute cron reconcile, so a customer whose term just ended can still carry
// tier pro/enterprise for a while (or for good when the cron job does not run). A customer with no dates at all
// (an admin-set tier, older rows) is left alone.
function paidPeriodOver(customer, now = Date.now()) {
  const paid = ms(customer.paidUntil);
  const comp = ms(customer.complimentaryUntil);
  if (!paid && !comp) return false;
  const paidRunning = paid && paid + PAID_GRACE_DAYS * DAY > now;
  const compRunning = comp && comp > now;
  return !paidRunning && !compRunning;
}

// The tier the apps show: 'trial' during a trial (and when there is no plan yet), else the paid tier.
// Older phone and web apps read only this; it falls back to 'trial' (their "not paid" value) once the paid term ended.
function accountTier(customer, now = Date.now()) {
  if (!customer) return 'trial';
  if (customer.status === 'trial') return 'trial';
  if (customer.tier !== 'pro' && customer.tier !== 'enterprise') return 'trial';
  return paidPeriodOver(customer, now) ? 'trial' : customer.tier;
}

// The plan the apps show (Free plan release): 'trial' during a trial, the paid (or complimentary) tier, else
// 'free' (trial ended, term ended, or never a trial). tier keeps its old values for older phone and web apps.
function accountPlan(customer, now = Date.now()) {
  const tier = accountTier(customer, now);
  if (tier === 'pro' || tier === 'enterprise') return tier;
  if (!customer || customer.status !== 'trial') return 'free';
  // A trial whose end has passed is Free even before the next recompute moves the status to trial_expired.
  const ends = ms(customer.trialEndsAt);
  return ends && ends <= now ? 'free' : 'trial';
}

// { lifetime, planEndsAt } for the plan shown. From the customer row alone (no db): a paid or complimentary term
// running more than 50 years is lifetime (the lifetimeGuard end rule). With the licences (accountFacts below) the
// full lifetimeGuard rule is used: an active licence with a lifetime plan key or an end over 50 years away.
function planFacts(customer, plan, now = Date.now(), licences = null) {
  if (plan === 'trial') return { lifetime: false, planEndsAt: customer.trialEndsAt || null };
  if (plan !== 'pro' && plan !== 'enterprise') return { lifetime: false, planEndsAt: null };
  if (licences) {
    const live = licences.filter((x) => x.lic.status === 'active' && ms(x.lic.currentPeriodEnd) > now
      && (TIER_RANK[x.lic.tier || 'pro'] || 0) >= TIER_RANK[plan]);
    if (live.some((x) => isLifetimeLicence(x.lic, x.plan, now))) return { lifetime: true, planEndsAt: null };
    if (live.length) {
      const end = Math.max(...live.map((x) => ms(x.lic.currentPeriodEnd)));
      return { lifetime: false, planEndsAt: new Date(end) };
    }
  }
  const ends = [customer.paidUntil, customer.complimentaryUntil].map(ms).filter((e) => e > now);
  if (!ends.length) return { lifetime: false, planEndsAt: null };
  const end = Math.max(...ends);
  if (end - now > LIFETIME_AFTER_MS) return { lifetime: true, planEndsAt: null };
  return { lifetime: false, planEndsAt: new Date(end) };
}

// The licences behind the plan, for planFacts (one query, plus a plan lookup only for terms under 50 years).
async function accountFacts(db, customer, now = Date.now()) {
  const plan = accountPlan(customer, now);
  if (plan !== 'pro' && plan !== 'enterprise') return planFacts(customer, plan, now);
  const rows = await db.license.findMany({ where: { tenantId: customer.tenantId, customerId: customer.id, status: 'active' } });
  const licences = [];
  for (const lic of rows || []) {
    let p = null;
    if (lic.plan && ms(lic.currentPeriodEnd) > now && ms(lic.currentPeriodEnd) - now <= LIFETIME_AFTER_MS) {
      p = await db.plan.findUnique({ where: { tenantId_key: { tenantId: customer.tenantId, key: lic.plan } } });
    }
    licences.push({ lic, plan: p });
  }
  return planFacts(customer, plan, now, licences);
}

// The account object of every phone and web response. `facts` = accountFacts(...) when the caller has the db;
// without it the customer row alone decides lifetime and planEndsAt.
function accountOf(customer, facts = null, now = Date.now()) {
  const plan = accountPlan(customer, now);
  const f = facts || planFacts(customer, plan, now);
  return {
    id: customer.id, email: customer.email, name: customer.name || null, tier: accountTier(customer, now), status: customer.status || 'lead',
    plan, lifetime: Boolean(f.lifetime), planEndsAt: f.lifetime ? null : (f.planEndsAt || null)
  };
}

// How many phones an account may have signed in at once (MOBILE_PHONES_ALLOWED, 1 to 100, default 3).
function phonesAllowed() {
  const n = Number(liveEnv('MOBILE_PHONES_ALLOWED'));
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 3;
}

// The phones signed in now: MobileDevice rows not revoked whose session is still live.
async function activePhones(db, tenantId, customerId, now = Date.now()) {
  const devices = await db.mobileDevice.findMany({ where: { tenantId, customerId, revokedAt: null } });
  if (!devices.length) return [];
  const sessions = await db.authSession.findMany({ where: { id: { in: devices.map((d) => d.authSessionId) } } });
  const live = new Set(sessions.filter((s) => isLive(s, now)).map((s) => s.id));
  return devices.filter((d) => live.has(d.authSessionId));
}

async function me(db, found) {
  const { customer } = found;
  return { status: 200, body: { account: accountOf(customer, await accountFacts(db, customer)), methods: await methodsFor(db, customer.tenantId, customer) } };
}

async function listSessions(db, found, { now = Date.now() } = {}) {
  const { session, customer } = found;
  const rows = await db.authSession.findMany({ where: { tenantId: customer.tenantId, customerId: customer.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  const devices = await db.mobileDevice.findMany({ where: { tenantId: customer.tenantId, customerId: customer.id } });
  const byId = new Map(devices.map((d) => [d.authSessionId, d]));
  const list = rows.filter((r) => isLive(r, now)).map((r) => publicSession(r, { currentId: session.id, device: byId.get(r.id) || null, now }));
  return { status: 200, body: { sessions: list } };
}

async function revoke(db, found, id, { now = Date.now() } = {}) {
  const { customer } = found;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(id)) return err(404, 'not_found', 'There is no such session.');
  const row = await db.authSession.findUnique({ where: { id } });
  if (!row || row.tenantId !== customer.tenantId || row.customerId !== customer.id) return err(404, 'not_found', 'There is no such session.');
  const n = await revokeSession(db, row, now);
  if (n) await addEvent(db, customer.tenantId, customer.id, 'session_revoked', { sessionId: row.id, kind: row.kind || 'desktop' }, new Date(now));
  return { status: 200, body: { ok: true, revoked: n > 0 } };
}

async function signOutAll(db, found, { kinds = null, now = Date.now() } = {}) {
  const { customer } = found;
  const n = await revokeAll(db, customer.tenantId, customer.id, { kinds, now });
  await addEvent(db, customer.tenantId, customer.id, 'signed_out_all', { kinds: kinds || 'all', count: n }, new Date(now));
  return { status: 200, body: { ok: true, revoked: n } };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function deleteRequest(db, found, input, { settings, now = Date.now() } = {}) {
  const { customer, session } = found;
  const reason = typeof (input && input.reason) === 'string'
    ? input.reason.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 1000) : '';
  const at = new Date(now);
  const day = at.toISOString().slice(0, 10);
  const to = (settings && settings.email && settings.email.supportEmail) || 'support@softglaze.com';
  const lines = [
    'An account deletion was requested from a signed-in SoftGlaze app.',
    '',
    `Customer id: ${customer.id}`,
    `Email: ${customer.email}`,
    `Requested at: ${at.toISOString()}`,
    `From: ${session.kind || 'desktop'} (${session.clientId || 'softglaze-desktop'})`,
    `Reason: ${reason || '(none given)'}`,
    '',
    'Check licences and invoices, then erase the customer in the admin (Customers > Erase).'
  ];
  const queued = await enqueue(db, customer.tenantId, {
    toEmail: to, category: 'essential', subject: `Account deletion request: ${customer.email}`.slice(0, 250),
    text: lines.join('\n'), html: `<p>${lines.map(esc).join('<br>')}</p>`, dedupeKey: `delete-request:${customer.id}:${day}`, createdBy: 'delete_request'
  });
  if (queued) await addEvent(db, customer.tenantId, customer.id, 'delete_requested', { via: session.kind || 'desktop', reason: reason || null }, at);
  return { status: 202, body: { ok: true, requested: true, alreadyRequestedToday: !queued } };
}

async function licenceSummary(db, found, { now = Date.now() } = {}) {
  const { customer } = found;
  const rows = await db.license.findMany({ where: { tenantId: customer.tenantId, customerId: customer.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  const licences = rows.map((l) => ({
    id: l.id,
    tier: l.tier || 'pro',
    status: l.status === 'active' && l.currentPeriodEnd && ms(l.currentPeriodEnd) <= now ? 'expired' : l.status,
    source: l.source || null,
    complimentary: Boolean(l.complimentary),
    until: l.currentPeriodEnd || null,
    onComputer: Boolean(l.installId)
  }));
  const phones = await activePhones(db, customer.tenantId, customer.id, now);
  const plan = accountPlan(customer, now);
  const facts = await accountFacts(db, customer, now);
  return {
    status: 200,
    body: {
      tier: accountTier(customer, now),
      plan,
      free: plan === 'free',
      lifetime: Boolean(facts.lifetime),
      planEndsAt: facts.lifetime ? null : (facts.planEndsAt || null),
      status: customer.status || 'lead',
      paidUntil: customer.paidUntil || null,
      trialEndsAt: customer.trialEndsAt || null,
      complimentaryUntil: customer.complimentaryUntil || null,
      seats: licences.filter((l) => l.status === 'active').length,
      phonesAllowed: phonesAllowed(),
      phonesUsed: phones.length,
      licences
    }
  };
}

module.exports = {
  accountTenant, accountTier, accountPlan, accountOf, accountFacts, planFacts, paidPeriodOver, phonesAllowed, activePhones, me, listSessions, revoke, signOutAll, deleteRequest, licenceSummary
};
