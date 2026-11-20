'use strict';
// Partner deals (Free plan card): admin CRUD with validation and audit, the public list (date window,
// inactive hidden, at most 6, cache cleared by admin writes) and the click counter.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
const { DISCLOSURE } = require('../src/partners/deals');

const { db, call, admin } = H;
const DAY = 86400000;
let T;
test.before(async () => { await H.start(); T = (await H.seedTenant()).id; });
test.after(() => H.stop());

const list = () => call('GET', `/v1/partner-deals?tenantId=${T}`);
const deal = (n, extra = {}) => ({ title: `Deal ${n}`, vendor: `Vendor ${n}`, url: `https://vendor${n}.example/aff?ref=softglaze`, ...extra });

test('admin: create validates (https only, lengths, dates), lists with clicks, patches, deletes, and audits each change', async () => {
  const bad = await admin('POST', '/partner-deals', { body: { title: '', vendor: 'V', url: 'http://plain.example', logoUrl: 'javascript:alert(1)', startsAt: 'soon', sortOrder: 1.5, code: 'x'.repeat(61) } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'validation_failed');
  for (const f of ['title', 'url', 'logoUrl', 'startsAt', 'sortOrder', 'code']) assert.ok(bad.json.fields[f], f);
  assert.ok((await admin('POST', '/partner-deals', { body: {} })).json.fields.vendor, 'vendor is required');
  const order = await admin('POST', '/partner-deals', { body: deal(0, { startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' }) });
  assert.ok(order.json.fields.endsAt, 'the end must be after the start');

  const c = await admin('POST', '/partner-deals', { body: deal(1, { description: 'Residential proxies, 10 GB trial', code: 'SOFTGLAZE20', badge: '20% off', logoUrl: 'https://vendor1.example/logo.png', sortOrder: 5 }) });
  assert.equal(c.status, 201);
  const d = c.json.deal;
  assert.deepEqual([d.title, d.active, d.clicks, d.code, d.badge, d.sortOrder], ['Deal 1', true, 0, 'SOFTGLAZE20', '20% off', 5]);

  const g = await admin('GET', `/partner-deals/${d.id}`);
  assert.equal(g.json.deal.id, d.id);
  assert.equal((await admin('GET', '/partner-deals/nope')).status, 404);

  const p = await admin('PATCH', `/partner-deals/${d.id}`, { body: { badge: '25% off', clicks: 999, url: 'ftp://x.example' } });
  assert.equal(p.status, 400, 'https only on PATCH too');
  const p2 = await admin('PATCH', `/partner-deals/${d.id}`, { body: { badge: '25% off', clicks: 999, endsAt: '2099-01-01T00:00:00Z' } });
  assert.equal(p2.status, 200);
  assert.deepEqual(p2.json.changed.sort(), ['badge', 'endsAt']);
  assert.equal(p2.json.deal.clicks, 0, 'clicks cannot be set by the admin');

  const l = await admin('GET', '/partner-deals');
  assert.equal(l.json.items.length, 1);
  assert.equal(l.json.totalClicks, 0);

  const del = await admin('DELETE', `/partner-deals/${d.id}`);
  assert.deepEqual(del.json, { ok: true, deleted: d.id });
  assert.equal((await admin('DELETE', `/partner-deals/${d.id}`)).status, 404);

  const actions = db.tables.adminAudit.filter((a) => a.targetType === 'partner_deal').map((a) => a.action);
  assert.deepEqual(actions, ['partner_deal.create', 'partner_deal.update', 'partner_deal.delete']);
  assert.equal(db.tables.adminAudit.find((a) => a.action === 'partner_deal.update').detail.badge.to, '25% off');
});

test('public list: live deals only, by sortOrder, at most 6, with the disclosure; cached, but admin writes show at once', async () => {
  db.tables.partnerDeal = [];
  const now = Date.now();
  for (let i = 1; i <= 7; i += 1) await admin('POST', '/partner-deals', { body: deal(i, { sortOrder: 10 - i }) });
  await admin('POST', '/partner-deals', { body: deal('off', { active: false, sortOrder: -50 }) });
  await admin('POST', '/partner-deals', { body: deal('later', { startsAt: new Date(now + DAY).toISOString(), sortOrder: -40 }) });
  await admin('POST', '/partner-deals', { body: deal('over', { endsAt: new Date(now - DAY).toISOString(), startsAt: new Date(now - 9 * DAY).toISOString(), sortOrder: -30 }) });
  await admin('POST', '/partner-deals', { body: deal('now', { startsAt: new Date(now - DAY).toISOString(), endsAt: new Date(now + DAY).toISOString(), sortOrder: -20 }) });

  const r = await list();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('cache-control'), /public, max-age=300/);
  assert.equal(r.json.disclosure, DISCLOSURE);
  assert.equal(r.json.disclosure, 'Partner offer. SoftGlaze may earn a commission.');
  assert.equal(r.json.deals.length, 6, 'at most 6');
  assert.deepEqual(r.json.deals.map((x) => x.title), ['Deal now', 'Deal 7', 'Deal 6', 'Deal 5', 'Deal 4', 'Deal 3']);
  assert.deepEqual(Object.keys(r.json.deals[0]).sort(), ['badge', 'code', 'description', 'id', 'logoUrl', 'title', 'url', 'vendor']);

  // Rows written straight to the table (not through the admin) wait for the cache to expire...
  await db.partnerDeal.create({ data: { tenantId: T, title: 'Sneaky', vendor: 'V', url: 'https://s.example', sortOrder: -100 } });
  assert.notEqual((await list()).json.deals[0].title, 'Sneaky');
  // ...an admin write clears the cache at once.
  const top = await admin('POST', '/partner-deals', { body: deal('top', { sortOrder: -200 }) });
  assert.deepEqual((await list()).json.deals.slice(0, 2).map((x) => x.title), ['Deal top', 'Sneaky']);
  await admin('PATCH', `/partner-deals/${top.json.deal.id}`, { body: { active: false } });
  assert.equal((await list()).json.deals[0].title, 'Sneaky');

  assert.equal((await call('GET', '/v1/partner-deals?tenantId=nobody')).status, 404);
  assert.equal((await call('GET', '/v1/partner-deals')).status, 400);
  assert.equal((await call('OPTIONS', '/v1/partner-deals')).status, 204);
});

test('click: counts only a live deal of that tenant, stores no personal data', async () => {
  db.tables.partnerDeal = [];
  const live = (await admin('POST', '/partner-deals', { body: deal('click') })).json.deal;
  const off = (await admin('POST', '/partner-deals', { body: deal('off', { active: false }) })).json.deal;
  const ended = (await admin('POST', '/partner-deals', { body: deal('ended', { startsAt: '2020-01-01T00:00:00Z', endsAt: '2020-02-01T00:00:00Z' }) })).json.deal;
  await H.seedTenant('tenantOther');

  const click = (id, tenantId = T) => call('POST', `/v1/partner-deals/${id}/click`, { body: { tenantId } });
  assert.deepEqual((await click(live.id)).json, { ok: true });
  assert.deepEqual((await click(live.id)).json, { ok: true });
  const row = db.tables.partnerDeal.find((d) => d.id === live.id);
  assert.equal(row.clicks, 2);
  assert.ok(row.lastClickAt instanceof Date);
  assert.deepEqual(Object.keys(row).sort(), ['active', 'badge', 'clicks', 'code', 'createdAt', 'description', 'endsAt', 'id', 'lastClickAt', 'logoUrl', 'sortOrder', 'startsAt', 'tenantId', 'title', 'updatedAt', 'url', 'vendor']);

  assert.equal((await click(off.id)).status, 404);
  assert.equal((await click(ended.id)).status, 404);
  assert.equal((await click(live.id, 'tenantOther')).status, 404, 'another tenant cannot count it');
  assert.equal((await click('../etc')).status, 404);
  assert.equal((await call('POST', `/v1/partner-deals/${live.id}/click`, { body: {} })).status, 400);
  assert.equal(db.tables.partnerDeal.find((d) => d.id === off.id).clicks, 0);
  assert.equal(db.tables.partnerDeal.find((d) => d.id === live.id).clicks, 2);
  assert.equal((await admin('GET', '/partner-deals')).json.totalClicks, 2);
});
