'use strict';
// RFC 6238 TOTP on node:crypto only, so the 2FA vault needs no extra dependency.
const crypto = require('node:crypto');

// Decodes RFC 4648 base32 (authenticator seeds): tolerates spaces, hyphens and lower case, ignores
// = padding, and throws on a bad character instead of yielding a wrong code.
function base32Decode(input) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!clean) throw new Error('Empty 2FA secret.');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid character in 2FA secret (must be base32).');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

// Zero-padded code. options: { digits=6, period=30, algorithm='sha1', timestampMs, counter }
function generateTotp(secret, options = {}) {
  const digits = Number(options.digits) || 6;
  const period = Number(options.period) || 30;
  const algorithm = options.algorithm || 'sha1';
  const key = base32Decode(secret);

  // RFC 6238: counter = floor(unixTime / period). HOTP callers may pass a counter.
  const counter = options.counter != null
    ? Number(options.counter)
    : Math.floor((Number(options.timestampMs) || Date.now()) / 1000 / period);

  // 8-byte big-endian counter.
  const buf = Buffer.alloc(8);
  // Use a 64-bit write so large counters (year-2038+) stay correct.
  buf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac(algorithm, key).update(buf).digest();
  // Dynamic truncation (RFC 4226 §5.3).
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  const code = (binCode % 10 ** digits).toString().padStart(digits, '0');
  return code;
}

// Returns { token, period, secondsRemaining } for the live UI.
function totpToken(secret, options = {}) {
  const period = Number(options.period) || 30;
  const nowMs = Number(options.timestampMs) || Date.now();
  const token = generateTotp(secret, { ...options, timestampMs: nowMs, period });
  const secondsRemaining = period - Math.floor((nowMs / 1000) % period);
  return { token, period, secondsRemaining };
}

module.exports = { base32Decode, generateTotp, totpToken };
