'use strict';
// Spec A5: templates, automations, outbox (retries, daily cap), unsubscribe, consent rules for custom
// sends; plus the cron runner and retention.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
const { scheduleAutomations } = require('../src/email/automations');
const { processOutbox, enqueue } = require('../src/email/outbox');
const { getSettings } = require('../src/settings');
const { tokenFor } = require('../src/email/unsubscribe');
const { runCron } = require('../src/cron');

const { db, mail, admin, call } = H;
const DAY = 86400000;
const HOUR = 3600000;
let T;
let tenant;
test.before(async () => {
  await H.start();
  T = (await H.seedTenant()).id;
  tenant = db.tables.tenant.find((t) => t.id === T);
  await admin('GET', '/email/templates'); // seeds the built-in templates, as the migration does live
});
test.after(() => H.stop());

async function customerWithTrial(email, { start, lang = 'en', consent = false, extra = {} } = {}) {
  const c = await db.customer.create({ data: { tenantId: T, email, emailKey: email, emailVerifiedAt: new Date(start), lang, marketingConsent: consent, ...extra } });
  const t = await db.trial.create({ data: { tenantId: T, customerId: c.id, machineHash: `m-${email}`, emailKeyHash: `e-${email}`, startedAt: new Date(start), endsAt: new Date(start + 7 * DAY) } });
  return { c, t };
}
const queuedFor = (cid) => db.tables.emailOutbox.filter((o) => o.customerId === cid);

test('automations fire at their offsets, once each, and respect paid status and consent', async () => {
  const start = Date.now() - 30 * DAY;
  const { c, t } = await customerWithTrial('auto1@example.com', { start });
  const s = await getSettings(db, T);
  const at = async (ms) => scheduleAutomations(db, tenant, { now: ms, settings: s });

  await at(start + HOUR);
  assert.deepEqual(queuedFor(c.id).map((o) => o.templateKey), ['welcome']);
  const welcome = queuedFor(c.id)[0];
  assert.equal(welcome.status, 'queued');
  assert.equal(welcome.category, 'lifecycle');
  assert.match(welcome.subject, /Welcome/);
  assert.match(welcome.html, /api\.test\/v1\/email\/unsubscribe\?t=/);
  await at(start + 2 * HOUR);
  assert.equal(queuedFor(c.id).length, 1, 'never twice');

  await at(start + 49 * HOUR);
  await at(t.endsAt.getTime() - 47 * HOUR);
  assert.deepEqual(queuedFor(c.id).map((o) => o.templateKey), ['welcome', 'tips', 'trial_ending']);
  assert.match(queuedFor(c.id)[2].subject, /trial ends on/);

  // Paid before the trial ended: the reminders are skipped (and decided once).
  db.tables.customer.find((x) => x.id === c.id).statusAuto = 'paid';
  await at(t.endsAt.getTime() + HOUR);
  const ended = queuedFor(c.id).find((o) => o.templateKey === 'trial_ended');
  assert.deepEqual([ended.status, ended.lastError, ended.html], ['skipped', 'paid', null]);

  // Too late to be useful: nothing is queued more than catchUpHours after it was due.
  const old = await customerWithTrial('auto-old@example.com', { start: Date.now() - 60 * DAY });
  await at(old.t.startedAt.getTime() + 5 * DAY);
  assert.ok(!queuedFor(old.c.id).some((o) => o.templateKey === 'welcome'));
});

