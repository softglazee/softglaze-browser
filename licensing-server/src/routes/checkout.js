'use strict';
// POST /v1/checkout { tenantId, planKey, installId?, account?, provider='stripe' } -> { url, ref }
// Uses the tenant's own sealed provider keys and records a pending Payment for the webhook to claim.
// GET /v1/checkout/methods?tenantId=... (no auth) -> { providers: [{ id, label, kind }], store: { salesEnabled } }:
// the payment methods the app offers (src/providers/checkoutProviders.js). CORS open, cached 60 s.
// Website checkout (browser.softglaze.com/buy): POST /v1/checkout WITHOUT installId, with the buyer's
// email in `account` and provider 'stripe' (one-time Prices only) or 'safepay'. The provider sends the
// buyer back to the website (SITE_BASE_URL/buy/thanks), whose page asks GET /v1/checkout/status?tenantId
// &session=cs_... (Stripe) or &tracker=track_... (Safepay) -> { status: 'paid' | 'pending' | 'unknown' }
// (never the code or the email). The paid Payment gets an activation
// code by email instead of a licence (src/webPurchase.js). CORS: the website origin (and localhost).
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { openJson } = require('../crypto/secrets');
const { publicBaseUrl } = require('../env');
const stripeProvider = require('../providers/stripe');
const paypalProvider = require('../providers/paypal');
const cryptomusProvider = require('../providers/cryptomus');
const safepayProvider = require('../providers/safepay');
const { verifySafepayTracker } = require('../safepayVerify');
const { CHECKOUT_IDS, publicCheckoutMethods } = require('../providers/checkoutProviders');
const { getSettings } = require('../settings');
const { parseEmail } = require('../customers/emailAddress');
const { isDisposableDomain } = require('../customers/disposable');
const { rateLimit } = require('../middleware/rateLimit');
const { WEB_METHOD, isWebPayment, kickCodeEmail } = require('../webPurchase');
const { isPurchasable } = require('../plans/service');
const { saleBlock, invalidateOffers, isLifetime } = require('../plans/sales');
const lifetimeGuard = require('../plans/lifetimeGuard');
const { provisionFromPaymentRef } = require('../licensing');
const { handleOnce } = require('../webhookOnce');

const router = express.Router();
const SUPPORTED = new Set(CHECKOUT_IDS);
const WEB_PROVIDERS = new Set(['stripe', 'safepay']);

// The website that sells without the app. Its origin (and a local dev server) may call the checkout
// and status endpoints from the browser; other origins get no CORS headers (the app is not a browser).
const SITE_BASE_URL = String(process.env.SITE_BASE_URL || 'https://browser.softglaze.com').replace(/\/+$/, '');
const SITE_ORIGIN = (() => { try { return new URL(SITE_BASE_URL).origin; } catch (_) { return 'https://browser.softglaze.com'; } })();
const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const siteOriginAllowed = (o) => typeof o === 'string' && (o === SITE_ORIGIN || LOCAL_ORIGIN_RE.test(o));
function siteCors(req, res, methods) {
  const origin = req.get('origin');
  res.vary('Origin');
  if (!siteOriginAllowed(origin)) return false;
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Access-Control-Allow-Methods', methods);
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '600');
  return true;
}
// A website checkout creates a Safepay tracker per request: a tighter per-IP limit than the app's.
const webCheckoutLimiter = rateLimit({ windowMs: 60000, max: Number(process.env.WEB_CHECKOUT_RATE_PER_MIN) || 10 });

// Public and read-only: no secrets, only which methods are switched on and their names.
router.options('/methods', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.status(204).end();
});
router.get('/methods', asyncHandler(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
  if (!tenantId || tenantId.length > 64) return res.status(400).json({ error: 'bad_request', message: 'tenantId is required.' });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'unknown_tenant', message: 'Unknown tenant.' });
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await publicCheckoutMethods(prisma, tenant.id, await getSettings(prisma, tenant.id)));
}));

router.options('/', (req, res) => {
  siteCors(req, res, 'POST, OPTIONS');
  res.status(204).end();
});

