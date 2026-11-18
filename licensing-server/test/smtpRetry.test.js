'use strict';
// A dropped SMTP connection (Hostinger: "ECONNECTION Connection closed unexpectedly") on a send someone
// is waiting for: quick retries with a fresh transporter, then a row the very next cron run sends.
// Permanent refusals are never retried.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
const transport = require('../src/email/transport');
const { enqueue, sendNow, deliverQueued, processOutbox } = require('../src/email/outbox');
const { getSettings } = require('../src/settings');

const { db, mail, call } = H;
let T;
let tenant;
test.before(async () => {
  await H.start();
  T = (await H.seedTenant()).id;
  tenant = db.tables.tenant.find((t) => t.id === T);
});
test.after(() => { transport.setTransportForTests(mail); H.stop(); });

const err = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const dropped = () => err('ECONNECTION', 'Connection closed unexpectedly');

// A fake transport that throws the given errors in order, then succeeds.
function fakeTransport(errors) {
  const t = {
    calls: 0,
    sent: [],
    async sendMail(msg) {
      t.calls += 1;
      const e = errors.shift();
      if (e) throw e;
      t.sent.push(msg);
      return { messageId: `<f${t.sent.length}@test>` };
    }
  };
  return t;
}
async function withTransport(t, fn) {
  transport.setTransportForTests(t);
  try { return await fn(); } finally { transport.setTransportForTests(mail); }
}
const msg = { to: 'a@example.com', subject: 's', html: '<p>x</p>', text: 'x' };
const rendered = { subject: 'Hello', html: '<p>hi</p>', text: 'hi', category: 'essential', templateKey: null };

test('classifies connection drops as transient and SMTP refusals / bad logins as not', () => {
  for (const code of ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'EDNS']) assert.equal(transport.isTransient(err(code, 'x')), true, code);
  assert.equal(transport.isTransient(err('EAUTH', 'Invalid login', { responseCode: 535 })), false);
  assert.equal(transport.isTransient(err('EENVELOPE', 'mailbox unavailable', { responseCode: 550 })), false);
  assert.equal(transport.isTransient(err('ECONNECTION', 'refused', { responseCode: 554 })), false, 'a 5xx reply is permanent');
  assert.equal(transport.isTransient(err('NOT_CONFIGURED', 'x')), false);
});

test('fails once with ECONNECTION, then succeeds on the retry', async () => {
  const t = fakeTransport([dropped()]);
  const info = await withTransport(t, () => transport.sendMail(msg, { retry: true }));
  assert.equal(t.calls, 2);
  assert.equal(info.messageId, '<f1@test>');
});

test('without retry (the cron path) a transient error is thrown at once', async () => {
  const t = fakeTransport([dropped()]);
  await assert.rejects(withTransport(t, () => transport.sendMail(msg)), /Connection closed/);
  assert.equal(t.calls, 1);
});

test('EAUTH and a 550 are never retried', async () => {
  const auth = fakeTransport([err('EAUTH', 'Invalid login', { responseCode: 535 })]);
  await assert.rejects(withTransport(auth, () => transport.sendMail(msg, { retry: true })), /Invalid login/);
  assert.equal(auth.calls, 1);
  const bounce = fakeTransport([err('EENVELOPE', 'mailbox unavailable', { responseCode: 550 })]);
  await assert.rejects(withTransport(bounce, () => transport.sendMail(msg, { retry: true })), /mailbox unavailable/);
  assert.equal(bounce.calls, 1);
});

test('the retry recreates the real nodemailer transporter (the cached one is closed)', async () => {
  const keys = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_PORT'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { SMTP_HOST: 'smtp.invalid', SMTP_USER: 'u@example.com', SMTP_PASS: 'p', SMTP_FROM: 'u@example.com', SMTP_PORT: '465' });
  transport.setTransportForTests(null);
  try {
    const first = transport.getTransporter();
    assert.ok(first);
    assert.equal(transport.getTransporter(), first, 'cached while nothing failed');
    let closed = false;
    const origClose = first.close.bind(first);
    first.close = () => { closed = true; origClose(); };
    transport.resetTransporter();
    assert.equal(closed, true);
    assert.notEqual(transport.getTransporter(), first, 'a fresh transporter after a reset');
  } finally {
    transport.resetTransporter();
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    transport.setTransportForTests(mail);
  }
});

test('sendNow: three drops -> queued and due now when asked, failed otherwise; EAUTH and 550 fail at once', async () => {
  const before = Date.now();
  const t = fakeTransport([dropped(), dropped(), dropped()]);
  const r = await withTransport(t, () => sendNow(db, T, { toEmail: 'q@example.com', rendered, redact: true, queueOnTransient: true }));
  assert.equal(t.calls, 3, 'one send + two retries');
  assert.deepEqual([r.ok, r.queued], [false, true]);
  const row = db.tables.emailOutbox.find((o) => o.id === r.outboxId);
  assert.equal(row.status, 'queued');
  assert.ok(row.nextAttemptAt.getTime() <= Date.now() && row.nextAttemptAt.getTime() >= before, 'due now, not after the next cron tick');
  assert.equal(row.text, 'hi', 'the body is kept so the cron can send it');
  assert.match(row.lastError, /ECONNECTION/);

  const t2 = fakeTransport([dropped(), dropped(), dropped()]);
  const r2 = await withTransport(t2, () => sendNow(db, T, { toEmail: 'q2@example.com', rendered }));
  assert.equal(db.tables.emailOutbox.find((o) => o.id === r2.outboxId).status, 'failed', 'only callers that ask are queued');

  for (const e of [err('EAUTH', 'Invalid login', { responseCode: 535 }), err('EENVELOPE', 'mailbox unavailable', { responseCode: 550 })]) {
    const tp = fakeTransport([e]);
    const rp = await withTransport(tp, () => sendNow(db, T, { toEmail: 'p@example.com', rendered, queueOnTransient: true }));
    assert.equal(tp.calls, 1);
    assert.equal(rp.queued, undefined);
    assert.equal(db.tables.emailOutbox.find((o) => o.id === rp.outboxId).status, 'failed');
  }
});

