'use strict';
// Cloud sync: the server side of the @softglaze/protocol "ws" signatures (protocol src/ws/device.ts, record.ts,
// api.ts), with node:crypto only. The server never holds a key that opens user data; it only checks that
//   - a workspace id belongs to its Member Key (id = base64url(SHA-256("sg-ws-space-v1" || MK Ed25519 pub)[0..16])),
//   - device certificates, revocations and workspace actions are signed by that Member Key,
//   - record and keyring writes are signed by an enrolled device.
// Clients check the same things; this is defence in depth against a stolen account session.
// Cross-checked with the shared vectors (test/fixtures/ws-v1.json, from the protocol package).
const crypto = require('node:crypto');

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const B64URL_RE = /^[A-Za-z0-9_-]*$/;
const PLATFORMS = ['pc', 'web', 'phone'];

// Strict base64url -> Buffer, or null (Node's decoder silently skips junk, so re-encode and compare).
function b64u(s) {
  if (typeof s !== 'string' || !B64URL_RE.test(s)) return null;
  const buf = Buffer.from(s, 'base64url');
  return buf.toString('base64url') === s ? buf : null;
}

const sha256 = (...parts) => crypto.createHash('sha256').update(Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'utf8') : p)))).digest();

function keyId(pub) {
  return sha256('sg-keyid-v1', pub).subarray(0, 8).toString('base64url');
}

function workspaceIdOf(pub) {
  return sha256('sg-ws-space-v1', pub).subarray(0, 16).toString('base64url');
}

// Same as protocol sync/merge.ts stableJson: sorted keys, undefined dropped.
function stableJson(x) {
  if (x === undefined) return 'null';
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(stableJson).join(',')}]`;
  return `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(x[k])}`).join(',')}}`;
}

// Ed25519 verify with a raw 32-byte public key (Buffer or base64url) and a base64url signature.
function verifyEd25519(pub, message, sigB64) {
  try {
    const key = typeof pub === 'string' ? b64u(pub) : pub;
    const sig = b64u(sigB64);
    if (!key || key.length !== 32 || !sig || sig.length !== 64) return false;
    const pk = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, key]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8'), pk, sig);
  } catch (_) {
    return false;
  }
}

const certMessage = (cert) => Buffer.from(`sg-ws-cert-v1\n${stableJson(cert)}`, 'utf8');
const revocationMessage = (r) => Buffer.from(`sg-ws-revoke-v1\n${stableJson(r)}`, 'utf8');
const actionMessage = (action, ws, at, extra = '') => Buffer.from(`sg-ws-action-v1\n${action}\n${ws}\n${at}\n${extra}`, 'utf8');
const recordSignMessage = (ws, rid, version, blob) => Buffer.concat([Buffer.from(`sg-ws-rec-v1\n${ws}\n${rid}\n${version}\n`, 'utf8'), sha256(blob)]);
const keyringSignMessage = (ws, version, keyring) => Buffer.concat([Buffer.from(`sg-ws-keyring-v1\n${ws}\n${version}\n`, 'utf8'), sha256(keyring)]);

// The checks of protocol verifyDeviceCert: shape, workspace, tag = keyId(signPub), MK signature.
function verifyDeviceCert(ownerSignPub, ws, cert, sig) {
  if (!cert || typeof cert !== 'object' || cert.v !== 1 || cert.ws !== ws) return false;
  if (!PLATFORMS.includes(cert.platform) || typeof cert.name !== 'string' || !cert.name || cert.name.length > 64 || typeof cert.at !== 'number') return false;
  const signPub = b64u(cert.signPub);
  const dhPub = b64u(cert.dhPub);
  if (!signPub || signPub.length !== 32 || !dhPub || dhPub.length !== 32) return false;
  if (keyId(signPub) !== cert.tag) return false;
  const keys = Object.keys(cert).sort().join(',');
  if (keys !== 'at,dhPub,name,platform,signPub,tag,v,ws') return false;
  return verifyEd25519(ownerSignPub, certMessage(cert), sig);
}

function verifyRevocation(ownerSignPub, ws, r, sig) {
  if (!r || typeof r !== 'object' || r.v !== 1 || r.ws !== ws || typeof r.tag !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(r.tag) || typeof r.at !== 'number') return false;
  return verifyEd25519(ownerSignPub, revocationMessage(r), sig);
}

module.exports = {
  b64u, sha256, keyId, workspaceIdOf, stableJson, verifyEd25519, certMessage, revocationMessage, actionMessage,
  recordSignMessage, keyringSignMessage, verifyDeviceCert, verifyRevocation, PLATFORMS
};
