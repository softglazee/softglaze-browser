'use strict';
// Meta's Data Deletion Request Callback for "Continue with Facebook" (docs/FACEBOOK-SIGNIN.md):
//
//   POST /auth/facebook/data-deletion   (form body signed_request=<sig>.<payload>, sent by Meta when a person
//        removes the SoftGlaze app in their Facebook settings and asks for their data to be deleted)
//        -> 200 { url, confirmation_code } | 400 { error: 'invalid_signed_request' } | 503 when Facebook is not set up
//   GET  /auth/facebook/deletion-status?code=<confirmation_code>   -> an HTML status page
//
// What is deleted (our privacy rule: the Facebook link is removed, the SoftGlaze account is not):
//   - every Identity row with provider 'facebook' and that app-scoped Facebook user id, in every tenant (the
//     Facebook id, and the email and name Facebook gave with it on that row);
//   - every session (desktop, phone, web) that was signed in through one of those identities is ended, and a phone
//     tied to such a session is signed out.
// What stays: the SoftGlaze customer account itself (its email address, licences, payments, invoices and trial
// records). Those are our own records of a purchase or a trial, kept under the privacy policy and the tax rules,
// and the same account may also be used with Google, GitHub or email. The person can delete the whole account
// from Settings > Account (or ask support), as for any account. A `facebook_data_deleted` event without the
// Facebook id is added to the customer's history.
// One-time sign-in codes that carry a Facebook profile live 60 seconds and are removed by retention.
//
// The deletion runs before the answer, so a confirmation code means "done". The code is stateless: base36 time
// (9 characters) + number of identities removed (1 digit) + 20 hex characters of HMAC (MASTER_KEY sub-key), so the
// status page can prove it was ours without storing anything about the person.
const { publicBaseUrl } = require('../env');
const { hmacHex, safeEqual } = require('../crypto/derive');
const { addEvent } = require('../customers/sync');
const { revokeSession } = require('./sessions');
const facebook = require('./providers/facebook');

const CODE_RE = /^[0-9a-z]{9}[0-9][0-9a-f]{20}$/;

const statusUrl = (code) => `${String(publicBaseUrl).replace(/\/+$/, '')}/auth/facebook/deletion-status?code=${encodeURIComponent(code)}`;

function makeCode(atMs, removed) {
  const t = Math.floor(atMs / 1000).toString(36).padStart(9, '0');
  const n = String(Math.min(9, Math.max(0, removed)));
  return `${t}${n}${hmacHex('facebook-deletion-v1', `${t}|${n}`).slice(0, 20)}`;
}

// -> { at: Date, removed } for a code this server issued, else null.
function readCode(code) {
  if (typeof code !== 'string' || !CODE_RE.test(code)) return null;
  const t = code.slice(0, 9);
  const n = code.slice(9, 10);
  if (!safeEqual(code.slice(10), hmacHex('facebook-deletion-v1', `${t}|${n}`).slice(0, 20))) return null;
  return { at: new Date(parseInt(t, 36) * 1000), removed: Number(n) };
}

// Removes the Facebook link(s) of one app-scoped user id. -> number of identities removed.
async function deleteFacebookUser(db, facebookUserId, { now = Date.now() } = {}) {
  const at = new Date(now);
  const identities = await db.identity.findMany({ where: { provider: facebook.id, providerUserId: String(facebookUserId) } });
  for (const identity of identities) {
    const sessions = await db.authSession.findMany({ where: { identityId: identity.id, revokedAt: null } });
    for (const row of sessions) await revokeSession(db, row, now);
    await db.identity.delete({ where: { id: identity.id } }).catch(() => {});
    await addEvent(db, identity.tenantId, identity.customerId, 'facebook_data_deleted', { sessionsEnded: sessions.length }, at).catch(() => {});
  }
  return identities.length;
}

// POST body -> { status, body }.
async function handleDeletionRequest(db, body, { now = Date.now() } = {}) {
  const secret = facebook.appSecret();
  if (!secret) return { status: 503, body: { error: 'provider_unavailable' } };
  const payload = facebook.parseSignedRequest(body && body.signed_request, secret);
  if (!payload) return { status: 400, body: { error: 'invalid_signed_request' } };
  const removed = await deleteFacebookUser(db, payload.user_id, { now });
  const code = makeCode(now, removed);
  return { status: 200, body: { url: statusUrl(code), confirmation_code: code } };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function statusPage(code) {
  const r = readCode(code);
  const title = r ? 'Your Facebook data was deleted' : 'Unknown confirmation code';
  const body = r
    ? `Request ${esc(code)} was completed on ${esc(r.at.toISOString().replace('T', ' ').slice(0, 16))} UTC. `
      + 'SoftGlaze removed the link to your Facebook account (your Facebook user id, and the name and email Facebook shared with it) '
      + 'and signed out every session that used it. Your SoftGlaze account, licences and payment records are kept; '
      + 'to delete the whole account, ask for it in Settings > Account (web app) or write to support@softglaze.com.'
    : 'We could not find this deletion request. Check the code in the link Facebook gave you.';
  return { status: r ? 200 : 404, html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${esc(title)} - SoftGlaze</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7fb;--card:#fff;--fg:#0f172a;--muted:#475569}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#121a2e;--fg:#e5e7eb;--muted:#94a3b8}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{max-width:520px;width:100%;background:var(--card);border-radius:16px;padding:28px;box-shadow:0 10px 40px rgba(0,0,0,.12)}
h1{font-size:20px;margin:0 0 8px}p{margin:0;color:var(--muted)}
</style></head>
<body><main><h1>${esc(title)}</h1><p>${body}</p></main></body></html>` };
}

module.exports = { handleDeletionRequest, deleteFacebookUser, statusPage, makeCode, readCode, statusUrl };