// No installId = a website purchase: rate limited here, before anything is created.
function webCheckoutGate(req, res, next) {
  siteCors(req, res, 'POST, OPTIONS');
  const b = req.body || {};
  if (b.installId) return next();
  return webCheckoutLimiter(req, res, next);
}

router.post('/', webCheckoutGate, asyncHandler(async (req, res) => {
  const { tenantId, planKey, installId } = req.body || {};
  let { account } = req.body || {};
  const provider = String((req.body && req.body.provider) || 'stripe').toLowerCase();
  if (!tenantId || !planKey) return res.status(400).json({ error: 'tenantId and planKey are required.' });
  if (!SUPPORTED.has(provider)) return res.status(400).json({ error: `Unsupported provider "${provider}".` });
  const web = !installId;
  let webEmail = null;
  if (web) {
    // Website checkout: card payments (Safepay) only, and the activation code goes to this email.
    if (!WEB_PROVIDERS.has(provider)) return res.status(400).json({ error: 'install_required', message: 'This payment method is only available in the app.' });
    webEmail = parseEmail(typeof account === 'string' ? account : '');
    if (!webEmail) return res.status(400).json({ error: 'invalid_email', message: 'Enter a valid email address. Your activation code is sent there.' });
    account = webEmail.email;
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Unknown tenant.' });

  const plan = await prisma.plan.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: String(planKey) } } });
  if (!plan || !plan.active) return res.status(404).json({ error: 'Unknown or inactive plan.' });
  // The Free plan (or any US$0 plan) is never sold: there is nothing to pay and no licence to grant.
  if (!isPurchasable(plan)) return res.status(409).json({ error: 'plan_not_purchasable', message: 'This plan is free and cannot be bought.' });
  // Lifetime guard: an install with a lifetime licence buys nothing but a higher-tier lifetime plan.
  // 409 lifetime_active before any provider call or Payment row (src/plans/lifetimeGuard.js).
  if (installId) {
    const life = await lifetimeGuard.findLifetimeLicence(prisma, tenant.id, installId);
    if (life && !lifetimeGuard.allowedOnLifetime(life, { tier: plan.tier, lifetime: isLifetime(plan) })) {
      return res.status(409).json(lifetimeGuard.blockedBody(life, 'checkout'));
    }
  }
  // Sale window and cap (lifetime offers): 409 sale_not_open | sale_ended | sold_out (src/plans/sales.js).
  const blocked = await saleBlock(prisma, tenant.id, plan);
  if (blocked) return res.status(409).json({ error: blocked.error, message: blocked.message, remaining: blocked.availability.remaining });
  if (web) {
    // A code is a fixed term; a subscription needs an install to renew.
    if (plan.recurring) return res.status(400).json({ error: 'install_required', message: 'This plan can only be bought in the app.' });
    const em = (await getSettings(prisma, tenant.id)).email;
    if (isDisposableDomain(webEmail.domain, { allow: em.domainAllowlist, block: em.domainBlocklist })) {
      return res.status(400).json({ error: 'disposable_email', message: 'Please use a permanent email address, not a temporary one.' });
    }
  }

  const cfg = await prisma.tenantPaymentConfig.findUnique({ where: { tenantId_provider: { tenantId: tenant.id, provider } } });
  if (!cfg || !cfg.enabled) return res.status(400).json({ error: `${provider} is not enabled for this tenant.` });
  const secrets = openJson(cfg.secretsSealed);

  const returnUrl = `${publicBaseUrl}/v1/checkout/return?status=success`;
  const cancelUrl = `${publicBaseUrl}/v1/checkout/return?status=cancel`;

  let url; let ref;
  if (provider === 'stripe') {
    const lookupKeys = (await getSettings(prisma, tenant.id)).checkout.stripeLookupKeys;
    try {
      ({ url, ref } = await stripeProvider.createCheckout({
        secretKey: secrets.secretKey, tenantId: tenant.id, plan, installId, account, web, siteBaseUrl: SITE_BASE_URL, lookupKeys
      }));
    } catch (e) {
      if (!(e instanceof stripeProvider.StripeCheckoutError)) throw e;
      if (e.code === 'install_required') return res.status(e.status).json({ error: e.code, message: e.message });
      // A missing or mismatched Stripe Price is a set-up fault: logged for the owner, plain words for the buyer.
      console.error(`[checkout:stripe] ${e.code}: ${e.message}`);
      return res.status(e.status).json({ error: e.code, message: 'Card checkout is not available for this plan right now. Please contact support.' });
    }
  } else if (provider === 'paypal') {
    ({ url, ref } = await paypalProvider.createCheckout({ secrets, plan, returnUrl, cancelUrl }));
  } else if (provider === 'safepay') {
    // ref = the tracker (one-time) or this checkout's Safepay plan token (recurring); see providers/safepay.js.
    const orderId = `sg-${tenant.id}-${Date.now()}`;
    // Safepay appends "?order_id=...&tracker=..." to the return URL even when it already has a query
    // string, so its return URLs carry the status in the path instead.
    // A website checkout returns to the website: its thanks page asks /status; a cancel lands on /buy
    // (Safepay may glue "?order_id=..." onto "cancelled=1"; the page only checks that the key is there).
    ({ url, ref } = await safepayProvider.createCheckout({
      secrets, plan, orderId,
      returnUrl: web ? `${SITE_BASE_URL}/buy/thanks` : `${publicBaseUrl}/v1/checkout/return/success`,
      cancelUrl: web ? `${SITE_BASE_URL}/buy?cancelled=1` : `${publicBaseUrl}/v1/checkout/return/cancel`
    }));
  } else { // cryptomus
    const orderId = `sg-${tenant.id}-${Date.now()}`;
    ({ url, ref } = await cryptomusProvider.createCheckout({ secrets, plan, orderId, returnUrl, callbackUrl: `${publicBaseUrl}/v1/webhooks/cryptomus/${tenant.id}` }));
  }

  await prisma.payment.create({
    data: {
      tenantId: tenant.id, provider, providerRef: ref ? String(ref) : null, amount: plan.amount, currency: plan.currency,
      status: 'pending', account: account ? String(account) : null, plan: plan.key, installId: installId ? String(installId) : null,
      ...(web ? { method: WEB_METHOD } : {})
    }
  });
  invalidateOffers(tenant.id); // the pending payment now holds a place in a capped offer
  res.json({ url, ref, provider });
}));

