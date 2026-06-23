'use strict';
// SoftGlaze licensing server — Express bootstrap.
// IMPORTANT: the webhook router is mounted BEFORE express.json() because Stripe
// signature verification needs the raw request body.
const express = require('express');
const { port } = require('./env');

const app = express();
app.disable('x-powered-by');

app.get('/health', (req, res) => res.json({ ok: true, service: 'softglaze-licensing', time: new Date().toISOString() }));

// Raw-body webhooks first (signature verification).
app.use('/v1/webhooks', require('./routes/webhooks'));

// JSON parser for the rest.
app.use(express.json({ limit: '256kb' }));

app.use('/v1/register', require('./routes/register'));
app.use('/v1/checkout', require('./routes/checkout'));
app.use('/v1/license', require('./routes/license'));
app.use('/v1/redeem', require('./routes/redeem'));
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
