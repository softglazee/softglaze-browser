'use strict';
// Microsoft Store subscriptions on the licensing server (src/store/, routes /v1/store/*, /v1/admin/store/*,
// the cron re-check). Microsoft's Entra ID, collection and purchase services are a fake behind
// msStoreApi.setFetchForTests: no real purchase or Microsoft call is ever made.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
const api = require('../src/store/msStoreApi');
const { getSettings } = require('../src/settings');
const { recheckTenant, parseFormattedPrice, interpretStore, cleanAddOns } = require('../src/store/entitlements');
const { pickLeaseLicence } = require('../src/licensing');

const { db, call, admin } = H;
const DAY = 86400000;
let T;

// ---- fake Microsoft --------------------------------------------------------------------------------
const MS = { collections: [], recurrences: [], calls: [], down: false, renewed: 0 };
const PRO_STORE_ID = '9NPRO0000001';
const ENT_STORE_ID = '9NENT0000001';
api.setFetchForTests(async (url, opts = {}) => {
  const u = String(url);
  MS.calls.push({ url: u, headers: opts.headers || {}, body: opts.body });
  if (MS.down) throw new Error('connect ECONNREFUSED');
  const reply = (status, json) => ({ ok: status < 300, status, text: async () => JSON.stringify(json) });
  if (u.startsWith('https://login.microsoftonline.com/')) {
    const p = new URLSearchParams(opts.body);
    if (p.get('client_secret') !== 'right-secret') return reply(401, { error: 'invalid_client', error_codes: [7000215] });
    return reply(200, { access_token: `token-for:${p.get('resource')}`, expires_in: 3600 });
  }
  const auth = (opts.headers || {}).authorization;
  if (u === api.URLS.collectionsQuery) {
    if (auth !== 'Bearer token-for:https://onestore.microsoft.com') return reply(401, { code: 'Unauthorized' });
    const b = JSON.parse(opts.body);
    const key = b.beneficiaries[0].identityValue;
    if (key.startsWith('forged-')) return reply(400, { code: 'AuthenticationTokenInvalid' });
    return reply(200, { items: MS.collections.filter((i) => key.startsWith(i.key)).map(({ key: _k, ...i }) => i) });
  }
  if (u === api.URLS.recurrencesQuery) {
    if (auth !== 'Bearer token-for:https://onestore.microsoft.com') return reply(401, { code: 'Unauthorized' });
    const b = JSON.parse(opts.body);
    return reply(200, { items: MS.recurrences.filter((r) => b.b2bKey.startsWith(r.key)).map(({ key: _k, ...r }) => r) });
  }
  if (u === api.URLS.renewCollectionsKey || u === api.URLS.renewPurchaseKey) {
    MS.renewed += 1;
    const b = JSON.parse(opts.body);
    return reply(200, { key: `${b.key}-renewed` });
  }
  return reply(404, { code: 'NotFound' });
});

test.before(async () => { await H.start(); T = (await H.seedTenant()).id; });
test.after(() => H.stop());

const iso = (ms) => new Date(ms).toISOString();
const keysFor = (who) => ({ collections: `ckey-${who}-000000000000000000`, purchase: `pkey-${who}-000000000000000000` });
const lease = (inst) => call('POST', '/v1/license', { body: { tenantId: T, ...inst } });
const session = (inst) => call('POST', '/v1/store/session', { body: { tenantId: T, ...inst } });
const claim = (inst, body) => call('POST', '/v1/store/claim', { body: { tenantId: T, ...inst, ...body } });
const addOn = (token, expiresAtMs, extra = {}) => ({ inAppOfferToken: token, skuStoreId: `${token === 'pro_monthly' ? PRO_STORE_ID : ENT_STORE_ID}/0010`, isActive: true, expiresAtMs, ...extra });
const PRICES = { pro_monthly: { formatted: '$4.99', formattedRecurrence: '$4.99', currencyCode: 'USD' }, enterprise_monthly: { formatted: '$28.99', currencyCode: 'USD' } };
const storePayments = () => db.tables.payment.filter((p) => p.provider === 'microsoft_store');

