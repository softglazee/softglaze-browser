'use strict';
// Cloud sync phase 1: the encrypted workspace store behind /v1/sync/* (contract: @softglaze/protocol src/ws/api.ts).
// Every function takes the Prisma client and the signed-in customer and returns { status, body }. The server keeps
// ciphertext, public keys and signatures; it checks signatures (wsCrypto.js) so that a stolen account session can
// read ciphertext but not add a device or write records.
//
// Switches (env, read live):
//   CLOUD_SYNC              off (default) | beta | on
//   CLOUD_SYNC_BETA_EMAILS  comma list of account emails enabled while CLOUD_SYNC=beta
//   CLOUD_SYNC_QUOTA_PRO_MB / CLOUD_SYNC_QUOTA_ENTERPRISE_MB   default 100 / 1024 (trial = Pro)
// Plans: Pro, Enterprise and trial may write; Free (plan lapsed) is read-only: GET and DELETE still work.
const crypto = require('node:crypto');
const { accountPlan } = require('../auth/accountApi');
const w = require('./wsCrypto');

const MB = 1024 * 1024;
const ACTION_MAX_SKEW_MS = 10 * 60000;
const ENROL_TTL_MS = 10 * 60000;
const ENROL_MAX_PENDING = 5;
const ENROL_KEEP_MS = 60 * 60000; // expired requests answer "expired" for an hour, then are deleted
const MAX_RECORD_BYTES = 512 * 1024;
const MAX_KEYRING_BYTES = 1024 * 1024;
const MAX_WRITES = 500;
const RID_RE = /^[A-Za-z0-9_-]{22}$/;
const TAG_RE = /^[A-Za-z0-9_-]{11}$/;
const WS_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const SEEN_EVERY_MS = 60 * 60000;

const ok = (body, status = 200) => ({ status, body });
const fail = (status, error, message) => ({ status, body: message ? { error, message } : { error } });
const ms = (d) => (d instanceof Date ? d.getTime() : d == null ? null : new Date(d).getTime());
const bytes = (v) => (v == null ? Buffer.alloc(0) : Buffer.from(v));

function mode() {
  const m = String(process.env.CLOUD_SYNC || 'off').trim().toLowerCase();
  return m === 'on' || m === 'beta' ? m : 'off';
}

function enabledFor(customer) {
  const m = mode();
  if (m === 'on') return true;
  if (m !== 'beta' || !customer || !customer.email) return false;
  const list = String(process.env.CLOUD_SYNC_BETA_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(customer.email).trim().toLowerCase());
}

function quotaMb(name, def) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 && n <= 100000 ? n : def;
}

function planFor(customer) {
  const tier = accountPlan(customer);
  const allowed = tier === 'pro' || tier === 'enterprise' || tier === 'trial';
  const quotaBytes = tier === 'enterprise' ? Math.round(quotaMb('CLOUD_SYNC_QUOTA_ENTERPRISE_MB', 1024) * MB)
    : allowed ? Math.round(quotaMb('CLOUD_SYNC_QUOTA_PRO_MB', 100) * MB) : 0;
  return { allowed, tier, quotaBytes };
}

// A quota for an existing workspace whose plan lapsed: what it holds (reads still work).
function quotaOf(plan, ws) {
  return plan.allowed ? plan.quotaBytes : Math.max(0, ws ? ws.bytesUsed : 0);
}

function workspaceInfo(ws, plan) {
  return {
    id: ws.id,
    ownerSignPub: ws.ownerSignPub,
    keyring: bytes(ws.keyring).toString('base64url'),
    keyringVersion: ws.keyringVersion,
    recoveryWrap: bytes(ws.recoveryWrap).toString('base64url'),
    bytesUsed: ws.bytesUsed,
    quotaBytes: quotaOf(plan, ws),
    seq: ws.seq,
    createdAt: ms(ws.createdAt)
  };
}

async function workspaceOf(db, customer) {
  const ws = await db.syncWorkspace.findUnique({ where: { customerId: customer.id } });
  return ws && ws.tenantId === customer.tenantId ? ws : null;
}

