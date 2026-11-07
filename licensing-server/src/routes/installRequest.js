'use strict';
// Shared start of the install-authenticated endpoints (/v1/account/verify/*, /v1/trial/start):
// tenant, install secret, optionally the machine binding, plus the client IP hash. Sends the error
// response itself and returns null on failure. Errors: 400 bad_request, 404 unknown_tenant,
// 401 invalid_install, 400 machine_required, 403 machine_mismatch.
const prisma = require('../db');
const { authenticateInstall } = require('../installAuth');
const { checkMachine } = require('../machineBinding');
const { clientIp, ipHash, isPublicIp } = require('../net/clientIp');
const { getSettings } = require('../settings');
const { touchInstall } = require('../customers/sync');

async function installRequest(req, res, { requireMachine = false } = {}) {
  const { tenantId, installId, installSecret, machineHash, appVersion } = req.body || {};
  if (!tenantId || !installId || !installSecret) {
    res.status(400).json({ error: 'bad_request', message: 'tenantId, installId and installSecret are required.' });
    return null;
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') {
    res.status(404).json({ error: 'unknown_tenant', message: 'Unknown tenant.' });
    return null;
  }
  let install = await authenticateInstall(prisma, tenant, { installId, installSecret });
  if (!install) {
    res.status(401).json({ error: 'invalid_install', message: 'Unknown install or wrong install secret.' });
    return null;
  }
  if (requireMachine) {
    const bound = await checkMachine(prisma, install, machineHash);
    if (!bound.ok) { res.status(bound.status).json({ error: bound.error }); return null; }
    install = bound.install;
  }
  await touchInstall(prisma, install, appVersion).catch(() => {});
  const ip = clientIp(req);
  return {
    tenant,
    install,
    ipHash: ip ? ipHash(ip) : null,
    ipCounts: isPublicIp(ip),
    settings: await getSettings(prisma, tenant.id)
  };
}

module.exports = { installRequest };
