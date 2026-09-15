'use strict';
// Install authentication (audit T2-6, 11 Sep 2026).
//
// The old flow had no proof of ownership anywhere:
//  - POST /v1/license matched a licence by `account` (an email) from the request body, so
//    posting a customer's email returned a signed lease.
//  - POST /v1/register upserted by machineId and returned the existing installId to anyone
//    who sent that machineId, so the installId was a bearer credential anyone could fetch.
//  - Install.account is whatever the client claims at register, so matching a licence via
//    a registered install's account would have reopened the same hole.
//
// Now each install gets a random secret when it is first registered. Only its SHA-256 is
// stored. The secret is returned exactly once, and every later register, licence or redeem
// call for that install must present it. Licences are found by the authenticated installId,
// never by a client-supplied email.
//
// Pure module: callers pass the Prisma client, so tests can run it against a fake.

const crypto = require('node:crypto');

function newInstallSecret() {
  const secret = crypto.randomBytes(32).toString('base64url');
  return { secret, hash: hashInstallSecret(secret) };
}

function hashInstallSecret(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest('hex');
}

function verifyInstallSecret(secret, storedHash) {
  if (typeof secret !== 'string' || !secret || typeof storedHash !== 'string' || storedHash.length !== 64) return false;
  const a = Buffer.from(hashInstallSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// POST /v1/register. Returns { status, body }.
async function registerInstall(prisma, tenant, { machineId, account, installSecret }) {
  if (!machineId) return { status: 400, body: { error: 'machineId is required.' } };
  const key = { tenantId_machineId: { tenantId: tenant.id, machineId: String(machineId) } };
  const existing = await prisma.install.findUnique({ where: key });

  if (existing && existing.secretHash) {
    // Re-registering a known machine needs its secret; knowing the machineId is not proof.
    if (!verifyInstallSecret(installSecret, existing.secretHash)) {
      return { status: 403, body: { error: 'This machine is already registered. Use the install secret it was issued.' } };
    }
    await prisma.install.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date(), ...(account ? { account: String(account) } : {}) }
    });
    return { status: 200, body: { installId: existing.id, tenantId: tenant.id } };
  }

  // New machine, or a row from before secrets existed: issue the secret now.
  const { secret, hash } = newInstallSecret();
  const install = existing
    ? await prisma.install.update({ where: { id: existing.id }, data: { secretHash: hash, lastSeenAt: new Date(), ...(account ? { account: String(account) } : {}) } })
    : await prisma.install.create({ data: { tenantId: tenant.id, machineId: String(machineId), account: account ? String(account) : null, secretHash: hash } });
  return { status: 200, body: { installId: install.id, installSecret: secret, tenantId: tenant.id } };
}

// Returns the Install row when installId + installSecret match, otherwise null.
async function authenticateInstall(prisma, tenant, { installId, installSecret }) {
  if (!installId || !installSecret) return null;
  const install = await prisma.install.findUnique({ where: { id: String(installId) } });
  if (!install || install.tenantId !== tenant.id) return null;
  return verifyInstallSecret(installSecret, install.secretHash) ? install : null;
}

module.exports = { newInstallSecret, hashInstallSecret, verifyInstallSecret, registerInstall, authenticateInstall };
