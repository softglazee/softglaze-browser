'use strict';
// Partner deals: the "Recommended proxy deals" card the app shows on the Free plan only (limits.partnerDeals).
// No third-party code: the app reads GET /v1/partner-deals from this server and opens a deal's url in the
// user's own browser; POST /v1/partner-deals/:id/click counts the click here (a counter and a time, nothing
// about the person). Deals are managed with /v1/admin/partner-deals.
const DISCLOSURE = 'Partner offer. SoftGlaze may earn a commission.';
const MAX_PUBLIC = 6;
const CACHE_MS = 5 * 60000;
const cache = new Map(); // tenantId -> { at, rows } (the active rows; the date window is applied per request)

const ms = (v) => (v == null ? null : new Date(v).getTime());
const live = (d, now) => d.active && (d.startsAt == null || ms(d.startsAt) <= now) && (d.endsAt == null || ms(d.endsAt) > now);

function publicDeal(d) {
  return {
    id: d.id, title: d.title, vendor: d.vendor, description: d.description || null, url: d.url,
    code: d.code || null, badge: d.badge || null, logoUrl: d.logoUrl || null
  };
}

// -> { deals: [...], disclosure }: active and in their date window, by sortOrder, at most 6.
async function getPublicDeals(db, tenantId, now = Date.now()) {
  let hit = cache.get(tenantId);
  if (!hit || now - hit.at >= CACHE_MS) {
    const rows = await db.partnerDeal.findMany({ where: { tenantId, active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    hit = { at: now, rows };
    cache.set(tenantId, hit);
  }
  return { deals: hit.rows.filter((d) => live(d, now)).slice(0, MAX_PUBLIC).map(publicDeal), disclosure: DISCLOSURE };
}

function invalidatePublicDeals(tenantId) { cache.delete(tenantId); }

// Counts one click of a live deal of this tenant. -> true when counted.
async function countClick(db, tenantId, id, now = Date.now()) {
  const at = new Date(now);
  const r = await db.partnerDeal.updateMany({
    where: {
      id, tenantId, active: true,
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: at } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: at } }] }]
    },
    data: { clicks: { increment: 1 }, lastClickAt: at }
  });
  return Boolean(r && r.count);
}

const httpsUrl = (v) => {
  if (typeof v !== 'string' || !v.trim() || v.length > 500 || /\s/.test(v.trim())) return false;
  try { const u = new URL(v.trim()); return u.protocol === 'https:' && Boolean(u.hostname); } catch (_) { return false; }
};
const CONTROL = /[\u0000-\u001f\u007f]/;
const text = (max) => (v) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max && !CONTROL.test(v);
const optional = (rule) => (v) => v === null || rule(v);
const date = (v) => v === null || (typeof v === 'string' && v.length <= 40 && !Number.isNaN(new Date(v).getTime()));

const RULES = {
  title: [text(120), 'required, 1-120 characters'],
  vendor: [text(80), 'required, 1-80 characters'],
  description: [optional(text(300)), 'at most 300 characters, or null'],
  url: [httpsUrl, 'an https:// link, at most 500 characters'],
  code: [optional(text(60)), 'at most 60 characters, or null'],
  badge: [optional(text(40)), 'at most 40 characters, or null'],
  logoUrl: [optional(httpsUrl), 'an https:// link, at most 500 characters, or null'],
  active: [(v) => typeof v === 'boolean', 'boolean'],
  startsAt: [date, 'an ISO date, or null'],
  endsAt: [date, 'an ISO date, or null'],
  sortOrder: [(v) => Number.isInteger(v) && Math.abs(v) <= 10000, 'integer -10000 to 10000']
};
const REQUIRED = ['title', 'vendor', 'url'];
const TRIM = new Set(['title', 'vendor', 'description', 'url', 'code', 'badge', 'logoUrl']);

// -> { data, errors }. partial: PATCH (only what is present). current: the stored deal (PATCH), for the date order.
function validateDeal(b, { partial = false, current = null } = {}) {
  const errors = {};
  const data = {};
  const body = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  for (const [k, [rule, msg]] of Object.entries(RULES)) {
    if (body[k] === undefined) {
      if (!partial && REQUIRED.includes(k)) errors[k] = msg;
      continue;
    }
    if (!rule(body[k])) { errors[k] = msg; continue; }
    let v = body[k];
    if (TRIM.has(k) && typeof v === 'string') v = v.trim();
    if ((k === 'startsAt' || k === 'endsAt') && v !== null) v = new Date(v);
    data[k] = v;
  }
  const starts = data.startsAt !== undefined ? data.startsAt : current && current.startsAt;
  const ends = data.endsAt !== undefined ? data.endsAt : current && current.endsAt;
  if (!errors.startsAt && !errors.endsAt && starts && ends && ms(ends) <= ms(starts)) errors.endsAt = 'must be after startsAt';
  return { data, errors: Object.keys(errors).length ? errors : null };
}

module.exports = { DISCLOSURE, MAX_PUBLIC, getPublicDeals, invalidatePublicDeals, countClick, validateDeal, publicDeal, httpsUrl };
