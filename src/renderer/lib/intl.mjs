// One place for locale-aware formatting. i18n/index.js calls setIntlLanguage() whenever the UI
// language changes, so dates, times, numbers and money follow the app language rather than the
// OS locale. No imports: safe to use from any module (and from node tests).

// UI language code -> BCP 47 locale for Intl. Arabic and Urdu keep Western digits so numbers,
// ports, IPs and counts read the same as in the rest of the app.
const INTL_LOCALE = {
  ar: 'ar-u-nu-latn',
  ur: 'ur-PK-u-nu-latn',
  'zh-Hans': 'zh-Hans-CN',
  'zh-Hant': 'zh-Hant-TW',
  'pt-BR': 'pt-BR',
  hi: 'hi-IN-u-nu-latn',
  th: 'th-TH-u-nu-latn-ca-gregory', // Gregorian years, not Buddhist-era (2569)
};

let current = 'en';

export function intlLocale(lang) {
  const code = lang || current || 'en';
  const mapped = INTL_LOCALE[code] || code;
  try {
    return Intl.getCanonicalLocales(mapped)[0] || 'en';
  } catch {
    return 'en';
  }
}

export function setIntlLanguage(lang) {
  current = lang || 'en';
}

export function activeLanguage() {
  return current;
}

function toDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function format(value, options, fallback, lang) {
  if (value === null || value === undefined || value === '') return fallback;
  const d = toDate(value);
  if (!d) return fallback;
  try {
    return new Intl.DateTimeFormat(intlLocale(lang), options).format(d);
  } catch {
    try { return new Intl.DateTimeFormat('en', options).format(d); } catch { return String(value); }
  }
}

export const fmtDate = (value, fallback = '-', lang) => format(value, { dateStyle: 'medium' }, fallback, lang);
export const fmtDateTime = (value, fallback = '-', lang) => format(value, { dateStyle: 'medium', timeStyle: 'short' }, fallback, lang);
export const fmtTime = (value, fallback = '', lang) => format(value, { timeStyle: 'medium' }, fallback, lang);
export const fmtShortTime = (value, fallback = '', lang) => format(value, { hour: '2-digit', minute: '2-digit' }, fallback, lang);
export const fmtDateParts = (value, options, fallback = '-', lang) => format(value, options, fallback, lang);

export function fmtNumber(n, options, lang) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n ?? '');
  try { return new Intl.NumberFormat(intlLocale(lang), options).format(n); } catch { return String(n); }
}

export function fmtCurrency(amount, currency = 'USD', lang) {
  try {
    return new Intl.NumberFormat(intlLocale(lang), { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function fmtPercent(ratio, digits = 0, lang) {
  return fmtNumber(ratio, { style: 'percent', maximumFractionDigits: digits }, lang);
}
