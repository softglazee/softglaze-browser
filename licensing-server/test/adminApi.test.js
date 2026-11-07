'use strict';
// Spec A4 + A6: the admin API over HTTP (auth, customers, privacy erase, CSV round trip, licences,
// manual payments, plans and public prices, settings, metrics, audit log).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
const { createAdminKey, revokeByLabel } = require('../src/admin/keys');
const { sha256Hex } = require('../src/crypto/keys');
const { parseCsv } = require('../src/util/csv');

const { db, admin, call } = H;
let T;
test.before(async () => { await H.start(); T = (await H.seedTenant()).id; });
test.after(() => H.stop());

const DAY = 86400000;
const newCustomer = (body) => admin('POST', '/customers', { body: { source: 'manual', ...body } });

test('admin auth: tenant key or a scoped website key; the scoped key cannot reach /v1/tenant', async () => {
  assert.equal((await call('GET', '/v1/admin/customers')).status, 401);
  assert.equal((await admin('GET', '/customers', { key: 'sgls_wrong' })).status, 401);
  assert.equal((await admin('GET', '/customers')).status, 200);
  const site = await createAdminKey(db, T, { label: 'website' });
  assert.match(site.key, /^sgla_/);
  assert.ok(!JSON.stringify(db.tables.adminKey).includes(site.key), 'only the hash is stored');
  assert.equal((await admin('GET', '/customers', { key: site.key })).status, 200);
  const tenantApi = await call('GET', '/v1/tenant/plans', { headers: { authorization: `Bearer ${site.key}` } });
  assert.equal(tenantApi.status, 401, 'payment keys / signing keys stay with the owner key');
  await admin('POST', '/customers', { key: site.key, headers: { 'x-admin-actor': 'agent.sara' }, body: { email: 'via-site@example.com' } });
  const entry = db.tables.adminAudit.find((a) => a.action === 'customer.create');
  assert.equal(entry.actor, 'website:agent.sara');
  assert.equal(entry.keyId, site.id);
  assert.ok(!JSON.stringify(entry.detail).includes('via-site@example.com'), 'no email in the audit log');
  await revokeByLabel(db, T, 'website');
  assert.equal((await admin('GET', '/customers', { key: site.key })).status, 401);
  assert.equal(db.tables.adminKey[0].keyHash, sha256Hex(site.key));
});

test('customers: create, validation, duplicate by email key, get with timeline', async () => {
  const bad = await newCustomer({ email: 'nope', country: 'Pakistan', marketingConsent: true, statusOverride: 'paid' });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.json.fields).sort(), ['consentSource', 'country', 'email', 'statusNote']);
  const r = await newCustomer({ email: 'Karl.Tan@Gmail.com', name: 'Karl Tan', company: 'Listening Ear', country: 'sg', phone: '+65 6123 4567', tags: ['Warm Lead', 'sg'], marketingConsent: true, consentSource: 'call 6 Nov', notes: 'Wants a demo' });
  assert.equal(r.status, 201, r.text);
  const c = r.json.customer;
  assert.equal(c.email, 'karl.tan@gmail.com');
  assert.equal(c.country, 'SG');
  assert.deepEqual(c.tags, ['warm-lead', 'sg']);
  assert.equal(c.marketingConsent, true);
  assert.equal(c.consentSource, 'call 6 Nov');
  assert.equal(c.status, 'lead');
  assert.equal(c.tagIndex, undefined);
  const dup = await newCustomer({ email: 'karltan+x@googlemail.com' });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error, 'customer_exists');
  assert.equal(dup.json.customerId, c.id);
  const g = await admin('GET', `/customers/${c.id}`);
  assert.equal(g.status, 200);
  assert.ok(g.json.timeline.some((e) => e.type === 'created'));
  for (const k of ['installs', 'trials', 'licenses', 'payments', 'emails']) assert.ok(Array.isArray(g.json[k]), k);
  assert.equal((await admin('GET', '/customers/nope')).status, 404);
  const disp = await newCustomer({ email: 'temp@mailinator.com' });
  assert.deepEqual(disp.json.warnings, ['disposable_email']);
});

