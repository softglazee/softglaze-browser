'use strict';
// Install channel (store | website | base), sent by the app from 1.0.23: recorded on register, licence
// refresh, verify/start and trial/start (latest valid value wins), never a reason to refuse a request,
// the customer's firstChannel, the admin installs filter and the metrics counts.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
const { cleanChannel, reconcileTenant } = require('../src/customers/sync');
const { countInstallsByChannel } = require('../src/metrics/maths');

const { db, call, admin } = H;
let T;
test.before(async () => { await H.start(); T = (await H.seedTenant()).id; });
test.after(() => H.stop());

const row = (installId) => db.tables.install.find((i) => i.id === installId);
const license = (inst, extra = {}) => call('POST', '/v1/license', { body: { tenantId: T, ...inst, ...extra } });

test('cleanChannel keeps store, website and base and drops anything else', () => {
  assert.equal(cleanChannel('store'), 'store');
  assert.equal(cleanChannel('website'), 'website');
  assert.equal(cleanChannel('base'), 'base');
  assert.equal(cleanChannel(' Store '), 'store');
  for (const bad of [undefined, null, '', 'unknown', 'msix', 'stores', 42, true, {}, ['store'], 'x'.repeat(5000)]) {
    assert.equal(cleanChannel(bad), null, JSON.stringify(bad));
  }
});

test('register records the channel and a licence refresh keeps the latest valid one', async () => {
  const inst = await H.newInstall(T, 'ch-latest', { channel: 'store' });
  assert.equal(row(inst.installId).channel, 'store');

  let r = await license(inst, { appVersion: '1.0.23', channel: 'website' });
  assert.equal(r.status, 200, r.text);
  assert.equal(row(inst.installId).channel, 'website', 'the latest value wins');
  assert.equal(row(inst.installId).appVersion, '1.0.23');

  r = await license(inst, { channel: 'nonsense' });
  assert.equal(r.status, 200, 'an unknown value is ignored, not refused');
  assert.equal(row(inst.installId).channel, 'website', 'and does not wipe the stored one');

  r = await license(inst);
  assert.equal(r.status, 200);
  assert.equal(row(inst.installId).channel, 'website', 'a request without channel keeps it');
});

test('older apps (no channel) and junk values are accepted exactly as before', async () => {
  const inst = await H.newInstall(T, 'ch-old', { appVersion: '1.0.22' });
  assert.equal(row(inst.installId).channel, null);
  assert.equal(row(inst.installId).appVersion, '1.0.22');
  const plain = await license(inst, { appVersion: '1.0.22' });
  for (const channel of [42, { x: 1 }, ['store'], 'x'.repeat(5000), null, '']) {
    const r = await license(inst, { appVersion: '1.0.22', channel });
    assert.equal(r.status, 200, JSON.stringify(channel));
    assert.deepEqual(Object.keys(r.json).sort(), Object.keys(plain.json).sort(), 'same answer as without it');
  }
  assert.equal(row(inst.installId).channel, null);

  // A junk channel on register never blocks the registration.
  const reg = await call('POST', '/v1/register', { body: { tenantId: T, machineId: 'mid-ch-junk', machineHash: H.mh('machine-ch-junk'), channel: { evil: true } } });
  assert.equal(reg.status, 200, reg.text);
  assert.equal(row(reg.json.installId).channel, null);
});

test('verify/start and trial/start record it too, and verify/check gives the customer its firstChannel', async () => {
  const inst = await H.newInstall(T, 'ch-verify');
  assert.equal(row(inst.installId).channel, null);
  const v = await H.verify(T, inst, 'chan.verify@example.com', { appVersion: '1.0.23', channel: 'website' });
  assert.equal(v.status, 200, v.text);
  assert.equal(row(inst.installId).channel, 'website', 'recorded by verify/start');
  const customer = db.tables.customer.find((c) => c.id === v.json.customerId);
  assert.equal(customer.firstChannel, 'website');

  const inst2 = await H.newInstall(T, 'ch-trial');
  await H.verify(T, inst2, 'chan.trial@example.com');
  const tr = await call('POST', '/v1/trial/start', { body: { tenantId: T, ...inst2, email: 'chan.trial@example.com', appVersion: '1.0.23', channel: 'store' } });
  assert.equal(tr.status, 200, tr.text);
  assert.equal(row(inst2.installId).channel, 'store', 'recorded by trial/start');
  assert.equal(db.tables.customer.find((c) => c.id === row(inst2.installId).customerId).firstChannel, 'store', 'the trial recompute fills it');
});

