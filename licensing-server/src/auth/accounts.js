'use strict';
// Accounts behind one-click sign-in (app 1.0.26): which customer a verified sign-in belongs to, linking the
// install, the app session, the sign-in methods and moving a licence to a new computer.
//
// Linking rules (D:\SoftGlaze-Browser-Login\00-PLAN.md):
//   1. an Identity for (provider, provider user id) -> its customer;
//   2. else a customer with the same email key, but only when the provider (or our own code) verified the
//      email -> that customer gets the new Identity (no second code needed);
//   3. else a new customer with emailVerifiedAt set.
// An unverified email is never linked or used. Results are { status, body } like the other routes.
const { parseEmail } = require('../customers/emailAddress');
const { createCustomer, addEvent, claimUnboundLicences, linkInstallRecords, recomputeCustomer } = require('../customers/sync');
// Lazy: src/licensing.js opens the Prisma client when loaded, and the trial ledger loads this module.
const pickLeaseLicence = (...args) => require('../licensing').pickLeaseLicence(...args);
const { TRANSFER_LIMIT, TRANSFER_WINDOW_MS } = require('../machineBinding');
const { ms } = require('../util/time');
const { randomToken, sha256Hex, isOpaqueToken } = require('./tokens');

const err = (status, error, message, extra = {}) => ({ status, body: { error, message, ...extra } });

function cleanName(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 200) : null;
}

// The install now belongs to this customer, as after a proven 6-digit code (src/account/verify.js): its
// licences, payments and trials follow, an admin-granted licence waiting for an install attaches, and the
// customers involved are recomputed.
async function attachInstall(db, tenantId, install, customer, { at, now, settings }) {
  await db.install.update({ where: { id: install.id }, data: { customerId: customer.id, account: customer.email, lastSeenAt: at } });
  const moved = await linkInstallRecords(db, tenantId, install.id, customer.id);
  await claimUnboundLicences(db, tenantId, customer.id, install.id);
  const opts = { now, graceDays: settings.billing.renewalGraceDays };
  for (const other of moved) await recomputeCustomer(db, tenantId, other, opts);
  await recomputeCustomer(db, tenantId, customer.id, opts);
}

// Read-only: the customer a verified sign-in resolves to, before anything is written.
// -> { identity, customer, how: 'identity' | 'email' | 'new', parsed } or { error }.
async function resolveCustomer(db, tenantId, provider, profile) {
  const parsed = parseEmail(profile && profile.email);
  if (!parsed || !profile || profile.emailVerified !== true) return { error: 'email_not_verified' };
  const providerUserId = String(profile.providerUserId || '');
  if (!providerUserId) return { error: 'email_not_verified' };
  let identity = await db.identity.findUnique({ where: { tenantId_provider_providerUserId: { tenantId, provider, providerUserId } } });
  if (identity) {
    const c = await db.customer.findUnique({ where: { id: identity.customerId } });
    if (c && c.tenantId === tenantId) return { identity, customer: c, how: 'identity', parsed, providerUserId };
    identity = { stale: identity }; // its customer is gone: relinked below by email
  }
  const byEmail = await db.customer.findUnique({ where: { tenantId_emailKey: { tenantId, emailKey: parsed.emailKey } } });
  if (byEmail) return { identity, customer: byEmail, how: 'email', parsed, providerUserId };
  return { identity, customer: null, how: 'new', parsed, providerUserId };
}

