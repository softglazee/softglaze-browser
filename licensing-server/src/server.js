'use strict';
// SoftGlaze licensing server — Express bootstrap.
// IMPORTANT: the webhook router is mounted BEFORE express.json() because Stripe
// signature verification needs the raw request body.
const express = require('express');
const { port } = require('./env');
const { rateLimit } = require('./middleware/rateLimit');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // honor X-Forwarded-For behind a reverse proxy (req.ip)

app.get('/health', (req, res) => res.json({ ok: true, service: 'softglaze-licensing', time: new Date().toISOString() }));

// Raw-body webhooks first (signature verification) — providers may burst, so not
// rate-limited here; authenticity is enforced by per-tenant signature checks.
app.use('/v1/webhooks', require('./routes/webhooks'));

// JSON parser for the rest.
app.use(express.json({ limit: '256kb' }));

// Basic abuse protection on the public, unauthenticated endpoints.
const publicLimiter = rateLimit({ windowMs: 60000, max: 120 });
app.use('/v1/register', publicLimiter, require('./routes/register'));
app.use('/v1/checkout', publicLimiter, require('./routes/checkout'));
app.use('/v1/license', publicLimiter, require('./routes/license'));
app.use('/v1/redeem', publicLimiter, require('./routes/redeem'));
app.use('/v1/tenant', require('./routes/tenantAdmin'));

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[licensing-server]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'Internal server error.' });
});

if (require.main === module) {
  app.listen(port, () => console.log(`SoftGlaze licensing server listening on :${port}`));
}

module.exports = app;
