// Seasonal offer banner (Black Friday 2026, Christmas 2026). Pure and framework-free so node:test can
// exercise it; AppShell renders the result with components/PromoBanner.jsx.
//
// Who sees it: an unpaid licence (Free plan, trial, trial in grace, ended), never a paid or exempt one
// and never a licence registered to another computer. When: only inside an offer's UTC window, read from
// the computer's clock, so it switches itself on and off with no update or server call. It can be
// dismissed; the dismissal is kept per offer (a new offer shows again). The text lives here in English
// and Spanish so this change does not touch the shared locale files.

export const PROMOS = Object.freeze([
  Object.freeze({
    id: 'bf-2026',
    start: Date.parse('2026-11-24T00:00:00Z'),
    end: Date.parse('2026-12-01T23:59:59Z'),
    url: 'https://browser.softglaze.com/black-friday?utm_source=app&utm_medium=banner&utm_campaign=bf2026',
    text: {
      en: 'Black Friday: Pro Lifetime US$49 or Enterprise Lifetime US$249, one payment. Ends 1 Dec, 23:59 UTC.',
      es: 'Black Friday: Pro de por vida US$49 o Enterprise de por vida US$249, un solo pago. Termina el 1 de diciembre, 23:59 UTC.'
    }
  }),
  Object.freeze({
    id: 'xmas-2026',
    start: Date.parse('2026-12-20T00:00:00Z'),
    end: Date.parse('2026-12-31T23:59:59Z'),
    url: 'https://browser.softglaze.com/black-friday?utm_source=app&utm_medium=banner&utm_campaign=xmas2026',
    text: {
      en: 'Christmas batch: Pro Lifetime US$49 or Enterprise Lifetime US$249, one payment. Ends 31 Dec, 23:59 UTC.',
      es: 'Lote de Navidad: Pro de por vida US$49 o Enterprise de por vida US$249, un solo pago. Termina el 31 de diciembre, 23:59 UTC.'
    }
  })
]);

export const PROMO_LABELS = Object.freeze({
  en: Object.freeze({ cta: 'See the offer', dismiss: 'Hide this offer' }),
  es: Object.freeze({ cta: 'Ver la oferta', dismiss: 'Ocultar esta oferta' })
});

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
export function pickPromo(license, { now = Date.now(), dismissed = () => false, lang = 'en', path = '' } = {}) {
  if (!isPromoAudience(license)) return null;
  if (/^\/billing(\/|$)/.test(String(path || ''))) return null;
  const p = activePromo(now);
  if (!p || dismissed(p.id)) return null;
  const l = String(lang || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
  return { id: p.id, url: p.url, end: p.end, text: p.text[l], ...PROMO_LABELS[l] };
}

// localStorage can be missing or throw (private profile, cleared data): never let that break the shell.
export function isPromoDismissed(id, storage = globalThis.localStorage) {
  try { return Boolean(storage && storage.getItem(STORAGE_PREFIX + id) === '1'); } catch (_) { return false; }
}

export function dismissPromo(id, storage = globalThis.localStorage) {
  try { if (storage) storage.setItem(STORAGE_PREFIX + id, '1'); } catch (_) { /* session-only dismissal */ }
}
