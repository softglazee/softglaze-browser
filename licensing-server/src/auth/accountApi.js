'use strict';
// What the phone and web apps read and change about the signed-in account (Bearer session, src/auth/sessions.js):
//   me             { account: { id, email, name, tier, status }, methods }
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

// The tier the apps show: 'trial' during a trial (and when there is no plan yet), else the paid tier.
function accountTier(customer) {
  if (!customer) return 'trial';
  if (customer.status === 'trial') return 'trial';
  return customer.tier === 'pro' || customer.tier === 'enterprise' ? customer.tier : 'trial';
}

function accountOf(customer) {
  return { id: customer.id, email: customer.email, name: customer.name || null, tier: accountTier(customer), status: customer.status || 'lead' };
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
  return { status: 200, body: { account: accountOf(customer), methods: await methodsFor(db, customer.tenantId, customer) } };
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
  return {
    status: 200,
    body: {
      tier: accountTier(customer),
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
  accountTenant, accountTier, accountOf, phonesAllowed, activePhones, me, listSessions, revoke, signOutAll, deleteRequest, licenceSummary
};
