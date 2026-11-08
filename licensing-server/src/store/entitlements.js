'use strict';
// Microsoft Store subscriptions -> our licences. A StoreEntitlement row is one add-on (Pro or
// Enterprise subscription) on one install. Its state comes from:
//   - VERIFIED: the Microsoft Store collection + purchase APIs (msStoreApi.js), queried with the Store
//     ID keys the app makes from our service tickets. Authoritative, re-checked by the cron.
//   - UNVERIFIED: what the app read from StoreContext.GetAppLicenseAsync(), used only while the Entra
//     ID credentials are not set up (or the Store API is down). Bounded: it never grants more than
//     settings.store.unverifiedDays at a time, the app must report again to extend it, and the admin
//     shows every unverified entitlement as an alert. settings.store.acceptUnverified false records
//     the claim as 'pending' (no licence) for the owner to approve or refuse.
// Each entitlement drives one License row (providerRef msstore:<id>, source microsoft_store), so the
// app gets the normal signed lease from /v1/license and its plan limits keep working.
// Each billing period the Store reports active is recorded once as a Payment (provider microsoft_store).
const api = require('./msStoreApi');
const { seal, open } = require('../crypto/secrets');
const { addEvent, recomputeCustomer } = require('../customers/sync');

const DAY = 86400000;
const GRANTING = new Set(['active', 'grace']);
// moved: taken over by another computer (counts towards the monthly move limit); replaced: taken over by
// a new install on the SAME computer (a reinstall), which does not count.
const STATUSES = Object.freeze(['active', 'grace', 'pending', 'expired', 'canceled', 'refunded', 'revoked', 'moved', 'replaced', 'not_owned']);
// Currencies the Store shows without minor units.
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'PYG', 'KMF', 'RWF', 'GNF', 'BIF', 'DJF', 'VUV', 'XPF']);
const TOKEN_RE = /^[A-Za-z0-9._-]{1,100}$/;
// Why Microsoft could not confirm a claim. Only failures on OUR side may fall back to trusting the app
// (bounded, alerted): nothing is set up yet, Microsoft is down, or our Entra ID app was refused. A claim
// without keys while we could verify, or with keys Microsoft refuses, may come from a forged client and
// waits for the owner ('pending') instead.
const SERVER_SIDE_FAILURES = new Set(['not_configured', 'store_unreachable', 'store_unavailable', 'store_auth']);
const STORE_ID_RE = /^[A-Za-z0-9/._-]{1,80}$/;

const ms = (v) => (v == null ? null : (v instanceof Date ? v.getTime() : new Date(v).getTime()));
const validDate = (v) => { const t = ms(v); return Number.isFinite(t) ? new Date(t) : null; };
const minDate = (...ds) => { const v = ds.map(ms).filter(Number.isFinite); return v.length ? new Date(Math.min(...v)) : null; };
const dayKey = (d) => new Date(ms(d)).toISOString().slice(0, 10);

// "$4.99", "4,99 €", "PKR 1,399.00", "¥500", "1.234,56 kr" -> minor units for currencyCode, or null.
function parseFormattedPrice(formatted, currencyCode) {
  const currency = String(currencyCode || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || typeof formatted !== 'string') return null;
  const num = formatted.replace(/[^\d.,]/g, '');
  if (!/\d/.test(num) || num.length > 20) return null;
  const lastSep = Math.max(num.lastIndexOf('.'), num.lastIndexOf(','));
  let units = num;
  let fraction = '';
  if (lastSep >= 0) {
    const tail = num.slice(lastSep + 1);
    // One or two digits after the last separator: a decimal part. Three: a thousands separator.
    if (tail.length > 0 && tail.length <= 2) { units = num.slice(0, lastSep); fraction = tail; }
  }
  units = units.replace(/[.,]/g, '');
  if (!/^\d+$/.test(units || '0')) return null;
  const whole = Number(units || '0');
  if (!Number.isSafeInteger(whole)) return null;
  if (ZERO_DECIMAL.has(currency)) return { amount: whole, currency };
  const cents = Number((fraction + '00').slice(0, 2));
  const amount = whole * 100 + cents;
  return amount > 0 && amount <= 100000000 ? { amount, currency } : null;
}