test('come back needs marketing consent; Spanish customers get the Spanish copy; disabled automations stay off', async () => {
  const start = Date.now() - 20 * DAY;
  const no = await customerWithTrial('noconsent@example.com', { start });
  const yes = await customerWithTrial('consent@example.com', { start, consent: true, lang: 'es' });
  const s = await getSettings(db, T);
  await scheduleAutomations(db, tenant, { now: start + 337 * HOUR, settings: s });
  const n = queuedFor(no.c.id).find((o) => o.templateKey === 'come_back');
  assert.deepEqual([n.status, n.lastError], ['skipped', 'no_consent']);
  const y = queuedFor(yes.c.id).find((o) => o.templateKey === 'come_back');
  assert.equal(y.status, 'queued');
  assert.equal(y.category, 'marketing');
  assert.match(y.subject, /¿Sigue SoftGlaze Browser/);
  assert.match(y.html, /Darte de baja/);

  await H.admin('PUT', '/email/automations/welcome', { body: { enabled: false } });
  const off = await customerWithTrial('off@example.com', { start: Date.now() - HOUR });
  await scheduleAutomations(db, tenant, { now: Date.now(), settings: await getSettings(db, T) });
  assert.equal(queuedFor(off.c.id).length, 0);
  await H.admin('PUT', '/email/automations/welcome', { body: { enabled: true } });
  assert.equal((await H.admin('PUT', '/email/automations/welcome', { body: { offsetHours: 99999 } })).status, 400);
  assert.equal((await H.admin('PUT', '/email/automations/nope', { body: { enabled: true } })).status, 404);
});