// Writes the sign-in: customer (created, restored or updated), Identity, install link, session and the
// `signed_in` event. `resolved` comes from resolveCustomer. -> the response body.
async function applySignIn(db, tenant, install, provider, profile, resolved, { ipHash = null, now = Date.now(), settings, attached = false }) {
  const tenantId = tenant.id;
  const at = new Date(now);
  const { parsed, providerUserId } = resolved;
  const name = cleanName(profile.name);
  let customer = resolved.customer;
  if (!customer) {
    try {
      customer = await createCustomer(db, tenantId, {
        email: parsed.email, emailKey: parsed.emailKey, source: 'app', emailVerifiedAt: at, name,
        firstSeenAt: install.createdAt || at, lastSeenAt: at
      });
    } catch (e) {
      if (!e || e.code !== 'P2002') throw e;
      customer = await db.customer.findUnique({ where: { tenantId_emailKey: { tenantId, emailKey: parsed.emailKey } } });
    }
  }
  const restored = Boolean(customer.deletedAt);
  const sameEmail = customer.emailKey === parsed.emailKey;
  customer = await db.customer.update({
    where: { id: customer.id },
    data: {
      // A verified address stays as it is; a claimed, unverified one is replaced by the verified one.
      email: sameEmail && !customer.emailVerifiedAt ? parsed.email : customer.email,
      emailVerifiedAt: customer.emailVerifiedAt || (sameEmail ? at : null),
      deletedAt: null,
      name: customer.name || name,
      lastSeenAt: at
    }
  });

  // The sign-in method.
  const stale = resolved.identity && resolved.identity.stale;
  if (stale) await db.identity.delete({ where: { id: stale.id } }).catch(() => {});
  const live = resolved.identity && !stale ? resolved.identity : null;
  const idData = { customerId: customer.id, email: parsed.email, emailVerified: true, login: cleanName(profile.login), lastUsedAt: at };
  let identity;
  if (live) {
    identity = await db.identity.update({ where: { id: live.id }, data: { email: idData.email, emailVerified: true, login: idData.login, lastUsedAt: at } });
  } else {
    try {
      identity = await db.identity.create({ data: { tenantId, provider, providerUserId, ...idData, createdAt: at } });
    } catch (e) {
      if (!e || e.code !== 'P2002') throw e;
      identity = await db.identity.findUnique({ where: { tenantId_provider_providerUserId: { tenantId, provider, providerUserId } } });
    }
  }

  if (!attached) await attachInstall(db, tenantId, install, customer, { at, now, settings });
  const token = randomToken(32);
  await db.authSession.create({
    data: {
      tenantId, customerId: customer.id, installId: install.id, identityId: identity ? identity.id : null, provider,
      emailKey: customer.emailKey, tokenHash: sha256Hex(token), ipHash, createdAt: at, lastUsedAt: at
    }
  });
  await addEvent(db, tenantId, customer.id, 'signed_in', { provider, installId: install.id, linked: resolved.how }, at);
  if (resolved.how !== 'identity') await addEvent(db, tenantId, customer.id, 'signin_linked', { provider, login: idData.login }, at);
  if (restored) await addEvent(db, tenantId, customer.id, 'restored', { by: 'signin' }, at);

  const fresh = await db.customer.findUnique({ where: { id: customer.id } });
  return {
    ok: true,
    session: token,
    provider,
    isNew: resolved.how === 'new',
    linked: resolved.how,
    customer: { id: fresh.id, email: fresh.email, name: fresh.name || null, useCase: fresh.useCase || null },
    methods: await methodsFor(db, tenantId, fresh),
    licence: await licenceState(db, tenantId, fresh.id, install.id, now)
  };
}

// One sign-in from a verified provider profile. `expectCustomerId` (the workspace's own account, when the app
// unlocks or links an existing workspace) refuses another account before anything is written.
async function signIn(db, tenant, install, provider, profile, { expectCustomerId = null, ipHash = null, now = Date.now(), settings }) {
  const resolved = await resolveCustomer(db, tenant.id, provider, profile);
  if (resolved.error) return err(403, 'email_not_verified', 'Your sign-in did not give us a verified email address.');
  if (expectCustomerId && (!resolved.customer || resolved.customer.id !== String(expectCustomerId))) {
    return err(409, 'account_mismatch', 'This workspace belongs to a different SoftGlaze account.');
  }
  return { status: 200, body: await applySignIn(db, tenant, install, provider, profile, resolved, { ipHash, now, settings }) };
}

