'use strict';
// HTTP pieces shared by the sign-in routes (desktop /auth, phone /v1/mobile, web /v1/web/auth, /v1/account):
// the browser pages, the nonce cookie, cookie reading, the client IP hash and CORS for the web app origins.
const { renderPage } = require('../auth/pages');
const { NONCE_COOKIE_PREFIX } = require('../auth/flow');
const { webAppOrigins } = require('../auth/tokens');
const { clientIp, ipHash } = require('../net/clientIp');

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
    if (!k.startsWith(NONCE_COOKIE_PREFIX)) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { /* skip a bad cookie */ }
  }
  return out;
}

const secureCookies = () => /^https:/i.test(String(require('../env').publicBaseUrl));
const ipHashOf = (req) => { const ip = clientIp(req); return ip ? ipHash(ip) : null; };

// The nonce cookie binds the callback to the browser that started the sign-in. Lax, so the provider's
// top-level redirect back carries it; HttpOnly, only for the callback path, gone after 10 minutes.
function setNonceCookie(res, cookie) {
  res.cookie(cookie.name, cookie.value, {
    httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/auth/callback', maxAge: cookie.maxAgeSec * 1000
  });
}

function redirectTo(res, url) {
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').redirect(302, url);
}

// CORS for the web app: only origins in WEB_APP_ORIGINS get the headers. The account API uses no cookies (the
// access token travels in the Authorization header). The web sign-in routes (/v1/web/auth) pass
// { credentials: true }: the web refresh token lives in an HttpOnly cookie there (WEB_REFRESH_COOKIE below).
function webCors(methods, { credentials = false } = {}) {
  return function cors(req, res, next) {
    res.vary('Origin');
    const origin = req.get('origin');
    if (typeof origin === 'string' && webAppOrigins().includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', methods);
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Max-Age', '600');
      if (credentials) res.set('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

// The web app's refresh token: an HttpOnly cookie, so page script (and an XSS bug) can never read it.
// SameSite=Strict (app.softglaze.com and api.softglaze.com are the same site), Path = the token route only, so
// the browser sends it with nothing else. Secure whenever PUBLIC_BASE_URL is https.
const WEB_REFRESH_COOKIE = 'sg_web_rt';
const WEB_REFRESH_PATH = '/v1/web/auth/token';

function setWebRefreshCookie(res, token, expiresAtMs) {
  res.cookie(WEB_REFRESH_COOKIE, token, {
    httpOnly: true, secure: secureCookies(), sameSite: 'strict', path: WEB_REFRESH_PATH,
    maxAge: Math.max(0, expiresAtMs - Date.now())
  });
}

function clearWebRefreshCookie(res) {
  res.clearCookie(WEB_REFRESH_COOKIE, { httpOnly: true, secure: secureCookies(), sameSite: 'strict', path: WEB_REFRESH_PATH });
}

function readWebRefreshCookie(req) {
  const raw = req.headers && req.headers.cookie;
  if (typeof raw !== 'string') return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === WEB_REFRESH_COOKIE) return part.slice(i + 1).trim() || null;
  }
  return null;
}

module.exports = {
  PAGE_CSP, sendPage, readCookies, secureCookies, ipHashOf, setNonceCookie, redirectTo, webCors,
  WEB_REFRESH_COOKIE, WEB_REFRESH_PATH, setWebRefreshCookie, clearWebRefreshCookie, readWebRefreshCookie
};
