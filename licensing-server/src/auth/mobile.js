'use strict';
// Sign-in for the phone app (client softglaze-mobile) and the email-code part of the web app (client
// softglaze-web). The contract the phone app is built against is D:\SoftGlaze-Mobile\docs\features\
// SECURITY-VAULT.md ("Auth server contract") and app/src/features/onboarding/auth/HttpAuthClient.ts.
//
// Email code (no install, so the code is bound to a random challengeId the client holds instead):
//   start  { email, device? } -> { challengeId, resendAfterSec, expiresAt (ms) }; the 6-digit code goes by email
//          (same template, lifetime, attempts and hourly limits as the desktop code, per email and per network)
//   verify { challengeId, code, device? } -> a session. 400 invalid_code, 400 code_expired, 429 too_many_attempts
// Provider sign-in: the browser leg is src/auth/flow.js (startClientSignIn); the client trades the one-time
// code with its PKCE verifier (takeClientCode) and gets a session.
// Phone sessions: { token, expiresAt (ms), account: { id, email, name, tier } }, 30 days sliding, one
// MobileDevice row each. A new phone over MOBILE_PHONES_ALLOWED is refused with 403 phone_limit.
// Entitlement: an Ed25519-signed token for the relay (D:\SoftGlaze-Mobile\relay\src\entitlement.ts):
//   base64url(JSON payload) + "." + base64url(Ed25519 signature over the ASCII of the first part)
const crypto = require('node:crypto');
const { liveEnv } = require('../env');
const { parseEmail } = require('../customers/emailAddress');
const { isDisposableDomain } = require('../customers/disposable');
const { checkMailDomain } = require('../customers/mx');
const { hmacHex, safeEqual } = require('../crypto/derive');
const { renderFor, sendNow, VERIFY_KEY_PREFIX } = require('../email/outbox');
const transport = require('../email/transport');
const { cleanLang } = require('../account/verify');
const { ms } = require('../util/time');
const { randomToken, sha256Hex, isOpaqueToken } = require('./tokens');
const { accountSignIn } = require('./accounts');
const { revokeSession } = require('./sessions');
const { accountOf, phonesAllowed, activePhones } = require('./accountApi');

const err = (status, error, message, extra = {}) => ({ status, body: { error, message, ...extra } });

// --- The device the phone sends with every sign-in ---
const PLATFORMS = Object.freeze(['ios', 'android', 'web']);
function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}
// -> { platform, model, appVersion, installationId } or null when it is not usable.
function cleanDevice(d) {
  if (!d || typeof d !== 'object' || !PLATFORMS.includes(d.platform)) return null;
  const id = typeof d.id === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(d.id) ? d.id : null;
  return { platform: d.platform, model: cleanText(d.model, 100), appVersion: cleanText(d.appVersion, 40), installationId: id };
}

// Refuses a new phone when the account already has MOBILE_PHONES_ALLOWED phones signed in. The same phone
// signing in again (same installationId) does not count twice.
function phoneGate(db, tenantId, device, now) {
  return async (resolved) => {
    if (!resolved.customer) return null;
    const phones = await activePhones(db, tenantId, resolved.customer.id, now);
    const others = phones.filter((p) => !device.installationId || p.installationId !== device.installationId);
    if (others.length >= phonesAllowed()) {
      return err(403, 'phone_limit', 'This account already has the most phones signed in. Sign out on another phone first.', { phonesAllowed: phonesAllowed() });
    }
    return null;
  };
}

// The MobileDevice row of a new phone session; an older session of the same phone (same installationId) ends.
async function registerDevice(db, tenantId, customerId, sessionRow, device, now) {
  const at = new Date(now);
  if (device.installationId) {
    const old = await db.mobileDevice.findMany({ where: { tenantId, customerId, installationId: device.installationId, revokedAt: null } });
    for (const d of old) {
      const row = await db.authSession.findUnique({ where: { id: d.authSessionId } });
      if (row) await revokeSession(db, row, now);
      else await db.mobileDevice.update({ where: { id: d.id }, data: { revokedAt: at } });
    }
  }
  return db.mobileDevice.create({
    data: {
      tenantId, customerId, authSessionId: sessionRow.id, platform: device.platform, model: device.model,
      appVersion: device.appVersion, installationId: device.installationId, createdAt: at, lastSeenAt: at
    }
  });
}

