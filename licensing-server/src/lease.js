'use strict';
// Build + sign a short-lived license lease. Format: <payloadB64url>.<sigB64url>,
// signed with the tenant's Ed25519 private key. The desktop verifies the signature
// with the baked public key and trusts tier/exp only if it checks out. The lease
// is capped to LEASE_DAYS and never overshoots the paid term (currentPeriodEnd).
const { randomBytes } = require('node:crypto');
const { signEd25519 } = require('./crypto/keys');
const { open } = require('./crypto/secrets');
const { leaseDays } = require('./env');

const DAY = 86400000;
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function issueLease(tenant, license, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const periodEnd = license.currentPeriodEnd ? new Date(license.currentPeriodEnd).getTime() : 0;
  const cap = now + leaseDays * DAY;
  const exp = periodEnd ? Math.min(cap, periodEnd) : cap;
  const payload = {
    v: 1,
    tenant: tenant.id,
    sub: license.installId || null,
    account: license.account || null,
    tier: license.tier || 'pro',
    plan: license.plan || null,
    iat: Math.floor(now / 1000),
    exp: Math.floor(exp / 1000),
    nonce: b64url(randomBytes(8))
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const privatePem = open(tenant.privateKeySealed);
  const sig = signEd25519(privatePem, Buffer.from(payloadB64));
  return { token: `${payloadB64}.${b64url(sig)}`, exp: payload.exp, tier: payload.tier };
}

module.exports = { issueLease };
