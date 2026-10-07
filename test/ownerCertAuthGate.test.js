'use strict';
// 7 Oct 2026 audit fixes: L1 (Super Admin licence exemption needs a signed owner
// certificate for this machine, never on a tenant build) and S7 (sign-out and the
// vault lock are enforced in main for every IPC channel outside a small allowlist).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const IPC = read('src', 'main', 'ipcHandlers.js');
const PRELOAD = read('src', 'preload', 'preload.js');

const ownerCert = require('../src/main/ownerCert');
const authGate = require('../src/main/authGate');

function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const next = src.indexOf('\nasync function ', start + signature.length);
  const next2 = src.indexOf('\nfunction ', start + signature.length);
  const ends = [next, next2].filter((i) => i > 0);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}

// A throwaway key pair stands in for the owner key (the real private key is never in the repo).
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' });
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' });
const MID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const base = { machineId: MID, publicKeyPem: PUB, tenantBuild: false };

// ---- L1: ownerCert ----
test('L1: a valid owner certificate for this machine is accepted', () => {
  const cert = ownerCert.signOwnerCert(PRIV, MID, 'owner PC');
  assert.equal(cert.v, 1);
  assert.deepEqual(ownerCert.verifyOwnerCert(cert, base), { ok: true });
});

test('L1: a certificate for another machine is rejected', () => {
  const cert = ownerCert.signOwnerCert(PRIV, 'some-other-machine');
  assert.equal(ownerCert.verifyOwnerCert(cert, base).reason, 'wrong-machine');
  assert.equal(ownerCert.verifyOwnerCert(ownerCert.signOwnerCert(PRIV, MID), { ...base, machineId: '' }).ok, false);
});

test('L1: a tampered certificate or signature is rejected', () => {
  const cert = ownerCert.signOwnerCert(PRIV, MID, 'owner PC');
  const sig = Buffer.from(cert.sig, 'base64'); sig[0] ^= 0xff;
  assert.equal(ownerCert.verifyOwnerCert({ ...cert, sig: sig.toString('base64') }, base).reason, 'bad-signature');
  assert.equal(ownerCert.verifyOwnerCert({ ...cert, note: 'changed' }, base).reason, 'bad-signature');
  // Re-pointing a genuine certificate at a forged machine id breaks the signature too.
  const moved = { ...ownerCert.signOwnerCert(PRIV, 'x-machine'), machineId: MID };
  assert.equal(ownerCert.verifyOwnerCert(moved, base).reason, 'bad-signature');
  // Signed by a different key (a customer's own key pair) - rejected against the owner key.
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.equal(ownerCert.verifyOwnerCert(ownerCert.signOwnerCert(other, MID), base).reason, 'bad-signature');
});

test('L1: a missing or unreadable certificate file is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ownercert-'));
  try {
    const file = ownerCert.ownerCertPath(dir);
    assert.equal(path.basename(file), 'owner.cert');
    assert.equal(ownerCert.checkOwnerCertFile(file, base).reason, 'missing');
    fs.writeFileSync(file, 'not json');
    assert.equal(ownerCert.checkOwnerCertFile(file, base).reason, 'missing');
    fs.writeFileSync(file, JSON.stringify(ownerCert.signOwnerCert(PRIV, MID)));
    assert.equal(ownerCert.checkOwnerCertFile(file, base).ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L1: a tenant / sold build never honours a certificate', () => {
  const cert = ownerCert.signOwnerCert(PRIV, MID);
  assert.equal(ownerCert.verifyOwnerCert(cert, { ...base, tenantBuild: true }).reason, 'tenant-build');
  // Detection follows tenantConfig (env overrides apply in unpackaged runs like this one).
  const { _reset } = require('../src/main/tenantConfig');
  const prev = process.env.SG_TENANT_ID;
  try {
    process.env.SG_TENANT_ID = 'tenant-x'; _reset();
    assert.equal(ownerCert.isTenantBuild(), true);
    assert.equal(ownerCert.verifyOwnerCert(cert, { machineId: MID, publicKeyPem: PUB }).reason, 'tenant-build');
  } finally {
    if (prev === undefined) delete process.env.SG_TENANT_ID; else process.env.SG_TENANT_ID = prev;
    _reset();
  }
});

test('L1: the owner public key is embedded, and no private key is in the source', () => {
  assert.doesNotThrow(() => crypto.createPublicKey(ownerCert.OWNER_PUBLIC_KEY_PEM));
  assert.equal(crypto.createPublicKey(ownerCert.OWNER_PUBLIC_KEY_PEM).asymmetricKeyType, 'ed25519');
  for (const f of [['src', 'main', 'ownerCert.js'], ['scripts', 'owner-cert.js']]) {
    assert.ok(!/BEGIN PRIVATE KEY/.test(read(...f).replace(/'pkcs8'/g, '')), f.join('/'));
  }
});