// The add-on licences the app read, cleaned: only add-ons in productPlans. -> [{ productId, skuStoreId, isActive, expiresAt }]
function cleanAddOns(addOns, productPlans) {
  if (!Array.isArray(addOns)) return [];
  const out = new Map();
  for (const a of addOns.slice(0, 50)) {
    if (!a || typeof a !== 'object') continue;
    const productId = typeof a.inAppOfferToken === 'string' ? a.inAppOfferToken.trim() : '';
    if (!TOKEN_RE.test(productId) || !productPlans[productId]) continue;
    const skuStoreId = typeof a.skuStoreId === 'string' && STORE_ID_RE.test(a.skuStoreId) ? a.skuStoreId : null;
    const expiresAt = Number.isFinite(Number(a.expiresAtMs)) ? new Date(Number(a.expiresAtMs)) : null;
    // StoreLicense.IsActive "is reserved for future use ... it always returns true": an add-on whose
    // licence ended is absent from AddOnLicenses, so presence plus the expiry date are the signal.
    // An explicit false is still honoured, should Microsoft start using it.
    const line = { productId, skuStoreId, isActive: a.isActive !== false, expiresAt: expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : null };
    // Several SKUs of one add-on: keep the active one with the latest expiry.
    const prev = out.get(productId);
    if (!prev || (line.isActive && !prev.isActive) || (line.isActive === prev.isActive && ms(line.expiresAt) > ms(prev.expiresAt))) out.set(productId, line);
  }
  return [...out.values()];
}

function cleanPrices(prices, productPlans) {
  const out = {};
  if (!prices || typeof prices !== 'object') return out;
  for (const [k, v] of Object.entries(prices)) {
    if (!productPlans[k] || !v || typeof v !== 'object') continue;
    const formatted = typeof v.formattedRecurrence === 'string' && v.formattedRecurrence.trim() ? v.formattedRecurrence : v.formatted;
    out[k] = {
      formatted: typeof formatted === 'string' ? formatted.slice(0, 40) : null,
      currencyCode: typeof v.currencyCode === 'string' ? v.currencyCode.toUpperCase().slice(0, 3) : null
    };
  }
  return out;
}

// What Microsoft says about each mapped add-on for this customer. -> Map(productId -> result)
// result: { status, verified: true, expiresAt, accessUntil, autoRenew, recurrenceId, recurrenceState, storeId, skuId, isTrial, subscriptionKey }
function interpretStore({ collections, recurrences, productPlans, now, renewalGraceDays }) {
  const out = new Map();
  const items = (collections || []).filter((i) => i && typeof i.inAppOfferToken === 'string' && productPlans[i.inAppOfferToken]);
  for (const productId of new Set(items.map((i) => i.inAppOfferToken))) {
    const mine = items.filter((i) => i.inAppOfferToken === productId);
    // Prefer an Active item, then the latest end date.
    mine.sort((a, b) => ((b.status === 'Active') - (a.status === 'Active')) || ((ms(b.endDate) || 0) - (ms(a.endDate) || 0)));
    const item = mine[0];
    const rec = (recurrences || []).filter((r) => r && r.productId === item.productId && (!item.skuId || !r.skuId || r.skuId === item.skuId))
      .sort((a, b) => (ms(b.expirationTime) || 0) - (ms(a.expirationTime) || 0))[0] || null;
    const itemStatus = String(item.status || '');
    const expiresAt = validDate(rec ? rec.expirationTime : item.endDate);
    const withGrace = validDate(rec && rec.expirationTimeWithGrace);
    const state = rec ? String(rec.recurrenceState || '') : '';
    let status;
    let accessUntil = expiresAt;
    if (itemStatus === 'Revoked' || itemStatus === 'Banned') {
      status = 'refunded'; // a refund or chargeback revokes the entitlement
      accessUntil = new Date(now);
    } else if (rec) {
      if (state === 'Active' && ms(expiresAt) > now) {
        status = 'active';
        // Renewing subscriptions get a few days of slack, so a renewal the cron has not seen yet
        // never locks the app at the exact expiry minute.
        if (rec.autoRenew === true) accessUntil = new Date(ms(expiresAt) + renewalGraceDays * DAY);
      } else if (state === 'InDunning' || (state === 'Active' && ms(withGrace) > now)) {
        // The renewal payment failed and Microsoft retries it ("dunning ... can last up to two weeks").
        // Access continues only for our own short grace after the paid period, never the whole dunning.
        const paidEnd = expiresAt ? ms(expiresAt) : now;
        const until = Math.min(paidEnd + renewalGraceDays * DAY, withGrace ? ms(withGrace) : Infinity);
        status = until > now ? 'grace' : 'expired';
        accessUntil = new Date(until);
      } else if (state === 'Canceled') {
        status = 'canceled';
        accessUntil = minDate(expiresAt, rec.cancellationDate, now);
      } else {
        status = 'expired'; // Inactive, Failed, None, or an Active one whose time is up
        accessUntil = minDate(expiresAt, now);
      }
    } else if (itemStatus === 'Active' && ms(expiresAt) > now) {
      status = 'active';
    } else {
      status = 'expired';
      accessUntil = minDate(expiresAt, now);
    }
    out.set(productId, {
      status, verified: true, expiresAt, accessUntil,
      autoRenew: rec ? rec.autoRenew === true : null,
      recurrenceId: rec && rec.id ? String(rec.id).slice(0, 100) : null,
      recurrenceState: state || null,
      storeId: item.productId ? String(item.productId).slice(0, 64) : null,
      skuId: item.skuId ? String(item.skuId).slice(0, 40) : null,
      isTrial: Boolean((rec && rec.isTrial) || item.skuType === 'Trial'),
      subscriptionKey: rec && rec.id ? `rec:${String(rec.id).slice(0, 100)}` : (item.orderId ? `order:${String(item.orderId).slice(0, 100)}` : null)
    });
  }
  return out;
}

