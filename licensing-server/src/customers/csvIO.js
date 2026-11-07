'use strict';
// Customer CSV import and export. Export writes every stored field (tags joined with ";"); import reads
// the editable fields back, so export -> import round-trips. Computed columns (status, trial, paid
// dates, totals) are reported as ignored on import: they come from licences, payments and trials.
// Import dedupes by emailKey within the file and against existing customers; a dry run returns the
// per-row report without writing anything.
const { parseCsv, stringifyCsv, importCell } = require('../util/csv');
const { parseEmail } = require('./emailAddress');
const { isDisposableDomain } = require('./disposable');
const { normalizeTags, tagIndexOf, SOURCES } = require('./query');
const { asJson } = require('../util/json');

const EXPORT_COLUMNS = ['id', 'email', 'name', 'company', 'country', 'phone', 'lang', 'source', 'status', 'statusAuto', 'statusOverride',
  'statusNote', 'tier', 'emailVerifiedAt', 'firstSeenAt', 'lastSeenAt', 'appVersion', 'trialStartedAt', 'trialEndsAt', 'paidSince',
  'paidUntil', 'complimentaryUntil', 'totalPaidCents', 'currency', 'marketingConsent', 'consentAt', 'consentSource', 'unsubscribedAt',
  'tags', 'notes', 'createdAt', 'updatedAt', 'deletedAt'];
const IMPORT_COLUMNS = ['email', 'name', 'company', 'country', 'phone', 'lang', 'source', 'marketingConsent', 'consentAt', 'consentSource',
  'unsubscribedAt', 'tags', 'notes'];
const MAX_ROWS = 10000;

function exportCsv(customers) {
  const rows = [EXPORT_COLUMNS];
  for (const c of customers) {
    rows.push(EXPORT_COLUMNS.map((k) => {
      if (k === 'tags') return (asJson(c.tags) || []).join(';');
      const v = c[k];
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      return v;
    }));
  }
  return stringifyCsv(rows);
}

const BOOL_T = new Set(['true', 'yes', '1', 'y']);
const BOOL_F = new Set(['false', 'no', '0', 'n', '']);

