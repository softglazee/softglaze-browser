'use strict';
// Cloud sync phase 1 (/v1/sync/*, src/sync/): the encrypted workspace store. Keys are real Ed25519 / X25519 keys
// made with node:crypto; the signature formats are cross-checked with the protocol package's shared vectors.
const H = require('./helpers/harness');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const w = require('../src/sync/wsCrypto');
const { createSession } = require('../src/auth/sessions');
const { eraseCustomer } = require('../src/customers/erase');
const vectors = require('./fixtures/ws-v1.json');

const { db, call } = H;
const WEB_ORIGIN = 'https://app.softglaze.test';
let T;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const rawPub = (key) => Buffer.from(key.export({ format: 'jwk' }).x, 'base64url');

function ed() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { pub: rawPub(publicKey), sign: (msg) => b64(crypto.sign(null, Buffer.isBuffer(msg) ? msg : Buffer.from(msg), privateKey)) };
}
function x25519Pub() {
  return rawPub(crypto.generateKeyPairSync('x25519').publicKey);
}

// A Member Key and its workspace id.
function memberKey() {
  const k = ed();
  return { ...k, pubB64: b64(k.pub), id: w.workspaceIdOf(k.pub) };
}

// A device (Ed25519 + X25519) and its MK-signed certificate.
function device(mk, name = 'Home PC', platform = 'pc', at = Date.now()) {
  const k = ed();
  const dh = x25519Pub();
  const cert = { v: 1, ws: mk.id, tag: w.keyId(k.pub), signPub: b64(k.pub), dhPub: b64(dh), name, platform, at };
  return { ...k, dh, cert, certSig: mk.sign(w.certMessage(cert)), tag: cert.tag };
}

function createBody(mk, dev, { now = Date.now() } = {}) {
  return {
    id: mk.id, ownerSignPub: mk.pubB64, keyring: b64(crypto.randomBytes(200)), keyringVersion: 1, recoveryWrap: b64(crypto.randomBytes(76)),
    at: now, sig: mk.sign(w.actionMessage('create', mk.id, now, mk.pubB64)), device: { cert: dev.cert, certSig: dev.certSig }
  };
}

function writeFor(mk, dev, rid, version, size = 1024) {
  const body = crypto.randomBytes(size);
  return { rid, version, body: b64(body), sig: dev.sign(w.recordSignMessage(mk.id, rid, version, body)), dev: dev.tag };
}

const rid = () => b64(crypto.randomBytes(16));
let n = 0;
async function account({ tier = 'pro', status = 'paid', kind = 'web' } = {}) {
  n++;
  const email = `sync${n}@example.com`;
  const customer = await db.customer.create({ data: { tenantId: T, email, emailKey: email, tier, status } });
  const s = await createSession(db, { tenantId: T, customer, provider: 'google', kind });
  return { customer, email, h: { authorization: `Bearer ${s.token}` } };
}

test.before(async () => {
  await H.start();
  T = (await H.seedTenant('tenantsync')).id;
  process.env.WEB_APP_ORIGINS = WEB_ORIGIN;
});
test.after(async () => {
  for (const k of ['CLOUD_SYNC', 'CLOUD_SYNC_BETA_EMAILS', 'CLOUD_SYNC_QUOTA_PRO_MB', 'WEB_APP_ORIGINS']) delete process.env[k];
  await H.stop();
});
test.beforeEach(() => {
  process.env.CLOUD_SYNC = 'on';
  delete process.env.CLOUD_SYNC_BETA_EMAILS;
  delete process.env.CLOUD_SYNC_QUOTA_PRO_MB;
});

