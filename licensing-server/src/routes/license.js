'use strict';
// POST /v1/license { tenantId, installId, installSecret, machineHash }
//   -> { lease, exp, tier, currentPeriodEnd }   when an active license exists
//   -> { lease: null, status }                  otherwise
//   -> 401                                      unknown install or wrong secret
//   -> 400 { error: 'machine_required' }        no/invalid machineHash
//   -> 403 { error: 'machine_mismatch' }        install is bound to another machine
// The desktop calls this on launch + periodically; it caches the signed lease and
// runs offline until it expires (LEASE_DAYS), then re-checks here.
//
// Audit T2-6: this used to match a licence by `account` (an email) taken from the request
// body, so the email was the whole credential. The licence is now found only by an
// installId the caller has proved it owns with its install secret.
//
// Audit L3: the install secret could be copied to any number of machines. The install is
// now bound to one machine hash (trust on first use) and the lease carries it as `mid`.
// See machineBinding.js for the binding, the admin reset and the self-service transfer.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { issueLease } = require('../lease');
const { authenticateInstall } = require('../installAuth');
const { checkMachine, transferMachine } = require('../machineBinding');

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const { tenantId, installId, installSecret, machineHash } = req.body || {};
  if (!tenantId) return res.status(400).json({ error: 'tenantId is required.' });
  if (!installId || !installSecret) return res.status(400).json({ error: 'installId and installSecret are required.' });

  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  const authed = await authenticateInstall(prisma, tenant, { installId, installSecret });
  if (!authed) return res.status(401).json({ error: 'Unknown install or wrong install secret.' });
  const bound = await checkMachine(prisma, authed, machineHash);
  if (!bound.ok) return res.status(bound.status).json({ error: bound.error });
  const install = bound.install;

  const lic = await prisma.license.findFirst({ where: { tenantId: tenant.id, installId: install.id }, orderBy: { updatedAt: 'desc' } });

  const now = Date.now();
  const active = lic && lic.status === 'active' && lic.currentPeriodEnd && new Date(lic.currentPeriodEnd).getTime() > now;
  if (!active) return res.json({ lease: null, status: lic ? lic.status : 'none' });

  await prisma.install.update({ where: { id: install.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  const lease = issueLease(tenant, lic, now, { mid: install.machineHash });
  res.json({ lease: lease.token, exp: lease.exp, tier: lease.tier, currentPeriodEnd: lic.currentPeriodEnd });
}));

// POST /v1/license/transfer { tenantId, installId, installSecret, machineHash, proof }
// Self-service move of a licence to a new PC. Needs the install secret AND a proof of
// purchase (the redeemed activation code, or the payment/subscription reference), and is
// limited to 2 transfers per licence per 30 days. -> { ok, transferred, remaining? }
//   400 machine_required, 401 bad secret, 403 invalid_proof, 404 no_license, 429 transfer_limit
router.post('/transfer', asyncHandler(async (req, res) => {
  const { tenantId, installId, installSecret, machineHash, proof } = req.body || {};
  if (!tenantId) return res.status(400).json({ error: 'tenantId is required.' });
  if (!installId || !installSecret) return res.status(400).json({ error: 'installId and installSecret are required.' });

  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  const install = await authenticateInstall(prisma, tenant, { installId, installSecret });
  if (!install) return res.status(401).json({ error: 'Unknown install or wrong install secret.' });

  const { status, body } = await transferMachine(prisma, tenant, install, { machineHash, proof });
  res.status(status).json(body);
}));

module.exports = router;