function mobileBody(customer, token, expiresAt) {
  return { token, expiresAt: ms(expiresAt), account: { id: customer.id, email: customer.email, name: customer.name || null, tier: accountOf(customer).tier } };
}

function webBody(customer, s, now = Date.now()) {
  return {
    access_token: s.token,
    token_type: 'Bearer',
    expires_in: Math.max(0, Math.round((ms(s.accessExpiresAt) - now) / 1000)),
    refresh_token: s.refreshToken,
    refresh_expires_at: ms(s.expiresAt),
    account: accountOf(customer)
  };
}

// One verified sign-in for the phone or web client. -> { status, body } in that client's format.
async function clientSignIn(db, tenant, provider, profile, { client, device = null, ipHash = null, userAgent = null, now = Date.now() }) {
  const mobile = client === 'softglaze-mobile';
  if (mobile && !device) return err(400, 'invalid_request', 'The device details are missing.');
  const r = await accountSignIn(db, tenant, provider, profile, {
    kind: mobile ? 'mobile' : 'web', clientId: client, ipHash, userAgent, now, gate: mobile ? phoneGate(db, tenant.id, device, now) : null
  });
  if (!r.ok) return r;
  if (mobile) {
    await registerDevice(db, tenant.id, r.customer.id, r.session.row, device, now);
    return { status: 200, body: mobileBody(r.customer, r.session.token, r.session.expiresAt) };
  }
  return { status: 200, body: webBody(r.customer, r.session, now) };
}

// --- Email code without an install ---
const codeHash = (code, challengeHash, emailKey) => hmacHex('client-code-v1', `${code}|${challengeHash}|${emailKey}`);

async function emailStart(db, tenant, input, { ipHash = null, now = Date.now(), settings }) {
  const b = input || {};
  const parsed = parseEmail(b.email);
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
  const tenantId = tenant.id;
  const last = await db.emailVerification.findFirst({ where: { tenantId, emailKey: parsed.emailKey, NOT: { challengeHash: null } }, orderBy: { createdAt: 'desc' } });
  if (last && now - ms(last.createdAt) < v.resendSeconds * 1000) {
    const retryAfterSec = Math.ceil((ms(last.createdAt) + v.resendSeconds * 1000 - now) / 1000);
    return err(429, 'rate_limited', 'Please wait a moment before asking for another code.', { retryAfterSec });
  }
  const hourAgo = new Date(now - 3600000);
  const [byEmail, byNet] = await Promise.all([
    db.emailVerification.count({ where: { tenantId, emailKey: parsed.emailKey, createdAt: { gte: hourAgo } } }),
    ipHash ? db.emailVerification.count({ where: { tenantId, ipHash, createdAt: { gte: hourAgo } } }) : 0
  ]);
  if (byEmail >= v.maxSendsPerHourPerEmail || byNet >= v.maxSendsPerHourPerNetwork) {
    return err(429, 'rate_limited', 'Too many codes were requested. Please try again later.', { retryAfterSec: 3600 });
  }
  if (!transport.isConfigured()) return err(503, 'email_unavailable', 'Email sending is not set up on the server yet.');

  const challengeId = randomToken(32);
  const challengeHash = sha256Hex(challengeId);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const lang = cleanLang(b.lang) || 'en';
  const expiresAt = new Date(now + v.codeTtlMinutes * 60000);
  // An earlier unused code for this address ends: only the newest one works.
  await db.emailVerification.updateMany({
    where: { tenantId, emailKey: parsed.emailKey, verifiedAt: null, expiresAt: { gt: new Date(now) }, NOT: { challengeHash: null } },
    data: { expiresAt: new Date(now) }
  });
  const row = await db.emailVerification.create({
    data: {
      tenantId, installId: '', email: parsed.email, emailKey: parsed.emailKey, lang, challengeHash,
      codeHash: codeHash(code, challengeHash, parsed.emailKey), expiresAt, ipHash, createdAt: new Date(now)
    }
  });
  const rendered = await renderFor(db, tenantId, {
    customer: { email: parsed.email, name: null, lang }, templateKey: 'verify_code', category: 'essential', settings, now,
    extraVars: { code, codeMinutes: String(v.codeTtlMinutes) }, lang
  });
  const sent = await sendNow(db, tenantId, {
    toEmail: parsed.email, rendered, replyTo: em.replyTo, createdBy: 'verify', redact: true,
    queueOnTransient: true, dedupeKey: `${VERIFY_KEY_PREFIX}${row.id}`
  });
  if (!sent.ok && !sent.queued) {
    await db.emailVerification.delete({ where: { id: row.id } }).catch(() => {});
    return err(502, 'email_failed', 'We could not send the code just now. Please try again in a minute.');
  }
  return { status: 200, body: { challengeId, resendAfterSec: v.resendSeconds, expiresAt: expiresAt.getTime() } };
}

