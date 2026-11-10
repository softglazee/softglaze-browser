'use strict';
// In-memory stand-in for the Prisma client, covering what src/ uses: findUnique / findFirst /
// findMany (where with equals, in, notIn, not, lt/lte/gt/gte, contains, startsWith, AND / OR / NOT,
// null), orderBy (object or array; NULLs first ascending like MySQL), skip / take / select, count,
// create (defaults, @updatedAt, unique constraints -> P2002), update (P2025, { increment }), updateMany,
// upsert, delete, deleteMany, and $transaction (callback with rollback, or an array).
// Unique constraints mirror prisma/schema.prisma; a NULL never collides (as in MySQL).

const UNIQUE = {
  tenant: [],
  tenantPaymentConfig: [['tenantId', 'provider']],
  plan: [['tenantId', 'key']],
  install: [['tenantId', 'machineId']],
  license: [],
  payment: [],
  webhookEvent: [],
  licenseCode: [['tenantId', 'code']],
  customer: [['tenantId', 'emailKey']],
  customerEvent: [],
  emailVerification: [],
  trial: [['tenantId', 'machineLock'], ['tenantId', 'emailLock']],
  trialAttempt: [],
  emailTemplate: [['tenantId', 'key', 'lang']],
  emailOutbox: [['tenantId', 'dedupeKey']],
  setting: [['tenantId', 'key']],
  adminKey: [['keyHash']],
  adminAudit: [],
  planPriceHistory: [],
  segment: [['tenantId', 'name']],
  metricSnapshot: [['tenantId', 'day']],
  jobLock: [],
  storeEntitlement: [['tenantId', 'installId', 'productId']],
  identity: [['tenantId', 'provider', 'providerUserId']],
  authState: [['stateHash']],
  authCode: [['codeHash']],
  authSession: [['tokenHash']]
};
const ID_FIELD = { jobLock: 'name' };

const DEFAULTS = {
  plan: () => ({ tier: 'pro', currency: 'USD', interval: 'month', months: 1, recurring: false, active: true, highlight: false, sortOrder: 0, features: null, limits: null, description: null }),
  install: () => ({ account: null, secretHash: null, machineHash: null, machineBoundAt: null, lastSeenAt: null, customerId: null, appVersion: null, channel: null }),
  license: () => ({ account: null, installId: null, tier: 'pro', plan: null, status: 'active', currentPeriodEnd: null, providerRef: null, rebindCount: 0, rebindWindowStart: null, customerId: null, complimentary: false, source: null, note: null, revokedAt: null, revokedReason: null }),
  payment: () => ({ providerRef: null, currency: 'USD', status: 'pending', account: null, plan: null, installId: null, customerId: null, method: null, note: null, paidAt: null, refundedAt: null, recordedBy: null }),
  customer: () => ({
    emailVerifiedAt: null, name: null, company: null, country: null, phone: null, useCase: null, useCaseOther: null, lang: null, source: 'app', status: 'lead', statusAuto: 'lead',
    statusOverride: null, statusNote: null, tier: null, firstSeenAt: new Date(), lastSeenAt: null, appVersion: null, firstChannel: null, trialStartedAt: null, trialEndsAt: null,
    paidSince: null, paidUntil: null, complimentaryUntil: null, totalPaidCents: 0, currency: null, marketingConsent: false, consentAt: null, consentSource: null,
    unsubscribedAt: null, notes: null, tags: null, tagIndex: null, deletedAt: null
  }),
  customerEvent: () => ({ data: null, at: new Date() }),
  emailVerification: () => ({ customerId: null, name: null, lang: null, country: null, consentMarketing: false, phone: null, company: null, useCase: null, useCaseOther: null, attempts: 0, verifiedAt: null, ipHash: null }),
  trial: () => ({ customerId: null, installId: null, ipHash: null, machineLock: null, emailLock: null, networkCounted: true, tier: 'enterprise', startedAt: new Date(), convertedAt: null, resetAt: null, resetReason: null, resetBy: null }),
  trialAttempt: () => ({ installId: null, ipHash: null, at: new Date() }),
  emailTemplate: () => ({ lang: 'en', builtIn: false, isDefault: false, updatedBy: null }),
  emailOutbox: () => ({ customerId: null, templateKey: null, campaignId: null, dedupeKey: null, html: null, text: null, priority: 0, status: 'queued', attempts: 0, maxAttempts: 5, nextAttemptAt: new Date(), lockedAt: null, lastError: null, messageId: null, sentAt: null, createdBy: null }),
  setting: () => ({ updatedBy: null }),
  adminKey: () => ({ lastUsedAt: null, revokedAt: null }),
  adminAudit: () => ({ at: new Date(), keyId: null, targetType: null, targetId: null, detail: null }),
  planPriceHistory: () => ({ oldAmount: null, oldCurrency: null, changedAt: new Date(), changedBy: null, note: null }),
  jobLock: () => ({ lockedUntil: null, holder: null, lastStartedAt: null, lastFinishedAt: null, lastResult: null }),
  webhookEvent: () => ({ receivedAt: new Date(), processedAt: null }),
  licenseCode: () => ({ tier: 'pro', months: 1, redeemedAt: null, redeemedBy: null }),
  tenantPaymentConfig: () => ({ enabled: false }),
  identity: () => ({ email: null, emailVerified: false, login: null, lastUsedAt: null }),
  authState: () => ({ ipHash: null, usedAt: null }),
  authCode: () => ({ usedAt: null }),
  authSession: () => ({ identityId: null, ipHash: null, lastUsedAt: null, revokedAt: null }),
  storeEntitlement: () => ({
    customerId: null, licenseId: null, account: null, planKey: null, tier: 'pro', status: 'active', verified: false, verifyNote: null,
    expiresAt: null, accessUntil: null, autoRenew: null, recurrenceId: null, recurrenceState: null, storeId: null, skuStoreId: null,
    subscriptionKey: null, priceFormatted: null, currency: null, collectionsKeySealed: null, purchaseKeySealed: null, keysIssuedAt: null,
    movedAt: null, firstClaimAt: new Date(), lastClaimAt: null, lastCheckedAt: null, lastCheckError: null
  })
};
const HAS_UPDATED_AT = new Set(['plan', 'license', 'customer', 'emailTemplate', 'emailOutbox', 'setting', 'segment', 'metricSnapshot', 'tenantPaymentConfig', 'storeEntitlement']);
const HAS_CREATED_AT = new Set(['tenant', 'plan', 'install', 'license', 'payment', 'licenseCode', 'customer', 'customerEvent', 'emailVerification',
  'emailTemplate', 'emailOutbox', 'adminKey', 'segment', 'metricSnapshot', 'storeEntitlement', 'identity', 'authState', 'authCode', 'authSession']);