test('customers: list filters, search, sort, paging; update; soft delete and restore; bulk tags', async () => {
  for (let i = 0; i < 5; i++) await newCustomer({ email: `bulk${i}@acme.test`, company: 'ACME', country: i % 2 ? 'US' : 'PK', source: i < 2 ? 'invoice' : 'manual' });
  let r = await admin('GET', '/customers?q=acme&sort=email&order=asc&pageSize=2&page=2');
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 5);
  assert.deepEqual(r.json.items.map((c) => c.email), ['bulk2@acme.test', 'bulk3@acme.test']);
  r = await admin('GET', '/customers?q=acme&source=invoice');
  assert.equal(r.json.total, 2);
  r = await admin('GET', '/customers?q=acme&country=PK,US&consent=0&verified=0');
  assert.equal(r.json.total, 5);
  assert.equal((await admin('GET', '/customers?status=vip')).status, 400);
  assert.equal((await admin('GET', '/customers?createdFrom=yesterday-ish')).status, 400);

  const ids = r.json.items.map((c) => c.id);
  const b = await admin('POST', '/customers/bulk', { body: { ids, action: 'addTags', tags: ['Q4 campaign'] } });
  assert.equal(b.json.changed, 5);
  assert.equal((await admin('GET', '/customers?tag=q4-campaign')).json.total, 5);
  await admin('POST', '/customers/bulk', { body: { ids: ids.slice(0, 2), action: 'removeTags', tags: ['q4-campaign'] } });
  assert.equal((await admin('GET', '/customers?tag=q4-campaign')).json.total, 3);

  const id = ids[0];
  const p = await admin('PATCH', `/customers/${id}`, { body: { name: 'Bulk Zero', statusOverride: 'paid', statusNote: 'Paid by cheque, licence pending' } });
  assert.equal(p.status, 200);
  assert.equal(p.json.customer.status, 'paid');
  assert.equal(p.json.customer.statusAuto, 'lead');
  assert.deepEqual(p.json.changed.sort(), ['name', 'status', 'statusNote', 'statusOverride']);
  const cleared = await admin('PATCH', `/customers/${id}`, { body: { statusOverride: null } });
  assert.equal(cleared.json.customer.status, 'lead');

  db.tables.customer.find((c) => c.id === id).emailVerifiedAt = new Date();
  const moved = await admin('PATCH', `/customers/${id}`, { body: { email: 'new.address@acme.test' } });
  assert.equal(moved.json.customer.emailVerifiedAt, null, 'a changed address is no longer verified');

  assert.equal((await admin('DELETE', `/customers/${id}`)).status, 200);
  assert.equal((await admin('GET', '/customers?q=acme')).json.total, 4);
  assert.equal((await admin('GET', '/customers?q=acme&deleted=only')).json.total, 1);
  const rs = await admin('POST', `/customers/${id}/restore`);
  assert.equal(rs.status, 200);
  assert.equal(rs.json.customer.deletedAt, null);
});

test('privacy erase removes personal data and keeps anonymised payment totals and metrics history', async () => {
  const inst = await H.newInstall(T, 'erase-me');
  assert.equal((await H.verify(T, inst, 'erase.me@example.com')).status, 200);
  const c = db.tables.customer.find((x) => x.emailKey === 'erase.me@example.com');
  const pay = await admin('POST', '/payments', { body: { customerId: c.id, amount: 2900, currency: 'USD', method: 'bank_transfer', reference: 'TRX-ERASE-1', note: 'Paid by E. Me', grant: { months: 1, tier: 'enterprise', installId: inst.installId } } });
  assert.equal(pay.status, 201, pay.text);
  assert.equal((await admin('POST', `/customers/${c.id}/erase`, { body: { confirm: 'someone.else@example.com' } })).json.error, 'confirm_mismatch');
  const e = await admin('POST', `/customers/${c.id}/erase`, { body: { confirm: 'Erase.Me@example.com' } });
  assert.equal(e.status, 200, e.text);
  assert.deepEqual(e.json.kept, { payments: 1, totalPaidCents: 2900 });
  assert.equal(db.tables.customer.find((x) => x.id === c.id), undefined);
  const dump = JSON.stringify({ ...db.tables, adminKey: [] });
  assert.ok(!dump.includes('erase.me@example.com'), 'the address is gone from every table');
  assert.ok(!dump.includes('Paid by E. Me'));
  const p = db.tables.payment.find((x) => x.providerRef === 'TRX-ERASE-1');
  assert.deepEqual([p.amount, p.currency, p.status, p.customerId, p.account], [2900, 'USD', 'paid', null, null]);
  const lic = db.tables.license.find((l) => l.installId === inst.installId);
  assert.equal(lic.customerId, null);
  assert.equal(lic.status, 'active', 'their licence keeps working on its install');
  assert.ok(db.tables.customerEvent.some((x) => x.type === 'status' && x.customerId.startsWith('anon_') && x.data.to === 'paid'), 'status history kept anonymously');
  assert.ok(!db.tables.customerEvent.some((x) => x.customerId === c.id));
  const auditRows = db.tables.adminAudit.filter((a) => a.targetId === c.id);
  assert.ok(auditRows.every((a) => a.action === 'customer.erase' || a.detail === null));
});

