// Display-language preference — the user-facing surface over the i18n instance.
// Mirrors lib/theme.js: read the persisted choice, and on change persist it,
// update <html lang> for accessibility, and switch the live i18next language so
// every component using useTranslation re-renders instantly (no reload).
import i18n, { LANG_KEY, SUPPORTED_LANGS, readStoredLang } from '@/i18n/index.js';

export { SUPPORTED_LANGS };

export const getStoredLang = readStoredLang;

export function setLang(code) {
  const codes = SUPPORTED_LANGS.map((l) => l.code);
  const next = codes.includes(code) ? code : 'en';
  try { localStorage.setItem(LANG_KEY, next); } catch (e) { /* ignore */ }
  try { document.documentElement.setAttribute('lang', next); } catch (e) { /* ignore */ }
  i18n.changeLanguage(next);
  return next;
}