test('server crypto matches the protocol vectors (ids, tags, certificates, record and action signatures)', () => {
  const owner = Buffer.from(vectors.ownerSignPub, 'base64url');
  assert.equal(w.workspaceIdOf(owner), vectors.workspaceId);
  assert.equal(w.keyId(owner), vectors.ownerKeyTag);
  assert.equal(w.keyId(Buffer.from(vectors.deviceSignPub, 'base64url')), vectors.deviceCert.tag);
  assert.ok(w.verifyDeviceCert(vectors.ownerSignPub, vectors.workspaceId, vectors.deviceCert, vectors.deviceCertSig));
  assert.ok(!w.verifyDeviceCert(vectors.ownerSignPub, vectors.workspaceId, { ...vectors.deviceCert, name: 'Other' }, vectors.deviceCertSig));
  const body = Buffer.from(vectors.recordBody, 'base64url');
  assert.ok(w.verifyEd25519(vectors.deviceSignPub, w.recordSignMessage(vectors.workspaceId, vectors.profileRid, 1, body), vectors.recordSig));
  assert.ok(!w.verifyEd25519(vectors.deviceSignPub, w.recordSignMessage(vectors.workspaceId, vectors.profileRid, 2, body), vectors.recordSig));
  assert.ok(w.verifyEd25519(vectors.ownerSignPub, w.actionMessage('create', vectors.workspaceId, vectors.createAt, vectors.ownerSignPub), vectors.createSig));
  assert.equal(w.stableJson({ b: 1, a: [1, { d: undefined, c: 'x' }] }), '{"a":[1,{"c":"x"}],"b":1}');
  assert.equal(w.b64u('ab+c'), null);
  assert.equal(w.b64u('abc='), null);
});

test('switched off: only GET /workspace answers (enabled false); no token = 401', async () => {
  process.env.CLOUD_SYNC = 'off';
  const a = await account();
  const s = await call('GET', '/v1/sync/workspace', { headers: a.h });
  assert.equal(s.status, 200);
  assert.deepEqual({ enabled: s.json.enabled, workspace: s.json.workspace, allowed: s.json.plan.allowed }, { enabled: false, workspace: null, allowed: true });
  assert.equal((await call('GET', '/v1/sync/records?since=0', { headers: a.h })).json.error, 'cloud_sync_off');
  assert.equal((await call('POST', '/v1/sync/workspace', { headers: a.h, body: {} })).status, 404);
  assert.equal((await call('GET', '/v1/sync/workspace')).status, 401);
});

test('beta: only listed accounts; desktop sessions work too', async () => {
  process.env.CLOUD_SYNC = 'beta';
  const a = await account({ kind: 'desktop' });
  const b = await account();
  process.env.CLOUD_SYNC_BETA_EMAILS = ` other@example.com, ${a.email.toUpperCase()} `;
  assert.equal((await call('GET', '/v1/sync/workspace', { headers: a.h })).json.enabled, true);
  assert.equal((await call('GET', '/v1/sync/workspace', { headers: b.h })).json.enabled, false);
});

test('create: every check, then one workspace per account', async () => {
  const a = await account();
  const mk = memberKey();
  const pc = device(mk);
  const good = createBody(mk, pc);
  const post = (body) => call('POST', '/v1/sync/workspace', { headers: a.h, body });
  assert.equal((await post({ ...good, id: memberKey().id })).json.error, 'invalid', 'id of another key');
  assert.equal((await post({ ...good, at: Date.now() - 11 * 60000 })).json.error, 'stale');
  assert.equal((await post({ ...good, sig: memberKey().sign('x') })).json.error, 'bad_signature');
  const stranger = memberKey();
  const badDev = device(stranger);
  assert.equal((await post({ ...good, device: { cert: { ...badDev.cert, ws: mk.id }, certSig: badDev.certSig } })).json.error, 'bad_certificate');
  assert.equal((await post({ ...good, keyring: 'not base64!' })).json.error, 'invalid');
  const r = await post(good);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.workspace.id, mk.id);
  assert.equal(r.json.workspace.keyring, good.keyring);
  assert.equal(r.json.workspace.recoveryWrap, good.recoveryWrap);
  assert.equal(r.json.workspace.quotaBytes, 100 * 1024 * 1024);
  assert.equal(r.json.workspace.seq, 0);
  assert.equal((await post(good)).status, 409);
  const other = memberKey();
  assert.equal((await post(createBody(other, device(other)))).json.error, 'exists', 'one per account');
  const s = await call('GET', '/v1/sync/workspace', { headers: a.h });
  assert.deepEqual([s.json.enabled, s.json.plan.tier, s.json.plan.readOnly, s.json.workspace.id], [true, 'pro', false, mk.id]);
  const d = await call('GET', '/v1/sync/devices', { headers: a.h });
  assert.deepEqual(d.json.devices.map((x) => [x.tag, x.revokedAt, x.cert.name]), [[pc.tag, null, 'Home PC']]);
  assert.ok(w.verifyDeviceCert(mk.pubB64, mk.id, d.json.devices[0].cert, d.json.devices[0].certSig));
  // Another account sees none of it.
  const b = await account();
  assert.equal((await call('GET', '/v1/sync/devices', { headers: b.h })).json.error, 'no_workspace');
});