const isObj = (v) => v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);
const val = (v) => (v instanceof Date ? v.getTime() : v);
const eq = (a, b) => (a == null && b == null) || (a != null && b != null && val(a) === val(b));
const ci = (s) => String(s).toLowerCase();

function cond(v, c) {
  if (!isObj(c)) return c === null ? v == null : eq(v, c);
  for (const [op, x] of Object.entries(c)) {
    switch (op) {
      case 'equals': if (!(x === null ? v == null : eq(v, x))) return false; break;
      case 'in': if (!x.some((y) => eq(v, y))) return false; break;
      case 'notIn': if (x.some((y) => eq(v, y))) return false; break;
      case 'not': if (isObj(x) ? cond(v, x) : (x === null ? v == null : eq(v, x))) return false; break;
      case 'lt': if (!(v != null && val(v) < val(x))) return false; break;
      case 'lte': if (!(v != null && val(v) <= val(x))) return false; break;
      case 'gt': if (!(v != null && val(v) > val(x))) return false; break;
      case 'gte': if (!(v != null && val(v) >= val(x))) return false; break;
      // MySQL's default collation compares case-insensitively.
      case 'contains': if (!(v != null && ci(v).includes(ci(x)))) return false; break;
      case 'startsWith': if (!(v != null && ci(v).startsWith(ci(x)))) return false; break;
      case 'endsWith': if (!(v != null && ci(v).endsWith(ci(x)))) return false; break;
      case 'mode': break;
      default: throw new Error(`memoryPrisma: unsupported operator ${op}`);
    }
  }
  return true;
}

function matches(row, where) {
  if (!where) return true;
  for (const [k, c] of Object.entries(where)) {
    if (k === 'AND') { if (!(Array.isArray(c) ? c : [c]).every((w) => matches(row, w))) return false; continue; }
    if (k === 'OR') { if (!c.some((w) => matches(row, w))) return false; continue; }
    if (k === 'NOT') { if ((Array.isArray(c) ? c : [c]).some((w) => matches(row, w))) return false; continue; }
    if (!(k in row) && isObj(c) && !Object.keys(c).some((op) => ['equals', 'in', 'notIn', 'not', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'endsWith'].includes(op))) {
      // compound unique selector, e.g. tenantId_emailKey: { tenantId, emailKey }
      if (!matches(row, c)) return false;
      continue;
    }
    if (!cond(row[k], c)) return false;
  }
  return true;
}

function sorter(orderBy) {
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
  return (a, b) => {
    for (const [f, d] of keys) {
      const dir = (typeof d === 'object' ? d.sort : d) === 'desc' ? -1 : 1;
      const x = a[f]; const y = b[f];
      if (x == null && y == null) continue;
      if (x == null) return -dir;
      if (y == null) return dir;
      const vx = val(x); const vy = val(y);
      if (vx < vy) return -dir;
      if (vx > vy) return dir;
    }
    return 0;
  };
}

