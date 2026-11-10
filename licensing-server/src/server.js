'use strict';
// The webhook router is mounted before express.json() because Stripe signature verification needs
// the raw request body; the admin API has its own larger JSON limit (CSV imports).
const express = require('express');
const { port } = require('./env');
const { rateLimit } = require('./middleware/rateLimit');
const { trustHops } = require('./net/clientIp');

const app = express();
app.disable('x-powered-by');
// req.ip = the address TRUST_PROXY_HOPS steps from the app (socket, then X-Forwarded-For right to
// left), re-read live from config/.env. Default 1: the rightmost entry, added by the host's proxy.
app.set('trust proxy', (addr, i) => i < trustHops());

app.get('/health', (req, res) => res.json({ ok: true, service: 'softglaze-licensing', time: new Date().toISOString() }));

// Raw-body webhooks first (signature verification) — providers may burst, so not
// rate-limited here; authenticity is enforced by per-tenant signature checks.
app.use('/v1/webhooks', require('./routes/webhooks'));

// Admin API (server-to-server from the website admin; Bearer admin key).
app.use('/v1/admin', rateLimit({ windowMs: 60000, max: 600 }), require('./admin'));

app.use(express.json({ limit: '256kb' }));

// Basic abuse protection on the public, unauthenticated endpoints.
// Per client IP per minute; VERIFY_RATE_PER_MIN covers /v1/account (codes) and /v1/trial.
const publicLimiter = rateLimit({ windowMs: 60000, max: Number(process.env.PUBLIC_RATE_PER_MIN) || 120 });
const verifyLimiter = rateLimit({ windowMs: 60000, max: Number(process.env.VERIFY_RATE_PER_MIN) || 20 });
app.use('/v1/register', publicLimiter, require('./routes/register'));
app.use('/v1/checkout', publicLimiter, require('./routes/checkout'));
app.use('/v1/license', publicLimiter, require('./routes/license'));
app.use('/v1/redeem', publicLimiter, require('./routes/redeem'));
// Asked on every app start, so it has the general limit, not the code-sending one below.
app.use('/v1/account/status', publicLimiter, require('./routes/accountStatus'));
app.use('/v1/account', verifyLimiter, require('./routes/account'));
app.use('/v1/trial', verifyLimiter, require('./routes/trial'));
app.use('/v1/plans', publicLimiter, require('./routes/plansPublic'));
app.use('/v1/store', publicLimiter, require('./routes/store'));
app.use('/v1/email', publicLimiter, require('./routes/emailPublic'));
app.use('/v1/tenant', require('./routes/tenantAdmin'));
// One-click sign-in (app 1.0.26): the browser pages and the app's calls, per client IP per minute.
const authLimiter = rateLimit({ windowMs: 60000, max: Number(process.env.AUTH_RATE_PER_MIN) || 30 });
app.use('/auth', authLimiter, require('./routes/auth'));

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'The request body is too large.' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'The request body is not valid JSON.' });
  console.error('[licensing-server]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'Internal server error.' });
});

if (require.main === module) {
  app.listen(port, () => console.log(`SoftGlaze licensing server listening on :${port}`));
}

module.exports = app;