test('outbox: sends with List-Unsubscribe one-click, retries transient errors, fails permanent ones', async () => {
  db.tables.emailOutbox = [];
  mail.sent = [];
  const c = await db.customer.create({ data: { tenantId: T, email: 'box@example.com', emailKey: 'box@example.com' } });
  const s = await getSettings(db, T);
  const q = (subject, category = 'lifecycle') => enqueue(db, T, { customer: c, category, subject, html: '<p>x</p>', text: 'x' });
  await q('ok one');
  await q('flaky');
  await q('bounced');
  mail.fail = (m) => {
    if (m.subject === 'flaky') return Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' });
    if (m.subject === 'bounced') return Object.assign(new Error('550 mailbox unavailable'), { code: 'EENVELOPE', responseCode: 550 });
    return null;
  };
  const now = Date.now();
  const r = await processOutbox(db, tenant, { now, settings: s });
  mail.fail = null;
  assert.deepEqual([r.sent, r.retrying, r.failed], [1, 1, 1]);
  const sent = mail.sent[0];
  assert.equal(sent.list.unsubscribe.url.startsWith('https://api.test/v1/email/unsubscribe?t='), true);
  assert.equal(sent.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(sent.replyTo, 'support@softglaze.com');
  const flaky = db.tables.emailOutbox.find((o) => o.subject === 'flaky');
  assert.deepEqual([flaky.status, flaky.attempts], ['queued', 1]);
  assert.equal(flaky.nextAttemptAt.getTime(), now + 5 * 60000);
  assert.match(flaky.lastError, /ETIMEDOUT/);
  assert.equal(db.tables.emailOutbox.find((o) => o.subject === 'bounced').status, 'failed');

  // Not due yet: nothing happens. Due: it goes.
  await processOutbox(db, tenant, { now: now + 60000, settings: s });
  assert.equal(mail.sent.length, 1);
  await processOutbox(db, tenant, { now: now + 6 * 60000, settings: s });
  assert.equal(flaky.status, 'sent');
  assert.equal(flaky.attempts, 2);

  // Five transient failures and it gives up.
  const again = await q('always down');
  mail.fail = (m) => (m.subject === 'always down' ? Object.assign(new Error('down'), { code: 'ECONNREFUSED' }) : null);
  let t = now;
  for (let i = 0; i < 6; i++) { t += 7 * HOUR; await processOutbox(db, tenant, { now: t, settings: s }); }
  mail.fail = null;
  const row = db.tables.emailOutbox.find((o) => o.id === again.id);
  assert.deepEqual([row.status, row.attempts], ['failed', 5]);
});

test('daily cap holds lifecycle and marketing mail; codes are never held; unsubscribed at send time is skipped', async () => {
  db.tables.emailOutbox = [];
  mail.sent = [];
  await H.admin('PATCH', '/settings', { body: { email: { dailyCap: 2 } } });
  const s = await getSettings(db, T);
  const mk = async (email, extra = {}) => db.customer.create({ data: { tenantId: T, email, emailKey: email, ...extra } });
  const a = await mk('cap-a@example.com');
  const b = await mk('cap-b@example.com');
  const c = await mk('cap-c@example.com');
  for (const x of [a, b, c]) await enqueue(db, T, { customer: x, category: 'lifecycle', subject: `hello ${x.email}`, html: '<p>x</p>', text: 'x' });
  await enqueue(db, T, { customer: c, category: 'essential', subject: 'code', html: '<p>1</p>', text: '1' });
  const r = await processOutbox(db, tenant, { now: Date.now(), settings: s });
  assert.equal(r.sent, 2, 'the code first (it counts towards the cap), then lifecycle up to the cap');
  assert.equal(r.heldByCap, 2);
  assert.equal(mail.sent[0].subject, 'code');
  assert.equal(mail.sent[0].list, undefined);
  await H.admin('PATCH', '/settings', { body: { email: { dailyCap: 300 } } });

  const d = await mk('late-unsub@example.com');
  await enqueue(db, T, { customer: d, category: 'lifecycle', subject: 'will be skipped', html: '<p>x</p>', text: 'x' });
  db.tables.customer.find((x) => x.id === d.id).unsubscribedAt = new Date();
  await processOutbox(db, tenant, { now: Date.now(), settings: await getSettings(db, T) });
  const row = db.tables.emailOutbox.find((o) => o.subject === 'will be skipped');
  assert.deepEqual([row.status, row.lastError], ['skipped', 'unsubscribed']);
});

test('unsubscribe: GET asks, POST (button or one-click) unsubscribes and cancels queued mail', async () => {
  const c = await db.customer.create({ data: { tenantId: T, email: 'leave@example.com', emailKey: 'leave@example.com', marketingConsent: true, lang: 'es' } });
  await enqueue(db, T, { customer: c, category: 'marketing', subject: 'news', html: '<p>x</p>', text: 'x' });
  const t = encodeURIComponent(tokenFor(c.id));
  const g = await call('GET', `/v1/email/unsubscribe?t=${t}`, { raw: true });
  assert.equal(g.status, 200);
  assert.match(g.text, /<form method="post"/);
  assert.match(g.text, /Darme de baja/);
  assert.match(g.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(db.tables.customer.find((x) => x.id === c.id).unsubscribedAt, null, 'a GET (link scanners) changes nothing');

  const p = await call('POST', `/v1/email/unsubscribe?t=${t}`, { body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: true });
  assert.equal(p.status, 200);
  const after = db.tables.customer.find((x) => x.id === c.id);
  assert.ok(after.unsubscribedAt);
  assert.equal(after.marketingConsent, false);
  assert.equal(after.consentSource, 'unsubscribe');
  assert.equal(db.tables.emailOutbox.find((o) => o.customerId === c.id).status, 'cancelled');
  assert.ok(db.tables.customerEvent.some((e) => e.customerId === c.id && e.type === 'unsubscribed' && e.data.via === 'one_click'));
  assert.equal((await call('GET', '/v1/email/unsubscribe?t=forged.token', { raw: true })).status, 400);
  const gone = await call('GET', `/v1/email/unsubscribe?t=${encodeURIComponent(tokenFor('erased_customer_1'))}`, { raw: true });
  assert.equal(gone.status, 200);
  assert.match(gone.text, /nothing to unsubscribe/);
});

test('custom sends: consent rules, preview counts, test send to yourself, campaign queue', async () => {
  const mk = (email, extra) => db.customer.create({ data: { tenantId: T, email, emailKey: email, tagIndex: ',launch,', tags: ['launch'], ...extra } });
  const yes = await mk('send-yes@example.com', { marketingConsent: true });
  await mk('send-no@example.com', {});
  await mk('send-unsub@example.com', { marketingConsent: true, unsubscribedAt: new Date() });
  await mk('send-deleted@example.com', { marketingConsent: true, deletedAt: new Date() });
  const content = { subject: 'Launch day, {{name}}', html: '<p>{{greeting}} SoftGlaze Browser is live.</p>', text: '{{greeting}} SoftGlaze Browser is live.' };
  const audience = { filters: { tag: 'launch' } };

  const m = await admin('POST', '/email/send', { body: { mode: 'preview', category: 'marketing', audience, ...content } });
  assert.equal(m.status, 200, m.text);
  assert.deepEqual(m.json.counts, { matched: 3, eligible: 1, skipped: { no_consent: 1, unsubscribed: 1 } });
  assert.match(m.json.sample.html, /unsubscribe\?t=preview-only\./, 'a preview never carries a real customer\'s unsubscribe link');
  const svc = await admin('POST', '/email/send', { body: { mode: 'preview', category: 'service', audience, ...content } });
  assert.equal(svc.json.counts.eligible, 2, 'service notices need no consent but honour unsubscribe');

  mail.sent = [];
  const tst = await admin('POST', '/email/send', { body: { mode: 'test', category: 'marketing', audience, testTo: 'Owner@SoftGlaze.com', ...content } });
  assert.equal(tst.status, 200, tst.text);
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, 'owner@softglaze.com');
  assert.match(mail.sent[0].subject, /^\[Test\] Launch day/);
  assert.ok(!mail.sent[0].html.includes(encodeURIComponent(tokenFor(yes.id))));

  const send = await admin('POST', '/email/send', { body: { mode: 'send', category: 'marketing', audience, ...content } });
  assert.equal(send.status, 202);
  assert.equal(send.json.queued, 1);
  const rows = db.tables.emailOutbox.filter((o) => o.campaignId === send.json.campaignId);
  assert.deepEqual(rows.map((r) => r.toEmail), ['send-yes@example.com']);

  const bad = await admin('POST', '/email/send', { body: { mode: 'preview', category: 'marketing', audience, subject: 'x {{secret}}', html: '<script>1</script>', text: 'x' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.fields.placeholders || bad.json.fields.html);
  const code = await admin('POST', '/email/send', { body: { mode: 'preview', category: 'service', audience, templateKey: 'verify_code' } });
  assert.equal(code.status, 400);
  const mkt = await admin('POST', '/email/send', { body: { mode: 'preview', category: 'service', audience, templateKey: 'come_back' } });
  assert.match(mkt.json.fields.category, /marketing/);
  const log = await admin('GET', `/email/outbox?campaignId=${send.json.campaignId}`);
  assert.equal(log.json.total, 1);
  assert.equal(log.json.items[0].html, undefined, 'the list leaves bodies out');
});

test('templates: built-ins seeded in en + es, editable, category locked, reset, custom create/delete, preview', async () => {
  const l = await admin('GET', '/email/templates');
  assert.equal(l.json.items.filter((t) => t.builtIn).length, 14);
  assert.ok(l.json.placeholders.includes('unsubscribeUrl'));
  const put = await admin('PUT', '/email/templates/welcome', { body: { lang: 'en', subject: 'Hello {{name}}', html: '<p>{{greeting}}</p><p>Custom.</p>', text: '{{greeting}} Custom.' } });
  assert.equal(put.status, 200);
  assert.equal(put.json.template.isDefault, false);
  assert.equal((await admin('PUT', '/email/templates/welcome', { body: { lang: 'en', category: 'marketing', subject: 'a', html: '<p>a</p>', text: 'a' } })).status, 400);
  const pv = await admin('POST', '/email/templates/welcome/preview', { body: { lang: 'en' } });
  assert.match(pv.json.html, /Custom\./);
  const rs = await admin('POST', '/email/templates/welcome/reset', { body: { lang: 'en' } });
  assert.equal(rs.json.template.subject, 'Welcome to SoftGlaze Browser');
  assert.equal(rs.json.template.isDefault, true);
  const cr = await admin('POST', '/email/templates', { body: { key: 'price-change', lang: 'en', name: 'Price change', category: 'service', subject: 'New prices', html: '<p>{{greeting}}</p>', text: '{{greeting}}' } });
  assert.equal(cr.status, 201);
  assert.equal((await admin('DELETE', '/email/templates/welcome')).status, 400);
  assert.equal((await admin('DELETE', '/email/templates/price-change?lang=en')).status, 200);
  const st = await admin('GET', '/email/status');
  assert.equal(st.json.smtp.configured, true);
  assert.ok('sentLast24h' in st.json && 'dailyCap' in st.json);
});

test('cron: one run at a time, reconciles, writes the snapshot and last result', async () => {
  const [r1, r2] = await Promise.all([runCron(db), runCron(db)]);
  const skipped = [r1, r2].filter((r) => r.skipped);
  assert.equal(skipped.length, 1, 'the second concurrent run backs off');
  const ran = r1.skipped ? r2 : r1;
  assert.ok(ran.tenants[T].snapshot.day);
  assert.equal(ran.tenants[T].errors, undefined, JSON.stringify(ran.tenants[T].errors));
  const lock = db.tables.jobLock[0];
  assert.equal(lock.lockedUntil, null);
  assert.ok(lock.lastFinishedAt && lock.lastResult);
  assert.equal(db.tables.metricSnapshot.length, 1);
  const again = await runCron(db);
  assert.ok(!again.skipped, 'released after the run');
  assert.equal(db.tables.metricSnapshot.length, 1, 'one snapshot per day, updated in place');
});

test('retention: unverified codes and sign-ups go after 30 days; customers with history stay; old bodies cleared', async () => {
  const old = new Date(Date.now() - 31 * DAY);
  await db.emailVerification.create({ data: { tenantId: T, installId: 'i', email: 'old@example.com', emailKey: 'old@example.com', codeHash: 'h', expiresAt: old, createdAt: old } });
  await db.emailVerification.create({ data: { tenantId: T, installId: 'i', email: 'kept@example.com', emailKey: 'kept@example.com', codeHash: 'h', expiresAt: old, createdAt: old, verifiedAt: old } });
  const stale = await db.customer.create({ data: { tenantId: T, email: 'stale@example.com', emailKey: 'stale@example.com', source: 'app', createdAt: old } });
  const withTrial = await db.customer.create({ data: { tenantId: T, email: 'tried@example.com', emailKey: 'tried@example.com', source: 'app', createdAt: old } });
  await db.trial.create({ data: { tenantId: T, customerId: withTrial.id, machineHash: 'mm', emailKeyHash: 'ee', startedAt: old, endsAt: old } });
  const manual = await db.customer.create({ data: { tenantId: T, email: 'manual@example.com', emailKey: 'manual@example.com', source: 'manual', createdAt: old } });
  const body = await db.emailOutbox.create({ data: { tenantId: T, toEmail: 'x@example.com', category: 'lifecycle', subject: 's', html: '<p>b</p>', text: 'b', status: 'sent', createdAt: new Date(Date.now() - 91 * DAY) } });
  await runCron(db);
  assert.equal(db.tables.emailVerification.some((v) => v.email === 'old@example.com'), false);
  assert.equal(db.tables.emailVerification.some((v) => v.email === 'kept@example.com'), true, 'a verified code is the proof the trial checks');
  assert.equal(db.tables.customer.some((c) => c.id === stale.id), false);
  assert.equal(db.tables.customer.some((c) => c.id === withTrial.id), true);
  assert.equal(db.tables.customer.some((c) => c.id === manual.id), true, 'owner-entered customers are never purged');
  const b = db.tables.emailOutbox.find((o) => o.id === body.id);
  assert.deepEqual([b.html, b.text, b.subject], [null, null, 's']);
});