test("a customer's firstChannel is the channel of their earliest install, not the latest", async () => {
  const older = await H.newInstall(T, 'ch-first-a');
  const v1 = await H.verify(T, older, 'chan.first@example.com');
  assert.equal(v1.status, 200, v1.text);
  row(older.installId).createdAt = new Date(Date.now() - 30 * 86400000);
  const cid = v1.json.customerId;
  assert.equal(db.tables.customer.find((c) => c.id === cid).firstChannel, null, 'an app before 1.0.23 reported nothing');

  const newer = await H.newInstall(T, 'ch-first-b', { channel: 'store' });
  const v2 = await H.verify(T, newer, 'chan.first@example.com');
  assert.equal(v2.json.customerId, cid);
  assert.equal(db.tables.customer.find((c) => c.id === cid).firstChannel, 'store', 'the only channel known so far');

  // The older install updates to 1.0.23 and reports where it came from; the cron settles on it.
  await license(older, { appVersion: '1.0.23', channel: 'website' });
  await reconcileTenant(db, await db.tenant.findUnique({ where: { id: T } }));
  assert.equal(db.tables.customer.find((c) => c.id === cid).firstChannel, 'website');
});

test('GET /v1/admin/installs returns channel and filters by it', async () => {
  const mine = db.tables.install.filter((i) => i.tenantId === T);
  const ids = (r) => r.json.items.map((i) => i.id).sort();
  const expect = (pred) => mine.filter(pred).map((i) => i.id).sort();

  const all = await admin('GET', '/installs?pageSize=200');
  assert.equal(all.status, 200, all.text);
  assert.equal(all.json.total, mine.length);
  for (const item of all.json.items) {
    assert.ok('channel' in item, 'every item has channel');
    assert.equal(item.channel, row(item.id).channel);
    assert.equal('secretHash' in item, false);
  }

  const store = await admin('GET', '/installs?channel=store&pageSize=200');
  assert.deepEqual(ids(store), expect((i) => i.channel === 'store'));
  assert.ok(store.json.items.length >= 1 && store.json.items.every((i) => i.channel === 'store'));

  const unknown = await admin('GET', '/installs?channel=unknown&pageSize=200');
  assert.deepEqual(ids(unknown), expect((i) => i.channel == null));
  assert.ok(unknown.json.total >= 1);

  const mixed = await admin('GET', '/installs?channel=WEBSITE,unknown&pageSize=200');
  assert.deepEqual(ids(mixed), expect((i) => i.channel === 'website' || i.channel == null));
  assert.equal(mixed.json.total, mixed.json.items.length);

  const two = await admin('GET', '/installs?channel=store,website&pageSize=200');
  assert.deepEqual(ids(two), expect((i) => i.channel === 'store' || i.channel === 'website'));

  const cid = db.tables.customer.find((c) => c.email === 'chan.first@example.com').id;
  const byCustomer = await admin('GET', `/installs?customerId=${cid}&channel=store`);
  assert.deepEqual(ids(byCustomer), expect((i) => i.customerId === cid && i.channel === 'store'));
  assert.equal(byCustomer.json.total, 1, 'combined with the other filters');

  assert.equal((await admin('GET', '/installs?channel=')).json.total, mine.length, 'an empty filter is no filter');
  const bad = await admin('GET', '/installs?channel=store,msix');
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'validation_failed');
  assert.ok(bad.json.fields.channel);
});

test('GET /v1/admin/metrics counts installs by channel', async () => {
  assert.deepEqual(countInstallsByChannel([]), { store: 0, website: 0, base: 0, unknown: 0 });
  assert.deepEqual(countInstallsByChannel([{ channel: 'store' }, { channel: 'base' }, { channel: null }, {}, { channel: 'bogus' }, { channel: 'website' }, { channel: 'store' }]),
    { store: 2, website: 1, base: 1, unknown: 3 });

  await H.newInstall(T, 'ch-base', { channel: 'base' });
  const mine = db.tables.install.filter((i) => i.tenantId === T);
  const n = (c) => mine.filter((i) => (c === 'unknown' ? i.channel == null : i.channel === c)).length;
  const m = await admin('GET', '/metrics');
  assert.equal(m.status, 200, m.text);
  assert.equal(m.json.installsTotal, mine.length);
  assert.deepEqual(m.json.installsByChannel, { store: n('store'), website: n('website'), base: n('base'), unknown: n('unknown') });
  for (const c of ['store', 'website', 'base', 'unknown']) assert.ok(n(c) >= 1, `the fixture has a ${c} install`);
  const sum = Object.values(m.json.installsByChannel).reduce((a, b) => a + b, 0);
  assert.equal(sum, m.json.installsTotal);
});
