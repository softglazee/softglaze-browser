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

// Asks the server to email a code. consentMarketing is true only when the box was ticked. lead: the
// checked lead details from signupLead.normalizeLead ({ phone, useCase, useCaseOther, company }); only
// the filled ones are sent, and the server stores them on the customer once the code is proven.
async function startVerification({ ensureInstall, api, email, name, consentMarketing, lang, lead = null, context = 'signup' }) {
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
      lang: normalizeLang(lang),
      ...leadFields(lead)
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

// The filled lead fields only (an empty one is not sent at all).
function leadFields(lead) {
  const out = {};
  if (!lead || typeof lead !== 'object') return out;
  for (const k of ['phone', 'useCase', 'useCaseOther', 'company']) {
    if (typeof lead[k] === 'string' && lead[k]) out[k] = lead[k];
  }
  return out;
}

// Asks the server whether this install has a customer whose email it verified (signupConfirm.js).
// Resolves { verified: boolean, email } or throws whatever the call threw (the caller treats any
// failure as "could not ask"). An answer without a boolean `verified` counts as a failure too.
async function accountStatus({ ensureInstall, api }) {
  const install = await ensureInstall();
  if (!install || !install.installId || !install.installSecret) throw coded('SERVER_UNAVAILABLE');
  const res = await api.accountStatus({ installId: install.installId, installSecret: install.installSecret });
  if (!res || typeof res.verified !== 'boolean') throw coded('SERVER_UNAVAILABLE');
  return { verified: res.verified, email: typeof res.email === 'string' ? res.email : null, installId: install.installId };
}

module.exports = { EMAIL_RE, normalizeEmail, normalizeLang, installFor, leadFields, startVerification, checkVerification, accountStatus };