function fresh(at, now) {
  return typeof at === 'number' && Number.isFinite(at) && Math.abs(now - at) <= ACTION_MAX_SKEW_MS;
}

function deviceRow(d) {
  let cert = null;
  try { cert = JSON.parse(d.certJson); } catch (_) { cert = null; }
  return { tag: d.tag, cert, certSig: d.certSig, revokedAt: ms(d.revokedAt) };
}

// ---- Workspace ------------------------------------------------------------------------------------

async function status(db, customer) {
  const plan = planFor(customer);
  const planOut = { allowed: plan.allowed, tier: plan.tier, quotaBytes: plan.quotaBytes, readOnly: false };
  if (!enabledFor(customer)) return ok({ enabled: false, plan: planOut, workspace: null });
  const ws = await workspaceOf(db, customer);
  planOut.readOnly = Boolean(ws) && !plan.allowed;
  return ok({ enabled: true, plan: planOut, workspace: ws ? workspaceInfo(ws, plan) : null });
}

async function create(db, customer, body, { now = Date.now() } = {}) {
  const plan = planFor(customer);
  if (!plan.allowed) return fail(403, 'plan_required', 'Cloud sync is part of Pro and Enterprise.');
  const b = body || {};
  const ownerPub = w.b64u(b.ownerSignPub);
  const keyring = w.b64u(b.keyring);
  const recoveryWrap = w.b64u(b.recoveryWrap);
  if (typeof b.id !== 'string' || !WS_ID_RE.test(b.id) || !ownerPub || ownerPub.length !== 32) return fail(400, 'invalid', 'Bad workspace id or key.');
  if (w.workspaceIdOf(ownerPub) !== b.id) return fail(400, 'invalid', 'The workspace id does not belong to this key.');
  if (!keyring || !keyring.length || keyring.length > MAX_KEYRING_BYTES || !Number.isInteger(b.keyringVersion) || b.keyringVersion < 1) return fail(400, 'invalid', 'Bad keyring.');
  if (!recoveryWrap || !recoveryWrap.length || recoveryWrap.length > 4096) return fail(400, 'invalid', 'Bad recovery wrap.');
  if (!fresh(b.at, now)) return fail(400, 'stale', 'The request time is too far from the server time.');
  if (!w.verifyEd25519(ownerPub, w.actionMessage('create', b.id, b.at, b.ownerSignPub), b.sig)) return fail(403, 'bad_signature');
  const dev = b.device || {};
  if (!w.verifyDeviceCert(ownerPub, b.id, dev.cert, dev.certSig)) return fail(403, 'bad_certificate');
  if (await workspaceOf(db, customer)) return fail(409, 'exists', 'This account already has a workspace.');
  if (await db.syncWorkspace.findUnique({ where: { id: b.id } })) return fail(409, 'exists');
  try {
    const ws = await db.$transaction(async (tx) => {
      const row = await tx.syncWorkspace.create({
        data: { id: b.id, tenantId: customer.tenantId, customerId: customer.id, ownerSignPub: b.ownerSignPub, keyring, keyringVersion: b.keyringVersion, recoveryWrap, bytesUsed: 0, seq: 0, status: 'active' }
      });
      await tx.syncDevice.create({ data: deviceData(b.id, dev.cert, dev.certSig, now) });
      return row;
    });
    return ok({ workspace: workspaceInfo(ws, plan) }, 201);
  } catch (e) {
    if (e && e.code === 'P2002') return fail(409, 'exists');
    throw e;
  }
}

function deviceData(workspaceId, cert, certSig, now) {
  return {
    workspaceId, tag: cert.tag, signPub: cert.signPub, dhPub: cert.dhPub, name: cert.name, platform: cert.platform,
    certJson: JSON.stringify(cert), certSig, lastSeenAt: new Date(now)
  };
}

