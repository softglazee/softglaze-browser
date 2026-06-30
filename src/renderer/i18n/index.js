// App internationalization (i18n) — offline, bundled resources.
//
// Translations ship as JSON imported straight into the Vite bundle (no HTTP
// backend), so the app stays fully local-first. The selected language is
// persisted in localStorage and mirrored onto <html lang> for accessibility,
// exactly like the theme system in lib/theme.js.
//
// This module is the single source of truth for the supported-language list and
// the persistence key; lib/lang.js builds the user-facing setLang/getStoredLang
// helpers on top of it (one-way dependency — this file imports nothing from there
// to avoid a cycle). Initialization is synchronous (resources are inlined), so
// useSuspense is off and no <Suspense> fallback is ever shown for translations.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en/common.json';
import es from './locales/es/common.json';

export const LANG_KEY = 'softglaze-lang';

// Languages the UI ships translations for. `native` is shown in the picker so a
// speaker recognizes their own language regardless of the current UI language.
export const SUPPORTED_LANGS = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
];

const CODES = SUPPORTED_LANGS.map((l) => l.code);

export function readStoredLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return CODES.includes(v) ? v : 'en';
  } catch (e) {
    return 'en';
  }
}

const lng = readStoredLang();
try { document.documentElement.setAttribute('lang', lng); } catch (e) { /* SSR / no DOM */ }

i18n.use(initReactI18next).init({
  resources: {
    en: { common: en },
    es: { common: es },
  },
  lng,
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common'],
  interpolation: { escapeValue: false }, // React already escapes against XSS
  returnNull: false,
  react: { useSuspense: false },
});

export default i18n;