test('L1: only a SUPER_ADMIN with a valid certificate is the certified source owner', () => {
  assert.equal(ownerCert.isCertifiedSuperAdmin({ role: 'SUPER_ADMIN' }, true), true);
  assert.equal(ownerCert.isCertifiedSuperAdmin({ role: 'SUPER_ADMIN' }, false), false);
  assert.equal(ownerCert.isCertifiedSuperAdmin({ role: 'OWNER' }, true), false);
  assert.equal(ownerCert.isCertifiedSuperAdmin(null, true), false);
});

test('L1: owner-cert keygen + sign round-trip, and keygen refuses to overwrite', () => {
  const { execFileSync, spawnSync } = require('node:child_process');
  const script = path.join(ROOT, 'scripts', 'owner-cert.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ownerkey-'));
  try {
    execFileSync(process.execPath, [script, 'keygen', dir], { encoding: 'utf8' });
    const again = spawnSync(process.execPath, [script, 'keygen', dir], { encoding: 'utf8' });
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /refusing to overwrite/);
    const cert = JSON.parse(execFileSync(process.execPath, [script, 'sign', path.join(dir, 'owner-private.pem'), MID, 'test'], { encoding: 'utf8' }));
    const pub = fs.readFileSync(path.join(dir, 'owner-public.pem'), 'utf8');
    assert.deepEqual(ownerCert.verifyOwnerCert(cert, { machineId: MID, publicKeyPem: pub, tenantBuild: false }), { ok: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L1: owner-cert machine-id prints the same id the app checks', () => {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'owner-cert.js'), 'machine-id'], { encoding: 'utf8' }).trim();
  assert.equal(out, require('../src/main/licenseClient').machineHash());
});

test('L1: ownerCertValid uses the licensing machine id and refuses tenant builds', () => {
  const body = fnBody(IPC, 'async function ownerCertValid()');
  assert.match(body, /ownerCert\.isTenantBuild\(\)\) return false/);
  assert.match(body, /machineId: licenseClient\.machineHash\(\)/);
  assert.match(body, /app\.getPath\('userData'\)/);
});

test('L1: getLicense does not exempt a SUPER_ADMIN without a certificate', () => {
  const body = fnBody(IPC, 'async function getLicense()');
  assert.ok(!/m\.role === 'SUPER_ADMIN'/.test(body), 'the bare role check is gone');
  const exempt = body.indexOf("type: 'source-owner'");
  const gate = body.indexOf('await isCertifiedSuperAdmin(m)');
  assert.ok(gate > 0 && gate < exempt, 'source-owner licence only behind the certificate check');
});

test('L1: assertNotBanned, seats and the licence-management powers need the certificate', () => {
  assert.match(fnBody(IPC, 'async function assertNotBanned()'), /if \(await isCertifiedSuperAdmin\(m\)\) return;/);
  assert.match(fnBody(IPC, 'async function getSeatUsage()'), /await isCertifiedSuperAdmin\(m\)/);
  assert.match(fnBody(IPC, 'async function assertSeatAvailable()'), /await isCertifiedSuperAdmin\(m\)/);
  assert.match(fnBody(IPC, 'async function requireSuperAdmin()'), /isCertifiedSuperAdmin\(m\)[\s\S]*OWNER_CERT_REQUIRED/);
  assert.match(fnBody(IPC, 'async function setMemberStatus('), /target\.role === 'OWNER'[^\n]*isCertifiedSuperAdmin\(actor\)/);
  assert.match(fnBody(IPC, 'async function startTrial('), /const isSuper = await isCertifiedSuperAdmin\(me\)/);
  assert.match(fnBody(IPC, 'async function getBillingPlans()'), /canManage: await isCertifiedSuperAdmin\(me\)/);
  // Every licence-management handler goes through requireSuperAdmin.
  for (const fn of ['assignPlan(', 'grantLicense(', 'extendLicense(', 'resetLicense(', 'editLicense(', 'terminateLicense(', 'listOwnerLicenses(']) {
    assert.match(fnBody(IPC, `async function ${fn}`), /await requireSuperAdmin\(\)/, fn);
  }
});

test('L1: superAdminSetup refuses to claim the role without a certificate', () => {
  const body = fnBody(IPC, 'async function superAdminSetup(');
  const claim = body.indexOf('} else {');
  const gate = body.indexOf('if (!(await ownerCertValid()))');
  assert.ok(claim > 0 && gate > claim, 'the first-run claim branch checks the certificate');
  assert.ok(gate < body.indexOf("writeSetting('superAdminAuth'"), 'before anything is written');
  assert.match(body.slice(gate, gate + 400), /OWNER_CERT_REQUIRED/);
});

// ---- S7: main-process sign-in / vault-lock gate ----
const SIGNED_OUT = { vaultLocked: false, signedIn: false, memberCount: 3 };

