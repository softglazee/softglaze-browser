// Seasonal offer banner (Black Friday 2026, Christmas 2026). Pure and framework-free so node:test can
// exercise it; AppShell renders the result with components/PromoBanner.jsx.
//
// Who sees it: an unpaid licence (Free plan, trial, trial in grace, ended), never a paid or exempt one
// and never a licence registered to another computer. When: only inside an offer's UTC window, read from
// the computer's clock, so it switches itself on and off with no update or server call. It can be
// dismissed; the dismissal is kept per offer (a new offer shows again). The words come from the common
// namespace (promo.<key>.text, promo.cta, promo.dismiss) in every app language; the English below is the
// fallback when no translate function is given (tests, a missing key).

export const PROMOS = Object.freeze([
  Object.freeze({
    id: 'bf-2026',
    key: 'bf2026',
    start: Date.parse('2026-11-24T00:00:00Z'),
    end: Date.parse('2026-12-01T23:59:59Z'),
    url: 'https://browser.softglaze.com/black-friday?utm_source=app&utm_medium=banner&utm_campaign=bf2026',
    // Prices stay out of the locale files (they come in as {{pro}} and {{enterprise}}).
    prices: Object.freeze({ pro: 'US$49', enterprise: 'US$249' }),
    text: 'Black Friday: Pro Lifetime {{pro}} or Enterprise Lifetime {{enterprise}}, one payment. Ends 1 Dec, 23:59 UTC.'
  }),
  Object.freeze({
    id: 'xmas-2026',
    key: 'xmas2026',
    start: Date.parse('2026-12-20T00:00:00Z'),
    end: Date.parse('2026-12-31T23:59:59Z'),
    url: 'https://browser.softglaze.com/black-friday?utm_source=app&utm_medium=banner&utm_campaign=xmas2026',
    prices: Object.freeze({ pro: 'US$49', enterprise: 'US$249' }),
    text: 'Christmas batch: Pro Lifetime {{pro}} or Enterprise Lifetime {{enterprise}}, one payment. Ends 31 Dec, 23:59 UTC.'
  })
]);

export const PROMO_LABELS = Object.freeze({ cta: 'See the offer', dismiss: 'Hide this offer' });

const STORAGE_PREFIX = 'sg.promo.dismissed.';

export function isPromoAudience(license) {
  if (!license || typeof license !== 'object') return false;
  if (license.isExempt || license.isPaid) return false;
  if (license.reason === 'machine_mismatch') return false;
  return true;
}

export function activePromo(now = Date.now(), promos = PROMOS) {
  const t = Number(now);
  return promos.find((p) => t >= p.start && t <= p.end) || null;
}

// -> { id, url, text, cta, dismiss, end } | null
// t: i18next's t for the common namespace (optional).
export function pickPromo(license, { now = Date.now(), dismissed = () => false, path = '', t = null } = {}) {
  if (!isPromoAudience(license)) return null;
  if (/^\/billing(\/|$)/.test(String(path || ''))) return null;
  const p = activePromo(now);
  if (!p || dismissed(p.id)) return null;
  const fill = (str, vars) => String(str).replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  const tr = (key, fallback, vars = {}) => fill(typeof t === 'function' ? t(key, { ...vars, defaultValue: fallback }) : fallback, vars);
  return {
    id: p.id, url: p.url, end: p.end,
    text: tr(`promo.${p.key}.text`, p.text, p.prices),
    cta: tr('promo.cta', PROMO_LABELS.cta),
    dismiss: tr('promo.dismiss', PROMO_LABELS.dismiss)
  };
}

// localStorage can be missing or throw (private profile, cleared data): never let that break the shell.
export function isPromoDismissed(id, storage = globalThis.localStorage) {
  try { return Boolean(storage && storage.getItem(STORAGE_PREFIX + id) === '1'); } catch (_) { return false; }
}

export function dismissPromo(id, storage = globalThis.localStorage) {
  try { if (storage) storage.setItem(STORAGE_PREFIX + id, '1'); } catch (_) { /* session-only dismissal */ }
}