// The sign-in methods to show: the customer's Identity rows, plus "email" when its email is verified (a code to
// that address always signs in).
async function methodsFor(db, tenantId, customer) {
  const rows = await db.identity.findMany({ where: { tenantId, customerId: customer.id }, orderBy: { createdAt: 'asc' } });
  const out = rows.map((i) => ({ provider: i.provider, email: i.email || null, login: i.login || null, linkedAt: i.createdAt, lastUsedAt: i.lastUsedAt || null }));
  if (customer.emailVerifiedAt && !out.some((m) => m.provider === 'email')) {
    out.push({ provider: 'email', email: customer.email, login: null, linkedAt: customer.emailVerifiedAt, lastUsedAt: null });
  }
  return out;
}

// Where the customer's paid licence is, seen from this install:
//   here      an active licence is on this install;
//   elsewhere an active licence (website or invoice) is on another install and can be moved here;
//   store     only a Microsoft Store subscription, which moves with "Restore Microsoft Store purchases";
//   none      no active licence.
async function licenceState(db, tenantId, customerId, installId, now = Date.now()) {
  const rows = await db.license.findMany({ where: { tenantId, customerId, status: 'active' } });
  const active = rows.filter((l) => l.currentPeriodEnd && ms(l.currentPeriodEnd) > now);
  if (active.some((l) => l.installId === installId)) return { state: 'here' };
  const movable = active.filter((l) => l.installId && l.installId !== installId && l.source !== 'microsoft_store');
  if (movable.length) {
    const best = pickLeaseLicence(movable, now);
    return { state: 'elsewhere', tier: best.tier, until: best.currentPeriodEnd, movesLeft: movesLeft(best, now) };
  }
  if (active.some((l) => l.source === 'microsoft_store')) return { state: 'store' };
  return { state: 'none' };
}

// The self-service move limit (machineBinding.js): TRANSFER_LIMIT moves per licence per TRANSFER_WINDOW_MS.
function moveWindow(lic, now) {
  const start = lic.rebindWindowStart ? ms(lic.rebindWindowStart) : 0;
  const fresh = !start || now - start >= TRANSFER_WINDOW_MS;
  return { start, fresh, used: fresh ? 0 : (lic.rebindCount || 0) };
}
function movesLeft(lic, now) { return Math.max(0, TRANSFER_LIMIT - moveWindow(lic, now).used); }

// --- Sessions ---

// The live session of this install for its customer, or null.
async function findSession(db, tenant, install, token) {
  if (!isOpaqueToken(token)) return null;
  const row = await db.authSession.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!row || row.tenantId !== tenant.id || row.installId !== install.id || row.revokedAt) return null;
  if (!install.customerId || row.customerId !== install.customerId) return null;
  return row;
}

// POST /auth/me -> { signedIn: true, email, name, methods } (401 session_invalid otherwise).
async function sessionInfo(db, tenant, install, token, { now = Date.now() } = {}) {
  const s = await findSession(db, tenant, install, token);
  if (!s) return err(401, 'session_invalid', 'Sign in again.');
  const c = await db.customer.findUnique({ where: { id: s.customerId } });
  if (!c || c.deletedAt) return err(401, 'session_invalid', 'Sign in again.');
  await db.authSession.update({ where: { id: s.id }, data: { lastUsedAt: new Date(now) } }).catch(() => {});
  return {
    status: 200,
    body: {
      signedIn: true,
      provider: s.provider,
      customer: { id: c.id, email: c.email, name: c.name || null },
      methods: await methodsFor(db, tenant.id, c),
      licence: await licenceState(db, tenant.id, c.id, install.id, now)
    }
  };
}

// POST /auth/logout: revokes the session. Always ok, so it never tells whether a token existed.
async function logout(db, tenant, install, token, { now = Date.now() } = {}) {
  if (isOpaqueToken(token)) {
    await db.authSession.updateMany({
      where: { tokenHash: sha256Hex(token), tenantId: tenant.id, installId: install.id, revokedAt: null },
      data: { revokedAt: new Date(now) }
    });
  }
  return { status: 200, body: { ok: true } };
}

