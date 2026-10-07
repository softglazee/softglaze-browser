'use strict';
// Audit L7: the credential fields each payment provider needs, validated on save by
// POST /v1/tenant/payment-config and sealed together (sealJson) at rest. Pure.
const PROVIDER_FIELDS = {
  stripe: { required: ['secretKey', 'webhookSecret'], optional: [] },
  paypal: { required: ['clientId', 'clientSecret', 'webhookId'], optional: ['env'] },
  cryptomus: { required: ['merchantId', 'apiKey'], optional: [] }
};
const PAYPAL_ENVS = ['live', 'sandbox'];

// -> { secrets } or { error }. Unknown keys are dropped; every required key must be a
// non-empty string (an empty verification key would make a webhook forgeable).
function buildProviderSecrets(provider, body) {
  const spec = PROVIDER_FIELDS[provider];
  if (!spec) return { error: 'Unknown provider.' };
  const b = body || {};
  const val = (k) => (typeof b[k] === 'string' ? b[k].trim() : '');
  const missing = spec.required.filter((k) => !val(k));
  if (missing.length) return { error: `Missing required ${provider} field(s): ${missing.join(', ')}.` };
  const secrets = {};
  for (const k of spec.required) secrets[k] = val(k);
  for (const k of spec.optional) if (val(k)) secrets[k] = val(k);
  if (provider === 'paypal') {
    const env = (secrets.env || 'live').toLowerCase();
    if (!PAYPAL_ENVS.includes(env)) return { error: 'paypal env must be "live" or "sandbox".' };
    secrets.env = env;
  }
  return { secrets };
}

module.exports = { PROVIDER_FIELDS, buildProviderSecrets };