test('CSV: export every field, dry-run report per row, import, and a round trip', async () => {
  await newCustomer({ email: 'csv.one@example.com', name: 'One, "Quoted"', notes: 'line1\nline2', tags: ['a', 'b'], phone: '+92 300 0000000', country: 'PK', marketingConsent: true, consentSource: 'import test' });
  const ex = await admin('GET', '/customers/export?q=csv.one', { raw: true });
  assert.equal(ex.status, 200);
  assert.match(ex.headers.get('content-type'), /text\/csv/);
  assert.match(ex.headers.get('content-disposition'), /attachment; filename="customers-\d{4}-\d\d-\d\d\.csv"/);
  const rows = parseCsv(ex.text);
  assert.equal(rows[0][1], 'email');
  assert.ok(rows[0].includes('totalPaidCents') && rows[0].includes('marketingConsent') && rows[0].includes('deletedAt'));
  assert.ok(ex.text.includes("'+92 300 0000000"), 'formula-looking cells are neutralised');
  assert.ok(db.tables.adminAudit.some((a) => a.action === 'customers.export'));

  const csv = [
    'email,name,country,tags,marketingConsent,consentSource,status',
    'new1@example.com,New One,US,x;y,yes,web form,paid',
    'new1@example.com,Dup,US,,no,,',
    'bad-address,Bad,US,,no,,',
    'csv.one@example.com,Existing,PK,,no,,',
    'new2@example.com,New Two,Pakistan,,no,,',
    'tmp@mailinator.com,Temp,,,no,,'
  ].join('\n');
  const dry = await admin('POST', '/customers/import', { body: { csv } });
  assert.equal(dry.status, 200, dry.text);
  assert.equal(dry.json.dryRun, true);
  assert.deepEqual(dry.json.summary, { rows: 6, create: 2, update: 0, skip: 1, error: 3 });
  assert.deepEqual(dry.json.items.map((i) => [i.line, i.action]), [[2, 'create'], [3, 'error'], [4, 'error'], [5, 'skip'], [6, 'error'], [7, 'create']]);
  assert.match(dry.json.items[1].errors[0], /duplicate_in_file:line_2/);
  assert.deepEqual(dry.json.items[4].errors, ['invalid_country']);
  assert.ok(dry.json.items[5].warnings.includes('disposable_email'));
  assert.deepEqual(dry.json.ignoredColumns, ['status']);
  assert.equal(db.tables.customer.filter((c) => c.email === 'new1@example.com').length, 0, 'a dry run writes nothing');

  const run = await admin('POST', '/customers/import', { body: { csv, dryRun: false, onExisting: 'update' } });
  assert.equal(run.status, 200);
  assert.deepEqual(run.json.results, { created: 2, updated: 1, skipped: 0, errors: 3 });
  const n1 = db.tables.customer.find((c) => c.email === 'new1@example.com');
  assert.deepEqual([n1.source, n1.marketingConsent, n1.consentSource, n1.statusAuto], ['import', true, 'web form', 'lead']);

  // Round trip into a second tenant: export -> import -> export gives the same editable fields.
  const KEY2 = 'sgls_second_tenant_key';
  await db.tenant.create({ data: { id: 'tenant2', name: 'Other', publicKeyPem: 'x', privateKeySealed: 'x', apiKeyHash: sha256Hex(KEY2), status: 'active' } });
  const out1 = (await admin('GET', '/customers/export?q=example.com&sort=email&order=asc', { raw: true })).text;
  const imp = await admin('POST', '/customers/import', { key: KEY2, body: { csv: out1, dryRun: false } });
  assert.equal(imp.status, 200, imp.text);
  assert.equal(imp.json.results.errors, 0);
  const out2 = (await admin('GET', '/customers/export?q=example.com&sort=email&order=asc', { key: KEY2, raw: true })).text;
  const editable = ['email', 'name', 'company', 'country', 'phone', 'lang', 'source', 'marketingConsent', 'consentSource', 'tags', 'notes'];
  const view = (text) => { const t = parseCsv(text); const h = t[0]; return t.slice(1).map((r) => editable.map((k) => r[h.indexOf(k)])); };
  assert.deepEqual(view(out2), view(out1));
});