test('S7: while signed out on a workspace with members, ordinary channels are denied', () => {
  for (const ch of ['profile:list', 'proxy:list', 'member:create', 'license:grant', 'settings:get', 'vault:set-password']) {
    const d = authGate.decide(ch, SIGNED_OUT);
    assert.ok(d, ch);
    assert.equal(d.code, 'AUTH_REQUIRED');
  }
  // A DB error while reading state fails closed.
  assert.equal(authGate.decide('profile:list', { memberCount: Infinity }).code, 'AUTH_REQUIRED');
});

test('S7: while the vault is locked, ordinary channels are denied even with a member restored', () => {
  const d = authGate.decide('profile:list', { vaultLocked: true, signedIn: true, memberCount: 1 });
  assert.equal(d.code, 'VAULT_LOCKED');
  assert.equal(authGate.decide('profile:list', { vaultLocked: true, signedIn: false, memberCount: 0 }).code, 'VAULT_LOCKED');
});

test('S7: the login / lock / first-run channels stay allowed while signed out or locked', () => {
  for (const ch of authGate.PRE_AUTH_CHANNELS) {
    assert.equal(authGate.decide(ch, SIGNED_OUT), null, ch);
    assert.equal(authGate.decide(ch, { vaultLocked: true }), null, ch);
  }
  for (const ch of ['vault:unlock', 'member:login', 'member:switch', 'member:super-login', 'db:unlock', 'account:register']) {
    assert.ok(authGate.isPreAuthChannel(ch), ch);
  }
  // Nothing that reads or changes workspace data is on the list.
  for (const ch of ['license:get', 'license:grant', 'license:reset', 'profile:list', 'member:create', 'vault:disable']) {
    assert.ok(!authGate.isPreAuthChannel(ch), ch);
  }
});

test('S7: every allowlisted channel exists in main and preload', () => {
  for (const ch of authGate.PRE_AUTH_CHANNELS) {
    assert.ok(IPC.includes(`'${ch}'`), `main: ${ch}`);
    assert.ok(PRELOAD.includes(`'${ch}'`), `preload: ${ch}`);
  }
});

test('S7: single-user installs (no members) and signed-in members are unchanged', () => {
  assert.equal(authGate.decide('profile:list', { vaultLocked: false, signedIn: false, memberCount: 0 }), null);
  assert.equal(authGate.decide('profile:launch', { vaultLocked: false, signedIn: true, memberCount: 5 }), null);
});

test('S7: the gate is wired into registerHandler for every channel', () => {
  const body = fnBody(IPC, 'function registerHandler(');
  const gate = body.indexOf('authGate.decide(channel, await ipcAuthState())');
  assert.ok(gate > 0 && gate < body.indexOf('await handler(payload, event)'), 'checked before the handler runs');
  const state = fnBody(IPC, 'async function ipcAuthState()');
  assert.match(state, /vaultLocked/);
  assert.match(state, /isSuperAdminId\(currentMemberId\)/);
  assert.match(state, /member\.findUnique/); // a stale member id counts as signed out
  assert.match(state, /memberCount = Infinity/); // fail closed
});

// ---- L3 follow-up: machine-bound licence reason surfaced by getLicense ----
test('L3: getLicense reports the licence issue reason and never paid on a machine mismatch', () => {
  const body = fnBody(IPC, 'async function getLicense()');
  assert.match(body, /licenseClient\.licenseIssue/);
  assert.match(body, /issueOf\(\) !== 'machine_mismatch'/);
  assert.match(body, /withLicenseReason\(await licenseView\(lic\), issueOf\(\)\)/);
  // Run the real helper.
  const src = fnBody(IPC, 'function withLicenseReason(');
  const withLicenseReason = new Function(`${src}\nreturn withLicenseReason;`)();
  const paid = { state: 'paid', status: 'active', isPaid: true, isBanned: false };
  const mm = withLicenseReason(paid, 'machine_mismatch');
  assert.equal(mm.reason, 'machine_mismatch');
  assert.equal(mm.isPaid, false);
  assert.notEqual(mm.state, 'paid');
  assert.equal(mm.isBanned, true);
  assert.deepEqual(withLicenseReason(paid, null), { ...paid, reason: null });
  const trial = { state: 'trial', status: 'active', isPaid: false, isBanned: false };
  assert.equal(withLicenseReason(trial, 'machine_mismatch').state, 'trial');
});

test('L3: the Gate shows gate.license.machineMismatch (en + es)', () => {
  const gate = read('src', 'renderer', 'components', 'Gate.jsx');
  assert.match(gate, /reason === 'machine_mismatch'[\s\S]{0,400}t\('license\.machineMismatch'\)/);
  const en = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'en', 'gate.json'));
  const es = JSON.parse(read('src', 'renderer', 'i18n', 'locales', 'es', 'gate.json'));
  assert.equal(en.license.machineMismatch, 'This licence is registered to a different computer. Move it to this PC or ask your administrator to reset it.');
  assert.ok(es.license.machineMismatch && es.license.machineMismatch !== en.license.machineMismatch);
});