async function deleteAll(db, workspaceId) {
  await db.syncRecord.deleteMany({ where: { workspaceId } });
  await db.syncDevice.deleteMany({ where: { workspaceId } });
  await db.syncEnrolment.deleteMany({ where: { workspaceId } });
  await db.syncWorkspace.deleteMany({ where: { id: workspaceId } });
}

async function remove(db, customer, ws, body, { now = Date.now() } = {}) {
  const b = body || {};
  if (!fresh(b.at, now)) return fail(400, 'stale', 'The request time is too far from the server time.');
  if (!w.verifyEd25519(ws.ownerSignPub, w.actionMessage('delete', ws.id, b.at, ''), b.sig)) return fail(403, 'bad_signature');
  await db.$transaction(async (tx) => deleteAll(tx, ws.id));
  return ok({ ok: true });
}

async function activeDevice(db, ws, tag) {
  if (typeof tag !== 'string' || !TAG_RE.test(tag)) return null;
  const d = await db.syncDevice.findFirst({ where: { workspaceId: ws.id, tag } });
  return d && !d.revokedAt ? d : null;
}

async function putKeyring(db, customer, ws, body) {
  if (!planFor(customer).allowed) return fail(403, 'plan_required');
  const b = body || {};
  const keyring = w.b64u(b.keyring);
  if (!keyring || !keyring.length || keyring.length > MAX_KEYRING_BYTES || !Number.isInteger(b.version) || b.version < 1) return fail(400, 'invalid');
  const dev = await activeDevice(db, ws, b.dev);
  if (!dev || !w.verifyEd25519(dev.signPub, w.keyringSignMessage(ws.id, b.version, keyring), b.sig)) return fail(403, 'forbidden');
  if (b.version !== ws.keyringVersion + 1) return { status: 409, body: { error: 'conflict', version: ws.keyringVersion } };
  const r = await db.syncWorkspace.updateMany({ where: { id: ws.id, keyringVersion: ws.keyringVersion }, data: { keyring, keyringVersion: b.version } });
  if (r.count !== 1) {
    const cur = await db.syncWorkspace.findUnique({ where: { id: ws.id } });
    return { status: 409, body: { error: 'conflict', version: cur ? cur.keyringVersion : 0 } };
  }
  return ok({ ok: true });
}

async function putRecovery(db, customer, ws, body, { now = Date.now() } = {}) {
  const b = body || {};
  const wrap = w.b64u(b.recoveryWrap);
  if (!wrap || !wrap.length || wrap.length > 4096) return fail(400, 'invalid');
  if (!fresh(b.at, now)) return fail(400, 'stale');
  const extra = w.sha256(wrap).toString('base64url');
  if (!w.verifyEd25519(ws.ownerSignPub, w.actionMessage('recovery', ws.id, b.at, extra), b.sig)) return fail(403, 'bad_signature');
  await db.syncWorkspace.update({ where: { id: ws.id }, data: { recoveryWrap: wrap } });
  return ok({ ok: true });
}

// ---- Devices --------------------------------------------------------------------------------------

async function listDevices(db, ws) {
  const rows = await db.syncDevice.findMany({ where: { workspaceId: ws.id }, orderBy: { id: 'asc' } });
  return ok({ devices: rows.map(deviceRow) });
}

async function addDevice(db, customer, ws, body, { now = Date.now() } = {}) {
  if (!planFor(customer).allowed) return fail(403, 'plan_required');
  const b = body || {};
  if (!w.verifyDeviceCert(ws.ownerSignPub, ws.id, b.cert, b.certSig)) return fail(403, 'bad_certificate');
  const existing = await db.syncDevice.findFirst({ where: { workspaceId: ws.id, tag: b.cert.tag } });
  if (existing) return fail(409, existing.revokedAt ? 'revoked' : 'exists');
  try {
    await db.syncDevice.create({ data: deviceData(ws.id, b.cert, b.certSig, now) });
  } catch (e) {
    if (e && e.code === 'P2002') return fail(409, 'exists');
    throw e;
  }
  return ok({ ok: true }, 201);
}