function parseBool(v) {
  const s = String(v || '').trim().toLowerCase();
  if (BOOL_T.has(s)) return true;
  if (BOOL_F.has(s)) return false;
  return undefined;
}
function parseDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
const clip = (v, n) => { const s = String(v || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim(); return s ? s.slice(0, n) : null; };

// Pure planning step. existing: Map(emailKey -> customer). opts: { onExisting: 'skip'|'update', now, settings }
function planImport(text, existing, { onExisting = 'skip', now = Date.now(), settings } = {}) {
  const table = parseCsv(text);
  if (!table.length) return { error: 'empty_file' };
  const header = table[0].map((h) => importCell(h).trim());
  const lower = header.map((h) => h.toLowerCase());
  const col = {};
  for (const k of IMPORT_COLUMNS) {
    const i = lower.indexOf(k.toLowerCase());
    if (i >= 0) col[k] = i;
  }
  if (col.email === undefined) return { error: 'missing_email_column' };
  const ignoredColumns = header.filter((h, i) => h && !Object.values(col).includes(i));
  const body = table.slice(1);
  if (body.length > MAX_ROWS) return { error: 'too_many_rows', max: MAX_ROWS };

  const seen = new Map();
  const items = [];
  const em = (settings && settings.email) || {};
  body.forEach((cells, idx) => {
    const line = idx + 2;
    const get = (k) => (col[k] === undefined ? '' : importCell(cells[col[k]] == null ? '' : cells[col[k]]).trim());
    const errors = [];
    const warnings = [];
    const parsed = parseEmail(get('email'));
    if (!parsed) {
      items.push({ line, email: get('email') || null, action: 'error', errors: ['invalid_email'], warnings });
      return;
    }
    if (seen.has(parsed.emailKey)) {
      items.push({ line, email: parsed.email, action: 'error', errors: [`duplicate_in_file:line_${seen.get(parsed.emailKey)}`], warnings });
      return;
    }
    seen.set(parsed.emailKey, line);
    if (isDisposableDomain(parsed.domain, { allow: em.domainAllowlist, block: em.domainBlocklist })) warnings.push('disposable_email');

    const data = { email: parsed.email, emailKey: parsed.emailKey };
    for (const [k, n] of [['name', 200], ['company', 200], ['phone', 40], ['notes', 5000]]) {
      const v = clip(get(k), n);
      if (v) data[k] = v;
    }
    const country = get('country').toUpperCase();
    if (country) { if (/^[A-Z]{2}$/.test(country)) data.country = country; else errors.push('invalid_country'); }
    const lang = get('lang').toLowerCase();
    if (lang) { if (/^[a-z]{2}$/.test(lang)) data.lang = lang; else errors.push('invalid_lang'); }
    const source = get('source').toLowerCase();
    if (source) { if (SOURCES.includes(source)) data.source = source; else errors.push('invalid_source'); }
    const tags = normalizeTags(get('tags').split(/[;|]/));
    if (tags.length) data.tags = tags;

    const consent = parseBool(get('marketingConsent'));
    if (consent === undefined) errors.push('invalid_marketingConsent');
    if (consent === true) {
      data.marketingConsent = true;
      const at = parseDate(get('consentAt'));
      if (at === undefined) errors.push('invalid_consentAt');
      data.consentAt = at || new Date(now);
      if (!at) warnings.push('consent_date_missing_used_import_time');
      data.consentSource = clip(get('consentSource'), 40) || 'import';
      if (!get('consentSource')) warnings.push('consent_source_missing_used_import');
    }
    const unsub = get('unsubscribedAt');
    if (unsub) {
      const asBool = parseBool(unsub);
      if (asBool === true) data.unsubscribedAt = new Date(now);
      else if (asBool === undefined) {
        const at = parseDate(unsub);
        if (at) data.unsubscribedAt = at; else errors.push('invalid_unsubscribedAt');
      }
    }

    if (errors.length) { items.push({ line, email: parsed.email, action: 'error', errors, warnings }); return; }
    const found = existing.get(parsed.emailKey);
    if (found) {
      if (onExisting !== 'update') { items.push({ line, email: parsed.email, action: 'skip', errors, warnings: [...warnings, 'exists'], customerId: found.id }); return; }
      items.push({ line, email: parsed.email, action: 'update', errors, warnings, customerId: found.id, data });
      return;
    }
    if (!data.source) data.source = 'import';
    items.push({ line, email: parsed.email, action: 'create', errors, warnings, data });
  });

  const summary = { rows: items.length, create: 0, update: 0, skip: 0, error: 0 };
  for (const it of items) summary[it.action] += 1;
  return { items, summary, ignoredColumns, columns: Object.keys(col) };
}

// The update an import row makes to an existing customer: fills fields, never blanks them; tags are
// added; consent is only ever turned on (an opt-out is imported through unsubscribedAt).
function mergeForUpdate(existing, data) {
  const out = {};
  for (const k of ['name', 'company', 'phone', 'country', 'lang', 'notes']) if (data[k] && data[k] !== existing[k]) out[k] = data[k];
  if (data.tags) {
    const tags = normalizeTags([...(asJson(existing.tags) || []), ...data.tags]);
    out.tags = tags;
    out.tagIndex = tagIndexOf(tags);
  }
  if (data.marketingConsent && !existing.marketingConsent && !existing.unsubscribedAt) {
    Object.assign(out, { marketingConsent: true, consentAt: data.consentAt, consentSource: data.consentSource });
  }
  if (data.unsubscribedAt && !existing.unsubscribedAt) Object.assign(out, { unsubscribedAt: data.unsubscribedAt, marketingConsent: false });
  return out;
}

module.exports = { exportCsv, planImport, mergeForUpdate, EXPORT_COLUMNS, IMPORT_COLUMNS, MAX_ROWS };
