'use strict';
// The sign-in providers this server can run (GET /auth/start?provider=<id>, and the phone and web authorize
// endpoints). Each module exports:
//   id                       the provider name in URLs, Identity.provider and the apps ('github', 'google')
//   configured()             true when its keys are in the environment; otherwise /auth/start answers 503
//   authorizeUrl({ state, codeChallenge, redirectUri, nonce, rerequest })
//                            where the browser goes; `state` and the S256 `codeChallenge` are this server's own
//                            (src/auth/flow.js), `nonce` is the browser nonce (OpenID Connect providers send a
//                            value derived from it and check it in the ID token); `rerequest` (Facebook only)
//                            asks again for a permission the person declined (auth_type=rerequest)
//   completeSignIn({ code, codeVerifier, redirectUri, nonce })
//                            -> { providerUserId, email, emailVerified, name, login }, or throws ProviderError
//                            ('email_not_verified' | 'provider_error'). Only a verified email is ever linked.
//   emailOptional            (Facebook) the profile may come without an email: such a sign-in only works for a
//                            person who already linked this provider id (src/auth/flow.js, error email_missing)
// Google (src/auth/providers/google.js) is OpenID Connect: PKCE + nonce, ID token signature, iss, aud, exp,
// nonce and email_verified checked. Microsoft would follow the same pattern (personal accounts need care with
// email verification). Sign in with Apple is not configured yet: the phone's authorize endpoint answers
// provider_not_configured for it (src/routes/mobileAuth.js). Facebook (src/auth/providers/facebook.js) is the
// Facebook Login code flow with PKCE, appsecret_proof and a Data Deletion Request Callback (src/auth/facebookDeletion.js).
const github = require('./github');
const google = require('./google');
const facebook = require('./facebook');

// The order is the order of the buttons the apps show.
const PROVIDERS = Object.freeze({ [google.id]: google, [facebook.id]: facebook, [github.id]: github });

function getProvider(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id] : null;
}

// The providers whose keys are set, for the apps' first screen (GET /auth/providers).
function availableProviders() {
  return Object.values(PROVIDERS).filter((p) => p.configured()).map((p) => p.id);
}

module.exports = { PROVIDERS, getProvider, availableProviders, ProviderError: github.ProviderError };