async function revokeDevice(db, ws, tag, body, { now = Date.now() } = {}) {
  const b = body || {};
  if (!w.verifyRevocation(ws.ownerSignPub, ws.id, b.revocation, b.sig) || b.revocation.tag !== tag) return fail(403, 'bad_signature');
  const d = await db.syncDevice.findFirst({ where: { workspaceId: ws.id, tag } });
  if (!d) return fail(404, 'not_found');
  if (!d.revokedAt) await db.syncDevice.update({ where: { id: d.id }, data: { revokedAt: new Date(now) } });
  return ok({ ok: true });
}

// ---- Enrolment ------------------------------------------------------------------------------------

function cleanRequest(r) {
  if (!r || typeof r !== 'object') return null;
  const sp = w.b64u(r.signPub);
  const dp = w.b64u(r.dhPub);
  if (!sp || sp.length !== 32 || !dp || dp.length !== 32) return null;
  if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 64 || /[\u0000-\u001f\u007f<>]/.test(r.name)) return null;
  if (!w.PLATFORMS.includes(r.platform)) return null;
  if (typeof r.mac !== 'string' || !w.b64u(r.mac) || w.b64u(r.mac).length !== 32) return null;
  return { signPub: r.signPub, dhPub: r.dhPub, name: r.name, platform: r.platform, mac: r.mac };
}

async function sweepEnrolments(db, ws, now) {
  await db.syncEnrolment.deleteMany({ where: { workspaceId: ws.id, expiresAt: { lt: new Date(now - ENROL_KEEP_MS) } } });
}

async function enrol(db, customer, ws, body, { now = Date.now() } = {}) {
  if (!planFor(customer).allowed) return fail(403, 'plan_required');
  const request = cleanRequest(body && body.request);
  if (!request) return fail(400, 'invalid', 'Bad enrolment request.');
  await sweepEnrolments(db, ws, now);
  const pending = await db.syncEnrolment.count({ where: { workspaceId: ws.id, status: 'pending', expiresAt: { gt: new Date(now) } } });
  if (pending >= ENROL_MAX_PENDING) return fail(429, 'too_many', 'Too many devices are waiting. Try again in a few minutes.');
  const id = crypto.randomBytes(16).toString('base64url');
  const expiresAt = now + ENROL_TTL_MS;
  await db.syncEnrolment.create({ data: { id, workspaceId: ws.id, requestJson: JSON.stringify(request), status: 'pending', createdAt: new Date(now), expiresAt: new Date(expiresAt) } });
  return ok({ id, expiresAt }, 201);
}

async function pendingEnrolments(db, ws, { now = Date.now() } = {}) {
  await sweepEnrolments(db, ws, now);
  const rows = await db.syncEnrolment.findMany({ where: { workspaceId: ws.id, status: 'pending', expiresAt: { gt: new Date(now) } }, orderBy: { createdAt: 'asc' } });
  return ok({ requests: rows.map((r) => ({ id: r.id, request: JSON.parse(r.requestJson), createdAt: ms(r.createdAt), expiresAt: ms(r.expiresAt) })) });
}

async function enrolRow(db, ws, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(id)) return null;
  const r = await db.syncEnrolment.findUnique({ where: { id } });
  return r && r.workspaceId === ws.id ? r : null;
}

async function enrolStatus(db, ws, id, { now = Date.now() } = {}) {
  const r = await enrolRow(db, ws, id);
  if (!r) return fail(404, 'not_found');
  if (ms(r.expiresAt) <= now) return ok({ status: 'expired' });
  if (r.status === 'approved') return ok({ status: 'approved', approval: JSON.parse(r.approvalJson) });
  return ok({ status: r.status });
}