test('activation email (deliverQueued): one drop is retried at once; three leave it due for the next cron run', async () => {
  const s = await getSettings(db, T);
  const q = (to) => enqueue(db, T, { toEmail: to, templateKey: 'activation_code', category: 'essential', subject: 'Your code', html: '<p>SG</p>', text: 'SG' });

  const a = await q('buyer1@example.com');
  const t1 = fakeTransport([dropped()]);
  assert.equal((await withTransport(t1, () => deliverQueued(db, T, a.id, { settings: s }))).status, 'sent');
  assert.equal(t1.calls, 2);

  const b = await q('buyer2@example.com');
  const now = Date.now();
  const t2 = fakeTransport([dropped(), dropped(), dropped()]);
  assert.equal((await withTransport(t2, () => deliverQueued(db, T, b.id, { settings: s, now }))).status, 'retrying');
  const row = db.tables.emailOutbox.find((o) => o.id === b.id);
  assert.deepEqual([row.status, row.attempts], ['queued', 1]);
  assert.ok(row.nextAttemptAt.getTime() <= now, 'the very next cron run takes it');

  // The next cron run (one try, no in-process retries) sends it.
  const t3 = fakeTransport([]);
  const out = await withTransport(t3, () => processOutbox(db, tenant, { now: now + 1000, settings: s }));
  assert.equal(out.sent >= 1, true);
  assert.equal(row.status, 'sent');
  assert.equal(t3.sent.some((m) => m.to === 'buyer2@example.com'), true);

  // A second immediate failure backs off as usual instead of staying due on every poll.
  const c = await q('buyer3@example.com');
  const cRow = db.tables.emailOutbox.find((o) => o.id === c.id);
  const later = Date.now();
  await withTransport(fakeTransport([dropped(), dropped(), dropped()]), () => deliverQueued(db, T, c.id, { settings: s, now: later }));
  await withTransport(fakeTransport([dropped(), dropped(), dropped()]), () => deliverQueued(db, T, c.id, { settings: s, now: later + 1000 }));
  assert.deepEqual([cRow.status, cRow.attempts], ['queued', 2]);
  assert.equal(cRow.nextAttemptAt.getTime(), later + 1000 + 30 * 60000);
});

test('verify_code: a dropped connection keeps the code valid and queued; the cron sends it, then forgets the body', async () => {
  const s = await getSettings(db, T);
  const inst = await H.newInstall(T, 'v-dropped');
  const body = { tenantId: T, ...inst, email: 'late@example.com', consentMarketing: false, lang: 'en' };
  mail.sent = [];
  mail.fail = () => dropped();
  const r = await call('POST', '/v1/account/verify/start', { body });
  mail.fail = null;
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.sent, r.json.queued], [false, true]);
  const v = db.tables.emailVerification.find((x) => x.installId === inst.installId);
  assert.ok(v, 'the code row is kept');
  const row = db.tables.emailOutbox.find((o) => o.dedupeKey === `verify:${v.id}`);
  assert.equal(row.status, 'queued', 'not failed');
  assert.ok(row.nextAttemptAt.getTime() <= Date.now());

  await processOutbox(db, tenant, { now: Date.now(), settings: s });
  assert.equal(row.status, 'sent');
  assert.deepEqual([row.html, row.text], [null, null], 'the code is not kept in the log');
  const code = mail.codeFor('late@example.com');
  assert.match(code, /^\d{6}$/);
  const ok = await call('POST', '/v1/account/verify/check', { body: { tenantId: T, ...inst, email: 'late@example.com', code } });
  assert.equal(ok.json.verified, true);
});

test('verify_code: a queued code that expired (a newer code expires it too) is skipped, not sent', async () => {
  const s = await getSettings(db, T);
  const inst = await H.newInstall(T, 'v-expired');
  mail.sent = [];
  mail.fail = () => dropped();
  const r = await call('POST', '/v1/account/verify/start', { body: { tenantId: T, ...inst, email: 'gone@example.com', consentMarketing: false, lang: 'en' } });
  mail.fail = null;
  assert.equal(r.json.queued, true);
  const v = db.tables.emailVerification.find((x) => x.installId === inst.installId);
  const row = db.tables.emailOutbox.find((o) => o.dedupeKey === `verify:${v.id}`);

  await processOutbox(db, tenant, { now: v.expiresAt.getTime() + 1000, settings: s });
  assert.deepEqual([row.status, row.lastError, row.html, row.text], ['skipped', 'code_expired', null, null]);
  assert.equal(mail.sent.some((m) => m.to === 'gone@example.com'), false);
});
