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

// CORS for the web app: only origins in WEB_APP_ORIGINS get the headers. No cookies are used (the tokens travel
// in the Authorization header), so credentials are not allowed.
function webCors(methods) {
  return function cors(req, res, next) {
    res.vary('Origin');
    const origin = req.get('origin');
    if (typeof origin === 'string' && webAppOrigins().includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', methods);
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

module.exports = { PAGE_CSP, sendPage, readCookies, secureCookies, ipHashOf, setNonceCookie, redirectTo, webCors };