const clone = (r) => (r ? structuredClone(r) : r);
function pick(row, select) {
  if (!select) return clone(row);
  const out = {};
  for (const [k, on] of Object.entries(select)) if (on) out[k] = clone(row[k]);
  return out;
}

function memoryPrisma() {
  const tables = {};
  for (const m of Object.keys(UNIQUE)) tables[m] = [];
  let seq = 0;
  let clock = 0;
  const hooks = {};

  function model(name) {
    const rows = () => tables[name];
    const idf = ID_FIELD[name] || 'id';
    const uniqueClash = (row, self) => {
      for (const fields of [[idf], ...UNIQUE[name]]) {
        if (fields.some((f) => row[f] == null)) continue;
        const other = rows().find((r) => r !== self && fields.every((f) => eq(r[f], row[f])));
        if (other) { const e = new Error(`Unique constraint failed on ${fields.join(',')}`); e.code = 'P2002'; e.meta = { target: fields }; return e; }
      }
      return null;
    };
    const applyData = (row, data) => {
      for (const [k, v] of Object.entries(data)) {
        if (isObj(v) && 'increment' in v) row[k] = (row[k] || 0) + v.increment;
        else if (isObj(v) && 'decrement' in v) row[k] = (row[k] || 0) - v.decrement;
        else if (isObj(v) && 'set' in v) row[k] = v.set;
        else row[k] = v === undefined ? row[k] : clone(v);
      }
      if (HAS_UPDATED_AT.has(name)) row.updatedAt = new Date(Date.now() + (++clock));
    };
    const api = {
      async findUnique({ where, select }) { const r = rows().find((x) => matches(x, where)); return r ? pick(r, select) : null; },
      async findFirst({ where, orderBy, select } = {}) {
        let list = rows().filter((x) => matches(x, where));
        if (orderBy) list = list.slice().sort(sorter(orderBy));
        return list[0] ? pick(list[0], select) : null;
      },
      async findMany({ where, orderBy, skip = 0, take, select } = {}) {
        let list = rows().filter((x) => matches(x, where));
        if (orderBy) list = list.slice().sort(sorter(orderBy));
        list = list.slice(skip, take === undefined ? undefined : skip + take);
        return list.map((r) => pick(r, select));
      },
      async count({ where } = {}) { return rows().filter((x) => matches(x, where)).length; },
      async create({ data, select }) {
        if (hooks[`${name}.create`]) hooks[`${name}.create`](data);
        const now = new Date();
        const row = { ...(DEFAULTS[name] ? DEFAULTS[name]() : {}) };
        if (HAS_CREATED_AT.has(name)) row.createdAt = now;
        if (idf === 'id') row.id = `${name}_${++seq}`;
        applyData(row, data);
        if (HAS_UPDATED_AT.has(name) && !data.updatedAt) row.updatedAt = new Date(now.getTime() + (++clock));
        const clash = uniqueClash(row, null);
        if (clash) throw clash;
        rows().push(row);
        return pick(row, select);
      },
      async update({ where, data, select }) {
        if (hooks[`${name}.update`]) hooks[`${name}.update`](data);
        const row = rows().find((x) => matches(x, where));
        if (!row) { const e = new Error('Record to update not found.'); e.code = 'P2025'; throw e; }
        const before = clone(row);
        applyData(row, data);
        const clash = uniqueClash(row, row);
        if (clash) { Object.keys(row).forEach((k) => delete row[k]); Object.assign(row, before); throw clash; }
        return pick(row, select);
      },
      async updateMany({ where, data }) {
        const list = rows().filter((x) => matches(x, where));
        for (const r of list) applyData(r, data);
        return { count: list.length };
      },
      async upsert({ where, create, update }) {
        const row = rows().find((x) => matches(x, where));
        if (row) return api.update({ where: { [idf]: row[idf] }, data: update });
        return api.create({ data: create });
      },
      async delete({ where }) {
        const i = rows().findIndex((x) => matches(x, where));
        if (i < 0) { const e = new Error('Record to delete does not exist.'); e.code = 'P2025'; throw e; }
        return rows().splice(i, 1)[0];
      },
      async deleteMany({ where } = {}) {
        const keep = rows().filter((x) => !matches(x, where));
        const n = rows().length - keep.length;
        tables[name] = keep;
        return { count: n };
      }
    };
    return api;
  }

  const db = { tables, hooks };
  for (const m of Object.keys(UNIQUE)) db[m] = model(m);
  db.$transaction = async (arg) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    const snapshot = structuredClone(tables);
    try { return await arg(db); } catch (e) {
      for (const k of Object.keys(tables)) tables[k] = snapshot[k];
      throw e;
    }
  };
  db.$disconnect = async () => {};
  db.reset = () => { for (const k of Object.keys(tables)) tables[k] = []; };
  return db;
}

module.exports = { memoryPrisma };
