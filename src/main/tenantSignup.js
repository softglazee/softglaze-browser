'use strict';
// Sign-up in tenant (sellable) builds: our licensing server emails the 6-digit code from its own
// address and checks it (spec A2), so a disposable or undeliverable address cannot open an account
// and the code is never shown in the app. Base builds keep the local flow in ipcHandlers.js.
// Dependencies are passed in, so tests run it against fakes.
const { coded, mapServerError } = require('./serverErrors');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LANGS = ['en', 'es'];

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function normalizeLang(lang) { const l = String(lang || '').slice(0, 2).toLowerCase(); return LANGS.includes(l) ? l : 'en'; }

// The registered install ({ installId, installSecret }) the server ties the email to.
async function installFor(ensureInstall, context) {
  let install;
  try { install = await ensureInstall(); } catch (e) { throw mapServerError(e, context); }
  if (!install || !install.installId || !install.installSecret) throw coded('SERVER_UNAVAILABLE');
  return install;
}

// Asks the server to email a code. consentMarketing is true only when the box was ticked.
async function startVerification({ ensureInstall, api, email, name, consentMarketing, lang, context = 'signup' }) {
  const addr = normalizeEmail(email);
  if (!EMAIL_RE.test(addr)) throw coded('SIGNUP_INVALID_EMAIL');
  const install = await installFor(ensureInstall, context);
  try {
    await api.verifyStart({
      installId: install.installId,
      installSecret: install.installSecret,
      email: addr,
      name: String(name || '').trim().slice(0, 120) || undefined,
      consentMarketing: consentMarketing === true,
      lang: normalizeLang(lang)
    });
  } catch (e) { throw mapServerError(e, context); }
  // Never a devCode: in tenant builds the code only travels by email.
  return { sent: true, devMode: false, via: 'server' };
}

// Checks the code with the server. Resolves { verified: true, customerId } or throws a mapped error.
async function checkVerification({ ensureInstall, api, email, code, context = 'signupCheck' }) {
  const addr = normalizeEmail(email);
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) throw coded('SIGNUP_BAD_CODE');
  const install = await installFor(ensureInstall, context);
  let res;
  try {
    res = await api.verifyCheck({ installId: install.installId, installSecret: install.installSecret, email: addr, code: c });
  } catch (e) { throw mapServerError(e, context); }
  if (!res || res.verified !== true) throw coded('SIGNUP_BAD_CODE');
  return { verified: true, customerId: res.customerId ? String(res.customerId) : null };
}

module.exports = { EMAIL_RE, normalizeEmail, normalizeLang, installFor, startVerification, checkVerification };
