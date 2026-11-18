'use strict';
// Website purchases (browser.softglaze.com/buy). A buyer pays by card on the website, without the app,
// so there is no install to bind a licence to, and a licence is never matched by email (licensing.js).
// Such a Payment is recorded with method 'web' and installId null. When it is provisioned, ONE
// single-use activation code (the shape POST /v1/tenant/codes mints) is created for the plan's tier and
// months, written on the Payment's note (so a webhook retry, the cron or a second return-page check
// reuses it instead of minting again), and emailed to payment.account. The buyer types the code into
// the app (Billing > "Have a purchase code?"), and POST /v1/redeem binds the licence to that install.
const crypto = require('node:crypto');
const { getSettings } = require('./settings');
const { renderFor, enqueue, deliverQueued } = require('./email/outbox');
const transport = require('./email/transport');

const WEB_METHOD = 'web';
const TEMPLATE_KEY = 'activation_code';
const CODE_RE = /\bSG-[0-9A-F]{12}\b/;
const NOTE_PREFIX = 'Activation code';

const isWebPayment = (p) => Boolean(p) && p.method === WEB_METHOD && !p.installId;
const codeOfPayment = (p) => {
  const m = p && typeof p.note === 'string' ? CODE_RE.exec(p.note) : null;
  return m ? m[0] : null;
};
const newCode = () => ('SG-' + crypto.randomBytes(6).toString('hex')).toUpperCase();
const dedupeKeyFor = (paymentId) => `activation-code:${paymentId}`;

function termText(months, lang = 'en') {
  const n = Math.max(1, Number(months) || 1);
  if (lang === 'es') return n === 1 ? '1 mes' : `${n} meses`;
  return n === 1 ? '1 month' : `${n} months`;
}

// Renders and queues the activation email. Essential: never held by the daily cap, no unsubscribe
// link, not stopped by a marketing unsubscribe (it is the product the buyer paid for). No Customer is
// linked, so consent rules for other categories never apply to it. Returns the outbox row id.
async function queueCodeEmail(db, tenantId, { payment, code, plan, months, dedupeKey, createdBy }) {
  const settings = await getSettings(db, tenantId);
  const rendered = await renderFor(db, tenantId, {
    customer: { email: payment.account },
    templateKey: TEMPLATE_KEY,
    category: 'essential',
    settings,
    lang: 'en',
    extraVars: { code, plan: (plan && plan.name) || (plan && plan.tier) || 'Pro', term: termText(months, 'en') }
  });
  const row = await enqueue(db, tenantId, {
    toEmail: payment.account, templateKey: TEMPLATE_KEY, category: 'essential', dedupeKey,
    subject: rendered.subject, html: rendered.html, text: rendered.text, createdBy: createdBy || null
  });
  if (row) return row.id;
  const existing = await db.emailOutbox.findUnique({ where: { tenantId_dedupeKey: { tenantId, dedupeKey } } });
  return existing ? existing.id : null;
}

// Called from provisionFromPaymentRef, inside the provisioning transaction, after the Payment was
// claimed pending -> paid (so only one caller ever gets here for a payment). Still idempotent on its
// own: an existing code on the Payment is reused and the email's dedupe key is the payment id.
// Returns { code, outboxId }.
async function issueWebCode(tenant, payment, plan, db) {
  const fresh = (await db.payment.findUnique({ where: { id: payment.id } })) || payment;
  const tier = (plan && plan.tier) || 'pro';
  const months = (plan && plan.months) || 1;
  let code = codeOfPayment(fresh);
  if (!code) {
    code = newCode();
    await db.licenseCode.create({ data: { tenantId: tenant.id, code, tier, months } });
    const line = `${NOTE_PREFIX} ${code} (website purchase, ${tier}, ${termText(months)}, emailed to the buyer)`;
    await db.payment.update({ where: { id: fresh.id }, data: { note: [fresh.note, line].filter(Boolean).join('\n').slice(0, 5000) } });
  }
  const outboxId = await queueCodeEmail(db, tenant.id, { payment: fresh, code, plan, months, dedupeKey: dedupeKeyFor(fresh.id) });
  if (!transport.isConfigured()) {
    console.warn(`[web-purchase] SMTP is not configured: the activation code for payment ${fresh.id} is saved and its email is queued; it goes out once SMTP is set (or resend it from the admin).`);
  }
  return { code, outboxId };
}

// Sends a queued activation email now instead of waiting for the cron (best effort; the cron retries).
async function deliverCodeEmail(db, tenantId, outboxId) {
  if (!outboxId) return { status: 'none' };
  const settings = await getSettings(db, tenantId);
  return deliverQueued(db, tenantId, outboxId, { settings });
}

// The buyer's thanks page polls the status endpoint: if the payment was settled elsewhere (a webhook)
// and its email still waits in the queue, send it now rather than at the next cron run.
async function kickCodeEmail(db, tenantId, paymentId) {
  const row = await db.emailOutbox.findUnique({ where: { tenantId_dedupeKey: { tenantId, dedupeKey: dedupeKeyFor(paymentId) } } });
  if (!row || row.status !== 'queued') return { status: 'none' };
  return deliverCodeEmail(db, tenantId, row.id);
}

// Admin: email the code of a web payment again (a lost or filtered email). A new outbox row each time.
// -> { code, outboxId, delivery } | { error }
async function resendWebCode(db, tenantId, paymentId, { createdBy } = {}) {
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.tenantId !== tenantId) return { error: 'not_found' };
  const code = codeOfPayment(payment);
  if (!isWebPayment(payment) || !code) return { error: 'no_code' };
  if (payment.status !== 'paid') return { error: 'not_paid' };
  const rec = await db.licenseCode.findUnique({ where: { tenantId_code: { tenantId, code } } });
  const plan = payment.plan ? await db.plan.findUnique({ where: { tenantId_key: { tenantId, key: payment.plan } } }) : null;
  const months = (rec && rec.months) || (plan && plan.months) || 1;
  const outboxId = await queueCodeEmail(db, tenantId, {
    payment, code, plan: plan || { tier: rec && rec.tier }, months,
    dedupeKey: `${dedupeKeyFor(payment.id)}:resend:${Date.now()}`, createdBy
  });
  const delivery = await deliverCodeEmail(db, tenantId, outboxId);
  return { code, redeemed: Boolean(rec && rec.redeemedAt), outboxId, delivery };
}

// A refunded web payment: its code stops working if nobody has redeemed it yet. -> { voided }
async function voidWebCode(db, tenantId, payment) {
  const code = codeOfPayment(payment);
  if (!code) return { voided: false };
  const r = await db.licenseCode.updateMany({
    where: { tenantId, code, redeemedAt: null },
    data: { redeemedAt: new Date(), redeemedBy: `refunded:${payment.id}`.slice(0, 191) }
  });
  return { voided: Boolean(r && r.count === 1) };
}

module.exports = {
  WEB_METHOD, TEMPLATE_KEY, isWebPayment, codeOfPayment, termText, dedupeKeyFor,
  issueWebCode, deliverCodeEmail, kickCodeEmail, resendWebCode, voidWebCode
};
