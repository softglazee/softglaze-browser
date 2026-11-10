'use strict';
// The browser leg of one-click sign-in (1.0.26), one at a time: make PKCE and a state, open our server's start
// page in the SYSTEM browser (never an embedded window), and wait for the one-time code to come back through
// softglaze://auth (the registered protocol, delivered by main.js) or, when the protocol is not available or the
// person asks for "another way", the one-shot loopback listener. A result is accepted only for the pending
// sign-in's own state. Resolves { provider, code, codeVerifier }; the code is then traded with the server
// (POST /auth/exchange) by oneClickSignIn.js. Dependencies are passed in, so tests drive it without Electron.
const { PROTOCOL_REDIRECT, newPkce, newState, sameState, startUrl, parseProtocolUrl } = require('./oneClickAuth');

const TIMEOUT_MS = 10 * 60000; // the server's own limit for the browser leg

const ERRORS = Object.freeze({
  cancelled: 'SIGNIN_CANCELLED',
  email_not_verified: 'SIGNIN_EMAIL_NOT_VERIFIED',
  disposable_email: 'SIGNIN_DISPOSABLE_EMAIL',
  failed: 'SIGNIN_FAILED'
});
const MESSAGES = Object.freeze({
  SIGNIN_CANCELLED: 'Sign-in was cancelled.',
  SIGNIN_TIMEOUT: 'The sign-in took too long. Try again.',
  SIGNIN_EMAIL_NOT_VERIFIED: 'Your GitHub account has no verified primary email. Verify it on GitHub, or continue with email.',
  SIGNIN_DISPOSABLE_EMAIL: 'Please use a permanent email address.',
  SIGNIN_FAILED: "The sign-in didn't finish. Try again in a minute."
});

function coded(code) {
  return Object.assign(new Error(MESSAGES[code] || code), { code });
}

// deps: { tenantConfig: () => ({ apiBaseUrl, tenantId }), openExternal(url), startLoopback(opts),
//         protocolReady: () => boolean, timeoutMs? }
function createSignInFlow(deps) {
  const timeoutMs = Number(deps.timeoutMs) || TIMEOUT_MS;
  let pending = null;

  function end(p) {
    if (pending === p) pending = null;
    if (p.timer) clearTimeout(p.timer);
    if (p.loop) { try { p.loop.close(); } catch (_) { /* already closed */ } }
  }

  function deliver(result) {
    const p = pending;
    if (!p || !result || !sameState(result.state, p.state)) return false;
    end(p);
    if (result.error) p.reject(coded(ERRORS[result.error] || 'SIGNIN_FAILED'));
    else p.resolve({ provider: p.provider, code: result.code, codeVerifier: p.verifier });
    return true;
  }

  // mode: 'auto' (the protocol when it is registered, else loopback) or 'loopback' ("Try another way").
  async function begin(provider, { mode = 'auto' } = {}) {
    cancel();
    const cfg = deps.tenantConfig();
    const { verifier, challenge } = newPkce();
    const state = newState();
    let loop = null;
    let redirect = PROTOCOL_REDIRECT;
    if (mode === 'loopback' || !deps.protocolReady()) {
      loop = await deps.startLoopback({ expectState: state, timeoutMs });
      redirect = loop.redirectUri;
    }
    const url = startUrl({ apiBaseUrl: cfg.apiBaseUrl, tenantId: cfg.tenantId, provider, appRedirect: redirect, codeChallenge: challenge, state });
    const p = { provider, state, verifier, loop, timer: null, via: loop ? 'loopback' : 'protocol' };
    const done = new Promise((resolve, reject) => { p.resolve = resolve; p.reject = reject; });
    p.timer = setTimeout(() => { if (pending === p) { end(p); p.reject(coded('SIGNIN_TIMEOUT')); } }, timeoutMs);
    if (p.timer.unref) p.timer.unref();
    pending = p;
    if (loop) loop.result.then((r) => deliver(r), () => {});
    try {
      await deps.openExternal(url);
    } catch (e) {
      end(p);
      throw coded('SIGNIN_FAILED');
    }
    return done;
  }

  // A softglaze:// URL from the operating system. -> true when it finished the pending sign-in.
  function handleProtocolUrl(raw) {
    const r = parseProtocolUrl(raw);
    return r ? deliver(r) : false;
  }

  function cancel() {
    const p = pending;
    if (!p) return false;
    end(p);
    p.reject(coded('SIGNIN_CANCELLED'));
    return true;
  }

  return { begin, handleProtocolUrl, cancel, isPending: () => Boolean(pending), via: () => (pending ? pending.via : null) };
}

module.exports = { createSignInFlow, MESSAGES, TIMEOUT_MS, coded };
