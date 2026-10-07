'use strict';
// Machine binding for installs (audit L3, 7 Oct 2026).
//
// installId + installSecret used to be the whole credential for a lease, so one paying
// user could copy the pair to any number of machines. Each install is now bound to one
// machine hash (a SHA-256 the desktop derives from its OS machine identity; raw hardware
// ids never leave the machine):
//  - trust on first use: an install with no stored hash binds to the first one it sees
//    (at /v1/register or the first /v1/license call);
//  - a different hash gets 403 { error: 'machine_mismatch' } and no lease;
//  - the signed lease carries the hash as `mid` and the desktop refuses a lease whose mid
//    is not its own, so a copied lease is useless too.
// A legitimate PC change goes through the tenant-admin reset (no limit) or the
// self-service transfer below (install secret + proof of purchase, 2 per 30 days).
//
// Pure module: callers pass the Prisma client, so tests can run it against a fake.

const crypto = require('node:crypto');

const DAY = 86400000;
const TRANSFER_WINDOW_MS = 30 * DAY;
const TRANSFER_LIMIT = 2;

// The client sends a lowercase hex SHA-256. Anything else is refused, so a raw serial
// or an arbitrary string can never be stored.
function normalizeMachineHash(h) {
  const s = typeof h === 'string' ? h.trim().toLowerCase() : '';
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

function sameString(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Check (and on first use, bind) an authenticated install against the caller's machine
// hash. Returns { ok: true, install } or { ok: false, status, error }.
async function checkMachine(prisma, install, machineHash) {
  const mh = normalizeMachineHash(machineHash);
  if (!mh) return { ok: false, status: 400, error: 'machine_required' };
  if (install.machineHash) {
    return sameString(install.machineHash, mh) ? { ok: true, install } : { ok: false, status: 403, error: 'machine_mismatch' };
  }
  // Conditional bind: if two machines race on an unbound install, only the first write
  // wins and the loser is re-checked against what was stored.
  const won = await prisma.install.updateMany({ where: { id: install.id, machineHash: null }, data: { machineHash: mh, machineBoundAt: new Date() } });
  if (won && won.count === 1) return { ok: true, install: { ...install, machineHash: mh } };
  const fresh = await prisma.install.findUnique({ where: { id: install.id } });
  if (fresh && fresh.machineHash && sameString(fresh.machineHash, mh)) return { ok: true, install: fresh };
  return { ok: false, status: 403, error: 'machine_mismatch' };
}

// Tenant-admin reset: clear the binding so the next machine to call /v1/license binds.
async function resetMachine(prisma, tenant, installId) {
  const install = installId ? await prisma.install.findUnique({ where: { id: String(installId) } }) : null;
  if (!install || install.tenantId !== tenant.id) return { status: 404, body: { error: 'Unknown install.' } };
  await prisma.install.update({ where: { id: install.id }, data: { machineHash: null, machineBoundAt: null } });
  return { status: 200, body: { ok: true, installId: install.id } };
}

// Proof of purchase for a self-service transfer. The install secret alone is what gets
// shared, so it is not enough. Accepted, strongest first:
//  1) the activation code this install redeemed (LicenseCode.redeemedBy = install.id);
//  2) the licence's provider reference (Stripe subscription/order id, PayPal order id,
//     Cryptomus order id) recorded on License.providerRef;
//  3) the provider reference of a paid Payment made for this install (checkout session /
//     order id shown in the buyer's receipt).
async function hasPurchaseProof(prisma, tenant, install, lic, proof) {
  const p = typeof proof === 'string' ? proof.trim() : '';
  if (p.length < 6) return false;
  const code = await prisma.licenseCode.findUnique({ where: { tenantId_code: { tenantId: tenant.id, code: p.toUpperCase() } } }).catch(() => null);
  if (code && code.redeemedBy === install.id) return true;
  if (lic.providerRef && sameString(lic.providerRef, p)) return true;
  const pay = await prisma.payment.findFirst({ where: { tenantId: tenant.id, providerRef: p, installId: install.id, status: 'paid' } }).catch(() => null);
  return Boolean(pay);
}

// Self-service transfer to the caller's machine. `install` must already be authenticated
// with its install secret. Returns { status, body }.
async function transferMachine(prisma, tenant, install, { machineHash, proof, nowMs } = {}) {
  const mh = normalizeMachineHash(machineHash);
  if (!mh) return { status: 400, body: { error: 'machine_required' } };
  if (install.machineHash && sameString(install.machineHash, mh)) return { status: 200, body: { ok: true, transferred: false } };

  const lic = await prisma.license.findFirst({ where: { tenantId: tenant.id, installId: install.id }, orderBy: { updatedAt: 'desc' } });
  if (!lic) return { status: 404, body: { error: 'no_license' } };
  if (!(await hasPurchaseProof(prisma, tenant, install, lic, proof))) return { status: 403, body: { error: 'invalid_proof' } };

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const start = lic.rebindWindowStart ? new Date(lic.rebindWindowStart).getTime() : 0;
  const fresh = !start || now - start >= TRANSFER_WINDOW_MS;
  const used = fresh ? 0 : (lic.rebindCount || 0);
  if (used >= TRANSFER_LIMIT) {
    return { status: 429, body: { error: 'transfer_limit', retryAt: new Date(start + TRANSFER_WINDOW_MS).toISOString() } };
  }
  // Count the transfer only if the licence row still holds the count we read, so two
  // concurrent transfers cannot both spend the last slot.
  const claim = await prisma.license.updateMany({
    where: { id: lic.id, rebindCount: lic.rebindCount || 0 },
    data: { rebindCount: used + 1, rebindWindowStart: fresh ? new Date(now) : new Date(start) }
  });
  if (!claim || claim.count !== 1) return { status: 409, body: { error: 'transfer_conflict' } };
  await prisma.install.update({ where: { id: install.id }, data: { machineHash: mh, machineBoundAt: new Date(now) } });
  return { status: 200, body: { ok: true, transferred: true, remaining: TRANSFER_LIMIT - used - 1 } };
}

module.exports = { normalizeMachineHash, checkMachine, resetMachine, transferMachine, TRANSFER_LIMIT, TRANSFER_WINDOW_MS };