// A website Stripe purchase, by its Checkout Session id (GET /status?session=cs_...). The webhook
// provisions it; while the Payment is still pending, Stripe is asked whether the session is paid, and a
// paid one is provisioned the way the webhook does it. Both claim the pending Payment, so only one of
// them ever issues the activation code.
async function stripeWebStatus(tenantId, sessionId) {
  if (!stripeProvider.isSessionId(sessionId)) return 'unknown';
  const find = () => prisma.payment.findFirst({ where: { tenantId, provider: 'stripe', providerRef: sessionId }, orderBy: { createdAt: 'desc' } });
  let payment = await find();
  if (!payment || !isWebPayment(payment)) return 'unknown';
  if (payment.status === 'pending') {
    try {
      const cfg = await prisma.tenantPaymentConfig.findUnique({ where: { tenantId_provider: { tenantId, provider: 'stripe' } } });
      const s = cfg ? await stripeProvider.retrieveSession({ secretKey: openJson(cfg.secretsSealed).secretKey, sessionId }) : null;
      if (s && s.status === 'complete' && s.payment_status === 'paid') {
        const md = s.metadata || {};
        await handleOnce(tenantId, 'stripe', `verify:${sessionId}`, 'checkout.session.verified', async () => (tx) => provisionFromPaymentRef({ id: tenantId }, 'stripe', sessionId, {
          account: md.account || null, planKey: md.planKey || null, tier: md.tier, months: Number(md.months) || undefined
        }, tx));
      }
    } catch (e) {
      console.warn('[checkout:status] Stripe check failed:', e && e.message ? e.message : e);
    }
    payment = await find();
  }
  // Settled: make sure its activation email is not waiting for the next cron run.
  if (payment && payment.status === 'paid') kickCodeEmail(prisma, tenantId, payment.id).catch(() => {});
  return payment && payment.status === 'paid' ? 'paid' : payment && payment.status === 'pending' ? 'pending' : 'unknown';
}