// ---- pure helpers ----------------------------------------------------------------------------------
test('the Store price text becomes minor units in its currency', () => {
  assert.deepEqual(parseFormattedPrice('$4.99', 'USD'), { amount: 499, currency: 'USD' });
  assert.deepEqual(parseFormattedPrice('4,99 €', 'eur'), { amount: 499, currency: 'EUR' });
  assert.deepEqual(parseFormattedPrice('PKR 1,399.00', 'PKR'), { amount: 139900, currency: 'PKR' });
  assert.deepEqual(parseFormattedPrice('Rs 1,400', 'PKR'), { amount: 140000, currency: 'PKR' });
  assert.deepEqual(parseFormattedPrice('1.234,56 kr', 'SEK'), { amount: 123456, currency: 'SEK' });
  assert.deepEqual(parseFormattedPrice('¥500', 'JPY'), { amount: 500, currency: 'JPY' });
  assert.equal(parseFormattedPrice('Free', 'USD'), null);
  assert.equal(parseFormattedPrice('$4.99', ''), null);
  assert.equal(parseFormattedPrice('$0.00', 'USD'), null);
});

test('add-on lines: only mapped Product IDs; IsActive (always true) is not trusted over the expiry', () => {
  const plans = { pro_monthly: 'pro', enterprise_monthly: 'enterprise' };
  const lines = cleanAddOns([
    addOn('pro_monthly', Date.now() + DAY),
    { inAppOfferToken: 'some_other_addon', isActive: true, expiresAtMs: Date.now() + DAY },
    { inAppOfferToken: 'bad token!', isActive: true },
    null,
    addOn('enterprise_monthly', Date.now() + 2 * DAY, { isActive: undefined })
  ], plans);
  assert.deepEqual(lines.map((l) => l.productId).sort(), ['enterprise_monthly', 'pro_monthly']);
  assert.ok(lines.every((l) => l.isActive), 'a missing IsActive counts as present');
});

test('Microsoft states map to our statuses (renewal slack, dunning grace, cancel, refund, trial SKU)', () => {
  const now = Date.UTC(2026, 10, 8);
  const plans = { pro_monthly: 'pro', enterprise_monthly: 'enterprise' };
  const col = (over) => ({ productId: PRO_STORE_ID, skuId: '0010', inAppOfferToken: 'pro_monthly', status: 'Active', endDate: iso(now + 20 * DAY), orderId: 'o1', skuType: 'Full', ...over });
  const rec = (over) => ({ id: 'rec-1', productId: PRO_STORE_ID, skuId: '0010', recurrenceState: 'Active', autoRenew: true, expirationTime: iso(now + 20 * DAY), ...over });
  const run = (c, r) => interpretStore({ collections: [c], recurrences: r ? [r] : [], productPlans: plans, now, renewalGraceDays: 3 }).get('pro_monthly');

  const active = run(col(), rec());
  assert.equal(active.status, 'active');
  assert.equal(active.accessUntil.getTime(), now + 23 * DAY, 'renewing: 3 days of slack past the paid period');
  assert.equal(active.subscriptionKey, 'rec:rec-1');
  assert.equal(run(col(), rec({ autoRenew: false })).accessUntil.getTime(), now + 20 * DAY, 'auto-renew off: ends with the period');

  const dunning = run(col(), rec({ recurrenceState: 'InDunning', expirationTime: iso(now - DAY), expirationTimeWithGrace: iso(now + 13 * DAY) }));
  assert.equal(dunning.status, 'grace');
  assert.equal(dunning.accessUntil.getTime(), now + 2 * DAY, 'only our own 3-day grace, not the 2-week dunning');
  assert.equal(run(col(), rec({ recurrenceState: 'InDunning', expirationTime: iso(now - 5 * DAY) })).status, 'expired');

  assert.equal(run(col(), rec({ recurrenceState: 'Canceled', cancellationDate: iso(now - DAY) })).status, 'canceled');
  assert.equal(run(col(), rec({ recurrenceState: 'Inactive', expirationTime: iso(now - DAY) })).status, 'expired');
  assert.equal(run(col(), rec({ recurrenceState: 'Failed', expirationTime: iso(now - DAY) })).status, 'expired');
  const refunded = run(col({ status: 'Revoked' }), rec());
  assert.equal(refunded.status, 'refunded');
  assert.ok(refunded.accessUntil.getTime() <= now);
  assert.equal(run(col({ skuType: 'Trial' }), rec()).isTrial, true);
  assert.equal(run(col(), null).status, 'active', 'a time-limited durable (no recurrence) works too');
  assert.equal(interpretStore({ collections: [col({ inAppOfferToken: 'unknown' })], recurrences: [], productPlans: plans, now, renewalGraceDays: 3 }).size, 0);
});

