'use strict';
// Calendar helpers. All reporting is in UTC: a day is YYYY-MM-DD, a month YYYY-MM, a week starts on
// Monday (ISO 8601).
const DAY = 86400000;

const toDate = (v) => (v instanceof Date ? v : new Date(v));
const ms = (v) => (v == null ? null : toDate(v).getTime());

function dayKey(v) { return toDate(v).toISOString().slice(0, 10); }
function monthKey(v) { return toDate(v).toISOString().slice(0, 7); }

function monthStart(key) { return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1); }
function nextMonthStart(key) { return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 1); }

function weekKey(v) {
  const d = toDate(v);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return dayKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

// Inclusive list of YYYY-MM keys from `from` to `to`.
function monthRange(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (out.length > 600) break;
  }
  return out;
}

function isMonthKey(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }

function parseDateParam(v) {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// The length of a licence term of `months` (one-time payments, purchase codes, manual grants and
// refunds): a month is 30 days and each whole year is 365 days, so a yearly plan (months 12) lasts a
// year, not 360 days. 1 -> 30, 6 -> 180, 11 -> 330, 12 -> 365, 13 -> 395, 24 -> 730.
function termDays(months) {
  const m = Math.max(0, Math.floor(Number(months) || 0));
  return Math.floor(m / 12) * 365 + (m % 12) * 30;
}
const termMs = (months) => termDays(months) * DAY;

module.exports = { DAY, ms, toDate, dayKey, monthKey, monthStart, nextMonthStart, weekKey, monthRange, isMonthKey, parseDateParam, termDays, termMs };