// GET /v1/checkout/status?tenantId=...&tracker=track_... (no auth): the website's thanks page. A pending
// website payment is checked with Safepay first (same check as the return page and the cron). Answers
// only { status: 'paid' | 'pending' | 'unknown' }: never the code, the email or the amount.
const STATUS_VERIFY_WAIT_MS = 8000;
router.options('/status', (req, res) => {
  siteCors(req, res, 'GET, OPTIONS');
  res.status(204).end();
});
router.get('/status', asyncHandler(async (req, res) => {
  siteCors(req, res, 'GET, OPTIONS');
  res.set('Cache-Control', 'no-store');
  const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
  if (!tenantId || tenantId.length > 64) return res.json({ status: 'unknown' });
  const session = typeof req.query.session === 'string' ? req.query.session.trim() : '';
  if (session) return res.json({ status: await stripeWebStatus(tenantId, session) });
  const tracker = typeof req.query.tracker === 'string' ? req.query.tracker.trim() : '';
  if (!safepayProvider.isTrackerToken(tracker)) return res.json({ status: 'unknown' });
  const find = () => prisma.payment.findFirst({ where: { tenantId, provider: 'safepay', providerRef: tracker }, orderBy: { createdAt: 'desc' } });
  let payment = await find();
  if (!payment || !isWebPayment(payment)) return res.json({ status: 'unknown' });
  if (payment.status === 'pending') {
    let timer;
    try {
      await Promise.race([
        verifySafepayTracker(tracker, { tenantId }),
        new Promise((resolve) => { timer = setTimeout(resolve, STATUS_VERIFY_WAIT_MS); })
      ]);
    } catch (e) {
      console.warn('[checkout:status] Safepay verification failed:', e && e.message ? e.message : e);
    } finally { clearTimeout(timer); }
    payment = await find();
  } else if (payment.status === 'paid') {
    // Settled by a webhook: make sure its activation email is not waiting for the next cron run.
    kickCodeEmail(prisma, tenantId, payment.id).catch(() => {});
  }
  const status = payment && payment.status === 'paid' ? 'paid' : payment && payment.status === 'pending' ? 'pending' : 'unknown';
  res.json({ status });
}));

// Landing page providers redirect back to after pay/cancel: /return?status=success|cancel (Stripe,
// PayPal, Cryptomus) or /return/success|cancel (Safepay). A status that merely starts with "success"
// counts, for a provider that glued its own "?..." onto ours. On success with a Safepay tracker, the
// server asks Safepay's API whether that pending payment is complete and provisions it if so; the
// query string alone never grants anything.
const VERIFY_WAIT_MS = 10000;

async function verifyOnReturn(req) {
  const tracker = typeof req.query.tracker === 'string' ? req.query.tracker.trim() : '';
  if (!safepayProvider.isTrackerToken(tracker)) return;
  let timer;
  try {
    await Promise.race([
      verifySafepayTracker(tracker),
      new Promise((resolve) => { timer = setTimeout(resolve, VERIFY_WAIT_MS); })
    ]);
  } catch (e) {
    console.warn('[checkout:return] Safepay verification failed:', e && e.message ? e.message : e);
  } finally { clearTimeout(timer); }
}

function returnPage(res, ok) {
  res.set('content-type', 'text/html').set('Cache-Control', 'no-store').send(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${ok ? 'Payment received' : 'Checkout canceled'}</title></head>
     <body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem 1rem;background:#0b0b0f;color:#e5e7eb">
       <h2>${ok ? 'Payment received' : 'Checkout canceled'}</h2>
       <p>${ok ? 'Your plan will be active in a moment; you can close this window and return to the app.' : 'No payment was taken. You can close this window and return to the app.'}</p>
     </body></html>`
  );
}

async function handleReturn(req, res, ok) {
  if (ok) await verifyOnReturn(req);
  returnPage(res, ok);
}

router.get('/return', asyncHandler(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  await handleReturn(req, res, status.startsWith('success'));
}));
router.get('/return/success', asyncHandler(async (req, res) => handleReturn(req, res, true)));
router.get('/return/cancel', asyncHandler(async (req, res) => handleReturn(req, res, false)));

module.exports = router;
