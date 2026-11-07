'use strict';
// Email verification by us (spec A2). start sends a 6-digit code from no-reply@ (10 min, 5 attempts,
// resend throttle); check proves it, creates or updates the Customer and links the install.
// Only an HMAC of the code (bound to the install and the email key) is stored.
// Results are { status, body }; the route sends them as they are.
const crypto = require('node:crypto');
const { parseEmail } = require('../customers/emailAddress');
const { isDisposableDomain } = require('../customers/disposable');
const { checkMailDomain } = require('../customers/mx');
const { createCustomer, addEvent, claimUnboundLicences, linkInstallRecords, recomputeCustomer } = require('../customers/sync');
const { hmacHex, safeEqual } = require('../crypto/derive');
const { renderFor, sendNow } = require('../email/outbox');
const transport = require('../email/transport');

const err = (status, error, message, extra = {}) => ({ status, body: { error, message, ...extra } });

const codeHash = (code, installId, emailKey) => hmacHex('verify-code-v1', `${code}|${installId}|${emailKey}`);

function cleanName(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 200) : null;
}
function cleanLang(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[a-z]{2}(?:[-_][A-Za-z]{2})?$/.test(s) ? s.slice(0, 2).toLowerCase() : null;
}
// Country from an explicit ISO code, else from a locale like "es-MX".
function cleanCountry(country, lang) {
  const c = typeof country === 'string' ? country.trim().toUpperCase() : '';
  if (/^[A-Z]{2}$/.test(c)) return c;
  const m = typeof lang === 'string' ? /^[a-z]{2}[-_]([A-Za-z]{2})$/.exec(lang.trim()) : null;
  return m ? m[1].toUpperCase() : null;
}

async function startVerification(db, tenant, install, input, { ipHash = null, now = Date.now(), settings }) {
  const parsed = parseEmail(input.email);
  if (!parsed) return err(400, 'invalid_email', 'That email address does not look right.');
  const em = settings.email;
  if (isDisposableDomain(parsed.domain, { allow: em.domainAllowlist, block: em.domainBlocklist })) {
    return err(400, 'disposable_email', 'Please use a permanent email address, not a temporary one.');
  }
  if (em.mxCheck) {
    const mx = await checkMailDomain(parsed.domain);
    if (!mx.ok) return err(400, 'no_mx', 'This email domain cannot receive email.');
  }

  const v = settings.verify;
  const hourAgo = new Date(now - 3600000);
  const tenantId = tenant.id;
  const last = await db.emailVerification.findFirst({ where: { tenantId, installId: install.id, emailKey: parsed.emailKey }, orderBy: { createdAt: 'desc' } });
  if (last && now - new Date(last.createdAt).getTime() < v.resendSeconds * 1000) {
    const retryAfterSec = Math.ceil((new Date(last.createdAt).getTime() + v.resendSeconds * 1000 - now) / 1000);
    return err(429, 'rate_limited', 'Please wait a moment before asking for another code.', { retryAfterSec });
  }
  const [byEmail, byInstall, byNet] = await Promise.all([
    db.emailVerification.count({ where: { tenantId, emailKey: parsed.emailKey, createdAt: { gte: hourAgo } } }),
    db.emailVerification.count({ where: { tenantId, installId: install.id, createdAt: { gte: hourAgo } } }),
    ipHash ? db.emailVerification.count({ where: { tenantId, ipHash, createdAt: { gte: hourAgo } } }) : 0
  ]);
  if (byEmail >= v.maxSendsPerHourPerEmail || byInstall >= v.maxSendsPerHourPerInstall || byNet >= v.maxSendsPerHourPerNetwork) {
    return err(429, 'rate_limited', 'Too many codes were requested. Please try again later.', { retryAfterSec: 3600 });
  }
  if (!transport.isConfigured()) return err(503, 'email_unavailable', 'Email sending is not set up on the server yet.');

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const lang = cleanLang(input.lang) || 'en';
  const name = cleanName(input.name);
  // A new code replaces any earlier one for this install and address.
  await db.emailVerification.updateMany({
    where: { tenantId, installId: install.id, emailKey: parsed.emailKey, verifiedAt: null, expiresAt: { gt: new Date(now) } },
    data: { expiresAt: new Date(now) }
  });
  const row = await db.emailVerification.create({
    data: {
      tenantId, installId: install.id, email: parsed.email, emailKey: parsed.emailKey, name, lang,
      country: cleanCountry(input.country, input.lang), consentMarketing: input.consentMarketing === true,
      codeHash: codeHash(code, install.id, parsed.emailKey), expiresAt: new Date(now + v.codeTtlMinutes * 60000), ipHash,
      createdAt: new Date(now)
    }
  });

  const rendered = await renderFor(db, tenantId, {
    customer: { email: parsed.email, name, lang }, templateKey: 'verify_code', category: 'essential', settings, now,
    extraVars: { code, codeMinutes: String(v.codeTtlMinutes) }, lang
  });
  const sent = await sendNow(db, tenantId, { toEmail: parsed.email, rendered, replyTo: em.replyTo, createdBy: 'verify', redact: true });
  if (!sent.ok) {
    // Nothing reached the person, so the throttle must not hold them back.
    await db.emailVerification.delete({ where: { id: row.id } }).catch(() => {});
    return err(502, 'email_failed', 'We could not send the code just now. Please try again in a minute.');
  }
  return { status: 200, body: { ok: true, sent: true, expiresInSec: v.codeTtlMinutes * 60, resendAfterSec: v.resendSeconds } };
}

