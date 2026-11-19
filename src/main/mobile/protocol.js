'use strict';
// The phone <-> PC protocol (@softglaze/protocol), vendored as one CommonJS bundle by
// scripts/vendor-softglaze-protocol.mjs. Pure JavaScript (noble crypto + valibot): no native
// modules, randomness from globalThis.crypto.getRandomValues (present in Node and Electron main).
// Never edit the vendored file; rebuild it from the SoftGlaze-Mobile repository instead.
const P = require('./vendor/softglaze-protocol.cjs');
const VENDOR = require('./vendor/VENDOR.json');

// Desktop profile ids are integers; protocol ids must match /^[A-Za-z0-9_-]{8,64}$/.
// 12 -> "p0000012". Phones treat the id as opaque text.
function wireProfileId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Bad profile id.');
  return `p${String(n).padStart(7, '0')}`;
}

function parseWireProfileId(text) {
  const m = /^p(\d{7,15})$/.exec(String(text || ''));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

module.exports = { P, VENDOR, wireProfileId, parseWireProfileId };