test('licences: grant without an install attaches when the customer verifies on an install; extend; revoke', async () => {
  const c = (await newCustomer({ email: 'invoice.buyer@example.com', source: 'invoice' })).json.customer;
  const bad = await admin('POST', '/licenses', { body: { customerId: c.id, tier: 'gold', months: 0 } });
  assert.deepEqual(Object.keys(bad.json.fields).sort(), ['months', 'reason', 'tier']);
  const g = await admin('POST', '/licenses', { body: { customerId: c.id, tier: 'enterprise', months: 3, reason: 'Invoice INV-2026-014 paid' } });
  assert.equal(g.status, 201, g.text);
  assert.equal(g.json.bound, false);
  let cust = db.tables.customer.find((x) => x.id === c.id);
  assert.equal(cust.statusAuto, 'paid');
  assert.equal(cust.tier, 'enterprise');

  const inst = await H.newInstall(T, 'invoice-buyer-pc');
  assert.equal((await H.verify(T, inst, 'invoice.buyer@example.com')).status, 200);
  const lic = db.tables.license.find((l) => l.id === g.json.license.id);
  assert.equal(lic.installId, inst.installId, 'claimed by the verified install');
  const lease = await call('POST', '/v1/license', { body: { tenantId: T, ...inst } });
  assert.equal(lease.json.tier, 'enterprise');
  assert.equal(lease.json.type, 'paid');

  const before = new Date(lic.currentPeriodEnd).getTime();
  const ext = await admin('POST', `/licenses/${lic.id}/extend`, { body: { months: 1, reason: 'Goodwill after outage' } });
  assert.equal(ext.status, 200);
  assert.equal(new Date(ext.json.license.currentPeriodEnd).getTime(), before + 30 * DAY);
  assert.equal((await admin('POST', '/licenses', { body: { installId: inst.installId, tier: 'pro', months: 1, reason: 'second one' } })).json.error, 'license_exists');

  const rv = await admin('POST', `/licenses/${lic.id}/revoke`, { body: { reason: 'Chargeback' } });
  assert.equal(rv.json.license.status, 'canceled');
  assert.equal((await call('POST', '/v1/license', { body: { tenantId: T, ...inst } })).json.lease, null);
  cust = db.tables.customer.find((x) => x.id === c.id);
  assert.equal(cust.statusAuto, 'cancelled');
  assert.equal((await admin('GET', `/licenses?customerId=${c.id}`)).json.total, 1);

  const comp = (await newCustomer({ email: 'partner@vendor.example' })).json.customer;
  await admin('POST', '/licenses', { body: { customerId: comp.id, tier: 'enterprise', months: 12, complimentary: true, reason: 'Proxy vendor partner' } });
  const pc = db.tables.customer.find((x) => x.id === comp.id);
  assert.equal(pc.statusAuto, 'lead', 'a complimentary licence is not a sale');
  assert.ok(pc.complimentaryUntil);
  assert.equal((await admin('GET', '/customers?complimentary=1')).json.items.some((x) => x.id === comp.id), true);
});