async function withWorkspace(opts = {}) {
  const a = await account(opts);
  const mk = memberKey();
  const pc = device(mk);
  const r = await call('POST', '/v1/sync/workspace', { headers: a.h, body: createBody(mk, pc) });
  assert.equal(r.status, 201, r.text);
  return { ...a, mk, pc };
}

test('devices: add (MK-signed only), revoke (MK-signed), a revoked tag cannot come back', async () => {
  const { h, mk, pc } = await withWorkspace();
  const web = device(mk, 'Chrome', 'web');
  const stranger = memberKey();
  const forged = device(stranger, 'Evil', 'web');
  assert.equal((await call('POST', '/v1/sync/devices', { headers: h, body: { cert: { ...forged.cert, ws: mk.id }, certSig: forged.certSig } })).json.error, 'bad_certificate');
  assert.equal((await call('POST', '/v1/sync/devices', { headers: h, body: { cert: web.cert, certSig: web.certSig } })).status, 201);
  assert.equal((await call('POST', '/v1/sync/devices', { headers: h, body: { cert: web.cert, certSig: web.certSig } })).json.error, 'exists');
  const rev = { v: 1, ws: mk.id, tag: web.tag, at: Date.now() };
  assert.equal((await call('POST', `/v1/sync/devices/${web.tag}/revoke`, { headers: h, body: { revocation: rev, sig: stranger.sign(w.revocationMessage(rev)) } })).json.error, 'bad_signature');
  assert.equal((await call('POST', `/v1/sync/devices/${pc.tag}/revoke`, { headers: h, body: { revocation: rev, sig: mk.sign(w.revocationMessage(rev)) } })).json.error, 'bad_signature', 'tag must match the path');
  assert.equal((await call('POST', `/v1/sync/devices/${web.tag}/revoke`, { headers: h, body: { revocation: rev, sig: mk.sign(w.revocationMessage(rev)) } })).status, 200);
  const list = (await call('GET', '/v1/sync/devices', { headers: h })).json.devices;
  assert.ok(list.find((d) => d.tag === web.tag).revokedAt > 0);
  assert.equal((await call('POST', '/v1/sync/devices', { headers: h, body: { cert: web.cert, certSig: web.certSig } })).json.error, 'revoked');
  // A revoked device can no longer write.
  const res = await call('POST', '/v1/sync/records', { headers: h, body: { writes: [writeFor(mk, web, rid(), 1)] } });
  assert.deepEqual(res.json.results.map((x) => x.error), ['forbidden']);
});

