'use strict';
// The sign-in providers this server can run (GET /auth/start?provider=<id>). Each module exports:
//   id                       the provider name in URLs, Identity.provider and the app ('github')
//   configured()             true when its keys are in the environment; otherwise /auth/start answers 503
//   authorizeUrl({ state, codeChallenge, redirectUri, nonce })
//                            where the browser goes; `state` and the S256 `codeChallenge` are this server's own
//                            (src/auth/flow.js), `nonce` is for OpenID Connect providers
//   completeSignIn({ code, codeVerifier, redirectUri, nonce })
//                            -> { providerUserId, email, emailVerified, name, login }, or throws ProviderError
//                            ('email_not_verified' | 'provider_error'). Only a verified email is ever linked.
// Adding Google or Microsoft (next version): a module with the same four members using the OpenID Connect
// authorization code flow with PKCE, sending `nonce` in the authorize request and checking the ID token's
// signature, audience, issuer and nonce in completeSignIn; email_verified must be true (Microsoft personal
// accounts need the extra care noted in the plan). Then add it below, its keys to .env.example and
// docs/DEPLOY.md, and its button in the app. Routes, linking and sessions need no change.
const github = require('./github');

const PROVIDERS = Object.freeze({ [github.id]: github });

function getProvider(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id] : null;
}

// The providers whose keys are set, for the app's first screen (GET /auth/providers).
function availableProviders() {
  return Object.values(PROVIDERS).filter((p) => p.configured()).map((p) => p.id);
}

module.exports = { PROVIDERS, getProvider, availableProviders, ProviderError: github.ProviderError };