test('manual payment updates the customer and grants the licence; duplicates and refunds', async () => {
  const c = (await newCustomer({ email: 'payer@example.com', source: 'invoice' })).json.customer;
  const body = { customerId: c.id, amount: 2900, currency: 'usd', method: 'payoneer', reference: 'PO-778', plan: 'enterprise', grant: true };
  const r = await admin('POST', '/payments', { body });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.payment.provider, 'manual');
  assert.equal(r.json.payment.currency, 'USD');
  assert.equal(r.json.license.tier, 'enterprise');
  assert.equal(r.json.customer.status, 'paid');
  assert.equal(r.json.customer.totalPaidCents, 2900);
  const days = (new Date(r.json.customer.paidUntil).getTime() - Date.now()) / DAY;
  assert.ok(days > 29.9 && days < 30.1);
  assert.equal((await admin('POST', '/payments', { body })).json.error, 'duplicate_payment');
  const v = await admin('POST', '/payments', { body: { customerId: c.id, amount: 0, method: 'cash', reference: 'x' } });
  assert.deepEqual(Object.keys(v.json.fields).sort(), ['amount', 'method', 'reference']);
  const rf = await admin('POST', `/payments/${r.json.payment.id}/refund`, { body: { reason: 'Customer asked within 7 days' } });
  assert.equal(rf.json.payment.status, 'refunded');
  assert.ok(rf.json.payment.refundedAt);
  assert.equal(db.tables.customer.find((x) => x.id === c.id).totalPaidCents, 0);
  const gw = await db.payment.create({ data: { tenantId: T, provider: 'stripe', providerRef: 'cs_1', amount: 500, status: 'paid' } });
  assert.equal((await admin('POST', `/payments/${gw.id}/refund`, { body: { reason: 'nope nope' } })).json.error, 'not_manual');
  const list = await admin('GET', '/payments?method=payoneer');
  assert.equal(list.json.total, 1);
});

