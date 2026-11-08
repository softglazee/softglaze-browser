'use strict';
// Customer filters shared by the list, CSV export, saved segments and custom email sends. Input is a
// flat object of strings (a query string) or a saved segment's filters; output is a Prisma `where`.
const { STATUSES } = require('./state');
const { asJson } = require('../util/json');
const { USE_CASES } = require('../account/lead');

const SOURCES = ['app', 'manual', 'import', 'invoice', 'website'];
const SORTABLE = ['createdAt', 'updatedAt', 'firstSeenAt', 'lastSeenAt', 'email', 'name', 'company', 'country', 'useCase', 'status', 'tier',
  'paidUntil', 'paidSince', 'trialEndsAt', 'trialStartedAt', 'totalPaidCents', 'emailVerifiedAt'];
const FILTER_KEYS = ['status', 'tier', 'source', 'country', 'useCase', 'consent', 'verified', 'unsubscribed', 'complimentary', 'tag', 'q',
  'createdFrom', 'createdTo', 'lastSeenFrom', 'lastSeenTo', 'paidUntilFrom', 'paidUntilTo', 'trialEndsFrom', 'trialEndsTo', 'deleted', 'ids'];

const list = (v) => (Array.isArray(v) ? v : String(v == null ? '' : v).split(',')).map((x) => String(x).trim()).filter(Boolean);
const yes = (v) => ['1', 'true', 'yes'].includes(String(v).toLowerCase());
const no = (v) => ['0', 'false', 'no'].includes(String(v).toLowerCase());

function dateParam(v) {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function normalizeTags(v) {
  const arr = Array.isArray(v) ? v : list(v).length ? list(v) : [];
  const out = [];
  for (const t of arr) {
    const s = String(t).trim().toLowerCase().replace(/[^a-z0-9 _.:-]/g, '').replace(/\s+/g, '-').slice(0, 40);
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 30);
}
const tagIndexOf = (tags) => (tags.length ? `,${tags.join(',')},` : null);

// -> { where, errors }
function buildWhere(tenantId, f = {}) {
  const errors = {};
  const and = [];
  const where = { tenantId };
  const deleted = String(f.deleted || '').toLowerCase();
  if (deleted === 'only') where.NOT = { deletedAt: null };
  else if (deleted !== 'include') where.deletedAt = null;

  if (f.ids !== undefined && f.ids !== '') {
    const ids = list(f.ids).slice(0, 5000);
    where.id = { in: ids };
  }
  if (f.status) {
    const s = list(f.status);
    if (s.some((x) => !STATUSES.includes(x))) errors.status = 'unknown_status';
    else where.status = { in: s };
  }
  if (f.tier) {
    const t = list(f.tier);
    const named = t.filter((x) => x !== 'none');
    if (named.some((x) => !['pro', 'enterprise'].includes(x))) errors.tier = 'unknown_tier';
    else if (t.includes('none')) and.push({ OR: [{ tier: null }, ...(named.length ? [{ tier: { in: named } }] : [])] });
    else where.tier = { in: named };
  }
  if (f.source) {
    const s = list(f.source);
    if (s.some((x) => !SOURCES.includes(x))) errors.source = 'unknown_source';
    else where.source = { in: s };
  }
  if (f.country) {
    const c = list(f.country).map((x) => x.toUpperCase());
    if (c.some((x) => x !== 'UNKNOWN' && !/^[A-Z]{2}$/.test(x))) errors.country = 'invalid_country';
    else if (c.includes('UNKNOWN')) and.push({ OR: [{ country: null }, { country: { in: c.filter((x) => x !== 'UNKNOWN') } }] });
    else where.country = { in: c };
  }
  if (f.useCase) {
    const u = list(f.useCase).map((x) => x.toLowerCase());
    const named = u.filter((x) => x !== 'none');
    if (named.some((x) => !USE_CASES.includes(x))) errors.useCase = 'unknown_use_case';
    else if (u.includes('none')) and.push({ OR: [{ useCase: null }, ...(named.length ? [{ useCase: { in: named } }] : [])] });
    else where.useCase = { in: named };
  }
  for (const [key, field, cond] of [
    ['consent', 'marketingConsent', null], ['verified', 'emailVerifiedAt', 'date'], ['unsubscribed', 'unsubscribedAt', 'date'],
    ['complimentary', 'complimentaryUntil', 'date']
  ]) {
    const v = f[key];
    if (v === undefined || v === '') continue;
    if (!yes(v) && !no(v)) { errors[key] = 'expected_boolean'; continue; }
    if (cond === 'date') and.push(yes(v) ? { NOT: { [field]: null } } : { [field]: null });
    else where[field] = yes(v);
  }
  for (const [fromKey, toKey, field] of [
    ['createdFrom', 'createdTo', 'createdAt'], ['lastSeenFrom', 'lastSeenTo', 'lastSeenAt'],
    ['paidUntilFrom', 'paidUntilTo', 'paidUntil'], ['trialEndsFrom', 'trialEndsTo', 'trialEndsAt']
  ]) {
    const a = dateParam(f[fromKey]);
    const b = dateParam(f[toKey]);
    if (a === undefined) errors[fromKey] = 'invalid_date';
    if (b === undefined) errors[toKey] = 'invalid_date';
    if (a || b) where[field] = { ...(a ? { gte: a } : {}), ...(b ? { lte: b } : {}) };
  }
  if (f.tag) for (const t of normalizeTags(f.tag)) and.push({ tagIndex: { contains: `,${t},` } });
  if (f.q) {
    const q = String(f.q).trim().slice(0, 100);
    if (q) and.push({ OR: [{ email: { contains: q.toLowerCase() } }, { name: { contains: q } }, { company: { contains: q } }, { phone: { contains: q } }, { useCaseOther: { contains: q } }, { id: q }] });
  }
  if (and.length) where.AND = and;
  return { where, errors: Object.keys(errors).length ? errors : null };
}

function pickFilters(src = {}) {
  const out = {};
  for (const k of FILTER_KEYS) if (src[k] !== undefined && src[k] !== '') out[k] = Array.isArray(src[k]) ? src[k].join(',') : String(src[k]);
  return out;
}

function orderBy(sort, order) {
  const field = SORTABLE.includes(sort) ? sort : 'createdAt';
  const dir = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';
  return [{ [field]: dir }, { id: dir }];
}

function page(q) {
  const p = Math.max(1, Number.parseInt(q.page, 10) || 1);
  const size = Math.min(200, Math.max(1, Number.parseInt(q.pageSize, 10) || 50));
  return { page: p, pageSize: size, skip: (p - 1) * size, take: size };
}

function serializeCustomer(c) {
  if (!c) return null;
  const { tagIndex, tenantId, ...rest } = c;
  return { ...rest, tags: asJson(c.tags) || [] };
}

module.exports = { buildWhere, pickFilters, orderBy, page, serializeCustomer, normalizeTags, tagIndexOf, SOURCES, SORTABLE, FILTER_KEYS };