async function checkVerification(db, tenant, install, input, { now = Date.now(), settings }) {
  const parsed = parseEmail(input.email);
  if (!parsed) return err(400, 'invalid_email', 'That email address does not look right.');
  const code = typeof input.code === 'string' || typeof input.code === 'number' ? String(input.code).trim() : '';
  if (!/^\d{6}$/.test(code)) return err(400, 'invalid_code', 'The code is the 6 digits from the email.');
  const tenantId = tenant.id;
  const row = await db.emailVerification.findFirst({ where: { tenantId, installId: install.id, emailKey: parsed.emailKey }, orderBy: { createdAt: 'desc' } });
  if (!row) return err(404, 'no_code', 'Ask for a code first.');
  const matches = safeEqual(row.codeHash, codeHash(code, install.id, parsed.emailKey));
  if (row.verifiedAt) {
    // A retry after a lost response: same answer again.
    if (matches && row.customerId) return { status: 200, body: { verified: true, customerId: row.customerId } };
    return err(410, 'code_expired', 'This code was already used. Ask for a new one.');
  }
  if (new Date(row.expiresAt).getTime() <= now) return err(410, 'code_expired', 'This code has expired. Ask for a new one.');
  const max = settings.verify.maxAttempts;
  if (row.attempts >= max) return err(429, 'too_many_attempts', 'Too many wrong codes. Ask for a new one.');
  const claim = await db.emailVerification.updateMany({ where: { id: row.id, attempts: row.attempts, verifiedAt: null }, data: { attempts: { increment: 1 } } });
  if (claim.count !== 1) return err(429, 'too_many_attempts', 'Too many attempts at once. Ask for a new code.');
  if (!matches) {
    return err(400, 'invalid_code', 'That code is not right.', { attemptsLeft: Math.max(0, max - row.attempts - 1) });
  }

  const at = new Date(now);
  let c = await db.customer.findUnique({ where: { tenantId_emailKey: { tenantId, emailKey: parsed.emailKey } } });
  const consent = row.consentMarketing === true;
  if (!c) {
    try {
      c = await createCustomer(db, tenantId, {
        email: parsed.email, emailKey: parsed.emailKey, source: 'app', emailVerifiedAt: at, name: row.name, lang: row.lang, country: row.country,
        firstSeenAt: install.createdAt || at, lastSeenAt: at,
        ...(consent ? { marketingConsent: true, consentAt: at, consentSource: 'app_signup' } : {})
      });
    } catch (e) {
      if (!e || e.code !== 'P2002') throw e;
      c = await db.customer.findUnique({ where: { tenantId_emailKey: { tenantId, emailKey: parsed.emailKey } } });
    }
  }
  const restored = Boolean(c.deletedAt);
  c = await db.customer.update({
    where: { id: c.id },
    data: {
      // A verified address stays as it is (an alias of the same mailbox does not replace it); a
      // claimed, unverified one is replaced by what was just proven.
      email: c.emailVerifiedAt ? c.email : parsed.email,
      emailVerifiedAt: c.emailVerifiedAt || at,
      deletedAt: null,
      name: c.name || row.name,
      lang: row.lang || c.lang,
      country: c.country || row.country,
      lastSeenAt: at,
      ...(consent && !c.marketingConsent ? { marketingConsent: true, consentAt: at, consentSource: 'app_signup', unsubscribedAt: null } : {})
    }
  });
  await db.emailVerification.update({ where: { id: row.id }, data: { verifiedAt: at, customerId: c.id } });
  await db.install.update({ where: { id: install.id }, data: { customerId: c.id, account: parsed.email, lastSeenAt: at } });
  await addEvent(db, tenantId, c.id, 'verified', { installId: install.id }, at);
  if (restored) await addEvent(db, tenantId, c.id, 'restored', { by: 'signup' }, at);
  if (consent) await addEvent(db, tenantId, c.id, 'consent', { marketing: true, source: 'app_signup' }, at);
  const moved = await linkInstallRecords(db, tenantId, install.id, c.id);
  await claimUnboundLicences(db, tenantId, c.id, install.id);
  const opts = { now, graceDays: settings.billing.renewalGraceDays };
  for (const other of moved) await recomputeCustomer(db, tenantId, other, opts);
  await recomputeCustomer(db, tenantId, c.id, opts);
  return { status: 200, body: { verified: true, customerId: c.id } };
}

module.exports = { startVerification, checkVerification, cleanCountry, cleanLang };
