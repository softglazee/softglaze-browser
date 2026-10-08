'use strict';
// In-memory stand-in for the prisma calls the webhook + licensing code makes. Enough of
// Prisma's semantics to test idempotency: a duplicate primary key throws P2002, and
// $transaction rolls every table back when its callback throws.

function matches(row, where) {
  for (const [k, cond] of Object.entries(where || {})) {
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('lt' in cond && !(v instanceof Date && v.getTime() < new Date(cond.lt).getTime())) return false;
      continue;
    }
    if (cond === null ? v != null : v !== cond) return false;
  }
  return true;
}

function fakePrisma() {
  const tables = { tenant: [], tenantPaymentConfig: [], payment: [], plan: [], license: [], webhookEvent: [] };
  let n = 0;
  const hooks = {}; // hooks['license.create'] = fn -> may throw
  const hook = (name, args) => { if (hooks[name]) hooks[name](args); };

  function model(name, defaults = () => ({})) {
    const rows = () => tables[name];
    return {
      findUnique: async ({ where }) => {
        if (where.id) return rows().find((r) => r.id === where.id) || null;
        const [key] = Object.keys(where);
        return rows().find((r) => matches(r, where[key])) || null;
      },
      findFirst: async ({ where, orderBy }) => {
        let list = rows().filter((r) => matches(r, where));
        if (orderBy) {
          const [[f, dir]] = Object.entries(orderBy);
          list = list.slice().sort((a, b) => (dir === 'desc' ? -1 : 1) * (new Date(a[f]) - new Date(b[f])));
        }
        return list[0] || null;
      },
      create: async ({ data }) => {
        hook(`${name}.create`, data);
        if (data.id && rows().some((r) => r.id === data.id)) {
          const e = new Error('Unique constraint failed'); e.code = 'P2002'; throw e;
        }
        const row = { id: data.id || `${name}_${++n}`, ...defaults(), ...data, createdAt: new Date(), updatedAt: new Date(Date.now() + n) };
        rows().push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        hook(`${name}.update`, data);
        const row = rows().find((r) => r.id === where.id);
        if (!row) { const e = new Error('Record not found'); e.code = 'P2025'; throw e; }
        Object.assign(row, data, { updatedAt: new Date(Date.now() + (++n)) });
        return { ...row };
      },
      updateMany: async ({ where, data }) => {
        const list = rows().filter((r) => matches(r, where));
        for (const r of list) Object.assign(r, data);
        return { count: list.length };
      },
      delete: async ({ where }) => {
        const i = rows().findIndex((r) => r.id === where.id);
        if (i < 0) { const e = new Error('Record not found'); e.code = 'P2025'; throw e; }
        return rows().splice(i, 1)[0];
      }
    };
  }

  const db = {
    tables, hooks,
    tenant: model('tenant'),
    tenantPaymentConfig: model('tenantPaymentConfig'),
    payment: model('payment', () => ({ status: 'pending' })),
    plan: model('plan'),
    license: model('license'),
    webhookEvent: model('webhookEvent', () => ({ receivedAt: new Date(), processedAt: null }))
  };
  db.$transaction = async (fn) => {
    const snapshot = structuredClone(tables);
    try { return await fn(db); }
    catch (e) { for (const k of Object.keys(tables)) tables[k] = snapshot[k]; throw e; }
  };
  return db;
}

module.exports = { fakePrisma };
