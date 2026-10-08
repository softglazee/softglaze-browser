'use strict';
// Audit L3: install credentials could be shared across machines. The server now signs the
// install's machine hash into the lease as `mid`; the desktop must refuse a lease bound to
// another machine, accept a pre-binding (mid-less) lease only until its own expiry, and
// surface 'machine_mismatch' so the renderer can explain it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync, sign } = require('node:crypto');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
process.env.SG_TENANT_ID = 'tenant_test';
process.env.SG_API_BASE_URL = 'http://localhost:8787';
process.env.SG_TENANT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const client = require('../src/main/licenseClient');
const { verifyLease, machineHash, licenseIssue, clearLicenseIssue } = client;

const b64url = (b) => Buffer.from(b).toString('base64url');
function makeLease(payload) {
  const p = b64url(JSON.stringify(payload));
  return `${p}.${b64url(sign(null, Buffer.from(p), privateKey))}`;
}
const nowSec = () => Math.floor(Date.now() / 1000);
const lease = (over = {}) => makeLease({ v: 1, tenant: 'tenant_test', sub: 'inst_1', tier: 'pro', iat: nowSec(), exp: nowSec() + 3600, nonce: 'n', ...over });

test('the machine hash is a stable SHA-256, never a raw hardware id', () => {
  const h = machineHash();
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.strictEqual(machineHash(), h);
});

test('a lease bound to this machine verifies and reports its mid', () => {
  const r = verifyLease(lease({ mid: machineHash() }));
  assert.ok(r);
  assert.strictEqual(r.mid, machineHash());
  assert.strictEqual(r.legacy, false);
});

test('a lease bound to another machine is rejected and surfaces machine_mismatch', () => {
  clearLicenseIssue();
  const r = verifyLease(lease({ mid: 'f'.repeat(64) }));
  assert.strictEqual(r, null);
  assert.strictEqual(licenseIssue().reason, 'machine_mismatch');
  // A lease for this machine clears it again.
  assert.ok(verifyLease(lease({ mid: machineHash() })));
  assert.strictEqual(licenseIssue(), null);
});

test('opts.machineHash is what the mid is compared against', () => {
  const mine = '1'.repeat(64);
  assert.ok(verifyLease(lease({ mid: mine }), { machineHash: mine }));
  assert.strictEqual(verifyLease(lease({ mid: mine }), { machineHash: '2'.repeat(64) }), null);
});

test('a pre-binding lease without mid is accepted only until its own expiry, flagged legacy', () => {
  const ok = verifyLease(lease());
  assert.ok(ok);
  assert.strictEqual(ok.legacy, true);
  assert.strictEqual(ok.mid, null);
  assert.strictEqual(verifyLease(lease({ exp: nowSec() - 5 })), null, 'an expired legacy lease is refused');
  const later = (nowSec() + 7200) * 1000;
  assert.strictEqual(verifyLease(lease(), { nowMs: later }), null, 'a legacy lease never outlives its exp');
});

test('register and license send the machine hash; the server error code is kept on err.code', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'licenseClient.js'), 'utf8');
  assert.match(src, /postJson\('\/v1\/register', \{[^}]*machineHash: machineHash\(\)/);
  assert.match(src, /postJson\('\/v1\/license', \{[^}]*machineHash: machineHash\(\)/);
  assert.match(src, /postJson\('\/v1\/license\/transfer'/);
  assert.match(src, /err\.code = code/);
  assert.match(src, /if \(code === 'machine_mismatch'\) noteIssue\('machine_mismatch'\)/);
  assert.ok(!/getMachineId/.test(src.replace(/\/\/.*$/gm, '')), 'the settings machine id is not used or changed here');
});

test('a 403 machine_mismatch from the server rejects with code machine_mismatch', async () => {
  const http = require('node:http');
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(403, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'machine_mismatch' })); });
  });
  await new Promise((r) => server.listen(8787, '127.0.0.1', r));
  try {
    clearLicenseIssue();
    await assert.rejects(client.api.license({ installId: 'i', installSecret: 's' }), (e) => e.code === 'machine_mismatch' && /different computer/.test(e.message));
    assert.strictEqual(licenseIssue().reason, 'machine_mismatch');
  } finally { server.close(); }
});
