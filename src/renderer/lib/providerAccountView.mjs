// Display rules for the provider Account section. Pure, so tests import it directly.

const DAY_MS = 24 * 60 * 60 * 1000;
export const EXPIRY_WARN_DAYS = 7;

// 'YYYY-MM-DD' is a calendar day (local midnight); anything else is an exact instant.
export function parseExpiry(value) {
  if (!value || typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Whole days from today to the expiry day: 0 is today, negative is past.
export function daysLeft(value, now = new Date()) {
  const d = parseExpiry(value);
  if (!d) return null;
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

// 'destructive' once expired, 'warning' inside the last week, otherwise null (plain text).
export function expiryTone(value, now = new Date()) {
  const left = daysLeft(value, now);
  if (left == null) return null;
  if (left < 0) return 'destructive';
  return left <= EXPIRY_WARN_DAYS ? 'warning' : null;
}

export function trafficTone(leftGb) {
  return typeof leftGb === 'number' && leftGb <= 0 ? 'destructive' : null;
}

export function statusTone(status) {
  if (status === 'active') return 'success';
  if (status === 'expired' || status === 'suspended') return 'destructive';
  return 'muted';
}

export const TONE_CLASS = Object.freeze({
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground'
});

export function formatGb(value, lang) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const digits = value !== 0 && Math.abs(value) < 10 ? 2 : 1;
  try {
    return `${new Intl.NumberFormat(lang || undefined, { maximumFractionDigits: digits }).format(value)} GB`;
  } catch (e) {
    return `${value.toFixed(digits)} GB`;
  }
}

export function formatMoney(amount, currency, lang) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '';
  const code = String(currency || '').toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) {
    try { return new Intl.NumberFormat(lang || undefined, { style: 'currency', currency: code }).format(amount); } catch (e) { /* unknown code */ }
  }
  const n = new Intl.NumberFormat(lang || undefined, { maximumFractionDigits: 2 }).format(amount);
  return code ? `${n} ${code}` : n;
}

// Rows to show for an account result, in display order; fields the vendor did not report are
// left out rather than shown as blanks.
export function accountRows(account) {
  if (!account || typeof account !== 'object') return [];
  const rows = [];
  if (account.plan) rows.push('plan');
  if (account.expiresAt) rows.push('expires');
  if (account.trafficLeftGb != null || account.trafficUsedGb != null || account.trafficTotalGb != null) rows.push('traffic');
  if (account.balance != null) rows.push('balance');
  return rows;
}