// POST /auth/profile: the one optional question after sign-in ("What will you use SoftGlaze for?").
async function saveProfile(db, tenant, install, token, lead, { now = Date.now() } = {}) {
  const s = await findSession(db, tenant, install, token);
  if (!s) return err(401, 'session_invalid', 'Sign in again.');
  const { cleanLead, leadUpdate } = require('../account/lead');
  const clean = cleanLead({ useCase: lead && lead.useCase, useCaseOther: lead && lead.useCaseOther });
  if (clean.error) return err(400, clean.error, 'Choose what you will use SoftGlaze for from the list.');
  const c = await db.customer.findUnique({ where: { id: s.customerId } });
  if (!c) return err(401, 'session_invalid', 'Sign in again.');
  const data = leadUpdate(c, clean.lead);
  if (Object.keys(data).length) await db.customer.update({ where: { id: c.id }, data });
  return { status: 200, body: { ok: true, saved: Object.keys(data).length > 0 } };
}

// --- Moving a licence to this computer ("Sign in on another PC") ---
// POST /auth/licence/move { session, move: true }: the customer's active website/invoice licence on another
// install moves to this one, at most TRANSFER_LIMIT times per licence per 30 days (the same limit as
// /v1/license/transfer). Microsoft Store subscriptions move through the Store's own restore instead.
// Errors: 401 session_invalid, 400 confirm_required, 404 no_licence, 429 move_limit { retryAt },
// 409 move_conflict.
async function moveLicence(db, tenant, install, token, { move, now = Date.now(), settings }) {
  const s = await findSession(db, tenant, install, token);
  if (!s) return err(401, 'session_invalid', 'Sign in again.');
  if (move !== true) return err(400, 'confirm_required', 'Confirm moving the licence to this computer.');
  const tenantId = tenant.id;
  const rows = await db.license.findMany({ where: { tenantId, customerId: s.customerId, status: 'active' } });
  const active = rows.filter((l) => l.currentPeriodEnd && ms(l.currentPeriodEnd) > now);
  if (active.some((l) => l.installId === install.id)) return { status: 200, body: { ok: true, moved: false } };
  const movable = active.filter((l) => l.installId && l.installId !== install.id && l.source !== 'microsoft_store');
  if (!movable.length) return err(404, 'no_licence', 'There is no licence to move.');
  const lic = pickLeaseLicence(movable, now);
  const w = moveWindow(lic, now);
  if (w.used >= TRANSFER_LIMIT) {
    return err(429, 'move_limit', 'This licence has already been moved twice in the last 30 days.', { retryAt: new Date(w.start + TRANSFER_WINDOW_MS).toISOString() });
  }
  const c = await db.customer.findUnique({ where: { id: s.customerId } });
  // Moved only if the row still holds what was read, so two moves at once cannot both spend the last slot.
  const claim = await db.license.updateMany({
    where: { id: lic.id, installId: lic.installId, rebindCount: lic.rebindCount || 0 },
    data: { installId: install.id, account: c ? c.email : lic.account, rebindCount: w.used + 1, rebindWindowStart: w.fresh ? new Date(now) : new Date(w.start) }
  });
  if (!claim || claim.count !== 1) return err(409, 'move_conflict', 'The licence changed at the same time. Try again.');
  await addEvent(db, tenantId, s.customerId, 'licence_moved', { licenseId: lic.id, from: lic.installId, to: install.id, by: 'signin' }, new Date(now));
  await recomputeCustomer(db, tenantId, s.customerId, { now, graceDays: settings.billing.renewalGraceDays });
  return { status: 200, body: { ok: true, moved: true, remaining: TRANSFER_LIMIT - w.used - 1 } };
}

// --- Proof for the trial ledger and /v1/account/status ---
// A sign-in on this install for this customer and email key counts like a proven 6-digit code. Errors (for
// example the table missing while a deploy waits for its migration) count as "no proof".
async function signedInOnInstall(db, tenantId, installId, customerId, emailKey) {
  if (!installId || !customerId) return false;
  try {
    const row = await db.authSession.findFirst({ where: { tenantId, installId, customerId, ...(emailKey ? { emailKey } : {}) } });
    return Boolean(row);
  } catch (_) {
    return false;
  }
}

module.exports = {
  attachInstall, resolveCustomer, applySignIn, signIn, methodsFor, licenceState, movesLeft, findSession, sessionInfo,
  logout, saveProfile, moveLicence, signedInOnInstall, cleanName
};
