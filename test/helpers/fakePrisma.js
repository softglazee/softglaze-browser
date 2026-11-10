'use strict';
// A small in-memory stand-in for the Prisma client, enough for the SoftGlaze AI engine tests:
// create / findUnique / findFirst / findMany / count / update / updateMany / delete / deleteMany with
// the where operators the engine uses (equals, in, notIn, not, contains, lt/lte/gt/gte, AND, OR, NOT,
// and the proxy.profiles and group.profiles `none` / `some` relation filters), plus the includes it
// reads (a group's profiles with their own where and select, for the Groups list).

function matchValue(value, cond) {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  if (typeof cond !== 'object') return value === cond;
  for (const [op, arg] of Object.entries(cond)) {
    if (op === 'in' && !arg.includes(value)) return false;
    if (op === 'notIn' && arg.includes(value)) return false;
    if (op === 'not') { if (arg === null ? (value === null || value === undefined) : matchValue(value, arg)) return false; }
    if (op === 'equals' && value !== arg) return false;
    if (op === 'contains' && !(typeof value === 'string' && value.toLowerCase().includes(String(arg).toLowerCase()))) return false;
    if (op === 'lt' && !(value < arg)) return false;
    if (op === 'lte' && !(value <= arg)) return false;
    if (op === 'gt' && !(value > arg)) return false;
    if (op === 'gte' && !(value >= arg)) return false;
  }
  return true;
}

function createFakePrisma(seed = {}) {
  const tables = {};
  const ids = {};
  const models = ['apiToken', 'aiAuditLog', 'member', 'profile', 'proxy', 'group', 'proxyGroup', 'activityLog', 'setting', 'macro'];
  for (const m of models) { tables[m] = []; ids[m] = 0; }

  const db = { _tables: tables };

  function matches(model, row, where) {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'AND') { if (!cond.every((w) => matches(model, row, w))) return false; continue; }
      if (key === 'OR') { if (!cond.some((w) => matches(model, row, w))) return false; continue; }
      if (key === 'NOT') { const list = Array.isArray(cond) ? cond : [cond]; if (list.some((w) => matches(model, row, w))) return false; continue; }
      if ((model === 'proxy' || model === 'group') && key === 'profiles') {
        const fk = model === 'proxy' ? 'proxyId' : 'groupId';
        const users = tables.profile.filter((p) => p[fk] === row.id);
        if (cond.none && users.some((p) => matches('profile', p, cond.none))) return false;
        if (cond.some && !users.some((p) => matches('profile', p, cond.some))) return false;
        continue;
      }
      if (!matchValue(row[key], cond)) return false;
    }
    return true;
  }

  function withIncludes(model, row, include, select) {
    if (!row) return row;
    let out = { ...row };
    if (include) {
      if (model === 'profile') {
        if (include.proxy) out.proxy = tables.proxy.find((p) => p.id === row.proxyId) || null;
        if (include.group) out.group = tables.group.find((g) => g.id === row.groupId) || null;
      }
      if (model === 'proxy') {
        if (include._count) out._count = { profiles: tables.profile.filter((p) => p.proxyId === row.id).length };
        if (include.proxyGroup) out.proxyGroup = tables.proxyGroup.find((g) => g.id === row.proxyGroupId) || null;
      }
      if (model === 'group' && include.profiles) {
        const spec = include.profiles === true ? {} : include.profiles;
        out.profiles = tables.profile
          .filter((p) => p.groupId === row.id && matches('profile', p, spec.where))
          .map((p) => withIncludes('profile', p, null, spec.select));
      }
    }
    if (select) {
      const picked = {};
      for (const k of Object.keys(select)) if (select[k]) picked[k] = out[k];
      out = picked;
    }
    return out;
  }

  function sortRows(rows, orderBy) {
    if (!orderBy) return rows;
    const list = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
      for (const o of list) {
        const [k, dir] = Object.entries(o)[0];
        const av = a[k] instanceof Date ? a[k].getTime() : a[k];
        const bv = b[k] instanceof Date ? b[k].getTime() : b[k];
        if (av === bv) continue;
        const cmp = av > bv ? 1 : -1;
        return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }

  for (const model of models) {
    db[model] = {
      async create({ data }) {
        ids[model] += 1;
        const row = { id: data.id || ids[model], createdAt: new Date(), ...data };
        if (model === 'aiAuditLog' && !row.at) row.at = new Date();
        tables[model].push(row);
        return { ...row };
      },
      async findUnique({ where, include, select }) {
        const row = tables[model].find((r) => matches(model, r, where));
        return row ? withIncludes(model, row, include, select) : null;
      },
      async findFirst({ where, orderBy, include, select } = {}) {
        const rows = sortRows(tables[model].filter((r) => matches(model, r, where)), orderBy);
        return rows.length ? withIncludes(model, rows[0], include, select) : null;
      },
      async findMany({ where, orderBy, skip = 0, take, include, select } = {}) {
        let rows = sortRows(tables[model].filter((r) => matches(model, r, where)), orderBy);
        rows = rows.slice(skip, take == null ? undefined : skip + take);
        return rows.map((r) => withIncludes(model, r, include, select));
      },
      async count({ where } = {}) {
        return tables[model].filter((r) => matches(model, r, where)).length;
      },
      async update({ where, data }) {
        const row = tables[model].find((r) => matches(model, r, where));
        if (!row) throw new Error(`${model} not found`);
        Object.assign(row, data);
        return { ...row };
      },
      async updateMany({ where, data }) {
        const rows = tables[model].filter((r) => matches(model, r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      async delete({ where }) {
        const row = tables[model].find((r) => matches(model, r, where));
        if (!row) throw new Error(`${model} not found`);
        tables[model] = tables[model].filter((r) => r !== row);
        return { ...row };
      },
      async deleteMany({ where } = {}) {
        const before = tables[model].length;
        tables[model] = tables[model].filter((r) => !matches(model, r, where));
        return { count: before - tables[model].length };
      },
      async upsert({ where, update, create }) {
        const row = tables[model].find((r) => matches(model, r, where));
        if (row) { Object.assign(row, update); return { ...row }; }
        return db[model].create({ data: create });
      }
    };
  }

  for (const [model, rows] of Object.entries(seed)) {
    for (const r of rows) { tables[model].push({ createdAt: new Date(), ...r }); ids[model] = Math.max(ids[model], r.id || 0); }
  }
  return db;
}

module.exports = { createFakePrisma };