async function verifyWithStore(creds, keys, ctx) {
  const [collections, recurrences] = await Promise.all([
    api.queryCollections(creds, keys.collections, keys.publisherUserId),
    api.queryRecurrences(creds, keys.purchase)
  ]);
  return interpretStore({ collections, recurrences, ...ctx });
}

function keysFrom(body) {
  const k = body && body.keys && typeof body.keys === 'object' ? body.keys : null;
  if (!k) return null;
  const ok = (s) => typeof s === 'string' && s.length >= 20 && s.length <= 8000 && !/\s/.test(s);
  return ok(k.collections) && ok(k.purchase) ? { collections: k.collections, purchase: k.purchase } : null;
}

async function planRow(db, tenantId, key) {
  if (!key) return null;
  return db.plan.findUnique({ where: { tenantId_key: { tenantId, key: String(key) } } });
}

// The Payment for the billing period ending at ent.expiresAt, once. Skipped for Store free trials.
async function recordPeriodPayment(db, tenant, ent, plan, { verified, isTrial }) {
  if (!GRANTING.has(ent.status) || !ent.expiresAt || isTrial) return null;
  const providerRef = `msstore:${ent.id}:${dayKey(ent.expiresAt)}`;
  const existing = await db.payment.findFirst({ where: { tenantId: tenant.id, provider: 'microsoft_store', providerRef } });
  if (existing) return null;
  const parsed = ent.priceFormatted ? parseFormattedPrice(ent.priceFormatted, ent.currency) : null;
  const amount = parsed ? parsed.amount : (plan ? plan.amount : 0);
  const currency = parsed ? parsed.currency : (plan ? plan.currency : 'USD');
  if (!(amount > 0)) return null;
  const notes = [
    verified ? 'Verified with the Microsoft Store.' : 'UNVERIFIED: reported by the app; the Store APIs did not confirm it.',
    parsed ? `Gross Store price ${ent.priceFormatted}, before Microsoft's fee and taxes.` : 'Store price unknown: the plan list price is shown.'
  ];
  return db.payment.create({
    data: {
      tenantId: tenant.id, provider: 'microsoft_store', providerRef, method: 'store', amount, currency, status: 'paid', paidAt: new Date(),
      account: ent.account || null, plan: ent.planKey || null, installId: ent.installId, customerId: ent.customerId || null,
      note: notes.join(' '), recordedBy: 'microsoft_store'
    }
  });
}

