'use strict';
// Tenant-admin endpoints (authenticated by the tenant API key). A merchant uses
// these to configure their payment provider keys, plans, and activation codes.
const express = require('express');
const crypto = require('node:crypto');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const tenantApiAuth = require('../middleware/tenantApiAuth');
const { sealJson, seal } = require('../crypto/secrets');
const { generateTenantKeypair } = require('../crypto/keys');
const { publicBaseUrl } = require('../env');

const router = express.Router();
router.use(tenantApiAuth);

// Store a provider's credentials (sealed at rest) + return the webhook URL to set.
// POST /v1/tenant/payment-config { provider, enabled, secretKey, webhookSecret, merchantId? }
router.post('/payment-config', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const provider = String(b.provider || '').toLowerCase();
  if (!['stripe', 'paypal', 'cryptomus'].includes(provider)) return res.status(400).json({ error: 'Unknown provider.' });
  const secretsSealed = sealJson({ secretKey: b.secretKey || '', webhookSecret: b.webhookSecret || '', merchantId: b.merchantId || '' });
  await prisma.tenantPaymentConfig.upsert({
    where: { tenantId_provider: { tenantId: req.tenant.id, provider } },
    update: { enabled: Boolean(b.enabled), secretsSealed },
    create: { tenantId: req.tenant.id, provider, enabled: Boolean(b.enabled), secretsSealed }
  });
  res.json({ ok: true, provider, webhookUrl: `${publicBaseUrl}/v1/webhooks/${provider}/${req.tenant.id}` });
}));

// Create / update a plan.
// POST /v1/tenant/plans { key, name, tier?, amount, currency?, interval?, months?, active? }
router.post('/plans', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.key || !b.name) return res.status(400).json({ error: 'key and name are required.' });
  const data = {
    name: String(b.name),
    tier: b.tier === 'enterprise' ? 'enterprise' : 'pro',
    amount: Math.max(0, Math.round(Number(b.amount) || 0)),
    currency: String(b.currency || 'USD').toUpperCase(),
    interval: String(b.interval || 'month'),
    months: Math.max(1, Number(b.months) || 1),
    recurring: Boolean(b.recurring),
    active: b.active === undefined ? true : Boolean(b.active)
  };
  const plan = await prisma.plan.upsert({
    where: { tenantId_key: { tenantId: req.tenant.id, key: String(b.key) } },
    update: data,
    create: { tenantId: req.tenant.id, key: String(b.key), ...data }
  });
  res.json(plan);
}));

router.get('/plans', asyncHandler(async (req, res) => {
  res.json(await prisma.plan.findMany({ where: { tenantId: req.tenant.id }, orderBy: { amount: 'asc' } }));
}));

// Mint activation codes.
// POST /v1/tenant/codes { tier?, months?, count? } -> { codes: [...] }
router.post('/codes', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const count = Math.min(Math.max(Number(b.count) || 1, 1), 100);
  const tier = b.tier === 'enterprise' ? 'enterprise' : 'pro';
  const months = Math.max(1, Number(b.months) || 1);
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = ('SG-' + crypto.randomBytes(6).toString('hex')).toUpperCase();
    await prisma.licenseCode.create({ data: { tenantId: req.tenant.id, code, tier, months } });
    codes.push(code);
  }
  res.json({ codes });
}));

// Rotate this tenant's Ed25519 signing keypair. Returns the NEW public key — the
// merchant must rebuild their app with it; leases signed by the old key stop
// verifying once the rebuilt app ships.
router.post('/rotate-key', asyncHandler(async (req, res) => {
  const { publicKeyPem, privateKeyPem } = generateTenantKeypair();
  await prisma.tenant.update({ where: { id: req.tenant.id }, data: { publicKeyPem, privateKeySealed: seal(privateKeyPem) } });
  res.json({ publicKeyPem, note: 'Rebuild the tenant app with this public key. Existing leases stop verifying once the rebuilt app is installed.' });
}));

module.exports = router;
