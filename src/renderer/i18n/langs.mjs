// The UI language list and locale matching. Plain ESM with no Vite or DOM dependencies, so the
// node tests can import it; i18n/index.js re-exports everything here.

export const LANG_KEY = 'softglaze-lang';

// `native` is shown in the picker so a speaker recognizes their own language whatever the current
// UI language is; `label` is the English name (shown next to it and searchable). Order: English,
// then Latin-script names A-Z, then Cyrillic, Arabic, Devanagari, Thai and CJK (the order most
// language pickers use). `dir: 'rtl'` languages flip the layout.
export const SUPPORTED_LANGS = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'id', label: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'pl', label: 'Polish', native: 'Polski' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', native: 'Português (Brasil)' },
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'tr', label: 'Turkish', native: 'Türkçe' },
  { code: 'ru', label: 'Russian', native: 'Русский' },
  { code: 'uk', label: 'Ukrainian', native: 'Українська' },
  { code: 'ar', label: 'Arabic', native: 'العربية', dir: 'rtl' },
  { code: 'ur', label: 'Urdu', native: 'اردو', dir: 'rtl' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'th', label: 'Thai', native: 'ไทย' },
  { code: 'ja', label: 'Japanese', native: '日本語' },
  { code: 'zh-Hans', label: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'zh-Hant', label: 'Chinese (Traditional)', native: '繁體中文' },
];

export const LANG_CODES = SUPPORTED_LANGS.map((l) => l.code);

export function isRtl(code) {
  return SUPPORTED_LANGS.some((l) => l.code === code && l.dir === 'rtl');
}

export function langDir(code) {
  return isRtl(code) ? 'rtl' : 'ltr';
}

// <html lang="ar" dir="rtl">: CSS logical properties, :lang() font stacks and [dir=rtl] overrides
// all key off these two attributes.
export function applyDocumentLang(code, doc = globalThis.document) {
  try {
    const el = doc.documentElement;
    el.setAttribute('lang', code);
    el.setAttribute('dir', langDir(code));
  } catch (e) { /* no DOM */ }
}

// Map one BCP 47 tag (navigator.languages / app.getLocale) to a supported code, or null.
//   zh, zh-CN, zh-SG, zh-Hans-*      -> zh-Hans
//   zh-TW, zh-HK, zh-MO, zh-Hant-*   -> zh-Hant
//   pt, pt-PT, pt-BR                 -> pt-BR
//   de-AT, es-419, fr-CA ...          -> de, es, fr
export function matchLang(tag, codes = LANG_CODES) {
  if (!tag || typeof tag !== 'string') return null;
  const t = tag.trim().replace(/_/g, '-');
  if (!t) return null;
  const lower = t.toLowerCase();
  const exact = codes.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  const [base, ...rest] = lower.split('-');
  if (base === 'zh') {
    const trad = rest.includes('hant') || rest.some((p) => ['tw', 'hk', 'mo'].includes(p));
    const code = trad ? 'zh-Hant' : 'zh-Hans';
    return codes.includes(code) ? code : null;
  }
  if (base === 'pt') return codes.includes('pt-BR') ? 'pt-BR' : null;
  if (base === 'nb' || base === 'nn') return null;
  const byBase = codes.find((c) => c.toLowerCase() === base);
  return byBase || null;
}

// First supported language in a preference list, else 'en'.
export function detectLang(tags, codes = LANG_CODES) {
  const list = Array.isArray(tags) ? tags : [tags];
  for (const tag of list) {
    const hit = matchLang(tag, codes);
    if (hit) return hit;
  }
  return 'en';
}

// Picker order is the list order. `query` filters on
// native name, English name and code.
export function filterLangs(query, langs = SUPPORTED_LANGS) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return langs;
  return langs.filter((l) => l.native.toLowerCase().includes(q) || l.label.toLowerCase().includes(q) || l.code.toLowerCase().includes(q));
}

// "Deutsch · German"; English alone. The native name comes first so a native select's type-ahead
// finds it.
export function langOptionLabel(l) {
  return l.native === l.label ? l.native : `${l.native} · ${l.label}`;
}
