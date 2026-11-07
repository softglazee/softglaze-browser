'use strict';
// Purpose-bound keys derived from MASTER_KEY (HKDF-SHA256), so hashing IPs, emails and codes and
// signing unsubscribe links need no extra secret, and no two uses share a key.
const { hkdfSync, createHmac, timingSafeEqual } = require('node:crypto');
const { masterKey } = require('../env');

const cache = new Map();

function subkey(label) {
  let k = cache.get(label);
  if (!k) {
    k = Buffer.from(hkdfSync('sha256', masterKey, Buffer.from('softglaze-licensing'), Buffer.from(String(label)), 32));
    cache.set(label, k);
  }
  return k;
}

// Hex HMAC-SHA256 of value under the key for `label`.
function hmacHex(label, value) {
  return createHmac('sha256', subkey(label)).update(String(value), 'utf8').digest('hex');
}

function hmacB64url(label, value, bytes = 32) {
  return createHmac('sha256', subkey(label)).update(String(value), 'utf8').digest().subarray(0, bytes).toString('base64url');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

module.exports = { subkey, hmacHex, hmacB64url, safeEqual };
