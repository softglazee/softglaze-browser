'use strict';
// Privacy erase (hard delete of personal data). Kept, without anything that identifies the person:
//  - payments: amount, currency, dates, status, provider, plan, reference (accounting needs them);
//    customer link, account email and note are removed;
//  - licences: term, tier, status (an active licence keeps working on its install); email, link
//    and note removed;
//  - the trial ledger row: only hashes (machine, HMAC of the email key, HMAC of the IP), so the
//    same person cannot take a second trial; the customer link is removed;
//  - status history events, moved to a random anonymous id so past churn / paying counts stay true.
// Deleted: the customer row, verification codes, sent-email log rows, other timeline events, and the
// details of admin audit entries about this customer. Installs lose their email and customer link.
const crypto = require('node:crypto');

async function eraseCustomer(db, tenantId, customerId) {
  const c = await db.customer.findUnique({ where: { id: String(customerId) } });
  if (!c || c.tenantId !== tenantId) return null;
  const anon = `anon_${crypto.randomBytes(9).toString('base64url')}`;
  const where = { tenantId, customerId: c.id };
  return db.$transaction(async (tx) => {
    const payments = await tx.payment.findMany({ where });
    const kept = { payments: payments.length, totalPaidCents: payments.filter((p) => p.status === 'paid').reduce((s, p) => s + (Number(p.amount) || 0), 0) };
    await tx.payment.updateMany({ where, data: { customerId: null, account: null, note: null } });
    await tx.license.updateMany({ where, data: { customerId: null, account: null, note: null } });
    await tx.install.updateMany({ where, data: { customerId: null, account: null } });
    // Rows that carry the address without being linked (claimed at register or checkout).
    for (const model of ['install', 'license', 'payment']) {
      await tx[model].updateMany({ where: { tenantId, account: { in: [c.email, c.emailKey] } }, data: { account: null } });
    }
    await tx.trial.updateMany({ where, data: { customerId: null } });
    await tx.emailVerification.deleteMany({ where: { tenantId, OR: [{ customerId: c.id }, { emailKey: c.emailKey }] } });
    await tx.emailOutbox.deleteMany({ where: { tenantId, OR: [{ customerId: c.id }, { toEmail: c.email }] } });
    await tx.customerEvent.updateMany({ where: { tenantId, customerId: c.id, type: 'status' }, data: { customerId: anon } });
    await tx.customerEvent.deleteMany({ where: { tenantId, customerId: c.id } });
    await tx.adminAudit.updateMany({ where: { tenantId, targetType: 'customer', targetId: c.id }, data: { detail: null } });
    await tx.customer.delete({ where: { id: c.id } });
    return kept;
  });
}

module.exports = { eraseCustomer };