async function emailVerify(db, tenant, input, { client, device = null, ipHash = null, userAgent = null, now = Date.now(), settings }) {
  const b = input || {};
  const code = typeof b.code === 'string' || typeof b.code === 'number' ? String(b.code).trim() : '';
  if (!isOpaqueToken(b.challengeId) || !/^\d{6}$/.test(code)) return err(400, 'invalid_code', 'The code is the 6 digits from the email.');
  if (client === 'softglaze-mobile' && !device) return err(400, 'invalid_request', 'The device details are missing.');
  const challengeHash = sha256Hex(b.challengeId);
  const row = await db.emailVerification.findUnique({ where: { challengeHash } });
  if (!row || row.tenantId !== tenant.id) return err(400, 'invalid_code', 'That code is not right.');
  if (row.verifiedAt || ms(row.expiresAt) <= now) return err(400, 'code_expired', 'This code has expired. Ask for a new one.');
  const max = settings.verify.maxAttempts;
  if (row.attempts >= max) return err(429, 'too_many_attempts', 'Too many wrong codes. Ask for a new one.');
  const claim = await db.emailVerification.updateMany({ where: { id: row.id, attempts: row.attempts, verifiedAt: null }, data: { attempts: { increment: 1 } } });
  if (claim.count !== 1) return err(429, 'too_many_attempts', 'Too many attempts at once. Ask for a new code.');
  if (!safeEqual(row.codeHash, codeHash(code, challengeHash, row.emailKey))) {
    return err(400, 'invalid_code', 'That code is not right.', { attemptsLeft: Math.max(0, max - row.attempts - 1) });
  }
  const used = await db.emailVerification.updateMany({ where: { id: row.id, verifiedAt: null }, data: { verifiedAt: new Date(now) } });
  if (used.count !== 1) return err(400, 'code_expired', 'This code was already used. Ask for a new one.');
  const profile = { providerUserId: row.emailKey, email: row.email, emailVerified: true, name: null, login: null };
  const r = await clientSignIn(db, tenant, 'email', profile, { client, device, ipHash, userAgent, now });
  if (r.status === 200) {
    const customer = await db.customer.findUnique({ where: { tenantId_emailKey: { tenantId: tenant.id, emailKey: row.emailKey } } });
    if (customer) await db.emailVerification.update({ where: { id: row.id }, data: { customerId: customer.id } }).catch(() => {});
  }
  return r;
}