// A refund ends the period's payment too.
async function markPeriodRefunded(db, tenant, ent) {
  const rows = await db.payment.findMany({ where: { tenantId: tenant.id, provider: 'microsoft_store', status: 'paid', providerRef: { startsWith: `msstore:${ent.id}:` } }, orderBy: { paidAt: 'desc' } });
  if (!rows.length) return null;
  return db.payment.update({ where: { id: rows[0].id }, data: { status: 'refunded', refundedAt: new Date(), note: [rows[0].note, 'Refunded or revoked by the Microsoft Store.'].filter(Boolean).join(' ') } });
}

// Keeps the entitlement's License row in step. Returns the licence (or null for a pending claim).
async function syncLicence(db, tenant, ent, plan, now) {
  const granting = GRANTING.has(ent.status) && ms(ent.accessUntil) > now;
  let lic = ent.licenseId ? await db.license.findUnique({ where: { id: ent.licenseId } }) : null;
  if (lic && lic.tenantId !== tenant.id) lic = null;
  if (!lic) lic = await db.license.findFirst({ where: { tenantId: tenant.id, providerRef: `msstore:${ent.id}` } });
  if (!lic && !granting) return null; // nothing was ever granted (pending, not owned)
  const ended = ['refunded', 'revoked', 'moved', 'replaced', 'canceled'].includes(ent.status);
  const data = {
    tier: (plan && plan.tier) || ent.tier || 'pro',
    plan: ent.planKey || (plan && plan.key) || null,
    status: granting ? 'active' : (ended ? 'canceled' : 'expired'),
    currentPeriodEnd: granting ? ent.accessUntil : (minDate(ent.accessUntil, now) || new Date(now)),
    providerRef: `msstore:${ent.id}`,
    source: 'microsoft_store',
    installId: ent.installId,
    customerId: ent.customerId || null,
    account: (lic && lic.account) || ent.account || null,
    ...(ended ? { revokedAt: lic && lic.revokedAt ? lic.revokedAt : new Date(now), revokedReason: `Microsoft Store: ${ent.status}` } : { revokedAt: null, revokedReason: null })
  };
  lic = lic ? await db.license.update({ where: { id: lic.id }, data }) : await db.license.create({ data: { tenantId: tenant.id, ...data } });
  if (ent.licenseId !== lic.id) await db.storeEntitlement.update({ where: { id: ent.id }, data: { licenseId: lic.id } });
  return lic;
}

// Writes one entitlement from a verified result or an app report, then its licence, payment and
// customer. -> the updated row.
async function applyResult(db, tenant, install, { productId, planKey, result, price, keys, now, settings, actor }) {
  const plan = await planRow(db, tenant.id, planKey);
  const where = { tenantId_installId_productId: { tenantId: tenant.id, installId: install.id, productId } };
  let ent = await db.storeEntitlement.findUnique({ where });
  const before = ent ? { status: ent.status, expiresAt: ent.expiresAt } : null;
  const data = {
    planKey, tier: (plan && plan.tier) || 'pro', status: result.status, verified: result.verified === true,
    verifyNote: result.verified ? null : (result.verifyNote || null),
    expiresAt: result.expiresAt || null, accessUntil: result.accessUntil || null,
    autoRenew: result.autoRenew == null ? null : result.autoRenew,
    recurrenceId: result.recurrenceId || (ent && ent.recurrenceId) || null,
    recurrenceState: result.recurrenceState || null,
    storeId: result.storeId || (ent && ent.storeId) || null,
    skuStoreId: result.skuStoreId || (ent && ent.skuStoreId) || null,
    subscriptionKey: result.subscriptionKey || (ent && ent.subscriptionKey) || null,
    customerId: install.customerId || (ent && ent.customerId) || null,
    account: install.account || (ent && ent.account) || null,
    lastClaimAt: actor === 'app' ? new Date(now) : (ent ? ent.lastClaimAt : null),
    lastCheckedAt: result.verified ? new Date(now) : (ent ? ent.lastCheckedAt : null),
    lastCheckError: result.checkError || null
  };
  if (price && price.formatted) { data.priceFormatted = price.formatted; data.currency = price.currencyCode || null; }
  if (keys) {
    data.collectionsKeySealed = seal(keys.collections);
    data.purchaseKeySealed = seal(keys.purchase);
    data.keysIssuedAt = new Date(now);
  }
  // Keys are kept only while they are needed to re-check a live subscription; a new purchase or a
  // restore brings fresh ones.
  if (!GRANTING.has(result.status) && result.status !== 'pending') {
    data.collectionsKeySealed = null;
    data.purchaseKeySealed = null;
    data.keysIssuedAt = null;
  }
  ent = ent
    ? await db.storeEntitlement.update({ where: { id: ent.id }, data })
    : await db.storeEntitlement.create({ data: { tenantId: tenant.id, installId: install.id, productId, firstClaimAt: new Date(now), ...data } });

  await syncLicence(db, tenant, ent, plan, now);
  await recordPeriodPayment(db, tenant, ent, plan, { verified: ent.verified, isTrial: result.isTrial === true });
  const changed = !before || before.status !== ent.status;
  if (['refunded', 'revoked'].includes(ent.status) && (!before || !['refunded', 'revoked'].includes(before.status))) await markPeriodRefunded(db, tenant, ent);
  if (ent.customerId && changed) {
    await addEvent(db, tenant.id, ent.customerId, 'store_subscription', { entitlementId: ent.id, productId, from: before ? before.status : null, to: ent.status, verified: ent.verified });
  }
  if (ent.customerId) await recomputeCustomer(db, tenant.id, ent.customerId, { graceDays: settings.billing.renewalGraceDays, now });
  return ent;
}

