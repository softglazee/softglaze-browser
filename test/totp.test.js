'use strict';
// RFC 6238 conformance for the native TOTP generator (src/main/totp.js).
// Pure node:crypto — no Electron, runs under `node --test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateTotp, base32Decode, totpToken } = require('../src/main/totp.js');

// RFC 6238 Appendix B test seed: ASCII "12345678901234567890" (20 bytes),
// base32-encoded. The published vectors below are SHA-1, 8 digits, 30s period.
const SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const VECTORS = [
  [59, '94287082'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037']
];

test('generateTotp matches the RFC 6238 SHA-1 test vectors', () => {
  for (const [seconds, expected] of VECTORS) {
    const code = generateTotp(SEED, {
      digits: 8,
      period: 30,
      algorithm: 'sha1',
      timestampMs: seconds * 1000
    });
    assert.equal(code, expected, `T=${seconds}s should produce ${expected}`);
  }
});

test('base32Decode decodes the RFC seed and rejects bad input', () => {
  assert.deepEqual(base32Decode(SEED), Buffer.from('12345678901234567890'));
  assert.throws(() => base32Decode('0189'), /base32|Invalid/i); // 0/1/8/9 not in alphabet
  assert.throws(() => base32Decode(''), /Empty/i);
});

test('totpToken reports a sane live countdown', () => {
  const { token, period, secondsRemaining } = totpToken(SEED, {
    digits: 8,
    timestampMs: 1234567890 * 1000
  });
  assert.equal(token, '89005924');
  assert.equal(period, 30);
  assert.ok(secondsRemaining > 0 && secondsRemaining <= 30, `countdown ${secondsRemaining} out of range`);
});
