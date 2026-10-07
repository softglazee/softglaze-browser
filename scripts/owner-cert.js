'use strict';
// Owner certificate tool (audit L1). See src/main/ownerCert.js.
//
//   node scripts/owner-cert.js keygen <dir>
//       Writes owner-private.pem + owner-public.pem (Ed25519). Refuses to overwrite.
//       Keep the private key OUT of the repo; paste the public PEM into ownerCert.js.
//   node scripts/owner-cert.js sign <privateKeyPath> <machineId> [note]
//       Prints the certificate JSON. Save it as <userData>/owner.cert on that machine.
//   node scripts/owner-cert.js machine-id
//       Prints this machine's licensing machine id (licenseClient.machineHash(): SHA-256
//       of the OS machine identity), the value a certificate must be signed for.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ownerCert = require('../src/main/ownerCert');

function die(msg) { console.error(`owner-cert: ${msg}`); process.exit(1); }

function keygen(dir) {
  if (!dir) die('usage: keygen <dir>');
  const priv = path.join(dir, 'owner-private.pem');
  const pub = path.join(dir, 'owner-public.pem');
  for (const f of [priv, pub]) if (fs.existsSync(f)) die(`${f} already exists - refusing to overwrite.`);
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
  console.log(`Wrote ${priv}\nWrote ${pub}`);
}

function sign(keyPath, machineId, note) {
  if (!keyPath || !machineId) die('usage: sign <privateKeyPath> <machineId> [note]');
  const cert = ownerCert.signOwnerCert(fs.readFileSync(keyPath, 'utf8'), machineId, note || '');
  process.stdout.write(`${JSON.stringify(cert, null, 2)}\n`);
}

function machineId() {
  // The app's own function (licenseClient.machineHash), run under plain node.
  process.stdout.write(`${require('../src/main/licenseClient').machineHash()}\n`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'keygen') keygen(rest[0]);
else if (cmd === 'sign') sign(rest[0], rest[1], rest.slice(2).join(' '));
else if (cmd === 'machine-id') machineId();
else die('usage: owner-cert.js keygen <dir> | sign <privateKeyPath> <machineId> [note] | machine-id');