async function approveEnrolment(db, customer, ws, id, body, { now = Date.now() } = {}) {
  if (!planFor(customer).allowed) return fail(403, 'plan_required');
  const r = await enrolRow(db, ws, id);
  if (!r) return fail(404, 'not_found');
  if (ms(r.expiresAt) <= now) return fail(410, 'expired');
  if (r.status !== 'pending') return fail(409, r.status);
  const a = body && body.approval;
  const wrap = a && w.b64u(a.mkWrap);
  if (!a || !wrap || !wrap.length || wrap.length > 1024 || typeof a.mac !== 'string' || !w.b64u(a.mac)) return fail(400, 'invalid');
  if (!w.verifyDeviceCert(ws.ownerSignPub, ws.id, a.cert, a.certSig)) return fail(403, 'bad_certificate');
  const req = JSON.parse(r.requestJson);
  if (a.cert.signPub !== req.signPub || a.cert.dhPub !== req.dhPub || a.cert.platform !== req.platform) return fail(400, 'invalid', 'Certificate for another device.');
  const existing = await db.syncDevice.findFirst({ where: { workspaceId: ws.id, tag: a.cert.tag } });
  if (existing) return fail(409, existing.revokedAt ? 'revoked' : 'exists');
  const approval = { mkWrap: a.mkWrap, cert: a.cert, certSig: a.certSig, mac: a.mac };
  try {
    await db.$transaction(async (tx) => {
      const claim = await tx.syncEnrolment.updateMany({ where: { id: r.id, status: 'pending' }, data: { status: 'approved', approvalJson: JSON.stringify(approval) } });
      if (claim.count !== 1) throw Object.assign(new Error('enrolment changed'), { code: 'ENROL_RACE' });
      await tx.syncDevice.create({ data: deviceData(ws.id, a.cert, a.certSig, now) });
    });
  } catch (e) {
    if (e && (e.code === 'ENROL_RACE' || e.code === 'P2002')) return fail(409, 'conflict');
    throw e;
  }
  return ok({ ok: true });
}

async function denyEnrolment(db, ws, id) {
  const r = await enrolRow(db, ws, id);
  if (!r) return fail(404, 'not_found');
  if (r.status === 'pending') await db.syncEnrolment.updateMany({ where: { id: r.id, status: 'pending' }, data: { status: 'denied' } });
  return ok({ ok: true });
}

// ---- Records --------------------------------------------------------------------------------------

function rowOut(r) {
  return { rid: r.rid, version: r.version, seq: r.seq, body: bytes(r.body).toString('base64url'), sig: r.sig, dev: r.dev };
}

async function changes(db, ws, query) {
  const since = Number(query && query.since);
  const limitIn = query && query.limit !== undefined ? Number(query.limit) : 500;
  if (!Number.isSafeInteger(since) || since < 0) return fail(400, 'invalid', 'Bad since.');
  if (!Number.isInteger(limitIn) || limitIn < 1 || limitIn > 1000) return fail(400, 'invalid', 'Bad limit.');
  const rows = await db.syncRecord.findMany({ where: { workspaceId: ws.id, seq: { gt: since } }, orderBy: { seq: 'asc' }, take: limitIn + 1 });
  const more = rows.length > limitIn;
  const page = rows.slice(0, limitIn);
  return ok({ records: page.map(rowOut), seq: page.length ? page[page.length - 1].seq : Math.max(ws.seq, since), more });
}

async function getRecord(db, ws, rid) {
  if (typeof rid !== 'string' || !RID_RE.test(rid)) return fail(400, 'invalid');
  const r = await db.syncRecord.findFirst({ where: { workspaceId: ws.id, rid } });
  return r ? ok({ record: rowOut(r) }) : fail(404, 'not_found');
}

class WriteRefused extends Error {
  constructor(result) { super(result.error); this.result = result; }
}