test('records: signed writes only, compare-and-swap, sequence order, pagination, quota', async () => {
  const { h, mk, pc } = await withWorkspace();
  const post = (writes) => call('POST', '/v1/sync/records', { headers: h, body: { writes } });
  const r1 = rid();
  const r2 = rid();
  let res = await post([writeFor(mk, pc, r1, 1), writeFor(mk, pc, r2, 1)]);
  assert.deepEqual(res.json.results, [{ rid: r1, ok: true, seq: 1 }, { rid: r2, ok: true, seq: 2 }]);
  // Same version again: conflict with the version the server holds; a skipped version too.
  res = await post([writeFor(mk, pc, r1, 1), writeFor(mk, pc, r2, 3)]);
  assert.deepEqual(res.json.results.map((x) => [x.error, x.version]), [['conflict', 1], ['conflict', 1]]);
  res = await post([writeFor(mk, pc, r1, 2)]);
  assert.deepEqual(res.json.results, [{ rid: r1, ok: true, seq: 3 }]);
  // Forged signature, a device the server never saw, a bad id, a body too large.
  const bad = writeFor(mk, pc, rid(), 1);
  const stranger = device(memberKey());
  res = await post([{ ...bad, sig: writeFor(mk, pc, bad.rid, 2).sig }, writeFor(mk, { ...stranger, tag: pc.tag }, rid(), 1), { ...bad, rid: 'short' }, writeFor(mk, pc, rid(), 1, 513 * 1024)]);
  assert.deepEqual(res.json.results.map((x) => x.error), ['forbidden', 'forbidden', 'invalid', 'too_large']);
  assert.equal((await post([])).status, 400);
  // Reads: ordered by sequence, paginated, each row as written.
  let page = await call('GET', '/v1/sync/records?since=0&limit=2', { headers: h });
  assert.deepEqual(page.json.records.map((x) => [x.rid, x.version, x.seq, x.dev]), [[r2, 1, 2, pc.tag], [r1, 2, 3, pc.tag]]);
  assert.equal(page.json.more, false);
  page = await call('GET', '/v1/sync/records?since=0&limit=1', { headers: h });
  assert.deepEqual([page.json.records.length, page.json.seq, page.json.more], [1, 2, true]);
  page = await call('GET', '/v1/sync/records?since=3', { headers: h });
  assert.deepEqual([page.json.records.length, page.json.seq, page.json.more], [0, 3, false]);
  assert.equal((await call('GET', '/v1/sync/records?since=-1', { headers: h })).status, 400);
  assert.equal((await call('GET', '/v1/sync/records?since=0&limit=1001', { headers: h })).status, 400);
  const one = await call('GET', `/v1/sync/records/${r1}`, { headers: h });
  assert.equal(one.json.record.version, 2);
  assert.ok(w.verifyEd25519(pc.cert.signPub, w.recordSignMessage(mk.id, r1, 2, Buffer.from(one.json.record.body, 'base64url')), one.json.record.sig));
  assert.equal((await call('GET', `/v1/sync/records/${rid()}`, { headers: h })).status, 404);
  const ws = (await call('GET', '/v1/sync/workspace', { headers: h })).json.workspace;
  assert.deepEqual([ws.seq, ws.bytesUsed], [3, 2048]);
  // Quota (counted on the body size; a rewrite counts only the difference).
  process.env.CLOUD_SYNC_QUOTA_PRO_MB = String(4000 / (1024 * 1024));
  res = await post([writeFor(mk, pc, rid(), 1, 2000), writeFor(mk, pc, rid(), 1, 600), writeFor(mk, pc, r2, 2, 1000)]);
  assert.deepEqual(res.json.results.map((x) => x.ok || x.error), ['quota', true, true]);
  // A big batch goes past the global 256 KB body limit (this router parses up to 8 MB).
  delete process.env.CLOUD_SYNC_QUOTA_PRO_MB;
  res = await post([writeFor(mk, pc, rid(), 1, 300 * 1024)]);
  assert.equal(res.status, 200);
  assert.equal(res.json.results[0].ok, true);
});

test('keyring: device-signed, compare-and-swap on the version; recovery wrap: MK-signed', async () => {
  const { h, mk, pc } = await withWorkspace();
  const ring = crypto.randomBytes(300);
  const put = (body) => call('PUT', '/v1/sync/workspace/keyring', { headers: h, body });
  const signed = (version, by = pc) => ({ keyring: b64(ring), version, dev: pc.tag, sig: by.sign(w.keyringSignMessage(mk.id, version, ring)) });
  assert.equal((await put(signed(2, device(mk)))).json.error, 'forbidden');
  const c = await put(signed(3));
  assert.deepEqual([c.status, c.json.version], [409, 1]);
  assert.equal((await put(signed(2))).status, 200);
  const ws = (await call('GET', '/v1/sync/workspace', { headers: h })).json.workspace;
  assert.deepEqual([ws.keyringVersion, ws.keyring], [2, b64(ring)]);
  const wrap = crypto.randomBytes(76);
  const at = Date.now();
  const rec = (sig) => call('PUT', '/v1/sync/workspace/recovery', { headers: h, body: { recoveryWrap: b64(wrap), at, sig } });
  assert.equal((await rec(mk.sign(w.actionMessage('recovery', mk.id, at, 'nope')))).json.error, 'bad_signature');
  assert.equal((await rec(mk.sign(w.actionMessage('recovery', mk.id, at, w.sha256(wrap).toString('base64url'))))).status, 200);
  assert.equal((await call('GET', '/v1/sync/workspace', { headers: h })).json.workspace.recoveryWrap, b64(wrap));
});