test('the lease uses the best active licence of an install', () => {
  const now = Date.now();
  const l = (over) => ({ status: 'active', tier: 'pro', currentPeriodEnd: new Date(now + DAY), updatedAt: new Date(now), ...over });
  assert.equal(pickLeaseLicence([], now), null);
  assert.equal(pickLeaseLicence([l({ id: 'p' }), l({ id: 'e', tier: 'enterprise', updatedAt: new Date(now - DAY) })], now).id, 'e');
  assert.equal(pickLeaseLicence([l({ id: 'old', currentPeriodEnd: new Date(now + 5 * DAY), updatedAt: new Date(now - DAY) }), l({ id: 'ended', status: 'expired', updatedAt: new Date(now + 1) })], now).id, 'old');
  assert.equal(pickLeaseLicence([l({ id: 'a', status: 'expired', updatedAt: new Date(now - DAY) }), l({ id: 'b', status: 'canceled', updatedAt: new Date(now) })], now).id, 'b', 'none active: the latest, as before');
});

// ---- before the Entra ID app is set up: unverified, bounded, alerted ----------------------------------
test('session without Store API credentials: the plan map and an unverified mode, no tickets', async () => {
  const inst = await H.newInstall(T, 'u-session');
  const r = await session(inst);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.products.map((p) => [p.productId, p.plan, p.tier]), [['pro_monthly', 'pro', 'pro'], ['enterprise_monthly', 'enterprise', 'enterprise']]);
  assert.deepEqual(r.json.verification, { mode: 'unverified' });
  assert.equal((await session({ ...inst, installSecret: 'wrong' })).status, 401);
  assert.equal((await session({ ...inst, machineHash: H.mh('elsewhere') })).status, 403);
});

