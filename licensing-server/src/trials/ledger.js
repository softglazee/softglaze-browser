'use strict';
// The server-side trial ledger (spec A3). A trial is granted only when:
//   1. the email was verified by us on THIS install (POST /v1/account/verify/check),
//   2. this machine hash never had a trial in this tenant,
//   3. this email key (Gmail dots / +tags folded) never had one,
//   4. this network (HMAC of the client IP; IPv6 per /64) had fewer than trial.networkLimit trials in
//      the last trial.networkWindowDays days. Private and carrier-grade NAT addresses are not counted.
// 2 and 3 are enforced by unique indexes on machineLock / emailLock, so two requests racing cannot
// both win. An admin reset clears a lock (the row stays as history).
// The answer is the existing signed lease format with type 'trial', tier = trial.tier (enterprise),
// exp = the trial end (7 days), bound to the machine like a paid lease.
const { issueLease } = require('../lease');
const { parseEmail } = require('../customers/emailAddress');
const { hmacHex } = require('../crypto/derive');
const { addEvent, recomputeCustomer } = require('../customers/sync');
const { ms } = require('../util/time');

const DAY = 86400000;
const emailKeyHash = (emailKey) => hmacHex('trial-email-v1', emailKey);

function trialLeaseBody(tenant, install, trial, email, now) {
  const lease = issueLease(tenant, {
    installId: install.id, account: email || null, tier: trial.tier, plan: 'trial', currentPeriodEnd: trial.endsAt
  }, now, { mid: install.machineHash, type: 'trial' });
  return { lease: lease.token, exp: lease.exp, tier: lease.tier, type: 'trial', trialEndsAt: trial.endsAt, currentPeriodEnd: trial.endsAt };
}

async function logAttempt(db, tenantId, installId, outcome, ipHash, now) {
  await db.trialAttempt.create({ data: { tenantId, installId, outcome, ipHash: ipHash || null, at: new Date(now) } }).catch(() => {});
}

function used(reason) {
  return { status: 409, body: { error: 'trial_used', reason, message: 'A free trial has already been used.' } };
}

// install: authenticated and machine-checked (install.machineHash is this machine).
// ctx: { ip, ipHash, ipCounts (bool: public address), now, settings }
async function startTrial(db, tenant, install, { email }, { ipHash = null, ipCounts = false, now = Date.now(), settings }) {
  const tenantId = tenant.id;
  const parsed = parseEmail(email);
  if (!parsed) return { status: 400, body: { error: 'invalid_email', message: 'That email address does not look right.' } };

  const verified = await db.emailVerification.findFirst({
    where: { tenantId, installId: install.id, emailKey: parsed.emailKey, NOT: { verifiedAt: null } }
  });
  if (!verified || !install.customerId || verified.customerId !== install.customerId) {
    await logAttempt(db, tenantId, install.id, 'not_verified', ipHash, now);
    return { status: 403, body: { error: 'email_not_verified', message: 'Confirm your email address first.' } };
  }
  const customer = await db.customer.findUnique({ where: { id: install.customerId } });

  // A running licence (paid or complimentary) makes a trial pointless, and a customer who has
  // already paid does not get a trial afterwards.
  const running = await db.license.findFirst({ where: { tenantId, installId: install.id, status: 'active', currentPeriodEnd: { gt: new Date(now) } } });
  const paidBefore = (customer && customer.paidSince)
    || await db.license.findFirst({ where: { tenantId, installId: install.id, complimentary: false } });
  if (running || paidBefore) {
    await logAttempt(db, tenantId, install.id, 'already_licensed', ipHash, now);
    return { status: 409, body: { error: 'already_licensed', message: 'This install already has an active licence.' } };
  }

  const mh = install.machineHash;
  const ekh = emailKeyHash(parsed.emailKey);
  // The same install asking again (a lost response, a reinstall of the same data) gets its running
  // trial back, never a longer one.
  const mine = await db.trial.findFirst({ where: { tenantId, installId: install.id, machineLock: mh, emailLock: ekh }, orderBy: { startedAt: 'desc' } });
  if (mine && ms(mine.endsAt) > now) {
    await logAttempt(db, tenantId, install.id, 'repeat', ipHash, now);
    return { status: 200, body: trialLeaseBody(tenant, install, mine, customer && customer.email, now) };
  }

  if (await db.trial.findFirst({ where: { tenantId, machineLock: mh } })) {
    await logAttempt(db, tenantId, install.id, 'used_machine', ipHash, now);
    return used('machine');
  }
  if (await db.trial.findFirst({ where: { tenantId, emailLock: ekh } })) {
    await logAttempt(db, tenantId, install.id, 'used_email', ipHash, now);
    return used('email');
  }
  const t = settings.trial;
  if (ipHash && ipCounts && t.networkLimit > 0) {
    const recent = await db.trial.count({
      where: { tenantId, ipHash, networkCounted: true, startedAt: { gte: new Date(now - t.networkWindowDays * DAY) } }
    });
    if (recent >= t.networkLimit) {
      await logAttempt(db, tenantId, install.id, 'used_network', ipHash, now);
      return used('network');
    }
  }

  let trial;
  try {
    trial = await db.trial.create({
      data: {
        tenantId, customerId: install.customerId, installId: install.id, machineHash: mh, emailKeyHash: ekh,
        ipHash: ipHash || null, machineLock: mh, emailLock: ekh, networkCounted: Boolean(ipHash && ipCounts),
        tier: t.tier, startedAt: new Date(now), endsAt: new Date(now + t.days * DAY)
      }
    });
  } catch (e) {
    if (!e || e.code !== 'P2002') throw e;
    const machineTaken = await db.trial.findFirst({ where: { tenantId, machineLock: mh } });
    await logAttempt(db, tenantId, install.id, machineTaken ? 'used_machine' : 'used_email', ipHash, now);
    return used(machineTaken ? 'machine' : 'email');
  }
  await logAttempt(db, tenantId, install.id, 'granted', ipHash, now);
  await addEvent(db, tenantId, install.customerId, 'trial_started', { trialId: trial.id, installId: install.id, endsAt: trial.endsAt }, new Date(now));
  await recomputeCustomer(db, tenantId, install.customerId, { now, graceDays: settings.billing.renewalGraceDays });
  return { status: 200, body: trialLeaseBody(tenant, install, trial, customer && customer.email, now) };
}

// For POST /v1/license: the running trial of this install, as a lease body; else null.
// { lease: null } callers also get trialEndsAt of the last trial (ended).
async function trialLeaseFor(db, tenant, install, now = Date.now()) {
  const trial = await db.trial.findFirst({ where: { tenantId: tenant.id, installId: install.id }, orderBy: { startedAt: 'desc' } });
  if (!trial) return { active: null, last: null };
  if (ms(trial.endsAt) <= now) return { active: null, last: trial };
  const customer = trial.customerId ? await db.customer.findUnique({ where: { id: trial.customerId } }) : null;
  return { active: trialLeaseBody(tenant, install, trial, customer && customer.email, now), last: trial };
}

module.exports = { startTrial, trialLeaseFor, emailKeyHash };