test('enrolment: request, list, approve (registers the device), status, deny, limits', async () => {
  const { h, mk } = await withWorkspace();
  const web = device(mk, 'Chrome on laptop', 'web');
  const request = { signPub: web.cert.signPub, dhPub: web.cert.dhPub, name: 'Chrome on laptop', platform: 'web', mac: b64(crypto.randomBytes(32)) };
  assert.equal((await call('POST', '/v1/sync/enrol', { headers: h, body: { request: { ...request, platform: 'tv' } } })).status, 400);
  assert.equal((await call('POST', '/v1/sync/enrol', { headers: h, body: { request: { ...request, signPub: 'abc' } } })).status, 400);
  const e = await call('POST', '/v1/sync/enrol', { headers: h, body: { request } });
  assert.equal(e.status, 201);
  assert.ok(e.json.expiresAt > Date.now() + 9 * 60000);
  const pending = (await call('GET', '/v1/sync/enrol', { headers: h })).json.requests;
  assert.deepEqual(pending.map((p) => [p.id, p.request.mac]), [[e.json.id, request.mac]]);
  assert.deepEqual((await call('GET', `/v1/sync/enrol/${e.json.id}`, { headers: h })).json, { status: 'pending' });
  // A certificate for other keys is refused; so is one the MK did not sign.
  const other = device(mk, 'x', 'web');
  const approval = { mkWrap: b64(crypto.randomBytes(100)), cert: web.cert, certSig: web.certSig, mac: b64(crypto.randomBytes(32)) };
  assert.equal((await call('POST', `/v1/sync/enrol/${e.json.id}/approve`, { headers: h, body: { approval: { ...approval, cert: other.cert, certSig: other.certSig } } })).status, 400);
  assert.equal((await call('POST', `/v1/sync/enrol/${e.json.id}/approve`, { headers: h, body: { approval: { ...approval, certSig: other.certSig } } })).json.error, 'bad_certificate');
  assert.equal((await call('POST', `/v1/sync/enrol/${e.json.id}/approve`, { headers: h, body: { approval } })).status, 200);
  assert.equal((await call('POST', `/v1/sync/enrol/${e.json.id}/approve`, { headers: h, body: { approval } })).status, 409);
  const st = await call('GET', `/v1/sync/enrol/${e.json.id}`, { headers: h });
  assert.deepEqual([st.json.status, st.json.approval.mkWrap, st.json.approval.mac], ['approved', approval.mkWrap, approval.mac]);
  assert.ok((await call('GET', '/v1/sync/devices', { headers: h })).json.devices.some((d) => d.tag === web.tag && !d.revokedAt));
  assert.deepEqual((await call('GET', '/v1/sync/enrol', { headers: h })).json.requests, []);
  // The new device can write now.
  const res = await call('POST', '/v1/sync/records', { headers: h, body: { writes: [writeFor(mk, web, rid(), 1)] } });
  assert.equal(res.json.results[0].ok, true);
  // Deny; at most 5 waiting; expired ones say so.
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await call('POST', '/v1/sync/enrol', { headers: h, body: { request } })).json.id);
  assert.equal((await call('POST', '/v1/sync/enrol', { headers: h, body: { request } })).json.error, 'too_many');
  assert.equal((await call('POST', `/v1/sync/enrol/${ids[0]}/deny`, { headers: h, body: {} })).status, 200);
  assert.equal((await call('GET', `/v1/sync/enrol/${ids[0]}`, { headers: h })).json.status, 'denied');
  await db.syncEnrolment.updateMany({ where: { id: ids[1] }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await call('GET', `/v1/sync/enrol/${ids[1]}`, { headers: h })).json.status, 'expired');
  assert.equal((await call('POST', `/v1/sync/enrol/${ids[1]}/approve`, { headers: h, body: { approval } })).status, 410);
  assert.equal((await call('GET', '/v1/sync/enrol/nope', { headers: h })).status, 404);
});

