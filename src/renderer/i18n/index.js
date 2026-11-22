// Offline i18n: translations are bundled JSON (local-first). English is bundled eagerly and is the
// per-key fallback; every other language is its own lazy chunk (Vite import.meta.glob), loaded
// before the first render (main.jsx waits for `i18nReady`) or when the user switches language.
// A language whose folder is missing or incomplete still works: missing keys fall back to English.
// Single source of the language list and storage key (langs.mjs); lib/lang.js builds on it, so
// never import from there (cycle).
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANG_KEY, SUPPORTED_LANGS, LANG_CODES, detectLang, langDir, isRtl, applyDocumentLang } from './langs.mjs';
import { setIntlLanguage } from '../lib/intl.mjs';
import { applyUrduFont } from '../lib/urduFont.js';

export { LANG_KEY, SUPPORTED_LANGS, isRtl, langDir, applyDocumentLang };

// ./locales/en/<ns>.json, eagerly (the fallback must be there synchronously).
const EN_FILES = import.meta.glob('./locales/en/*.json', { eager: true, import: 'default' });
// ./locales/<code>/<ns>.json for every other language, as lazy loaders.
const LAZY_FILES = import.meta.glob(['./locales/*/*.json', '!./locales/en/*.json'], { import: 'default' });

const fileParts = (p) => {
  const m = p.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  return m ? { code: m[1], ns: m[2] } : null;
};

// Every namespace is an English file name; pages resolve in any load order.
export const NAMESPACES = Object.keys(EN_FILES).map((p) => fileParts(p).ns).sort();

const enResources = {};
for (const [p, data] of Object.entries(EN_FILES)) enResources[fileParts(p).ns] = data;

// code -> [{ ns, load }]
const LOADERS = {};
for (const [p, load] of Object.entries(LAZY_FILES)) {
  const parts = fileParts(p);
  if (!parts || !LANG_CODES.includes(parts.code)) continue;
  (LOADERS[parts.code] ||= []).push({ ns: parts.ns, load });
}

// Languages that ship at least one translated file in this build.
export const AVAILABLE_LANGS = ['en', ...Object.keys(LOADERS)];

function navigatorLanguages() {
  try {
    const list = Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : [navigator.language];
    return list.filter(Boolean);
  } catch (e) {
    return [];
  }
}

// The saved choice; on first run (nothing saved) the OS / Electron locale when we support it,
// else English. Detection is not persisted, so only an explicit choice sticks.
export function readStoredLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (LANG_CODES.includes(v)) return v;
  } catch (e) { /* storage blocked */ }
  return detectLang(navigatorLanguages());
}


const loading = new Map();

// Loads every namespace file a language has. Resolves (never rejects) once they are registered;
// a file that fails to load is skipped and its keys fall back to English.
export function loadLanguage(code) {
  if (code === 'en' || !LANG_CODES.includes(code)) return Promise.resolve(code);
  if (loading.has(code)) return loading.get(code);
  const files = LOADERS[code] || [];
  const p = Promise.all(files.map(({ ns, load }) => load().then(
    (data) => { i18n.addResourceBundle(code, ns, data, true, true); },
    (err) => { console.warn(`[i18n] ${code}/${ns}.json failed to load`, err); },
  ))).then(() => code);
  loading.set(code, p);
  return p;
}

// Switch language; the UI keeps the current language until the new one is loaded (no blank state).
export async function switchLanguage(code) {
  const next = LANG_CODES.includes(code) ? code : 'en';
  await loadLanguage(next);
  await i18n.changeLanguage(next);
  return next;
}

function tellMainProcess(code) {
  try { window.softglaze?.ui?.setLanguage?.(code); } catch (e) { /* preview / tests */ }
}

i18n.on('languageChanged', (code) => {
  applyDocumentLang(code);
  applyUrduFont(code);
  setIntlLanguage(code);
  tellMainProcess(code);
});

const initialLang = readStoredLang();
applyDocumentLang(initialLang);
applyUrduFont(initialLang); // Urdu + Nastaliq starts loading the bundled font before the first render
setIntlLanguage(initialLang);
tellMainProcess(initialLang);

i18n.use(initReactI18next).init({
  resources: { en: enResources },
  partialBundledLanguages: true,
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: LANG_CODES,
  nonExplicitSupportedLngs: false,
  load: 'currentOnly',
  defaultNS: 'common',
  ns: NAMESPACES,
  interpolation: { escapeValue: false }, // React already escapes against XSS
  returnNull: false,
  returnEmptyString: false, // an empty translation falls back to English
  react: { useSuspense: false, bindI18nStore: 'added' },
});

// Resolves when the starting language is loaded and active; main.jsx renders after it. A failed or
// slow load never blocks the app: after 4 s it renders in English and switches when ready.
export const i18nReady = Promise.race([
  switchLanguage(initialLang),
  new Promise((resolve) => setTimeout(resolve, 4000)),
]).catch(() => undefined);

export default i18n;
