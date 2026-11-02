'use strict';
// Ed25519 lease signing and tenant-admin API key helpers. The private key never leaves the backend
// (sealed at rest); the public key is baked into the desktop build to verify leases offline.
const {
  generateKeyPairSync, sign: edSign, createPrivateKey, randomBytes, createHash
} = require('node:crypto');

function generateTenantKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  };
}

// Node requires a null algorithm argument for Ed25519.
function signEd25519(privateKeyPem, dataBuf) {
  return edSign(null, dataBuf, createPrivateKey(privateKeyPem));
}

function newApiKey() { return 'sgls_' + randomBytes(24).toString('base64url'); }
function sha256Hex(s) { return createHash('sha256').update(String(s)).digest('hex'); }

module.exports = { generateTenantKeypair, signEd25519, newApiKey, sha256Hex };