test('an unverified claim grants at most 7 days, records the payment once and raises an admin alert', async () => {
  const inst = await H.newInstall(T, 'u-claim');
  const before = Date.now();
  const r = await claim(inst, { licenseRead: true, addOns: [addOn('pro_monthly', before + 30 * DAY)], prices: PRICES, purchase: { productId: 'pro_monthly', status: 'Succeeded' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.mode, 'unverified');
  assert.equal(r.json.verified, false);
  assert.equal(r.json.verifyNote, 'not_configured');
  assert.equal(r.json.licensed, true);
  const ent = r.json.entitlements[0];
  assert.equal(ent.status, 'active');
  const until = new Date(ent.accessUntil).getTime();
  assert.ok(until <= Date.now() + 7 * DAY && until > before + 6 * DAY, 'capped at unverifiedDays');

  const l = await lease(inst);
  assert.equal(l.status, 200);
  assert.equal(l.json.type, 'paid');
  assert.equal(l.json.tier, 'pro');
  assert.ok(H.leaseVerifies(l.json.lease, H.getTenantKeys().publicKeyPem));

  const pays = storePayments().filter((p) => p.installId === inst.installId);
  assert.equal(pays.length, 1);
  assert.equal(pays[0].amount, 499);
  assert.equal(pays[0].currency, 'USD');
  assert.equal(pays[0].status, 'paid');
  assert.match(pays[0].note, /UNVERIFIED/);
  const lic = db.tables.license.find((x) => x.installId === inst.installId);
  assert.equal(lic.source, 'microsoft_store');
  assert.match(lic.providerRef, /^msstore:/);

  // The app reports again in the same period: nothing new is recorded.
  await claim(inst, { licenseRead: true, addOns: [addOn('pro_monthly', before + 30 * DAY)], prices: PRICES });
  assert.equal(storePayments().filter((p) => p.installId === inst.installId).length, 1);

  const st = await admin('GET', '/store/status');
  assert.equal(st.status, 200);
  assert.equal(st.json.configured, false);
  assert.ok(st.json.alerts.includes('credentials_missing'));
  assert.ok(st.json.alerts.includes('unverified_entitlements'));
  assert.ok(st.json.unverifiedActive >= 1);
  const diag = await admin('GET', '/diagnostics');
  assert.ok(diag.json.store.alerts.includes('unverified_entitlements'));
});

test('unverified: an add-on that left the Store licence ends access; an unreadable licence changes nothing', async () => {
  const inst = await H.newInstall(T, 'u-ends');
  await claim(inst, { licenseRead: true, addOns: [addOn('enterprise_monthly', Date.now() + 20 * DAY)], prices: PRICES });
  assert.equal((await lease(inst)).json.tier, 'enterprise');
  const unread = await claim(inst, { licenseRead: false, addOns: [] });
  assert.equal(unread.json.licensed, true, 'the app could not read its licence: keep what we have');
  const gone = await claim(inst, { licenseRead: true, addOns: [] });
  assert.equal(gone.json.licensed, false);
  assert.equal(gone.json.entitlements[0].status, 'expired');
  const l = await lease(inst);
  assert.equal(l.json.lease, null);
  assert.equal(l.json.status, 'expired');
});

test('acceptUnverified off: the claim waits for the owner, who approves it', async () => {
  assert.equal((await admin('PATCH', '/settings', { body: { store: { acceptUnverified: false } } })).status, 200);
  const inst = await H.newInstall(T, 'u-review');
  const r = await claim(inst, { licenseRead: true, addOns: [addOn('pro_monthly', Date.now() + 30 * DAY)], prices: PRICES });
  assert.equal(r.json.mode, 'pending_review');
  assert.equal(r.json.licensed, false);
  assert.equal(r.json.entitlements[0].status, 'pending');
  assert.equal((await lease(inst)).json.lease, null);
  assert.equal(storePayments().filter((p) => p.installId === inst.installId).length, 0, 'no payment before approval');

  const list = await admin('GET', '/store/entitlements?alert=1');
  const row = list.json.items.find((e) => e.installId === inst.installId);
  assert.ok(row, 'pending claims are alerts');
  assert.equal((await admin('POST', `/store/entitlements/${row.id}/approve`, { body: {} })).status, 400, 'a reason is required');
  const ok = await admin('POST', `/store/entitlements/${row.id}/approve`, { body: { reason: 'Seen in Partner Center acquisitions' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.entitlement.status, 'active');
  assert.equal(ok.json.entitlement.verified, false);
  assert.equal((await lease(inst)).json.tier, 'pro');
  assert.ok(db.tables.adminAudit.some((a) => a.action === 'store.approve' && a.targetId === row.id));
  await admin('PATCH', '/settings', { body: { store: { acceptUnverified: true } } });
});

test('the cron closes unverified entitlements whose bounded term ran out', async () => {
  const inst = await H.newInstall(T, 'u-cron');
  await claim(inst, { licenseRead: true, addOns: [addOn('pro_monthly', Date.now() + 30 * DAY)], prices: PRICES });
  const tenant = db.tables.tenant.find((t) => t.id === T);
  const r = await recheckTenant(db, tenant, { now: Date.now() + 8 * DAY, settings: await getSettings(db, T) });
  assert.ok(r.expiredUnverified >= 1);
  assert.equal(r.configured, false);
  const ent = db.tables.storeEntitlement.find((e) => e.installId === inst.installId);
  assert.equal(ent.status, 'expired');
  assert.equal(db.tables.license.find((l) => l.installId === inst.installId).status, 'expired');
});

// ---- with the Entra ID app: verified with Microsoft ----------------------------------------------
test('the owner stores the Entra ID app with the tenant key; it is sealed and gets no webhook URL', async () => {
  const bad = await call('POST', '/v1/tenant/payment-config', { headers: { authorization: `Bearer ${H.ADMIN_KEY}` }, body: { provider: 'microsoft_store', enabled: true, entraTenantId: 'x', clientId: 'y', clientSecret: 'z' } });
  assert.equal(bad.status, 400);
  const r = await call('POST', '/v1/tenant/payment-config', {
    headers: { authorization: `Bearer ${H.ADMIN_KEY}` },
    body: { provider: 'microsoft_store', enabled: true, entraTenantId: '11111111-2222-3333-4444-555555555555', clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', clientSecret: 'right-secret' }
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, provider: 'microsoft_store' });
  const row = db.tables.tenantPaymentConfig.find((c) => c.provider === 'microsoft_store');
  assert.ok(row && !row.secretsSealed.includes('right-secret'));
  // It is not a checkout provider.
  const co = await call('POST', '/v1/checkout', { body: { tenantId: T, planKey: 'pro', provider: 'microsoft_store' } });
  assert.equal(co.status, 400);
});

test('session with credentials hands out the two key tickets for this install', async () => {
  const inst = await H.newInstall(T, 'v-session');
  const r = await session(inst);
  assert.equal(r.json.verification.mode, 'verified');
  assert.equal(r.json.verification.collectionsTicket, 'token-for:https://onestore.microsoft.com/b2b/keys/create/collections');
  assert.equal(r.json.verification.purchaseTicket, 'token-for:https://onestore.microsoft.com/b2b/keys/create/purchase');
  assert.equal(r.json.verification.publisherUserId, inst.installId);
  const tokenCall = MS.calls.find((c) => c.url.startsWith('https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/token'));
  assert.ok(tokenCall, 'client credentials on the tenant token endpoint');
  assert.equal(new URLSearchParams(tokenCall.body).get('grant_type'), 'client_credentials');
});

test('a verified purchase: Microsoft is asked, the keys are sealed, the payment says verified', async () => {
  const inst = await H.newInstall(T, 'v-buy');
  const k = keysFor('alice');
  const exp = Date.now() + 30 * DAY;
  MS.collections.push({ key: k.collections, productId: PRO_STORE_ID, skuId: '0010', inAppOfferToken: 'pro_monthly', status: 'Active', endDate: iso(exp), orderId: 'order-a', skuType: 'Full' });
  MS.recurrences.push({ key: k.purchase, id: 'rec-alice', productId: PRO_STORE_ID, skuId: '0010', recurrenceState: 'Active', autoRenew: true, expirationTime: iso(exp) });

  const r = await claim(inst, { licenseRead: true, addOns: [addOn('pro_monthly', exp)], prices: PRICES, keys: k, purchase: { productId: 'pro_monthly', status: 'Succeeded' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.mode, 'verified');
  assert.equal(r.json.verified, true);
  assert.equal(r.json.licensed, true);
  const body = JSON.parse(MS.calls.filter((c) => c.url === api.URLS.collectionsQuery).pop().body);
  assert.deepEqual(body.beneficiaries, [{ identityType: 'b2b', identityValue: k.collections, localTicketReference: inst.installId }]);
  assert.deepEqual(body.productTypes, ['Durable']);

  const ent = db.tables.storeEntitlement.find((e) => e.installId === inst.installId);
  assert.equal(ent.verified, true);
  assert.equal(ent.subscriptionKey, 'rec:rec-alice');
  assert.equal(ent.storeId, PRO_STORE_ID);
  assert.ok(!JSON.stringify(ent).includes(k.purchase) && !JSON.stringify(ent).includes(k.collections), 'keys only sealed');
  assert.equal(new Date(ent.accessUntil).getTime(), new Date(iso(exp)).getTime() + 3 * DAY);
  const pay = storePayments().find((p) => p.installId === inst.installId);
  assert.match(pay.note, /^Verified with the Microsoft Store/);
  assert.equal((await lease(inst)).json.tier, 'pro');

  const list = await admin('GET', '/store/entitlements?verified=1');
  const row = list.json.items.find((e) => e.installId === inst.installId);
  assert.equal(row.hasKeys, true);
  assert.equal(row.purchaseKeySealed, undefined, 'the admin list never carries the keys');
  const paid = await admin('GET', '/payments?provider=microsoft_store');
  assert.ok(paid.json.items.some((p) => p.installId === inst.installId));
  const lics = await admin('GET', '/licenses?source=microsoft_store');
  assert.ok(lics.json.items.some((l) => l.installId === inst.installId));
});

test('verified: a claim Microsoft does not confirm grants nothing', async () => {
  const inst = await H.newInstall(T, 'v-forged');
  const k = keysFor('mallory');
  const r = await claim(inst, { licenseRead: true, addOns: [addOn('enterprise_monthly', Date.now() + 30 * DAY)], prices: PRICES, keys: k });
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'store_not_owned');
  assert.equal((await lease(inst)).json.lease, null);
  assert.ok(!db.tables.storeEntitlement.some((e) => e.installId === inst.installId && e.status === 'active'));
});

test('one computer per subscription: in use elsewhere -> move -> limit; a reinstall on the same PC takes over', async () => {
  const k = keysFor('bob');
  const exp = Date.now() + 25 * DAY;
  MS.collections.push({ key: k.collections, productId: ENT_STORE_ID, skuId: '0010', inAppOfferToken: 'enterprise_monthly', status: 'Active', endDate: iso(exp), orderId: 'order-b' });
  MS.recurrences.push({ key: k.purchase, id: 'rec-bob', productId: ENT_STORE_ID, skuId: '0010', recurrenceState: 'Active', autoRenew: true, expirationTime: iso(exp) });
  const body = { licenseRead: true, addOns: [addOn('enterprise_monthly', exp)], prices: PRICES, keys: k };

  const pc1 = await H.newInstall(T, 'bob-pc1');
  assert.equal((await claim(pc1, body)).json.licensed, true);
  const pc2 = await H.newInstall(T, 'bob-pc2');
  const busy = await claim(pc2, body);
  assert.equal(busy.status, 409);
  assert.equal(busy.json.error, 'store_in_use');
  assert.equal((await lease(pc1)).json.tier, 'enterprise', 'the first computer keeps it');

  const moved = await claim(pc2, { ...body, move: true });
  assert.equal(moved.status, 200);
  assert.equal((await lease(pc2)).json.tier, 'enterprise');
  assert.equal((await lease(pc1)).json.lease, null, 'the first computer lost it');
  assert.equal(db.tables.storeEntitlement.find((e) => e.installId === pc1.installId).status, 'moved');

  assert.equal((await claim(pc1, { ...body, move: true })).status, 200, 'second move');
  const third = await claim(pc2, { ...body, move: true });
  assert.equal(third.status, 429);
  assert.equal(third.json.error, 'store_move_limit');

  // pc1 holds it; a reinstall on pc1 (new install id, same machine hash) takes over without a move.
  const reg = await call('POST', '/v1/register', { body: { tenantId: T, machineId: 'mid-bob-pc1-reinstall', machineHash: pc1.machineHash } });
  const pc1b = { installId: reg.json.installId, installSecret: reg.json.installSecret, machineHash: pc1.machineHash };
  const again = await claim(pc1b, body);
  assert.equal(again.status, 200);
  assert.equal(again.json.licensed, true);
  assert.equal(db.tables.storeEntitlement.find((e) => e.installId === pc1.installId).status, 'replaced');
});

test('cron: renewal adds a period and a payment, a refund ends the licence and marks the payment refunded', async () => {
  const inst = await H.newInstall(T, 'v-cron');
  const k = keysFor('carol');
  const exp1 = Date.now() + 2 * DAY;
  const col = { key: k.collections, productId: PRO_STORE_ID, skuId: '0010', inAppOfferToken: 'pro_monthly', status: 'Active', endDate: iso(exp1), orderId: 'order-c' };
  const rec = { key: k.purchase, id: 'rec-carol', productId: PRO_STORE_ID, skuId: '0010', recurrenceState: 'Active', autoRenew: true, expirationTime: iso(exp1) };
  MS.collections.push(col);
  MS.recurrences.push(rec);
  await claim(inst, { licenseRead: true, addOns: [addOn('pro_monthly', exp1)], prices: PRICES, keys: k });
  assert.equal(storePayments().filter((p) => p.installId === inst.installId).length, 1);

  const tenant = db.tables.tenant.find((t) => t.id === T);
  const settings = await getSettings(db, T);
  // Microsoft renewed it.
  const exp2 = exp1 + 30 * DAY;
  rec.expirationTime = iso(exp2);
  col.endDate = iso(exp2);
  const r1 = await recheckTenant(db, tenant, { now: Date.now() + 7 * 3600000, settings });
  assert.equal(r1.configured, true);
  assert.ok(r1.checked >= 1);
  const ent = db.tables.storeEntitlement.find((e) => e.installId === inst.installId);
  assert.equal(new Date(ent.expiresAt).getTime(), new Date(iso(exp2)).getTime());
  assert.equal(storePayments().filter((p) => p.installId === inst.installId).length, 2, 'one payment per period');

  // The customer got a refund: Microsoft revokes the add-on.
  col.status = 'Revoked';
  rec.recurrenceState = 'Canceled';
  rec.cancellationDate = iso(Date.now());
  await recheckTenant(db, tenant, { now: Date.now() + 14 * 3600000, settings });
  const after = db.tables.storeEntitlement.find((e) => e.installId === inst.installId);
  assert.equal(after.status, 'refunded');
  const lic = db.tables.license.find((l) => l.providerRef === `msstore:${after.id}`);
  assert.equal(lic.status, 'canceled');
  assert.equal((await lease(inst)).json.lease, null);
  const pays = storePayments().filter((p) => p.installId === inst.installId);
  assert.equal(pays.filter((p) => p.status === 'refunded').length, 1, 'the latest period is refunded');
  assert.equal(after.purchaseKeySealed, null, 'Store ID keys are dropped once the subscription has ended');
  assert.equal(after.collectionsKeySealed, null);
});

test('a privacy erase removes the email, the customer link and the keys from Store entitlements', async () => {
  const { eraseCustomer } = require('../src/customers/erase');
  const inst = await H.newInstall(T, 'v-erase');
  const k = keysFor('hana');
  const exp = Date.now() + 30 * DAY;
  MS.collections.push({ key: k.collections, productId: PRO_STORE_ID, skuId: '0010', inAppOfferToken: 'pro_monthly', status: 'Active', endDate: iso(exp), orderId: 'order-h' });
  MS.recurrences.push({ key: k.purchase, id: 'rec-hana', productId: PRO_STORE_ID, skuId: '0010', recurrenceState: 'Active', autoRenew: true, expirationTime: iso(exp) });
  const v = await H.verify(T, inst, 'hana@example.com');
  assert.equal(v.status, 200, v.text);
  await claim(inst, { licenseRead: true, addOns: [addOn('pro_monthly', exp)], prices: PRICES, keys: k });
  const ent = db.tables.storeEntitlement.find((e) => e.installId === inst.installId);
  assert.ok(ent.customerId && ent.purchaseKeySealed);
  await eraseCustomer(db, T, ent.customerId);
  const after = db.tables.storeEntitlement.find((e) => e.id === ent.id);
  assert.equal(after.customerId, null);
  assert.equal(after.account, null);
  assert.equal(after.purchaseKeySealed, null);
  assert.equal(after.status, 'active', 'the subscription keeps working');
});

test('cron renews Store ID keys before their 30 days run out', async () => {
  const inst = await H.newInstall(T, 'v-keys');
  const k = keysFor('dave');
  const exp = Date.now() + 40 * DAY;
  MS.collections.push({ key: k.collections, productId: PRO_STORE_ID, skuId: '0010', inAppOfferToken: 'pro_monthly', status: 'Active', endDate: iso(exp), orderId: 'order-d' });
  MS.recurrences.push({ key: k.purchase, id: 'rec-dave', productId: PRO_STORE_ID, skuId: '0010', recurrenceState: 'Active', autoRenew: true, expirationTime: iso(exp) });
  await claim(inst, { licenseRead: true, addOns: [addOn('pro_monthly', exp)], prices: PRICES, keys: k });
  const before = MS.renewed;
  const tenant = db.tables.tenant.find((t) => t.id === T);
  await recheckTenant(db, tenant, { now: Date.now() + 21 * DAY, settings: await getSettings(db, T) });
  assert.ok(MS.renewed - before >= 2, 'collections and purchase keys');
  const ent = db.tables.storeEntitlement.find((e) => e.installId === inst.installId);
  const { open } = require('../src/crypto/secrets');
  assert.equal(open(ent.purchaseKeySealed), `${k.purchase}-renewed`);
  assert.equal(open(ent.collectionsKeySealed), `${k.collections}-renewed`);
  assert.equal(ent.status, 'active', 'still verified with the renewed keys');
});

test('Microsoft unreachable during a claim: it falls back to a bounded unverified grant', async () => {
  const inst = await H.newInstall(T, 'v-down');
  MS.down = true;
  try {
    const r = await claim(inst, { licenseRead: true, addOns: [addOn('pro_monthly', Date.now() + 30 * DAY)], prices: PRICES, keys: keysFor('erin') });
    assert.equal(r.status, 200);
    assert.equal(r.json.verified, false);
    assert.equal(r.json.verifyNote, 'store_unreachable');
    assert.equal(r.json.licensed, true);
  } finally { MS.down = false; }
});

test('with verification set up, a claim without keys or with keys Microsoft refuses waits for the owner', async () => {
  const inst = await H.newInstall(T, 'v-nokeys');
  const noKeys = await claim(inst, { licenseRead: true, addOns: [addOn('enterprise_monthly', Date.now() + 30 * DAY)], prices: PRICES });
  assert.equal(noKeys.status, 200);
  assert.equal(noKeys.json.mode, 'pending_review');
  assert.equal(noKeys.json.verifyNote, 'no_keys');
  assert.equal(noKeys.json.licensed, false);
  assert.equal(noKeys.json.entitlements[0].status, 'pending');

  const inst2 = await H.newInstall(T, 'v-forged-keys');
  const forged = await claim(inst2, { licenseRead: true, addOns: [addOn('enterprise_monthly', Date.now() + 30 * DAY)], prices: PRICES, keys: { collections: 'forged-000000000000000000000', purchase: 'forged-000000000000000000001' } });
  assert.equal(forged.json.verifyNote, 'store_rejected');
  assert.equal(forged.json.licensed, false);
  assert.equal((await lease(inst2)).json.lease, null);
  assert.ok((await admin('GET', '/store/status')).json.alerts.includes('pending_review'));
});

test('a verified subscription is not downgraded to unverified while Microsoft is down', async () => {
  const inst = await H.newInstall(T, 'v-keep');
  const k = keysFor('gina');
  const exp = Date.now() + 30 * DAY;
  MS.collections.push({ key: k.collections, productId: PRO_STORE_ID, skuId: '0010', inAppOfferToken: 'pro_monthly', status: 'Active', endDate: iso(exp), orderId: 'order-g' });
  MS.recurrences.push({ key: k.purchase, id: 'rec-gina', productId: PRO_STORE_ID, skuId: '0010', recurrenceState: 'Active', autoRenew: true, expirationTime: iso(exp) });
  await claim(inst, { licenseRead: true, addOns: [addOn('pro_monthly', exp)], prices: PRICES, keys: k });
  MS.down = true;
  try {
    const r = await claim(inst, { licenseRead: true, addOns: [addOn('pro_monthly', exp)], prices: PRICES, keys: k });
    assert.equal(r.json.licensed, true);
    const ent = db.tables.storeEntitlement.find((e) => e.installId === inst.installId);
    assert.equal(ent.verified, true);
    assert.equal(new Date(ent.accessUntil).getTime(), new Date(iso(exp)).getTime() + 3 * DAY, 'not cut to 7 days');
  } finally { MS.down = false; }
});

test('admin: recheck needs keys, revoke ends access now and is audited', async () => {
  const unverified = db.tables.storeEntitlement.find((e) => !e.purchaseKeySealed);
  assert.equal((await admin('POST', `/store/entitlements/${unverified.id}/recheck`)).status, 409);
  const inst = await H.newInstall(T, 'v-revoke');
  const k = keysFor('frank');
  const exp = Date.now() + 30 * DAY;
  MS.collections.push({ key: k.collections, productId: PRO_STORE_ID, skuId: '0010', inAppOfferToken: 'pro_monthly', status: 'Active', endDate: iso(exp), orderId: 'order-f' });
  MS.recurrences.push({ key: k.purchase, id: 'rec-frank', productId: PRO_STORE_ID, skuId: '0010', recurrenceState: 'Active', autoRenew: true, expirationTime: iso(exp) });
  await claim(inst, { licenseRead: true, addOns: [addOn('pro_monthly', exp)], prices: PRICES, keys: k });
  const ent = db.tables.storeEntitlement.find((e) => e.installId === inst.installId);
  const re = await admin('POST', `/store/entitlements/${ent.id}/recheck`);
  assert.equal(re.status, 200);
  assert.equal(re.json.entitlement.status, 'active');
  assert.equal((await admin('POST', `/store/entitlements/${ent.id}/revoke`, { body: {} })).status, 400);
  const rv = await admin('POST', `/store/entitlements/${ent.id}/revoke`, { body: { reason: 'Chargeback reported by the customer' } });
  assert.equal(rv.status, 200);
  assert.equal(rv.json.entitlement.status, 'revoked');
  assert.equal((await lease(inst)).json.lease, null);
  assert.ok(db.tables.adminAudit.some((a) => a.action === 'store.revoke' && a.targetId === ent.id));
  assert.equal((await admin('GET', '/store/entitlements?status=nonsense')).status, 400);
});

test('settings: the Product ID map is validated', async () => {
  assert.equal((await admin('PATCH', '/settings', { body: { store: { productPlans: { 'bad id!': 'pro' } } } })).status, 400);
  assert.equal((await admin('PATCH', '/settings', { body: { store: { unverifiedDays: 90 } } })).status, 400);
  const ok = await admin('PATCH', '/settings', { body: { store: { productPlans: { pro_monthly: 'pro', enterprise_monthly: 'enterprise', pro_yearly: 'pro-yearly' } } } });
  assert.equal(ok.status, 200);
  const st = await admin('GET', '/store/status');
  assert.ok(st.json.alerts.includes('unknown_plans'), 'a mapped plan key that does not exist is flagged');
  await admin('PATCH', '/settings', { body: { store: { productPlans: { pro_monthly: 'pro', enterprise_monthly: 'enterprise' } } } });
});