function publicView(ent) {
  return {
    id: ent.id, productId: ent.productId, plan: ent.planKey, tier: ent.tier, status: ent.status, verified: ent.verified,
    accessUntil: ent.accessUntil, expiresAt: ent.expiresAt, autoRenew: ent.autoRenew
  };
}

// Another install already holds this subscription (one PC per subscription, like a website licence).
async function holderElsewhere(db, tenant, install, productId, subscriptionKey) {
  if (!subscriptionKey) return null;
  const rows = await db.storeEntitlement.findMany({ where: { tenantId: tenant.id, subscriptionKey, status: { in: ['active', 'grace'] } } });
  return rows.find((r) => r.installId !== install.id) || null;
}

// Moves of one subscription in the last 30 days: each row keeps the time it was last moved away (a row
// that later took the subscription back keeps that mark), so this counts computers it left recently.
async function movesInWindow(db, tenant, subscriptionKey, now) {
  return db.storeEntitlement.count({ where: { tenantId: tenant.id, subscriptionKey, movedAt: { gt: new Date(now - 30 * DAY) } } });
}

async function moveAway(db, tenant, holder, now, settings, status = 'moved') {
  const plan = await planRow(db, tenant.id, holder.planKey);
  // A same-computer replacement (reinstall) is not a move and leaves no move mark.
  const moved = await db.storeEntitlement.update({ where: { id: holder.id }, data: { status, accessUntil: new Date(now), ...(status === 'moved' ? { movedAt: new Date(now) } : {}) } });
  await syncLicence(db, tenant, moved, plan, now);
  if (moved.customerId) await recomputeCustomer(db, tenant.id, moved.customerId, { graceDays: settings.billing.renewalGraceDays, now });
}