test('a lapsed plan (Free) is read-only; delete still works and needs the MK', async () => {
  const a = await withWorkspace();
  const r1 = rid();
  await call('POST', '/v1/sync/records', { headers: a.h, body: { writes: [writeFor(a.mk, a.pc, r1, 1)] } });
  await db.customer.update({ where: { id: a.customer.id }, data: { tier: null, status: 'lead' } });
  const s = await call('GET', '/v1/sync/workspace', { headers: a.h });
  assert.deepEqual([s.json.plan.allowed, s.json.plan.tier, s.json.plan.readOnly, s.json.workspace.quotaBytes], [false, 'free', true, 1024]);
  assert.equal((await call('GET', '/v1/sync/records?since=0', { headers: a.h })).json.records.length, 1);
  assert.equal((await call('POST', '/v1/sync/records', { headers: a.h, body: { writes: [writeFor(a.mk, a.pc, r1, 2)] } })).json.error, 'plan_required');
  const dev = device(a.mk, 'Chrome', 'web');
  assert.equal((await call('POST', '/v1/sync/devices', { headers: a.h, body: { cert: dev.cert, certSig: dev.certSig } })).json.error, 'plan_required');
  const fresh = await account({ tier: null, status: 'lead' });
  const mk2 = memberKey();
  assert.equal((await call('POST', '/v1/sync/workspace', { headers: fresh.h, body: createBody(mk2, device(mk2)) })).json.error, 'plan_required');
  const trial = await account({ tier: null, status: 'trial' });
  assert.equal((await call('GET', '/v1/sync/workspace', { headers: trial.h })).json.plan.tier, 'trial');
  const at = Date.now();
  assert.equal((await call('DELETE', '/v1/sync/workspace', { headers: a.h, body: { at, sig: memberKey().sign(w.actionMessage('delete', a.mk.id, at, '')) } })).json.error, 'bad_signature');
  assert.equal((await call('DELETE', '/v1/sync/workspace', { headers: a.h, body: { at, sig: a.mk.sign(w.actionMessage('delete', a.mk.id, at, '')) } })).status, 200);
  assert.equal((await call('GET', '/v1/sync/workspace', { headers: a.h })).json.workspace, null);
  assert.equal(await db.syncRecord.count({ where: { workspaceId: a.mk.id } }), 0);
  assert.equal(await db.syncDevice.count({ where: { workspaceId: a.mk.id } }), 0);
});

test('enterprise quota is 1 GB; CORS preflight for the web app', async () => {
  const a = await account({ tier: 'enterprise' });
  assert.equal((await call('GET', '/v1/sync/workspace', { headers: a.h })).json.plan.quotaBytes, 1024 * 1024 * 1024);
  const pre = await call('OPTIONS', '/v1/sync/records', { headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), WEB_ORIGIN);
  assert.match(pre.headers.get('access-control-allow-methods'), /PUT/);
  const evil = await call('OPTIONS', '/v1/sync/records', { headers: { origin: 'https://evil.test' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.equal((await call('GET', '/v1/sync/workspace', { headers: a.h })).headers.get('cache-control'), 'no-store');
});

test('account erasure deletes the workspace, its devices, records and enrolments', async () => {
  const a = await withWorkspace();
  await call('POST', '/v1/sync/records', { headers: a.h, body: { writes: [writeFor(a.mk, a.pc, rid(), 1)] } });
  const web = device(a.mk, 'Chrome', 'web');
  await call('POST', '/v1/sync/enrol', { headers: a.h, body: { request: { signPub: web.cert.signPub, dhPub: web.cert.dhPub, name: 'Chrome', platform: 'web', mac: b64(crypto.randomBytes(32)) } } });
  assert.ok(await eraseCustomer(db, T, a.customer.id));
  for (const m of ['syncRecord', 'syncDevice', 'syncEnrolment']) assert.equal(await db[m].count({ where: { workspaceId: a.mk.id } }), 0, m);
  assert.equal(await db.syncWorkspace.count({ where: { id: a.mk.id } }), 0);
});
