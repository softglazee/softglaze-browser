'use strict';
// POST /v1/checkout { tenantId, planKey, installId?, account?, provider='stripe' } -> { url, ref }
// Creates a hosted payment session using the TENANT's own (sealed) provider keys,
// and records a pending Payment so the webhook can provision uniformly by ref.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { openJson } = require('../crypto/secrets');
const { publicBaseUrl } = require('../env');
const stripeProvider = require('../providers/stripe');
const paypalProvider = require('../providers/paypal');
const cryptomusProvider = require('../providers/cryptomus');

const router = express.Router();
const SUPPORTED = new Set(['stripe', 'paypal', 'cryptomus']);

router.post('/', asyncHandler(async (req, res) => {
  const { tenantId, planKey, installId, account } = req.body || {};
  const provider = String((req.body && req.body.provider) || 'stripe').toLowerCase();
  if (!tenantId || !planKey) return res.status(400).json({ error: 'tenantId and planKey are required.' });
  if (!SUPPORTED.has(provider)) return res.status(400).json({ error: `Unsupported provider "${provider}".` });

  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  const plan = await prisma.plan.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: String(planKey) } } });
  if (!plan || !plan.active) return res.status(404).json({ error: 'Unknown or inactive plan.' });

  const cfg = await prisma.tenantPaymentConfig.findUnique({ where: { tenantId_provider: { tenantId: tenant.id, provider } } });
  if (!cfg || !cfg.enabled) return res.status(400).json({ error: `${provider} is not enabled for this tenant.` });
  const secrets = openJson(cfg.secretsSealed);

  const returnUrl = `${publicBaseUrl}/v1/checkout/return?status=success`;
  const cancelUrl = `${publicBaseUrl}/v1/checkout/return?status=cancel`;

  let url; let ref;
  if (provider === 'stripe') {
    ({ url, ref } = await stripeProvider.createCheckout({ secretKey: secrets.secretKey, tenantId: tenant.id, plan, installId, account }));
  } else if (provider === 'paypal') {
    ({ url, ref } = await paypalProvider.createCheckout({ secrets, plan, returnUrl, cancelUrl }));
  } else { // cryptomus
    const orderId = `sg-${tenant.id}-${Date.now()}`;
    ({ url, ref } = await cryptomusProvider.createCheckout({ secrets, plan, orderId, returnUrl, callbackUrl: `${publicBaseUrl}/v1/webhooks/cryptomus/${tenant.id}` }));
  }

  await prisma.payment.create({
    data: {
      tenantId: tenant.id, provider, providerRef: ref ? String(ref) : null, amount: plan.amount, currency: plan.currency,
      status: 'pending', account: account ? String(account) : null, plan: plan.key, installId: installId ? String(installId) : null
    }
  });
  res.json({ url, ref, provider });
}));

// Landing page providers redirect back to after pay/cancel.
router.get('/return', (req, res) => {
  const ok = req.query.status === 'success';
  res.set('content-type', 'text/html').send(
    `<!doctype html><html><body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem;background:#0b0b0f;color:#e5e7eb">
       <h2>${ok ? 'Payment received' : 'Checkout canceled'}</h2>
       <p>You can close this window and return to the app${ok ? ' — your plan will activate shortly' : ''}.</p>
     </body></html>`
  );
});

module.exports = router;