// POST /v1/store/claim. -> { status, body }
async function claimStore(db, tenant, install, body, { now = Date.now(), settings }) {
  const cfg = settings.store;
  const productPlans = cfg.productPlans || {};
  const b = body || {};
  const prices = cleanPrices(b.prices, productPlans);
  const lines = cleanAddOns(b.addOns, productPlans);
  const licenseRead = b.licenseRead === true;
  const keys = keysFrom(b);
  const creds = await api.loadCredentials(db, tenant.id);

  let verified = null;
  let verifyNote = null;
  if (!creds) verifyNote = 'not_configured';
  else if (!keys) verifyNote = 'no_keys';
  else {
    try {
      verified = await verifyWithStore(creds, { ...keys, publisherUserId: install.id }, { productPlans, now, renewalGraceDays: cfg.renewalGraceDays });
    } catch (e) {
      verifyNote = (e && e.code) || 'store_error';
    }
  }

  const results = [];
  const conflicts = [];
  if (verified) {
    for (const [productId, result] of verified) {
      if (GRANTING.has(result.status)) {
        const holder = await holderElsewhere(db, tenant, install, productId, result.subscriptionKey);
        if (holder) {
          // A reinstall on the same computer gets a new install id: it takes over without asking and
          // without counting as a move.
          const holderInstall = await db.install.findUnique({ where: { id: holder.installId } });
          const sameMachine = Boolean(holderInstall && holderInstall.machineHash && holderInstall.machineHash === install.machineHash);
          if (!sameMachine) {
            if (b.move !== true) { conflicts.push({ productId, error: 'store_in_use' }); continue; }
            if (await movesInWindow(db, tenant, result.subscriptionKey, now) >= cfg.maxMovesPer30Days) { conflicts.push({ productId, error: 'store_move_limit' }); continue; }
          }
          await moveAway(db, tenant, holder, now, settings, sameMachine ? 'replaced' : 'moved');
        }
      }
      const line = lines.find((l) => l.productId === productId);
      results.push(await applyResult(db, tenant, install, {
        productId, planKey: productPlans[productId], result: { ...result, skuStoreId: line ? line.skuStoreId : null },
        price: prices[productId], keys, now, settings, actor: 'app'
      }));
    }
    // Entitlements of this install the Store no longer lists for this customer.
    const mine = await db.storeEntitlement.findMany({ where: { tenantId: tenant.id, installId: install.id, status: { in: ['active', 'grace', 'pending'] } } });
    for (const ent of mine) {
      if (verified.has(ent.productId) || !productPlans[ent.productId]) continue;
      results.push(await applyResult(db, tenant, install, {
        productId: ent.productId, planKey: ent.planKey, now, settings, actor: 'app',
        result: { status: 'not_owned', verified: true, expiresAt: ent.expiresAt, accessUntil: new Date(now) }
      }));
    }
  } else if (licenseRead) {
    const maxUntil = now + cfg.unverifiedDays * DAY;
    const trustApp = cfg.acceptUnverified && SERVER_SIDE_FAILURES.has(verifyNote);
    for (const line of lines) {
      // Microsoft's last word on a verified subscription stands while it cannot be asked again.
      const existing = await db.storeEntitlement.findUnique({ where: { tenantId_installId_productId: { tenantId: tenant.id, installId: install.id, productId: line.productId } } });
      if (existing && existing.verified && GRANTING.has(existing.status) && ms(existing.accessUntil) > now) { results.push(existing); continue; }
      const active = line.isActive && ms(line.expiresAt) > now;
      let status = active ? 'active' : 'expired';
      if (active && !trustApp) status = 'pending';
      const accessUntil = active ? minDate(line.expiresAt, maxUntil) : minDate(line.expiresAt, now);
      results.push(await applyResult(db, tenant, install, {
        productId: line.productId, planKey: productPlans[line.productId], price: prices[line.productId], now, settings, actor: 'app',
        result: {
          status, verified: false, verifyNote, expiresAt: line.expiresAt, accessUntil, skuStoreId: line.skuStoreId,
          // Unverified: no subscription id from Microsoft, so no one-PC check (see the spec).
          subscriptionKey: null
        }
      }));
    }
    // The app could read its licence and no longer has an add-on it reported before: it ended.
    const mine = await db.storeEntitlement.findMany({ where: { tenantId: tenant.id, installId: install.id, verified: false, status: { in: ['active', 'grace', 'pending'] } } });
    for (const ent of mine) {
      if (lines.some((l) => l.productId === ent.productId)) continue;
      results.push(await applyResult(db, tenant, install, {
        productId: ent.productId, planKey: ent.planKey, now, settings, actor: 'app',
        result: { status: 'expired', verified: false, verifyNote, expiresAt: ent.expiresAt, accessUntil: minDate(ent.expiresAt, now) }
      }));
    }
  }

  const all = await db.storeEntitlement.findMany({ where: { tenantId: tenant.id, installId: install.id } });
  const licensed = all.some((e) => GRANTING.has(e.status) && ms(e.accessUntil) > now);
  const mode = verified ? 'verified' : (cfg.acceptUnverified && SERVER_SIDE_FAILURES.has(verifyNote) ? 'unverified' : 'pending_review');
  if (conflicts.length && !results.some((r) => GRANTING.has(r.status))) {
    const c = conflicts[0];
    return {
      status: c.error === 'store_move_limit' ? 429 : 409,
      body: {
        error: c.error, productId: c.productId,
        message: c.error === 'store_move_limit'
          ? 'This subscription has already been moved to another computer twice in the last 30 days.'
          : 'This subscription is in use on another computer. Move it here to use it on this one.'
      }
    };
  }
  if (verified && !results.length && licenseRead && lines.some((l) => l.isActive)) {
    return { status: 404, body: { error: 'store_not_owned', message: 'The Microsoft Store does not list this purchase for your account yet. Try again in a minute.' } };
  }
  return {
    status: 200,
    body: { ok: true, mode, verified: Boolean(verified), verifyNote: verified ? null : verifyNote, licensed, conflicts, entitlements: all.map(publicView) }
  };
}