// --- Entitlement token for the relay ---
// RELAY_ENTITLEMENT_SIGNING_KEY: an Ed25519 private key, PKCS#8 DER in base64 (one line), generated with
//   node -e "const k=require('crypto').generateKeyPairSync('ed25519');console.log('RELAY_ENTITLEMENT_SIGNING_KEY='+k.privateKey.export({format:'der',type:'pkcs8'}).toString('base64'));console.log('RELAY_ENTITLEMENT_PUBKEY='+k.publicKey.export({format:'jwk'}).x)"
// The second line (the raw 32-byte public key, base64url) is the relay's RELAY_ENTITLEMENT_PUBKEY.
const ENTITLEMENT_MAX_MS = 7 * 86400000; // the phone's offline grace (MOBILE-PLAN A1)
let keyCache = { raw: null, key: null };
function entitlementKey() {
  const raw = liveEnv('RELAY_ENTITLEMENT_SIGNING_KEY');
  if (!raw) return null;
  if (keyCache.raw === raw) return keyCache.key;
  let key = null;
  try {
    const k = crypto.createPrivateKey({ key: Buffer.from(String(raw).trim(), 'base64'), format: 'der', type: 'pkcs8' });
    key = k.asymmetricKeyType === 'ed25519' ? k : null;
  } catch (_) { key = null; }
  if (!key) console.warn('[mobile] RELAY_ENTITLEMENT_SIGNING_KEY is not a base64 PKCS#8 Ed25519 private key.');
  keyCache = { raw, key };
  return key;
}
function entitlementPublicKey() {
  const k = entitlementKey();
  return k ? crypto.createPublicKey(k).export({ format: 'jwk' }).x : null;
}

function signEntitlement(payload, key) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.sign(null, Buffer.from(body, 'ascii'), key).toString('base64url');
  return `${body}.${sig}`;
}

// POST /v1/mobile/entitlement { mailbox? }. -> { token, exp (unix seconds), payload } | 403 no_entitlement |
// 503 entitlement_unavailable. type: trial while the trial runs, paid for a paid or complimentary licence.
async function entitlement(db, found, input, { settings, now = Date.now() }) {
  const key = entitlementKey();
  if (!key) return err(503, 'entitlement_unavailable', 'The relay entitlement is not set up on the server yet.');
  const { customer } = found;
  const graceMs = ((settings && settings.billing && settings.billing.renewalGraceDays) || 0) * 86400000;
  const ends = [];
  let type = null;
  const paidEnd = Math.max(customer.paidUntil ? ms(customer.paidUntil) + graceMs : 0, customer.complimentaryUntil ? ms(customer.complimentaryUntil) : 0);
  if (customer.tier && paidEnd > now) { type = 'paid'; ends.push(paidEnd); }
  else if (customer.status === 'trial' && customer.trialEndsAt && ms(customer.trialEndsAt) > now) { type = 'trial'; ends.push(ms(customer.trialEndsAt)); }
  if (!type) return err(403, 'no_entitlement', 'This account has no active plan or trial.');
  const exp = Math.floor(Math.min(now + ENTITLEMENT_MAX_MS, ...ends) / 1000);
  const mailbox = input && typeof input.mailbox === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(input.mailbox) ? input.mailbox : undefined;
  const lic = await db.license.findMany({ where: { tenantId: customer.tenantId, customerId: customer.id, status: 'active' } });
  const seats = lic.filter((l) => l.currentPeriodEnd && ms(l.currentPeriodEnd) > now).length;
  const payload = {
    v: 1, customer: customer.id, tier: customer.tier || 'pro', type, seats, phonesAllowed: phonesAllowed(),
    iat: Math.floor(now / 1000), exp, ...(mailbox ? { mailbox } : {})
  };
  return { status: 200, body: { token: signEntitlement(payload, key), exp, payload } };
}

module.exports = {
  cleanDevice, phoneGate, registerDevice, mobileBody, webBody, clientSignIn, emailStart, emailVerify, entitlement,
  entitlementPublicKey, signEntitlement, ENTITLEMENT_MAX_MS
};
