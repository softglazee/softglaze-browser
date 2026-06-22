'use strict';
// ---------------------------------------------------------------------------
// Softglaze Premium — native TOTP (RFC 6238) generator.
//
// Implemented with node:crypto only (no otplib dependency) so the 2FA vault has
// zero install footprint and is fully self-contained. Verified against the
// official RFC 6238 SHA-1 test vectors (see the test at the bottom of the repo's
// verification run). Swap to otplib later if desired — the public surface
// (generateTotp / totpToken) stays the same.
// ---------------------------------------------------------------------------
const crypto = require('node:crypto');

// Decode an RFC 4648 base32 string (the format authenticator seeds use). Spaces,
// hyphens and lower-case are tolerated; '=' padding is ignored. Throws on an
// invalid character so a bad seed surfaces clearly instead of producing a wrong
// code silently.
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

// Generate a TOTP/HOTP code. Returns the zero-padded code string.
//   secret   base32 string
//   options  { digits=6, period=30, algorithm='sha1', timestampMs, counter }
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

// Convenience: return { token, period, secondsRemaining } for live UI display.
function totpToken(secret, options = {}) {
  const period = Number(options.period) || 30;
  const nowMs = Number(options.timestampMs) || Date.now();
  const token = generateTotp(secret, { ...options, timestampMs: nowMs, period });
  const secondsRemaining = period - Math.floor((nowMs / 1000) % period);
  return { token, period, secondsRemaining };
}

module.exports = { base32Decode, generateTotp, totpToken };