// POST /v1/store/session: what the app needs before it reads or buys. -> body
async function storeSession(db, tenant, install, { settings }) {
  const productPlans = settings.store.productPlans || {};
  const products = [];
  for (const [productId, planKey] of Object.entries(productPlans)) {
    const plan = await planRow(db, tenant.id, planKey);
    if (!plan || !plan.active) continue;
    products.push({ productId, plan: plan.key, tier: plan.tier, name: plan.name });
  }
  const creds = await api.loadCredentials(db, tenant.id);
  let verification = { mode: settings.store.acceptUnverified ? 'unverified' : 'pending_review' };
  if (creds) {
    try {
      const t = await api.serviceTickets(creds);
      verification = { mode: 'verified', collectionsTicket: t.collectionsTicket, purchaseTicket: t.purchaseTicket, publisherUserId: install.id };
    } catch (e) {
      verification.note = (e && e.code) || 'store_error';
    }
  }
  return { products, verification };
}

// Cron: re-check verified entitlements with Microsoft (renewals, cancellations, refunds), renew Store ID
// keys before their 90 days end, and close unverified ones whose bounded term ran out.
async function recheckTenant(db, tenant, { now = Date.now(), settings, limit = 200 } = {}) {
  const cfg = settings.store;
  const productPlans = cfg.productPlans || {};
  const summary = { checked: 0, changed: 0, renewedKeys: 0, expiredUnverified: 0, errors: 0 };
  const creds = await api.loadCredentials(db, tenant.id);

  const lapsed = await db.storeEntitlement.findMany({ where: { tenantId: tenant.id, verified: false, status: { in: ['active', 'grace'] }, accessUntil: { lte: new Date(now) } }, take: limit });
  for (const ent of lapsed) {
    const plan = await planRow(db, tenant.id, ent.planKey);
    const row = await db.storeEntitlement.update({ where: { id: ent.id }, data: { status: 'expired' } });
    await syncLicence(db, tenant, row, plan, now);
    if (row.customerId) await recomputeCustomer(db, tenant.id, row.customerId, { graceDays: settings.billing.renewalGraceDays, now });
    summary.expiredUnverified += 1;
  }
  if (!creds) return { ...summary, configured: false };

  const due = await db.storeEntitlement.findMany({
    where: {
      tenantId: tenant.id, verified: true, status: { in: ['active', 'grace'] }, NOT: { purchaseKeySealed: null },
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now - 6 * 3600000) } }, { accessUntil: { lt: new Date(now + DAY) } }]
    },
    orderBy: { lastCheckedAt: 'asc' },
    take: limit
  });
  for (const ent of due) {
    summary.checked += 1;
    try {
      const r = await recheckOne(db, tenant, ent, { creds, now, settings, productPlans });
      if (r.renewedKeys) summary.renewedKeys += 1;
      if (r.changed) summary.changed += 1;
    } catch (e) {
      summary.errors += 1;
      await db.storeEntitlement.update({ where: { id: ent.id }, data: { lastCheckError: String((e && e.message) || e).slice(0, 300), lastCheckedAt: new Date(now) } }).catch(() => {});
    }
  }
  return { ...summary, configured: true };
}

