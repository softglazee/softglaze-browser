'use strict';
// Credential fields each payment provider needs, validated on save by POST /v1/tenant/payment-config
// and sealed together (sealJson) at rest.
const PROVIDER_FIELDS = {
  stripe: { required: ['secretKey', 'webhookSecret'], optional: [] },
  paypal: { required: ['clientId', 'clientSecret', 'webhookId'], optional: ['env'] },
  cryptomus: { required: ['merchantId', 'apiKey'], optional: [] },
  // Not a checkout gateway: the Microsoft Entra ID (Azure AD) app that may call the Microsoft Store
  // collection and purchase APIs for this tenant's Store purchases (src/store/msStoreApi.js).
  microsoft_store: { required: ['entraTenantId', 'clientId', 'clientSecret'], optional: [] }
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
  if (provider === 'microsoft_store') {
    const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!guid.test(secrets.entraTenantId)) return { error: 'microsoft_store entraTenantId must be the Directory (tenant) ID, a GUID.' };
    if (!guid.test(secrets.clientId)) return { error: 'microsoft_store clientId must be the Application (client) ID, a GUID.' };
  }
  if (provider === 'paypal') {
    const env = (secrets.env || 'live').toLowerCase();
    if (!PAYPAL_ENVS.includes(env)) return { error: 'paypal env must be "live" or "sandbox".' };
    secrets.env = env;
  }
  return { secrets };
}

module.exports = { PROVIDER_FIELDS, buildProviderSecrets };