async function writeOne(db, ws, quota, write, body) {
  return db.$transaction(async (tx) => {
    // Raising the sequence first locks the workspace row: writes to one workspace are serialised.
    const cur = await tx.syncWorkspace.update({ where: { id: ws.id }, data: { seq: { increment: 1 } } });
    const rec = await tx.syncRecord.findFirst({ where: { workspaceId: ws.id, rid: write.rid } });
    const have = rec ? rec.version : 0;
    if (write.version !== have + 1) throw new WriteRefused({ rid: write.rid, ok: false, error: 'conflict', version: have });
    const delta = body.length - (rec ? rec.size : 0);
    if (delta > 0 && cur.bytesUsed + delta > quota) throw new WriteRefused({ rid: write.rid, ok: false, error: 'quota' });
    if (delta !== 0) await tx.syncWorkspace.update({ where: { id: ws.id }, data: { bytesUsed: { increment: delta } } });
    const data = { version: write.version, seq: cur.seq, body, sig: write.sig, dev: write.dev, size: body.length };
    if (rec) {
      const r = await tx.syncRecord.updateMany({ where: { id: rec.id, version: rec.version }, data });
      if (r.count !== 1) throw new WriteRefused({ rid: write.rid, ok: false, error: 'conflict', version: have });
    } else {
      try {
        await tx.syncRecord.create({ data: { workspaceId: ws.id, rid: write.rid, ...data } });
      } catch (e) {
        if (e && e.code === 'P2002') throw new WriteRefused({ rid: write.rid, ok: false, error: 'conflict', version: have });
        throw e;
      }
    }
    return { rid: write.rid, ok: true, seq: cur.seq };
  });
}

async function writeRecords(db, customer, ws, reqBody, { now = Date.now() } = {}) {
  const plan = planFor(customer);
  if (!plan.allowed) return fail(403, 'plan_required', 'Your plan no longer includes cloud sync: the workspace is read-only.');
  const writes = reqBody && reqBody.writes;
  if (!Array.isArray(writes) || writes.length < 1 || writes.length > MAX_WRITES) return fail(400, 'invalid', `Send 1 to ${MAX_WRITES} writes.`);
  const devices = new Map();
  for (const d of await db.syncDevice.findMany({ where: { workspaceId: ws.id } })) if (!d.revokedAt) devices.set(d.tag, d);
  const results = [];
  const used = new Set();
  for (const wr of writes) {
    const rid = wr && typeof wr.rid === 'string' ? wr.rid : '';
    if (!wr || !RID_RE.test(rid) || !Number.isInteger(wr.version) || wr.version < 1 || typeof wr.sig !== 'string' || typeof wr.dev !== 'string') {
      results.push({ rid, ok: false, error: 'invalid' });
      continue;
    }
    const body = w.b64u(wr.body);
    if (!body || !body.length) { results.push({ rid, ok: false, error: 'invalid' }); continue; }
    if (body.length > MAX_RECORD_BYTES) { results.push({ rid, ok: false, error: 'too_large' }); continue; }
    const dev = devices.get(wr.dev);
    if (!dev || !w.verifyEd25519(dev.signPub, w.recordSignMessage(ws.id, rid, wr.version, body), wr.sig)) {
      results.push({ rid, ok: false, error: 'forbidden' });
      continue;
    }
    try {
      results.push(await writeOne(db, ws, plan.quotaBytes, { rid, version: wr.version, sig: wr.sig, dev: wr.dev }, body));
      used.add(dev);
    } catch (e) {
      if (e instanceof WriteRefused) results.push(e.result);
      else throw e;
    }
  }
  for (const d of used) {
    if (!d.lastSeenAt || now - ms(d.lastSeenAt) >= SEEN_EVERY_MS) await db.syncDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date(now) } }).catch(() => {});
  }
  return ok({ results });
}

// Account erasure (src/customers/erase.js): everything of the customer's workspace.
async function eraseForCustomer(db, tenantId, customerId) {
  const ws = await db.syncWorkspace.findUnique({ where: { customerId } });
  if (!ws || ws.tenantId !== tenantId) return false;
  await deleteAll(db, ws.id);
  return true;
}

module.exports = {
  mode, enabledFor, planFor, workspaceOf, status, create, remove, putKeyring, putRecovery, listDevices, addDevice, revokeDevice,
  enrol, pendingEnrolments, enrolStatus, approveEnrolment, denyEnrolment, changes, getRecord, writeRecords, eraseForCustomer
};