async function recheckOne(db, tenant, ent, { creds, now, settings, productPlans }) {
  let keys = { collections: open(ent.collectionsKeySealed), purchase: open(ent.purchaseKeySealed) };
  let renewedKeys = false;
  if (!ent.keysIssuedAt || ms(ent.keysIssuedAt) < now - api.KEY_RENEW_AFTER_DAYS * DAY) {
    keys = { collections: await api.renewKey(creds, 'collections', keys.collections), purchase: await api.renewKey(creds, 'purchase', keys.purchase) };
    renewedKeys = true;
  }
  const install = await db.install.findUnique({ where: { id: ent.installId } });
  if (!install) return { changed: false, renewedKeys };
  const results = await verifyWithStore(creds, { ...keys, publisherUserId: install.id }, { productPlans, now, renewalGraceDays: settings.store.renewalGraceDays });
  const result = results.get(ent.productId) || { status: 'not_owned', verified: true, expiresAt: ent.expiresAt, accessUntil: new Date(now) };
  const updated = await applyResult(db, tenant, install, {
    productId: ent.productId, planKey: ent.planKey, result, keys: renewedKeys ? keys : null, now, settings, actor: 'cron'
  });
  return { changed: updated.status !== ent.status || ms(updated.accessUntil) !== ms(ent.accessUntil), renewedKeys };
}

// Admin: what needs the owner's attention.
async function storeStatus(db, tenant, { settings, now = Date.now() }) {
  const cfg = settings.store;
  const creds = await api.loadCredentials(db, tenant.id);
  const rows = await db.storeEntitlement.findMany({ where: { tenantId: tenant.id } });
  const counts = {};
  for (const s of STATUSES) counts[s] = 0;
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  const unverifiedActive = rows.filter((r) => !r.verified && GRANTING.has(r.status) && ms(r.accessUntil) > now).length;
  const pendingReview = rows.filter((r) => r.status === 'pending').length;
  const checkErrors = rows.filter((r) => r.lastCheckError && GRANTING.has(r.status)).length;
  const unknownPlans = [];
  for (const [productId, planKey] of Object.entries(cfg.productPlans || {})) {
    const plan = await planRow(db, tenant.id, planKey);
    if (!plan || !plan.active) unknownPlans.push({ productId, plan: planKey });
  }
  const alerts = [];
  if (!creds) alerts.push('credentials_missing');
  if (unverifiedActive) alerts.push('unverified_entitlements');
  if (pendingReview) alerts.push('pending_review');
  if (checkErrors) alerts.push('check_errors');
  if (unknownPlans.length) alerts.push('unknown_plans');
  return {
    configured: Boolean(creds), acceptUnverified: cfg.acceptUnverified, unverifiedDays: cfg.unverifiedDays, productPlans: cfg.productPlans,
    counts, unverifiedActive, pendingReview, checkErrors, unknownPlans, alerts
  };
}

// The admin approves a pending (unverified, not accepted) claim after checking it in Partner Center,
// or revokes any entitlement. -> updated row
async function adminSetStatus(db, tenant, ent, { action, now = Date.now(), settings }) {
  const install = await db.install.findUnique({ where: { id: ent.installId } });
  if (!install) return null;
  const result = action === 'approve'
    ? { status: 'active', verified: false, verifyNote: 'approved_by_admin', expiresAt: ent.expiresAt, accessUntil: minDate(ent.expiresAt, now + 35 * DAY) }
    : { status: 'revoked', verified: ent.verified, verifyNote: ent.verifyNote, expiresAt: ent.expiresAt, accessUntil: new Date(now) };
  return applyResult(db, tenant, install, { productId: ent.productId, planKey: ent.planKey, result, now, settings, actor: 'admin' });
}

// Admin list rows never carry the sealed keys.
function adminView(ent) {
  const { collectionsKeySealed, purchaseKeySealed, ...rest } = ent;
  return { ...rest, hasKeys: Boolean(purchaseKeySealed && collectionsKeySealed) };
}


module.exports = {
  STATUSES, GRANTING, SERVER_SIDE_FAILURES, parseFormattedPrice, cleanAddOns, cleanPrices, interpretStore, claimStore, storeSession,
  recheckTenant, recheckOne, storeStatus, adminSetStatus, adminView, publicView, syncLicence
};
