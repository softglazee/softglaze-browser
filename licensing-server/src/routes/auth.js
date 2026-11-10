'use strict';
// One-click sign-in (app 1.0.26). The flow and the security checks are described in src/auth/flow.js.
//
// Browser leg (HTML pages, never JSON):
//   GET /auth/start?provider=github&tenant=<tenantId>&app_redirect=softglaze://auth|http://127.0.0.1:<port>/auth
//       &code_challenge=<S256>&code_challenge_method=S256&state=<app state>  -> 302 to the provider
//   GET /auth/callback/github?code&state  -> the app's redirect with ?code=<one-time code>&state=<app state>,
//       or ?error=cancelled|email_not_verified|disposable_email|failed&state=<app state>
// App calls (JSON, install-authenticated like /v1/account: tenantId, installId, installSecret):
//   GET  /auth/providers?tenantId=..                       -> { providers: ['github'], email: true }
//   POST /auth/exchange { code, codeVerifier, expectCustomerId? } -> the sign-in (below), or 400 invalid_grant,
//        403 email_not_verified, 409 account_mismatch
//   POST /auth/email/start { email, lang?, name?, consentMarketing? }  -> as POST /v1/account/verify/start
//   POST /auth/email/verify { email, code, expectCustomerId? }        -> the sign-in, or the verify/check errors,
//        409 account_mismatch
//   POST /auth/me { session }                -> { signedIn, provider, customer, methods, licence } | 401 session_invalid
//   POST /auth/profile { session, useCase, useCaseOther? }             -> { ok, saved }
//   POST /auth/licence/move { session, move: true }                    -> { ok, moved, remaining } | 404 no_licence,
//        429 move_limit { retryAt }, 409 move_conflict
//   POST /auth/logout { session }            -> { ok: true } always
// A sign-in answers { ok, session, provider, isNew, linked, customer: { id, email, name, useCase }, methods,
// licence: { state: here | elsewhere | store | none, tier?, until?, movesLeft? } }. The session token is shown
// once; only its SHA-256 is stored.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { installRequest } = require('./installRequest');
const { clientIp, ipHash } = require('../net/clientIp');
const { startVerification } = require('../account/verify');
const { getProvider, availableProviders } = require('../auth/providers');
const flow = require('../auth/flow');
const accounts = require('../auth/accounts');
const { renderPage } = require('../auth/pages');

const router = express.Router();

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function sendPage(res, status, key, appUrl) {
  res.status(status)
    .set('Content-Type', 'text/html; charset=utf-8')
    .set('Cache-Control', 'no-store')
    .set('Content-Security-Policy', PAGE_CSP)
    .set('X-Content-Type-Options', 'nosniff')
    .set('Referrer-Policy', 'no-referrer')
    .send(renderPage(key, { appUrl }));
}

function readCookies(req) {
  const out = {};
  const raw = req.headers && req.headers.cookie;
  if (typeof raw !== 'string') return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (!k.startsWith(flow.NONCE_COOKIE_PREFIX)) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { /* skip a bad cookie */ }
  }
  return out;
}

const secureCookies = () => /^https:/i.test(String(require('../env').publicBaseUrl));
const ipHashOf = (req) => { const ip = clientIp(req); return ip ? ipHash(ip) : null; };

router.get('/providers', asyncHandler(async (req, res) => {
  const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
  const tenant = tenantId ? await prisma.tenant.findUnique({ where: { id: tenantId } }) : null;
  if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'unknown_tenant', message: 'Unknown tenant.' });
  res.set('Cache-Control', 'no-store').json({ providers: availableProviders(), email: true });
}));

router.get('/start', asyncHandler(async (req, res) => {
  const r = await flow.startSignIn(prisma, req.query, { ipHash: ipHashOf(req) });
  if (!r.ok) {
    const key = r.error === 'provider_unavailable' ? 'unavailable' : r.error === 'rate_limited' ? 'rate_limited' : 'invalid';
    return sendPage(res, r.status, key);
  }
  // The nonce cookie binds the callback to the browser that started the sign-in. Lax, so the provider's
  // top-level redirect back carries it; HttpOnly, only for the callback path, gone after 10 minutes.
  res.cookie(r.cookie.name, r.cookie.value, {
    httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/auth/callback', maxAge: r.cookie.maxAgeSec * 1000
  });
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').redirect(302, r.location);
}));

router.get('/callback/:provider', asyncHandler(async (req, res) => {
  if (!getProvider(req.params.provider)) return sendPage(res, 404, 'invalid');
  const r = await flow.finishCallback(prisma, req.params.provider, req.query, readCookies(req));
  if (r.kind === 'page') return sendPage(res, r.status, r.page);
  // The used nonce cookie is cleared either way.
  for (const name of Object.keys(readCookies(req))) res.clearCookie(name, { path: '/auth/callback', httpOnly: true, secure: secureCookies(), sameSite: 'lax' });
  // A loopback listener takes a plain redirect; the protocol gets a page with a button too, because the browser
  // may ask before opening the app.
  if (r.redirectKind === 'loopback') return res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').redirect(302, r.url);
  return sendPage(res, 200, r.outcome === 'signed_in' ? 'signed_in' : r.outcome, r.url);
}));

// The JSON routes below authenticate the install first (tenantId, installId, installSecret).
async function withInstall(req, res, fn) {
  const ctx = await installRequest(req, res);
  if (!ctx) return;
  res.set('Cache-Control', 'no-store');
  const { status, body } = await fn(ctx, req.body || {});
  if (body && body.retryAfterSec) res.set('Retry-After', String(body.retryAfterSec));
  res.status(status).json(body);
}

router.post('/exchange', asyncHandler(async (req, res) => withInstall(req, res, (ctx, b) => flow.exchangeCode(prisma, ctx.tenant, ctx.install, b, { ipHash: ctx.ipHash, settings: ctx.settings }))));

router.post('/email/start', asyncHandler(async (req, res) => withInstall(req, res, (ctx, b) => startVerification(prisma, ctx.tenant, ctx.install, {
  email: b.email, name: b.name, lang: b.lang, country: b.country, consentMarketing: b.consentMarketing === true
}, { ipHash: ctx.ipHash, settings: ctx.settings }))));

router.post('/email/verify', asyncHandler(async (req, res) => withInstall(req, res, (ctx, b) => flow.emailSignIn(prisma, ctx.tenant, ctx.install, b, { ipHash: ctx.ipHash, settings: ctx.settings }))));

router.post('/me', asyncHandler(async (req, res) => withInstall(req, res, (ctx, b) => accounts.sessionInfo(prisma, ctx.tenant, ctx.install, b.session))));

router.post('/profile', asyncHandler(async (req, res) => withInstall(req, res, (ctx, b) => accounts.saveProfile(prisma, ctx.tenant, ctx.install, b.session, { useCase: b.useCase, useCaseOther: b.useCaseOther }))));

router.post('/licence/move', asyncHandler(async (req, res) => withInstall(req, res, (ctx, b) => accounts.moveLicence(prisma, ctx.tenant, ctx.install, b.session, { move: b.move, settings: ctx.settings }))));

router.post('/logout', asyncHandler(async (req, res) => withInstall(req, res, (ctx, b) => accounts.logout(prisma, ctx.tenant, ctx.install, b.session))));

module.exports = router;