test('plans: CRUD with price history; the public endpoint serves them (cents) and refreshes at once', async () => {
  let pub = await call('GET', `/v1/plans/public?tenantId=${T}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.headers.get('access-control-allow-origin'), '*');
  assert.match(pub.headers.get('cache-control'), /max-age=60/);
  assert.deepEqual(pub.json.map((p) => [p.key, p.amount, p.amountDecimal]), [['pro', 500, '5.00'], ['enterprise', 2900, '29.00']]);
  assert.deepEqual(Object.keys(pub.json[0]).sort(), ['amount', 'amountDecimal', 'currency', 'features', 'highlight', 'interval', 'key', 'limits', 'months', 'name', 'tier']);
  assert.deepEqual(pub.json[1].limits, { seats: 25, maxParallel: 10, auditExport: true });
  assert.deepEqual(pub.json[0].limits, { seats: 3, maxParallel: 3, auditExport: false });

  const up = await admin('PATCH', '/plans/enterprise', { body: { amount: 3900, features: ['25 team members', 'Audit log export'], note: 'Launch price' } });
  assert.equal(up.status, 200, up.text);
  assert.deepEqual(up.json.changed.sort(), ['amount', 'features']);
  pub = await call('GET', `/v1/plans/public?tenantId=${T}`);
  assert.equal(pub.json.find((p) => p.key === 'enterprise').amount, 3900, 'no stale cache after an admin change');
  const hist = await admin('GET', '/plans/enterprise/history');
  assert.deepEqual(hist.json.items.map((h) => [h.oldAmount, h.newAmount, h.note, h.changedBy]), [[2900, 3900, 'Launch price', 'tenant-key:azhar']]);

  const team = await admin('POST', '/plans', { body: { key: 'team', name: 'Team', tier: 'enterprise', amount: 9900, limits: { seats: 50 }, sortOrder: 3 } });
  assert.equal(team.status, 201);
  assert.deepEqual(team.json.plan.effectiveLimits, { seats: 50, maxParallel: 10, auditExport: true });
  assert.equal((await admin('POST', '/plans', { body: { key: 'team', name: 'x', amount: 1 } })).json.error, 'plan_exists');
  assert.equal((await admin('POST', '/plans', { body: { key: 'Bad Key', name: '', amount: 9.99 } })).status, 400);
  await admin('PATCH', '/plans/team', { body: { active: false } });
  pub = await call('GET', `/v1/plans/public?tenantId=${T}`);
  assert.ok(!pub.json.some((p) => p.key === 'team'), 'inactive plans are not public');
  assert.equal((await admin('DELETE', '/plans/team')).status, 200);
  assert.equal((await admin('DELETE', '/plans/enterprise')).json.error, 'plan_in_use');

  const viaTenantApi = await call('POST', '/v1/tenant/plans', { headers: { authorization: `Bearer ${H.ADMIN_KEY}` }, body: { key: 'pro', name: 'Pro', amount: 700 } });
  assert.equal(viaTenantApi.status, 200);
  assert.ok(db.tables.planPriceHistory.some((h) => h.planKey === 'pro' && h.newAmount === 700 && h.changedBy === 'tenant-key'));
  assert.equal((await call('GET', '/v1/plans/public?tenantId=nope')).status, 404);
  assert.equal((await call('GET', '/v1/plans/public')).status, 400);
});

test('settings: validated per field, merged over defaults, audited', async () => {
  const bad = await admin('PATCH', '/settings', { body: { email: { dailyCap: -1, replyTo: 'nope' }, trial: { days: 0 }, nonsense: {} } });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.json.fields).sort(), ['email.dailyCap', 'email.replyTo', 'nonsense', 'trial.days']);
  const ok = await admin('PATCH', '/settings', { body: { email: { dailyCap: 500 }, automations: { tips: { enabled: false } } } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.settings.email.dailyCap, 500);
  assert.equal(ok.json.settings.email.replyTo, 'support@softglaze.com', 'other values keep their defaults');
  assert.equal(ok.json.settings.automations.tips.enabled, false);
  assert.equal(ok.json.settings.automations.tips.offsetHours, 48);
  assert.ok(db.tables.adminAudit.some((a) => a.action === 'settings.update'));
});

test('metrics, monthly CSV, audit log and diagnostics respond with the documented shape', async () => {
  const m = await admin('GET', '/metrics?days=14');
  assert.equal(m.status, 200, m.text);
  for (const k of ['customersByStatus', 'payingCustomers', 'mrrCents', 'arrCents', 'mrr', 'arpaCents', 'trials', 'conversion', 'churn', 'revenue', 'monthly', 'topCountries', 'trialRefusalsLast30Days']) {
    assert.ok(k in m.json, k);
  }
  assert.equal(m.json.trials.perDay.length, 14);
  assert.equal(m.json.monthly.length, 12);
  assert.ok(m.json.payingCustomers >= 1);
  assert.equal(m.json.arrCents, m.json.mrrCents * 12);
  assert.equal((await admin('GET', '/metrics?from=2026-13')).status, 400);
  const csv = await admin('GET', '/metrics/monthly?from=2026-09&to=2026-11&format=csv', { raw: true });
  assert.equal(csv.status, 200);
  const rows = parseCsv(csv.text);
  assert.equal(rows.length, 4);
  assert.equal(rows[0][0], 'month');
  assert.deepEqual(rows.slice(1).map((r) => r[0]), ['2026-09', '2026-10', '2026-11']);

  const a = await admin('GET', '/audit?action=customer.');
  assert.ok(a.json.total >= 3);
  assert.ok(a.json.items.every((x) => x.action.startsWith('customer.')));
  const d = await admin('GET', '/diagnostics');
  assert.equal(d.json.smtp.configured, true);
  assert.ok(d.json.disposableList.count > 5000);
  const req = await admin('GET', '/diagnostics/request', { headers: { 'x-forwarded-for': '1.2.3.4, 6.6.6.6' } });
  assert.deepEqual(req.json.chain.slice(1), ['6.6.6.6', '1.2.3.4']);
  assert.equal(req.json.clientIp, '6.6.6.6');
  assert.equal((await admin('GET', '/nothing-here')).json.error, 'not_found');
});

test('segments are validated, saved and listed', async () => {
  assert.equal((await admin('POST', '/segments', { body: { name: 'Bad', filters: { status: 'vip' } } })).status, 400);
  const s = await admin('POST', '/segments', { body: { name: 'Paying US', filters: { status: 'paid', country: 'US' } } });
  assert.equal(s.status, 201);
  assert.equal((await admin('POST', '/segments', { body: { name: 'Paying US', filters: {} } })).json.error, 'segment_exists');
  const l = await admin('GET', '/segments');
  assert.deepEqual(l.json.items[0].filters, { status: 'paid', country: 'US' });
  assert.equal((await admin('DELETE', `/segments/${s.json.segment.id}`)).status, 200);
});
