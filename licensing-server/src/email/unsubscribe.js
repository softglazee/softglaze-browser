'use strict';
// Per-recipient unsubscribe links: <customerId>.<HMAC>, signed with a key derived from MASTER_KEY.
// They never expire (CAN-SPAM wants them to keep working), carry no email address, and stop
// lifecycle and marketing email; essential email (sign-in codes) still goes out.
const { hmacB64url, safeEqual } = require('../crypto/derive');
const { publicBaseUrl } = require('../env');

function tokenFor(customerId) {
  const id = String(customerId);
  return `${id}.${hmacB64url('unsubscribe-v1', id, 18)}`;
}

// -> customerId or null
function verifyToken(token) {
  const s = String(token || '');
  const dot = s.lastIndexOf('.');
  if (dot <= 0 || s.length > 200) return null;
  const id = s.slice(0, dot);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;
  return safeEqual(tokenFor(id), s) ? id : null;
}

function unsubscribeUrl(customerId) {
  return `${publicBaseUrl}/v1/email/unsubscribe?t=${encodeURIComponent(tokenFor(customerId))}`;
}

module.exports = { tokenFor, verifyToken, unsubscribeUrl };
